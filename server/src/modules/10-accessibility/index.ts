import fs from "fs";
import * as cheerio from "cheerio";
import type { CrawledFile, AuditIssue, ModuleResult } from "../../types.js";
import { calculateModuleScore } from "../../scoring.js";

function parseColor(color: string): { r: number; g: number; b: number } | null {
  const hex = color.match(/^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/);
  if (hex) return { r: parseInt(hex[1], 16), g: parseInt(hex[2], 16), b: parseInt(hex[3], 16) };
  const hex3 = color.match(/^#([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])$/);
  if (hex3) return { r: parseInt(hex3[1] + hex3[1], 16), g: parseInt(hex3[2] + hex3[2], 16), b: parseInt(hex3[3] + hex3[3], 16) };
  const rgb = color.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgb) return { r: parseInt(rgb[1], 10), g: parseInt(rgb[2], 10), b: parseInt(rgb[3], 10) };
  return null;
}

function srgbLinear(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function relativeLuminance(r: number, g: number, b: number): number {
  return 0.2126 * srgbLinear(r) + 0.7152 * srgbLinear(g) + 0.0722 * srgbLinear(b);
}

function contrastRatio(c1: { r: number; g: number; b: number }, c2: { r: number; g: number; b: number }): number {
  const l1 = relativeLuminance(c1.r, c1.g, c1.b);
  const l2 = relativeLuminance(c2.r, c2.g, c2.b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

export function auditAccessibility(files: CrawledFile[]): ModuleResult {
  const issues: AuditIssue[] = [];
  const htmlFiles = files.filter((f) => f.type === "html" && !f.relativePath.startsWith("node_modules") && !f.relativePath.startsWith(".well-known"));
  const cssFiles = files.filter((f) => f.type === "css");

  let cssText = cssFiles.map((f) => { try { return fs.readFileSync(f.path, "utf-8"); } catch { return ""; } }).join("\n");

  for (const file of htmlFiles) {
    try {
      const inlineCss = fs.readFileSync(file.path, "utf-8").match(/<style[^>]*>([\s\S]*?)<\/style>/gi);
      if (inlineCss) cssText += "\n" + inlineCss.join("\n");
    } catch { /* skip */ }
  }

  for (const file of htmlFiles) {
    let content: string;
    try { content = fs.readFileSync(file.path, "utf-8"); }
    catch { continue; }

    const $ = cheerio.load(content);

    // --- SC 1.1.1 (A): Non-text Content ---
    // All <img> must have alt attribute
    $("img").each((_i, el) => {
      if (!$(el).attr("alt") && $(el).attr("alt") !== "") {
        issues.push({
          id: `img-missing-alt-${file.relativePath}-${_i}`,
          severity: "critical",
          title: "Image missing alt attribute",
          description: `${file.relativePath}: image #${_i + 1} has no alt attribute.`,
          filePath: file.relativePath,
          suggestion: 'Add an alt attribute describing the image content, or alt="" for decorative images.',
        });
      }
    });

    // Images with filename as alt
    $("img[alt]").each((_i, el) => {
      const alt = ($(el).attr("alt") || "").trim();
      if (/\.(jpe?g|png|gif|svg|webp|bmp|ico)$/i.test(alt)) {
        issues.push({
          id: `img-filename-alt-${file.relativePath}-${_i}`,
          severity: "high",
          title: "Image alt text appears to be a filename",
          description: `${file.relativePath}: image #${_i + 1} has alt="${alt}" which looks like a filename.`,
          filePath: file.relativePath,
          suggestion: "Replace the filename with a meaningful description of the image content.",
        });
      }
    });

    // Decorative images with alt="" missing role="presentation"
    $('img[alt=""]').each((_i, el) => {
      const role = $(el).attr("role");
      if (role !== "presentation" && role !== "none") {
        issues.push({
          id: `img-decorative-role-${file.relativePath}-${_i}`,
          severity: "low",
          title: "Decorative image should have role=\"presentation\"",
          description: `${file.relativePath}: image #${_i + 1} has alt="" but no role="presentation".`,
          filePath: file.relativePath,
          suggestion: 'Add role="presentation" or role="none" to decorative images with alt="".',
        });
      }
    });

    // <svg> without accessible name (decorative SVGs with aria-hidden="true" exempted)
    $("svg").each((_i, el) => {
      const $el = $(el);
      const hasAriaLabel = !!$el.attr("aria-label") || !!$el.attr("aria-labelledby");
      const hasTitle = $el.find("title").text().trim().length > 0;
      const isDecorative = $el.attr("aria-hidden") === "true";
      if (!hasAriaLabel && !hasTitle && !isDecorative) {
        issues.push({
          id: `svg-no-name-${file.relativePath}-${_i}`,
          severity: "high",
          title: "SVG missing accessible name",
          description: `${file.relativePath}: <svg> #${_i + 1} has no aria-label, aria-labelledby, or <title>.`,
          filePath: file.relativePath,
          suggestion: "Add aria-label or a <title> element inside the <svg> to provide an accessible name.",
        });
      }
    });

    // <input type="image"> without alt
    $('input[type="image"]').each((_i, el) => {
      if (!$(el).attr("alt")) {
        issues.push({
          id: `input-image-alt-${file.relativePath}-${_i}`,
          severity: "critical",
          title: "Image button missing alt text",
          description: `${file.relativePath}: <input type="image"> #${_i + 1} has no alt attribute.`,
          filePath: file.relativePath,
          suggestion: "Add an alt attribute describing the button's purpose.",
        });
      }
    });


    // List markup: <ul> or <ol> with non-<li> direct children
    $("ul, ol").each((_i, el) => {
      const children = $(el).children();
      if (children.toArray().some((child) => child.tagName !== "li")) {
        issues.push({
          id: `list-markup-${file.relativePath}-${_i}`,
          severity: "high",
          title: "List contains non-list-items as direct children",
          description: `${file.relativePath}: <${el.tagName}> #${_i + 1} has direct children that are not <li>.`,
          filePath: file.relativePath,
          suggestion: "Ensure only <li> elements are direct children of <ul> or <ol>.",
        });
      }
    });

    // Table headers: <th> with scope
    $("table").each((_i, el) => {
      const $table = $(el);
      if ($table.find("th").length > 0 && $table.find("th[scope]").length === 0) {
        issues.push({
          id: `table-no-scope-${file.relativePath}-${_i}`,
          severity: "high",
          title: "Table header cells missing scope attribute",
          description: `${file.relativePath}: table #${_i + 1} has <th> elements without scope.`,
          filePath: file.relativePath,
          suggestion: 'Add scope="col" for column headers and scope="row" for row headers.',
        });
      }
    });

    // <fieldset> + <legend>
    $("fieldset").each((_i, el) => {
      if ($(el).find("legend").length === 0) {
        issues.push({
          id: `fieldset-no-legend-${file.relativePath}-${_i}`,
          severity: "high",
          title: "Fieldset missing legend",
          description: `${file.relativePath}: <fieldset> #${_i + 1} has no <legend>.`,
          filePath: file.relativePath,
          suggestion: "Add a <legend> element describing the group of fields.",
        });
      }
    });

    // ARIA landmarks: main landmark check
    if ($("main").length === 0 && $('[role="main"]').length === 0) {
      issues.push({
        id: `missing-main-${file.relativePath}`,
        severity: "critical",
        title: "Missing <main> landmark",
        description: `${file.relativePath} has no <main> element or role="main".`,
        filePath: file.relativePath,
        suggestion: "Wrap primary content in <main> for screen reader navigation.",
      });
    }

    // --- SC 1.3.4 (AA): Orientation ---
    const viewportMeta = $('meta[name="viewport"]').attr("content") || "";
    if (/orientation\s*:\s*(portrait|landscape)/i.test(viewportMeta)) {
      issues.push({
        id: `orientation-lock-${file.relativePath}`,
        severity: "high",
        title: "Viewport orientation lock detected",
        description: `${file.relativePath} locks the viewport orientation.`,
        filePath: file.relativePath,
        suggestion: "Remove orientation lock to support both portrait and landscape modes unless essential.",
      });
    }

    // --- SC 1.3.5 (AA): Identify Input Purpose ---
    const validAutocomplete = ["name", "honorific-prefix", "given-name", "additional-name", "family-name", "honorific-suffix", "nickname", "email", "username", "new-password", "current-password", "one-time-code", "organization-title", "organization", "street-address", "address-line1", "address-line2", "address-line3", "address-level4", "address-level3", "address-level2", "address-level1", "country", "country-name", "postal-code", "cc-name", "cc-given-name", "cc-additional-name", "cc-family-name", "cc-number", "cc-exp", "cc-exp-month", "cc-exp-year", "cc-csc", "cc-type", "transaction-currency", "transaction-amount", "language", "bday", "bday-day", "bday-month", "bday-year", "sex", "tel", "tel-country-code", "tel-national", "tel-area-code", "tel-local", "tel-local-prefix", "tel-local-suffix", "tel-extension", "impp", "url", "photo"];
    $("input, select, textarea").each((_i, el) => {
      const auto = $(el).attr("autocomplete");
      if (auto) {
        const parts = auto.split(/\s+/);
        for (const part of parts) {
          const clean = part.toLowerCase();
          if (clean !== "on" && clean !== "off" && !validAutocomplete.includes(clean)) {
            issues.push({
              id: `invalid-autocomplete-${file.relativePath}-${_i}`,
              severity: "medium",
              title: "Invalid autocomplete value",
              description: `${file.relativePath}: field #${_i + 1} has autocomplete="${auto}" with unrecognized token "${clean}".`,
              filePath: file.relativePath,
              suggestion: `Use a valid HTML autocomplete token such as "name" or "email".`,
            });
          }
        }
      }
    });

    // --- SC 1.4.2 (A): Audio Control ---
    $("audio[autoplay], video[autoplay]").each((_i, el) => {
      const $el = $(el);
      const hasControls = $el.attr("controls") !== undefined;
      const isMuted = $el.attr("muted") !== undefined;
      if (!hasControls && !isMuted) {
        issues.push({
          id: `autoplay-no-controls-${file.relativePath}-${_i}`,
          severity: "critical",
          title: "Autoplay media without controls or muted",
          description: `${file.relativePath}: <${el.tagName}> has autoplay but no controls or muted attribute.`,
          filePath: file.relativePath,
          suggestion: "Add the controls attribute or use muted for autoplay.",
        });
      }
    });

    // --- SC 1.4.4 (AA): Resize Text ---
    if (/user-scalable\s*=\s*no/i.test(viewportMeta) || /maximum-scale\s*=\s*1(\.0)?/i.test(viewportMeta)) {
      issues.push({
        id: `viewport-zoom-lock-${file.relativePath}`,
        severity: "high",
        title: "Viewport prevents zooming",
        description: `${file.relativePath} has user-scalable=no or maximum-scale=1.0, preventing text resize.`,
        filePath: file.relativePath,
        suggestion: "Remove user-scalable=no and set maximum-scale to at least 2.0.",
      });
    }

    // --- SC 2.4.2 (A): Page Titled ---
    const titleText = $("title").text().trim();
    if ($("title").length === 0 || !titleText) {
      issues.push({
        id: `missing-title-${file.relativePath}`,
        severity: "high",
        title: "Page missing <title>",
        description: `${file.relativePath} has no <title> or the title is empty.`,
        filePath: file.relativePath,
        suggestion: "Add a descriptive <title> element summarizing the page content.",
      });
    }

    // --- SC 2.4.3 (A): Focus Order ---
    $("[tabindex]").each((_i, el) => {
      const val = parseInt($(el).attr("tabindex") || "", 10);
      if (val > 0) {
        issues.push({
          id: `positive-tabindex-${file.relativePath}-${_i}`,
          severity: "high",
          title: "Positive tabindex value",
          description: `${file.relativePath}: element has tabindex="${val}" — disrupts natural tab order.`,
          filePath: file.relativePath,
          suggestion: 'Use tabindex="0" or reorder the DOM instead of positive values.',
        });
      }
    });

    // --- SC 2.4.4 (A): Link Purpose (In Context) ---
    // Links with no accessible name
    $("a[href]").each((_i, el) => {
      const $el = $(el);
      const text = $el.text().trim();
      const ariaLabel = $el.attr("aria-label") || "";
      const ariaLabelledby = $el.attr("aria-labelledby") || "";
      if (!text && !ariaLabel && !ariaLabelledby) {
        issues.push({
          id: `link-no-text-${file.relativePath}-${_i}`,
          severity: "high",
          title: "Link has no accessible name",
          description: `${file.relativePath}: link #${_i + 1} with href="${$el.attr("href")}" has no text or aria-label.`,
          filePath: file.relativePath,
          suggestion: "Add text content or an aria-label describing the link destination.",
        });
      }
    });

    // Generic link text
    const genericTexts = ["click here", "read more", "more", "link", "this", "here", "learn more", "details"];
    $("a[href]").each((_i, el) => {
      const text = $(el).text().trim().toLowerCase();

    });

    // Same link text, different href
    const linkTexts = new Map<string, string[]>();
    $("a[href]").each((_i, el) => {
      const text = $(el).text().trim();
      const href = $(el).attr("href") || "";
      if (text && !href.startsWith("#") && !href.startsWith("javascript:")) {
        if (!linkTexts.has(text)) linkTexts.set(text, []);
        linkTexts.get(text)!.push(href);
      }
    });
    for (const [text, hrefs] of linkTexts) {
      const unique = [...new Set(hrefs)];
      if (unique.length > 1) {
        issues.push({
          id: `ambiguous-link-text-${file.relativePath}-${text.slice(0, 20)}`,
          severity: "high",
          title: `Ambiguous link text: "${text}"`,
          description: `${file.relativePath}: links with text "${text}" point to different destinations: ${unique.join(", ")}.`,
          filePath: file.relativePath,
          suggestion: "Use more descriptive link text so each destination is unique.",
        });
      }
    }

    // Links opening in new window without warning
    $('a[target="_blank"]').each((_i, el) => {
      const text = $(el).text().trim().toLowerCase();
      if (!text.includes("new tab") && !text.includes("new window") && !text.includes("external") && !$(el).attr("aria-label")?.toLowerCase().includes("new tab")) {
        issues.push({
          id: `new-window-no-warning-${file.relativePath}-${_i}`,
          severity: "medium",
          title: "Link opens in new window without warning",
          description: `${file.relativePath}: link "${$(el).text().trim()}" has target="_blank" but no warning.`,
          filePath: file.relativePath,
          suggestion: 'Add rel="noopener noreferrer" and indicate "(opens in new tab)" in the link text.',
        });
      }
    });

    // --- SC 2.4.6 (AA): Headings and Labels ---
    const headings = $("h1, h2, h3, h4, h5, h6");
    headings.each((_i, el) => {
      const text = $(el).text().trim();
      if (!text) {
        issues.push({
          id: `empty-heading-${file.relativePath}-${_i}`,
          severity: "high",
          title: "Empty heading element",
          description: `${file.relativePath}: <${el.tagName}> #${_i + 1} has no text content.`,
          filePath: file.relativePath,
          suggestion: "Remove empty headings or add meaningful heading text.",
        });
      }
    });

    // --- SC 2.4.7 (AA): Focus Visible ---
    $('[style*="outline: none"], [style*="outline:none"]').each((_i, el) => {
      const tag = el.tagName.toLowerCase();
      const isFocusable = ["a", "button", "input", "select", "textarea"].includes(tag) || $(el).attr("tabindex") !== undefined;
      if (isFocusable) {
        issues.push({
          id: `outline-none-${file.relativePath}-${_i}`,
          severity: "high",
          title: "Focus outline removed without alternative",
          description: `${file.relativePath}: focusable element has outline:none — keyboard users lose focus indication.`,
          filePath: file.relativePath,
          suggestion: "Replace outline:none with a custom visible focus style using :focus-visible.",
        });
      }
    });

    // --- SC 2.4.10 (AAA): Section Headings ---
    if (headings.length === 0) {
      issues.push({
        id: `no-section-headings-${file.relativePath}`,
        severity: "medium",
        title: "No section headings found",
        description: `${file.relativePath} lacks heading elements — screen reader users depend on headings for navigation.`,
        filePath: file.relativePath,
        suggestion: "Add heading elements (h1-h6) to organize the page content hierarchically.",
      });
    }

    // --- SC 2.4.11 (AA - WCAG 2.2): Focus Not Obscured ---
    $('[style*="position: sticky"], [style*="position:sticky"], [style*="position: fixed"], [style*="position:fixed"]').each((_i, el) => {
      issues.push({
        id: `sticky-position-${file.relativePath}-${_i}`,
        severity: "low",
        title: "Sticky or fixed positioning may obscure focus",
        description: `${file.relativePath}: element #${_i + 1} uses sticky/fixed positioning — may overlap focused elements.`,
        filePath: file.relativePath,
        suggestion: "Ensure sticky/fixed elements do not cover focused content; consider scroll-padding.",
      });
    });

    // --- SC 2.5.3 (A): Label in Name ---
    $("input, textarea, select").each((_i, el) => {
      const $el = $(el);
      const ariaLabel = $el.attr("aria-label");
      if (!ariaLabel) return;
      const id = $el.attr("id");
      let labelText = "";
      if (id) {
        const $label = $(`label[for="${id}"]`);
        if ($label.length > 0) labelText = $label.text().trim();
      }
      if (!labelText) {
        const $parentLabel = $el.closest("label");
        if ($parentLabel.length > 0) labelText = $parentLabel.text().trim();
      }
      if (labelText && ariaLabel.toLowerCase() !== labelText.toLowerCase()) {
        issues.push({
          id: `label-in-name-${file.relativePath}-${_i}`,
          severity: "medium",
          title: "aria-label does not match visible label",
          description: `${file.relativePath}: field #${_i + 1} aria-label="${ariaLabel}" but visible label is "${labelText}".`,
          filePath: file.relativePath,
          suggestion: "Ensure the accessible name includes the visible label text for speech-input users.",
        });
      }
    });

    // --- SC 3.1.1 (A): Language of Page ---
    const htmlLang = $("html").attr("lang");
    if (!htmlLang) {
      issues.push({
        id: `missing-lang-${file.relativePath}`,
        severity: "high",
        title: "HTML element missing lang attribute",
        description: `${file.relativePath}: <html> has no lang attribute.`,
        filePath: file.relativePath,
        suggestion: 'Add lang="en" (or appropriate BCP 47 code) to the <html> element.',
      });
    } else if (!/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(htmlLang.trim())) {
      issues.push({
        id: `invalid-lang-${file.relativePath}`,
        severity: "high",
        title: "Invalid lang attribute value",
        description: `${file.relativePath}: <html lang="${htmlLang}"> is not a valid BCP 47 value.`,
        filePath: file.relativePath,
        suggestion: 'Use a valid BCP 47 language tag such as "en" or "en-US".',
      });
    }

    // --- SC 3.1.2 (AA): Language of Parts ---
    $("[lang]").each((_i, el) => {
      if (el.tagName.toLowerCase() === "html") return;
      const lang = $(el).attr("lang") || "";
      if (lang && lang !== htmlLang && !/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(lang.trim())) {
        issues.push({
          id: `invalid-part-lang-${file.relativePath}-${_i}`,
          severity: "medium",
          title: "Invalid language-change lang attribute",
          description: `${file.relativePath}: <${el.tagName}> lang="${lang}" is not valid BCP 47.`,
          filePath: file.relativePath,
          suggestion: "Use valid BCP 47 language tags for inline language changes.",
        });
      }
    });

    // --- SC 3.2.1 (A): On Focus ---
    $("[onfocus]").each((_i, el) => {
      const handler = $(el).attr("onfocus") || "";
      if (/window\.location|document\.location|\.href\s*=|\.submit\(|\.navigate/i.test(handler)) {
        issues.push({
          id: `onfocus-navigation-${file.relativePath}-${_i}`,
          severity: "high",
          title: "onfocus event causes navigation",
          description: `${file.relativePath}: element #${_i + 1} has onfocus handler that changes the page.`,
          filePath: file.relativePath,
          suggestion: "Do not trigger navigation or form submission on focus — it disorients keyboard users.",
        });
      }
    });

    // --- SC 3.3.1 (A): Error Identification ---
    $("input, select, textarea").each((_i, el) => {
      const $el = $(el);
      const hasRequired = $el.attr("required") !== undefined;
      const hasPattern = $el.attr("pattern") !== undefined;
      const inputType = $el.attr("type");
      const hasValidationType = inputType && ["email", "url", "number", "date", "time"].includes(inputType);
      const hasAriaInvalid = $el.attr("aria-invalid") !== undefined;
      if ((hasRequired || hasPattern || hasValidationType || hasAriaInvalid) && !$el.attr("aria-describedby")) {
        issues.push({
          id: `validation-no-describedby-${file.relativePath}-${_i}`,
          severity: "medium",
          title: "Validation input missing error description",
          description: `${file.relativePath}: field #${_i + 1} uses validation attributes but has no aria-describedby.`,
          filePath: file.relativePath,
          suggestion: "Add aria-describedby pointing to an error message or format description element.",
        });
      }
    });

    // --- SC 3.3.2 (A): Labels or Instructions ---
    $("input, textarea, select").each((_i, el) => {
      const $el = $(el);
      const type = $el.attr("type");
      if (type === "hidden" || type === "submit" || type === "button" || type === "reset") return;
      const id = $el.attr("id");
      const hasLabel = id ? $(`label[for="${id}"]`).length > 0 : false;
      const hasAriaLabel = !!$el.attr("aria-label") || !!$el.attr("aria-labelledby");
      const hasWrapperLabel = $el.closest("label").length > 0;
      if (!hasLabel && !hasAriaLabel && !hasWrapperLabel) {
        issues.push({
          id: `field-no-label-${file.relativePath}-${_i}`,
          severity: "critical",
          title: "Form field missing label",
          description: `${file.relativePath}: input #${_i + 1} has no associated label.`,
          filePath: file.relativePath,
          suggestion: "Add a <label> element linked by the for attribute, or use aria-label.",
        });
      }
    });

    // --- SC 4.1.2 (A): Name, Role, Value ---
    // Buttons need accessible names
    $("button").each((_i, el) => {
      const $el = $(el);
      const text = $el.text().trim();
      const ariaLabel = $el.attr("aria-label") || "";
      const ariaLabelledby = $el.attr("aria-labelledby") || "";
      if (!text && !ariaLabel && !ariaLabelledby) {
        issues.push({
          id: `button-no-name-${file.relativePath}-${_i}`,
          severity: "high",
          title: "Button has no accessible name",
          description: `${file.relativePath}: button #${_i + 1} has no text or aria-label.`,
          filePath: file.relativePath,
          suggestion: "Add text content or an aria-label to the button.",
        });
      }
    });

    // iframes need titles
    $("iframe").each((_i, el) => {
      const title = $(el).attr("title") || "";
      const ariaLabel = $(el).attr("aria-label") || "";
      if (!title.trim() && !ariaLabel.trim()) {
        issues.push({
          id: `iframe-no-title-${file.relativePath}-${_i}`,
          severity: "high",
          title: "iframe missing title attribute",
          description: `${file.relativePath}: iframe #${_i + 1} has no title or aria-label.`,
          filePath: file.relativePath,
          suggestion: "Add a title attribute describing the iframe content.",
        });
      }
    });

    // Valid ARIA roles
    const validRoles = ["alert", "alertdialog", "application", "article", "banner", "button", "cell", "checkbox", "columnheader", "combobox", "complementary", "contentinfo", "definition", "dialog", "directory", "document", "feed", "figure", "form", "grid", "gridcell", "group", "heading", "img", "link", "list", "listbox", "listitem", "log", "main", "marquee", "math", "menu", "menubar", "menuitem", "menuitemcheckbox", "menuitemradio", "navigation", "none", "note", "option", "presentation", "progressbar", "radio", "radiogroup", "region", "row", "rowgroup", "rowheader", "scrollbar", "search", "searchbox", "separator", "slider", "spinbutton", "status", "switch", "tab", "table", "tablist", "tabpanel", "term", "textbox", "timer", "toolbar", "tooltip", "tree", "treegrid", "treeitem"];
    $("[role]").each((_i, el) => {
      const role = $(el).attr("role") || "";
      const roles = role.split(/\s+/);
      for (const r of roles) {
        if (r && !validRoles.includes(r)) {
          issues.push({
            id: `invalid-role-${file.relativePath}-${_i}`,
            severity: "high",
            title: `Invalid ARIA role: "${r}"`,
            description: `${file.relativePath}: element #${_i + 1} has role="${r}".`,
            filePath: file.relativePath,
            suggestion: `Replace "${r}" with a valid ARIA role from the WAI-ARIA spec.`,
          });
        }
      }
    });

    // --- SC 4.1.3 (AA): Status Messages ---
    $("[aria-live]").each((_i, el) => {
      const val = $(el).attr("aria-live") || "";
      if (!["off", "polite", "assertive"].includes(val)) {
        issues.push({
          id: `invalid-aria-live-${file.relativePath}-${_i}`,
          severity: "high",
          title: "Invalid aria-live value",
          description: `${file.relativePath}: element #${_i + 1} has aria-live="${val}".`,
          filePath: file.relativePath,
          suggestion: 'Use aria-live="polite" or aria-live="assertive".',
        });
      }
    });

    // --- Existing utility checks ---
    // Text align justify
    $('[style*="text-align: justify"], [style*="text-align:justify"]').each((_i, el) => {
      issues.push({
        id: `text-justify-${file.relativePath}-${_i}`,
        severity: "medium",
        title: "Justified text alignment",
        description: `${file.relativePath} uses text-align: justify, which can cause readability issues.`,
        filePath: file.relativePath,
        suggestion: "Use left-aligned text for better readability, especially for users with dyslexia.",
      });
    });

    // Color contrast: precise check when both color and background-color are explicitly set
    $('[style*="color:"]').each((_i, el) => {
      const style = $(el).attr("style") || "";
      const hasColor = /color\s*:\s*(#[0-9a-fA-F]{3,6}|rgba?\([^)]+\))/.test(style);
      const hasBg = /(background|background-color)\s*:\s*(#[0-9a-fA-F]{3,6}|rgba?\([^)]+\))/.test(style);
      if (hasColor && hasBg) {
        const colorMatch = style.match(/color\s*:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\))/);
        const bgMatch = style.match(/(?:background|background-color)\s*:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\))/);
        if (colorMatch && bgMatch) {
          const fg = parseColor(colorMatch[1].trim());
          const bg = parseColor(bgMatch[1].trim());
          if (fg && bg) {
            const cr = contrastRatio(fg, bg);
            if (cr < 4.5) {
              issues.push({
                id: `color-contrast-ratio-${file.relativePath}-${_i}`,
                severity: "high",
                title: `Insufficient color contrast ratio (${cr.toFixed(2)}:1)`,
                description: `${file.relativePath}: element #${_i + 1} has color contrast of ${cr.toFixed(2)}:1 — WCAG AA requires 4.5:1.`,
                filePath: file.relativePath,
                suggestion: `Increase the contrast ratio to at least 4.5:1 by choosing darker text or lighter background.`,
              });
            }
          }
        }
      }
    });

    // Check for aria-expanded on interactive elements that expand content
    $('[aria-haspopup="true"], [aria-haspopup="menu"], [aria-haspopup="dialog"], [aria-expanded]').each((_i, el) => {
      const $el = $(el);
      const expanded = $el.attr("aria-expanded");
      const hasPopup = $el.attr("aria-haspopup");
      if (hasPopup && expanded === undefined) {
        issues.push({
          id: `aria-expanded-missing-${file.relativePath}-${_i}`,
          severity: "high",
          title: "Element with aria-haspopup missing aria-expanded",
          description: `${file.relativePath}: element #${_i + 1} has aria-haspopup but no aria-expanded state.`,
          filePath: file.relativePath,
          suggestion: 'Add aria-expanded="false" (collapsed) or aria-expanded="true" (expanded) to indicate the current state.',
        });
      }
    });

    // Check for focus trap in modal dialogs
    $('[role="dialog"], [role="alertdialog"], [aria-modal="true"]').each((_i, el) => {
      const $el = $(el);
      const firstFocusable = $el.find('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (firstFocusable.length === 0) {
        issues.push({
          id: `dialog-no-focusable-${file.relativePath}-${_i}`,
          severity: "high",
          title: "Dialog has no focusable elements",
          description: `${file.relativePath}: role="dialog" #${_i + 1} has no focusable elements — keyboard users cannot interact with the dialog.`,
          filePath: file.relativePath,
          suggestion: "Ensure the dialog contains at least one focusable element (button, input, link) for keyboard access.",
        });
      }
    });
  }

  // --- CSS-level checks ---
  // Focus styles
  if (!/:focus\b/.test(cssText) && !/:focus-visible\b/.test(cssText)) {
    issues.push({
      id: "focus-styles-missing",
      severity: "high",
      title: "No focus indicator styles found",
      description: "No :focus or :focus-visible CSS rules found — keyboard users may not see focus indicators.",
      filePath: "CSS (global)",
      suggestion: "Add visible focus styles with :focus-visible for keyboard navigation.",
    });
  }

  // prefers-reduced-motion
  if (!/prefers-reduced-motion/i.test(cssText)) {
    issues.push({
      id: "reduced-motion-missing",
      severity: "medium",
      title: "No prefers-reduced-motion support",
      description: "No @media (prefers-reduced-motion) query found — users with vestibular disorders may be affected by animations.",
      filePath: "CSS (global)",
      suggestion: "Add @media (prefers-reduced-motion: reduce) to disable non-essential animations.",
    });
  }

  const score = calculateModuleScore(issues);
  const criticalCount = issues.filter((i) => i.severity === "critical").length;
  const highCount = issues.filter((i) => i.severity === "high").length;
  const status: ModuleResult["status"] = criticalCount > 0 ? "fail" : highCount > 0 ? "warning" : issues.length > 0 ? "warning" : "pass";

  return {
    moduleId: "10-accessibility",
    moduleName: "Accessibility Audit",
    status,
    score,
    issues,
    summary: `${issues.length} accessibility issue${issues.length !== 1 ? "s" : ""} found across ${htmlFiles.length} page${htmlFiles.length !== 1 ? "s" : ""}`,
  };
}

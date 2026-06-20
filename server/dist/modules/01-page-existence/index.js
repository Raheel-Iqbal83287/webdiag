import fs from "fs";
import { calculateModuleScore } from "../../scoring.js";
import { loadHtml } from "../../utils/html.js";
export function auditPageExistence(files) {
    const issues = [];
    const htmlFiles = files.filter((f) => f.type === "html" && !f.relativePath.startsWith("node_modules") && !f.relativePath.startsWith(".well-known"));
    const bcp47Regex = /^[a-zA-Z]{2,8}(-[a-zA-Z0-9]{1,8})*$/;
    const voidElements = new Set([
        "area", "base", "br", "col", "embed", "hr", "img", "input",
        "link", "meta", "param", "source", "track", "wbr",
    ]);
    const obsoleteElements = new Set([
        "center", "font", "frame", "frameset", "noframes", "big", "strike", "tt",
    ]);
    const phrasingContent = new Set([
        "a", "abbr", "area", "audio", "b", "bdi", "bdo", "br", "button", "canvas",
        "cite", "code", "data", "datalist", "del", "dfn", "em", "embed", "i",
        "iframe", "img", "input", "ins", "kbd", "label", "link", "map", "mark",
        "math", "meta", "meter", "noscript", "object", "output", "picture",
        "progress", "q", "ruby", "s", "samp", "script", "select", "slot",
        "small", "span", "strong", "sub", "sup", "svg", "template", "textarea",
        "time", "u", "var", "video", "wbr",
    ]);
    for (const file of htmlFiles) {
        let content;
        try {
            content = fs.readFileSync(file.path, "utf-8");
        }
        catch {
            issues.push({
                id: `unreadable-${file.relativePath}`,
                severity: "critical",
                title: "Unreadable HTML file",
                description: `File ${file.relativePath} cannot be read.`,
                filePath: file.relativePath,
            });
            continue;
        }
        const $ = loadHtml(content);
        const rp = file.relativePath;
        // -- 1. DOCTYPE (WHATWG §13.1.1) --
        const beforeHtmlMatch = content.match(/^[\s\S]*?(?=<html[\s>]|<HTML[\s>])/i);
        const beforeHtml = beforeHtmlMatch ? beforeHtmlMatch[0] : content;
        const cleaned = beforeHtml
            .replace(/^\uFEFF/, "")
            .replace(/<!--[\s\S]*?-->/g, "")
            .trim();
        const doctypeMatch = cleaned.match(/^<!DOCTYPE\s+html\s*>/i);
        if (!doctypeMatch) {
            issues.push({
                id: `doctype-${rp}`,
                severity: "critical",
                title: "Missing or invalid DOCTYPE",
                description: `${rp} does not have a valid <!DOCTYPE html> declaration before the <html> element.`,
                filePath: rp,
                suggestion: 'Add <!DOCTYPE html> at the very beginning of the file (only BOM, whitespace, and comments may precede it).',
            });
        }
        else if (doctypeMatch.index != null && doctypeMatch.index > 0) {
            const beforeDoctype = cleaned.slice(0, doctypeMatch.index).trim();
            if (beforeDoctype.length > 0) {
                issues.push({
                    id: `doctype-position-${rp}`,
                    severity: "critical",
                    title: "Content precedes DOCTYPE",
                    description: `${rp} has content before the DOCTYPE declaration. Only the BOM, whitespace, and comments are allowed before <!DOCTYPE html>.`,
                    filePath: rp,
                    suggestion: "Remove any elements or text before <!DOCTYPE html>.",
                });
            }
        }
        // -- 2. html element (§4.1.1): head must precede body --
        const headIndex = content.toLowerCase().indexOf("<head");
        const bodyIndex = content.toLowerCase().indexOf("<body");
        if ($("head").length &&
            $("body").length &&
            bodyIndex !== -1 &&
            headIndex !== -1 &&
            headIndex > bodyIndex) {
            issues.push({
                id: `head-after-body-${rp}`,
                severity: "high",
                title: "<body> appears before <head>",
                description: `${rp} has the <body> element before <head>. The content model of <html> is head followed by body.`,
                filePath: rp,
                suggestion: "Place <head> before <body>.",
            });
        }
        // -- 3. lang attribute (§4.1.1) --
        const lang = $("html").attr("lang");
        if (!lang) {
            issues.push({
                id: `lang-missing-${rp}`,
                severity: "high",
                title: "Missing lang attribute on <html>",
                description: `${rp} is missing the lang attribute on the root <html> element.`,
                filePath: rp,
                suggestion: 'Add <html lang="en"> (or the appropriate language code).',
            });
        }
        else if (!bcp47Regex.test(lang)) {
            issues.push({
                id: `lang-invalid-${rp}`,
                severity: "high",
                title: "Invalid lang attribute value",
                description: `${rp} has lang="${lang}" which is not a valid BCP 47 language tag.`,
                filePath: rp,
                suggestion: 'Use a valid BCP 47 language tag such as "en" or "en-US".',
            });
        }
        // -- 4. charset meta (§4.2.5.5) --
        const first1024 = content.slice(0, 1024).toLowerCase();
        const charsetRegex = /<meta[^>]*charset\s*=\s*["']?\s*utf-8\s*["']?[^>]*\/?>/i;
        const charsetInHead = first1024.match(charsetRegex);
        const charsetAnywhere = content.match(charsetRegex);
        const charsetHttpEquiv = /<meta[^>]*http-equiv\s*=\s*["']?\s*content-type\s*["']?[^>]*content\s*=\s*["'][^"']*charset=utf-8[^"']*["'][^>]*\/?>/i;
        if (!charsetAnywhere && !content.match(charsetHttpEquiv)) {
            issues.push({
                id: `charset-missing-${rp}`,
                severity: "critical",
                title: "Missing charset declaration",
                description: `${rp} does not declare the character encoding.`,
                filePath: rp,
                suggestion: 'Add <meta charset="utf-8"> within the first 1024 bytes of the document.',
            });
        }
        else if (charsetAnywhere && !charsetInHead) {
            issues.push({
                id: `charset-late-${rp}`,
                severity: "critical",
                title: "Charset declaration not within first 1024 bytes",
                description: `${rp} has a charset declaration but it is not within the first 1024 bytes (WHATWG §4.2.5.5).`,
                filePath: rp,
                suggestion: 'Move <meta charset="utf-8"> to within the first 1024 bytes of the document.',
            });
        }
        // -- 5. title element (§4.2.1-4.2.2) — exclude SVG <title> ---
        const titles = $("title").filter((_, el) => !$(el).closest("svg").length);
        const titlesInHead = $("head title").filter((_, el) => !$(el).closest("svg").length);
        const titlesOutsideHead = titles.length - titlesInHead.length;
        if (titles.length === 0) {
            issues.push({
                id: `title-missing-${rp}`,
                severity: "critical",
                title: "Missing <title> element",
                description: `${rp} has no <title> element.`,
                filePath: rp,
                suggestion: "Add a descriptive <title> within <head>.",
            });
        }
        else if (titles.length > 1) {
            issues.push({
                id: `title-multiple-${rp}`,
                severity: "critical",
                title: `Multiple <title> elements (${titles.length})`,
                description: `${rp} has ${titles.length} <title> elements. There must be exactly one.`,
                filePath: rp,
                suggestion: "Keep exactly one <title> element in <head>.",
            });
        }
        else if (!titles.text().trim()) {
            issues.push({
                id: `title-empty-${rp}`,
                severity: "critical",
                title: "Empty <title> element",
                description: `${rp} has a <title> element but it contains no text.`,
                filePath: rp,
                suggestion: "Add descriptive text to the <title> element.",
            });
        }
        if (titlesOutsideHead > 0) {
            issues.push({
                id: `title-outside-head-${rp}`,
                severity: "critical",
                title: "<title> element outside <head>",
                description: `${rp} has <title> element(s) outside of <head>.`,
                filePath: rp,
                suggestion: "Move all <title> elements into <head>.",
            });
        }
        // -- 6. viewport meta --
        const viewportContent = $('meta[name="viewport"]').attr("content");
        if (!viewportContent) {
            issues.push({
                id: `viewport-missing-${rp}`,
                severity: "high",
                title: "Missing viewport meta tag",
                description: `${rp} has no viewport meta tag.`,
                filePath: rp,
                suggestion: 'Add <meta name="viewport" content="width=device-width, initial-scale=1">.',
            });
        }
        else {
            const vp = viewportContent.toLowerCase();
            if (vp.includes("user-scalable=no") ||
                vp.includes("maximum-scale=1.0") ||
                vp.includes("maximum-scale=1,")) {
                issues.push({
                    id: `viewport-wcag-${rp}`,
                    severity: "high",
                    title: "Viewport prevents zooming (WCAG 1.4.4 violation)",
                    description: `${rp} viewport has user-scalable=no or maximum-scale=1.0 which disables zooming.`,
                    filePath: rp,
                    suggestion: 'Remove user-scalable=no and maximum-scale=1.0; use <meta name="viewport" content="width=device-width, initial-scale=1">.',
                });
            }
        }
        // -- 8. Canonical link (skip noindex pages) --
        const robotsMeta = $('meta[name="robots"]').attr("content") || "";
        if (!/noindex/i.test(robotsMeta)) {
            const canonical = $('link[rel="canonical"]').attr("href");
            if (!canonical) {
                issues.push({
                    id: `canonical-missing-${rp}`,
                    severity: "high",
                    title: "Missing canonical link",
                    description: `${rp} has no <link rel="canonical">.`,
                    filePath: rp,
                    suggestion: 'Add <link rel="canonical" href="https://example.com/page">.',
                });
            }
        }
        // -- 9. Duplicate IDs (WHATWG §3.2.8) --
        const ids = new Map();
        $("[id]").each((_i, el) => {
            const id = $(el).attr("id");
            if (!ids.has(id))
                ids.set(id, []);
            ids.get(id).push(_i);
        });
        for (const [id, occurrences] of ids) {
            if (occurrences.length > 1) {
                issues.push({
                    id: `duplicate-id-${rp}-${id}`,
                    severity: "medium",
                    title: `Duplicate ID: "${id}"`,
                    description: `ID "${id}" appears ${occurrences.length} times in ${rp}.`,
                    filePath: rp,
                    suggestion: "HTML IDs must be unique per the WHATWG specification (§3.2.8).",
                });
            }
        }
        // -- 11. Void elements --
        const voidTagRegex = new RegExp(`<(${Array.from(voidElements).join("|")})([^>]*)>([\\s\\S]*?)<\\/\\1>`, "gi");
        let voidMatch;
        while ((voidMatch = voidTagRegex.exec(content)) !== null) {
            const tagName = voidMatch[1].toLowerCase();
            const innerContent = voidMatch[3].trim();
            const desc = innerContent
                ? `Void element <${tagName}> has content: "${innerContent.slice(0, 50)}".`
                : `Void element <${tagName}> has a closing </${tagName}> tag.`;
            issues.push({
                id: `void-element-${rp}-${tagName}-${voidMatch.index}`,
                severity: "medium",
                title: `Void element <${tagName}> has closing tag or content`,
                description: `${rp}: ${desc}`,
                filePath: rp,
                suggestion: `Void elements must not have end tags or contents. Use <${tagName}> without </${tagName}>.`,
            });
        }
        // -- 12. Nesting rules --
        $("ul, ol").each((_i, el) => {
            const tagName = el.tagName.toLowerCase();
            $(el)
                .children()
                .each((_ci, child) => {
                if (child.type === "tag") {
                    const childTag = child.tagName.toLowerCase();
                    if (childTag !== "li") {
                        issues.push({
                            id: `nesting-${tagName}-${rp}-${_i}`,
                            severity: "medium",
                            title: `Invalid child in <${tagName}>`,
                            description: `${rp}: <${tagName}> contains <${childTag}> instead of <li>.`,
                            filePath: rp,
                            suggestion: `<${tagName}> should only contain <li> elements as direct children.`,
                        });
                    }
                }
            });
        });
        $("dl").each((_i, el) => {
            $(el)
                .children()
                .each((_ci, child) => {
                if (child.type === "tag") {
                    const childTag = child.tagName.toLowerCase();
                    if (childTag !== "dt" && childTag !== "dd") {
                        issues.push({
                            id: `nesting-dl-${rp}-${_i}`,
                            severity: "medium",
                            title: "Invalid child in <dl>",
                            description: `${rp}: <dl> contains <${childTag}> instead of <dt> or <dd>.`,
                            filePath: rp,
                            suggestion: "<dl> should only contain <dt> and <dd> elements as direct children.",
                        });
                    }
                }
            });
        });
        $("p").each((_i, el) => {
            $(el)
                .children()
                .each((_ci, child) => {
                if (child.type === "tag") {
                    const childTag = child.tagName.toLowerCase();
                    if (!phrasingContent.has(childTag)) {
                        issues.push({
                            id: `nesting-p-${rp}-${_i}`,
                            severity: "medium",
                            title: "Non-phrasing content in <p>",
                            description: `${rp}: <p> contains <${childTag}> which is not phrasing content.`,
                            filePath: rp,
                            suggestion: "The <p> element should only contain phrasing content (inline elements and text).",
                        });
                    }
                }
            });
        });
        $("form form").each((_i, el) => {
            issues.push({
                id: `nesting-form-${rp}-${_i}`,
                severity: "medium",
                title: "Nested <form> element",
                description: `${rp}: A <form> is nested inside another <form>.`,
                filePath: rp,
                suggestion: "Remove the nested <form> element.",
            });
        });
        // -- 13. Obsolete elements --
        const obsoleteSelector = Array.from(obsoleteElements).join(",");
        $(obsoleteSelector).each((_i, el) => {
            const tagName = el.tagName.toLowerCase();
            issues.push({
                id: `obsolete-${tagName}-${rp}-${_i}`,
                severity: "low",
                title: `Obsolete element: <${tagName}>`,
                description: `${rp} uses the obsolete <${tagName}> element.`,
                filePath: rp,
                suggestion: `Replace <${tagName}> with modern CSS or HTML equivalents.`,
            });
        });
        // -- 14. Empty links/buttons --
        $("a").each((_i, el) => {
            const $el = $(el);
            const href = $el.attr("href");
            if ((!href || href === "#" || href === "") && !$el.text().trim()) {
                issues.push({
                    id: `empty-link-${rp}-${_i}`,
                    severity: "medium",
                    title: "Empty <a> element",
                    description: `Link #${_i + 1} in ${rp} has no href and no text content.`,
                    filePath: rp,
                    suggestion: "Add an href attribute and/or text content, or remove the element.",
                });
            }
        });
        $("button").each((_i, el) => {
            const $el = $(el);
            if (!$el.text().trim() && !$el.attr("aria-label") && !$el.attr("aria-labelledby")) {
                issues.push({
                    id: `empty-btn-${rp}-${_i}`,
                    severity: "medium",
                    title: "Empty <button> element",
                    description: `Button #${_i + 1} in ${rp} has no text content or aria-label.`,
                    filePath: rp,
                    suggestion: "Add text content or an aria-label attribute.",
                });
            }
        });
        // -- 16. meta description --
        const metaDesc = $('meta[name="description"]').attr("content");
        if (!metaDesc || !metaDesc.trim()) {
            issues.push({
                id: `metadesc-missing-${rp}`,
                severity: "high",
                title: "Missing meta description",
                description: `${rp} has no meta description.`,
                filePath: rp,
                suggestion: 'Add <meta name="description" content="A concise description of the page.">.',
            });
        }
    }
    const score = calculateModuleScore(issues);
    const criticalCount = issues.filter((i) => i.severity === "critical").length;
    const highCount = issues.filter((i) => i.severity === "high").length;
    const status = criticalCount > 0 ? "fail" : highCount > 0 ? "warning" : issues.length > 0 ? "warning" : "pass";
    return {
        moduleId: "01-page-existence",
        moduleName: "Page Existence & HTML Structure",
        status,
        score,
        issues,
        summary: `${issues.length} issue${issues.length !== 1 ? "s" : ""} found across ${htmlFiles.length} page${htmlFiles.length !== 1 ? "s" : ""}`,
    };
}
//# sourceMappingURL=index.js.map
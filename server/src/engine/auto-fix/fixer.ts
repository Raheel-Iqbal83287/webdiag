import fs from "fs";
import path from "path";
import crypto from "crypto";
import * as cheerio from "cheerio";
import type { AuditIssue, CrawledFile } from "../../types.js";
import { loadHtml } from "../../utils/html.js";

function escapeAttr(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function hasTagIn(content: string, tag: string, attr?: string, val?: string): boolean {
  if (attr && val) {
    const re = new RegExp(`<${tag}[^>]*\\s${attr}\\s*=\\s*["']${val.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`, "i");
    return re.test(content);
  }
  return new RegExp(`<${tag}[\\s>]`, "i").test(content);
}

function insertAfterTitle(content: string, tag: string): string {
  return content.replace("</title>", tag + "</title>");
}

export interface FixResult {
  filePath: string;
  issueId: string;
  success: boolean;
  description: string;
  diff?: string;
  error?: string;
}

export interface AutoFixOptions {
  dryRun?: boolean;
  backupDir?: string;
}

// SRI hash cache: fetched URL → integrity value (e.g. "sha384-abc123...")
const sriHashCache = new Map<string, string>();

const EXTERNAL_URL_RE = /^(https?:)?\/\//i;

export async function precomputeSriHashes(files: CrawledFile[]): Promise<void> {
  sriHashCache.clear();
  const urls = new Set<string>();
  for (const file of files) {
    if (file.type !== "html") continue;
    try {
      const content = fs.readFileSync(file.path, "utf-8");
      const $ = loadHtml(content);
      $('script[src], link[rel="stylesheet"][href]').each((_i, el) => {
        const src = $(el).attr("src") || $(el).attr("href") || "";
        if (EXTERNAL_URL_RE.test(src) && !$(el).attr("integrity")) {
          urls.add(src.startsWith("//") ? "https:" + src : src);
        }
      });
    } catch { /* skip unreadable files */ }
  }
  if (urls.size === 0) return;
  const results = await Promise.allSettled(
    Array.from(urls).map(async (url) => {
      const response = await fetch(url, { signal: AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined });
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
      const buf = Buffer.from(await response.arrayBuffer());
      const hash = crypto.createHash("sha384").update(buf).digest("base64");
      return { url, integrity: `sha384-${hash}` };
    })
  );
  for (const r of results) {
    if (r.status === "fulfilled") sriHashCache.set(r.value.url, r.value.integrity);
  }
}

export function generateDiff(original: string, updated: string, filePath: string): string {
  const origLines = original.split("\n");
  const newLines = updated.split("\n");
  const lines: string[] = [];
  lines.push(`--- a/${filePath}`);
  lines.push(`+++ b/${filePath}`);

  let offset = 0;
  for (let i = 0; i < Math.max(origLines.length, newLines.length); i++) {
    const oldLine = origLines[i + offset];
    const newLine = newLines[i];
    if (oldLine !== newLine) {
      if (oldLine !== undefined) lines.push(`-${oldLine}`);
      if (newLine !== undefined) lines.push(`+${newLine}`);
    } else {
      if (oldLine !== undefined) lines.push(` ${oldLine}`);
    }
  }
  return lines.join("\n");
}

export function backupFile(filePath: string, backupDir: string): string | null {
  try {
    const baseDir = path.join(backupDir, path.dirname(filePath));
    fs.mkdirSync(baseDir, { recursive: true });
    const ts = Date.now();
    const backupName = `${path.basename(filePath)}.${ts}.bak`;
    const backupPath = path.join(baseDir, backupName);
    fs.copyFileSync(filePath, backupPath);
    return backupPath;
  } catch {
    return null;
  }
}

export function applyFix(filePath: string, content: string): boolean {
  try {
    fs.writeFileSync(filePath, content, "utf-8");
    return true;
  } catch {
    return false;
  }
}

// --- Fix implementations ---

export function fixDoctype(filePath: string, content: string): string | null {
  const cleaned = content
    .replace(/^\uFEFF/, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .trimStart();
  if (cleaned.toLowerCase().startsWith("<!doctype html>")) return null;
  return "<!DOCTYPE html>\n" + content.trimStart();
}

export function fixHtmlLang(filePath: string, content: string): string | null {
  const $ = loadHtml(content);
  const html = $("html");
  const lang = html.attr("lang");
  if (!lang) {
    html.attr("lang", "en");
    return $.html();
  }
  const bcp47Regex = /^[a-zA-Z]{2,8}(-[a-zA-Z0-9]{1,8})*$/;
  if (!bcp47Regex.test(lang)) {
    html.attr("lang", "en");
    return $.html();
  }
  return null;
}

export function fixMetaDescription(filePath: string, content: string): string | null {
  const titleMatch = content.match(/<title[^>]*>([^<]*)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : "Page";
  const descContent = `${escapeAttr(title)} - Website description`;
  if (hasTagIn(content, "meta", "name", "description")) {
    const $ = loadHtml(content);
    const existing = $('meta[name="description"]');
    const current = (existing.attr("content") || "").trim();
    if (current.length >= 50) return null;
    existing.attr("content", descContent);
    return $.html();
  }
  return insertAfterTitle(content, `<meta name="description" content="${descContent}">`);
}

export function fixViewportMeta(filePath: string, content: string): string | null {
  if (hasTagIn(content, "meta", "name", "viewport")) return null;
  return insertAfterTitle(content, '<meta name="viewport" content="width=device-width, initial-scale=1.0">');
}

export function fixCanonical(filePath: string, content: string, relativePath: string): string | null {
  if (hasTagIn(content, "link", "rel", "canonical")) return null;
  const pageName = relativePath.replace(/\.html?$/, "");
  return insertAfterTitle(content, `<link rel="canonical" href="https://example.com/${escapeAttr(pageName)}">`);
}

export function fixMissingH1(filePath: string, content: string): string | null {
  const $ = loadHtml(content);
  if ($("h1").length > 0) return null;
  const title = $("title").text().trim() || "Page Title";
  // Find first h2 or main content area
  const firstH2 = $("h2").first();
  if (firstH2.length > 0) {
    firstH2.before(`<h1>${title}</h1>`);
  } else {
    $("main").prepend(`<h1>${title}</h1>`);
  }
  return $.html();
}

export function fixImageAlt(filePath: string, content: string): string | null {
  const $ = loadHtml(content);
  let changed = false;
  $("img:not([alt])").each((_i, el) => {
    const src = $(el).attr("src") || "";
    const fileName = path.basename(src).replace(/[.-]/g, " ");
    const alt = fileName.replace(/\.[^.]+$/, "").trim() || "image";
    $(el).attr("alt", alt);
    changed = true;
  });
  return changed ? $.html() : null;
}

export function fixImageFilenameAlt(filePath: string, content: string): string | null {
  const $ = loadHtml(content);
  let changed = false;
  $("img[alt]").each((_i, el) => {
    const alt = ($(el).attr("alt") || "").trim();
    if (/\.(jpe?g|png|gif|svg|webp|bmp|ico)$/i.test(alt)) {
      const src = $(el).attr("src") || "";
      const fileName = path.basename(src).replace(/[.-]/g, " ");
      const newAlt = fileName.replace(/\.[^.]+$/, "").trim() || "image";
      $(el).attr("alt", newAlt);
      changed = true;
    }
  });
  return changed ? $.html() : null;
}

export function fixSkipNav(filePath: string, content: string): string | null {
  const $ = loadHtml(content);
  const hasSkip = $('a[href="#main"], a[href="#content"], a[class*="skip"]').length > 0;
  if (hasSkip) return null;
  $("body").prepend('<a href="#main" class="skip-link" style="position:absolute;left:-9999px;top:0;z-index:9999;background:#fff;padding:8px 16px;">Skip to content</a>');
  return $.html();
}

export function fixRobotsMeta(filePath: string, content: string): string | null {
  if (hasTagIn(content, "meta", "name", "robots")) return null;
  return insertAfterTitle(content, '<meta name="robots" content="index, follow">');
}

export function fixStaleCopyright(filePath: string, content: string): string | null {
  const currentYear = new Date().getFullYear();
  const updated = content.replace(/(©|copyright)\s*(\d{4})/gi, (match, symbol, year) => {
    const y = parseInt(year, 10);
    if (y < currentYear - 1) return `${symbol} ${currentYear}`;
    return match;
  });
  return updated !== content ? updated : null;
}

export function fixBoxSizingCss(filePath: string, content: string): string | null {
  if (/\b(?:box-sizing|box_sizing)\s*:\s*border-box/i.test(content)) return null;
  return "*, *::before, *::after {\n  box-sizing: border-box;\n}\n\n" + content;
}

export function fixFontDisplay(filePath: string, content: string): string | null {
  const updated = content.replace(/@font-face\s*\{[^}]*\}/gi, (match) => {
    if (/font-display\s*:/i.test(match)) return match;
    return match.replace(/\}/, "  font-display: swap;\n}");
  });
  return updated !== content ? updated : null;
}

export function fixRenderBlockingCss(filePath: string, content: string, _relativePath?: string, _issueId?: string): string | null {
  const $ = loadHtml(content);
  let changed = false;
  $('link[rel="stylesheet"]').each((_i, el) => {
    const $el = $(el);
    if ($el.attr("media") === undefined) {
      $el.attr("media", "screen");
      changed = true;
    }
  });
  return changed ? $.html() : null;
}

export function fixMissingPreconnect(filePath: string, content: string, relativePath?: string, issueId?: string): string | null {
  const rp = relativePath || "";
  let domain = "";
  if (issueId) {
    const parts = issueId.split(rp + "-");
    if (parts.length > 1) domain = parts.slice(1).join(rp + "-");
  }
  if (!domain) return null;
  const existingRe = new RegExp(`<link[^>]*rel\\s*=\\s*["']preconnect["'][^>]*href\\s*=\\s*["'][^"']*${domain.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i");
  if (existingRe.test(content)) return null;
  return insertAfterTitle(content, `<link rel="preconnect" href="https://${domain}">`);
}

export function fixMissingFetchPriority(filePath: string, content: string): string | null {
  const $ = loadHtml(content);
  let changed = false;
  $("img[src]").each((_i, el) => {
    const $el = $(el);
    if ($el.attr("fetchpriority") !== "high" && _i === 0) {
      $el.attr("fetchpriority", "high");
      changed = true;
    }
  });
  return changed ? $.html() : null;
}

function insertStyleInHead(content: string, css: string): string {
  if (/<html/i.test(content) && /<head>/i.test(content)) {
    return content.replace(/<\/head>/i, `<style>\n${css}</style>\n</head>`);
  }
  return content + "\n\n" + css;
}

export function fixFocusStyles(filePath: string, content: string): string | null {
  if (/:focus\b/.test(content) || /:focus-visible\b/.test(content)) return null;
  const css = "/* Focus indicator for keyboard navigation */\n:focus-visible {\n  outline: 2px solid #4f46e5;\n  outline-offset: 2px;\n}\n";
  return insertStyleInHead(content, css);
}

export function fixReducedMotion(filePath: string, content: string): string | null {
  if (/prefers-reduced-motion/i.test(content)) return null;
  const css = "/* Respect user motion preferences */\n@media (prefers-reduced-motion: reduce) {\n  *, *::before, *::after {\n    animation-duration: 0.01ms !important;\n    animation-iteration-count: 1 !important;\n    transition-duration: 0.01ms !important;\n  }\n}\n";
  return insertStyleInHead(content, css);
}

export function fixIframeDimensions(filePath: string, content: string, _relativePath?: string, _issueId?: string): string | null {
  const $ = loadHtml(content);
  let changed = false;
  $("iframe").each((_i, el) => {
    const $el = $(el);
    if ($el.attr("width") === undefined) { $el.attr("width", "560"); changed = true; }
    if ($el.attr("height") === undefined) { $el.attr("height", "315"); changed = true; }
  });
  return changed ? $.html() : null;
}

// --- New auto-fix implementations ---

const SRI_EVENT_ATTRS = ["onclick","onload","onerror","onmouseover","onmouseout","onsubmit","onchange","onfocus","onblur","onkeydown","onkeyup","onkeypress","onscroll","onresize","onunload","onbeforeunload","oninput","oninvalid","onreset","onsearch","onselect","ontouchcancel","ontouchend","ontouchmove","ontouchstart","onpointerdown","onpointerup","onpointermove","ontoggle"];

export function fixMissingSRI(filePath: string, content: string): string | null {
  const $ = loadHtml(content);
  let changed = false;
  $('script[src], link[rel="stylesheet"][href]').each((_i, el) => {
    const $el = $(el);
    const src = $el.attr("src") || $el.attr("href") || "";
    if (EXTERNAL_URL_RE.test(src)) {
      const normalized = src.startsWith("//") ? "https:" + src : src;
      const integrity = sriHashCache.get(normalized);
      if (integrity && !$el.attr("integrity")) {
        $el.attr("integrity", integrity);
        $el.attr("crossorigin", "anonymous");
        changed = true;
      } else if (!integrity && !$el.attr("crossorigin")) {
        $el.attr("crossorigin", "anonymous");
        changed = true;
      }
    }
  });
  return changed ? $.html() : null;
}

export function fixCspUnsafeInline(filePath: string, content: string): string | null {
  const $ = loadHtml(content);
  let changed = false;
  $('meta[http-equiv="Content-Security-Policy"], meta[http-equiv="content-security-policy"]').each((_i, el) => {
    const $el = $(el);
    const csp = $el.attr("content") || "";
    const updated = csp.replace(/'unsafe-inline'/gi, "'strict-dynamic'");
    if (updated !== csp) {
      $el.attr("content", updated);
      changed = true;
    }
  });
  return changed ? $.html() : null;
}

export function fixCspUnsafeEval(filePath: string, content: string): string | null {
  const $ = loadHtml(content);
  let changed = false;
  $('meta[http-equiv="Content-Security-Policy"], meta[http-equiv="content-security-policy"]').each((_i, el) => {
    const $el = $(el);
    const csp = $el.attr("content") || "";
    const updated = csp.replace(/'unsafe-eval'/gi, "");
    if (updated !== csp) {
      $el.attr("content", updated.replace(/\s{2,}/g, " ").trim());
      changed = true;
    }
  });
  return changed ? $.html() : null;
}

export function fixCspMissingDirective(filePath: string, content: string, _relativePath?: string, issueId?: string): string | null {
  if (!issueId) return null;
  const directive = issueId.replace("csp-missing-", "").split("-")[0];
  let directiveValue = "";
  if (directive === "base") directiveValue = "base-uri 'self'";
  else if (directive === "object") directiveValue = "object-src 'none'";
  else if (directive === "form") directiveValue = "form-action 'self'";
  else if (directive === "script") directiveValue = "script-src 'self'";
  else return null;
  const $ = loadHtml(content);
  let changed = false;
  $('meta[http-equiv="Content-Security-Policy"], meta[http-equiv="content-security-policy"]').each((_i, el) => {
    const $el = $(el);
    const csp = $el.attr("content") || "";
    if (!csp.includes(directiveValue.split(" ")[0])) {
      $el.attr("content", (csp + "; " + directiveValue).trim());
      changed = true;
    }
  });
  return changed ? $.html() : null;
}

export function fixNoCsp(filePath: string, content: string): string | null {
  if (hasTagIn(content, "meta", "http-equiv", "Content-Security-Policy")) return null;
  if (hasTagIn(content, "meta", "http-equiv", "content-security-policy")) return null;
  return insertAfterTitle(content, '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'; object-src \'none\'; base-uri \'self\'; form-action \'self\'">');
}

export function fixMissingNosniff(filePath: string, content: string): string | null {
  if (hasTagIn(content, "meta", "http-equiv", "X-Content-Type-Options")) return null;
  return insertAfterTitle(content, '<meta http-equiv="X-Content-Type-Options" content="nosniff">');
}

export function fixMissingHsts(filePath: string, content: string): string | null {
  if (hasTagIn(content, "meta", "http-equiv", "Strict-Transport-Security")) return null;
  return insertAfterTitle(content, '<meta http-equiv="Strict-Transport-Security" content="max-age=31536000; includeSubDomains">');
}

export function fixClickjackingProtection(filePath: string, content: string): string | null {
  const hasCsp = hasTagIn(content, "meta", "http-equiv", "Content-Security-Policy");
  if (hasCsp) {
    const $ = loadHtml(content);
    const cspMeta = $('meta[http-equiv="Content-Security-Policy"], meta[http-equiv="content-security-policy"]');
    const csp = cspMeta.attr("content") || "";
    if (!/frame-ancestors/i.test(csp)) {
      cspMeta.attr("content", (csp + "; frame-ancestors 'self'").trim());
      return $.html();
    }
  }
  if (hasTagIn(content, "meta", "http-equiv", "X-Frame-Options")) return null;
  return insertAfterTitle(content, '<meta http-equiv="X-Frame-Options" content="SAMEORIGIN">');
}

export function fixInlineEventHandler(filePath: string, content: string): string | null {
  const $ = loadHtml(content);
  let changed = false;
  for (const attr of SRI_EVENT_ATTRS) {
    $(`[${attr}]`).each((_i, el) => {
      const $el = $(el);
      if ($el.attr(attr) !== undefined) {
        $el.removeAttr(attr);
        changed = true;
      }
    });
  }
  return changed ? $.html() : null;
}

export function fixMissingMain(filePath: string, content: string): string | null {
  const $ = loadHtml(content);
  if ($("main").length > 0 || $('[role="main"]').length > 0) return null;
  const body = $("body");
  if (body.length === 0) return null;
  const children = body.contents();
  if (children.length === 0) return null;
  body.html(`<main>${body.html()}</main>`);
  return $.html();
}

export function fixMissingTitle(filePath: string, content: string): string | null {
  const $ = loadHtml(content);
  const titleText = $("title").text().trim();
  if ($("title").length > 0 && titleText) return null;
  const h1 = $("h1").first().text().trim() || "Page";
  if ($("title").length > 0) {
    $("title").text(h1);
  } else {
    $("head").append(`<title>${escapeAttr(h1)}</title>`);
  }
  return $.html();
}

export function fixFieldNoLabel(filePath: string, content: string): string | null {
  const $ = loadHtml(content);
  let changed = false;
  $("input, textarea, select").each((_i, el) => {
    const $el = $(el);
    const type = $el.attr("type");
    if (type === "hidden" || type === "submit" || type === "button" || type === "reset") return;
    const id = $el.attr("id");
    const hasLabel = id ? $(`label[for="${id}"]`).length > 0 : false;
    const hasAriaLabel = !!$el.attr("aria-label") || !!$el.attr("aria-labelledby");
    const hasWrapperLabel = $el.closest("label").length > 0;
    if (!hasLabel && !hasAriaLabel && !hasWrapperLabel) {
      const name = $el.attr("name") || $el.attr("id") || "field";
      $el.attr("aria-label", name);
      changed = true;
    }
  });
  return changed ? $.html() : null;
}

export function fixButtonNoName(filePath: string, content: string): string | null {
  const $ = loadHtml(content);
  let changed = false;
  $("button").each((_i, el) => {
    const $el = $(el);
    const text = $el.text().trim();
    const ariaLabel = $el.attr("aria-label") || "";
    const ariaLabelledby = $el.attr("aria-labelledby") || "";
    if (!text && !ariaLabel && !ariaLabelledby) {
      $el.text("Button");
      changed = true;
    }
  });
  return changed ? $.html() : null;
}

export function fixIframeTitle(filePath: string, content: string): string | null {
  const $ = loadHtml(content);
  let changed = false;
  $("iframe").each((_i, el) => {
    const $el = $(el);
    const title = $el.attr("title") || "";
    const ariaLabel = $el.attr("aria-label") || "";
    if (!title.trim() && !ariaLabel.trim()) {
      $el.attr("title", "Embedded content");
      changed = true;
    }
  });
  return changed ? $.html() : null;
}

export function fixLinkNoText(filePath: string, content: string): string | null {
  const $ = loadHtml(content);
  let changed = false;
  $("a[href]").each((_i, el) => {
    const $el = $(el);
    const text = $el.text().trim();
    const ariaLabel = $el.attr("aria-label") || "";
    const ariaLabelledby = $el.attr("aria-labelledby") || "";
    if (!text && !ariaLabel && !ariaLabelledby) {
      const href = $el.attr("href") || "";
      const name = href.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "") || "link";
      $el.attr("aria-label", name);
      changed = true;
    }
  });
  return changed ? $.html() : null;
}

export function fixImageDimensions(filePath: string, content: string): string | null {
  const $ = loadHtml(content);
  let changed = false;
  $("img[src]").each((_i, el) => {
    const $el = $(el);
    if ($el.attr("width") === undefined || $el.attr("height") === undefined) {
      if ($el.attr("width") === undefined) $el.attr("width", "400");
      if ($el.attr("height") === undefined) $el.attr("height", "300");
      changed = true;
    }
  });
  return changed ? $.html() : null;
}

export function fixRenderBlockingJs(filePath: string, content: string): string | null {
  const $ = loadHtml(content);
  let changed = false;
  $("head script[src]").each((_i, el) => {
    const $el = $(el);
    if ($el.attr("async") === undefined && $el.attr("defer") === undefined) {
      $el.attr("defer", "");
      changed = true;
    }
  });
  return changed ? $.html() : null;
}

export function fixBodySyncScript(filePath: string, content: string): string | null {
  const $ = loadHtml(content);
  let changed = false;
  $("body script[src]").each((_i, el) => {
    const $el = $(el);
    if ($el.attr("async") === undefined && $el.attr("defer") === undefined) {
      $el.attr("defer", "");
      changed = true;
    }
  });
  return changed ? $.html() : null;
}

export function fixViewportZoomLock(filePath: string, content: string): string | null {
  const $ = loadHtml(content);
  let changed = false;
  $('meta[name="viewport"]').each((_i, el) => {
    const $el = $(el);
    const contentVal = $el.attr("content") || "";
    const updated = contentVal
      .replace(/user-scalable\s*=\s*no/gi, "user-scalable=yes")
      .replace(/maximum-scale\s*=\s*1(\.0)?/gi, "maximum-scale=5.0");
    if (updated !== contentVal) {
      $el.attr("content", updated);
      changed = true;
    }
  });
  return changed ? $.html() : null;
}

export function fixJavaScriptUri(filePath: string, content: string): string | null {
  const $ = loadHtml(content);
  let changed = false;
  $('a[href^="javascript:"], area[href^="javascript:"], *[href^="javascript:"]').each((_i, el) => {
    const $el = $(el);
    if ($el.attr("href")?.toLowerCase().startsWith("javascript:")) {
      $el.attr("href", "#");
      $el.attr("data-js", "true");
      changed = true;
    }
  });
  return changed ? $.html() : null;
}

export function fixFormHttp(filePath: string, content: string): string | null {
  const $ = loadHtml(content);
  let changed = false;
  $('form[action^="http://"]').each((_i, el) => {
    const $el = $(el);
    const action = $el.attr("action") || "";
    $el.attr("action", action.replace(/^http:\/\//, "https://"));
    changed = true;
  });
  $("form").each((_i, el) => {
    const $el = $(el);
    const action = $el.attr("action") || "";
    if (!action || action.trim() === "") {
      $el.attr("action", "/submit");
      changed = true;
    }
  });
  return changed ? $.html() : null;
}

export function fixIframeSandbox(filePath: string, content: string): string | null {
  const $ = loadHtml(content);
  let changed = false;
  $("iframe").each((_i, el) => {
    const $el = $(el);
    if ($el.attr("sandbox") === undefined) {
      $el.attr("sandbox", "allow-scripts allow-same-origin");
      changed = true;
    }
  });
  return changed ? $.html() : null;
}

const AUTOCOMPLETE_MAP: Record<string, string> = {
  name: "name",
  fullname: "name",
  "user-name": "name",
  username: "username",
  email: "email",
  mail: "email",
  "e-mail": "email",
  phone: "tel",
  tel: "tel",
  telephone: "tel",
  "phone-number": "tel",
  "phone-number-input": "tel",
  address: "street-address",
  street: "street-address",
  "street-address": "street-address",
  city: "address-level2",
  town: "address-level2",
  state: "address-level1",
  province: "address-level1",
  region: "address-level1",
  zip: "postal-code",
  "zip-code": "postal-code",
  postal: "postal-code",
  "postal-code": "postal-code",
  country: "country-name",
  organization: "organization",
  company: "organization",
  org: "organization",
  subject: "subject",
  url: "url",
  website: "url",
  birthday: "bday",
  "birth-day": "bday",
  "birth-date": "bday",
  search: "search",
  password: "current-password",
  "new-password": "new-password",
  confirm: "new-password",
  "confirm-password": "new-password",
};

export function fixInvalidAutocomplete(filePath: string, content: string): string | null {
  const $ = loadHtml(content);
  let changed = false;
  $("input, select, textarea").each((_i, el) => {
    const $el = $(el);
    const type = ($el.attr("type") || "text").toLowerCase();
    if (type === "hidden" || type === "submit" || type === "button" || type === "reset") return;

    const auto = $el.attr("autocomplete");
    if (auto) {
      if (auto !== "on" && auto !== "off") {
        $el.attr("autocomplete", "off");
        changed = true;
      }
    } else {
      // No autocomplete attribute — guess from name/id
      const name = ($el.attr("name") || $el.attr("id") || "").toLowerCase().replace(/[^a-z0-9_-]/g, "");
      if (AUTOCOMPLETE_MAP[name]) {
        $el.attr("autocomplete", AUTOCOMPLETE_MAP[name]);
        changed = true;
      } else if (name.includes("name")) {
        $el.attr("autocomplete", "name");
        changed = true;
      } else if (name.includes("email") || name.includes("mail")) {
        $el.attr("autocomplete", "email");
        changed = true;
      } else if (name.includes("phone") || name.includes("tel")) {
        $el.attr("autocomplete", "tel");
        changed = true;
      } else if (name.includes("address") || name.includes("street")) {
        $el.attr("autocomplete", "street-address");
        changed = true;
      } else if (name.includes("city") || name.includes("town")) {
        $el.attr("autocomplete", "address-level2");
        changed = true;
      } else if (name.includes("state") || name.includes("province") || name.includes("region")) {
        $el.attr("autocomplete", "address-level1");
        changed = true;
      } else if (name.includes("zip") || name.includes("postal")) {
        $el.attr("autocomplete", "postal-code");
        changed = true;
      } else if (name.includes("country")) {
        $el.attr("autocomplete", "country-name");
        changed = true;
      } else if (type === "password" || name.includes("password")) {
        $el.attr("autocomplete", name.includes("new") || name.includes("confirm") ? "new-password" : "current-password");
        changed = true;
      } else if (name.includes("search")) {
        $el.attr("autocomplete", "search");
        changed = true;
      } else if (name.includes("url") || name.includes("website") || name.includes("site")) {
        $el.attr("autocomplete", "url");
        changed = true;
      } else if (name.includes("org") || name.includes("company")) {
        $el.attr("autocomplete", "organization");
        changed = true;
      } else if (type === "tel") {
        $el.attr("autocomplete", "tel");
        changed = true;
      } else if (type === "email") {
        $el.attr("autocomplete", "email");
        changed = true;
      } else if (type === "url") {
        $el.attr("autocomplete", "url");
        changed = true;
      }
    }
  });
  return changed ? $.html() : null;
}

export function fixVideoDimensions(filePath: string, content: string): string | null {
  const $ = loadHtml(content);
  let changed = false;
  $("video, audio, source, track").each((_i, el) => {
    const $el = $(el);
    const tag = el.tagName.toLowerCase();
    if (tag === "video" || tag === "audio") {
      if ($el.attr("width") === undefined && tag === "video") { $el.attr("width", "640"); changed = true; }
      if ($el.attr("height") === undefined && tag === "video") { $el.attr("height", "360"); changed = true; }
    }
    if ($el.attr("aria-label") === undefined && !$el.attr("aria-labelledby")) {
      $el.attr("aria-label", tag === "video" ? "Video content" : tag === "audio" ? "Audio content" : "Media source");
      changed = true;
    }
  });
  return changed ? $.html() : null;
}

// --- Third batch: remaining module 01, 10, 06 fixers ---

const VOID_ELEMENTS = new Set(["area","base","br","col","embed","hr","img","input","link","meta","param","source","track","wbr"]);

export function fixTitleOutsideHead(filePath: string, content: string): string | null {
  const $ = loadHtml(content);
  const allTitles = $("title");
  const headTitles = $("head title");

  // Collect titles outside <head>
  const outsideTexts: string[] = [];
  const toRemove: any[] = [];
  allTitles.each((_i, el) => {
    const $el = $(el);
    if ($el.parents("head").length === 0) {
      outsideTexts.push($el.text().trim());
      toRemove.push(el);
    }
  });

  if (outsideTexts.length > 0) {
    // Remove all titles outside head
    toRemove.forEach((el) => $(el).remove());
    const extra = outsideTexts.filter(Boolean).join(" ");
    if (headTitles.length === 0) {
      $("head").append(`<title>${escapeAttr(extra)}</title>`);
    } else if (extra) {
      const headText = headTitles.first().text().trim();
      if (!headText.includes(extra)) {
        headTitles.first().text(`${escapeAttr(headText)} — ${escapeAttr(extra)}`);
      }
    }
    return $.html();
  }

  // Deduplicate multiple titles in head
  if (headTitles.length > 1) {
    headTitles.slice(1).remove();
    return $.html();
  }
  return null;
}

export function fixSvgNoName(filePath: string, content: string): string | null {
  const $ = loadHtml(content);
  let changed = false;
  $("svg").each((_i, el) => {
    const $el = $(el);
    if (!$el.attr("aria-label") && !$el.attr("aria-labelledby") && !$el.find("title").text().trim() && $el.attr("aria-hidden") !== "true") {
      $el.attr("aria-label", "Graphic");
      changed = true;
    }
  });
  return changed ? $.html() : null;
}

export function fixEmptyHeading(filePath: string, content: string): string | null {
  const $ = loadHtml(content);
  let changed = false;
  $("h1, h2, h3, h4, h5, h6").each((_i, el) => {
    const $el = $(el);
    if (!$el.text().trim()) {
      $el.text($el.is("h1") ? "Page Title" : "Section");
      changed = true;
    }
  });
  return changed ? $.html() : null;
}

export function fixGenericLinkText(filePath: string, content: string): string | null {
  const genericTexts = ["click here", "read more", "more", "link", "this", "here", "learn more", "details"];
  const $ = loadHtml(content);
  let changed = false;
  $("a[href]").each((_i, el) => {
    const $el = $(el);
    const text = $el.text().trim().toLowerCase();
    if (genericTexts.includes(text) && !$el.attr("aria-label")) {
      const href = $el.attr("href") || "";
      const name = href.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "") || "link";
      $el.attr("aria-label", name);
      changed = true;
    }
  });
  return changed ? $.html() : null;
}

export function fixTitleLongShort(filePath: string, content: string): string | null {
  const $ = loadHtml(content);
  const titleEl = $("head title").first();
  if (titleEl.length === 0) return null;
  const text = titleEl.text().trim();
  if (text.length > 60) {
    titleEl.text(text.slice(0, 57) + "...");
    return $.html();
  }
  if (text.length < 30) {
    titleEl.text(text + " - " + "Website");
    return $.html();
  }
  return null;
}

export function fixJsonLd(filePath: string, content: string): string | null {
  const $ = loadHtml(content);
  if ($('script[type="application/ld+json"]').length > 0) return null;
  const title = $("head title").first().text().trim() || "Website";
  const jsonLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "WebSite",
    "name": title,
    "url": "https://example.com",
  });
  $("head").append(`\n<script type="application/ld+json">${jsonLd}</script>`);
  return $.html();
}

export function fixVoidElement(filePath: string, content: string): string | null {
  // Same regex as module 01: <tag attrs>content?</tag>
  const voidArr = Array.from(VOID_ELEMENTS);
  const re = new RegExp(`<(${voidArr.join("|")})([^>]*)>([\\s\\S]*?)<\\/\\1>`, "gi");
  const updated = content.replace(re, (_m, tag, attrs) => {
    return `<${tag}${attrs}>`;
  });
  return updated !== content ? updated : null;
}

const PHRASING_CONTENT = new Set([
  "a","abbr","area","audio","b","bdi","bdo","br","button","canvas",
  "cite","code","data","datalist","del","dfn","em","embed","i",
  "iframe","img","input","ins","kbd","label","link","map","mark",
  "math","meta","meter","noscript","object","output","picture",
  "progress","q","ruby","s","samp","script","select","slot",
  "small","span","strong","sub","sup","svg","template","textarea",
  "time","u","var","video","wbr",
]);

export function fixNesting(filePath: string, content: string): string | null {
  const $ = loadHtml(content);
  let changed = false;
  // Fix <ul>/<ol> children that aren't <li>
  $("ul, ol").each((_i, el) => {
    $(el).children().each((_ci, child: any) => {
      if (child.type === "tag" && (child as any).tagName !== "li") {
        $(child).wrap("<li>");
        changed = true;
      }
    });
  });
  // Fix <p> children that aren't phrasing content (same logic as module 01)
  $("p").each((_i, el) => {
    $(el).children().each((_ci, child: any) => {
      if (child.type === "tag") {
        const childTag = (child as any).tagName.toLowerCase();
        if (!PHRASING_CONTENT.has(childTag)) {
          $(child).unwrap("p");
          changed = true;
        }
      }
    });
  });
  // Fix nested <form> elements
  $("form form").each((_i, el) => {
    $(el).unwrap("form");
    changed = true;
  });
  return changed ? $.html() : null;
}

export function fixHeadingSkip(filePath: string, content: string): string | null {
  const $ = loadHtml(content);
  let changed = false;
  let currentLevel = 0;
  const toFix: { el: any; newTag: string }[] = [];
  $("h1, h2, h3, h4, h5, h6").each((_i, el) => {
    const tag = el.tagName.toLowerCase();
    const level = parseInt(tag[1]);
    if (currentLevel > 0 && level > currentLevel + 1) {
      toFix.push({ el, newTag: `h${currentLevel + 1}` });
      currentLevel = currentLevel + 1;
    } else {
      currentLevel = level;
    }
  });
  for (const { el, newTag } of toFix) {
    const tag = el.tagName.toLowerCase();
    const outer = $.html(el);
    const updated = outer.replace(`<${tag}`, `<${newTag}`).replace(`</${tag}>`, `</${newTag}>`);
    $(el).replaceWith(updated);
    changed = true;
  }
  return changed ? $.html() : null;
}

export function fixEmptyHref(filePath: string, content: string): string | null {
  const $ = loadHtml(content);
  let changed = false;
  $("a:not([href])").each((_i, el) => {
    const $el = $(el);
    if (!$el.attr("href")) {
      $el.attr("href", "#");
      $el.attr("role", "button");
      changed = true;
    }
  });
  return changed ? $.html() : null;
}

export function fixEmailDisclosure(filePath: string, content: string): string | null {
  // Remove emails from HTML comments
  let updated = content.replace(/<!--[\s\S]*?-->/g, (comment) => {
    const emailRe = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
    return comment.replace(emailRe, "[email removed]");
  });
  // Remove emails from visible text (but NOT inside href="mailto:")
  const emailRe = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
  let m;
  let result = "";
  let last = 0;
  while ((m = emailRe.exec(updated)) !== null) {
    const before = updated.slice(Math.max(0, m.index - 30), m.index);
    if (/href\s*=\s*["']mailto:$/i.test(before)) {
      // Skip emails inside href="mailto:" — they're legitimate
      continue;
    }
    result += updated.slice(last, m.index) + m[0].replace(/\./g, "[dot]").replace(/@/g, "[at]");
    last = m.index + m[0].length;
  }
  if (last > 0) {
    result += updated.slice(last);
    return result;
  }
  return updated !== content ? updated : null;
}

export function fixAuthorJsonLd(filePath: string, content: string): string | null {
  const $ = loadHtml(content);
  let hasAuthor = false;
  $('script[type="application/ld+json"]').each((_i, el) => {
    try {
      const data = JSON.parse($(el).text());
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (item["@type"] === "Person") hasAuthor = true;
        if (item["@graph"]) for (const g of item["@graph"]) if (g["@type"] === "Person") hasAuthor = true;
      }
    } catch { /* */ }
  });
  if (hasAuthor) return null;
  const authorLd = JSON.stringify({ "@context": "https://schema.org", "@type": "Person", name: "Site Author" }, null, 2);
  $("head").append(`\n<script type="application/ld+json">\n${authorLd}\n</script>`);
  return $.html();
}

export function fixTableOverflow(filePath: string, content: string): string | null {
  const $ = loadHtml(content);
  let changed = false;
  $("table").each((_i, el) => {
    const $el = $(el);
    const parent = $el.parent();
    if (!parent.is("div") || !(parent.attr("style") || "").includes("overflow")) {
      $el.wrap('<div style="overflow-x: auto; -webkit-overflow-scrolling: touch;"></div>');
      changed = true;
    }
  });
  return changed ? $.html() : null;
}

export function fixSelfClosing(filePath: string, content: string): string | null {
  const nonVoid = ["div","span","header","footer","nav","main","section","article","aside","a","button","p","li","ul","ol","table","tr","td","th","label","h1","h2","h3","h4","h5","h6","rect","circle","ellipse","line","path","polygon","polyline","text","g","svg","defs","clipPath","mask","linearGradient","radialGradient","stop","use","symbol","image","iframe","video","audio","canvas","figure","figcaption","details","summary","dialog","form","fieldset","legend","select","optgroup","option","textarea","output","progress","meter","blockquote","pre","code","kbd","samp","var","cite","abbr","address","del","ins","sub","sup","small","strong","em","b","i","u","s","mark","time","data","ruby","rt","rp","bdi","bdo","wbr"];
  const pattern = new RegExp(`<(${nonVoid.join("|")})([^>]*?)\\s*\\/\\s*>`, "gi");
  const updated = content.replace(pattern, (_m, tag, attrs) => {
    return `<${tag}${attrs}></${tag}>`;
  });
  return updated !== content ? updated : null;
}

// --- Non-HTML file fixers (sitemap, robots.txt, security.txt) ---

export function fixSitemapAddPage(files: CrawledFile[], issueId: string, backupDir: string): FixResult {
  const sitemapFile = files.find((f) => f.relativePath === "sitemap.xml");
  if (!sitemapFile) {
    return { filePath: "sitemap.xml", issueId, success: false, description: "sitemap.xml not found", error: "No sitemap.xml in project" };
  }

  const pageName = issueId.replace("page-not-in-sitemap-", "").replace(/_/g, ".");
  const absolutePath = sitemapFile.path;

  try {
    let content = fs.readFileSync(absolutePath, "utf-8");

    // Check if page URL already exists in sitemap
    if (content.includes(`>${pageName}<`) || content.includes(`>/${pageName}`)) {
      return { filePath: sitemapFile.relativePath, issueId, success: true, description: "Page already in sitemap" };
    }

    const backupPath = backupFile(absolutePath, backupDir);

    // Determine base URL from existing entries
    const locMatch = content.match(/<loc>([^<]+)<\/loc>/);
    const baseUrl = locMatch ? locMatch[1].replace(/\/[^/]*\.html$/, "/") : "https://example.com/";

    // Insert before </urlset>
    const entry = `  <url>\n    <loc>${baseUrl}${pageName}</loc>\n    <lastmod>${new Date().toISOString().slice(0, 10)}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.5</priority>\n  </url>\n`;
    const updated = content.replace("</urlset>", `${entry}</urlset>`);

    applyFix(absolutePath, updated);

    return {
      filePath: sitemapFile.relativePath,
      issueId,
      success: true,
      description: `Added ${pageName} to sitemap.xml${backupPath ? ` (backup: ${path.relative(process.cwd(), backupPath)})` : ""}`,
      diff: generateDiff(content, updated, sitemapFile.relativePath),
    };
  } catch (err) {
    return { filePath: sitemapFile.relativePath, issueId, success: false, description: "Error updating sitemap", error: err instanceof Error ? err.message : String(err) };
  }
}

export function fixRobotsTxtWildcard(files: CrawledFile[], issueId: string, backupDir: string): FixResult {
  const robotsFile = files.find((f) => f.relativePath === "robots.txt");
  if (!robotsFile) {
    return { filePath: "robots.txt", issueId, success: false, description: "robots.txt not found", error: "No robots.txt in project" };
  }

  const lineNumStr = issueId.replace("robots-wildcard-misuse-", "");
  const lineNum = parseInt(lineNumStr, 10);
  if (isNaN(lineNum)) {
    return { filePath: robotsFile.relativePath, issueId, success: false, description: "Invalid issue ID", error: `Cannot parse line number from ${issueId}` };
  }

  const absolutePath = robotsFile.path;

  try {
    let content = fs.readFileSync(absolutePath, "utf-8");
    const lines = content.split("\n");

    // Line numbers in issue ID are 1-based, array is 0-based
    const idx = lineNum - 1;
    if (idx < 0 || idx >= lines.length) {
      return { filePath: robotsFile.relativePath, issueId, success: false, description: "Line out of range", error: `Line ${lineNum} not in robots.txt (${lines.length} lines)` };
    }

    const line = lines[idx];
    const colonIdx = line.indexOf(":");
    if (colonIdx < 0) return { filePath: robotsFile.relativePath, issueId, success: false, description: "No colon on line", error: `Line ${lineNum} has no directive` };

    const directive = line.slice(0, colonIdx).trim().toLowerCase();
    const value = line.slice(colonIdx + 1).trim();

    // Only fix Allow/Disallow paths, not Sitemap URLs or Crawl-delay
    if (directive !== "allow" && directive !== "disallow") {
      return { filePath: robotsFile.relativePath, issueId, success: true, description: `Line ${lineNum} is a ${directive} directive, not a path rule — no change needed` };
    }

    // Remove regex characters from the path
    const cleaned = value.replace(/[.+?[\](){}\\|^]/g, "");
    if (cleaned === value) {
      return { filePath: robotsFile.relativePath, issueId, success: true, description: `Line ${lineNum} has no regex chars to clean` };
    }

    const backupPath = backupFile(absolutePath, backupDir);
    lines[idx] = `${directive}: ${cleaned}`;
    const updated = lines.join("\n");

    applyFix(absolutePath, updated);

    return {
      filePath: robotsFile.relativePath,
      issueId,
      success: true,
      description: `Cleaned regex chars from robots.txt line ${lineNum}${backupPath ? ` (backup: ${path.relative(process.cwd(), backupPath)})` : ""}`,
      diff: generateDiff(content, updated, robotsFile.relativePath),
    };
  } catch (err) {
    return { filePath: robotsFile.relativePath, issueId, success: false, description: "Error updating robots.txt", error: err instanceof Error ? err.message : String(err) };
  }
}

export function fixCreateSecurityTxt(files: CrawledFile[], issueId: string, backupDir: string): FixResult {
  const projectRoot = path.dirname(files[0]?.path || process.cwd());
  const wellKnownDir = path.join(projectRoot, ".well-known");
  const securityTxtPath = path.join(wellKnownDir, "security.txt");

  try {
    if (fs.existsSync(securityTxtPath)) {
      return { filePath: ".well-known/security.txt", issueId, success: true, description: "security.txt already exists" };
    }

    fs.mkdirSync(wellKnownDir, { recursive: true });

    const content = [
      "# Security.txt — Security Vulnerability Disclosure Policy",
      `Contact: mailto:security@${projectRoot.split(path.sep).pop() || "example"}.com`,
      `Expires: ${new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()}`,
      "Preferred-Languages: en",
      "Canonical: https://example.com/.well-known/security.txt",
      "Policy: https://example.com/security-policy.html",
      "",
    ].join("\n");

    applyFix(securityTxtPath, content);

    return {
      filePath: ".well-known/security.txt",
      issueId,
      success: true,
      description: `Created .well-known/security.txt`,
      diff: `--- /dev/null\n+++ b/.well-known/security.txt\n+${content.replace(/\n/g, "\n+")}`,
    };
  } catch (err) {
    return { filePath: ".well-known/security.txt", issueId, success: false, description: "Error creating security.txt", error: err instanceof Error ? err.message : String(err) };
  }
}

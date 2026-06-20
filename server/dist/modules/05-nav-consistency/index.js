import fs from "fs";
import * as cheerio from "cheerio";
import { calculateModuleScore } from "../../scoring.js";
function escapeId(id) {
    return id.replace(/["\\]/g, "\\$&");
}
function elementExistsById($, id) {
    return $(`[id="${escapeId(id)}"]`).length > 0;
}
export function auditNavConsistency(files) {
    const issues = [];
    const htmlFiles = files.filter((f) => f.type === "html" && !f.relativePath.startsWith(".well-known")).sort((a, b) => (a.relativePath === "index.html" ? -1 : 1));
    if (htmlFiles.length === 0) {
        return { moduleId: "05-nav-consistency", moduleName: "Navigation Consistency", status: "fail", score: 0, issues, summary: "No HTML files found to audit navigation" };
    }
    const pageDataList = [];
    const helpLinkTexts = ["help", "contact", "support", "chat", "faq", "contact us", "get help", "customer support", "live chat", "report an issue"];
    for (const file of htmlFiles) {
        let content;
        try {
            content = fs.readFileSync(file.path, "utf-8");
        }
        catch {
            continue;
        }
        const $ = cheerio.load(content);
        const navEls = $("nav");
        const navLinks = [];
        let navHtml = null;
        if (navEls.length > 0) {
            const firstNav = navEls.first();
            navHtml = $.html(firstNav);
            firstNav.find("a").each((_i, el) => {
                const text = $(el).text().trim();
                const href = $(el).attr("href") || "";
                if (text || href) {
                    navLinks.push({ text, href });
                }
            });
        }
        // --- SC 2.4.1: Skip to content / Bypass Blocks ---
        let hasSkipLink = false;
        let skipLinkTarget = null;
        let skipLinkTargetExists = false;
        let skipLinkHidden = false;
        const firstLinks = $("a").slice(0, 10);
        for (const el of firstLinks) {
            const href = $(el).attr("href") || "";
            if (href.startsWith("#") && href.length > 1) {
                const targetId = href.slice(1);
                if (elementExistsById($, targetId)) {
                    hasSkipLink = true;
                    skipLinkTarget = targetId;
                    skipLinkTargetExists = true;
                    break;
                }
            }
        }
        if (!hasSkipLink) {
            for (const el of firstLinks) {
                const href = $(el).attr("href") || "";
                const text = $(el).text().trim().toLowerCase();
                if (href.startsWith("#") && href.length > 1 &&
                    (text.includes("skip") || href.includes("skip") || href.includes("main") || href.includes("content"))) {
                    hasSkipLink = true;
                    skipLinkTarget = href.slice(1);
                    skipLinkTargetExists = elementExistsById($, skipLinkTarget);
                    break;
                }
            }
        }
        if (!hasSkipLink) {
            const skipSelectors = [".skip-link", ".skip-to-content", 'a[class*="skip"]', ".skip-nav"];
            for (const sel of skipSelectors) {
                const el = $(sel).first();
                if (el.length > 0) {
                    const href = el.attr("href") || "";
                    const targetId = href.startsWith("#") ? href.slice(1) : "";
                    hasSkipLink = true;
                    skipLinkTarget = targetId || "unknown";
                    skipLinkTargetExists = targetId ? elementExistsById($, targetId) : false;
                    break;
                }
            }
        }
        const hasMainLandmark = $("main").length > 0;
        if (hasSkipLink && skipLinkTarget && skipLinkTarget !== "unknown") {
            const skipEl = $(`[href="#${escapeId(skipLinkTarget)}"]`).first();
            if (skipEl.length > 0) {
                const style = (skipEl.attr("style") || "").toLowerCase();
                if (/display\s*:\s*none/.test(style) || /visibility\s*:\s*hidden/.test(style)) {
                    skipLinkHidden = true;
                }
            }
        }
        // --- SC 2.4.5: Search ---
        const hasSearch = $('input[type="search"]').length > 0 || $('[role="search"]').length > 0 || $('form[action*="search"], form[id*="search"], form[class*="search"]').length > 0;
        // --- SC 2.4.5: Sitemap link ---
        const hasSitemapLink = $('a[href*="sitemap"], a[href*="Sitemap"]').length > 0;
        // --- SC 3.2.6: Help/contact links ---
        const helpLinks = [];
        $("a").each((_i, el) => {
            const text = $(el).text().trim().toLowerCase();
            const href = ($(el).attr("href") || "").toLowerCase();
            if (helpLinkTexts.some((t) => text.includes(t) || href.includes(t))) {
                helpLinks.push({ text: $(el).text().trim(), href: $(el).attr("href") || "" });
            }
        });
        // --- SC 2.4.3: Positive tabindex ---
        const tabindexValues = [];
        $("[tabindex]").each((_i, el) => {
            const val = parseInt($(el).attr("tabindex") || "", 10);
            if (!isNaN(val) && val > 0) {
                tabindexValues.push(val);
            }
        });
        pageDataList.push({
            file, navLinks, navHtml,
            hasSkipLink, skipLinkTarget, skipLinkTargetExists,
            hasMainLandmark, skipLinkHidden,
            hasSearch, hasSitemapLink, helpLinks,
            hasPositiveTabindex: tabindexValues.length > 0,
            tabindexValues,
        });
    }
    // --- Golden Master: use index.html, or first page with non-empty nav ---
    let master = pageDataList.find((p) => p.file.relativePath === "index.html");
    if (master && master.navLinks.length === 0) {
        master = pageDataList.find((p) => p.navLinks.length > 0) || master;
    }
    const masterLinks = master ? master.navLinks : (pageDataList[0]?.navLinks || []);
    const htmlPathSet = new Set(htmlFiles.map((f) => f.relativePath));
    for (const page of pageDataList) {
        const file = page.file;
        const isErrorPage = /^4\d{2}\.html$|^5\d{2}\.html$|^error\b/i.test(file.relativePath);
        if (!page.navHtml) {
            continue;
        }
        // --- SC 2.4.1: Bypass Blocks ---
        const hasBypass = page.hasSkipLink || page.hasMainLandmark;
        if (!hasBypass) {
            issues.push({
                id: `bypass-block-missing-${file.relativePath}`,
                severity: "high",
                title: "Missing bypass mechanism (skip link or <main> landmark)",
                description: `${file.relativePath} has no skip-to-content link and no <main> landmark (SC 2.4.1).`,
                filePath: file.relativePath,
                suggestion: 'Add <a href="#main-content">Skip to content</a> as the first focusable element, or add a <main> element.',
            });
        }
        if (page.hasSkipLink && !page.skipLinkTargetExists) {
            issues.push({
                id: `skip-link-target-missing-${file.relativePath}`,
                severity: "medium",
                title: "Skip link target does not exist",
                description: `${file.relativePath} has a skip link to #${page.skipLinkTarget} but no element with that ID exists.`,
                filePath: file.relativePath,
                suggestion: `Add <div id="${page.skipLinkTarget}"> as the target for the skip link.`,
            });
        }
        if (page.skipLinkHidden) {
            issues.push({
                id: `skip-link-hidden-${file.relativePath}`,
                severity: "high",
                title: "Skip link is hidden with display:none or visibility:hidden",
                description: `${file.relativePath} has a skip link that is visually hidden, making it inaccessible to keyboard users.`,
                filePath: file.relativePath,
                suggestion: "Use a visually-hidden class (off-screen positioning) instead of display:none or visibility:hidden.",
            });
        }
        // --- SC 2.4.3: Positive tabindex ---
        if (page.hasPositiveTabindex) {
            issues.push({
                id: `positive-tabindex-${file.relativePath}`,
                severity: "medium",
                title: "Positive tabindex values found",
                description: `${file.relativePath} has elements with positive tabindex values (${page.tabindexValues.join(", ")}) which disrupt natural focus order (SC 2.4.3).`,
                filePath: file.relativePath,
                suggestion: "Remove positive tabindex values and rely on document source order.",
            });
        }
        // --- Nav link target existence ---
        for (const link of page.navLinks) {
            if (link.href.startsWith("http") || link.href.startsWith("//") || link.href.startsWith("#") || link.href.startsWith("mailto:") || link.href.includes("#") || link.href === "")
                continue;
            const resolved = resolveNavPath(link.href, file.relativePath);
            if (resolved && !htmlPathSet.has(resolved) && !resolved.endsWith(".css") && !resolved.endsWith(".js")) {
                issues.push({
                    id: `nav-broken-link-${file.relativePath}-${link.href}`,
                    severity: "critical",
                    title: `Nav link target not found: "${link.href}"`,
                    description: `${file.relativePath} nav links to "${link.href}" but the file does not exist.`,
                    filePath: file.relativePath,
                    suggestion: `Create ${link.href} or update the link.`,
                });
            }
        }
    }
    // --- SC 3.2.6: Consistent Help ---
    const pagesWithHelp = pageDataList.filter((p) => p.helpLinks.length > 0);
    if (pagesWithHelp.length > 0) {
        const pagesWithoutHelp = pageDataList.filter((p) => p.helpLinks.length === 0 && p.navHtml !== null);
        for (const page of pagesWithoutHelp) {
            issues.push({
                id: `consistent-help-missing-${page.file.relativePath}`,
                severity: "high",
                title: "Missing help/contact mechanism",
                description: `${page.file.relativePath} has no help or contact links, while other pages do (SC 3.2.6).`,
                filePath: page.file.relativePath,
                suggestion: "Add consistent help/contact links across all pages in the same position.",
            });
        }
    }
    // --- SC 3.2.4: Consistent Identification ---
    function normalizeHref(href) {
        const hashIdx = href.indexOf("#");
        if (hashIdx !== -1)
            return href.slice(hashIdx);
        return href;
    }
    const textToHrefs = new Map();
    for (const page of pageDataList) {
        for (const link of page.navLinks) {
            if (!link.text)
                continue;
            const normalized = normalizeHref(link.href);
            if (!textToHrefs.has(link.text)) {
                textToHrefs.set(link.text, new Set());
            }
            textToHrefs.get(link.text).add(normalized);
        }
    }
    for (const [text, hrefs] of textToHrefs) {
        if (hrefs.size > 1) {
            const pageCount = pageDataList.filter((p) => p.navLinks.some((l) => l.text === text)).length;
            if (pageCount > 1) {
                issues.push({
                    id: `consistent-identification-${text.replace(/[^a-zA-Z0-9_-]/g, "_")}`,
                    severity: "high",
                    title: `Inconsistent identification: "${text}" points to different destinations`,
                    description: `The link text "${text}" maps to multiple URLs: ${Array.from(hrefs).join(", ")} across different pages (SC 3.2.4).`,
                    suggestion: `Ensure the link text "${text}" always points to the same destination across all pages.`,
                });
            }
        }
    }
    const score = calculateModuleScore(issues);
    const criticalCount = issues.filter((i) => i.severity === "critical").length;
    const highCount = issues.filter((i) => i.severity === "high").length;
    const status = criticalCount > 0 ? "fail" : highCount > 0 ? "warning" : issues.length > 0 ? "warning" : "pass";
    return {
        moduleId: "05-nav-consistency",
        moduleName: "Navigation Consistency",
        status,
        score,
        issues,
        summary: `${issues.length} issue${issues.length !== 1 ? "s" : ""} found across ${pageDataList.length} page${pageDataList.length !== 1 ? "s" : ""}`,
    };
}
function resolveNavPath(target, fromFile) {
    if (target.startsWith("/"))
        return target.slice(1).split("?")[0];
    const dir = fromFile.includes("/") ? fromFile.substring(0, fromFile.lastIndexOf("/")) : "";
    const segments = dir ? dir.split("/") : [];
    const parts = target.split("/");
    for (const part of parts) {
        if (part === "..") {
            if (segments.length > 0)
                segments.pop();
        }
        else if (part !== ".")
            segments.push(part);
    }
    const result = segments.join("/").split("?")[0];
    return result || null;
}
//# sourceMappingURL=index.js.map
import fs from "fs";
import * as cheerio from "cheerio";
import { calculateModuleScore } from "../../scoring.js";
function generateId() {
    return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}
function attr(tag, name) {
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`${esc}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|(\\S+))`, "i");
    const m = tag.match(re);
    return m ? (m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3]) : null;
}
function isFilename(s) {
    return /^[\w-]+\.(jpe?g|png|gif|webp|avif|bmp|tiff|svg|ico)$/i.test(s.trim());
}
function extOf(url) {
    const q = url.indexOf("?");
    const c = q >= 0 ? url.slice(0, q) : url;
    const p = c.split(".");
    return p.length > 1 ? p.pop().toLowerCase() : "";
}
const OUTDATED = new Set(["gif", "bmp", "tiff"]);
export async function auditImageOptimization(files) {
    const issues = [];
    const htmlFiles = files.filter((f) => f.type === "html" && !f.relativePath.startsWith(".well-known"));
    const imgs = [];
    const pageHtml = new Map();
    for (const file of htmlFiles) {
        let content = "";
        try {
            content = fs.readFileSync(file.path, "utf-8");
        }
        catch {
            continue;
        }
        pageHtml.set(file.relativePath, content);
        const $ = cheerio.load(content);
        // Check SVGs without viewBox
        $("svg").each((_si, el) => {
            const $el = $(el);
            if (!$el.attr("viewBox") && !$el.attr("viewbox")) {
                issues.push({
                    id: generateId(), severity: "medium", title: "SVG missing viewBox attribute",
                    description: `${file.relativePath}: <svg> element #${_si + 1} lacks a viewBox attribute — may not scale correctly.`,
                    filePath: file.relativePath,
                    suggestion: "Add viewBox='0 0 width height' with the SVG's intrinsic dimensions.",
                });
            }
        });
        // Check base64 inline images
        $("img[src]").each((_bi, el) => {
            const src = $(el).attr("src") || "";
            if (src.startsWith("data:image/")) {
                const size = Math.round((src.length * 3) / 4 / 1024);
                if (size > 10) {
                    issues.push({
                        id: generateId(), severity: "medium", title: `Large inline base64 image (~${size}KB)`,
                        description: `${file.relativePath}: image #${_bi + 1} is a ${size}KB base64-encoded image — cannot be cached or preloaded.`,
                        filePath: file.relativePath,
                        suggestion: "Replace with an external image file for caching and parallel loading.",
                    });
                }
            }
        });
        const re = /<img[^>]+>/gi;
        let m;
        let seq = 0;
        while ((m = re.exec(content)) !== null) {
            const src = attr(m[0], "src");
            if (!src)
                continue;
            imgs.push({
                page: file.relativePath,
                src,
                alt: attr(m[0], "alt"),
                role: attr(m[0], "role"),
                width: attr(m[0], "width"),
                height: attr(m[0], "height"),
                fetchpriority: attr(m[0], "fetchpriority"),
                srcset: attr(m[0], "srcset"),
                sizes: attr(m[0], "sizes"),
                seq: seq++,
                pos: m.index,
            });
        }
    }
    for (const img of imgs) {
        const alt = img.alt;
        const hasAlt = alt !== null;
        const altStr = hasAlt ? alt.trim() : "";
        const emptyAlt = hasAlt && altStr === "";
        if (!hasAlt) {
            issues.push({
                id: generateId(), severity: "high", title: "Image missing alt attribute",
                description: `Image "${img.src}" on ${img.page} is missing an alt attribute.`,
                filePath: img.page,
                suggestion: "Add descriptive alt text for informative images, or alt=\"\" with role=\"presentation\" for decorative images.",
            });
        }
        else if (emptyAlt && img.role !== "presentation") {
            issues.push({
                id: generateId(), severity: "medium", title: "Empty alt without role=\"presentation\"",
                description: `Image "${img.src}" on ${img.page} has alt="" but lacks role="presentation".`,
                filePath: img.page,
                suggestion: "Add role=\"presentation\" for decorative images, or provide meaningful alt text.",
            });
        }
        if (hasAlt && !emptyAlt && isFilename(altStr)) {
            issues.push({
                id: generateId(), severity: "medium", title: "Alt text appears to be a filename",
                description: `Image "${img.src}" on ${img.page} uses alt="${altStr}" which looks like a filename.`,
                filePath: img.page,
                suggestion: "Replace with a meaningful description of the image content.",
            });
        }
        if (hasAlt && !emptyAlt && /^(image|picture)\s+of\b/i.test(altStr)) {
            issues.push({
                id: generateId(), severity: "low", title: "Redundant alt text phrasing",
                description: `Image "${img.src}" on ${img.page} uses alt="${altStr}" — screen readers already announce images.`,
                filePath: img.page,
                suggestion: "Remove 'image of' or 'picture of'; use a direct description.",
            });
        }
        const ext = extOf(img.src);
        if (ext && OUTDATED.has(ext)) {
            issues.push({
                id: generateId(), severity: "medium", title: "Outdated image format",
                description: `Image "${img.src}" on ${img.page} uses outdated .${ext} format.`,
                filePath: img.page,
                suggestion: "Convert to WebP (with JPEG/PNG fallback) for better compression and quality.",
            });
        }
    }
    const score = calculateModuleScore(issues);
    const status = score >= 80 ? "pass" : score >= 50 ? "warning" : "fail";
    return {
        moduleId: "15-image-optimization",
        moduleName: "Image Optimization",
        status,
        score,
        issues,
        summary: `${issues.length} image issue${issues.length !== 1 ? "s" : ""} found across ${htmlFiles.length} page${htmlFiles.length !== 1 ? "s" : ""}.`,
    };
}
//# sourceMappingURL=index.js.map
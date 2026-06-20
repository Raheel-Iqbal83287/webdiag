import fs from "fs";
import * as cheerio from "cheerio";
import { calculateModuleScore } from "../../scoring.js";
const SRI_HASH_PATTERN = /^sha(256|384|512)-[A-Za-z0-9+/=]+$/;
function isSameOrigin(url, _baseUrl) {
    if (url.startsWith("data:") || url.startsWith("blob:"))
        return true;
    if (!url.startsWith("http://") && !url.startsWith("https://") && !url.startsWith("//"))
        return true;
    return false;
}
function isCdn(url) {
    return /https?:\/\/([\w-]+\.)?(cdn|cdnjs|unpkg|jsdelivr|bootstrapcdn|googleapis|jquery|cloudflare|socket|plot)\./i.test(url);
}
export function auditCssJsIntegrity(files) {
    const issues = [];
    const htmlFiles = files.filter((f) => f.type === "html");
    const cssFiles = files.filter((f) => f.type === "css");
    const jsFiles = files.filter((f) => f.type === "js");
    const cssPathSet = new Set(cssFiles.map((f) => f.relativePath));
    const jsPathSet = new Set(jsFiles.map((f) => f.relativePath));
    let hasMetaCsp = false;
    let cspScriptSrcUnsafeEval = false;
    let cspBaseUriSelf = false;
    let cspObjectSrcNone = false;
    let cspFormActionSelf = false;
    const referencedCss = new Set();
    const referencedJs = new Set();
    for (const file of htmlFiles) {
        let content;
        try {
            content = fs.readFileSync(file.path, "utf-8");
        }
        catch {
            continue;
        }
        const $ = cheerio.load(content);
        // --- CSP detection ---
        $('meta[http-equiv="Content-Security-Policy"]').each((_i, el) => {
            const csp = $(el).attr("content") || "";
            hasMetaCsp = true;
            const scriptSrcCsp = (csp.match(/\bscript-src\b[^;]*/i) || [""])[0];
            if (/'unsafe-eval'/.test(scriptSrcCsp))
                cspScriptSrcUnsafeEval = true;
            if (/\bbase-uri\b/.test(csp) && /'self'/.test(csp))
                cspBaseUriSelf = true;
            if (/\bobject-src\b/.test(csp) && /'none'/.test(csp))
                cspObjectSrcNone = true;
            if (/\bform-action\b/.test(csp) && /'self'/.test(csp))
                cspFormActionSelf = true;
        });
        // --- SRI & crossorigin checks on external scripts ---
        $("script[src]").each((_i, el) => {
            const src = $(el).attr("src");
            const integrity = $(el).attr("integrity");
            const crossOrigin = $(el).attr("crossorigin");
            const isExternal = !isSameOrigin(src);
            const isCdnResource = isCdn(src);
            const skipDynamicSrc = /googlesyndication|doubleclick\.net|google-analytics|googletagmanager|fonts\.googleapis\.com/i.test(src);
            if ((isExternal || isCdnResource) && !skipDynamicSrc) {
                if (!integrity) {
                    issues.push({
                        id: `sri-missing-${file.relativePath}-script-${_i}`,
                        severity: "critical",
                        title: "Missing SRI integrity attribute on external script",
                        description: `${file.relativePath}: <script src="${src}"> has no integrity attribute.`,
                        filePath: file.relativePath,
                        suggestion: `Add integrity="sha384-..." and crossorigin="anonymous" to the <script> tag.`,
                    });
                }
                else {
                    if (!SRI_HASH_PATTERN.test(integrity.trim())) {
                        issues.push({
                            id: `sri-invalid-${file.relativePath}-script-${_i}`,
                            severity: "high",
                            title: "Invalid SRI integrity attribute format",
                            description: `${file.relativePath}: integrity="${integrity}" is not a valid SRI hash.`,
                            filePath: file.relativePath,
                            suggestion: "Use format: sha384-base64hash",
                        });
                    }
                    else {
                        const algo = integrity.trim().match(/^sha(256|384|512)-/)?.[1];
                        if (algo === "256") {
                            issues.push({
                                id: `sri-weak-hash-${file.relativePath}-script-${_i}`,
                                severity: "low",
                                title: "SRI uses SHA-256 (prefer SHA-384 or SHA-512)",
                                description: `${file.relativePath}: script uses sha256- which is weaker.`,
                                filePath: file.relativePath,
                                suggestion: "Use sha384- or sha512- for stronger integrity guarantees.",
                            });
                        }
                    }
                    if (isExternal && (!crossOrigin || (crossOrigin !== "anonymous" && crossOrigin !== "use-credentials"))) {
                        issues.push({
                            id: `sri-crossorigin-${file.relativePath}-script-${_i}`,
                            severity: "medium",
                            title: "Cross-origin script with SRI missing crossorigin attribute",
                            description: `${file.relativePath}: script has integrity but crossorigin is not set to "anonymous".`,
                            filePath: file.relativePath,
                            suggestion: `Add crossorigin="anonymous" to the <script> tag.`,
                        });
                    }
                }
            }
            // Track referenced JS
            if (!src.startsWith("http") && !src.startsWith("//") && !src.startsWith("data:")) {
                const resolved = resolveJsPath(src, file.relativePath);
                if (resolved)
                    referencedJs.add(resolved);
            }
        });
        // --- SRI & crossorigin checks on external stylesheets ---
        $('link[rel="stylesheet"]').each((_i, el) => {
            const href = $(el).attr("href");
            if (!href)
                return;
            const integrity = $(el).attr("integrity");
            const crossOrigin = $(el).attr("crossorigin");
            const isExternal = !isSameOrigin(href);
            const isCdnResource = isCdn(href);
            const skipDynamicSrc = /googlesyndication|doubleclick\.net|google-analytics|googletagmanager|fonts\.googleapis\.com/i.test(href);
            if ((isExternal || isCdnResource) && !skipDynamicSrc) {
                if (!integrity) {
                    issues.push({
                        id: `sri-missing-${file.relativePath}-css-${_i}`,
                        severity: "critical",
                        title: "Missing SRI integrity attribute on external stylesheet",
                        description: `${file.relativePath}: <link rel="stylesheet" href="${href}"> has no integrity attribute.`,
                        filePath: file.relativePath,
                        suggestion: `Add integrity="sha384-..." and crossorigin="anonymous" to the <link> tag.`,
                    });
                }
                else {
                    if (!SRI_HASH_PATTERN.test(integrity.trim())) {
                        issues.push({
                            id: `sri-invalid-css-${file.relativePath}-${_i}`,
                            severity: "high",
                            title: "Invalid SRI integrity attribute format on stylesheet",
                            description: `${file.relativePath}: integrity="${integrity}" is not a valid SRI hash.`,
                            filePath: file.relativePath,
                            suggestion: "Use format: sha384-base64hash",
                        });
                    }
                    else {
                        const algo = integrity.trim().match(/^sha(256|384|512)-/)?.[1];
                        if (algo === "256") {
                            issues.push({
                                id: `sri-weak-hash-css-${file.relativePath}-${_i}`,
                                severity: "low",
                                title: "SRI on stylesheet uses SHA-256 (prefer SHA-384/512)",
                                description: `${file.relativePath}: stylesheet uses sha256- which is weaker.`,
                                filePath: file.relativePath,
                                suggestion: "Use sha384- or sha512- for stronger integrity guarantees.",
                            });
                        }
                    }
                    if (isExternal && (!crossOrigin || (crossOrigin !== "anonymous" && crossOrigin !== "use-credentials"))) {
                        issues.push({
                            id: `sri-crossorigin-css-${file.relativePath}-${_i}`,
                            severity: "medium",
                            title: "Cross-origin stylesheet with SRI missing crossorigin",
                            description: `${file.relativePath}: stylesheet has integrity but crossorigin is missing or not "anonymous".`,
                            filePath: file.relativePath,
                            suggestion: `Add crossorigin="anonymous" to the <link> tag.`,
                        });
                    }
                }
            }
            // Track referenced CSS
            if (!href.startsWith("http") && !href.startsWith("//") && !href.startsWith("data:")) {
                const resolved = resolveCssPath(href, file.relativePath);
                if (resolved)
                    referencedCss.add(resolved);
            }
        });
        // --- Missing external files (CSS) ---
        $(`link[rel=stylesheet]`).each((_i, el) => {
            const href = $(el).attr("href");
            if (!href || href.startsWith("http") || href.startsWith("//") || href.startsWith("data:"))
                return;
            const resolved = resolveCssPath(href, file.relativePath);
            if (resolved && !cssPathSet.has(resolved)) {
                issues.push({
                    id: `css-missing-${file.relativePath}-${_i}`,
                    severity: "high",
                    title: `Linked CSS file not found: "${href}"`,
                    description: `${file.relativePath} references "${href}" but the file does not exist.`,
                    filePath: file.relativePath,
                    suggestion: `Create ${href} or remove the link.`,
                });
            }
        });
        // --- Missing external files (JS) ---
        $("script[src]").each((_i, el) => {
            const src = $(el).attr("src");
            if (!src || src.startsWith("http") || src.startsWith("//") || src.startsWith("data:"))
                return;
            const resolved = resolveJsPath(src, file.relativePath);
            if (resolved && !jsPathSet.has(resolved)) {
                issues.push({
                    id: `js-missing-${file.relativePath}-${_i}`,
                    severity: "high",
                    title: `Linked JS file not found: "${src}"`,
                    description: `${file.relativePath} references "${src}" but the file does not exist.`,
                    filePath: file.relativePath,
                    suggestion: `Create ${src} or remove the script tag.`,
                });
            }
        });
    }
    // --- CSP issues ---
    if (hasMetaCsp) {
        if (!cspBaseUriSelf) {
            issues.push({
                id: "csp-missing-base-uri",
                severity: "high",
                title: "CSP missing base-uri 'self'",
                description: "Content-Security-Policy should include base-uri 'self' to prevent base tag injection.",
                filePath: "CSP Policy",
                suggestion: "Add base-uri 'self' to your Content-Security-Policy header.",
            });
        }
        if (!cspObjectSrcNone) {
            issues.push({
                id: "csp-missing-object-src",
                severity: "high",
                title: "CSP missing object-src 'none'",
                description: "Content-Security-Policy should include object-src 'none' to prevent plugin-based attacks.",
                filePath: "CSP Policy",
                suggestion: "Add object-src 'none' to your Content-Security-Policy header.",
            });
        }
        if (!cspFormActionSelf) {
            issues.push({
                id: "csp-missing-form-action",
                severity: "high",
                title: "CSP missing form-action 'self'",
                description: "Content-Security-Policy should include form-action 'self' to restrict form submission targets.",
                filePath: "CSP Policy",
                suggestion: "Add form-action 'self' to your Content-Security-Policy header.",
            });
        }
        if (cspScriptSrcUnsafeEval) {
            issues.push({
                id: "csp-unsafe-eval",
                severity: "high",
                title: "CSP allows 'unsafe-eval' in script-src",
                description: "Content-Security-Policy contains 'unsafe-eval' in script-src, enabling eval()-like attacks.",
                filePath: "CSP Policy",
                suggestion: "Remove 'unsafe-eval' from script-src.",
            });
        }
    }
    // --- CSS file analysis ---
    for (const file of cssFiles) {
        let content;
        try {
            content = fs.readFileSync(file.path, "utf-8");
        }
        catch {
            continue;
        }
        // CSS @import
        const importMatches = content.match(/@import\s+(url\s*\(\s*)?['"][^'"]+['"]\s*\)?\s*;/g);
        if (importMatches) {
            issues.push({
                id: `css-import-${file.relativePath}`,
                severity: "medium",
                title: `CSS @import detected (${importMatches.length} usage(s))`,
                description: `${file.relativePath}: @import creates sequential blocking chains that delay rendering.`,
                filePath: file.relativePath,
                suggestion: "Use <link rel=\"stylesheet\"> instead of @import for better performance.",
            });
        }
    }
    // --- JS file analysis ---
    for (const file of jsFiles) {
        let content;
        try {
            content = fs.readFileSync(file.path, "utf-8");
        }
        catch {
            continue;
        }
        // eval()
        if (/\beval\s*\(/i.test(content)) {
            issues.push({
                id: `js-eval-${file.relativePath}`,
                severity: "high",
                title: "Uses eval()",
                description: `${file.relativePath}: eval() is a security risk (XSS vector) and prevents performance optimizations.`,
                filePath: file.relativePath,
                suggestion: "Avoid eval(). Use JSON.parse() or proper parsers instead.",
            });
        }
        // document.write()
        if (/document\.write\s*\(/i.test(content)) {
            issues.push({
                id: `js-document-write-${file.relativePath}`,
                severity: "high",
                title: "Uses document.write()",
                description: `${file.relativePath}: document.write() is deprecated and blocks rendering.`,
                filePath: file.relativePath,
                suggestion: "Replace document.write() with DOM manipulation methods.",
            });
        }
    }
    // --- Orphaned CSS/JS ---
    const htmlDirs = new Set(htmlFiles.map((f) => {
        const i = f.relativePath.lastIndexOf("/");
        return i >= 0 ? f.relativePath.slice(0, i + 1) : "";
    }));
    const NON_WEB_EXTS = new Set([".ts", ".tsx", ".jsx", ".mjs", ".cjs", ".json", ".map"]);
    for (const file of cssFiles) {
        if (file.relativePath.startsWith("node_modules"))
            continue;
        const dir = file.relativePath.includes("/") ? file.relativePath.substring(0, file.relativePath.lastIndexOf("/") + 1) : "";
        if (!htmlDirs.has(dir))
            continue;
        if (!referencedCss.has(file.relativePath)) {
            issues.push({
                id: `css-orphaned-${file.relativePath}`,
                severity: "medium",
                title: `Unused CSS file: "${file.relativePath}"`,
                description: `${file.relativePath} exists but is not referenced by any HTML page.`,
                filePath: file.relativePath,
                suggestion: "Remove the file or add a link to it in the appropriate HTML pages.",
            });
        }
    }
    for (const file of jsFiles) {
        if (file.relativePath.startsWith("node_modules"))
            continue;
        const ext = file.relativePath.includes(".") ? "." + file.relativePath.split(".").pop().toLowerCase() : "";
        if (NON_WEB_EXTS.has(ext))
            continue;
        const dir = file.relativePath.includes("/") ? file.relativePath.substring(0, file.relativePath.lastIndexOf("/") + 1) : "";
        if (!htmlDirs.has(dir))
            continue;
        if (!referencedJs.has(file.relativePath)) {
            issues.push({
                id: `js-orphaned-${file.relativePath}`,
                severity: "medium",
                title: `Unused JS file: "${file.relativePath}"`,
                description: `${file.relativePath} exists but is not referenced by any HTML page.`,
                filePath: file.relativePath,
                suggestion: "Remove the file or add a script tag in the appropriate HTML pages.",
            });
        }
    }
    const score = calculateModuleScore(issues);
    const criticalCount = issues.filter((i) => i.severity === "critical").length;
    const highCount = issues.filter((i) => i.severity === "high").length;
    const status = criticalCount > 0 ? "fail" : highCount > 0 ? "warning" : issues.length > 0 ? "warning" : "pass";
    return {
        moduleId: "04-css-js-integrity",
        moduleName: "CSS/JS Integrity Checker",
        status,
        score,
        issues,
        summary: `${issues.length} issue${issues.length !== 1 ? "s" : ""} found across ${cssFiles.length} CSS and ${jsFiles.length} JS file${jsFiles.length !== 1 ? "s" : ""}`,
    };
}
function resolveCssPath(href, htmlRelativePath) {
    const qIndex = href.indexOf("?");
    if (qIndex !== -1)
        href = href.slice(0, qIndex);
    if (href.startsWith("/"))
        return href.slice(1);
    const dir = htmlRelativePath.includes("/") ? htmlRelativePath.substring(0, htmlRelativePath.lastIndexOf("/")) : "";
    const segments = dir ? dir.split("/") : [];
    const hrefParts = href.split("/");
    for (const part of hrefParts) {
        if (part === "..")
            segments.pop();
        else if (part !== ".")
            segments.push(part);
    }
    if (segments.length === 0)
        return href;
    return segments.join("/");
}
function resolveJsPath(src, htmlRelativePath) {
    return resolveCssPath(src, htmlRelativePath);
}
//# sourceMappingURL=index.js.map
import fs from "fs";
import * as cheerio from "cheerio";
import { calculateModuleScore } from "../../scoring.js";
const BACKUP_PATTERNS = [/\.bak$/i, /\.old$/i, /\.backup$/i, /\.swp$/, /~$/];
function isBackupFile(path) {
    return BACKUP_PATTERNS.some((p) => p.test(path));
}
const SENSITIVE_CONFIG_PATTERNS = [
    /^composer\.json$/i, /^package\.json$/i, /^package-lock\.json$/i,
    /^yarn\.lock$/, /^pnpm-lock\.yaml$/i, /^Gemfile$/i, /^Gemfile\.lock$/i,
];
function isSensitiveConfig(path) {
    return SENSITIVE_CONFIG_PATTERNS.some((p) => p.test(path));
}
const ADMIN_DISALLOW_PATTERNS = [
    /admin/i, /login/i, /wp-admin/i, /dashboard/i, /backend/i,
    /private/i, /secret/i, /internal/i,
];
export function auditHostingReadiness(files) {
    const issues = [];
    const htmlFiles = files.filter((f) => f.type === "html" && !f.relativePath.startsWith("node_modules") && !f.relativePath.startsWith(".well-known"));
    const jsFiles = files.filter((f) => f.type === "js");
    const filePathSet = new Set(files.map((f) => f.relativePath));
    const filePathLower = new Set(files.map((f) => f.relativePath.toLowerCase()));
    // Detect site root: if all HTML files are under one subdirectory, use that as the site root
    const htmlDirs = new Set(htmlFiles.map(f => { const i = f.relativePath.lastIndexOf("/"); return i >= 0 ? f.relativePath.slice(0, i) : ""; }).filter(d => d !== ""));
    const siteRoot = htmlDirs.size === 1 && htmlFiles.length > 0 ? [...htmlDirs][0] : "";
    const siteRootPrefix = siteRoot ? `${siteRoot}/` : "";
    // --- 1. Index file check (look in site root) ---
    const hasIndex = siteRoot
        ? filePathLower.has(`${siteRoot}/index.html`) || filePathLower.has(`${siteRoot}/index.htm`)
        : filePathLower.has("index.html") || filePathLower.has("index.htm");
    if (!hasIndex) {
        issues.push({
            id: "missing-index",
            severity: "critical",
            title: "Missing index.html",
            description: siteRoot ? `No index.html found in ${siteRoot}/ — site root will not resolve.` : "No index.html or index.htm found — site root will not resolve.",
            filePath: "N/A",
            suggestion: `Create an index.html file at ${siteRoot ? `${siteRoot}/` : ""}the site root.`,
        });
    }
    // --- 2. Custom 404 page (look in site root) ---
    const has404 = siteRoot
        ? filePathLower.has(`${siteRoot}/404.html`) || filePathLower.has(`${siteRoot}/404.htm`)
        : filePathLower.has("404.html") || filePathLower.has("404.htm");
    if (!has404) {
        issues.push({
            id: "missing-404",
            severity: "medium",
            title: "No custom 404 page",
            description: siteRoot ? `No 404.html found in ${siteRoot}/ — users see a generic error page.` : "No 404.html found — users see a generic error page.",
            filePath: "N/A",
            suggestion: `Create a custom 404.html${siteRoot ? " in " + siteRoot : ""} with helpful navigation.`,
        });
    }
    // --- 3. Environment files exposed ---
    const envFiles = files.filter((f) => /\.env(\.\w+)?$/i.test(f.relativePath) ||
        /\.env\.(local|production|development|staging|bak|backup)$/i.test(f.relativePath) ||
        f.relativePath === ".env");
    for (const file of envFiles) {
        issues.push({
            id: `env-file-exposed-${file.relativePath}`,
            severity: "critical",
            title: `Environment file exposed: ${file.relativePath}`,
            description: `"${file.relativePath}" contains potential secrets and must not be deployed.`,
            filePath: file.relativePath,
            suggestion: "Add to .gitignore and ensure it is excluded from deployment builds.",
        });
    }
    // --- 4. Source map files ---
    const sourceMaps = files.filter((f) => f.relativePath.endsWith(".map"));
    for (const file of sourceMaps) {
        issues.push({
            id: `source-map-exposed-${file.relativePath}`,
            severity: "high",
            title: "Source map file exposed",
            description: `${file.relativePath} exposes source code to visitors.`,
            filePath: file.relativePath,
            suggestion: "Remove .map files from production or restrict access.",
        });
    }
    // --- 5. .git exposure ---
    const gitFiles = files.filter((f) => /^\.git\//.test(f.relativePath) ||
        f.relativePath === ".git/config" ||
        f.relativePath === ".git/HEAD");
    if (gitFiles.length > 0) {
        issues.push({
            id: "git-directory-exposed",
            severity: "critical",
            title: ".git directory exposed",
            description: `.git directory files found (e.g., ${gitFiles[0].relativePath}). Full repository history is exposed.`,
            filePath: ".git/",
            suggestion: "Remove .git from deployment. Use a CI/CD pipeline that excludes hidden folders.",
        });
    }
    // --- 6. Config files in web root ---
    const configFiles = files.filter((f) => /\.(config|yml|yaml|ini|cfg)$/i.test(f.relativePath) &&
        !f.relativePath.includes("node_modules"));
    for (const file of configFiles) {
        issues.push({
            id: `config-exposed-${file.relativePath}`,
            severity: "medium",
            title: `Config file in deploy: ${file.relativePath}`,
            description: `"${file.relativePath}" is a config file that should typically not be in the public web root.`,
            filePath: file.relativePath,
            suggestion: "Move config files outside the public directory or restrict access via .htaccess.",
        });
    }
    // --- 7. Console.log / debugger in JS (source files excluded) ---
    for (const file of jsFiles) {
        if (/\.(ts|tsx|jsx|mjs|cjs)$/i.test(file.relativePath))
            continue;
        // Only check JS files within the site directory
        if (siteRoot && !file.relativePath.startsWith(siteRoot + "/"))
            continue;
        let content;
        try {
            content = fs.readFileSync(file.path, "utf-8");
        }
        catch {
            continue;
        }
        if (/console\.\w+\(/.test(content)) {
            issues.push({
                id: `console-log-${file.relativePath}`,
                severity: "medium",
                title: "Console statements in JavaScript",
                description: `${file.relativePath} contains console.* statements.`,
                filePath: file.relativePath,
                suggestion: "Remove console statements before production deployment.",
            });
        }
        if (/debugger;?\b/.test(content)) {
            issues.push({
                id: `debugger-stmt-${file.relativePath}`,
                severity: "high",
                title: "Debugger statement in JavaScript",
                description: `${file.relativePath} contains a debugger statement.`,
                filePath: file.relativePath,
                suggestion: "Remove debugger statements before production deployment.",
            });
        }
    }
    // --- 8. CNAME file ---
    // --- 9. HTTP resources on HTTPS pages ---
    for (const file of htmlFiles) {
        let content;
        try {
            content = fs.readFileSync(file.path, "utf-8");
        }
        catch {
            continue;
        }
        const $ = cheerio.load(content);
        $("a[href^='http://'], img[src^='http://'], script[src^='http://'], link[href^='http://'], iframe[src^='http://']").each((_i, el) => {
            const tagName = el.tagName;
            const attr = tagName === "a" ? "href" : tagName === "img" || tagName === "script" || tagName === "iframe" ? "src" : "href";
            const url = $(el).attr(attr) || "";
            if (!url.includes("example.com") && !url.includes("http/1.1")) {
                issues.push({
                    id: `http-resource-${file.relativePath}-${_i}`,
                    severity: "high",
                    title: `HTTP resource on ${tagName}`,
                    description: `${file.relativePath}: ${url} should use HTTPS.`,
                    filePath: file.relativePath,
                    suggestion: "Change to HTTPS to avoid mixed content warnings.",
                });
            }
        });
    }
    // --- 10. security.txt check ---
    const securityTxtFiles = files.filter((f) => /\.well-known[/\\]security\.txt/i.test(f.relativePath));
    if (securityTxtFiles.length === 0) {
        issues.push({
            id: "missing-security-txt",
            severity: "medium",
            title: "Missing security.txt",
            description: "No /.well-known/security.txt found — security researchers cannot report vulnerabilities.",
            filePath: "N/A",
            suggestion: "Create /.well-known/security.txt with Contact and Expires fields.",
        });
    }
    else {
        for (const file of securityTxtFiles) {
            try {
                const secContent = fs.readFileSync(file.path, "utf-8");
                if (!/^Contact:/im.test(secContent) || !/^Expires:/im.test(secContent)) {
                    issues.push({
                        id: "security-txt-incomplete",
                        severity: "medium",
                        title: "security.txt missing required fields",
                        description: `${file.relativePath} is missing Contact: or Expires: fields.`,
                        filePath: file.relativePath,
                        suggestion: "Add both Contact: (email or URL) and Expires: (ISO date) fields.",
                    });
                }
            }
            catch {
                issues.push({
                    id: "security-txt-unreadable",
                    severity: "medium",
                    title: "security.txt unreadable",
                    description: `${file.relativePath} could not be read.`,
                    filePath: file.relativePath,
                    suggestion: "Ensure security.txt is accessible and well-formed.",
                });
            }
        }
    }
    // --- 11. Crossdomain.xml / clientaccesspolicy.xml ---
    const legacyPolicyFiles = files.filter((f) => /^crossdomain\.xml$/i.test(f.relativePath) ||
        /^clientaccesspolicy\.xml$/i.test(f.relativePath));
    for (const file of legacyPolicyFiles) {
        issues.push({
            id: `legacy-policy-${file.relativePath}`,
            severity: "high",
            title: `Legacy policy file: ${file.relativePath}`,
            description: `${file.relativePath} allows Flash/Silverlight cross-domain access — security risk if overly permissive.`,
            filePath: file.relativePath,
            suggestion: "Remove legacy cross-domain policy files unless explicitly required.",
        });
    }
    // --- 12. Directory listing exposure ---
    const dirsWithContent = new Set();
    for (const f of files) {
        const parts = f.relativePath.split(/[/\\]/);
        if (parts.length > 1) {
            const dir = parts.slice(0, -1).join("/");
            dirsWithContent.add(dir);
        }
    }
    const ASSET_DIRS = /(?:^|\/)(css|js|img|images|fonts|font|icons|media|assets|vendor|dist|build)$/;
    for (const dir of dirsWithContent) {
        const hasIndex = files.some((f) => f.relativePath === `${dir}/index.html` || f.relativePath === `${dir}/index.htm`);
        if (dir.includes(".well-known"))
            continue;
        if (ASSET_DIRS.test(dir))
            continue;
        if (!hasIndex) {
            issues.push({
                id: `dir-listing-${dir}`,
                severity: "low",
                title: `Directory listing risk: ${dir}`,
                description: `"${dir}" has files but no index.html — directory listing may be enabled.`,
                filePath: dir,
                suggestion: `Add an index.html to "${dir}" or disable directory listing on the server.`,
            });
        }
    }
    // --- 13. Backup files ---
    const backupFiles = files.filter((f) => isBackupFile(f.relativePath));
    for (const file of backupFiles) {
        issues.push({
            id: `backup-file-${file.relativePath}`,
            severity: "high",
            title: `Backup file exposed: ${file.relativePath}`,
            description: `"${file.relativePath}" is a backup file that may contain sensitive data.`,
            filePath: file.relativePath,
            suggestion: "Remove backup files from production deployment.",
        });
    }
    // --- 14. Sensitive file patterns (skip .json source files) ---
    const sensitiveConfigs = files.filter((f) => isSensitiveConfig(f.relativePath) && !f.relativePath.includes("node_modules") && !/\.json$/i.test(f.relativePath));
    for (const file of sensitiveConfigs) {
        issues.push({
            id: `sensitive-config-${file.relativePath}`,
            severity: "low",
            title: `Dependency config exposed: ${file.relativePath}`,
            description: `"${file.relativePath}" reveals dependency versions and project metadata.`,
            filePath: file.relativePath,
            suggestion: "Remove from public root or serve from a subdirectory restricted by .htaccess.",
        });
    }
    // --- 15. robots.txt sensitive paths ---
    const robotsFile = files.find((f) => f.relativePath.toLowerCase() === "robots.txt");
    if (robotsFile) {
        try {
            const robotsContent = fs.readFileSync(robotsFile.path, "utf-8");
            const disallowMatches = robotsContent.matchAll(/^Disallow:\s*(.+)$/gim);
            const sensitivePaths = [];
            for (const match of disallowMatches) {
                const path = match[1].trim();
                if (path && ADMIN_DISALLOW_PATTERNS.some((p) => p.test(path))) {
                    sensitivePaths.push(path);
                }
            }
            if (sensitivePaths.length > 0) {
                issues.push({
                    id: "robots-sensitive-paths",
                    severity: "low",
                    title: "Sensitive paths exposed in robots.txt",
                    description: `robots.txt Disallow rules reveal admin paths: ${sensitivePaths.join(", ")}.`,
                    filePath: robotsFile.relativePath,
                    suggestion: "Avoid exposing admin paths in robots.txt. Use server authentication instead.",
                });
            }
        }
        catch {
            // skip unreadable robots.txt
        }
    }
    // --- 16. favicon.ico (look in site root) ---
    const hasFaviconIco = siteRoot
        ? filePathLower.has(`${siteRoot}/favicon.ico`)
        : filePathLower.has("favicon.ico");
    const hasFaviconPng = files.some((f) => {
        const inSiteRoot = siteRoot ? f.relativePath.startsWith(siteRoot + "/") || !f.relativePath.includes("/") : true;
        return inSiteRoot && /favicon\.(png|svg)$/i.test(f.relativePath);
    });
    if (!hasFaviconIco && !hasFaviconPng) {
        issues.push({
            id: "missing-favicon",
            severity: "low",
            title: "Missing favicon",
            description: "No favicon.ico or favicon.png found — browsers may generate 404 errors requesting one.",
            filePath: "N/A",
            suggestion: "Add a favicon.ico or favicon.png to the site root.",
        });
    }
    const score = calculateModuleScore(issues);
    const criticalCount = issues.filter((i) => i.severity === "critical").length;
    const highCount = issues.filter((i) => i.severity === "high").length;
    const status = criticalCount > 0 ? "fail" : highCount > 0 ? "warning" : issues.length > 0 ? "warning" : "pass";
    return {
        moduleId: "12-hosting-readiness",
        moduleName: "Hosting Readiness",
        status,
        score,
        issues,
        summary: `${issues.length} hosting readiness issue${issues.length !== 1 ? "s" : ""} found`,
    };
}
//# sourceMappingURL=index.js.map
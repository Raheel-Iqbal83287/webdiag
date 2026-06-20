import fs from "fs";
import type { CrawledFile, AuditIssue, ModuleResult } from "../../types.js";
import { calculateModuleScore } from "../../scoring.js";

const KNOWN_DIRECTIVES = new Set(["user-agent", "allow", "disallow"]);
const OTHER_RECORDS = new Set(["sitemap", "crawl-delay"]);
const PRODUCT_TOKEN_RE = /^[a-zA-Z_\-*]+$/;
const MAX_ROBOTS_SIZE = 500 * 1024;

export function auditRobotsTxt(files: CrawledFile[]): ModuleResult {
  const issues: AuditIssue[] = [];
  const robotsFiles = files.filter((f) => f.relativePath === "robots.txt" || f.relativePath.endsWith("/robots.txt"));

  if (robotsFiles.length === 0) {
    issues.push({ id: "robots-missing", severity: "high", title: "robots.txt not found", description: "No robots.txt was found.", suggestion: "Create a robots.txt with appropriate directives." });
    return { moduleId: "03-robots-txt", moduleName: "robots.txt Analysis", status: "warning", score: 50, issues, summary: "robots.txt is missing — generating recommended version", generatedRobots: generateRecommendedRobotsTxt() };
  }

  const robotsFile = robotsFiles[0];
  let rawContent: Buffer;
  try {
    rawContent = fs.readFileSync(robotsFile.path);
  } catch {
    issues.push({ id: "robots-unreadable", severity: "high", title: "robots.txt cannot be read", description: "robots.txt exists but could not be read." });
    return { moduleId: "03-robots-txt", moduleName: "robots.txt Analysis", status: "warning", score: 50, issues, summary: "robots.txt is unreadable" };
  }

  const hasBom = rawContent.length >= 3 && rawContent[0] === 0xEF && rawContent[1] === 0xBB && rawContent[2] === 0xBF;
  if (hasBom) {
    issues.push({ id: "robots-bom", severity: "medium", title: "robots.txt has UTF-8 BOM", description: "File starts with a UTF-8 BOM (EF BB BF). Per RFC 9309, robots.txt MUST be UTF-8 without BOM.", suggestion: "Re-save the file as UTF-8 without signature (no BOM)." });
  }

  if (robotsFile.size > MAX_ROBOTS_SIZE) {
    issues.push({ id: "robots-file-too-large", severity: "high", title: `robots.txt exceeds 500 KiB (${(robotsFile.size / 1024).toFixed(1)} KiB)`, description: `File is ${(robotsFile.size / 1024).toFixed(1)} KiB. RFC 9309 requires parsers to support at least 500 KiB.`, suggestion: "Reduce file size by removing unnecessary rules." });
  }

  const content = (hasBom ? rawContent.toString("utf-8").slice(1) : rawContent.toString("utf-8"));
  const rawLines = content.split(/\r?\n/);

  const parsedLines: { text: string; lineNumber: number }[] = [];
  for (let i = 0; i < rawLines.length; i++) {
    const commentIdx = rawLines[i].indexOf("#");
    const text = commentIdx >= 0 ? rawLines[i].slice(0, commentIdx).trim() : rawLines[i].trim();
    if (!text) continue;
    parsedLines.push({ text, lineNumber: i + 1 });
  }

  const hasUserAgent = parsedLines.some((l) => /^user-agent\s*:/i.test(l.text));
  if (!hasUserAgent) {
    issues.push({ id: "robots-no-user-agent", severity: "high", title: "No User-agent directive", description: "robots.txt has no 'User-agent:' line. Per RFC 9309, rules before the first User-agent line SHOULD be ignored by crawlers.", suggestion: "Add 'User-agent: *' at the top of the file." });
  }

  const firstUaIdx = parsedLines.findIndex((l) => /^user-agent\s*:/i.test(l.text));
  const linesBeforeUa = firstUaIdx > 0 ? parsedLines.slice(0, firstUaIdx) : [];
  if (linesBeforeUa.length > 0) {
    issues.push({ id: "robots-rules-before-user-agent", severity: "low", title: "Rules appear before first User-agent line", description: `${linesBeforeUa.length} line(s) appear before the first User-agent directive. Per RFC 9309, crawlers SHOULD ignore these rules.`, suggestion: "Move all directives after the first User-agent line." });
  }

  const groups: { agents: string[]; rules: { directive: string; value: string; lineNumber: number }[] }[] = [];
  let currentAgents: string[] = [];
  let currentRules: { directive: string; value: string; lineNumber: number }[] = [];
  const relevantLines = firstUaIdx >= 0 ? parsedLines.slice(firstUaIdx) : parsedLines;
  const starAgentLines: number[] = [];

  for (const line of relevantLines) {
    const colonIdx = line.text.indexOf(":");
    if (colonIdx < 0) continue;
    const directive = line.text.slice(0, colonIdx).trim();
    const rawValue = line.text.slice(colonIdx + 1).trim();
    const lowerDir = directive.toLowerCase();

    if (lowerDir === "user-agent") {
      if (currentAgents.length > 0) {
        groups.push({ agents: currentAgents, rules: currentRules });
      }
      if (rawValue === "*") {
        starAgentLines.push(line.lineNumber);
      }
      if (rawValue && !PRODUCT_TOKEN_RE.test(rawValue)) {
        issues.push({ id: `robots-invalid-token-${line.lineNumber}`, severity: "medium", title: `Invalid product token: "${rawValue}"`, description: `Line ${line.lineNumber}: "${rawValue}" contains disallowed characters. RFC 9309 allows only a-z, A-Z, 0-9, _, -, *.`, suggestion: "Use a valid product token like 'Googlebot' or '*'." });
      }
      if (!rawValue) {
        issues.push({ id: `robots-empty-user-agent-${line.lineNumber}`, severity: "low", title: "Empty User-agent value", description: `Line ${line.lineNumber}: User-agent directive has no value.`, suggestion: "Specify a user agent name or '*'." });
      }
      currentAgents = rawValue ? [rawValue] : ["*"];
      currentRules = [];
    } else if (currentAgents.length > 0) {
      if (lowerDir === "allow" || lowerDir === "disallow") {
        if (!rawValue) {
          issues.push({ id: `robots-empty-path-${line.lineNumber}`, severity: "low", title: `${directive} with empty path`, description: `Line ${line.lineNumber}: '${directive}: ' has no path. Crawlers will ignore this rule.`, suggestion: "Provide a path starting with '/'." });
        } else if (!rawValue.startsWith("/")) {
          issues.push({ id: `robots-path-no-slash-${line.lineNumber}`, severity: "medium", title: `Path does not start with /: "${rawValue}"`, description: `Line ${line.lineNumber}: '${directive}: ${rawValue}' — per RFC 9309, allow/disallow paths MUST start with '/'.`, suggestion: `Use '/${rawValue}' for an absolute path.` });
        }
        currentRules.push({ directive: lowerDir, value: rawValue, lineNumber: line.lineNumber });
      } else if (lowerDir === "crawl-delay") {
        const num = Number(rawValue);
        if (rawValue === "" || isNaN(num) || num < 0) {
          issues.push({ id: `robots-crawl-delay-invalid-${line.lineNumber}`, severity: "medium", title: "Invalid Crawl-delay value", description: `Line ${line.lineNumber}: Crawl-delay "${rawValue}" is not a valid non-negative number.`, suggestion: "Set Crawl-delay to a non-negative number (e.g., '10'). Note: Google ignores Crawl-delay." });
        }
        currentRules.push({ directive: lowerDir, value: rawValue, lineNumber: line.lineNumber });
      } else if (lowerDir === "sitemap") {
        if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(rawValue)) {
          issues.push({ id: `robots-sitemap-not-absolute-${line.lineNumber}`, severity: "medium", title: "Sitemap URL must be absolute", description: `Line ${line.lineNumber}: Sitemap URL "${rawValue}" is not absolute.`, suggestion: "Provide a full URL like 'https://example.com/sitemap.xml'." });
        }
        currentRules.push({ directive: lowerDir, value: rawValue, lineNumber: line.lineNumber });
      } else if (!KNOWN_DIRECTIVES.has(lowerDir) && !OTHER_RECORDS.has(lowerDir)) {
        issues.push({ id: `robots-unknown-directive-${line.lineNumber}`, severity: "medium", title: `Unknown directive: "${directive}"`, description: `Line ${line.lineNumber}: '${directive}' is not a recognized directive. RFC 9309 defines user-agent, allow, disallow as core directives and sitemap, crawl-delay as other records.`, suggestion: "Remove or correct this directive." });
      }
    }
  }
  if (currentAgents.length > 0) {
    groups.push({ agents: currentAgents, rules: currentRules });
  }

  if (starAgentLines.length > 1) {
    const linesStr = starAgentLines.join(", ");
    issues.push({ id: "robots-multiple-star-groups", severity: "low", title: `Multiple 'User-agent: *' groups (${starAgentLines.length})`, description: `There are ${starAgentLines.length} separate 'User-agent: *' groups at lines ${linesStr}. This creates confusing cascade behavior per RFC 9309 section 4.1.`, suggestion: "Merge all rules under a single 'User-agent: *' group." });
  }

  for (const group of groups) {
    if (group.rules.length === 0) {
      const agents = group.agents.join(", ");
      issues.push({ id: `robots-empty-group-${agents}`, severity: "low", title: `Empty rule group for "${agents}"`, description: `Group for "${agents}" has no rules. An empty group implicitly allows everything.`, suggestion: `Add Allow/Disallow rules or remove the empty group for "${agents}".` });
    }
  }

  let hasDisallowAll = false;
  let cssBlocked = false;
  let jsBlocked = false;

  for (const group of groups) {
    const affectsGooglebot = group.agents.some((a) => a === "*" || a.toLowerCase() === "googlebot");
    for (const rule of group.rules) {
      if (rule.directive === "disallow") {
        if (rule.value === "/" && group.agents.includes("*")) {
          hasDisallowAll = true;
        }
        if (affectsGooglebot) {
          if (/\.css/.test(rule.value)) cssBlocked = true;
          if (/\.js/.test(rule.value)) jsBlocked = true;
        }
      }
    }
  }

  if (hasDisallowAll) {
    issues.push({ id: "robots-disallow-all", severity: "critical", title: "Disallow: / under User-agent: * blocks entire site", description: "'Disallow: /' under 'User-agent: *' blocks all crawler access. Only intentional for private/staging sites.", suggestion: "Use 'Disallow: /private/' for selective blocking, or remove the rule for public sites." });
  }

  if (cssBlocked) {
    issues.push({ id: "robots-block-css", severity: "critical", title: "Googlebot blocked from CSS files", description: "A Disallow rule blocks CSS files for Googlebot. This harms mobile-first indexing and page rendering per Google guidelines.", suggestion: "Remove the CSS-blocking Disallow or add 'Allow: /css/' above it." });
  }

  if (jsBlocked) {
    issues.push({ id: "robots-block-js", severity: "critical", title: "Googlebot blocked from JavaScript files", description: "A Disallow rule blocks JavaScript files for Googlebot. This harms mobile-first indexing and page rendering per Google guidelines.", suggestion: "Remove the JS-blocking Disallow or add 'Allow: /js/' above it." });
  }

  for (const line of relevantLines) {
    const colonIdx = line.text.indexOf(":");
    if (colonIdx < 0) continue;
    const directive = line.text.slice(0, colonIdx).trim().toLowerCase();
    // Per RFC 9309 §2.1, only Allow/Disallow paths are URL-path patterns.
    // Sitemap URLs, Crawl-delay values, etc. use plain strings where dots and other
    // regex characters are perfectly valid.
    if (directive !== "allow" && directive !== "disallow") continue;
    const value = line.text.slice(colonIdx + 1).trim();
    if (/[.+?[\](){}\\|^]/.test(value)) {
      issues.push({ id: `robots-wildcard-misuse-${line.lineNumber}`, severity: "low", title: "Regex-like characters in robots.txt path", description: `Line ${line.lineNumber}: Path "${value}" contains regex meta-characters. RFC 9309 defines only '*' (any sequence) and '$' (end anchor) as special.`, suggestion: "Replace regex patterns with RFC 9309-compatible '*' and '$' patterns." });
    }
  }

  const hasSitemapDirective = parsedLines.some((l) => /^sitemap\s*:/i.test(l.text));
  const hasSitemapFile = files.some((f) => f.relativePath === "sitemap.xml");
  if (!hasSitemapDirective && hasSitemapFile) {
    issues.push({ id: "robots-sitemap-missing", severity: "medium", title: "Missing Sitemap directive", description: "sitemap.xml exists but robots.txt has no Sitemap directive. RFC 9309 recommends referencing the sitemap.", suggestion: "Add 'Sitemap: https://example.com/sitemap.xml' to robots.txt." });
  }

  for (const group of groups) {
    if (group.agents.some((a) => a.toLowerCase() === "googlebot")) {
      for (const rule of group.rules) {
        if (rule.directive === "crawl-delay") {
          issues.push({ id: "robots-googlebot-crawl-delay", severity: "medium", title: "Crawl-delay for Googlebot is ignored by Google", description: "Google ignores the Crawl-delay directive. Use Google Search Console to control crawl rate.", suggestion: "Remove Crawl-delay for Googlebot and configure crawl rate in Search Console." });
        }
      }
    }
  }

  const sitemapDirBlocked = groups.some((g) =>
    g.agents.includes("*") && g.rules.some((r) => r.directive === "disallow" && r.value === "/sitemap.xml")
  );
  if (sitemapDirBlocked) {
    issues.push({ id: "robots-sitemap-url-blocked", severity: "high", title: "Sitemap URL is blocked by Disallow", description: "The Sitemap URL is blocked by a Disallow rule, preventing crawlers from discovering it even if referenced.", suggestion: "Remove 'Disallow: /sitemap.xml' or add 'Allow: /sitemap.xml'." });
  }

  const score = calculateModuleScore(issues);
  const criticalCount = issues.filter((i) => i.severity === "critical").length;
  const status: ModuleResult["status"] = criticalCount > 0 ? "fail" : issues.length > 0 ? "warning" : "pass";

  return {
    moduleId: "03-robots-txt",
    moduleName: "robots.txt Analysis",
    status,
    score,
    issues,
    summary: `${issues.length} issue${issues.length !== 1 ? "s" : ""} found`,
    generatedRobots: generateRecommendedRobotsTxt(),
  };
}

function generateRecommendedRobotsTxt(): string {
  return [
    "# robots.txt - Generated by Website Diagnostic Tool",
    "User-agent: *",
    "Allow: /",
    "Allow: /css/",
    "Allow: /js/",
    "Allow: /images/",
    "# User-agent: Googlebot-Image",
    "  Allow: /images/",
    "Sitemap: https://example.com/sitemap.xml",
  ].join("\n");
}

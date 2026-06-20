import fs from "fs";
import * as cheerio from "cheerio";
import type { CrawledFile, AuditIssue, ModuleResult } from "../../types.js";
import { calculateModuleScore } from "../../scoring.js";

const VALID_CHANGEFREQ = new Set([
  "always", "hourly", "daily", "weekly", "monthly", "yearly", "never",
]);

export function auditSitemap(files: CrawledFile[]): ModuleResult {
  const issues: AuditIssue[] = [];
  const htmlFiles = files.filter((f) => f.type === "html" && !f.relativePath.startsWith(".well-known"));
  const htmlPaths = new Set(htmlFiles.map((f) => f.relativePath));

  const sitemapFiles = files.filter(
    (f) =>
      f.type === "xml" &&
      (f.relativePath === "sitemap.xml" || f.relativePath.endsWith("/sitemap.xml"))
  );

  if (sitemapFiles.length === 0) {
    issues.push({
      id: "sitemap-missing",
      severity: "critical",
      title: "sitemap.xml not found",
      description: "No sitemap.xml was found among the crawled files.",
      suggestion: "Create a sitemap.xml in the document root listing all HTML pages.",
    });
    return {
      moduleId: "02-sitemap",
      moduleName: "Sitemap Audit",
      status: "fail",
      score: calculateModuleScore(issues),
      issues,
      summary: "sitemap.xml is missing",
    };
  }

  const sitemapFile = sitemapFiles[0];
  let content: string;
  try {
    content = fs.readFileSync(sitemapFile.path, "utf-8");
  } catch {
    issues.push({
      id: "sitemap-unreadable",
      severity: "critical",
      title: "sitemap.xml cannot be read",
      description: `File ${sitemapFile.relativePath} could not be read.`,
      suggestion: "Verify the file exists and is accessible.",
    });
    return {
      moduleId: "02-sitemap",
      moduleName: "Sitemap Audit",
      status: "fail",
      score: calculateModuleScore(issues),
      issues,
      summary: "sitemap.xml is unreadable",
    };
  }

  // Max 50MB uncompressed file size
  if (sitemapFile.size > 50 * 1024 * 1024) {
    issues.push({
      id: "sitemap-size-exceeded",
      severity: "critical",
      title: "sitemap.xml exceeds 50MB size limit",
      description: `File size is ${(sitemapFile.size / (1024 * 1024)).toFixed(1)}MB, exceeding the 50MB limit.`,
      suggestion: "Split the sitemap into multiple files using a sitemap index file.",
    });
  }

  // UTF-8 encoding check
  let isUtf8 = true;
  try {
    const raw = fs.readFileSync(sitemapFile.path);
    new TextDecoder("utf-8", { fatal: true }).decode(raw);
  } catch {
    isUtf8 = false;
  }
  if (!isUtf8) {
    issues.push({
      id: "sitemap-invalid-encoding",
      severity: "critical",
      title: "sitemap.xml is not valid UTF-8",
      description: "The file contains byte sequences that are not valid UTF-8.",
      suggestion: "Re-save the sitemap as UTF-8 encoded without BOM.",
    });
  }

  // Check XML declaration
  const stripped = content.trimStart();
  const hasXmlDeclaration = /^<\?xml\s+version="1\.0"\s+encoding="UTF-8"\s*\?>/.test(stripped);
  if (!hasXmlDeclaration) {
    issues.push({
      id: "sitemap-xml-declaration",
      severity: "medium",
      title: "Missing or incorrect XML declaration",
      description: "The sitemap should start with <?xml version=\"1.0\" encoding=\"UTF-8\"?>.",
      suggestion: "Add the correct XML declaration as the first line.",
    });
  }

  // Check namespace on root <urlset>
  const hasNamespace = /<urlset[^>]*xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9"[^>]*>/.test(content);
  if (!hasNamespace) {
    issues.push({
      id: "sitemap-missing-namespace",
      severity: "high",
      title: "Missing sitemap namespace",
      description: "Root <urlset> must declare xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\".",
      suggestion: "Add xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\" to <urlset>.",
    });
  }

  // Extract <url> blocks
  const urlBlockRegex = /<url[^>]*>([\s\S]*?)<\/url>/gi;
  const urlBlocks: string[] = [];
  let blockMatch: RegExpExecArray | null;
  while ((blockMatch = urlBlockRegex.exec(content)) !== null) {
    urlBlocks.push(blockMatch[1]);
  }

  if (urlBlocks.length === 0) {
    issues.push({
      id: "sitemap-empty",
      severity: "critical",
      title: "sitemap.xml contains no URL entries",
      description: "The sitemap has no <url> elements.",
      suggestion: "Add at least one <url> entry with a <loc> child.",
    });
    return {
      moduleId: "02-sitemap",
      moduleName: "Sitemap Audit",
      status: "fail",
      score: calculateModuleScore(issues),
      issues,
      summary: "sitemap.xml is empty",
    };
  }

  // Max 50,000 URLs
  if (urlBlocks.length > 50000) {
    issues.push({
      id: "sitemap-url-limit-exceeded",
      severity: "critical",
      title: "sitemap.xml exceeds 50,000 URL limit",
      description: `The sitemap contains ${urlBlocks.length} URLs (max 50,000).`,
      suggestion: "Split the sitemap into multiple files using a sitemap index file.",
    });
  }

  const allLocs: string[] = [];
  const sitemapPathnames = new Set<string>();

  for (let i = 0; i < urlBlocks.length; i++) {
    const block = urlBlocks[i];
    const prefix = `url-entry-${i}`;

    // <loc> is required
    const locTagMatch = /<loc[^>]*>([\s\S]*?)<\/loc>/i.exec(block);
    if (!locTagMatch) {
      issues.push({
        id: `${prefix}-missing-loc`,
        severity: "high",
        title: "Missing <loc> in URL entry",
        description: `URL entry #${i + 1} is missing the required <loc> child.`,
        suggestion: "Every <url> must contain a <loc> element.",
        filePath: sitemapFile.relativePath,
      });
      continue;
    }

    const locValue = locTagMatch[1].trim();
    if (!locValue) continue;
    allLocs.push(locValue);

    // Check improper entity escaping (raw &, <, >)
    if (/[<>]/.test(locValue) || /&(?![a-zA-Z]+;|#[0-9]+;|#x[0-9a-fA-F]+;)/.test(locValue)) {
      issues.push({
        id: `${prefix}-entity-escaping`,
        severity: "high",
        title: "Improper XML entity escaping in <loc>",
        description: `"${locValue.length > 80 ? locValue.substring(0, 80) + "..." : locValue}" contains raw unescaped &, <, or >.`,
        suggestion: "Use &amp; for &, &lt; for <, and &gt; for >.",
        filePath: sitemapFile.relativePath,
      });
    }

    // Check for relative URLs (must start with http:// or https://)
    if (!/^https?:\/\//i.test(locValue)) {
      issues.push({
        id: `${prefix}-relative-url`,
        severity: "high",
        title: "Relative URL in sitemap",
        description: `"${locValue}" does not start with http:// or https://.`,
        suggestion: "Use fully qualified absolute URLs.",
        filePath: sitemapFile.relativePath,
      });
      continue;
    }

    // Validate URL structure and check length limit (2048 chars)
    try {
      const parsed = new URL(locValue);
      if (locValue.length >= 2048) {
        issues.push({
          id: `${prefix}-url-too-long`,
          severity: "high",
          title: "URL exceeds 2048 character limit",
          description: `URL #${i + 1} is ${locValue.length} characters (max 2048).`,
          suggestion: "Shorten the URL to fewer than 2048 characters.",
          filePath: sitemapFile.relativePath,
        });
      }

      let pathname = parsed.pathname.replace(/^\//, "");
      if (!pathname || pathname.endsWith("/")) pathname += "index.html";
      else if (!/\.[a-z0-9]+$/i.test(pathname)) pathname += ".html";
      sitemapPathnames.add(pathname);
    } catch {
      issues.push({
        id: `${prefix}-malformed-url`,
        severity: "high",
        title: "Malformed URL in sitemap",
        description: `"${locValue.length > 120 ? locValue.substring(0, 120) + "..." : locValue}" is not a valid URL.`,
        suggestion: "Ensure all URLs are correctly formatted absolute URLs.",
        filePath: sitemapFile.relativePath,
      });
    }

    // Check optional <lastmod> — must be W3C Datetime (ISO 8601)
    const lastmodMatch = /<lastmod[^>]*>([\s\S]*?)<\/lastmod>/i.exec(block);
    if (lastmodMatch) {
      const lastmod = lastmodMatch[1].trim();
      const iso8601 = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])(?:T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:Z|[+-](?:0[0-9]|1[0-3]):[0-5]\d))?$/;
      if (!iso8601.test(lastmod)) {
        issues.push({
          id: `${prefix}-lastmod-format`,
          severity: "medium",
          title: "Invalid <lastmod> format",
          description: `"${lastmod}" is not valid W3C Datetime (use YYYY-MM-DD or YYYY-MM-DDThh:mm:ss±hh:mm).`,
          suggestion: "Use a valid ISO 8601 / W3C Datetime format.",
          filePath: sitemapFile.relativePath,
        });
      } else {
        const dateObj = new Date(lastmod.substring(0, 10));
        const now = new Date();
        if (dateObj > now) {
          issues.push({
            id: `${prefix}-lastmod-future`,
            severity: "medium",
            title: "<lastmod> date is in the future",
            description: `"${lastmod}" is a future date.`,
            suggestion: "Use the actual last modification date.",
            filePath: sitemapFile.relativePath,
          });
        }
        const pastThreshold = new Date(now.getFullYear() - 5, now.getMonth(), now.getDate());
        if (dateObj < pastThreshold) {
          issues.push({
            id: `${prefix}-lastmod-too-old`,
            severity: "medium",
            title: "<lastmod> date is more than 5 years in the past",
            description: `"${lastmod}" is older than 5 years.`,
            suggestion: "Verify the last modification date is accurate.",
            filePath: sitemapFile.relativePath,
          });
        }
      }
    }

    // Check optional <changefreq>
    const changefreqMatch = /<changefreq[^>]*>([\s\S]*?)<\/changefreq>/i.exec(block);
    if (changefreqMatch) {
      const changefreq = changefreqMatch[1].trim().toLowerCase();
      if (!VALID_CHANGEFREQ.has(changefreq)) {
        issues.push({
          id: `${prefix}-changefreq-invalid`,
          severity: "low",
          title: "Invalid <changefreq> value",
          description: `"${changefreq}" is not a valid change frequency.`,
          suggestion: "Use one of: always, hourly, daily, weekly, monthly, yearly, never.",
          filePath: sitemapFile.relativePath,
        });
      }
    }

    // Check optional <priority>
    const priorityMatch = /<priority[^>]*>([\s\S]*?)<\/priority>/i.exec(block);
    if (priorityMatch) {
      const priorityStr = priorityMatch[1].trim();
      const priorityNum = parseFloat(priorityStr);
      if (isNaN(priorityNum) || priorityNum < 0.0 || priorityNum > 1.0) {
        issues.push({
          id: `${prefix}-priority-invalid`,
          severity: "low",
          title: "Invalid <priority> value",
          description: `"${priorityStr}" is not a valid decimal between 0.0 and 1.0.`,
          suggestion: "Use a value between 0.0 and 1.0 inclusive.",
          filePath: sitemapFile.relativePath,
        });
      }
    }
  }

  // Duplicate <loc> detection
  const locCounts = new Map<string, number>();
  for (const loc of allLocs) {
    locCounts.set(loc, (locCounts.get(loc) ?? 0) + 1);
  }
  for (const [loc, count] of locCounts) {
    if (count > 1) {
      issues.push({
        id: `sitemap-duplicate-loc-${loc.substring(0, 40).replace(/[^a-zA-Z0-9]/g, "_")}`,
        severity: "medium",
        title: "Duplicate <loc> in sitemap",
        description: `URL "${loc}" appears ${count} times.`,
        suggestion: "Remove duplicate entries — each URL must appear only once.",
        filePath: sitemapFile.relativePath,
      });
    }
  }

  // URLs in sitemap not matching any crawled HTML file
  const sitemapDir = sitemapFile.relativePath.includes("/")
    ? sitemapFile.relativePath.substring(0, sitemapFile.relativePath.lastIndexOf("/") + 1) : "";
  for (const sp of sitemapPathnames) {
    const candidates = [sp, sitemapDir + sp];
    const matched = candidates.some((c) => htmlPaths.has(c));
    if (!matched) {
      issues.push({
        id: `sitemap-url-no-html-${sp.replace(/[^a-zA-Z0-9]/g, "_")}`,
        severity: "high",
        title: "URL in sitemap has no matching HTML file",
        description: `Sitemap references "${sp}" but no corresponding HTML file was crawled.`,
        suggestion: `Create the page "${sp}" or remove it from the sitemap.`,
        filePath: sitemapFile.relativePath,
      });
    }
  }

  // HTML pages missing from sitemap (skip noindex and error pages)
  const nonIndexHtml = htmlFiles.filter((f) =>
    f.relativePath !== "index.html" &&
    (sitemapDir === "" || f.relativePath.startsWith(sitemapDir))
  );
  const noindexPathSet = new Set(htmlFiles.filter((f) => {
    try {
      const content = fs.readFileSync(f.path, "utf-8");
      const $ = cheerio.load(content);
      const robotsMeta = $('meta[name="robots"]').attr("content") || "";
      return robotsMeta.toLowerCase().includes("noindex");
    } catch { return false; }
  }).map((f) => f.relativePath));
  for (const file of nonIndexHtml) {
    if (noindexPathSet.has(file.relativePath)) continue;
    if (/^4\d{2}\.html$|^5\d{2}\.html$|^error\b/i.test(file.relativePath)) continue;
    const stripped = file.relativePath.startsWith(sitemapDir) ? file.relativePath.slice(sitemapDir.length) : file.relativePath;
    if (!sitemapPathnames.has(stripped) && !sitemapPathnames.has(file.relativePath)) {
      issues.push({
        id: `page-not-in-sitemap-${file.relativePath.replace(/[^a-zA-Z0-9]/g, "_")}`,
        severity: "high",
        title: "HTML page not listed in sitemap",
        description: `"${file.relativePath}" exists but is not in the sitemap.`,
        suggestion: `Add <url><loc>https://example.com/${file.relativePath}</loc></url> to sitemap.xml.`,
      });
    }
  }

  // Check robots.txt for sitemap reference
  const robotsFile = files.find((f) => f.relativePath === "robots.txt" || f.relativePath === sitemapDir + "robots.txt");
  if (robotsFile) {
    try {
      const robotsContent = fs.readFileSync(robotsFile.path, "utf-8");
      if (!/sitemap:/i.test(robotsContent)) {
        issues.push({
          id: "sitemap-not-in-robots-txt",
          severity: "medium",
          title: "Sitemap not referenced in robots.txt",
          description: "robots.txt exists but does not contain a Sitemap directive.",
          suggestion: "Add \"Sitemap: https://example.com/sitemap.xml\" to robots.txt.",
        });
      }
    } catch {
      // robots.txt unreadable, skip
    }
  }

  const coveredCount = htmlFiles.filter((f) => sitemapPathnames.has(f.relativePath)).length;
  const coveragePercent = htmlFiles.length > 0
    ? Math.round((coveredCount / htmlFiles.length) * 100)
    : 100;

  const score = calculateModuleScore(issues);
  const criticalCount = issues.filter((i) => i.severity === "critical").length;
  const highCount = issues.filter((i) => i.severity === "high").length;
  const status: ModuleResult["status"] =
    criticalCount > 0 ? "fail" : highCount > 0 ? "warning" : issues.length > 0 ? "warning" : "pass";

  return {
    moduleId: "02-sitemap",
    moduleName: "Sitemap Audit",
    status,
    score,
    issues,
    summary: `${issues.length} issue${issues.length !== 1 ? "s" : ""} — Coverage: ${coveragePercent}%`,
  };
}

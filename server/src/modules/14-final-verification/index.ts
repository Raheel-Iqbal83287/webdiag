import fs from "fs";
import * as cheerio from "cheerio";
import type { CrawledFile, AuditIssue, ModuleResult } from "../../types.js";
import { calculateModuleScore }from "../../scoring.js";

export function auditFinalVerification(files: CrawledFile[]): ModuleResult {
  const issues: AuditIssue[] = [];
  const htmlFiles = files.filter((f) => f.type === "html" && !f.relativePath.startsWith("node_modules") && !f.relativePath.startsWith(".well-known"));
  const filePathSet = new Set(files.map((f) => f.relativePath));
  const filePathLower = new Set(files.map((f) => f.relativePath.toLowerCase()));

  // Detect site root: if all HTML files are under one subdirectory, use that
  const htmlDirs = new Set(htmlFiles.map(f => { const i = f.relativePath.lastIndexOf("/"); return i >= 0 ? f.relativePath.slice(0, i) : ""; }).filter(d => d !== ""));
  const siteRoot = htmlDirs.size === 1 && htmlFiles.length > 0 ? [...htmlDirs][0] : "";

  // --- 1. Entry point check (look in site root) ---
  const hasIndex = siteRoot
    ? filePathLower.has(`${siteRoot}/index.html`) || filePathLower.has(`${siteRoot}/index.htm`)
    : filePathLower.has("index.html") || filePathLower.has("index.htm");
  if (!hasIndex) {
    issues.push({
      id: "final-no-index",
      severity: "critical",
      title: "No index.html entry point",
      description: "The site has no index.html — it will not load in a browser.",
      filePath: "N/A",
      suggestion: "Create an index.html as the entry point.",
    });
  }

  // --- 2. HTML parseability ---
  const unparseableFiles: string[] = [];
  for (const f of htmlFiles) {
    try {
      const content = fs.readFileSync(f.path, "utf-8");
      cheerio.load(content);
    } catch {
      unparseableFiles.push(f.relativePath);
    }
  }
  if (unparseableFiles.length > 0) {
    issues.push({
      id: "final-unparseable-html",
      severity: "critical",
      title: `${unparseableFiles.length} unparseable HTML file${unparseableFiles.length !== 1 ? "s" : ""}`,
      description: `Cannot parse: ${unparseableFiles.join(", ")}`,
      filePath: unparseableFiles[0],
      suggestion: "Fix HTML syntax to ensure valid markup.",
    });
  }

  // --- 3. All pages have title ---
  const pagesWithoutTitle = htmlFiles.filter((f) => {
    try {
      const content = fs.readFileSync(f.path, "utf-8");
      const $ = cheerio.load(content);
      return !$("title").text().trim();
    } catch { return true; }
  });
  if (pagesWithoutTitle.length > 0) {
    issues.push({
      id: "final-pages-no-title",
      severity: "high",
      title: `${pagesWithoutTitle.length} page${pagesWithoutTitle.length !== 1 ? "s" : ""} without a title`,
      description: `${pagesWithoutTitle.map((f) => f.relativePath).join(", ")} — pages need unique titles.`,
      filePath: pagesWithoutTitle[0].relativePath,
      suggestion: "Add a descriptive <title> to each page (50-60 chars).",
    });
  }

  // --- 4. All pages have H1 ---
  const pagesWithoutH1 = htmlFiles.filter((f) => {
    try {
      const content = fs.readFileSync(f.path, "utf-8");
      const $ = cheerio.load(content);
      return $("h1").length === 0;
    } catch { return true; }
  });
  if (pagesWithoutH1.length > 0) {
    issues.push({
      id: "final-pages-no-h1",
      severity: "high",
      title: `${pagesWithoutH1.length} page${pagesWithoutH1.length !== 1 ? "s" : ""} without H1`,
      description: `${pagesWithoutH1.map((f) => f.relativePath).join(", ")} — each page needs exactly one H1.`,
      filePath: pagesWithoutH1[0].relativePath,
      suggestion: "Add a single <h1> heading to each page.",
    });
  }

  // --- 5. Sitemap-to-page consistency & cross-module validation ---
  const hasSitemap = siteRoot
    ? filePathSet.has(`${siteRoot}/sitemap.xml`)
    : filePathSet.has("sitemap.xml");
  const hasRobotsTxt = siteRoot
    ? filePathSet.has(`${siteRoot}/robots.txt`)
    : filePathSet.has("robots.txt");

  // Build set of pages with noindex — they should not appear in sitemap
  const noindexPathSet = new Set(htmlFiles.filter((f) => {
    try {
      const content = fs.readFileSync(f.path, "utf-8");
      const $ = cheerio.load(content);
      const robotsMeta = $('meta[name="robots"]').attr("content") || "";
      return robotsMeta.toLowerCase().includes("noindex");
    } catch { return false; }
  }).map((f) => f.relativePath.toLowerCase()));

  if (hasSitemap) {
    let sitemapUrls: string[] = [];
    try {
      const sitemapFile = files.find((f) => siteRoot ? f.relativePath === `${siteRoot}/sitemap.xml` : f.relativePath === "sitemap.xml");
      if (sitemapFile) {
        const sitemapContent = fs.readFileSync(sitemapFile.path, "utf-8");
        const locRegex = /<loc>(.*?)<\/loc>/gi;
        let m;
        while ((m = locRegex.exec(sitemapContent)) !== null) {
          sitemapUrls.push(m[1].trim());
        }
      }

      const unmatchedUrls = sitemapUrls.filter((url) => {
        const pathPart = url.replace(/^https?:\/\/[^\/]+/, "").replace(/\/$/, "") || "/";
        const relativePath = pathPart.replace(/^\//, "");
        const possibleFiles = relativePath.endsWith(".html") || relativePath.endsWith(".htm")
          ? [relativePath]
          : relativePath === ""
            ? ["index.html"]
            : [relativePath + ".html", relativePath + ".htm", relativePath + "/index.html"];
        const siteRootPaths = siteRoot ? possibleFiles.map((f) => `${siteRoot}/${f}`) : [];
        const allPaths = [...possibleFiles, ...siteRootPaths];
        return !allPaths.some((f) => filePathLower.has(f.toLowerCase()));
      });

      if (unmatchedUrls.length > 0) {
        issues.push({
          id: "final-sitemap-mismatch",
          severity: "high",
          title: `Sitemap references ${unmatchedUrls.length} unmatched URL${unmatchedUrls.length !== 1 ? "s" : ""}`,
          description: `sitemap.xml lists URLs without matching local files (e.g., "${unmatchedUrls[0].slice(0, 60)}").`,
          filePath: "sitemap.xml",
          suggestion: "Ensure all sitemap entries correspond to actual build output pages.",
        });
      }

      const htmlPaths = htmlFiles.map((f) => f.relativePath);
      const pagesNotInSitemap = htmlPaths.filter((p) => {
        const lower = p.toLowerCase();
        if (noindexPathSet.has(lower)) return false;
        return !sitemapUrls.some((url) => {
          const urlPath = url.replace(/^https?:\/\/[^\/]+/, "").replace(/\/$/, "");
          const baseFile = urlPath === "/" || urlPath === "" ? "index.html" : urlPath.replace(/^\//, "");
          const possibleFiles = baseFile.endsWith(".html") || baseFile.endsWith(".htm")
            ? [baseFile]
            : [baseFile + ".html", baseFile + ".htm", baseFile + "/index.html"];
          const siteRootPaths = siteRoot ? possibleFiles.map((f) => `${siteRoot}/${f}`) : [];
          const allPaths = [...possibleFiles, ...siteRootPaths];
          return allPaths.some((f) => f.toLowerCase() === lower);
        });
      });

      if (pagesNotInSitemap.length > htmlFiles.length * 0.5) {
        issues.push({
          id: "final-sitemap-coverage",
          severity: "medium",
          title: `${pagesNotInSitemap.length} page${pagesNotInSitemap.length !== 1 ? "s" : ""} not in sitemap`,
          description: `${pagesNotInSitemap.length} of ${htmlFiles.length} HTML pages missing from sitemap.xml (e.g., "${pagesNotInSitemap.slice(0, 3).join(", ")}").`,
          filePath: "sitemap.xml",
          suggestion: "Include all site pages in the sitemap for complete search engine indexing.",
        });
      }
    } catch { /* skip if sitemap unreadable */ }
  } else {
    issues.push({
      id: "final-no-sitemap",
      severity: "medium",
      title: "No sitemap.xml found",
      description: "The site lacks a sitemap.xml — search engines may not discover all pages.",
      filePath: "N/A",
      suggestion: "Generate a sitemap.xml listing all site pages.",
    });
  }

  // --- 6. robots.txt existence ---
  if (!hasRobotsTxt) {
    issues.push({
      id: "final-no-robots",
      severity: "medium",
      title: "No robots.txt found",
      description: "The site lacks robots.txt — search engines may crawl unwanted areas.",
      filePath: "N/A",
      suggestion: "Add a robots.txt file with appropriate directives.",
    });
  }

  // --- 7. Favicon ---
  const hasFavicon = files.some((f) => /favicon\.(ico|png|svg)$/i.test(f.relativePath));
  if (!hasFavicon) {
    const hasFaviconLink = htmlFiles.some((f) => {
      try {
        const content = fs.readFileSync(f.path, "utf-8");
        const $ = cheerio.load(content);
        return $('link[rel="icon"], link[rel="shortcut icon"]').length > 0;
      } catch { return false; }
    });
    if (!hasFaviconLink) {
      issues.push({
        id: "final-no-favicon",
        severity: "low",
        title: "No favicon found",
        description: "The site has no favicon — browser tabs will show a default icon.",
        filePath: "N/A",
        suggestion: "Add a favicon.ico file to the site root.",
      });
    }
  }

  // --- 8. Site size assessment ---
  if (htmlFiles.length < 3) {
    issues.push({
      id: "final-few-pages",
      severity: "medium",
      title: `Small site (${htmlFiles.length} page${htmlFiles.length !== 1 ? "s" : ""})`,
      description: `Only ${htmlFiles.length} HTML page${htmlFiles.length !== 1 ? "s" : ""} found — verify this is intentional.`,
      filePath: "N/A",
      suggestion: "Ensure all pages of the site are included in the scanned directory.",
    });
  }

  // --- 9. Canonical URL consistency (skip noindex) ---
  const pagesWithoutCanonical = htmlFiles.filter((f) => {
    try {
      const content = fs.readFileSync(f.path, "utf-8");
      const $ = cheerio.load(content);
      const robotsMeta = $('meta[name="robots"]').attr("content") || "";
      if (/noindex/i.test(robotsMeta)) return false;
      return !$('link[rel="canonical"]').attr("href");
    } catch { return false; }
  });
  if (pagesWithoutCanonical.length > 0) {
    issues.push({
      id: "final-missing-canonical",
      severity: "high",
      title: `${pagesWithoutCanonical.length} page${pagesWithoutCanonical.length !== 1 ? "s" : ""} missing canonical URL`,
      description: `${pagesWithoutCanonical.map((f) => f.relativePath).slice(0, 5).join(", ")}${pagesWithoutCanonical.length > 5 ? ` and ${pagesWithoutCanonical.length - 5} more` : ""} — canonical prevents duplicate content issues.`,
      filePath: pagesWithoutCanonical[0].relativePath,
      suggestion: "Add a self-referencing <link rel='canonical'> to each page.",
    });
  }

  // --- 10. Base URL check ---
  const baseTagPages: string[] = [];
  for (const f of htmlFiles) {
    try {
      const content = fs.readFileSync(f.path, "utf-8");
      const $ = cheerio.load(content);
      const baseHref = $("base").attr("href");
      if (baseHref) {
        baseTagPages.push(f.relativePath);
      }
    } catch { /* skip */ }
  }
  if (baseTagPages.length > 0) {
    issues.push({
      id: "final-base-tag",
      severity: "high",
      title: `${baseTagPages.length} page${baseTagPages.length !== 1 ? "s" : ""} use${baseTagPages.length === 1 ? "s" : ""} <base> tag`,
      description: `Pages with <base> tag: ${baseTagPages.join(", ")} — ensure base href doesn't break relative links.`,
      filePath: baseTagPages[0],
      suggestion: "Verify the <base> href is correct and all relative links resolve properly.",
    });
  }

  // --- 11. File size > 500KB ---
  const largeFiles = htmlFiles.filter((f) => f.size > 500 * 1024);
  if (largeFiles.length > 0) {
    issues.push({
      id: "final-large-html",
      severity: "high",
      title: `${largeFiles.length} HTML file${largeFiles.length !== 1 ? "s" : ""} exceed${largeFiles.length === 1 ? "s" : ""} 500KB`,
      description: `Large files: ${largeFiles.map((f) => `${f.relativePath} (${(f.size / 1024).toFixed(0)}KB)`).join(", ")} — impacts load performance.`,
      filePath: largeFiles[0].relativePath,
      suggestion: "Optimize HTML output, reduce inline assets, or lazy-load content.",
    });
  }

  // --- 14. Missing lang attribute ---
  const pagesWithoutLang = htmlFiles.filter((f) => {
    try {
      const content = fs.readFileSync(f.path, "utf-8");
      const $ = cheerio.load(content);
      return !$("html").attr("lang");
    } catch { return false; }
  });
  if (pagesWithoutLang.length > 0) {
    issues.push({
      id: "final-missing-lang",
      severity: "low",
      title: `${pagesWithoutLang.length} page${pagesWithoutLang.length !== 1 ? "s" : ""} missing lang attribute`,
      description: `Pages without lang: ${pagesWithoutLang.map((f) => f.relativePath).slice(0, 5).join(", ")}${pagesWithoutLang.length > 5 ? ` and ${pagesWithoutLang.length - 5} more` : ""}.`,
      filePath: pagesWithoutLang[0].relativePath,
      suggestion: "Add lang='en' (or appropriate language) to the <html> element for accessibility and SEO.",
    });
  }

  // --- 15. Pages with no meta description ---
  const pagesWithoutMetaDesc = htmlFiles.filter((f) => {
    try {
      const content = fs.readFileSync(f.path, "utf-8");
      const $ = cheerio.load(content);
      const metaDesc = $('meta[name="description"]').attr("content");
      return !metaDesc || !metaDesc.trim();
    } catch { return false; }
  });
  if (pagesWithoutMetaDesc.length > 0) {
    issues.push({
      id: "final-missing-meta-desc",
      severity: "medium",
      title: `${pagesWithoutMetaDesc.length} page${pagesWithoutMetaDesc.length !== 1 ? "s" : ""} missing meta description`,
      description: `Pages without meta description: ${pagesWithoutMetaDesc.map((f) => f.relativePath).slice(0, 5).join(", ")}${pagesWithoutMetaDesc.length > 5 ? ` and ${pagesWithoutMetaDesc.length - 5} more` : ""}.`,
      filePath: pagesWithoutMetaDesc[0].relativePath,
      suggestion: "Add a unique <meta name='description'> to each page (120-158 chars).",
    });
  }

  const score = calculateModuleScore(issues);
  const criticalCount = issues.filter((i) => i.severity === "critical").length;
  const highCount = issues.filter((i) => i.severity === "high").length;
  const status: ModuleResult["status"] = criticalCount > 0 ? "fail" : highCount > 0 ? "warning" : issues.length > 0 ? "warning" : "pass";

  return {
    moduleId: "14-final-verification",
    moduleName: "Final Verification",
    status,
    score,
    issues,
    summary: `Verified ${htmlFiles.length} page${htmlFiles.length !== 1 ? "s" : ""} — ${issues.length} final issue${issues.length !== 1 ? "s" : ""}`,
  };
}

import fs from "fs";
import * as cheerio from "cheerio";
import type { CrawledFile, AuditIssue, ModuleResult } from "../../types.js";
import { calculateModuleScore } from "../../scoring.js";

const DEAD_LINK_TIMEOUT = 5_000;
const MAX_REDIRECT_HOPS = 5;
const REDIRECT_CHAIN_WARN = 3;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_REGEX = /^[+]?[\d\s\-().]{7,20}$/;

export async function auditDeadLinks(files: CrawledFile[]): Promise<ModuleResult> {
  const issues: AuditIssue[] = [];
  const htmlFiles = files.filter((f) => f.type === "html" && !f.relativePath.startsWith("node_modules") && !f.relativePath.startsWith(".well-known"));
  const filePathSet = new Set(files.map((f) => f.relativePath));

  const pageCache = new Map<string, { ids: Set<string> }>();
  for (const file of htmlFiles) {
    try {
      const content = fs.readFileSync(file.path, "utf-8");
      const $ = cheerio.load(content);
      const ids = new Set<string>();
      $("[id]").each((_i, el) => { const id = $(el).attr("id"); if (id) ids.add(id); });
      pageCache.set(file.relativePath, { ids });
    } catch {
      /* skip unreadable files */
    }
  }

  const externalChecks: Promise<void>[] = [];

  for (const file of htmlFiles) {
    const page = pageCache.get(file.relativePath);
    if (!page) continue;

    const content = fs.readFileSync(file.path, "utf-8");
    const $ = cheerio.load(content);

    $("a").each((_i, el) => {
      const href = $(el).attr("href") ?? "";
      const linkIndex = `${file.relativePath}:${_i}`;

      if (!$(el).attr("href")) {
        issues.push({
          id: `empty-href-${linkIndex}`,
          severity: "low",
          title: "Link without href attribute",
          description: `${file.relativePath}: <a> tag with no href attribute.`,
          filePath: file.relativePath,
          suggestion: "Add an href attribute or remove the anchor tag.",
        });
        return;
      }

      if (href === "") {
        issues.push({
          id: `empty-href-value-${linkIndex}`,
          severity: "low",
          title: "Empty href attribute",
          description: `${file.relativePath}: <a href=""> found.`,
          filePath: file.relativePath,
          suggestion: "Remove the link or provide a valid URL.",
        });
        return;
      }

      if (href.startsWith("javascript:") || href.startsWith("sms:")) return;

      if (href.startsWith("tel:")) {
        const phone = href.slice(4);
        if (!PHONE_REGEX.test(phone)) {
          issues.push({
            id: `invalid-tel-${linkIndex}`,
            severity: "medium",
            title: "Invalid tel: link format",
            description: `${file.relativePath}: "${href}" is not a valid phone number.`,
            filePath: file.relativePath,
            suggestion: "Use a valid international phone number format (e.g. tel:+1234567890).",
          });
        }
        return;
      }

      if (href.startsWith("mailto:")) {
        const email = href.slice(7).split("?")[0];
        if (!EMAIL_REGEX.test(email)) {
          issues.push({
            id: `invalid-mailto-${linkIndex}`,
            severity: "medium",
            title: "Invalid mailto link",
            description: `${file.relativePath}: "${href}" is not a valid email address.`,
            filePath: file.relativePath,
            suggestion: "Fix the email address in the mailto link.",
          });
        }
        return;
      }

      if (href === "#") return;

      const hashIndex = href.indexOf("#");
      const pathPart = hashIndex >= 0 ? href.slice(0, hashIndex) : href;
      const anchorPart = hashIndex >= 0 ? href.slice(hashIndex) : "";

      // Same-page anchor link
      if (!pathPart && anchorPart) {
        const targetId = anchorPart.slice(1);
        if (targetId && targetId !== "top" && !page.ids.has(targetId)) {
          issues.push({
            id: `dead-anchor-${linkIndex}`,
            severity: "high",
            title: `Broken anchor link: "${anchorPart}"`,
            description: `${file.relativePath}: target id="${targetId}" not found on the page.`,
            filePath: file.relativePath,
            suggestion: `Add id="${targetId}" to the target element or fix the link.`,
          });
        }
        return;
      }

      // External URL or protocol-relative URL
      if (href.startsWith("http:") || href.startsWith("https:") || href.startsWith("//")) {
        const fullUrl = href.startsWith("//") ? "https:" + href : href;

        try {
          new URL(fullUrl);
        } catch {
          issues.push({
            id: `invalid-url-${linkIndex}`,
            severity: "high",
            title: "Invalid URL format (RFC 3986)",
            description: `${file.relativePath}: "${href}" is not a valid URL.`,
            filePath: file.relativePath,
            suggestion: "Fix the malformed URL.",
          });
          return;
        }

        if (href.startsWith("http://")) {
          issues.push({
            id: `mixed-content-${linkIndex}`,
            severity: "high",
            title: "Mixed content: insecure HTTP link",
            description: `${file.relativePath}: "${href}" uses http:// on a page expected to be served over HTTPS.`,
            filePath: file.relativePath,
            suggestion: "Change to https:// or a protocol-relative URL (//...).",
          });
        }

        externalChecks.push(
          checkExternalLink(fullUrl, file.relativePath, linkIndex).then((issue) => {
            if (issue) issues.push(issue);
          })
        );
        return;
      }

      const resolved = pathPart.startsWith("/")
        ? pathPart.slice(1)
        : resolveRelativePath(pathPart, file.relativePath);

      if (!resolved) return;

      if (resolved === file.relativePath && !anchorPart) {
        return; // self-referencing links are intentional (breadcrumb nav, current page indicators)
      }

      if (!filePathSet.has(resolved)) {
        const isStaticAsset = /\.(css|js|json|xml|txt|png|jpg|jpeg|gif|svg|webp|ico|woff2?|ttf|eot)$/i.test(resolved);
        if (!isStaticAsset) {
          issues.push({
            id: `dead-link-${linkIndex}`,
            severity: "critical",
            title: `Dead internal link: "${href}"`,
            description: `${file.relativePath} links to "${resolved}" but the file does not exist in the crawled set.`,
            filePath: file.relativePath,
            suggestion: `Create "${resolved}" or update the link.`,
          });
        }
      }

      if (anchorPart && anchorPart !== "#") {
        const targetId = anchorPart.slice(1);
        const targetPage = pageCache.get(resolved) || page;
        if (targetId !== "top" && !targetPage.ids.has(targetId)) {
          issues.push({
            id: `broken-anchor-${linkIndex}`,
            severity: "high",
            title: `Broken anchor link: "${anchorPart}"`,
            description: `${file.relativePath}: target id="${targetId}" not found${resolved !== file.relativePath ? ` in "${resolved}"` : " on the page"}.`,
            filePath: file.relativePath,
            suggestion: `Add id="${targetId}" to the target element${resolved !== file.relativePath ? ` in "${resolved}"` : ""} or fix the link.`,
          });
        }
      }
    });
  }

  await Promise.allSettled(externalChecks);

  const score = calculateModuleScore(issues);
  const criticalCount = issues.filter((i) => i.severity === "critical").length;
  const status: ModuleResult["status"] = criticalCount > 0 ? "fail" : issues.length > 0 ? "warning" : "pass";

  return {
    moduleId: "07-dead-links",
    moduleName: "Dead Links Checker",
    status,
    score,
    issues,
    summary: `${issues.length} dead/broken link${issues.length !== 1 ? "s" : ""} found across ${htmlFiles.length} page${htmlFiles.length !== 1 ? "s" : ""}`,
  };
}

async function checkExternalLink(url: string, fromFile: string, linkIndex: string): Promise<AuditIssue | null> {
  const chain: string[] = [url];
  let currentUrl = url;

  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), DEAD_LINK_TIMEOUT);

      const response = await fetch(currentUrl, {
        method: "HEAD",
        signal: controller.signal,
        redirect: "manual",
        headers: { "User-Agent": "WebDiagTool/1.0" },
      });

      clearTimeout(timer);
      const status = response.status;

      if (status >= 200 && status < 300) {
        const hopCount = chain.length - 1;
        if (hopCount > REDIRECT_CHAIN_WARN) {
          return {
            id: `long-redirect-chain-${linkIndex}`,
            severity: hopCount >= MAX_REDIRECT_HOPS ? "critical" : "medium",
            title: `Long redirect chain (${hopCount} hops) for "${url}"`,
            description: `${fromFile}: "${url}" required ${hopCount} redirects to reach "${currentUrl}".`,
            filePath: fromFile,
            suggestion: "Update the link to point directly to the final URL to reduce redirects.",
          };
        }
        return null;
      }

      if (status >= 300 && status < 400) {
        const location = response.headers.get("location");
        if (!location) {
          return {
            id: `redirect-no-location-${linkIndex}`,
            severity: "high",
            title: `Redirect with no Location header (HTTP ${status})`,
            description: `${fromFile}: "${currentUrl}" returned HTTP ${status} without a Location header.`,
            filePath: fromFile,
            suggestion: "Verify the redirect target on the server.",
          };
        }

        const resolvedLocation = location.startsWith("http")
          ? location
          : new URL(location, currentUrl).href;

        if (chain.includes(resolvedLocation)) {
          return {
            id: `redirect-loop-${linkIndex}`,
            severity: "critical",
            title: "Redirect loop detected",
            description: `${fromFile}: "${url}" is caught in a redirect loop. Chain: ${chain.join(" → ")} → ${resolvedLocation}`,
            filePath: fromFile,
            suggestion: "Fix the redirect configuration on the server to eliminate the loop.",
          };
        }

        chain.push(resolvedLocation);
        currentUrl = resolvedLocation;
        continue;
      }

      return null; // all HTTP status checks on external links are skipped — only the site owner can verify
    } catch (err) {
      return null; // timeouts and unreachable are transient — skip
    }
  }

  return {
    id: `redirect-limit-${linkIndex}`,
    severity: "critical",
    title: `Redirect chain exceeded ${MAX_REDIRECT_HOPS} hops`,
    description: `${fromFile}: "${url}" exceeded ${MAX_REDIRECT_HOPS} redirect hops. Chain: ${chain.join(" → ")}`,
    filePath: fromFile,
    suggestion: "Update the link to point directly to the final destination.",
  };
}

function resolveRelativePath(target: string, fromFile: string): string | null {
  const dir = fromFile.includes("/") ? fromFile.substring(0, fromFile.lastIndexOf("/")) : "";
  const segments = dir ? dir.split("/") : [];
  const parts = target.split("/");
  for (const part of parts) {
    if (part === "..") { if (segments.length > 0) segments.pop(); }
    else if (part !== ".") segments.push(part);
  }
  return segments.join("/") || null;
}

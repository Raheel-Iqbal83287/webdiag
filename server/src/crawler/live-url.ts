import * as cheerio from "cheerio";
import type { CrawledFile } from "../types.js";

const MAX_DEPTH = 3;
const MAX_PAGES = 50;
const REQUEST_TIMEOUT = 10000;

interface CrawlState {
  visited: Set<string>;
  files: CrawledFile[];
  baseUrl: string;
  baseHost: string;
  errors: string[];
}

export async function crawlUrl(startUrl: string): Promise<{ files: CrawledFile[]; errors: string[] }> {
  // Normalize URL
  const normalizedUrl = startUrl.endsWith("/") ? startUrl.slice(0, -1) : startUrl;
  let urlObj: URL;
  try { urlObj = new URL(normalizedUrl); }
  catch { return { files: [], errors: [`Invalid URL: ${startUrl}`] }; }

  const state: CrawlState = {
    visited: new Set(),
    files: [],
    baseUrl: normalizedUrl,
    baseHost: urlObj.hostname,
    errors: [],
  };

  await crawlPage(normalizedUrl, state, 0);

  return { files: state.files, errors: state.errors };
}

async function crawlPage(url: string, state: CrawlState, depth: number): Promise<void> {
  if (state.visited.has(url)) return;
  if (state.visited.size >= MAX_PAGES) return;
  if (depth > MAX_DEPTH) return;

  state.visited.add(url);

  let html: string;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "WebDiagTool/1.0" },
    });
    clearTimeout(timer);

    if (!response.ok) {
      state.errors.push(`HTTP ${response.status} for ${url}`);
      return;
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
      return;
    }

    html = await response.text();
  } catch (err) {
    state.errors.push(`Failed to fetch ${url}: ${err instanceof Error ? err.message : "Unknown error"}`);
    return;
  }

  // Determine relative path
  const urlPath = new URL(url).pathname;
  const relativePath = urlPath === "/" ? "index.html" : urlPath.replace(/^\//, "").replace(/\/$/, "") || "index.html";
  const finalPath = relativePath.endsWith(".html") || relativePath.endsWith(".htm") ? relativePath : relativePath + "/index.html";

  state.files.push({
    path: url,
    relativePath: finalPath,
    type: "html",
    size: html.length,
  });

  // Parse links for further crawling
  if (depth < MAX_DEPTH) {
    const $ = cheerio.load(html);
    const links = new Set<string>();

    $("a[href]").each((_i, el) => {
      const href = $(el).attr("href") || "";
      try {
        const resolved = new URL(href, url);
        if (resolved.hostname === state.baseHost && !resolved.hash && !href.startsWith("mailto:") && !href.startsWith("tel:") && !href.startsWith("javascript:")) {
          const normalized = resolved.origin + resolved.pathname.replace(/\/$/, "");
          if (!normalized.includes("#")) links.add(normalized);
        }
      } catch { /* skip invalid URLs */ }
    });

    const linkPromises = Array.from(links).map((link) => crawlPage(link, state, depth + 1));
    await Promise.allSettled(linkPromises);
  }
}

import fs from "fs";
import path from "path";
import type { CrawledFile } from "../types.js";

const EXTENSION_MAP: Record<string, CrawledFile["type"]> = {
  ".html": "html", ".htm": "html", ".css": "css", ".js": "js",
  ".jsx": "js", ".ts": "js", ".tsx": "js",
  ".jpg": "image", ".jpeg": "image", ".png": "image", ".gif": "image",
  ".svg": "image", ".webp": "image", ".ico": "image",
  ".xml": "xml", ".txt": "txt",
};

const IGNORE_DIRS = new Set(["node_modules", ".git", ".svn", "__pycache__", ".turbo", "dist", "build", "client", "server"]);

// Per RFC 8615, .well-known is a standard directory for well-known URIs and must be accessible.
const ALLOWED_DOT_DIRS = new Set([".well-known"]);

export async function crawlLocalFolder(rootPath: string): Promise<CrawledFile[]> {
  const files: CrawledFile[] = [];

  function walk(dir: string) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch { return; }

    for (const entry of entries) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      if (entry.name.startsWith(".") && !ALLOWED_DOT_DIRS.has(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        const type = EXTENSION_MAP[ext] ?? "other";
        try {
          const stat = fs.statSync(fullPath);
          files.push({
            path: fullPath,
            relativePath: path.relative(rootPath, fullPath).replace(/\\/g, "/"),
            type, size: stat.size,
            lastModified: stat.mtime.toISOString(),
          });
        } catch { /* file may have been deleted between readdir and stat */ }
      }
    }
  }

  walk(rootPath);
  return files;
}

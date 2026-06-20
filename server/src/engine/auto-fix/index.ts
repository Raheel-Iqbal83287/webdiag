import fs from "fs";
import path from "path";
import type { AuditIssue, CrawledFile } from "../../types.js";
import * as Fix from "./fixer.js";
import type { FixResult, AutoFixOptions } from "./fixer.js";

const BACKUP_DIR = path.join(process.cwd(), "data", "backups");

const FIX_DISPATCH: Record<string, (filePath: string, content: string, relativePath?: string, issueId?: string) => string | null> = {
  "doctype-": (fp, c) => Fix.fixDoctype(fp, c),
  "lang-": (fp, c) => Fix.fixHtmlLang(fp, c),
  "missing-lang-": (fp, c) => Fix.fixHtmlLang(fp, c),
  "invalid-lang-": (fp, c) => Fix.fixHtmlLang(fp, c),
  "metadesc-": (fp, c) => Fix.fixMetaDescription(fp, c),
  "viewport-zoom-lock-": (fp, c) => Fix.fixViewportZoomLock(fp, c),
  "viewport-": (fp, c) => Fix.fixViewportMeta(fp, c),
  "canonical-": (fp, c, rp) => Fix.fixCanonical(fp, c, rp || ""),
  "h1-missing-": (fp, c) => Fix.fixMissingH1(fp, c),
  "img-missing-alt-": (fp, c) => Fix.fixImageAlt(fp, c),
  "img-filename-alt-": (fp, c) => Fix.fixImageFilenameAlt(fp, c),
  "bypass-block-missing-": (fp, c) => Fix.fixSkipNav(fp, c),
  "metarobots-missing-": (fp, c) => Fix.fixRobotsMeta(fp, c),
  "stale-copyright-": (fp, c) => Fix.fixStaleCopyright(fp, c),
  "box-sizing-missing-": (fp, c) => Fix.fixBoxSizingCss(fp, c),
  "font-display-missing": (fp, c) => Fix.fixFontDisplay(fp, c),
  "render-blocking-css-": (fp, c, rp, id) => Fix.fixRenderBlockingCss(fp, c, rp, id),
  "missing-preconnect-": (fp, c, rp, id) => Fix.fixMissingPreconnect(fp, c, rp, id),
  "missing-fetchpriority-": (fp, c) => Fix.fixMissingFetchPriority(fp, c),
  "focus-styles-missing": (fp, c) => Fix.fixFocusStyles(fp, c),
  "reduced-motion-missing": (fp, c) => Fix.fixReducedMotion(fp, c),
  "iframe-no-dimensions-": (fp, c, rp, id) => Fix.fixIframeDimensions(fp, c, rp, id),
  "sri-missing-": (fp, c) => Fix.fixMissingSRI(fp, c),
  "sri-crossorigin-": (fp, c) => Fix.fixMissingSRI(fp, c),
  "missing-sri-": (fp, c) => Fix.fixMissingSRI(fp, c),
  "csp-unsafe-inline-": (fp, c) => Fix.fixCspUnsafeInline(fp, c),
  "csp-unsafe-eval-": (fp, c) => Fix.fixCspUnsafeEval(fp, c),
  "csp-missing-": (fp, c, rp, id) => Fix.fixCspMissingDirective(fp, c, rp, id),
  "no-csp-": (fp, c) => Fix.fixNoCsp(fp, c),
  "missing-nosniff-header": (fp, c) => Fix.fixMissingNosniff(fp, c),
  "missing-hsts-header": (fp, c) => Fix.fixMissingHsts(fp, c),
  "clickjacking-missing-protection": (fp, c) => Fix.fixClickjackingProtection(fp, c),
  "inline-event-": (fp, c) => Fix.fixInlineEventHandler(fp, c),
  "missing-main-": (fp, c) => Fix.fixMissingMain(fp, c),
  "missing-title-": (fp, c) => Fix.fixMissingTitle(fp, c),
  "field-no-label-": (fp, c) => Fix.fixFieldNoLabel(fp, c),
  "button-no-name-": (fp, c) => Fix.fixButtonNoName(fp, c),
  "iframe-no-title-": (fp, c) => Fix.fixIframeTitle(fp, c),
  "link-no-text-": (fp, c) => Fix.fixLinkNoText(fp, c),
  "img-no-dimensions-": (fp, c) => Fix.fixImageDimensions(fp, c),
  "video-no-dimensions-": (fp, c) => Fix.fixVideoDimensions(fp, c),
  "input-image-alt-": (fp, c) => Fix.fixImageAlt(fp, c),
  "render-blocking-js-head-": (fp, c) => Fix.fixRenderBlockingJs(fp, c),
  "render-blocking-js-": (fp, c) => Fix.fixRenderBlockingJs(fp, c),
  "body-sync-script-": (fp, c) => Fix.fixBodySyncScript(fp, c),
  "sync-script-body-": (fp, c) => Fix.fixBodySyncScript(fp, c),
  "javascript-uri-": (fp, c) => Fix.fixJavaScriptUri(fp, c),
  "form-http-": (fp, c) => Fix.fixFormHttp(fp, c),
  "iframe-no-sandbox-": (fp, c) => Fix.fixIframeSandbox(fp, c),
  "invalid-autocomplete-": (fp, c) => Fix.fixInvalidAutocomplete(fp, c),
  "autocomplete-not-off-": (fp, c) => Fix.fixInvalidAutocomplete(fp, c),
  "title-outside-head-": (fp, c) => Fix.fixTitleOutsideHead(fp, c),
  "title-multiple-": (fp, c) => Fix.fixTitleOutsideHead(fp, c),
  "title-long-": (fp, c) => Fix.fixTitleLongShort(fp, c),
  "title-short-": (fp, c) => Fix.fixTitleLongShort(fp, c),
  "empty-btn-": (fp, c) => Fix.fixButtonNoName(fp, c),
  "void-element-": (fp, c) => Fix.fixVoidElement(fp, c),
  "self-closing-": (fp, c) => Fix.fixSelfClosing(fp, c),
  "nesting-": (fp, c) => Fix.fixNesting(fp, c),
  "heading-skip-": (fp, c) => Fix.fixHeadingSkip(fp, c),
  "svg-no-name-": (fp, c) => Fix.fixSvgNoName(fp, c),
  "empty-heading-": (fp, c) => Fix.fixEmptyHeading(fp, c),
  "generic-link-text-": (fp, c) => Fix.fixGenericLinkText(fp, c),
  "jsonld-missing-": (fp, c) => Fix.fixJsonLd(fp, c),
  "author-schema-missing": (fp, c) => Fix.fixAuthorJsonLd(fp, c),
  "empty-href-": (fp, c) => Fix.fixEmptyHref(fp, c),
  "email-disclosure-": (fp, c) => Fix.fixEmailDisclosure(fp, c),
  "table-overflow-": (fp, c) => Fix.fixTableOverflow(fp, c),
  "page-not-in-sitemap-": (_fp, _c) => null,
  "robots-wildcard-misuse-": (_fp, _c) => null,
  "missing-security-txt": (_fp, _c) => null,
};

export function canAutoFix(issue: AuditIssue, files: CrawledFile[]): boolean {
  for (const [prefix] of Object.entries(FIX_DISPATCH)) {
    if (issue.id.startsWith(prefix)) {
      if (issue.filePath && issue.filePath !== "N/A" && issue.filePath !== "CSS (global)") {
        return files.some((f) => f.relativePath === issue.filePath || f.path === issue.filePath);
      }
      if (issue.filePath === "CSS (global)") return files.some((f) => f.type === "css");
      return true;
    }
  }
  return false;
}

export async function autoFix(issues: AuditIssue[], files: CrawledFile[], options: AutoFixOptions = {}): Promise<FixResult[]> {
  const results: FixResult[] = [];
  const dryRun = options.dryRun ?? true;
  const backupDir = options.backupDir || BACKUP_DIR;

  // Pre-compute SRI hashes for external resources
  await Fix.precomputeSriHashes(files);

  for (const issue of issues) {
    // Special-case fixers that create/modify non-HTML files
    if (issue.id === "missing-security-txt") {
      results.push(Fix.fixCreateSecurityTxt(files, issue.id, backupDir));
      continue;
    }
    if (issue.id.startsWith("page-not-in-sitemap-")) {
      results.push(Fix.fixSitemapAddPage(files, issue.id, backupDir));
      continue;
    }
    if (issue.id.startsWith("robots-wildcard-misuse-")) {
      results.push(Fix.fixRobotsTxtWildcard(files, issue.id, backupDir));
      continue;
    }
    const matcher = Object.entries(FIX_DISPATCH).find(([prefix]) => issue.id.startsWith(prefix));
    if (!matcher) continue;

    const [, fixFn] = matcher;
    let targetFile = issue.filePath || "";

    // Resolve actual file path
    let fileEntry: CrawledFile | undefined;
    if (targetFile === "CSS (global)") {
      fileEntry = files.find((f) => f.type === "css");
      if (!fileEntry) fileEntry = files.find((f) => f.type === "html");
      if (fileEntry) targetFile = fileEntry.relativePath;
    } else {
      fileEntry = files.find((f) => f.relativePath === targetFile || f.path === targetFile);
    }

    if (!fileEntry) {
      // For global issues (N/A), fall back to the first HTML file
      if (targetFile === "N/A" || !targetFile) {
        const htmlFile = files.find((f) => f.type === "html");
        if (htmlFile) {
          fileEntry = htmlFile;
          targetFile = htmlFile.relativePath;
        }
      }
    }

    if (!fileEntry) {
      results.push({ filePath: targetFile, issueId: issue.id, success: false, description: `File not found: ${targetFile}`, error: "File not found in crawl results" });
      continue;
    }

    const absolutePath = fileEntry.path;

    try {
      const content = fs.readFileSync(absolutePath, "utf-8");
      const updated = fixFn(absolutePath, content, fileEntry.relativePath, issue.id);

      if (updated === null || updated === content) {
        results.push({ filePath: targetFile, issueId: issue.id, success: true, description: "No fix needed — issue may have been resolved already" });
        continue;
      }

      const diff = Fix.generateDiff(content, updated, targetFile);

      if (dryRun) {
        results.push({ filePath: targetFile, issueId: issue.id, success: true, description: `Dry-run: fix would be applied to ${targetFile}`, diff });
      } else {
        // Backup original
        const backupPath = Fix.backupFile(absolutePath, backupDir);

        // Apply fix
        const applied = Fix.applyFix(absolutePath, updated);

        if (applied) {
          results.push({
            filePath: targetFile,
            issueId: issue.id,
            success: true,
            description: `Fixed ${targetFile}${backupPath ? ` (backup: ${path.relative(process.cwd(), backupPath)})` : ""}`,
            diff,
          });
        } else {
          results.push({ filePath: targetFile, issueId: issue.id, success: false, description: `Failed to write ${targetFile}`, error: "Write permission denied" });
        }
      }
    } catch (err) {
      results.push({ filePath: targetFile, issueId: issue.id, success: false, description: `Error fixing ${targetFile}`, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return results;
}

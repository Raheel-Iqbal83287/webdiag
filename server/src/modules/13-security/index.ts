import fs from "fs";
import * as cheerio from "cheerio";
import type { CrawledFile, AuditIssue, ModuleResult } from "../../types.js";
import { calculateModuleScore } from "../../scoring.js";

const SECRET_PATTERNS = [
  { regex: /(?:api[_-]?key|apikey|api[_-]?secret)\s*[:=]\s*["']?[\w-]{16,}["']?/i, label: "API key" },
  { regex: /(?:sk[-_]?live|pk[-_]?live|sk[-_]?test|pk[-_]?test)[_-][A-Za-z0-9]{10,}/i, label: "Stripe live/test key" },
  { regex: /(?:password|passwd|pwd)\s*[:=]\s*["'][^"']+["']/i, label: "Password" },
  { regex: /(?:db[_-]?pass|dbpassword)\s*[:=]\s*["'][^"']+["']/i, label: "Database password" },
  { regex: /(?:secret|token)\s*[:=]\s*["'][A-Za-z0-9_\-\.]{16,}["']/i, label: "Secret/token" },
  { regex: /(?:AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY)\s*[:=]\s*["']?[A-Za-z0-9\/+=]{16,}["']?/i, label: "AWS credential" },
  { regex: /(?:eyJ[A-Za-z0-9_\-]+\.eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+)/i, label: "JWT token" },
  { regex: /-----BEGIN\s+RSA\s+PRIVATE\s+KEY-----/, label: "RSA private key" },
  { regex: /-----BEGIN\s+(EC|DSA|OPENSSH)\s+PRIVATE\s+KEY-----/, label: "Private key" },
  { regex: /(?:mysql|postgresql|mongodb(?:\+srv)?):\/\/[^\s"']+/, label: "Database connection string" },
  { regex: /(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}/, label: "GitHub token" },
];

const KNOWN_CDNS = [
  "cdnjs.cloudflare.com", "ajax.googleapis.com", "cdn.jsdelivr.net",
  "maxcdn.bootstrapcdn.com", "stackpath.bootstrapcdn.com",
  "unpkg.com", "cdn.tailwindcss.com", "cdn.jsdelivr.net",
  "fonts.googleapis.com", "code.jquery.com",
];

const SENSITIVE_EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const INTERNAL_IP_PATTERN = /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})\b/g;
const INTERNAL_PATH_PATTERN = /(?:\\\\[^\\]+\\[^\\]+|(?:\/[a-z]+\/)*(?:internal|private|secret|confidential|admin)\b)/gi;
const TODO_SECURITY_PATTERN = /\b(?:TODO|FIXME|HACK|XXX|FIX|BUG|WORKAROUND)\b[\s\S]{0,80}(?:security|vuln|csrf|xss|sqli|inject|sanitize|auth|password|secret|unsafe|hack|exploit)/gi;

const OPEN_REDIRECT_PARAMS = /\b(?:redirect[=_ ]|next[=_ ]|url[=_ ]|return[=_ ]|returnurl[=_ ]|return_to[=_ ]|dest[=_ ]|destination[=_ ]|target[=_ ]|goto[=_ ]|continue[=_ ]|forward[=_ ])\b/i;

const COOKIE_FLAGS_PATTERN = /document\.cookie\s*=/;
const SECURE_FLAG = /\bSecure\b/;
const HTTPONLY_FLAG = /\bHttpOnly\b/;
const SAMESITE_FLAG = /\bSameSite=(?:Strict|Lax|None)\b/;

function isLikelyCDN(url: string): boolean {
  return KNOWN_CDNS.some((cdn) => url.includes(cdn));
}

function homoglyphDistance(a: string, b: string): number {
  if (a.length !== b.length) return 9;
  let diff = 0;
  for (let i = 0; i < a.length; i++) { if (a[i] !== b[i]) diff++; }
  return diff;
}

function hasTyposquatting(url: string): string | null {
  const hostname = url.replace(/^https?:\/\//, "").split("/")[0].toLowerCase();
  for (const cdn of KNOWN_CDNS) {
    if (homoglyphDistance(hostname, cdn) === 1) return hostname;
  }
  return null;
}

function getLineNumber(content: string, index: number): number {
  try { return content.slice(0, index).split("\n").length; } catch { return 1; }
}

export function auditSecurity(files: CrawledFile[]): ModuleResult {
  const issues: AuditIssue[] = [];
  const seen = new Set<string>();

  const textFiles = files.filter((f) =>
    /\.(html?|js|css|json|xml|txt|yml|yaml|env|config|ini|cfg|md|php|asp|aspx|py|rb|java|ts|jsx|tsx|mjs|cjs|vue|svelte)$/i.test(f.relativePath) &&
    !f.relativePath.includes("node_modules") &&
    !f.relativePath.includes(".git") &&
    !f.relativePath.startsWith(".well-known")
  );

  const htmlFiles = files.filter((f) => f.type === "html" && !f.relativePath.startsWith("node_modules") && !f.relativePath.startsWith(".well-known"));

  // --- 1. Secret scanning in all text files (OWASP A02, A05, A07) ---
  for (const file of textFiles) {
    let content: string;
    try { content = fs.readFileSync(file.path, "utf-8"); } catch { continue; }
    for (const { regex, label } of SECRET_PATTERNS) {
      const match = content.match(regex);
      if (match) {
        const lineNum = getLineNumber(content, match.index!);
        const dedupKey = `${file.relativePath}-secrets-${label}`;
        if (seen.has(dedupKey)) continue;
        seen.add(dedupKey);
        issues.push({
          id: `secret-exposed-${file.relativePath}-${label.toLowerCase().replace(/\s+/g, "-")}`,
          severity: "critical",
          title: `Potential secret exposed: ${label}`,
          description: `${file.relativePath}:${lineNum} may contain a ${label} — "${match[0].slice(0, 60)}".`,
          filePath: file.relativePath,
          lineNumber: lineNum,
          suggestion: "Remove secrets from source code; use environment variables, vaults, or CI/CD secrets.",
        });
      }
    }
  }

  // --- JS-specific scans: eval(), new Function(), document.write() (OWASP A03) ---
  for (const file of textFiles) {
    if (!/\.(js|ts|jsx|tsx|mjs|cjs|vue|svelte|html?)$/i.test(file.relativePath)) continue;
    let content: string;
    try { content = fs.readFileSync(file.path, "utf-8"); } catch { continue; }

    // eval() detection
    const evalMatches = content.matchAll(/\beval\s*\(/g);
    for (const match of evalMatches) {
      const dedupKey = `${file.relativePath}-eval-${match.index}`;
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);
      issues.push({
        id: `eval-usage-${file.relativePath}`,
        severity: "critical",
        title: "eval() usage detected",
        description: `${file.relativePath}:${getLineNumber(content, match.index!)} — use of eval() can lead to code injection.`,
        filePath: file.relativePath,
        lineNumber: getLineNumber(content, match.index!),
        suggestion: "Avoid eval(); use JSON.parse, Function constructor alternatives, or safer patterns.",
      });
    }

    // new Function() detection
    const funcMatches = content.matchAll(/\bnew\s+Function\s*\(/g);
    for (const match of funcMatches) {
      const dedupKey = `${file.relativePath}-newfunc-${match.index}`;
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);
      issues.push({
        id: `new-function-${file.relativePath}`,
        severity: "critical",
        title: "new Function() usage detected",
        description: `${file.relativePath}:${getLineNumber(content, match.index!)} — dynamic code evaluation similar to eval().`,
        filePath: file.relativePath,
        lineNumber: getLineNumber(content, match.index!),
        suggestion: "Replace new Function() with safer alternatives like pre-defined functions.",
      });
    }

    // setTimeout/setInterval with string argument
    const setTimeoutMatches = content.matchAll(/(?:setTimeout|setInterval)\s*\(\s*["']/g);
    for (const match of setTimeoutMatches) {
      const dedupKey = `${file.relativePath}-timeout-str-${match.index}`;
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);
      issues.push({
        id: `timer-string-${file.relativePath}`,
        severity: "critical",
        title: "setTimeout/setInterval with string argument",
        description: `${file.relativePath}:${getLineNumber(content, match.index!)} — passing a string to setTimeout/setInterval is an eval() risk.`,
        filePath: file.relativePath,
        lineNumber: getLineNumber(content, match.index!),
        suggestion: "Pass a function reference instead of a string to setTimeout/setInterval.",
      });
    }

    // document.write() detection
    const dwMatches = content.matchAll(/\bdocument\.write\s*\(/g);
    for (const match of dwMatches) {
      const dedupKey = `${file.relativePath}-docwrite-${match.index}`;
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);
      issues.push({
        id: `document-write-${file.relativePath}`,
        severity: "critical",
        title: "document.write() usage detected",
        description: `${file.relativePath}:${getLineNumber(content, match.index!)} — deprecated, blocks rendering, and is a security risk.`,
        filePath: file.relativePath,
        lineNumber: getLineNumber(content, match.index!),
        suggestion: "Use DOM manipulation methods like innerHTML, textContent, or createElement instead.",
      });
    }
  }

  // --- Scan text files for sensitive comments (OWASP A05) ---
  for (const file of textFiles) {
    if (!/\.(html?|js|ts|jsx|tsx|php|asp|aspx|py|rb|java|vue|svelte|txt)$/i.test(file.relativePath)) continue;
    let content: string;
    try { content = fs.readFileSync(file.path, "utf-8"); } catch { continue; }

    // Security-related TODOs
    const todoMatches = content.matchAll(TODO_SECURITY_PATTERN);
    for (const match of todoMatches) {
      const dedupKey = `${file.relativePath}-todo-${match.index}`;
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);
      issues.push({
        id: `sensitive-comment-${file.relativePath}`,
        severity: "medium",
        title: "Comment references security-sensitive TODO/FIXME",
        description: `${file.relativePath}:${getLineNumber(content, match.index!)} — comment mentions security-related concern: "${match[0].slice(0, 80)}".`,
        filePath: file.relativePath,
        lineNumber: getLineNumber(content, match.index!),
        suggestion: "Review and resolve security-related TODOs before deployment.",
      });
    }

    // Internal IPs in comments
    const strippedComments = content.match(/<!--[\s\S]*?-->/g) || [];
    for (const comment of strippedComments) {
      const ipMatches = comment.matchAll(INTERNAL_IP_PATTERN);
      for (const match of ipMatches) {
        const idx = content.indexOf(comment);
        const dedupKey = `${file.relativePath}-ip-${idx}-${match[0]}`;
        if (seen.has(dedupKey)) continue;
        seen.add(dedupKey);
        issues.push({
          id: `internal-ip-comment-${file.relativePath}`,
          severity: "medium",
          title: "Internal IP address exposed in comment",
          description: `${file.relativePath} exposes internal IP "${match[0]}" in a comment.`,
          filePath: file.relativePath,
          suggestion: "Remove internal IP addresses from code comments.",
        });
      }
    }

    // Internal paths in comments
    for (const comment of strippedComments) {
      const pathMatches = comment.matchAll(INTERNAL_PATH_PATTERN);
      for (const match of pathMatches) {
        const idx = content.indexOf(comment);
        const dedupKey = `${file.relativePath}-path-${idx}-${match[0].slice(0, 20)}`;
        if (seen.has(dedupKey)) continue;
        seen.add(dedupKey);
        issues.push({
          id: `internal-path-comment-${file.relativePath}`,
          severity: "medium",
          title: "Internal system path exposed in comment",
          description: `${file.relativePath} exposes internal path "${match[0].slice(0, 60)}" in a comment.`,
          filePath: file.relativePath,
          suggestion: "Remove internal system paths from code comments.",
        });
      }
    }
  }

  // --- HTML-specific checks ---
  for (const file of htmlFiles) {
    let content: string;
    try { content = fs.readFileSync(file.path, "utf-8"); } catch { continue; }

    const $ = cheerio.load(content);

    // --- 3. javascript: URIs (OWASP A03) ---
    $('a[href^="javascript:"], area[href^="javascript:"], *[href^="javascript:"]').each((_i, el) => {
      const dedupKey = `${file.relativePath}-jsuri-${_i}`;
      if (seen.has(dedupKey)) return;
      seen.add(dedupKey);
      issues.push({
        id: `javascript-uri-${file.relativePath}-${_i}`,
        severity: "high",
        title: "javascript: URI in link",
        description: `${file.relativePath}: link uses javascript: pseudo-protocol — XSS risk.`,
        filePath: file.relativePath,
        suggestion: "Use unobtrusive JavaScript with addEventListener in external files.",
      });
    });

    // --- 4. Missing SRI on external resources (OWASP A08) ---
    $('script[src], link[rel="stylesheet"][href]').each((_i, el) => {
      const src = $(el).attr("src") || $(el).attr("href") || "";
      if ((src.startsWith("http") || src.startsWith("//")) && !$(el).attr("integrity") &&
          !/googlesyndication|doubleclick\.net|google-analytics|googletagmanager/i.test(src)) {
        const isCDN = isLikelyCDN(src);
        const suspicious = hasTyposquatting(src);
        const dedupKey = `${file.relativePath}-sri-${src}`;
        if (seen.has(dedupKey)) return;
        seen.add(dedupKey);

        if (suspicious) {
          issues.push({
            id: `typosquatting-cdn-${file.relativePath}-${_i}`,
            severity: "high",
            title: "Suspicious CDN domain (possible typosquatting)",
            description: `${file.relativePath}: "${src}" uses suspicious domain "${suspicious}" similar to a known CDN.`,
            filePath: file.relativePath,
            suggestion: `Verify the domain "${suspicious}" is legitimate; it may be a typosquatting attack.`,
          });
        }

        issues.push({
          id: `missing-sri-${file.relativePath}-${_i}`,
          severity: isCDN ? "high" : "medium",
          title: `External resource missing integrity attribute${isCDN ? " (CDN)" : ""}`,
          description: `${file.relativePath}: ${src} loaded without subresource integrity.`,
          filePath: file.relativePath,
          suggestion: 'Add integrity="sha384-..." and crossorigin="anonymous" to external resources.',
        });
      }
    });

    // --- 5. Form over HTTP (OWASP A02) ---
    $('form[action^="http://"]').each((_i, el) => {
      const dedupKey = `${file.relativePath}-form-http-${_i}`;
      if (seen.has(dedupKey)) return;
      seen.add(dedupKey);
      issues.push({
        id: `form-http-${file.relativePath}-${_i}`,
        severity: "critical",
        title: "Form submits over HTTP",
        description: `${file.relativePath}: form action uses http:// — sensitive data sent in plaintext.`,
        filePath: file.relativePath,
        suggestion: "Change form action to use HTTPS.",
      });
    });

    // --- 11. Form action validation ---
    $("form").each((_i, el) => {
      const action = $(el).attr("action") || "";
      if (!action || action.trim() === "") {
        const dedupKey = `${file.relativePath}-form-no-action-${_i}`;
        if (seen.has(dedupKey)) return;
        seen.add(dedupKey);
        issues.push({
          id: `form-no-action-${file.relativePath}-${_i}`,
          severity: "medium",
          title: "Form missing action attribute",
          description: `${file.relativePath}: form has no action — submits to current URL, may cause unexpected behavior.`,
          filePath: file.relativePath,
          suggestion: "Always set an explicit action attribute on forms.",
        });
      } else if (action.startsWith("http://")) {
        const dedupKey = `${file.relativePath}-form-http-action-${_i}`;
        if (seen.has(dedupKey)) return;
        seen.add(dedupKey);
        issues.push({
          id: `form-http-action-${file.relativePath}-${_i}`,
          severity: "medium",
          title: "Form action uses absolute HTTP URL",
          description: `${file.relativePath}: form action "${action}" is an absolute HTTP URL.`,
          filePath: file.relativePath,
          suggestion: "Use relative paths or HTTPS URLs for form actions.",
        });
      }
    });

    // --- 6. Iframe without sandbox (OWASP A05) ---
    $("iframe").each((_i, el) => {
      if (!$(el).attr("sandbox")) {
        const dedupKey = `${file.relativePath}-iframe-nosandbox-${_i}`;
        if (seen.has(dedupKey)) return;
        seen.add(dedupKey);
        issues.push({
          id: `iframe-no-sandbox-${file.relativePath}-${_i}`,
          severity: "high",
          title: "Iframe missing sandbox attribute",
          description: `${file.relativePath}: iframe has no sandbox attribute — allows plugins, forms, scripts.`,
          filePath: file.relativePath,
          suggestion: 'Add sandbox="allow-scripts allow-same-origin" or a minimal sandbox policy.',
        });
      }
    });

    // --- 7. Mixed content (OWASP A05) ---
    const isHTTPS = content.includes("https://") || content.includes("<meta http-equiv");
    if (isHTTPS) {
      $('script[src^="http://"], link[href^="http://"]').each((_i, el) => {
        const src = $(el).attr("src") || $(el).attr("href") || "";
        if (src.startsWith("http://")) {
          const dedupKey = `${file.relativePath}-mixed-${src}`;
          if (seen.has(dedupKey)) return;
          seen.add(dedupKey);
          issues.push({
            id: `mixed-content-${file.relativePath}-${_i}`,
            severity: "high",
            title: "Mixed content — HTTP resource on HTTPS page",
            description: `${file.relativePath}: ${src} loaded over HTTP on an HTTPS page — risk of MITM.`,
            filePath: file.relativePath,
            suggestion: "Use HTTPS instead of HTTP for all external resources.",
          });
        }
      });
    }

    // --- 10. CSP detection ---
    let cspFound = false;
    $('meta[http-equiv="Content-Security-Policy"], meta[http-equiv="content-security-policy"]').each((_i, el) => {
      cspFound = true;
      const cspContent = $(el).attr("content") || "";

      // Check for unsafe-eval (scoped to script-src directive only)
      const scriptSrcCsp = (cspContent.match(/\bscript-src\b[^;]*/i) || [""])[0];
      if (/\bunsafe-eval\b/i.test(scriptSrcCsp)) {
        const dedupKey = `${file.relativePath}-csp-unsafe-eval`;
        if (!seen.has(dedupKey)) {
          seen.add(dedupKey);
          issues.push({
            id: `csp-unsafe-eval-${file.relativePath}`,
            severity: "high",
            title: "CSP allows unsafe-eval",
            description: `${file.relativePath}: Content-Security-Policy includes 'unsafe-eval' — weakens XSS protection.`,
            filePath: file.relativePath,
            suggestion: "Remove 'unsafe-eval' from CSP and refactor eval() usage.",
          });
        }
      }

      // Check for missing critical directives
      const directives = cspContent.split(";").map((d) => d.trim());
      const directiveNames = directives.map((d) => d.split(/\s+/)[0]).filter(Boolean);
      const requiredDirectives = ["object-src", "base-uri", "form-action"];
      for (const req of requiredDirectives) {
        if (!directiveNames.includes(req)) {
          const dedupKey = `${file.relativePath}-csp-missing-${req}`;
          if (!seen.has(dedupKey)) {
            seen.add(dedupKey);
            issues.push({
              id: `csp-missing-${req}-${file.relativePath}`,
              severity: "medium",
              title: `CSP missing ${req} directive`,
              description: `${file.relativePath}: Content-Security-Policy is missing the ${req} directive.`,
              filePath: file.relativePath,
              suggestion: `Add ${req} to your Content-Security-Policy.`,
            });
          }
        }
      }
    });

    if (!cspFound) {
      const dedupKey = `${file.relativePath}-no-csp`;
      if (!seen.has(dedupKey)) {
        seen.add(dedupKey);
        issues.push({
          id: `no-csp-${file.relativePath}`,
          severity: "low",
          title: "No Content-Security-Policy detected",
          description: `${file.relativePath}: no CSP meta tag found — page lacks defense against XSS.`,
          filePath: file.relativePath,
          suggestion: "Add a Content-Security-Policy meta tag or HTTP header.",
        });
      }
    }

    // --- 12. HTML comments with sensitive data (OWASP A05) ---
    const comments = content.match(/<!--[\s\S]*?-->/g) || [];
    for (const comment of comments) {
      const commentClean = comment.replace(/^<!--|-->$/g, "");

      // Emails in any comment
      const emails = commentClean.match(SENSITIVE_EMAIL_PATTERN);
      if (emails) {
        for (const email of emails) {
          const dedupKey = `${file.relativePath}-comment-email-${email}`;
          if (seen.has(dedupKey)) continue;
          seen.add(dedupKey);
          issues.push({
            id: `comment-email-${file.relativePath}`,
            severity: "medium",
            title: "Email address found in HTML comment",
            description: `${file.relativePath}: HTML comment contains email "${email}".`,
            filePath: file.relativePath,
            suggestion: "Remove email addresses from HTML comments to avoid harvesting.",
          });
        }
      }

      // Internal IPs in comments
      const ips = commentClean.match(INTERNAL_IP_PATTERN);
      if (ips) {
        for (const ip of ips) {
          const dedupKey = `${file.relativePath}-comment-ip-${ip}`;
          if (seen.has(dedupKey)) continue;
          seen.add(dedupKey);
          issues.push({
            id: `comment-internal-ip-${file.relativePath}`,
            severity: "medium",
            title: "Internal IP address in HTML comment",
            description: `${file.relativePath}: HTML comment contains internal IP "${ip}".`,
            filePath: file.relativePath,
            suggestion: "Remove internal IP addresses from comments.",
          });
        }
      }
    }

    // --- 13. Open redirect patterns ---
    $("a[href]").each((_i, el) => {
      const href = $(el).attr("href") || "";
      if (OPEN_REDIRECT_PARAMS.test(href)) {
        const dedupKey = `${file.relativePath}-open-redirect-${href.slice(0, 40)}`;
        if (seen.has(dedupKey)) return;
        seen.add(dedupKey);
        issues.push({
          id: `open-redirect-${file.relativePath}-${_i}`,
          severity: "low",
          title: "Potential open redirect in link",
          description: `${file.relativePath}: link "${href.slice(0, 80)}" contains redirect parameter — may be used for phishing.`,
          filePath: file.relativePath,
          suggestion: "Validate redirect URLs against an allowlist; avoid user-controlled redirect parameters.",
        });
      }
    });

    // --- 14. Cookie security (OWASP A05) ---
    // Check inline scripts for cookie setting
    $("script").each((_i, el) => {
      const scriptContent = $(el).html() || "";
      if (COOKIE_FLAGS_PATTERN.test(scriptContent)) {
        if (!SECURE_FLAG.test(scriptContent)) {
          const dedupKey = `${file.relativePath}-cookie-secure`;
          if (!seen.has(dedupKey)) {
            seen.add(dedupKey);
            issues.push({
              id: `cookie-no-secure-${file.relativePath}`,
              severity: "low",
              title: "Cookie set without Secure flag",
              description: `${file.relativePath}: document.cookie used without the Secure flag — cookie sent over HTTP.`,
              filePath: file.relativePath,
              suggestion: 'Set the Secure flag: "; Secure" on all cookies.',
            });
          }
        }
        if (!HTTPONLY_FLAG.test(scriptContent)) {
          const dedupKey = `${file.relativePath}-cookie-httponly`;
          if (!seen.has(dedupKey)) {
            seen.add(dedupKey);
            issues.push({
              id: `cookie-no-httponly-${file.relativePath}`,
              severity: "low",
              title: "Cookie set without HttpOnly flag",
              description: `${file.relativePath}: document.cookie used without the HttpOnly flag — accessible to JavaScript.`,
              filePath: file.relativePath,
              suggestion: 'Set the HttpOnly flag: "; HttpOnly" on session cookies.',
            });
          }
        }
        if (!SAMESITE_FLAG.test(scriptContent)) {
          const dedupKey = `${file.relativePath}-cookie-samesite`;
          if (!seen.has(dedupKey)) {
            seen.add(dedupKey);
            issues.push({
              id: `cookie-no-samesite-${file.relativePath}`,
              severity: "low",
              title: "Cookie set without SameSite flag",
              description: `${file.relativePath}: document.cookie used without SameSite attribute — vulnerable to CSRF.`,
              filePath: file.relativePath,
              suggestion: 'Set SameSite=Lax or SameSite=Strict on cookies.',
            });
          }
        }
      }
    });

    // Also check inline Set-Cookie in meta
    $('meta[http-equiv="set-cookie"]').each((_i, el) => {
      const metaContent = $(el).attr("content") || "";
      if (!SECURE_FLAG.test(metaContent)) {
        const dedupKey = `${file.relativePath}-meta-cookie-secure`;
        if (!seen.has(dedupKey)) {
          seen.add(dedupKey);
          issues.push({
            id: `meta-cookie-no-secure-${file.relativePath}`,
            severity: "low",
            title: "Meta Set-Cookie without Secure flag",
            description: `${file.relativePath}: meta http-equiv="set-cookie" used without Secure flag.`,
            filePath: file.relativePath,
            suggestion: 'Add "; Secure" to the cookie value.',
          });
        }
      }
    });

    // --- 15. Typosquatting on any external resource ---
    $('[src], [href]').each((_i, el) => {
      const url = $(el).attr("src") || $(el).attr("href") || "";
      if (!url.startsWith("http") && !url.startsWith("//")) return;
      const suspicious = hasTyposquatting(url);
      if (suspicious) {
        const dedupKey = `${file.relativePath}-typo-${suspicious}`;
        if (seen.has(dedupKey)) return;
        seen.add(dedupKey);
        issues.push({
          id: `typosquatting-${file.relativePath}-${_i}`,
          severity: "high",
          title: "Possible typosquatting domain",
          description: `${file.relativePath}: "${url}" references suspicious domain "${suspicious}" that closely resembles "${KNOWN_CDNS.find((c) => homoglyphDistance(suspicious, c) === 1)}".`,
          filePath: file.relativePath,
          suggestion: `Verify the domain "${suspicious}" is the intended CDN and not a typosquatting attack.`,
        });
      }
    });

    // --- Autocomplete on sensitive fields ---
    $('input[type="password"][autocomplete]:not([autocomplete="off"]):not([autocomplete*="new-password"]):not([autocomplete*="current-password"])').each((_i, el) => {
      const dedupKey = `${file.relativePath}-autocomplete-pw-${_i}`;
      if (seen.has(dedupKey)) return;
      seen.add(dedupKey);
      issues.push({
        id: `autocomplete-not-off-${file.relativePath}-${_i}`,
        severity: "low",
        title: "Password field should use autocomplete=\"off\" or \"new-password\"",
        description: `${file.relativePath}: password field has autocomplete that is not "off" or "new-password".`,
        filePath: file.relativePath,
        suggestion: 'Use autocomplete="off" or autocomplete="new-password" for password fields.',
      });
    });
  }

  // --- Site-wide header checks ---
  for (const file of htmlFiles) {
    let content: string;
    try { content = fs.readFileSync(file.path, "utf-8"); } catch { continue; }
    const $ = cheerio.load(content);

    // Clickjacking protection: CSP frame-ancestors or X-Frame-Options meta
    const hasCsp = $('meta[http-equiv="Content-Security-Policy"], meta[http-equiv="content-security-policy"]').length > 0;
    if (hasCsp) {
      const cspContent = $('meta[http-equiv="Content-Security-Policy"]').attr("content") || $('meta[http-equiv="content-security-policy"]').attr("content") || "";
      if (!/frame-ancestors\s/.test(cspContent)) {
        const dedupKey = "clickjacking-no-frame-ancestors";
        if (!seen.has(dedupKey)) {
          seen.add(dedupKey);
          issues.push({
            id: "clickjacking-missing-protection",
            severity: "medium",
            title: "Missing clickjacking protection (frame-ancestors)",
            description: "CSP is set but missing the frame-ancestors directive — page can be embedded in iframes on other sites.",
            filePath: file.relativePath,
            suggestion: "Add 'frame-ancestors self' to Content-Security-Policy to prevent clickjacking.",
          });
        }
      }
    } else {
      const hasXfoMeta = $('meta[http-equiv="X-Frame-Options"]').length > 0;
      if (!hasXfoMeta) {
        const dedupKey = "clickjacking-no-xframe";
        if (!seen.has(dedupKey)) {
          seen.add(dedupKey);
          issues.push({
            id: "clickjacking-missing-protection",
            severity: "medium",
            title: "Missing clickjacking protection",
            description: "No CSP frame-ancestors or X-Frame-Options found — page can be embedded in iframes.",
            filePath: file.relativePath,
            suggestion: 'Set "X-Frame-Options: DENY" or "X-Frame-Options: SAMEORIGIN" or add CSP "frame-ancestors self".',
          });
        }
      }
    }

    break; // Only check the first HTML file for site-wide headers
  }

  const score = calculateModuleScore(issues);
  const criticalCount = issues.filter((i) => i.severity === "critical").length;
  const status: ModuleResult["status"] = issues.length === 0 ? "pass" : criticalCount > 0 ? "fail" : "warning";

  return {
    moduleId: "13-security",
    moduleName: "Security Audit",
    status,
    score,
    issues,
    summary: `${issues.length} security issue${issues.length !== 1 ? "s" : ""} found (${criticalCount} critical)`,
  };
}

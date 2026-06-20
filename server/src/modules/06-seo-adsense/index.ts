import fs from "fs";
import * as cheerio from "cheerio";
import type { CrawledFile, AuditIssue, ModuleResult } from "../../types.js";
import { calculateModuleScore } from "../../scoring.js";

const PROHIBITED_CONTENT_PATTERNS = [
  { pattern: /\b(cracked|warez|torrent|pirate|keygen)\b/i, label: "pirated software cracks/keys" },
  { pattern: /\b(hack|crack|exploit)\s*(instagram|facebook|gmail|bank|account|password)\b/i, label: "hacking/account cracking services" },
  { pattern: /\b(payday loan|fast cash loan|no credit check loan)\b/i, label: "payday lending (restricted)" },
  { pattern: /\b(online casino|slot machine|poker|blackjack|roulette|betting odds|sportsbook)\b/i, label: "gambling/casino content" },
  { pattern: /\b(prescription.*no prescription|buy.*without prescription|online pharmacy.*no rx)\b/i, label: "unlicensed pharmaceutical sales" },
  { pattern: /\b(viagra|cialis|levitra|tramadol|valium|xanax|ambien|adipex|phentermine)\s*(buy|cheap|online|order|discount)\b/i, label: "prescription drug sales without prescription" },
  { pattern: /\b(anabolic steroid|human growth hormone|hgh|sarms)\s*(buy|for sale|cheap)\b/i, label: "anabolic steroid sales" },
  { pattern: /\b(essay writing service|buy essay|write my paper|term paper for sale)\b/i, label: "academic dishonesty services" },
  { pattern: /\b(fake passport|fake id|fake diploma|counterfeit)\b/i, label: "counterfeit document services" },
  { pattern: /\b(dating\s*(escort|adult|sex|casual))\b/i, label: "adult dating/escort content" },
  { pattern: /\b(get rich quick|make money fast|work from home.*\$[0-9,]+|passive income.*overnight)\b/i, label: "get rich quick schemes" },
];

const PAGE_TEMPLATE_INDICATORS = [
  "lorem ipsum", "this is a sample page", "under construction", "coming soon",
  "page not found", "sample content", "your content goes here",
];

export function auditSeoAdsense(files: CrawledFile[]): ModuleResult {
  const issues: AuditIssue[] = [];
  const htmlFiles = files.filter((f) => f.type === "html" && !f.relativePath.startsWith("node_modules") && !f.relativePath.startsWith(".well-known"));
  const filePathSet = new Set(files.map((f) => f.relativePath.toLowerCase()));

  if (htmlFiles.length === 0) {
    return {
      moduleId: "06-seo-adsense",
      moduleName: "SEO & AdSense Compliance",
      status: "fail",
      score: 0,
      issues: [{ id: "no-html-files", severity: "critical", title: "No HTML files found", description: "Cannot audit SEO or AdSense compliance without HTML pages.", filePath: "N/A", suggestion: "Add at least one HTML page to your site." }],
      summary: "No HTML files to audit",
    };
  }

  // ── Privacy Policy ──
  const hasPrivacyPage = htmlFiles.some((f) =>
    /^(privacy|privacy-policy|privacy\.policy|privacypolicy|gdpr|data-protection)\b/i.test(stem(f.relativePath))
  );
  if (!hasPrivacyPage) {
    issues.push({
      id: "privacy-policy-missing",
      severity: "critical",
      title: "Missing Privacy Policy page",
      description: "Google AdSense requires a privacy policy that clearly discloses data collection, cookie usage, and third-party ad network practices.",
      filePath: "N/A",
      suggestion: "Create a privacy-policy.html page disclosing cookie usage, data collection, and that third parties (e.g. Google) serve ads and use cookies.",
    });
  }

  // ── About / Contact page (E-E-A-T) ──
  const hasAboutPage = htmlFiles.some((f) => /^about(-us)?\b/i.test(stem(f.relativePath)));
  const hasContactPage = htmlFiles.some((f) => /^contact(-us)?\b/i.test(stem(f.relativePath)));
  if (!hasAboutPage) {
    issues.push({
      id: "about-page-missing",
      severity: "high",
      title: "Missing About page",
      description: "Google AdSense expects publishers to demonstrate E-E-A-T (Experience, Expertise, Authoritativeness, Trustworthiness). An About page helps establish site ownership and purpose.",
      filePath: "N/A",
      suggestion: "Create an about.html page describing the site, its purpose, and who runs it.",
    });
  }
  if (!hasContactPage) {
    issues.push({
      id: "contact-page-missing",
      severity: "high",
      title: "Missing Contact page",
      description: "AdSense policies require transparency. A Contact page with working contact information is expected for user trust and policy compliance.",
      filePath: "N/A",
      suggestion: "Create a contact.html page with a contact form, email address, or other contact method.",
    });
  }

  // ── Terms of Service / Terms & Conditions ──
  const hasTermsPage = htmlFiles.some((f) =>
    /^(terms|terms-of-service|terms-and-conditions|tos|terms\.conditions)\b/i.test(stem(f.relativePath))
  );
  if (!hasTermsPage && htmlFiles.length > 1) {
    issues.push({
      id: "terms-missing",
      severity: "medium",
      title: "Missing Terms of Service page",
      description: "While not strictly required by AdSense, a Terms of Service page is a best practice for legal compliance and user protection.",
      filePath: "N/A",
      suggestion: "Create a terms.html page outlining site usage rules and disclaimers.",
    });
  }

  // ── ads.txt ──
  const hasAdsDotTxt = filePathSet.has("ads.txt");
  const hasAppAdsDotTxt = filePathSet.has("app-ads.txt");

  // Track all AdSense-related elements across pages
  let totalAdUnits = 0;
  let anyPageHasAdsense = false;
  let highestAdDensity = 0;
  let pageWithHighestDensity = "";

  for (const file of htmlFiles) {
    let content: string;
    try { content = fs.readFileSync(file.path, "utf-8"); }
    catch { continue; }

    const $ = cheerio.load(content);

    const robotsMeta = $('meta[name="robots"]').attr("content") || "";
    const isNoindex = /noindex/i.test(robotsMeta);
    const isErrorPage = /4\d{2}\.html$|5\d{2}\.html$|\berror\b/i.test(file.relativePath);

    // ── Meta robots ──
    if (!$('meta[name="robots"]').attr("content")) {
      issues.push({
        id: `metarobots-missing-${file.relativePath}`,
        severity: "medium",
        title: "Missing meta robots tag",
        description: `${file.relativePath} has no <meta name="robots">. AdSense requires pages to be indexable.`,
        filePath: file.relativePath,
        suggestion: 'Add <meta name="robots" content="index, follow">.',
      });
    }

    if (!isNoindex) {
    // ── Open Graph tags ──
    const ogFound = new Set<string>();
    $('meta[property^="og:"]').each((_i, el) => { const p = $(el).attr("property"); if (p) ogFound.add(p); });
    const missingOg = ["og:title", "og:description", "og:image"].filter((t) => !ogFound.has(t));
    if (missingOg.length > 0) {
      issues.push({
        id: `og-missing-${file.relativePath}`,
        severity: "high",
        title: "Missing Open Graph tags",
        description: `${file.relativePath} is missing: ${missingOg.join(", ")}. Social sharing previews will be poor, affecting content discoverability.`,
        filePath: file.relativePath,
        suggestion: "Add Open Graph meta tags for better social sharing previews.",
      });
    }

    // ── Twitter Card ──
    const twitterFound = new Set<string>();
    $('meta[name^="twitter:"]').each((_i, el) => { const n = $(el).attr("name"); if (n) twitterFound.add(n); });
    if (!twitterFound.has("twitter:card")) {
      issues.push({
        id: `twitter-missing-${file.relativePath}`,
        severity: "high",
        title: "Missing Twitter Card tags",
        description: `${file.relativePath} is missing twitter:card and related tags.`,
        filePath: file.relativePath,
        suggestion: "Add Twitter Card meta tags for Twitter sharing previews.",
      });
    }

    // ── JSON-LD structured data ──
    if ($('script[type="application/ld+json"]').length === 0) {
      issues.push({
        id: `jsonld-missing-${file.relativePath}`,
        severity: "medium",
        title: "Missing structured data (JSON-LD)",
        description: `${file.relativePath} has no JSON-LD structured data. Structured data signals content quality to Google.`,
        filePath: file.relativePath,
        suggestion: "Add JSON-LD structured data for rich search results.",
      });
    }
    }

    // ── Content quality: thin content check ──
    const bodyText = $("body").text().trim();
    const wordCount = bodyText.split(/\s+/).filter(Boolean).length;
    if (wordCount < 300 && htmlFiles.length <= 10 && !isErrorPage) {
      issues.push({
        id: `thin-content-${file.relativePath}`,
        severity: "high",
        title: "Thin content — insufficient body text",
        description: `${file.relativePath} has only ~${wordCount} words. AdSense requires pages to have substantial original content (typically 300+ words).`,
        filePath: file.relativePath,
        suggestion: "Expand the page with original, valuable content (300+ words minimum).",
      });
    }

    // ── Content quality: template/placeholder content ──
    const bodyLower = bodyText.toLowerCase();
    const matchedTemplates = PAGE_TEMPLATE_INDICATORS.filter((t) => bodyLower.includes(t));
    if (matchedTemplates.length > 0 && !isErrorPage) {
      issues.push({
        id: `placeholder-content-${file.relativePath}`,
        severity: "high",
        title: "Placeholder or template content detected",
        description: `${file.relativePath} contains placeholder text: "${matchedTemplates.join(", ")}". AdSense prohibits pages without substantial original content.`,
        filePath: file.relativePath,
        suggestion: "Replace placeholder text with original, meaningful content.",
      });
    }

    // ── Copyright notice ──
    const hasCopyright = bodyLower.includes("copyright") || bodyLower.includes("©") || bodyLower.includes("all rights reserved");
    if (!hasCopyright && wordCount >= 50) {
      issues.push({
        id: `copyright-notice-missing-${file.relativePath}`,
        severity: "low",
        title: "Missing copyright notice",
        description: `${file.relativePath} has no copyright notice. A copyright statement signals content ownership and professionalism.`,
        filePath: file.relativePath,
        suggestion: 'Add a footer with © Year Site Name. All rights reserved.',
      });
    }

    // ── Cookie consent / privacy notice ──
    const hasCookieNotice = bodyLower.includes("cookie") || bodyLower.includes("gdpr") || bodyLower.includes("consent") || $('[id*="cookie" i], [class*="cookie" i]').length > 0;
    if (!hasCookieNotice && hasPrivacyPage === false) {
      // Flag only if no privacy page exists either — otherwise they may handle it there
      issues.push({
        id: `cookie-consent-missing-${file.relativePath}`,
        severity: "medium",
        title: "No cookie consent mechanism detected",
        description: `${file.relativePath} shows no cookie consent notice. AdSense requires disclosure of cookie usage and compliance with privacy regulations (GDPR, ePrivacy).`,
        filePath: file.relativePath,
        suggestion: "Add a cookie consent banner and link to the privacy policy.",
      });
    }

    // ── Google AdSense code detection ──
    const hasAdsenseScript = $('script[src*="adsbygoogle"]').length > 0 || $('script[src*="pagead2"]').length > 0;
    const adUnits = $(".adsbygoogle").length;
    const adIns = $("ins.adsbygoogle").length;
    const hasAdsense = hasAdsenseScript || adUnits > 0 || adIns > 0;

    if (hasAdsense) {
      anyPageHasAdsense = true;
      const totalOnPage = adUnits + adIns;
      totalAdUnits += totalOnPage;

      // Ad density: compare ad count to word count
      const adDensity = wordCount > 0 ? (totalOnPage / wordCount) * 100 : 0;
      if (adDensity > highestAdDensity) {
        highestAdDensity = adDensity;
        pageWithHighestDensity = file.relativePath;
      }

      // ── Ad placement: ads near navigation / action items ──
      const hasNavNearAds = $("nav, header, .nav, .menu, .navigation, #nav, #menu")
        .find(".adsbygoogle, ins.adsbygoogle").length > 0;
      if (hasNavNearAds) {
        issues.push({
          id: `ads-near-nav-${file.relativePath}`,
          severity: "high",
          title: "AdSense ad placed near navigation elements",
          description: `${file.relativePath} has AdSense units inside or adjacent to navigation. Google prohibits ads that overlay or are adjacent to navigational elements, risk of accidental clicks.`,
          filePath: file.relativePath,
          suggestion: "Move ad units away from navigation, menus, and action buttons.",
        });
      }

      // ── Ad density warning ──
      if (totalOnPage >= 3 && wordCount < 500) {
        issues.push({
          id: `high-ad-density-${file.relativePath}`,
          severity: "high",
          title: "High ad density — more ads than content",
          description: `${file.relativePath} has ${totalOnPage} ad unit(s) with only ~${wordCount} words. AdSense policy requires more publisher content than ads.`,
          filePath: file.relativePath,
          suggestion: "Reduce the number of ad units or add more original content.",
        });
      }
    }

    // ── Link text quality ──
    $("a[href]").each((_i, el) => {
      const text = $(el).text().trim().toLowerCase();

    });

    // ── Prohibited content pattern check ──
    for (const { pattern, label } of PROHIBITED_CONTENT_PATTERNS) {
      if (pattern.test(bodyLower)) {
        const matches = bodyLower.match(pattern);
        if (matches) {
          issues.push({
            id: `prohibited-content-${file.relativePath}-${label.replace(/\s+/g, "-").toLowerCase()}`,
            severity: "critical",
            title: `Prohibited content detected: ${label}`,
            description: `${file.relativePath} contains content related to "${label}". This violates Google AdSense content policies.`,
            filePath: file.relativePath,
            suggestion: `Remove or replace all content related to "${label}". AdSense prohibits this category entirely.`,
          });
        }
      }
    }

    // ── Affiliate disclosure check ──
    const hasAffiliateDisclosure = bodyLower.includes("affiliate") && (bodyLower.includes("disclosure") || bodyLower.includes("link") || bodyLower.includes("commission"));
    if (!hasAffiliateDisclosure && (bodyLower.includes("affiliate") || $('a[href*="amazon"], a[href*="shareasale"], a[href*="clickbank"], a[href*="commission"]').length > 0)) {
      issues.push({
        id: `affiliate-disclosure-missing-${file.relativePath}`,
        severity: "high",
        title: "Missing affiliate disclosure",
        description: `${file.relativePath} appears to contain affiliate links but no disclosure. AdSense requires clear disclosure of affiliate relationships.`,
        filePath: file.relativePath,
        suggestion: "Add a clear affiliate disclosure statement near affiliate links or in the page footer.",
      });
    }
  }

  // ── ads.txt check (site-wide) ──
  if (anyPageHasAdsense && !hasAdsDotTxt && !hasAppAdsDotTxt) {
    issues.push({
      id: "ads-txt-missing",
      severity: "critical",
      title: "Missing ads.txt file",
      description: "AdSense code detected but no ads.txt found at the site root. Google requires an ads.txt file declaring authorized sellers.",
      filePath: "N/A",
      suggestion: "Create an ads.txt file in the root directory with your AdSense publisher ID: google.com, pub-XXXXXXXXXXXXXX, DIRECT, fXXXXXXXXXXXXXXX",
    });
  }

  // ── High ad density across site ──
  if (anyPageHasAdsense && highestAdDensity > 1.0) {
    issues.push({
      id: "site-high-ad-density",
      severity: "medium",
      title: "High ad-to-content density on site",
      description: `Highest ad density is ${highestAdDensity.toFixed(1)}% on ${pageWithHighestDensity} (${totalAdUnits} total ad units across site). AdSense policy requires more publisher content than ads.`,
      filePath: pageWithHighestDensity,
      suggestion: "Ensure each page has substantially more content than ad units.",
    });
  }

  // ── Author / E-E-A-T signals ──
  const anyPageHasAuthorSchema = htmlFiles.some((f) => {
    try {
      const c = fs.readFileSync(f.path, "utf-8");
      const $ = cheerio.load(c);
      return $('script[type="application/ld+json"]').text().includes('"@type"') &&
             ($('script[type="application/ld+json"]').text().includes('"Person"') ||
              $('script[type="application/ld+json"]').text().includes('"author"'));
    } catch { return false; }
  });
  if (!anyPageHasAuthorSchema && htmlFiles.length >= 1) {
    issues.push({
      id: "author-schema-missing",
      severity: "medium",
      title: "No author/person schema markup found",
      description: "No JSON-LD Person or author schema detected. E-E-A-T signals help demonstrate content authorship and expertise.",
      filePath: "N/A",
      suggestion: 'Add Person schema markup (JSON-LD) with author name, bio URL, and social profiles.',
    });
  }

  // ── Podcast RSS / feed check (bonus: content freshness signal) ──
  const hasRssFeed = filePathSet.has("feed.xml") || filePathSet.has("rss.xml") || filePathSet.has("atom.xml");
  if (!hasRssFeed && htmlFiles.length > 3) {
    issues.push({
      id: "rss-feed-missing",
      severity: "low",
      title: "No RSS feed found",
      description: "An RSS feed helps search engines discover new content and signals an active, maintained site.",
      filePath: "N/A",
      suggestion: "Create an RSS or Atom feed for your content.",
    });
  }

  const score = calculateModuleScore(issues);
  const criticalCount = issues.filter((i) => i.severity === "critical").length;
  const status: ModuleResult["status"] = criticalCount > 0 ? "fail" : issues.length > 0 ? "warning" : "pass";

  return {
    moduleId: "06-seo-adsense",
    moduleName: "SEO & AdSense Compliance",
    status,
    score,
    issues,
    summary: `${issues.length} issue${issues.length !== 1 ? "s" : ""} found across ${htmlFiles.length} page${htmlFiles.length !== 1 ? "s" : ""}`,
  };
}

function stem(p: string): string {
  return p.replace(/\.html?$/, "").replace(/\/index$/, "").split("/").pop() || p;
}

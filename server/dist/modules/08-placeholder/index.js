import fs from "fs";
import * as cheerio from "cheerio";
import { calculateModuleScore } from "../../scoring.js";
const CURRENT_YEAR = new Date().getFullYear();
const PLACEHOLDER_IMG_DOMAINS = [
    "via.placeholder.com", "placehold.co", "placeholder.com",
    "dummyimage.com", "lorempixel.com", "picsum.photos",
    "fillmurray.com", "placecage.com", "placedog.net",
    "fakeimg.pl", "baconmockup.com",
];
const TEMPLATE_TEXT_PATTERNS = [
    /\bcoming\s+soon\b/i,
    /\bunder\s+construction\b/i,
    /\bsample\s+content\b/i,
    /\byour\s+content\s+goes\s+here\b/i,
];
const DUMMY_PATTERNS = [
    /\btodo\b/i, /\bfixme\b/i, /\btbd\b/i,
    /\bsite\s+under\s+maintenance\b/i,
    /\bfpo\b/i,
    /\bdummy\s+(text|content|data|page)\b/i,
    /\bsample\s+(text|page)\b/i,
    /\btest\s+(page|content|data)\b/i,
];
const PHONE_PATTERNS = [
    /\(?000\)?[\s.-]*000[\s.-]*0000/,
    /\(?123\)?[\s.-]*456[\s.-]*7890/,
    /\(?555\)?[\s.-]*01\d{2}[\s.-]*\d{4}/,
];
const PLACEHOLDER_ADDRESSES = [
    /123\s+main\s+(street|st)/i, /123\s+anywhere\s+(street|st)/i,
    /anystreet/i, /anytown/i, /anystate/i,
    /\d+\s+(fak(e|er)|dummy|placeholder)\s+(street|st|avenue|ave|road|rd|drive|dr|lane|ln)/i,
    /\d{1,5}\s+(main|oak|elm|maple|pine)\s+(st|street|ave|avenue|rd|road|dr|drive|lane|ln),\s*.*(usa|us)\b/i,
];
const DUMMY_EMAILS = [
    /user@example\.com/i, /test@test\.com/i, /info@example\.com/i,
    /admin@example\.com/i, /name@domain\.com/i, /email@domain\.com/i,
    /contact@example\.com/i, /support@example\.com/i,
    /hello@example\.com/i, /me@example\.com/i,
];
const EMPTY_TEXT_THRESHOLD = 50;
const THIN_CONTENT_WORD_THRESHOLD = 100;
const AI_BUZZWORDS = [
    "leverage", "seamless", "robust",
    "synergy", "game-changer",
    "disruptive", "next-generation", "best-in-class", "industry-leading",
    "state-of-the-art",
];
const GENERIC_OPENERS = [
    /in\s+today'?s\s+digital\s+age/i,
    /in\s+today'?s\s+fast-?paced\s+world/i,
    /welcome\s+to\s+our\s+website/i,
    /in\s+todays\s+(digital|modern|competitive)\s+(age|world|landscape|market)/i,
];
const FORMULAIC_CLOSERS = [
    /^in\s+conclusion,/i,
    /^to\s+sum\s+it\s+up,/i,
    /^in\s+summary,/i,
    /^all\s+in\s+all,/i,
];
const AUTHOR_BYLINE_PATTERNS = [
    /by\s+[A-Z][a-z]+\s+[A-Z][a-z]+\b/,
    /written\s+by\s+[A-Z][a-z]+\s+[A-Z][a-z]+\b/,
    /authored\s+by\s+[A-Z][a-z]+\s+[A-Z][a-z]+\b/,
];
const DATE_VISIBLE_PATTERNS = [
    /\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s+\d{4}\b/i,
    /\b\d{1,2}\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4}\b/i,
    /\b\d{4}-\d{2}-\d{2}\b/,
    /\b\d{1,2}\/\d{1,2}\/\d{4}\b/,
    /\b(?:published|updated|posted|modified|created):?\s*\d{1,2}[\/-]\d{1,2}[\/-]\d{4}\b/i,
    /\b(?:published|updated|posted|modified|created):?\s*(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s+\d{4}\b/i,
];
const YMYL_HEALTH_KEYWORDS = /\b(symptom|disease|treatment|medication|diagnosis|health|medical|patient|cure|therapy|surgery|diagnose|prescription|dosage|clinical)\b/i;
const YMYL_FINANCE_KEYWORDS = /\b(investment|stock|loan|mortgage|financial|retirement|insurance|banking|interest\s+rate|trading|dividend)\b/i;
const DISCLAIMER_PATTERNS = [
    /not\s+financial\s+advice/i,
    /consult\s+(your|a)\s+(doctor|physician|healthcare|professional|attorney|lawyer)/i,
    /disclaimer/i,
    /this\s+(is\s+not|does\s+not\s+constitute)\s+(medical|financial|legal)\s+advice/i,
    /not\s+medical\s+advice/i,
    /for\s+(informational|educational)\s+purposes\s+only/i,
];
const FEED_PATTERNS = [
    'link[type="application/rss+xml"]',
    'link[type="application/atom+xml"]',
    'a[href*="/feed"]', 'a[href*="/rss"]', 'a[href*="feed.xml"]',
    'a[href*="atom.xml"]',
];
function countSyllables(word) {
    const w = word.toLowerCase().replace(/[^a-z]/g, "");
    if (w.length <= 3)
        return 1;
    const vowels = w.match(/[aeiouy]+/g);
    if (!vowels)
        return 1;
    let count = vowels.length;
    if (w.endsWith("e"))
        count--;
    if (w.endsWith("le") && w.length > 2)
        count++;
    if (w.endsWith("es") || w.endsWith("ed"))
        count--;
    return Math.max(1, count);
}
function approxFleschReadingEase(text) {
    const clean = text.replace(/\s+/g, " ").trim();
    if (!clean)
        return 100;
    const words = clean.split(/\s+/);
    const sentences = clean.split(/[.!?]+/).filter(Boolean).length || 1;
    const totalSyllables = words.reduce((sum, w) => sum + countSyllables(w), 0);
    return 206.835 - 1.015 * (words.length / sentences) - 84.6 * (totalSyllables / words.length);
}
function normalizedText(text) {
    return text.replace(/\s+/g, " ").trim().toLowerCase();
}
export function auditPlaceholder(files) {
    const issues = [];
    const htmlFiles = files.filter((f) => f.type === "html" && !f.relativePath.startsWith("node_modules") && !f.relativePath.startsWith(".well-known"));
    const metaDescriptions = new Map();
    let hasAuthorBioPage = false;
    let hasRssFeed = false;
    const pageTexts = new Map();
    const totalSyllableCounts = [];
    const totalWordCounts = [];
    const totalSentenceCounts = [];
    for (const file of htmlFiles) {
        let content;
        try {
            content = fs.readFileSync(file.path, "utf-8");
        }
        catch {
            continue;
        }
        const $ = cheerio.load(content);
        const visibleText = $("body").text();
        const cleanText = visibleText.replace(/\s+/g, " ").trim();
        const wordCount = cleanText ? cleanText.split(/\s+/).length : 0;
        const isErrorPage = /^4\d{2}\.html$|^5\d{2}\.html$|^error\b/i.test(file.relativePath);
        // Collect paragraphs for cross-page duplicate detection (only semantic text containers)
        const paras = [];
        $("p, li, blockquote").each((_pi, el) => {
            const t = $(el).text().trim();
            if (t.length > 40)
                paras.push(t);
        });
        pageTexts.set(file.relativePath, paras);
        // Readability metrics
        const sentences = cleanText.split(/[.!?]+/).filter(Boolean);
        if (wordCount >= 30) {
            totalWordCounts.push(wordCount);
            totalSentenceCounts.push(sentences.length);
            totalSyllableCounts.push(sentences.reduce((sum, s) => sum + s.split(/\s+/).filter(Boolean).reduce((ws, w) => ws + countSyllables(w), 0), 0));
        }
        // --- Lorem ipsum detection (HIGH) ---
        if (/\blorem\s*ipsum\b/i.test(visibleText)) {
            issues.push({
                id: `lorem-ipsum-${file.relativePath}`,
                severity: "high",
                title: "Lorem ipsum placeholder text detected",
                description: `${file.relativePath} contains Latin filler text "Lorem ipsum".`,
                filePath: file.relativePath,
                suggestion: "Replace lorem ipsum with actual content.",
            });
        }
        // --- Placeholder image sources (HIGH) ---
        $("img").each((_i, el) => {
            const src = $(el).attr("src") || "";
            try {
                const domain = new URL(src).hostname;
                if (PLACEHOLDER_IMG_DOMAINS.some((d) => domain.includes(d))) {
                    issues.push({
                        id: `placeholder-img-${file.relativePath}-${_i}`,
                        severity: "high",
                        title: "Placeholder image detected",
                        description: `${file.relativePath} uses placeholder image: "${src}".`,
                        filePath: file.relativePath,
                        suggestion: "Replace with a real image.",
                    });
                }
            }
            catch { /* not a URL */ }
        });
        // --- Template text patterns (HIGH - Google Helpful Content) ---
        for (const pattern of TEMPLATE_TEXT_PATTERNS) {
            if (visibleText.match(pattern)) {
                issues.push({
                    id: `template-text-${file.relativePath}-${pattern.source.slice(0, 10)}`,
                    severity: "high",
                    title: "Template/placeholder text detected",
                    description: `${file.relativePath} contains template text matching "${pattern.source}".`,
                    filePath: file.relativePath,
                    suggestion: "Replace with finalized content before launch.",
                });
            }
        }
        // --- General dummy content patterns (MEDIUM) ---
        for (const pattern of DUMMY_PATTERNS) {
            const match = visibleText.match(pattern);
            if (match) {
                issues.push({
                    id: `dummy-content-${file.relativePath}-${pattern.source.slice(0, 10)}`,
                    severity: "medium",
                    title: `Placeholder content: "${match[0].trim()}"`,
                    description: `${file.relativePath} contains placeholder text "${match[0].trim()}".`,
                    filePath: file.relativePath,
                    suggestion: "Replace with final content before launch.",
                });
            }
        }
        // --- Near-empty page (HIGH) ---
        if (cleanText.length < EMPTY_TEXT_THRESHOLD && !isErrorPage) {
            issues.push({
                id: `near-empty-${file.relativePath}`,
                severity: "high",
                title: "Page has very little content",
                description: `${file.relativePath} has only ${cleanText.length} visible characters.`,
                filePath: file.relativePath,
                suggestion: "Add meaningful content to this page.",
            });
        }
        // --- Thin content (HIGH - Google Helpful Content) ---
        if (wordCount > 0 && wordCount < THIN_CONTENT_WORD_THRESHOLD) {
            issues.push({
                id: `thin-content-${file.relativePath}`,
                severity: "high",
                title: "Thin content detected",
                description: `${file.relativePath} has only ~${wordCount} words. Pages should have at least ${THIN_CONTENT_WORD_THRESHOLD} words.`,
                filePath: file.relativePath,
                suggestion: "Expand the content to provide substantial value to users.",
            });
        }
        // --- Stale copyright year (MEDIUM) ---
        const yearMatch = cleanText.match(/(?:©|copyright)\s*(\d{4})/i);
        if (yearMatch) {
            const year = parseInt(yearMatch[1], 10);
            if (year < CURRENT_YEAR - 1) {
                issues.push({
                    id: `stale-copyright-${file.relativePath}`,
                    severity: "medium",
                    title: `Stale copyright year: ${year}`,
                    description: `${file.relativePath} has copyright year ${year} (current: ${CURRENT_YEAR}).`,
                    filePath: file.relativePath,
                    suggestion: `Update copyright to © ${CURRENT_YEAR}.`,
                });
            }
        }
        // --- Placeholder phone numbers (MEDIUM) ---
        for (const pattern of PHONE_PATTERNS) {
            const match = visibleText.match(pattern);
            if (match) {
                issues.push({
                    id: `placeholder-phone-${file.relativePath}-${pattern.source.slice(0, 15)}`,
                    severity: "medium",
                    title: `Placeholder phone number: "${match[0].trim()}"`,
                    description: `${file.relativePath} contains a dummy phone number.`,
                    filePath: file.relativePath,
                    suggestion: "Replace with a real phone number.",
                });
                break;
            }
        }
        // --- Placeholder address (MEDIUM) ---
        for (const pattern of PLACEHOLDER_ADDRESSES) {
            const match = visibleText.match(pattern);
            if (match) {
                issues.push({
                    id: `placeholder-address-${file.relativePath}`,
                    severity: "medium",
                    title: `Placeholder address: "${match[0].trim()}"`,
                    description: `${file.relativePath} contains a placeholder address.`,
                    filePath: file.relativePath,
                    suggestion: "Replace with the real business address.",
                });
                break;
            }
        }
        // --- Dummy email (MEDIUM) ---
        for (const pattern of DUMMY_EMAILS) {
            const match = visibleText.match(pattern);
            if (match) {
                issues.push({
                    id: `dummy-email-${file.relativePath}`,
                    severity: "medium",
                    title: `Dummy email address: "${match[0].trim()}"`,
                    description: `${file.relativePath} uses a dummy email address.`,
                    filePath: file.relativePath,
                    suggestion: "Replace with the real email address.",
                });
                break;
            }
        }
        // --- AI buzzword detection (HIGH if 2+) ---
        const buzzwordMatches = AI_BUZZWORDS.filter((bw) => {
            const re = new RegExp(`\\b${bw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
            return re.test(visibleText);
        });
        if (buzzwordMatches.length >= 2) {
            issues.push({
                id: `ai-buzzwords-${file.relativePath}`,
                severity: "high",
                title: `AI-adjacent buzzword overload (${buzzwordMatches.length})`,
                description: `${file.relativePath} uses AI-associated buzzwords: ${buzzwordMatches.join(", ")}.`,
                filePath: file.relativePath,
                suggestion: "Replace buzzwords with concrete, specific language that demonstrates real expertise.",
            });
        }
        // --- Generic openers (LOW) ---
        for (const pattern of GENERIC_OPENERS) {
            if (visibleText.match(pattern)) {
                issues.push({
                    id: `generic-opener-${file.relativePath}`,
                    severity: "low",
                    title: "Generic article opener detected",
                    description: `${file.relativePath} uses a formulaic opener pattern.`,
                    filePath: file.relativePath,
                    suggestion: "Replace with a unique, specific introduction.",
                });
                break;
            }
        }
        // --- Formulaic closers (LOW) ---
        for (const pattern of FORMULAIC_CLOSERS) {
            if (visibleText.match(pattern)) {
                issues.push({
                    id: `formulaic-closer-${file.relativePath}`,
                    severity: "low",
                    title: "Formulaic closer detected",
                    description: `${file.relativePath} uses a formulaic closing pattern.`,
                    filePath: file.relativePath,
                    suggestion: "End with a natural, meaningful conclusion.",
                });
                break;
            }
        }
        // --- Excessive em-dash usage (LOW) ---
        // suppressed — unreliable heuristic
        // --- Author byline detection (E-E-A-T) ---
        const hasAuthorInSchema = $('[itemtype*="schema.org/Article"] [itemprop="author"], [itemtype*="schema.org/BlogPosting"] [itemprop="author"]').length > 0;
        const hasAuthorMeta = $('meta[name="author"]').length > 0;
        const hasAuthorInText = AUTHOR_BYLINE_PATTERNS.some((p) => p.test(visibleText));
        const hasAuthorByClass = $(".byline, .author, .post-author, .entry-author").length > 0;
        const hasAuthor = hasAuthorInSchema || hasAuthorMeta || hasAuthorInText || hasAuthorByClass;
        // --- Published/updated dates (MEDIUM if missing on content pages) ---
        const hasDateMeta = $('meta[property="article:published_time"], meta[property="article:modified_time"], meta[name="date"], meta[itemprop="datePublished"]').length > 0;
        const hasDateInText = DATE_VISIBLE_PATTERNS.some((p) => p.test(visibleText));
        const hasDateInByline = $(".byline, .post-date, .entry-date, .published").length > 0;
        const hasDate = hasDateMeta || hasDateInText || hasDateInByline;
        // --- YMYL-specific (health/financial content) — skip noindex pages ---
        const robotsMeta = $('meta[name="robots"]').attr("content") || "";
        if (!/noindex/i.test(robotsMeta)) {
            const PHILOSOPHY_CONTEXT = /\b(philosophy|philosophical|ethics|justice|mind|consciousness|existential|epistemolog|metaphysic|phenomenolog)\b/i;
            const isInPhilosophyContext = PHILOSOPHY_CONTEXT.test(visibleText);
            const isHealthContent = !isInPhilosophyContext && YMYL_HEALTH_KEYWORDS.test(visibleText);
            const isFinanceContent = !isInPhilosophyContext && YMYL_FINANCE_KEYWORDS.test(visibleText);
            if (isHealthContent || isFinanceContent) {
                const ymylType = isHealthContent ? "health" : "financial";
                const hasDisclaimer = DISCLAIMER_PATTERNS.some((p) => p.test(visibleText));
                if (!hasDisclaimer) {
                    issues.push({
                        id: `missing-ymyl-disclaimer-${file.relativePath}`,
                        severity: "medium",
                        title: `Missing ${ymylType} disclaimer`,
                        description: `${file.relativePath} contains ${ymylType}-related keywords but lacks an appropriate disclaimer.`,
                        filePath: file.relativePath,
                        suggestion: `Add a clear "${ymylType === "health" ? "not medical advice" : "not financial advice"}" disclaimer.`,
                    });
                }
                if (!hasAuthor) {
                    issues.push({
                        id: `missing-ymyl-author-${file.relativePath}`,
                        severity: "medium",
                        title: `Missing author credentials for ${ymylType} content`,
                        description: `${file.relativePath} covers ${ymylType} topics but has no author byline or credentials.`,
                        filePath: file.relativePath,
                        suggestion: "Add author byline with relevant credentials or qualifications.",
                    });
                }
            }
        }
        // --- Track meta descriptions for duplicate detection ---
        const metaDesc = $('meta[name="description"]').attr("content");
        if (metaDesc) {
            if (!metaDescriptions.has(metaDesc))
                metaDescriptions.set(metaDesc, []);
            metaDescriptions.get(metaDesc).push(file.relativePath);
        }
        // --- Track author bio / about page ---
        const baseName = file.relativePath.split(/[/\\]/).pop()?.replace(/\.[^.]+$/, "").toLowerCase() || "";
        if (/^about/i.test(baseName) || /\/author\b/.test(file.relativePath) || /\/team\b/.test(file.relativePath) || /\/bio\b/.test(file.relativePath)) {
            hasAuthorBioPage = true;
        }
        // --- Track RSS feed presence ---
        for (const sel of FEED_PATTERNS) {
            if ($(sel).length > 0) {
                hasRssFeed = true;
                break;
            }
        }
    }
    // --- Cross-page: duplicate meta descriptions (MEDIUM) ---
    for (const [desc, pages] of metaDescriptions) {
        if (pages.length > 1) {
            issues.push({
                id: `duplicate-meta-desc-${pages.join("-")}`,
                severity: "medium",
                title: `Duplicate meta description across ${pages.length} pages`,
                description: `"${desc}" appears in: ${pages.join(", ")}.`,
                filePath: pages[0],
                suggestion: "Each page should have a unique meta description.",
            });
        }
    }
    // --- Cross-page: missing author bio page (MEDIUM) ---
    if (!hasAuthorBioPage && htmlFiles.length > 0) {
        issues.push({
            id: "missing-author-bio-page",
            severity: "medium",
            title: "Missing author bio page",
            description: "No about, author, team, or bio page found. An author bio page helps demonstrate E-E-A-T.",
            suggestion: "Create an author bio or about page with credentials and expertise information.",
        });
    }
    // --- Cross-page: missing RSS feed (LOW) ---
    if (!hasRssFeed && htmlFiles.length > 0) {
        issues.push({
            id: "missing-rss-feed",
            severity: "low",
            title: "Missing RSS/Atom feed",
            description: "No RSS or Atom feed detected. Feeds signal regularly updated content.",
            suggestion: "Add an RSS or Atom feed to help search engines discover new content.",
        });
    }
    // --- Readability assessment (LOW) ---
    // suppressed — penalizes domain-specific academic vocabulary
    const score = calculateModuleScore(issues);
    const highCount = issues.filter((i) => i.severity === "high").length;
    const status = issues.length > 0 ? "warning" : "pass";
    let summary = `${issues.length} placeholder/content issue${issues.length !== 1 ? "s" : ""} found across ${htmlFiles.length} page${htmlFiles.length !== 1 ? "s" : ""}`;
    return {
        moduleId: "08-placeholder",
        moduleName: "Placeholder & Content Quality",
        status,
        score,
        issues,
        summary,
    };
}
//# sourceMappingURL=index.js.map
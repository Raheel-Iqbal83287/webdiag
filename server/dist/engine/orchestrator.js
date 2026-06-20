import { calculateOverallScore, countBySeverity } from "../scoring.js";
import { auditPageExistence } from "../modules/01-page-existence/index.js";
import { auditSitemap } from "../modules/02-sitemap/index.js";
import { auditRobotsTxt } from "../modules/03-robots-txt/index.js";
import { auditCssJsIntegrity } from "../modules/04-css-js-integrity/index.js";
import { auditNavConsistency } from "../modules/05-nav-consistency/index.js";
import { auditSeoAdsense } from "../modules/06-seo-adsense/index.js";
import { auditDeadLinks } from "../modules/07-dead-links/index.js";
import { auditPlaceholder } from "../modules/08-placeholder/index.js";
import { auditLayoutOverflow } from "../modules/09-layout-overflow/index.js";
import { auditAccessibility } from "../modules/10-accessibility/index.js";
import { auditPerformance } from "../modules/11-performance/index.js";
import { auditHostingReadiness } from "../modules/12-hosting-readiness/index.js";
import { auditSecurity } from "../modules/13-security/index.js";
import { auditImageOptimization } from "../modules/15-image-optimization/index.js";
import { auditFormsInteraction } from "../modules/16-forms-interaction/index.js";
import { auditFinalVerification } from "../modules/14-final-verification/index.js";
export const TIER_MODULES = {
    basic: [
        "01-page-existence", "04-css-js-integrity", "07-dead-links",
        "10-accessibility", "11-performance", "13-security",
    ],
    pro: [
        "01-page-existence", "02-sitemap", "03-robots-txt", "04-css-js-integrity",
        "05-nav-consistency", "06-seo-adsense", "07-dead-links", "08-placeholder",
        "09-layout-overflow", "10-accessibility", "11-performance",
        "12-hosting-readiness", "13-security", "15-image-optimization",
        "16-forms-interaction", "14-final-verification",
    ],
};
export async function runAudit(files, auditId, options) {
    const tier = options?.tier || "free";
    const allowedModules = tier === "pro" ? TIER_MODULES.pro : TIER_MODULES.basic;
    options?.onProgress?.("Starting audit", 0);
    const modulesResult = [];
    const moduleRunners = [
        { id: "01-page-existence", run: () => auditPageExistence(files), label: "Auditing page existence & HTML structure..." },
        { id: "02-sitemap", run: () => auditSitemap(files), label: "Auditing sitemap..." },
        { id: "03-robots-txt", run: () => auditRobotsTxt(files), label: "Auditing robots.txt..." },
        { id: "04-css-js-integrity", run: () => auditCssJsIntegrity(files), label: "Auditing CSS/JS integrity..." },
        { id: "05-nav-consistency", run: () => auditNavConsistency(files), label: "Auditing navigation consistency..." },
        { id: "06-seo-adsense", run: () => auditSeoAdsense(files), label: "Auditing SEO & AdSense compliance..." },
        { id: "07-dead-links", run: () => auditDeadLinks(files), label: "Checking dead links..." },
        { id: "08-placeholder", run: () => auditPlaceholder(files), label: "Auditing placeholder & content quality..." },
        { id: "09-layout-overflow", run: () => auditLayoutOverflow(files), label: "Checking layout & overflow..." },
        { id: "10-accessibility", run: () => auditAccessibility(files), label: "Auditing accessibility..." },
        { id: "11-performance", run: () => auditPerformance(files), label: "Auditing performance..." },
        { id: "12-hosting-readiness", run: () => auditHostingReadiness(files), label: "Checking hosting readiness..." },
        { id: "13-security", run: () => auditSecurity(files), label: "Auditing security..." },
        { id: "15-image-optimization", run: () => auditImageOptimization(files), label: "Auditing image optimization..." },
        { id: "16-forms-interaction", run: () => auditFormsInteraction(files), label: "Auditing forms & interaction..." },
        { id: "14-final-verification", run: () => auditFinalVerification(files), label: "Running final verification..." },
    ];
    for (const mod of moduleRunners) {
        if (!allowedModules.includes(mod.id))
            continue;
        options?.onProgress?.(mod.label, 15 + (moduleRunners.indexOf(mod) * 5));
        modulesResult.push(await mod.run());
    }
    options?.onProgress?.("Calculating scores...", 99);
    const allIssues = [];
    for (const mod of modulesResult)
        allIssues.push(...mod.issues);
    const severityCounts = countBySeverity(allIssues);
    const overallScore = calculateOverallScore(modulesResult);
    options?.onProgress?.("Generating report...", 90);
    const audit = {
        id: auditId,
        name: `Audit - ${new Date().toLocaleDateString()}`,
        sourceType: "folder",
        sourcePath: "",
        status: "completed",
        overallScore,
        totalIssues: allIssues.length,
        criticalIssues: severityCounts.critical,
        highIssues: severityCounts.high,
        mediumIssues: severityCounts.medium,
        lowIssues: severityCounts.low,
        moduleResults: modulesResult,
        crawledFiles: files,
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
    };
    options?.onProgress?.("Complete!", 100);
    return audit;
}
//# sourceMappingURL=orchestrator.js.map
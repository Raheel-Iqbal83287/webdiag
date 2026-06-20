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
export async function runAudit(files, auditId, options) {
    options?.onProgress?.("Starting audit", 0);
    const modules = [];
    options?.onProgress?.("Auditing page existence & HTML structure...", 15);
    modules.push(auditPageExistence(files));
    options?.onProgress?.("Auditing sitemap...", 35);
    modules.push(auditSitemap(files));
    options?.onProgress?.("Auditing robots.txt...", 45);
    modules.push(auditRobotsTxt(files));
    options?.onProgress?.("Auditing CSS/JS integrity...", 60);
    modules.push(auditCssJsIntegrity(files));
    options?.onProgress?.("Auditing navigation consistency...", 70);
    modules.push(auditNavConsistency(files));
    options?.onProgress?.("Auditing SEO & AdSense compliance...", 78);
    modules.push(auditSeoAdsense(files));
    options?.onProgress?.("Checking dead links...", 83);
    modules.push(await auditDeadLinks(files));
    options?.onProgress?.("Auditing placeholder & content quality...", 88);
    modules.push(auditPlaceholder(files));
    options?.onProgress?.("Checking layout & overflow...", 91);
    modules.push(auditLayoutOverflow(files));
    options?.onProgress?.("Auditing accessibility...", 93);
    modules.push(auditAccessibility(files));
    options?.onProgress?.("Auditing performance...", 94);
    modules.push(auditPerformance(files));
    options?.onProgress?.("Checking hosting readiness...", 95);
    modules.push(auditHostingReadiness(files));
    options?.onProgress?.("Auditing security...", 96);
    modules.push(auditSecurity(files));
    options?.onProgress?.("Auditing image optimization...", 97);
    modules.push(await auditImageOptimization(files));
    options?.onProgress?.("Auditing forms & interaction...", 98);
    modules.push(await auditFormsInteraction(files));
    options?.onProgress?.("Running final verification...", 99);
    modules.push(auditFinalVerification(files));
    options?.onProgress?.("Calculating scores...", 99);
    const allIssues = [];
    for (const mod of modules)
        allIssues.push(...mod.issues);
    const severityCounts = countBySeverity(allIssues);
    const overallScore = calculateOverallScore(modules);
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
        moduleResults: modules,
        crawledFiles: files,
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
    };
    options?.onProgress?.("Complete!", 100);
    return audit;
}
//# sourceMappingURL=orchestrator.js.map
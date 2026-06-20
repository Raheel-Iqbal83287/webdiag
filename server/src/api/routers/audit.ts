import { z } from "zod";
import { v4 as uuid } from "uuid";
import { router, publicProcedure } from "../trpc.js";
import { crawlLocalFolder } from "../../crawler/local-folder.js";
import { crawlUrl } from "../../crawler/live-url.js";
import { crawlGitHub } from "../../crawler/github-repo.js";
import { runAudit } from "../../engine/orchestrator.js";
import { canAutoFix, autoFix } from "../../engine/auto-fix/index.js";
import { getDb, saveDb } from "../../db/index.js";
import { schema } from "../../db/index.js";
import { eq } from "drizzle-orm";
import fs from "fs";

const auditProgress = new Map<string, { progress: number; currentStep: string }>();

export const auditRouter = router({
  create: publicProcedure
    .input(z.object({ name: z.string().optional(), sourceType: z.enum(["folder", "url", "github"]), sourcePath: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const { db } = await getDb();
      const id = uuid();
      if (input.sourceType === "folder" && !fs.existsSync(input.sourcePath)) throw new Error(`Folder not found: ${input.sourcePath}`);

      await db.insert(schema.audits).values({ id, name: input.name || `Audit - ${new Date().toLocaleDateString()}`, sourceType: input.sourceType, sourcePath: input.sourcePath, status: "pending", createdAt: new Date().toISOString() });
      saveDb();

      auditProgress.set(id, { progress: 0, currentStep: "Initializing..." });
      runAuditAsync(id, input.sourceType, input.sourcePath).catch(() => {});

      return { id, status: "pending" as const };
    }),

  status: publicProcedure.input(z.object({ id: z.string() })).query(async ({ input }) => {
    const { db } = await getDb();
    const progress = auditProgress.get(input.id);
    const result = await db.select().from(schema.audits).where(eq(schema.audits.id, input.id)).get();
    if (!result) throw new Error("Audit not found");
    return { status: result.status, progress: progress?.progress ?? 0, currentStep: progress?.currentStep ?? "" };
  }),

  results: publicProcedure.input(z.object({ id: z.string() })).query(async ({ input }) => {
    const { db } = await getDb();
    const result = await db.select().from(schema.audits).where(eq(schema.audits.id, input.id)).get();
    if (!result) throw new Error("Audit not found");
    return result;
  }),

  list: publicProcedure.query(async () => {
    const { db } = await getDb();
    return await db.select().from(schema.audits).orderBy(schema.audits.createdAt).all();
  }),

  delete: publicProcedure.input(z.object({ id: z.string() })).mutation(async ({ input }) => {
    const { db } = await getDb();
    await db.delete(schema.audits).where(eq(schema.audits.id, input.id));
    saveDb();
    auditProgress.delete(input.id);
    return { success: true };
  }),

  canFix: publicProcedure.input(z.object({ id: z.string() })).query(async ({ input }) => {
    const { db } = await getDb();
    const result = await db.select().from(schema.audits).where(eq(schema.audits.id, input.id)).get();
    if (!result) throw new Error("Audit not found");
    const audit = result as any;
    const issues: any[] = [];
    const files: any[] = [];
    try { issues.push(...JSON.parse(audit.moduleResults || "[]").flatMap((m: any) => m.issues || [])); } catch { /* */ }
    try { files.push(...JSON.parse(audit.crawledFiles || "[]")); } catch { /* */ }
    return issues.map((issue: any) => ({ id: issue.id, severity: issue.severity, title: issue.title, filePath: issue.filePath, canFix: canAutoFix(issue, files) }));
  }),

  dryRunFixes: publicProcedure.input(z.object({ id: z.string(), issueIds: z.array(z.string()) })).query(async ({ input }) => {
    const { db } = await getDb();
    const result = await db.select().from(schema.audits).where(eq(schema.audits.id, input.id)).get();
    if (!result) throw new Error("Audit not found");
    const audit = result as any;
    const issues: any[] = [];
    const files: any[] = [];
    try { issues.push(...JSON.parse(audit.moduleResults || "[]").flatMap((m: any) => m.issues || [])); } catch { /* */ }
    try { files.push(...JSON.parse(audit.crawledFiles || "[]")); } catch { /* */ }
    const targetIssues = issues.filter((i: any) => input.issueIds.includes(i.id));
    return autoFix(targetIssues, files, { dryRun: true });
  }),

  compare: publicProcedure.input(z.object({ id1: z.string(), id2: z.string() })).query(async ({ input }) => {
    const { db } = await getDb();
    const r1 = await db.select().from(schema.audits).where(eq(schema.audits.id, input.id1)).get();
    const r2 = await db.select().from(schema.audits).where(eq(schema.audits.id, input.id2)).get();
    if (!r1 || !r2) throw new Error("One or both audits not found");

    const a1 = r1 as any; const a2 = r2 as any;
    const parseMods = (a: any) => { try { return JSON.parse(a.moduleResults || "[]"); } catch { return []; } };
    const parseFiles = (a: any) => { try { return JSON.parse(a.crawledFiles || "[]"); } catch { return []; } };
    const m1 = parseMods(a1); const m2 = parseMods(a2);
    const issues1 = m1.flatMap((m: any) => m.issues || []).map((i: any) => i.id);
    const issues2 = m2.flatMap((m: any) => m.issues || []).map((i: any) => i.id);
    const set1 = new Set(issues1); const set2 = new Set(issues2);

    return {
      audit1: { id: a1.id, name: a1.name, score: a1.overallScore, totalIssues: a1.totalIssues, critical: a1.criticalIssues, high: a1.highIssues, medium: a1.mediumIssues, low: a1.lowIssues, createdAt: a1.createdAt },
      audit2: { id: a2.id, name: a2.name, score: a2.overallScore, totalIssues: a2.totalIssues, critical: a2.criticalIssues, high: a2.highIssues, medium: a2.mediumIssues, low: a2.lowIssues, createdAt: a2.createdAt },
      moduleComparison: m1.map((m1mod: any) => {
        const m2mod = m2.find((m: any) => m.moduleId === m1mod.moduleId);
        return { moduleName: m1mod.moduleName, score1: m1mod.score, score2: m2mod?.score ?? 0, issues1: m1mod.issues?.length ?? 0, issues2: m2mod?.issues?.length ?? 0 };
      }),
      newIssues: issues2.filter((id: string) => !set1.has(id)).length,
      resolvedIssues: issues1.filter((id: string) => !set2.has(id)).length,
      commonIssues: issues1.filter((id: string) => set2.has(id)).length,
    };
  }),

  applyFixes: publicProcedure.input(z.object({ id: z.string(), issueIds: z.array(z.string()) })).mutation(async ({ input }) => {
    const { db } = await getDb();
    const result = await db.select().from(schema.audits).where(eq(schema.audits.id, input.id)).get();
    if (!result) throw new Error("Audit not found");
    const audit = result as any;
    if (audit.sourceType !== "folder") {
      throw new Error("Auto-fix is only available for local folder audits");
    }
    const issues: any[] = [];
    const files: any[] = [];
    try { issues.push(...JSON.parse(audit.moduleResults || "[]").flatMap((m: any) => m.issues || [])); } catch { /* */ }
    try { files.push(...JSON.parse(audit.crawledFiles || "[]")); } catch { /* */ }
    const targetIssues = issues.filter((i: any) => input.issueIds.includes(i.id));
    return autoFix(targetIssues, files, { dryRun: false });
  }),
});

async function runAuditAsync(id: string, sourceType: string, sourcePath: string) {
  try {
    const { db } = await getDb();
    await db.update(schema.audits).set({ status: "crawling" }).where(eq(schema.audits.id, id));
    saveDb();
    auditProgress.set(id, { progress: 5, currentStep: "Crawling files..." });

    let files: any[];
    if (sourceType === "url") {
      const result = await crawlUrl(sourcePath);
      if (result.errors.length) {
        await db.update(schema.audits).set({ status: "failed" }).where(eq(schema.audits.id, id));
        saveDb();
        auditProgress.set(id, { progress: 0, currentStep: `Failed: ${result.errors.join("; ")}` });
        return;
      }
      files = result.files;
    } else if (sourceType === "github") {
      const result = await crawlGitHub(sourcePath);
      if (result.errors.length) {
        await db.update(schema.audits).set({ status: "failed" }).where(eq(schema.audits.id, id));
        saveDb();
        auditProgress.set(id, { progress: 0, currentStep: `Failed: ${result.errors.join("; ")}` });
        return;
      }
      files = result.files;
    } else {
      files = await crawlLocalFolder(sourcePath);
    }

    auditProgress.set(id, { progress: 20, currentStep: `Found ${files.length} files. Running audits...` });
    await db.update(schema.audits).set({ status: "auditing" }).where(eq(schema.audits.id, id));
    saveDb();

    const audit = await runAudit(files, id, { onProgress: (step, progress) => { auditProgress.set(id, { progress: 20 + Math.round(progress * 0.75), currentStep: step }); } });

    await db.update(schema.audits).set({ status: "completed", overallScore: audit.overallScore ?? null, totalIssues: audit.totalIssues, criticalIssues: audit.criticalIssues, highIssues: audit.highIssues, mediumIssues: audit.mediumIssues, lowIssues: audit.lowIssues, moduleResults: JSON.stringify(audit.moduleResults), crawledFiles: JSON.stringify(audit.crawledFiles), completedAt: new Date().toISOString() }).where(eq(schema.audits.id, id));
    saveDb();
    auditProgress.set(id, { progress: 100, currentStep: "Complete!" });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    try {
      const { db } = await getDb();
      await db.update(schema.audits).set({ status: "failed" }).where(eq(schema.audits.id, id));
      saveDb();
    } catch { /* ignore DB error on failure */ }
    auditProgress.set(id, { progress: 0, currentStep: `Failed: ${errorMessage}` });
  }
}

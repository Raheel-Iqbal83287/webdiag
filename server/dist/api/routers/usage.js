import { router, publicProcedure } from "../trpc.js";
import { getDb } from "../../db/index.js";
import { schema } from "../../db/index.js";
import { eq, and } from "drizzle-orm";
const FREE_SCANS_PER_MONTH = 1;
function getMonth() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
export async function checkUsage(ip) {
    const { db } = await getDb();
    const month = getMonth();
    const row = await db.select().from(schema.usage).where(and(eq(schema.usage.clientIp, ip), eq(schema.usage.month, month))).get();
    const count = row?.scanCount ?? 0;
    return { allowed: count < FREE_SCANS_PER_MONTH, remaining: Math.max(0, FREE_SCANS_PER_MONTH - count), month };
}
export async function incrementUsage(ip) {
    const { db, sqlite } = await getDb();
    const month = getMonth();
    const existing = await db.select().from(schema.usage).where(and(eq(schema.usage.clientIp, ip), eq(schema.usage.month, month))).get();
    if (existing) {
        await db.update(schema.usage).set({ scanCount: existing.scanCount + 1 }).where(eq(schema.usage.id, existing.id));
    }
    else {
        await db.insert(schema.usage).values({ clientIp: ip, month, scanCount: 1 });
    }
    sqlite.run("COMMIT");
}
export const usageRouter = router({
    status: publicProcedure.query(async ({ ctx }) => {
        return await checkUsage(ctx.ip);
    }),
});
//# sourceMappingURL=usage.js.map
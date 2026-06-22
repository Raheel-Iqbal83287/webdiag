import { z } from "zod";
import { router, publicProcedure } from "../trpc.js";
import { getDb, saveDb } from "../../db/index.js";
import { schema } from "../../db/index.js";
import { eq, and } from "drizzle-orm";
const FREE_SCANS_PER_MONTH = 3;
function getMonth() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
export async function checkUsage(ip, email, tier = "free") {
    if (tier === "pro")
        return { allowed: true, remaining: Infinity, month: getMonth() };
    const { db } = await getDb();
    const month = getMonth();
    const conditions = [eq(schema.usage.month, month)];
    if (email) {
        conditions.push(eq(schema.usage.email, email));
    }
    else {
        conditions.push(eq(schema.usage.clientIp, ip));
    }
    const row = await db.select().from(schema.usage).where(and(...conditions)).get();
    const count = row?.scanCount ?? 0;
    return { allowed: count < FREE_SCANS_PER_MONTH, remaining: Math.max(0, FREE_SCANS_PER_MONTH - count), month };
}
export async function incrementUsage(ip, email, tier = "free") {
    if (tier === "pro")
        return;
    const { db } = await getDb();
    const month = getMonth();
    const identifier = email || ip;
    const lookupField = email ? schema.usage.email : schema.usage.clientIp;
    const existing = await db.select().from(schema.usage).where(and(eq(lookupField, identifier), eq(schema.usage.month, month))).get();
    if (existing) {
        await db.update(schema.usage).set({ scanCount: existing.scanCount + 1 }).where(eq(schema.usage.id, existing.id));
    }
    else {
        await db.insert(schema.usage).values({ clientIp: ip, email: email || "", month, scanCount: 1 });
    }
    saveDb();
}
export async function getUsageStatus(ip, email, tier) {
    return await checkUsage(ip, email, tier);
}
export const usageRouter = router({
    status: publicProcedure
        .input(z.object({ email: z.string().optional(), tier: z.string().optional() }))
        .query(async ({ ctx, input }) => {
        return await checkUsage(ctx.ip, input.email, input.tier);
    }),
});
//# sourceMappingURL=usage.js.map
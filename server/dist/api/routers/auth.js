import { z } from "zod";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { router, publicProcedure } from "../trpc.js";
import { getDb, saveDb } from "../../db/index.js";
import { schema } from "../../db/index.js";
import { eq } from "drizzle-orm";
const JWT_SECRET = process.env.JWT_SECRET || "webdiag-jwt-secret-2026";
const TOKEN_EXPIRY = "30d";
export async function verifyToken(token) {
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        return decoded;
    }
    catch {
        return null;
    }
}
export const authRouter = router({
    signup: publicProcedure
        .input(z.object({ email: z.string().email(), password: z.string().min(6), name: z.string().min(1) }))
        .mutation(async ({ input }) => {
        const { db } = await getDb();
        const existing = await db.select().from(schema.users).where(eq(schema.users.email, input.email)).get();
        if (existing)
            throw new Error("Email already registered");
        const hash = await bcrypt.hash(input.password, 10);
        const now = new Date().toISOString();
        await db.insert(schema.users).values({ email: input.email, name: input.name, password: hash, createdAt: now });
        saveDb();
        const user = await db.select().from(schema.users).where(eq(schema.users.email, input.email)).get();
        if (!user)
            throw new Error("Failed to create user");
        const token = jwt.sign({ id: user.id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
        return { token, user: { id: user.id, email: user.email, name: user.name } };
    }),
    login: publicProcedure
        .input(z.object({ email: z.string().email(), password: z.string() }))
        .mutation(async ({ input }) => {
        const { db } = await getDb();
        const user = await db.select().from(schema.users).where(eq(schema.users.email, input.email)).get();
        if (!user)
            throw new Error("Invalid email or password");
        const valid = await bcrypt.compare(input.password, user.password);
        if (!valid)
            throw new Error("Invalid email or password");
        const token = jwt.sign({ id: user.id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
        return { token, user: { id: user.id, email: user.email, name: user.name } };
    }),
    me: publicProcedure
        .input(z.object({ token: z.string() }))
        .query(async ({ input }) => {
        const decoded = await verifyToken(input.token);
        if (!decoded)
            throw new Error("Invalid or expired token");
        const { db } = await getDb();
        const user = await db.select().from(schema.users).where(eq(schema.users.id, decoded.id)).get();
        if (!user)
            throw new Error("User not found");
        return { id: user.id, email: user.email, name: user.name };
    }),
});
//# sourceMappingURL=auth.js.map
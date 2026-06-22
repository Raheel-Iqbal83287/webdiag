import { router } from "../trpc.js";
import { auditRouter } from "./audit.js";
import { usageRouter } from "./usage.js";
import { authRouter } from "./auth.js";

export const appRouter = router({ audit: auditRouter, usage: usageRouter, auth: authRouter });

export type AppRouter = typeof appRouter;

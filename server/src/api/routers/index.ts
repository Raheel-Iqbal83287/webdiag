import { router } from "../trpc.js";
import { auditRouter } from "./audit.js";
import { usageRouter } from "./usage.js";

export const appRouter = router({ audit: auditRouter, usage: usageRouter });

export type AppRouter = typeof appRouter;

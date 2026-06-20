import { router } from "../trpc.js";
import { auditRouter } from "./audit.js";

export const appRouter = router({ audit: auditRouter });

export type AppRouter = typeof appRouter;

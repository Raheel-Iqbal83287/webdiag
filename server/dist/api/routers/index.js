import { router } from "../trpc.js";
import { auditRouter } from "./audit.js";
import { usageRouter } from "./usage.js";
export const appRouter = router({ audit: auditRouter, usage: usageRouter });
//# sourceMappingURL=index.js.map
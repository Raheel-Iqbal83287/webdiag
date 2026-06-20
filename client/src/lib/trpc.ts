import { createTRPCReact } from "@trpc/react-query";
import type { AppRouter } from "../../../server/src/api/routers/index";

export const trpc = createTRPCReact<AppRouter>();

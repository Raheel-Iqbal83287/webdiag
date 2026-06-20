import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter, type AppRouter } from "./api/routers/index.js";
import { getDb, saveDb } from "./db/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  await getDb();
  console.log("Database initialized");

  const app = express();
  const PORT = process.env.PORT || 3000;

  app.use(cors());
  app.use(express.json({ limit: "50mb" }));

  app.use("/trpc", createExpressMiddleware({ router: appRouter, createContext: () => ({}) }));

  const clientDist = path.resolve(__dirname, "../../client/dist");
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get("*", (_req, res) => res.sendFile(path.join(clientDist, "index.html")));
  }

  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  process.on("SIGINT", () => { saveDb(); process.exit(0); });
  process.on("SIGTERM", () => { saveDb(); process.exit(0); });

  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`tRPC endpoint: http://localhost:${PORT}/trpc`);
  });
}

main().catch(console.error);
export type { AppRouter };

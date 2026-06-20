import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter, type AppRouter } from "./api/routers/index.js";
import { getDb, saveDb } from "./db/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logPath = path.resolve(__dirname, "../../server-startup.log");

function log(msg: string) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { fs.writeFileSync(logPath, line, { flag: "a" }); } catch {}
  console.log(msg);
}

async function main() {
  log("Starting server...");
  await getDb();
  log("Database initialized");

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

  process.on("SIGINT", () => { saveDb(); log("Shutting down"); process.exit(0); });
  process.on("SIGTERM", () => { saveDb(); log("Shutting down"); process.exit(0); });

  app.listen(PORT, () => {
    log(`Server running on port ${PORT}`);
  });
}

main().catch((err) => {
  log(`Fatal error: ${err.stack || err.message}`);
  process.exit(1);
});
export type { AppRouter };

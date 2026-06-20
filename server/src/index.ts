import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import os from "os";
import { fileURLToPath } from "url";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import multer from "multer";
import { v4 as uuid } from "uuid";
import { appRouter, type AppRouter } from "./api/routers/index.js";
import { getDb, saveDb, schema } from "./db/index.js";

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

  const upload = multer({ dest: os.tmpdir() });
  app.post("/api/upload-folder", upload.array("files"), async (req, res) => {
    try {
      const uploadedFiles = req.files as Express.Multer.File[];
      if (!uploadedFiles || uploadedFiles.length === 0) {
        res.status(400).json({ error: "No files uploaded" });
        return;
      }

      const id = uuid();
      const targetDir = path.join(os.tmpdir(), `webdiag-upload-${id}`);
      fs.mkdirSync(targetDir, { recursive: true });

      for (const f of uploadedFiles) {
        const relPath = f.originalname;
        const dest = path.join(targetDir, relPath);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.renameSync(f.path, dest);
      }

      const name = req.body.name || `Audit - Uploaded Folder (${uploadedFiles.length} files)`;

      const { db } = await getDb();
      await db.insert(schema.audits).values({
        id, name, sourceType: "folder", sourcePath: targetDir,
        status: "pending", createdAt: new Date().toISOString(),
      });
      saveDb();

      const { runAuditAsync } = await import("./api/routers/audit.js");
      runAuditAsync(id, "folder", targetDir);

      res.json({ id, status: "pending" as const });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Upload failed" });
    }
  });

  const clientDist = path.resolve(__dirname, "../../dist");
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

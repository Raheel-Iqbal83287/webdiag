import { existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import { writeFileSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const logPath = resolve(__dirname, "server-startup.log");

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { writeFileSync(logPath, line, { flag: "a" }); } catch {}
  console.log(msg);
}

const distPath = resolve(__dirname, "server/dist/src/index.js");

if (!existsSync(distPath)) {
  log("Build output not found. Running build...");
  try {
    execSync("npm run build", { cwd: __dirname, stdio: "inherit" });
    log("Build completed");
  } catch (err) {
    log(`Build failed: ${err.message}`);
    process.exit(1);
  }
}

try {
  await import("./server/dist/src/index.js");
  log("Server started");
} catch (err) {
  log(`Server startup error: ${err.stack || err.message}`);
  process.exit(1);
}

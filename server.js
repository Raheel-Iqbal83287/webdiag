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

log("Starting server.js bootstrap...");

const nodeModulesPath = resolve(__dirname, "node_modules");
if (!existsSync(nodeModulesPath)) {
  log("node_modules not found. Running npm install...");
  try {
    execSync("npm install --omit=dev", { cwd: __dirname, stdio: "inherit" });
    log("npm install completed");
  } catch (err) {
    log(`npm install failed: ${err.message}`);
    process.exit(1);
  }
}

const distPath = resolve(__dirname, "server/dist/index.js");
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
  await import("./server/dist/index.js");
  log("Server started");
} catch (err) {
  log(`Server startup error: ${err.stack || err.message}`);
  process.exit(1);
}

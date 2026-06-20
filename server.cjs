const { existsSync, writeFileSync } = require("fs");
const { resolve } = require("path");
const { execSync } = require("child_process");

const logPath = resolve(__dirname, "server-startup.log");

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { writeFileSync(logPath, line, { flag: "a" }); } catch {}
  console.log(msg);
}

log("Starting server.cjs bootstrap...");

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
  require("./server/dist/index.js");
  log("Server started");
} catch (err) {
  log(`Server startup error: ${err.stack || err.message}`);
  process.exit(1);
}

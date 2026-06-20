import { execSync } from "child_process";

const out = execSync(`npm run cli -- -p "D:\\philoweb" -o json`, { shell: true, cwd: process.cwd(), encoding: "utf-8" });
const s = out.indexOf("{");
const d = JSON.parse(out.slice(s, out.lastIndexOf("}") + 1));

const targets = ["01-page-existence", "10-accessibility", "06-seo-adsense", "11-performance", "05-nav-consistency", "08-placeholder"];

for (const m of d.moduleResults) {
  if (!targets.includes(m.moduleId)) continue;
  const byPrefix = new Map<string, number>();
  for (const issue of m.issues) {
    const prefix = issue.id.replace(/-\d+$/, "").replace(/-[a-z]+\d*$/, "").split("-").slice(0, 3).join("-");
    byPrefix.set(prefix, (byPrefix.get(prefix) || 0) + 1);
  }
  console.log(`\n=== ${m.moduleName} (${m.issues.length} issues) ===`);
  const sorted = [...byPrefix.entries()].sort((a, b) => b[1] - a[1]);
  for (const [prefix, count] of sorted) {
    console.log(`  ${prefix}: ${count}`);
  }
}

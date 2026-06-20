import { crawlLocalFolder } from "./crawler/local-folder.js";
import { runAudit } from "./engine/orchestrator.js";
import { generateJsonReport, generateMarkdownReport, generateHtmlReport } from "./engine/report.js";
import { autoFix } from "./engine/auto-fix/index.js";
import { v4 as uuidv4 } from "uuid";
import fs from "fs";
import path from "path";
function help() {
    console.log(`WebDiagTool - Website Diagnostic CLI
Usage:
  webdiag [options]

Options:
  -t, --source-type <type>    Source type: folder (default: folder)
  -p, --source-path <path>    Path to folder (required)
  -o, --output <format>       Output format: json, markdown, html (default: json)
  -f, --output-file <file>    Write output to file instead of stdout
  -s, --score-threshold <n>   Minimum score (0-100). Exit code 1 if below (default: 0)
  -c, --max-critical <n>      Max allowed critical issues. Exit code 2 if exceeded (default: no limit)
  -x, --auto-fix              Apply auto-fixes to fixable issues (default: false)
  -n, --name <name>           Audit name (default: auto-generated)
  -h, --help                  Show this help
`);
}
function parseArgs(argv) {
    const args = {
        sourceType: "folder",
        sourcePath: "",
        output: "json",
        scoreThreshold: 0,
        maxCritical: -1,
        autoFix: false,
    };
    for (let i = 2; i < argv.length; i++) {
        const arg = argv[i];
        const next = () => (i + 1 < argv.length ? argv[++i] : null);
        switch (arg) {
            case "-t":
            case "--source-type": {
                const val = next();
                if (!val || val !== "folder") {
                    console.error("Error: --source-type must be folder");
                    return null;
                }
                args.sourceType = val;
                break;
            }
            case "-p":
            case "--source-path":
                args.sourcePath = next() || "";
                break;
            case "-o":
            case "--output": {
                const val = next();
                if (!val || !["json", "markdown", "html"].includes(val)) {
                    console.error("Error: --output must be json, markdown, or html");
                    return null;
                }
                args.output = val;
                break;
            }
            case "-f":
            case "--output-file":
                args.outputFile = next() || undefined;
                break;
            case "-s":
            case "--score-threshold": {
                const val = next();
                const n = parseInt(val || "", 10);
                if (isNaN(n) || n < 0 || n > 100) {
                    console.error("Error: --score-threshold must be a number 0-100");
                    return null;
                }
                args.scoreThreshold = n;
                break;
            }
            case "-c":
            case "--max-critical": {
                const val = next();
                const n = parseInt(val || "", 10);
                if (isNaN(n) || n < 0) {
                    console.error("Error: --max-critical must be a non-negative number");
                    return null;
                }
                args.maxCritical = n;
                break;
            }
            case "-x":
            case "--auto-fix":
                args.autoFix = true;
                break;
            case "-n":
            case "--name":
                args.name = next() || undefined;
                break;
            case "-h":
            case "--help":
                help();
                return null;
            default:
                console.error(`Unknown option: ${arg}`);
                return null;
        }
    }
    if (!args.sourcePath) {
        console.error("Error: --source-path is required");
        return null;
    }
    if (!fs.existsSync(args.sourcePath)) {
        console.error(`Error: Folder not found: ${args.sourcePath}`);
        return null;
    }
    return args;
}
function writeOutput(content, filePath) {
    if (filePath) {
        const dir = path.dirname(path.resolve(filePath));
        if (!fs.existsSync(dir))
            fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filePath, content, "utf-8");
        console.error(`Report written to ${path.resolve(filePath)}`);
    }
    else {
        console.log(content);
    }
}
async function main() {
    const args = parseArgs(process.argv);
    if (!args)
        process.exit(0);
    const auditId = uuidv4();
    const auditName = args.name || `CLI Audit - ${new Date().toLocaleDateString()} - ${args.sourcePath}`;
    // Phase 1: Crawl
    console.error(`Crawling ${args.sourceType} source...`);
    let files;
    try {
        files = await crawlLocalFolder(args.sourcePath);
    }
    catch (err) {
        console.error(`Crawl failed: ${err instanceof Error ? err.message : "Unknown error"}`);
        process.exit(3);
    }
    console.error(`Found ${files.length} files`);
    // Phase 2: Audit
    console.error("Running audit modules...");
    let audit;
    try {
        audit = await runAudit(files, auditId, {
            onProgress: (step, progress) => {
                console.error(`  [${progress}%] ${step}`);
            },
        });
    }
    catch (err) {
        console.error(`Audit failed: ${err instanceof Error ? err.message : "Unknown error"}`);
        process.exit(3);
    }
    // Override name and source
    audit.name = auditName;
    audit.sourceType = args.sourceType;
    audit.sourcePath = args.sourcePath;
    // Phase 3: Auto-fix
    if (args.autoFix) {
        console.error("Applying auto-fixes...");
        const allIssues = audit.moduleResults.flatMap((m) => m.issues);
        const results = await autoFix(allIssues, files, { dryRun: false });
        const ok = results.filter((r) => r.success).length;
        const fail = results.filter((r) => !r.success).length;
        console.error(`  ${ok} fixed, ${fail} failed`);
        // Re-run audit to reflect fixes
        console.error("Re-running audit after fixes...");
        audit = await runAudit(files, auditId, { onProgress: (step, progress) => {
                console.error(`  [${progress}%] ${step}`);
            } });
        audit.name = auditName;
        audit.sourceType = args.sourceType;
        audit.sourcePath = args.sourcePath;
    }
    // Phase 4: Report
    console.error(`Generating ${args.output} report...`);
    let report;
    switch (args.output) {
        case "markdown":
            report = generateMarkdownReport(audit);
            break;
        case "html":
            report = generateHtmlReport(audit);
            break;
        default:
            report = generateJsonReport(audit);
    }
    writeOutput(report, args.outputFile);
    // Phase 5: Summary to stderr
    console.error("");
    console.error(`Audit Complete!`);
    console.error(`  Score: ${audit.overallScore}/100`);
    console.error(`  Issues: ${audit.totalIssues} total (${audit.criticalIssues} critical, ${audit.highIssues} high, ${audit.mediumIssues} medium, ${audit.lowIssues} low)`);
    // Phase 6: Exit code determination
    let exitCode = 0;
    if (audit.overallScore !== undefined && audit.overallScore < args.scoreThreshold) {
        console.error(`  FAIL: Score ${audit.overallScore} is below threshold ${args.scoreThreshold}`);
        exitCode = 1;
    }
    if (args.maxCritical >= 0 && audit.criticalIssues > args.maxCritical) {
        console.error(`  FAIL: ${audit.criticalIssues} critical issues exceed max ${args.maxCritical}`);
        exitCode = 2;
    }
    process.exit(exitCode);
}
main();
//# sourceMappingURL=cli.js.map
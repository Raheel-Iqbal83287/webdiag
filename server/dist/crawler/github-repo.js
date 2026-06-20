import fs from "fs";
import path from "path";
import { simpleGit } from "simple-git";
import { crawlLocalFolder } from "./local-folder.js";
const TEMP_BASE = path.join(process.cwd(), "data", "tmp");
export async function crawlGitHub(repoUrl) {
    const errors = [];
    // Parse GitHub URL to get clone URL
    let cloneUrl = repoUrl;
    if (repoUrl.startsWith("https://github.com/") || repoUrl.startsWith("http://github.com/")) {
        cloneUrl = repoUrl.replace(/\/$/, "");
        if (!cloneUrl.endsWith(".git"))
            cloneUrl += ".git";
    }
    else if (repoUrl.startsWith("git@github.com:")) {
        // SSH format, keep as-is
    }
    else {
        // Assume it's a full git URL
    }
    // Create temp directory
    const repoName = `repo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const cloneDir = path.join(TEMP_BASE, repoName);
    try {
        fs.mkdirSync(cloneDir, { recursive: true });
        // Clone the repo
        const git = simpleGit();
        await git.clone(cloneUrl, cloneDir, ["--depth=1"]);
        // Crawl the cloned directory
        const files = await crawlLocalFolder(cloneDir);
        return { files, errors };
    }
    catch (err) {
        errors.push(`Failed to clone repository: ${err instanceof Error ? err.message : "Unknown error"}`);
        // Clean up temp directory on error only
        try {
            fs.rmSync(cloneDir, { recursive: true, force: true });
        }
        catch { /* ignore cleanup errors */ }
        return { files: [], errors };
    }
}
export function cleanupTempDirs() {
    try {
        if (fs.existsSync(TEMP_BASE)) {
            const entries = fs.readdirSync(TEMP_BASE);
            for (const entry of entries) {
                const full = path.join(TEMP_BASE, entry);
                try {
                    fs.rmSync(full, { recursive: true, force: true });
                }
                catch { /* ignore */ }
            }
        }
    }
    catch { /* ignore */ }
}
//# sourceMappingURL=github-repo.js.map
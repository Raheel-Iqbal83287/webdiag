import AdmZip from "adm-zip";
import os from "os";
import path from "path";
import fs from "fs";
import { crawlLocalFolder } from "./local-folder.js";
export async function crawlZipFile(zipPath) {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "webdiag-"));
    const cleanup = () => { try {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
    catch { /* ignore */ } };
    try {
        const zip = new AdmZip(zipPath);
        zip.extractAllTo(tempDir, true);
        const files = await crawlLocalFolder(tempDir);
        return { files, cleanup };
    }
    catch (err) {
        cleanup();
        throw err;
    }
}
//# sourceMappingURL=zip-file.js.map
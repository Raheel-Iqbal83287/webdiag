import initSqlJs from "sql.js";
import { drizzle } from "drizzle-orm/sql-js";
import * as schema from "./schema.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, "../../data");
const dbPath = path.join(dataDir, "audit.db");
let sqliteInstance = null;
let drizzleInstance = null;
export async function getDb() {
    if (drizzleInstance)
        return { db: drizzleInstance, sqlite: sqliteInstance };
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }
    const SQL = await initSqlJs();
    if (fs.existsSync(dbPath)) {
        const buffer = fs.readFileSync(dbPath);
        sqliteInstance = new SQL.Database(buffer);
    }
    else {
        sqliteInstance = new SQL.Database();
    }
    sqliteInstance.run(`
    CREATE TABLE IF NOT EXISTS usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_ip TEXT NOT NULL,
      email TEXT NOT NULL DEFAULT '',
      month TEXT NOT NULL,
      scan_count INTEGER NOT NULL DEFAULT 0,
      UNIQUE(client_ip, month)
    )
  `);
    sqliteInstance.run(`
    CREATE TABLE IF NOT EXISTS audits (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      source_type TEXT NOT NULL DEFAULT 'folder',
      source_path TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      overall_score REAL,
      total_issues INTEGER DEFAULT 0,
      critical_issues INTEGER DEFAULT 0,
      high_issues INTEGER DEFAULT 0,
      medium_issues INTEGER DEFAULT 0,
      low_issues INTEGER DEFAULT 0,
      module_results TEXT,
      crawled_files TEXT,
      created_at TEXT NOT NULL,
      completed_at TEXT
    )
  `);
    sqliteInstance.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL DEFAULT '',
      password TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
    saveDb();
    drizzleInstance = drizzle(sqliteInstance, { schema });
    return { db: drizzleInstance, sqlite: sqliteInstance };
}
export function saveDb() {
    if (!sqliteInstance)
        return;
    const data = sqliteInstance.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(dbPath, buffer);
}
export { schema };
//# sourceMappingURL=index.js.map
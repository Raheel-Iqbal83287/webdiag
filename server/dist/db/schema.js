import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
export const usage = sqliteTable("usage", {
    id: integer("id").primaryKey({ autoIncrement: true }),
    clientIp: text("client_ip").notNull(),
    month: text("month").notNull(),
    scanCount: integer("scan_count").notNull().default(0),
});
export const audits = sqliteTable("audits", {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    sourceType: text("source_type").notNull(),
    sourcePath: text("source_path").notNull(),
    status: text("status").notNull().default("pending"),
    overallScore: real("overall_score"),
    totalIssues: integer("total_issues").default(0),
    criticalIssues: integer("critical_issues").default(0),
    highIssues: integer("high_issues").default(0),
    mediumIssues: integer("medium_issues").default(0),
    lowIssues: integer("low_issues").default(0),
    moduleResults: text("module_results"),
    crawledFiles: text("crawled_files"),
    createdAt: text("created_at").notNull(),
    completedAt: text("completed_at"),
});
//# sourceMappingURL=schema.js.map
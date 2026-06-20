export type AuditStatus = "pending" | "crawling" | "auditing" | "completed" | "failed";

export type Severity = "critical" | "high" | "medium" | "low" | "info";

export type ModuleId =
  | "01-page-existence"
  | "02-sitemap"
  | "03-robots-txt"
  | "04-css-js-integrity"
  | "05-nav-consistency"
  | "06-seo-adsense"
  | "07-dead-links"
  | "08-placeholder"
  | "09-layout-overflow"
  | "10-accessibility"
  | "11-performance"
  | "12-hosting-readiness"
  | "13-security"
  | "15-image-optimization"
  | "16-forms-interaction"
  | "14-final-verification";

export interface AuditIssue {
  id: string;
  severity: Severity;
  title: string;
  description: string;
  filePath?: string;
  lineNumber?: number;
  suggestion?: string;
  fixAvailable?: boolean;
}

export interface ModuleResult {
  moduleId: ModuleId;
  moduleName: string;
  status: "pass" | "warning" | "fail";
  score: number;
  issues: AuditIssue[];
  summary: string;
  [key: string]: unknown;
}

export interface CrawledFile {
  path: string;
  relativePath: string;
  type: "html" | "css" | "js" | "image" | "xml" | "txt" | "other";
  size: number;
  lastModified?: string;
}

export interface AuditCreateInput {
  name?: string;
  sourceType: "folder";
  sourcePath: string;
}

export interface Audit {
  id: string;
  name: string;
  sourceType: string;
  sourcePath: string;
  status: AuditStatus;
  overallScore?: number;
  totalIssues: number;
  criticalIssues: number;
  highIssues: number;
  mediumIssues: number;
  lowIssues: number;
  moduleResults: ModuleResult[];
  crawledFiles: CrawledFile[];
  createdAt: string;
  completedAt?: string;
}

export interface AuditProgress {
  status: AuditStatus;
  progress: number;
  currentStep: string;
}

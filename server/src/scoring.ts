import type { AuditIssue, ModuleResult, Severity } from "./types.js";

const SEVERITY_PENALTIES: Record<Severity, number> = {
  critical: 15,
  high: 10,
  medium: 5,
  low: 2,
  info: 0,
};

export function calculateModuleScore(issues: AuditIssue[]): number {
  const penalty = issues.reduce((sum, issue) => sum + (SEVERITY_PENALTIES[issue.severity] ?? 0), 0);
  return Math.round(100 / (1 + penalty / 100));
}

export function calculateOverallScore(modules: ModuleResult[]): number {
  if (modules.length === 0) return 0;
  const total = modules.reduce((sum, m) => sum + m.score, 0);
  return Math.round(total / modules.length);
}

export function countBySeverity(issues: AuditIssue[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const issue of issues) {
    counts[issue.severity]++;
  }
  return counts;
}

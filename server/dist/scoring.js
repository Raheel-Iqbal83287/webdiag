const SEVERITY_PENALTIES = {
    critical: 15,
    high: 10,
    medium: 5,
    low: 2,
    info: 0,
};
export function calculateModuleScore(issues) {
    const penalty = issues.reduce((sum, issue) => sum + (SEVERITY_PENALTIES[issue.severity] ?? 0), 0);
    return Math.round(100 / (1 + penalty / 100));
}
export function calculateOverallScore(modules) {
    if (modules.length === 0)
        return 0;
    const total = modules.reduce((sum, m) => sum + m.score, 0);
    return Math.round(total / modules.length);
}
export function countBySeverity(issues) {
    const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    for (const issue of issues) {
        counts[issue.severity]++;
    }
    return counts;
}
//# sourceMappingURL=scoring.js.map
export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

export function severityColor(severity: string): string {
  const colors: Record<string, string> = { critical: "#EF4444", high: "#F59E0B", medium: "#3B82F6", low: "#6B7280" };
  return colors[severity] || "#9CA3AF";
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

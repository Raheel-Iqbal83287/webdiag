import type { Audit, AuditIssue } from "../types.js";
import PDFDocument from "pdfkit";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

export function generateJsonReport(audit: Audit): string {
  return JSON.stringify(audit, null, 2);
}

export function generateMarkdownReport(audit: Audit): string {
  const lines: string[] = [];
  const allIssues = audit.moduleResults.flatMap(m => m.issues);
  const bySeverity = (sev: string) => allIssues.filter(i => i.severity === sev);
  const score = audit.overallScore ?? 0;
  const scoreBar = score >= 80 ? "🟢" : score >= 50 ? "🟡" : "🔴";
  const barLen = Math.round(score / 10);
  const scoreVisual = "█".repeat(barLen) + "░".repeat(10 - barLen);

  lines.push(`# Website Diagnostic Report`);
  lines.push(``);
  lines.push(`| | |`);
  lines.push(`|---|---|`);
  lines.push(`| **Report Name** | ${audit.name} |`);
  lines.push(`| **Source** | ${audit.sourcePath} |`);
  lines.push(`| **Source Type** | ${audit.sourceType} |`);
  lines.push(`| **Generated** | ${audit.createdAt} |`);
  lines.push(`| **Duration** | ${audit.completedAt ? Math.round((new Date(audit.completedAt).getTime() - new Date(audit.createdAt).getTime()) / 1000) + 's' : 'N/A'} |`);
  lines.push(``);
  lines.push(`## Executive Summary`);
  lines.push(``);
  lines.push(`### Overall Score: ${score}/100 ${scoreBar}`);
  lines.push(``);
  lines.push(`\`${scoreVisual}\``);
  lines.push(``);
  lines.push(`| Metric | Count |`);
  lines.push(`|--------|------:|`);
  lines.push(`| **Total Issues** | ${audit.totalIssues} |`);
  lines.push(`| 🔴 Critical | ${audit.criticalIssues} |`);
  lines.push(`| 🟠 High | ${audit.highIssues} |`);
  lines.push(`| 🟡 Medium | ${audit.mediumIssues} |`);
  lines.push(`| 🔵 Low | ${audit.lowIssues} |`);
  lines.push(`| **Pages Analyzed** | ${audit.crawledFiles.filter(f => f.type === 'html').length} |`);
  lines.push(`| **Modules** | ${audit.moduleResults.length} |`);
  lines.push(`| **Pass / Warning / Fail** | ${audit.moduleResults.filter(m => m.status === 'pass').length} / ${audit.moduleResults.filter(m => m.status === 'warning').length} / ${audit.moduleResults.filter(m => m.status === 'fail').length} |`);
  lines.push(``);

  // Module summary table
  lines.push(`## Module Summary`);
  lines.push(``);
  lines.push(`| Module | Score | Issues | Status |`);
  lines.push(`|--------|------:|-------:|:------:|`);
  for (const mod of audit.moduleResults) {
    const icon = mod.status === 'pass' ? '✅' : mod.status === 'warning' ? '⚠️' : '❌';
    lines.push(`| ${mod.moduleName} | ${mod.score} | ${mod.issues.length} | ${icon} ${mod.status.toUpperCase()} |`);
  }
  lines.push(``);

  // Detailed module breakdown
  for (const mod of audit.moduleResults) {
    lines.push(`---`);
    lines.push(`## ${mod.moduleName}`);
    lines.push(``);
    const statusIcon = mod.status === 'pass' ? '✅' : mod.status === 'warning' ? '⚠️' : '❌';
    lines.push(`**Status**: ${statusIcon} ${mod.status.toUpperCase()} | **Score**: ${mod.score}/100`);
    lines.push(``);
    lines.push(`**Summary**: ${mod.summary}`);
    lines.push(``);

    if (mod.issues.length > 0) {
      const byFile = new Map<string, AuditIssue[]>();
      for (const issue of mod.issues) {
        const key = issue.filePath || "(global)";
        if (!byFile.has(key)) byFile.set(key, []);
        byFile.get(key)!.push(issue);
      }

      for (const [file, fileIssues] of byFile) {
        lines.push(`### Issues in \`${file}\``);
        lines.push(``);
        lines.push(`| Severity | Issue | Suggestion |`);
        lines.push(`|----------|-------|------------|`);
        for (const issue of fileIssues) {
          const icon = issue.severity === 'critical' ? '🔴' : issue.severity === 'high' ? '🟠' : issue.severity === 'medium' ? '🟡' : '🔵';
          lines.push(`| ${icon} **${issue.severity.toUpperCase()}** | ${issue.title} | ${issue.suggestion || '-'} |`);
        }
        lines.push(``);
      }
    } else {
      lines.push(`*No issues found.*`);
      lines.push(``);
    }

    // Check for generated content (robots.txt)
    const generatedRobots = mod.generatedRobots;
    if (generatedRobots) {
      lines.push(`### Recommended robots.txt`);
      lines.push("```");
      lines.push(generatedRobots as string);
      lines.push("```");
      lines.push(``);
    }
  }

  // Quick wins (low + medium issues)
  const quickWins = allIssues.filter(i => i.severity === "low" || i.severity === "medium");
  if (quickWins.length > 0) {
    lines.push(`---`);
    lines.push(`## Quick Wins 🎯`);
    lines.push(``);
    lines.push(`These ${quickWins.length} issue${quickWins.length !== 1 ? 's are' : ' is'} low-effort fixes that can improve your score:`);
    lines.push(``);
    for (const issue of quickWins) {
      const fileInfo = issue.filePath ? ` (\`${issue.filePath}\`)` : '';
      lines.push(`- ${issue.title}${fileInfo}`);
      if (issue.suggestion) lines.push(`  - *${issue.suggestion}*`);
    }
    lines.push(``);
  }

  // Critical + High recommendations
  const criticalHigh = allIssues.filter(i => i.severity === "critical" || i.severity === "high");
  if (criticalHigh.length > 0) {
    lines.push(`---`);
    lines.push(`## Priority Issues`);
    lines.push(``);
    lines.push(`These ${criticalHigh.length} issue${criticalHigh.length !== 1 ? 's require' : ' requires'} immediate attention:`);
    lines.push(``);
    for (const issue of criticalHigh) {
      const icon = issue.severity === 'critical' ? '🔴' : '🟠';
      const fileInfo = issue.filePath ? ` (\`${issue.filePath}\`)` : '';
      lines.push(`- ${icon} **${issue.title}**${fileInfo}`);
      if (issue.suggestion) lines.push(`  - Fix: ${issue.suggestion}`);
    }
    lines.push(``);
  }

  lines.push(`---`);
  lines.push(`*Report generated by [Website Diagnostic Tool](https://github.com/anomalyco/opencode)*`);
  return lines.join("\n");
}

export function generateHtmlReport(audit: Audit): string {
  const severityColors: Record<string, string> = { critical: "#EF4444", high: "#F59E0B", medium: "#3B82F6", low: "#6B7280", info: "#9CA3AF" };
  const severityBg: Record<string, string> = { critical: "#FEF2F2", high: "#FFFBEB", medium: "#EFF6FF", low: "#F9FAFB", info: "#F3F4F6" };
  const moduleBadge: Record<string, string> = { pass: "bg-emerald-100 text-emerald-800", warning: "bg-amber-100 text-amber-800", fail: "bg-red-100 text-red-800" };
  const allIssues = audit.moduleResults.flatMap(m => m.issues);

  // Score gauge
  const score = audit.overallScore ?? 0;
  const degrees = (score / 100) * 180;
  const scoreColor = score >= 80 ? "#10B981" : score >= 50 ? "#F59E0B" : "#EF4444";

  const passCount = audit.moduleResults.filter(m => m.status === 'pass').length;
  const warnCount = audit.moduleResults.filter(m => m.status === 'warning').length;
  const failCount = audit.moduleResults.filter(m => m.status === 'fail').length;

  // Module cards
  let modulesHtml = "";
  for (const mod of audit.moduleResults) {
    const byFile = new Map<string, AuditIssue[]>();
    for (const issue of mod.issues) {
      const key = issue.filePath || "(global)";
      if (!byFile.has(key)) byFile.set(key, []);
      byFile.get(key)!.push(issue);
    }

    let issuesHtml = "";
    if (mod.issues.length > 0) {
      for (const [file, fileIssues] of byFile) {
        const fileCol = severityBg[fileIssues[0].severity] || severityBg.info;
        issuesHtml += `<div class="file-group"><div class="file-header" style="background:${fileCol}">📄 ${escapeHtml(file)}</div>`;
        for (const issue of fileIssues) {
          const sugg = issue.suggestion ? `<div class="suggestion">💡 ${escapeHtml(issue.suggestion)}</div>` : "";
          issuesHtml += `<div class="issue-row" style="border-left: 3px solid ${severityColors[issue.severity]}"><span class="sev-badge" style="background:${severityColors[issue.severity]}">${issue.severity.toUpperCase()}</span><span class="issue-title">${escapeHtml(issue.title)}</span>${sugg}</div>`;
        }
        issuesHtml += `</div>`;
      }
    } else {
      issuesHtml = `<div class="no-issues">✅ No issues found</div>`;
    }

    const robotsSection = mod.generatedRobots ? `<details class="robots-details"><summary>📄 Recommended robots.txt</summary><pre class="code-block">${(mod.generatedRobots as string).replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre></details>` : "";

    modulesHtml += `<div class="module-card ${mod.status}"><div class="module-header" onclick="this.parentElement.classList.toggle('collapsed')"><div class="module-title"><span class="module-icon">${mod.status === 'pass' ? '✅' : mod.status === 'warning' ? '⚠️' : '❌'}</span><h3>${escapeHtml(mod.moduleName)}</h3></div><div class="module-meta"><span class="score-badge" style="color:${scoreColor}">${mod.score}/100</span><span class="issue-count">${mod.issues.length} issue${mod.issues.length !== 1 ? 's' : ''}</span><span class="collapse-icon">▼</span></div></div><div class="module-body"><p class="module-summary">${escapeHtml(mod.summary)}</p>${issuesHtml}${robotsSection}</div></div>`;
  }

  // Quick wins
  const quickWins = allIssues.filter(i => i.severity === "low" || i.severity === "medium");
  let quickWinsHtml = "";
  if (quickWins.length > 0) {
    quickWinsHtml = `<div class="quick-wins"><h3>🎯 Quick Wins (${quickWins.length})</h3><div class="win-list">`;
    for (const issue of quickWins.slice(0, 20)) {
      const fileInfo = issue.filePath ? `<span class="win-file">${escapeHtml(issue.filePath)}</span>` : "";
      quickWinsHtml += `<div class="win-item"><span class="win-suggestion">${escapeHtml(issue.title)}</span>${fileInfo}</div>`;
    }
    if (quickWins.length > 20) quickWinsHtml += `<div class="win-item">... and ${quickWins.length - 20} more</div>`;
    quickWinsHtml += `</div></div>`;
  }

  // Priority issues
  const criticalHigh = allIssues.filter(i => i.severity === "critical" || i.severity === "high");
  let priorityHtml = "";
  if (criticalHigh.length > 0) {
    priorityHtml = `<div class="priority-section"><h3>🔴 Priority Issues (${criticalHigh.length})</h3><div class="priority-list">`;
    for (const issue of criticalHigh) {
      const icon = issue.severity === 'critical' ? '🔴' : '🟠';
      priorityHtml += `<div class="priority-item"><span class="prio-icon">${icon}</span><div><strong>${escapeHtml(issue.title)}</strong>${issue.filePath ? `<br><span class="prio-file">${escapeHtml(issue.filePath)}</span>` : ''}${issue.suggestion ? `<br><span class="prio-fix">Fix: ${escapeHtml(issue.suggestion)}</span>` : ''}</div></div>`;
    }
    priorityHtml += `</div></div>`;
  }

  // Issues by file
  const byFileMap = new Map<string, AuditIssue[]>();
  for (const issue of allIssues) {
    const key = issue.filePath || "(global)";
    if (!byFileMap.has(key)) byFileMap.set(key, []);
    byFileMap.get(key)!.push(issue);
  }
  let filesHtml = "";
  if (byFileMap.size > 0) {
    filesHtml = `<div class="file-section"><h3>📂 Issues by File</h3><div class="file-grid">`;
    // Sort by file path
    const sortedFiles = [...byFileMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    for (const [file, fileIssues] of sortedFiles) {
      const highest = fileIssues.reduce((max, i) => {
        const order = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };
        return order[i.severity] > order[max.severity] ? i : max;
      }, fileIssues[0]);
      filesHtml += `<div class="file-card" style="border-left: 4px solid ${severityColors[highest.severity]}"><div class="file-card-header">📄 ${escapeHtml(file)}</div><div class="file-card-stats">${fileIssues.length} issue${fileIssues.length !== 1 ? 's' : ''} · worst: <span style="color:${severityColors[highest.severity]}">${highest.severity}</span></div></div>`;
    }
    filesHtml += `</div></div>`;
  }

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Website Diagnostic Report - ${audit.name}</title><style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f1f5f9;color:#1e293b;padding:2rem}
.container{max-width:960px;margin:0 auto}
h1{font-size:1.5rem;margin-bottom:0.25rem}
.meta{color:#64748b;font-size:0.875rem;margin-bottom:1.5rem}
.score-section{background:white;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.1);padding:1.5rem;margin-bottom:1.5rem;display:flex;gap:2rem;align-items:center;flex-wrap:wrap}
.score-gauge{position:relative;width:120px;height:120px;flex-shrink:0}
.score-gauge svg{transform:rotate(-90deg)}
.score-gauge .score-value{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-size:1.75rem;font-weight:bold}
.stats-grid{display:flex;gap:1rem;flex-wrap:wrap;flex:1}
.stat-box{flex:1;min-width:80px;text-align:center;padding:0.75rem;background:#f8fafc;border-radius:8px}
.stat-box .stat-count{font-size:1.5rem;font-weight:bold}
.stat-box .stat-label{font-size:0.75rem;color:#64748b;margin-top:0.25rem}
.stat-box.critical .stat-count{color:#EF4444}
.stat-box.high .stat-count{color:#F59E0B}
.stat-box.medium .stat-count{color:#3B82F6}
.stat-box.low .stat-count{color:#6B7280}
.module-summary{background:white;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.1);padding:1.5rem;margin-bottom:1.5rem}
.module-summary h3{margin-bottom:0.75rem;font-size:1rem}
.module-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:0.75rem}
.module-grid-item{display:flex;justify-content:space-between;align-items:center;padding:0.75rem;border-radius:8px;font-size:0.875rem}
.module-grid-item .mg-status{font-size:1rem}
.module-grid-item .mg-score{font-weight:bold}
.module-card{background:white;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,0.1);margin-bottom:0.75rem;overflow:hidden;transition:all 0.2s}
.module-card.fail{border-left:4px solid #EF4444}
.module-card.warning{border-left:4px solid #F59E0B}
.module-card.pass{border-left:4px solid #10B981}
.module-header{display:flex;justify-content:space-between;align-items:center;padding:0.75rem 1rem;cursor:pointer;user-select:none}
.module-header:hover{background:#f8fafc}
.module-title{display:flex;align-items:center;gap:0.5rem}
.module-title h3{font-size:0.9375rem;font-weight:600}
.module-meta{display:flex;align-items:center;gap:0.75rem}
.score-badge{font-weight:bold;font-size:0.9375rem}
.issue-count{font-size:0.8125rem;color:#64748b}
.collapse-icon{font-size:0.75rem;color:#94a3b8;transition:transform 0.2s}
.collapsed .collapse-icon{transform:rotate(180deg)}
.collapsed .module-body{display:none}
.module-body{padding:0 1rem 1rem}
.module-summary-text{font-size:0.875rem;color:#64748b;margin-bottom:0.75rem}
.file-group{margin-bottom:0.75rem;border:1px solid #e2e8f0;border-radius:6px;overflow:hidden}
.file-header{padding:0.5rem 0.75rem;font-size:0.8125rem;font-weight:600;font-family:monospace}
.issue-row{padding:0.5rem 0.75rem;display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;border-bottom:1px solid #f1f5f9;font-size:0.8125rem}
.issue-row:last-child{border-bottom:none}
.sev-badge{display:inline-block;padding:0.125rem 0.375rem;border-radius:3px;color:white;font-size:0.6875rem;font-weight:600;letter-spacing:0.5px;flex-shrink:0}
.issue-title{flex:1;min-width:150px}
.suggestion{width:100%;color:#64748b;font-size:0.75rem;padding-left:0.25rem}
.no-issues{padding:0.75rem;color:#10B981;font-size:0.875rem;font-weight:500}
.robots-details{padding:0.75rem 0}
.robots-details summary{cursor:pointer;font-weight:500;font-size:0.875rem;margin-bottom:0.5rem}
.code-block{background:#1e293b;color:#e2e8f0;padding:1rem;border-radius:6px;overflow:auto;font-size:0.8rem;line-height:1.4}
.quick-wins,.priority-section,.file-section{background:white;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.1);padding:1.5rem;margin-bottom:1.5rem}
.quick-wins h3,.priority-section h3,.file-section h3{margin-bottom:0.75rem;font-size:1rem}
.win-list{display:flex;flex-direction:column;gap:0.5rem}
.win-item{display:flex;justify-content:space-between;align-items:center;padding:0.5rem 0.75rem;background:#f0fdf4;border-radius:6px;font-size:0.8125rem}
.win-file{color:#64748b;font-family:monospace;font-size:0.75rem}
.priority-list{display:flex;flex-direction:column;gap:0.5rem}
.priority-item{display:flex;gap:0.75rem;padding:0.75rem;background:#fef2f2;border-radius:6px;font-size:0.8125rem}
.priority-item .prio-icon{flex-shrink:0;font-size:1rem}
.priority-item .prio-file{color:#64748b;font-family:monospace;font-size:0.75rem}
.priority-item .prio-fix{color:#059669;font-size:0.75rem}
.file-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:0.75rem}
.file-card{padding:0.75rem;border-radius:8px;background:#f8fafc;font-size:0.8125rem}
.file-card-header{font-family:monospace;font-weight:600;margin-bottom:0.25rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.file-card-stats{font-size:0.75rem;color:#64748b}
.footer{text-align:center;font-size:0.75rem;color:#94a3b8;margin-top:2rem}
@media print{body{padding:0.5rem}.module-header{cursor:default}.module-card{break-inside:avoid}.score-section{break-inside:avoid}}
@media(max-width:640px){.score-section{flex-direction:column;align-items:stretch;text-align:center}.stats-grid{gap:0.5rem}.stat-box{min-width:60px}}
</style></head><body><div class="container">
<h1>Website Diagnostic Report</h1>
<p class="meta">${escapeHtml(audit.name)} · ${escapeHtml(audit.sourcePath)} · ${audit.createdAt} · ${audit.completedAt ? Math.round((new Date(audit.completedAt).getTime() - new Date(audit.createdAt).getTime()) / 1000) + 's duration' : ''}</p>

<div class="score-section">
<div class="score-gauge">
<svg width="120" height="120" viewBox="0 0 120 120">
<circle cx="60" cy="60" r="54" fill="none" stroke="#e2e8f0" stroke-width="8"/>
<circle cx="60" cy="60" r="54" fill="none" stroke="${scoreColor}" stroke-width="8" stroke-dasharray="${(score / 100) * 339.292}" stroke-dashoffset="0" stroke-linecap="round" transform="rotate(-90, 60, 60)"/>
</svg>
<div class="score-value" style="color:${scoreColor}">${score}</div>
</div>
<div class="stats-grid">
<div class="stat-box"><div class="stat-count">${audit.crawledFiles.filter(f => f.type === 'html').length}</div><div class="stat-label">Pages</div></div>
<div class="stat-box critical"><div class="stat-count">${audit.criticalIssues}</div><div class="stat-label">Critical</div></div>
<div class="stat-box high"><div class="stat-count">${audit.highIssues}</div><div class="stat-label">High</div></div>
<div class="stat-box medium"><div class="stat-count">${audit.mediumIssues}</div><div class="stat-label">Medium</div></div>
<div class="stat-box low"><div class="stat-count">${audit.lowIssues}</div><div class="stat-label">Low</div></div>
<div class="stat-box"><div class="stat-count">${passCount}/${warnCount}/${failCount}</div><div class="stat-label">✅/⚠️/❌</div></div>
</div>
</div>

<div class="module-summary">
<h3>📊 Module Overview</h3>
<div class="module-grid">
${audit.moduleResults.map(m => `<div class="module-grid-item" style="background:${m.status === 'pass' ? '#f0fdf4' : m.status === 'warning' ? '#fffbeb' : '#fef2f2'}"><span><span class="mg-status">${m.status === 'pass' ? '✅' : m.status === 'warning' ? '⚠️' : '❌'}</span> ${escapeHtml(m.moduleName)}</span><span class="mg-score" style="color:${m.score >= 80 ? '#10B981' : m.score >= 50 ? '#F59E0B' : '#EF4444'}">${m.score}</span></div>`).join('')}
</div>
</div>

${priorityHtml}
${quickWinsHtml}
${filesHtml}

<h2 style="font-size:1.125rem;margin-bottom:0.75rem">🔍 Detailed Module Results</h2>
${modulesHtml}

<div class="footer">Report generated by Website Diagnostic Tool</div>
</div></body></html>`;
}

export function generatePdfReport(audit: Audit): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50, size: "A4" });
      const chunks: Buffer[] = [];
      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));

      const allIssues = audit.moduleResults.flatMap((m) => m.issues);
      const score = audit.overallScore ?? 0;
      const pageKey = (fp: string | undefined) => fp && fp !== "N/A" && fp !== "CSS (global)" ? fp : "(global)";

      // Title
      doc.fontSize(22).font("Helvetica-Bold").text("Website Diagnostic Report", { align: "center" });
      doc.fontSize(10).font("Helvetica").fillColor("#64748b").text(`${audit.name} · ${audit.createdAt}`, { align: "center" });
      doc.moveDown(0.5);
      doc.fillColor("#1e293b");

      // Score
      doc.fontSize(14).font("Helvetica-Bold").text(`Overall Score: ${score}/100`, { align: "center" });
      doc.moveDown(0.3);

      // Score bar
      const barW = 300; const barH = 20; const barX = (doc.page.width - 100 - barW) / 2;
      const barColor = score >= 80 ? "#10B981" : score >= 50 ? "#F59E0B" : "#EF4444";
      doc.roundedRect(barX, doc.y, barW, barH, 4).fill("#e2e8f0");
      doc.roundedRect(barX, doc.y, barW * (score / 100), barH, 4).fill(barColor);
      doc.moveDown(1.5);

      // Summary stats
      const stats = [
        ["Total Issues", String(audit.totalIssues)],
        ["Critical", String(audit.criticalIssues)],
        ["High", String(audit.highIssues)],
        ["Medium", String(audit.mediumIssues)],
        ["Low", String(audit.lowIssues)],
        ["Pages", String(audit.crawledFiles.filter((f) => f.type === "html").length)],
        ["Pass", String(audit.moduleResults.filter((m) => m.status === "pass").length)],
        ["Warning", String(audit.moduleResults.filter((m) => m.status === "warning").length)],
        ["Fail", String(audit.moduleResults.filter((m) => m.status === "fail").length)],
      ];
      doc.fontSize(10).font("Helvetica-Bold").text("Executive Summary", { underline: true });
      doc.moveDown(0.3);
      for (const [label, value] of stats) {
        doc.fontSize(9).font("Helvetica").text(`${label}: ${value}`, { indent: 20 });
      }
      doc.moveDown(0.5);

      // Module summary table
      doc.fontSize(10).font("Helvetica-Bold").text("Module Summary", { underline: true });
      doc.moveDown(0.3);

      const tableTop = doc.y;
      const colWidths = [200, 50, 50, 60];
      const headers = ["Module", "Score", "Issues", "Status"];
      doc.fontSize(8).font("Helvetica-Bold");
      let cx = 50;
      for (let i = 0; i < headers.length; i++) {
        doc.text(headers[i], cx, tableTop, { width: colWidths[i], align: "left" });
        cx += colWidths[i];
      }
      doc.moveDown(0.3);

      for (const mod of audit.moduleResults) {
        const statusStr = mod.status.toUpperCase();
        doc.fontSize(7.5).font("Helvetica");
        cx = 50;
        const vals = [mod.moduleName, String(mod.score), String(mod.issues.length), statusStr];
        for (let i = 0; i < vals.length; i++) {
          doc.text(vals[i], cx, doc.y, { width: colWidths[i], align: "left" });
          cx += colWidths[i];
        }
        doc.moveDown(0.2);
        // Check page break
        if (doc.y > doc.page.height - 100) doc.addPage();
      }
      doc.moveDown(0.5);

      // Priority issues
      const criticalHigh = allIssues.filter((i) => i.severity === "critical" || i.severity === "high");
      if (criticalHigh.length > 0) {
        if (doc.y > doc.page.height - 150) doc.addPage();
        doc.fontSize(10).font("Helvetica-Bold").fillColor("#EF4444").text("Priority Issues (Critical / High)", { underline: true });
        doc.fillColor("#1e293b").moveDown(0.3);
        for (const issue of criticalHigh.slice(0, 30)) {
          doc.fontSize(8).font("Helvetica").text(`• ${issue.title}${issue.filePath ? ` (${issue.filePath})` : ""}`, { indent: 10 });
          if (issue.suggestion) doc.fontSize(7).fillColor("#64748b").text(`  Fix: ${issue.suggestion}`, { indent: 10 }).fillColor("#1e293b");
          doc.moveDown(0.1);
        }
        if (criticalHigh.length > 30) doc.fontSize(7).fillColor("#64748b").text(`... and ${criticalHigh.length - 30} more`).fillColor("#1e293b");
        doc.moveDown(0.5);
      }

      // Top modules with issues
      const topModules = audit.moduleResults.filter((m) => m.issues.length > 0).slice(0, 5);
      for (const mod of topModules) {
        if (doc.y > doc.page.height - 120) doc.addPage();
        doc.fontSize(10).font("Helvetica-Bold").fillColor("#4F46E5").text(`${mod.moduleName} (${mod.issues.length} issues)`);
        doc.fillColor("#1e293b").moveDown(0.2);
        const moduleIssues = mod.issues.slice(0, 15);
        for (const issue of moduleIssues) {
          doc.fontSize(7.5).font("Helvetica").text(`• [${issue.severity.toUpperCase()}] ${issue.title}`, { indent: 10 });
          if (issue.filePath) doc.fontSize(7).fillColor("#64748b").text(`  ${issue.filePath}`, { indent: 10 }).fillColor("#1e293b");
          doc.moveDown(0.05);
        }
        doc.moveDown(0.2);
      }

      // Footer
      doc.fontSize(7).fillColor("#94a3b8").text("Report generated by Website Diagnostic Tool", { align: "center" });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

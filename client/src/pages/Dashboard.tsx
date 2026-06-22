import { useEffect, useState } from "react";
import { trpc } from "../lib/trpc";
import { jsPDF } from "jspdf";
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";
import { severityColor, formatDate } from "../lib/utils";
import { moduleDefs } from "../lib/modules";
import { isProTier } from "../lib/tier";

interface Props { auditId: string; onBack: () => void }

const severityLabels = [
  { key: "criticalIssues", label: "Critical", color: "text-red-600", bg: "bg-red-50", border: "border-red-200", dot: "bg-red-500" },
  { key: "highIssues", label: "High", color: "text-amber-600", bg: "bg-amber-50", border: "border-amber-200", dot: "bg-amber-500" },
  { key: "mediumIssues", label: "Medium", color: "text-blue-600", bg: "bg-blue-50", border: "border-blue-200", dot: "bg-blue-500" },
  { key: "lowIssues", label: "Low", color: "text-slate-600", bg: "bg-slate-50", border: "border-slate-200", dot: "bg-slate-400" },
];

export default function Dashboard({ auditId, onBack }: Props) {
  const isPro = isProTier();
  const [activeModule, setActiveModule] = useState<string | null>(null);
  const [showExport, setShowExport] = useState(false);
  const { data: statusData } = trpc.audit.status.useQuery({ id: auditId }, { refetchInterval: (q) => { const d = q.state.data; return (d?.status === "completed" || d?.status === "failed") ? false : 1000; } });
  const { data: audit, refetch } = trpc.audit.results.useQuery({ id: auditId }, { enabled: false });

  useEffect(() => { if (statusData?.status === "completed" || statusData?.status === "failed") refetch(); }, [statusData, refetch]);

  function copyModuleIssues(mod: any, defName: string) {
    const lines = [`${defName} (score: ${mod.score}/100)`, ""];
    mod.issues.forEach((issue: any, i: number) => {
      lines.push(`Issue #${i + 1} [${issue.severity.toUpperCase()}]: ${issue.title}`);
      if (issue.filePath) lines.push(`  File: ${issue.filePath}`);
      lines.push(`  ${issue.description}`);
      if (issue.suggestion) lines.push(`  Suggestion: ${issue.suggestion}`);
      lines.push("");
    });
    navigator.clipboard.writeText(lines.join("\n"));
  }

  function buildSuggestion(issue: any): { action: string; reason: string; steps: string; impact: string } {
    const s = issue.suggestion || "";
    const d = issue.description || "";
    const t = issue.title || "";
    const isMissing = /missing|not found|no\s+\w+\s+found|does not have|is missing|lacks|absent/i.test(d) || /missing|not found|create|add/i.test(t);
    const isInvalid = /invalid|incorrect|wrong|malformed|not valid|improper/i.test(d) || /invalid|incorrect/i.test(t);
    const action = isMissing ? `Create / Add: ${s}` : isInvalid ? `Fix / Update: ${s}` : `Apply: ${s}`;
    const reasonMap: Record<string, string> = {
      "sitemap": "Search engines rely on sitemaps to discover all pages on your site. Without one, important pages may never get indexed, reducing your organic visibility.",
      "robots": "Robots.txt instructs search engine crawlers which parts of your site to access. A missing or misconfigured robots.txt can either block desired pages or expose private content.",
      "doctype": "The DOCTYPE declaration tells browsers to render the page in standards mode. Without it, browsers may fall back to quirks mode, causing layout inconsistencies.",
      "lang": "The lang attribute on <html> helps screen readers and browsers interpret the page language correctly. Missing it impacts accessibility and SEO.",
      "charset": "Character encoding declaration ensures text displays correctly across all browsers. Missing it can cause garbled characters in non-English content.",
      "title": "Every page needs a unique, descriptive <title>. Search engines display it in results and use it for ranking. Missing titles hurt both SEO and usability.",
      "viewport": "The viewport meta tag controls how your page displays on mobile devices. Without it, mobile users see a zoomed-out desktop layout.",
      "canonical": "Canonical URLs prevent duplicate content issues by telling search engines which version of a page is authoritative.",
      "skip": "Skip-to-content links and <main> landmarks are critical for keyboard and screen reader users to navigate efficiently.",
      "alt": "Alt text on images provides context for screen readers and serves as a fallback when images fail to load. Essential for accessibility.",
      "dead": "Broken links create a poor user experience and waste crawl budget. Search engines mark pages with many dead links as low quality.",
      "security": "Security headers protect your site and its visitors from common attacks like XSS, clickjacking, and data injection.",
      "performance": "Performance issues directly affect user retention. A 1-second delay can reduce conversions by 7% and increases bounce rates.",
    };
    let reason = "";
    for (const [key, text] of Object.entries(reasonMap)) {
      if (d.toLowerCase().includes(key) || t.toLowerCase().includes(key) || s.toLowerCase().includes(key)) {
        reason = text;
        break;
      }
    }
    if (!reason) {
      reason = d ? `${d.charAt(0).toUpperCase() + d.slice(1)}. This negatively impacts your site's quality, user experience, and search ranking.` : `"${t}" negatively impacts your site's quality, user experience, and search ranking.`;
    }

    const severityImpact: Record<string, string> = {
      critical: "Critical issues directly block search engines, users, or core browser functionality. Fixing them should be your highest priority.",
      high: "High-severity issues significantly degrade user experience or search performance. Address them as soon as possible.",
      medium: "Medium-severity issues affect quality and professionalism. While not blocking, fixing them improves your site's overall standard.",
      low: "Low-severity issues are minor improvements. Resolving them polishes your site and demonstrates attention to detail.",
    };

    const steps = `${isMissing ? `1. Create the necessary file or element\n2. Follow the suggestion: ${s}\n3. Verify the implementation works correctly` : isInvalid ? `1. Locate the incorrect element at ${issue.filePath || "the reported location"}\n2. Apply the fix: ${s}\n3. Test to confirm the issue is resolved` : `1. Review the current implementation\n2. Apply: ${s}\n3. Re-run the audit to confirm the fix`}`;

    const impact = `${severityImpact[issue.severity] || "Resolving this improves your site's quality and audit score."} Your overall score will increase once this is fixed.`;

    return { action, reason, steps, impact };
  }

  // Loading state
  if (!statusData || (statusData.status !== "completed" && statusData.status !== "failed")) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center max-w-md">
          <div className="relative w-20 h-20 mx-auto mb-6">
            <div className="absolute inset-0 border-4 border-indigo-200 rounded-full" />
            <div className="absolute inset-0 border-4 border-t-indigo-600 rounded-full animate-spin" />
          </div>
          <h2 className={`text-xl font-bold mb-1 ${isPro ? "text-white" : "text-slate-800"}`}>{statusData?.currentStep || "Initializing audit..."}</h2>
          <p className={`text-sm mb-6 ${isPro ? "text-indigo-300/60" : "text-slate-500"}`}>Analyzing your website across 16 modules</p>
          <div className="w-full h-2.5 bg-slate-200 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full transition-all duration-500" style={{ width: `${statusData?.progress || 0}%` }} />
          </div>
          <p className="text-sm text-slate-400 mt-2">{statusData?.progress || 0}% complete</p>
        </div>
      </div>
    );
  }

  if (statusData.status === "failed") {
    return (
      <div className="text-center py-20">
        <div className={`w-20 h-20 mx-auto mb-6 rounded-2xl flex items-center justify-center ${isPro ? "bg-red-900/20" : "bg-red-50"}`}>
          <svg className="w-10 h-10 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
        </div>
        <h2 className={`text-xl font-bold mb-2 ${isPro ? "text-white" : "text-slate-800"}`}>Audit Failed</h2>
        <p className={`mb-6 max-w-md mx-auto ${isPro ? "text-indigo-300/60" : "text-slate-500"}`}>{statusData.currentStep}</p>
        <button onClick={onBack} className="px-6 py-2.5 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 transition-colors shadow-sm">
          Back to start
        </button>
      </div>
    );
  }

  const a = audit as any;
  if (!a) return null;
  const modIssues = a.moduleResults ? (typeof a.moduleResults === "string" ? (() => { try { return JSON.parse(a.moduleResults); } catch { return []; } })() : a.moduleResults) : [];
  const totalIssues = (a.criticalIssues ?? 0) + (a.highIssues ?? 0) + (a.mediumIssues ?? 0) + (a.lowIssues ?? 0);
  const score = a.overallScore ?? 0;

  const scoreArc = (score / 100) * 360;
  const scoreColor = score >= 80 ? "#10B981" : score >= 60 ? "#F59E0B" : score >= 40 ? "#F97316" : "#EF4444";
  const svgSize = 140;
  const center = svgSize / 2;
  const radius = 58;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  function buildReportText() {
    let text = `Audit Report: ${a.name || "Untitled"}\n`;
    text += `Source: ${a.sourceType} - ${a.sourcePath}\n`;
    text += `Date: ${formatDate(a.createdAt)}\n`;
    text += `Score: ${a.overallScore ?? "N/A"}/100\n\n`;
    text += `Issues: ${a.criticalIssues ?? 0} Critical, ${a.highIssues ?? 0} High, ${a.mediumIssues ?? 0} Medium, ${a.lowIssues ?? 0} Low\n\n`;
    text += `Modules:\n`;
    modIssues.forEach((m: any) => {
      text += `  ${m.moduleName || m.moduleId}: ${m.score}/100 (${m.issues?.length || 0} issues)\n`;
      (m.issues || []).forEach((i: any) => {
        text += `    [${i.severity}] ${i.title}\n`;
        if (i.filePath) text += `      File: ${i.filePath}\n`;
        text += `      ${i.description}\n`;
      });
    });
    return text;
  }

  function downloadBlob(content: string, filename: string, mime: string) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const aEl = document.createElement("a"); aEl.href = url; aEl.download = filename; aEl.click();
    URL.revokeObjectURL(url);
  }

  function exportJSON() {
    const report = {
      name: a.name,
      sourceType: a.sourceType,
      sourcePath: a.sourcePath,
      createdAt: a.createdAt,
      score: a.overallScore,
      issues: { critical: a.criticalIssues, high: a.highIssues, medium: a.mediumIssues, low: a.lowIssues },
      modules: modIssues.map((m: any) => ({
        moduleId: m.moduleId, moduleName: m.moduleName, score: m.score, status: m.status,
        issues: m.issues?.map((i: any) => ({ severity: i.severity, title: i.title, description: i.description, filePath: i.filePath, suggestion: i.suggestion }))
      })),
      files: a.crawledFiles?.length || 0
    };
    downloadBlob(JSON.stringify(report, null, 2), `${a.name || "audit"}-report.json`, "application/json");
    setShowExport(false);
  }

  function exportPDF() {
    const doc = new jsPDF();
    const name = a.name || "Untitled Audit";
    doc.setFontSize(18); doc.setTextColor(79, 70, 229);
    doc.text(name, 14, 22);
    doc.setFontSize(10); doc.setTextColor(100, 116, 139);
    doc.text(`${a.sourceType} — ${a.sourcePath}`, 14, 30);
    doc.text(formatDate(a.createdAt), 14, 36);
    const score = a.overallScore ?? 0;
    doc.setFontSize(40); doc.setTextColor(score >= 80 ? 16 : score >= 60 ? 245 : score >= 40 ? 249 : 220, score >= 80 ? 185 : score >= 60 ? 158 : score >= 40 ? 115 : 38, score >= 80 ? 129 : score >= 60 ? 11 : score >= 40 ? 22 : 38);
    doc.text(String(score), 14, 62);
    doc.setFontSize(10); doc.setTextColor(148, 163, 184);
    doc.text("/100", 14, 70);
    doc.setFontSize(9); doc.setTextColor(100, 116, 139);
    doc.text(`Critical: ${a.criticalIssues ?? 0}    High: ${a.highIssues ?? 0}    Medium: ${a.mediumIssues ?? 0}    Low: ${a.lowIssues ?? 0}`, 14, 82);
    let y = 96;
    modIssues.forEach((m: any) => {
      if (y > 260) { doc.addPage(); y = 20; }
      doc.setFontSize(12); doc.setTextColor(30, 41, 59);
      doc.text(`${m.moduleName || m.moduleId} — ${m.score}/100`, 14, y); y += 8;
      (m.issues || []).forEach((i: any) => {
        if (y > 270) { doc.addPage(); y = 20; }
        const sevColors: Record<string, [number, number, number]> = { critical: [220, 38, 38], high: [245, 158, 11], medium: [59, 130, 246], low: [148, 163, 184] };
        const sc = sevColors[i.severity] || [100, 116, 139];
        doc.setFontSize(9); doc.setTextColor(...sc);
        doc.text(`[${i.severity.toUpperCase()}]`, 14, y);
        const tw = doc.getTextWidth(`[${i.severity.toUpperCase()}] `);
        doc.setTextColor(30, 41, 59); doc.setFontSize(10);
        const titleLines = doc.splitTextToSize(i.title, 170);
        titleLines.forEach((line: string) => { doc.text(line, 14 + tw, y); y += 5; });
        y += 2;
        doc.setFontSize(8); doc.setTextColor(100, 116, 139);
        const descLines = doc.splitTextToSize(i.description, 180);
        descLines.forEach((line: string) => { doc.text(line, 24, y); y += 4; });
        y += 3;
      });
    });
    doc.save(`${name.replace(/[^a-zA-Z0-9]/g, "_")}-report.pdf`);
    setShowExport(false);
  }

  function exportTXT() {
    downloadBlob(buildReportText(), `${a.name || "audit"}-report.txt`, "text/plain");
    setShowExport(false);
  }

  async function exportDOC() {
    const name = a.name || "Untitled Audit";
    const children: any[] = [
      new Paragraph({ text: name, heading: HeadingLevel.HEADING_1 }),
      new Paragraph({ children: [new TextRun({ text: `${a.sourceType} — ${a.sourcePath}`, size: 20, color: "64748b" })] }),
      new Paragraph({ children: [new TextRun({ text: formatDate(a.createdAt), size: 20, color: "64748b" })] }),
      new Paragraph({ spacing: { before: 400 } }),
      new Paragraph({ children: [new TextRun({ text: `Score: ${a.overallScore ?? "N/A"}/100`, size: 32, bold: true })] }),
      new Paragraph({ children: [new TextRun({ text: `Issues: ${a.criticalIssues ?? 0} Critical, ${a.highIssues ?? 0} High, ${a.mediumIssues ?? 0} Medium, ${a.lowIssues ?? 0} Low`, size: 20 })] }),
      new Paragraph({ spacing: { before: 400 } }),
    ];
    modIssues.forEach((m: any) => {
      children.push(new Paragraph({ text: `${m.moduleName || m.moduleId} (${m.score}/100)`, heading: HeadingLevel.HEADING_2 }));
      (m.issues || []).forEach((i: any) => {
        children.push(new Paragraph({ spacing: { before: 200 }, children: [
          new TextRun({ text: `[${i.severity.toUpperCase()}] `, bold: true, size: 20, color: i.severity === "critical" ? "dc2626" : i.severity === "high" ? "f59e0b" : i.severity === "medium" ? "3b82f6" : "94a3b8" }),
          new TextRun({ text: i.title, bold: true, size: 20 }),
        ] }));
        if (i.filePath) children.push(new Paragraph({ children: [new TextRun({ text: i.filePath, size: 18, italics: true, color: "64748b" })] }));
        children.push(new Paragraph({ children: [new TextRun({ text: i.description, size: 18 })] }));
      });
    });
    const doc = new Document({ sections: [{ children }] });
    const blob = await Packer.toBlob(doc);
    const url = URL.createObjectURL(blob);
    const aEl = document.createElement("a"); aEl.href = url; aEl.download = `${name.replace(/[^a-zA-Z0-9]/g, "_")}-report.docx`; aEl.click();
    URL.revokeObjectURL(url);
    setShowExport(false);
  }

  return (
    <div className="animate-fadeIn">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className={`flex items-center gap-1.5 text-sm transition-colors font-medium ${isPro ? "text-indigo-300 hover:text-white" : "text-slate-500 hover:text-indigo-600"}`}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
            Back
          </button>
          <div>
            <h1 className={`text-xl font-bold ${isPro ? "text-white" : "text-slate-900"}`}>{a.name || "Untitled Audit"}</h1>
            <p className={`text-sm flex items-center gap-2 ${isPro ? "text-indigo-300/60" : "text-slate-400"}`}>
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${isPro ? "bg-slate-800 text-indigo-300" : "bg-slate-100 text-slate-600"}`}>{a.sourceType}</span>
              {a.sourcePath} &middot; {formatDate(a.createdAt)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 relative">
          <button onClick={() => setShowExport(!showExport)} className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all shadow-sm ${isPro ? "bg-indigo-600 text-white hover:bg-indigo-500" : "bg-indigo-600 text-white hover:bg-indigo-700"}`}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
            Export
            <svg className={`w-3 h-3 transition-transform ${showExport ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
          </button>
          {showExport && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowExport(false)} />
              <div className={`absolute right-0 top-full mt-2 z-50 w-44 rounded-xl border shadow-xl overflow-hidden ${isPro ? "bg-slate-900 border-indigo-900/40" : "bg-white border-slate-200"}`}>
                {[
                  { label: "JSON", icon: "M4 7v10c0 2 1 3 3 3h10c2 0 3-1 3-3V7M9 5h6M9 5a2 2 0 012-2h2a2 2 0 012 2M9 5H7a2 2 0 00-2 2v1", action: exportJSON },
                  { label: "PDF Report", icon: "M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z m3-4l4-4m0 0l-4-4m4 4H7", action: exportPDF },
                  { label: "TXT File", icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z", action: exportTXT },
                  { label: "DOC File", icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z", action: exportDOC },
                ].map(({ label, icon, action }) => (
                  <button key={label} onClick={action} className={`w-full flex items-center gap-3 px-4 py-3 text-sm font-medium transition-colors ${isPro ? "text-indigo-200 hover:bg-indigo-500/10 hover:text-white" : "text-slate-700 hover:bg-indigo-50 hover:text-indigo-700"}`}>
                    <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d={icon} /></svg>
                    {label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Score + Severity Row */}
      <div className="grid grid-cols-6 gap-4 mb-8">
        {/* Score Gauge */}
        <div className={`col-span-2 rounded-2xl border p-5 flex items-center gap-5 ${isPro ? "bg-slate-900/50 border-indigo-900/30" : "bg-white border-slate-200"}`}>
          <div className="relative flex-shrink-0" style={{ width: svgSize, height: svgSize }}>
            <svg className="transform -rotate-90" width={svgSize} height={svgSize}>
              <circle cx={center} cy={center} r={radius} fill="none" stroke="#e2e8f0" strokeWidth="10" />
              <circle cx={center} cy={center} r={radius} fill="none" stroke={scoreColor} strokeWidth="10" strokeLinecap="round"
                strokeDasharray={circumference} strokeDashoffset={offset}
                className="transition-all duration-1000 ease-out" />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center flex-col">
              <span className="text-3xl font-extrabold" style={{ color: scoreColor }}>{score}</span>
              <span className={`text-[10px] font-medium uppercase tracking-wider ${isPro ? "text-indigo-400/50" : "text-slate-400"}`}>/100</span>
            </div>
          </div>
          <div>
            <div className={`text-lg font-bold ${isPro ? "text-white" : "text-slate-800"}`}>
              {score >= 80 ? "Great Shape" : score >= 60 ? "Needs Work" : score >= 40 ? "Poor" : "Critical"}
            </div>
            <p className={`text-sm mt-0.5 ${isPro ? "text-indigo-300/60" : "text-slate-500"}`}>Overall Website Integrity Score</p>
            <div className={`flex items-center gap-3 mt-3 text-xs ${isPro ? "text-indigo-300/50" : "text-slate-500"}`}>
              <span className="flex items-center gap-1">
                <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                {a.crawledFiles?.length || 0} files
              </span>
              <span className="flex items-center gap-1">
                <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
                {a.moduleResults?.length || 0} modules
              </span>
            </div>
          </div>
        </div>

        {/* Severity Cards */}
        {severityLabels.map(({ key, label, color, bg, border, dot }) => (
          <div key={key} className={`rounded-2xl border p-4 flex flex-col items-center justify-center text-center ${isPro ? "bg-slate-900/50 border-indigo-900/30" : `bg-white ${border}`}`}>
            <div className={`text-3xl font-extrabold ${color}`}>{a[key] ?? 0}</div>
            <div className="text-xs font-medium text-slate-500 uppercase tracking-wider mt-1 flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
              {label}
            </div>
          </div>
        ))}
      </div>

      {/* Module Results */}
      <div className="flex items-center justify-between mb-4">
        <h2 className={`text-lg font-bold flex items-center gap-2 ${isPro ? "text-white" : "text-slate-800"}`}>
          <svg className={`w-5 h-5 ${isPro ? "text-indigo-400" : "text-indigo-500"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" /></svg>
          16 Audit Modules
        </h2>
        <div className="flex gap-1">
          {[{ l: "All", v: null }, { l: "Critical", v: "critical" }, { l: "Failed", v: "fail" }, { l: "Warning", v: "warning" }, { l: "Passed", v: "zero" }].map(({ l, v }) => (
              <button key={l} onClick={() => setActiveModule(activeModule === v ? null : v)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                activeModule === v
                  ? "bg-indigo-600 text-white shadow-sm"
                  : isPro
                    ? "bg-slate-800 text-indigo-300 hover:bg-slate-700"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}>{l}</button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {moduleDefs
          .map((def) => {
            const mod = modIssues.find((m: any) => m.moduleId === def.id);
            if (!mod) return null;
            const issueCount = mod.issues?.length || 0;
            if (activeModule === "zero") { if (issueCount > 0) return null; }
            else if (activeModule === "critical") { const hasCritical = mod.issues?.some((i: any) => i.severity === "critical"); if (!hasCritical) return null; }
            else if (activeModule === "fail") { if (mod.status !== "fail") return null; }
            else if (activeModule && mod.status !== activeModule) return null;
            const hasCritical = mod.issues?.some((i: any) => i.severity === "critical");
            const statusLabel = hasCritical ? "Critical" : issueCount === 0 ? "Passed" : mod.status === "fail" ? "Failed" : "Warning";
            const statusBadge = hasCritical ? "bg-red-50 text-red-700" : issueCount === 0 ? "bg-emerald-50 text-emerald-700" : mod.status === "fail" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700";
            return (
              <details key={def.id} className={`group rounded-2xl border overflow-hidden card-hover ${isPro ? "bg-slate-900/50 border-indigo-900/30" : "bg-white border-slate-200"}`}>
                <summary className="p-5 cursor-pointer">
                  <div className="flex items-start gap-4">
                    <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${def.color} flex items-center justify-center shadow-sm flex-shrink-0`}>
                      <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d={def.icon} />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-1">
                        <span className={`font-semibold ${isPro ? "text-indigo-100" : "text-slate-800"}`}>{def.name}</span>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${statusBadge}`}>{statusLabel}</span>
                      </div>
                      <div className={`text-xs ${isPro ? "text-indigo-300/50" : "text-slate-400"}`}>{def.desc}</div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className={`text-xl font-extrabold ${isPro ? "text-white" : "text-slate-700"}`}>{mod.score}</div>
                      <div className={`text-[10px] uppercase tracking-wider ${isPro ? "text-indigo-400/50" : "text-slate-400"}`}>/100</div>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-4">
                    <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all duration-700 animate-fill-bar ${issueCount === 0 ? "bg-emerald-500" : hasCritical || mod.status === "fail" ? "bg-red-500" : "bg-amber-500"}`}
                        style={{ width: `${mod.score}%` }} />
                    </div>
                    <span className={`text-xs font-medium ${isPro ? "text-indigo-300/50" : "text-slate-400"}`}>{issueCount} issue{issueCount !== 1 ? "s" : ""}</span>
                    {issueCount > 0 && (
                      <button onClick={(e) => { e.stopPropagation(); e.preventDefault(); copyModuleIssues(mod, def.name); }}
                        className="flex items-center gap-1 px-2.5 py-1 bg-slate-50 text-slate-600 rounded-lg text-xs font-medium hover:bg-slate-100 transition-colors">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                        Copy
                      </button>
                    )}
                    <svg className={`w-4 h-4 text-slate-300 group-open:rotate-180 transition-transform flex-shrink-0`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </summary>
                <div className="border-t border-slate-100">
                  {issueCount === 0 ? (
                    <div className="p-5 text-sm text-emerald-600 font-medium flex items-center gap-2">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                      No issues found
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100">
                      {mod.issues.map((issue: any) => (
                        <div key={issue.id} className="p-5 hover:bg-slate-50 transition-colors">
                          <div className="flex items-start gap-3">
                            <span className="w-2.5 h-2.5 rounded-full mt-1.5 flex-shrink-0" style={{ backgroundColor: severityColor(issue.severity) }} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                                <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded" style={{ backgroundColor: severityColor(issue.severity) + "15", color: severityColor(issue.severity) }}>{issue.severity}</span>
                                <span className="text-sm font-medium text-slate-800">{issue.title}</span>

                              </div>
                              <p className="text-xs text-slate-500 mt-1 leading-relaxed">{issue.filePath ? issue.description.replace(issue.filePath, "").replace(/:/g, "").replace(/[\s,;.\-]+$/, "") : issue.description}</p>
                              {issue.filePath ? (
                                <div className="flex items-center gap-1.5 mt-1.5 text-xs text-indigo-600 font-mono">
                                  <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                                  {issue.filePath}
                                </div>
                              ) : (
                                <div className="flex items-center gap-1.5 mt-1.5 text-xs text-slate-400 font-mono">
                                  <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                                  (global)
                                </div>
                              )}
                              {issue.suggestion && (
                                <div className={`mt-4 relative ${!isPro ? "" : ""}`}>
                                  {!isPro && (
                                    <div className="absolute inset-0 backdrop-blur-sm flex items-center justify-center z-10">
                                      <div className="flex items-center gap-1.5 px-2.5 py-1 bg-indigo-600 text-white rounded-full text-[9px] font-bold uppercase tracking-wider shadow-lg">
                                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
                                        Pro Feature
                                      </div>
                                    </div>
                                  )}
                                  <div className={`relative overflow-hidden rounded-2xl ${!isPro ? "blur-sm select-none" : ""}`}>
                                    {/* Glow effect */}
                                    {isPro && <div className="absolute -inset-1 bg-gradient-to-r from-emerald-500/20 via-indigo-500/20 to-emerald-500/20 blur-xl opacity-60" />}
                                    <div className={`relative ${isPro ? "bg-slate-900/90 border border-slate-700/50 shadow-2xl shadow-emerald-500/5" : "bg-slate-100"}`}>
                                      {/* Top gradient line */}
                                      <div className="h-0.5 bg-gradient-to-r from-emerald-400 via-indigo-400 to-emerald-400" />
                                      {/* Header */}
                                      <div className="flex items-center gap-3 px-4 py-3">
                                        <div className="relative">
                                          <div className="absolute inset-0 bg-emerald-400/30 blur-md rounded-full" />
                                          <div className="relative w-8 h-8 rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
                                            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
                                          </div>
                                        </div>
                                        <div className="flex-1">
                                          <span className="text-sm font-semibold text-transparent bg-clip-text bg-gradient-to-r from-emerald-300 to-indigo-300">Pro Recommendation</span>
                                          <p className="text-[10px] text-slate-500 mt-0.5">AI-powered fix suggestion</p>
                                        </div>
                                        <span className={`px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider border ${issue.severity === "critical" ? "bg-red-500/10 text-red-400 border-red-500/20" : issue.severity === "high" ? "bg-amber-500/10 text-amber-400 border-amber-500/20" : issue.severity === "medium" ? "bg-blue-500/10 text-blue-400 border-blue-500/20" : "bg-slate-500/10 text-slate-400 border-slate-500/20"}`}>
                                          {issue.severity}
                                        </span>
                                      </div>
                                      {/* Divider */}
                                      <div className="border-t border-slate-700/50" />
                                      {/* Body */}
                                      <div className="px-4 py-3.5 space-y-3">
                                        <div className="flex items-start gap-3">
                                          <div className="w-6 h-6 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                                            <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                                          </div>
                                          <div className="flex-1">
                                            <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">Recommended Action</span>
                                            <p className="text-sm text-slate-200 leading-relaxed mt-1">{buildSuggestion(issue).action}</p>
                                          </div>
                                        </div>
                                        <div className="flex items-start gap-3">
                                          <div className="w-6 h-6 rounded-full bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                                            <svg className="w-3.5 h-3.5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                          </div>
                                          <div className="flex-1">
                                            <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider">Why</span>
                                            <p className="text-sm text-slate-300 leading-relaxed mt-1">{buildSuggestion(issue).reason}</p>
                                          </div>
                                        </div>
                                        <details className="group">
                                          <summary className="flex items-center gap-2 cursor-pointer list-none">
                                            <div className="w-6 h-6 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center flex-shrink-0">
                                              <svg className="w-3.5 h-3.5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                                            </div>
                                            <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wider">Implementation Steps</span>
                                            <svg className="w-3 h-3 text-slate-500 group-open:rotate-90 transition-transform ml-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                                          </summary>
                                          <div className="mt-2 ml-9">
                                            <div className="bg-slate-800/60 rounded-xl p-3 border border-slate-700/30">
                                              {buildSuggestion(issue).steps.split("\n").map((step: string, i: number) => (
                                                <div key={i} className="flex items-start gap-2 py-0.5">
                                                  <span className="text-[10px] font-bold text-amber-400/80 w-4 flex-shrink-0 mt-0.5">{step.match(/^\d+/)?.[0] || "•"}</span>
                                                  <span className="text-xs text-slate-400">{step.replace(/^\d+\.\s*/, "")}</span>
                                                </div>
                                              ))}
                                            </div>
                                          </div>
                                        </details>
                                      </div>
                                      {/* Footer */}
                                      <div className="px-4 py-2.5 bg-slate-800/50 border-t border-slate-700/30 flex items-start gap-2.5">
                                        <div className="w-5 h-5 rounded-full bg-emerald-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                                          <svg className="w-3 h-3 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                        </div>
                                        <p className="text-[11px] text-slate-400 leading-relaxed">{buildSuggestion(issue).impact}</p>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {mod.generatedRobots && (
                    <details className="border-t border-slate-100">
                      <summary className="p-4 text-sm font-medium text-slate-600 cursor-pointer hover:bg-slate-50 flex items-center gap-2">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                        Recommended robots.txt
                      </summary>
                      <pre className="p-4 text-xs bg-slate-900 text-slate-200 overflow-auto rounded-b-2xl font-mono leading-relaxed">{mod.generatedRobots}</pre>
                    </details>
                  )}
                </div>
              </details>
            );
          })}
      </div>
    </div>
  );
}

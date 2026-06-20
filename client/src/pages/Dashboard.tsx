import { useEffect, useState } from "react";
import { trpc } from "../lib/trpc";
import { severityColor, formatDate } from "../lib/utils";
import { moduleDefs } from "../lib/modules";

interface Props { auditId: string; onBack: () => void }

const severityLabels = [
  { key: "criticalIssues", label: "Critical", color: "text-red-600", bg: "bg-red-50", border: "border-red-200", dot: "bg-red-500" },
  { key: "highIssues", label: "High", color: "text-amber-600", bg: "bg-amber-50", border: "border-amber-200", dot: "bg-amber-500" },
  { key: "mediumIssues", label: "Medium", color: "text-blue-600", bg: "bg-blue-50", border: "border-blue-200", dot: "bg-blue-500" },
  { key: "lowIssues", label: "Low", color: "text-slate-600", bg: "bg-slate-50", border: "border-slate-200", dot: "bg-slate-400" },
];

export default function Dashboard({ auditId, onBack }: Props) {
  const [activeModule, setActiveModule] = useState<string | null>(null);
  const [fixBusy, setFixBusy] = useState<string[]>([]);
  const [fixPreview, setFixPreview] = useState<any>(null);
  const [fixResults, setFixResults] = useState<any>(null);
  const [previewIssueIds, setPreviewIssueIds] = useState<string[]>([]);

  const { data: statusData } = trpc.audit.status.useQuery({ id: auditId }, { refetchInterval: (q) => { const d = q.state.data; return (d?.status === "completed" || d?.status === "failed") ? false : 1000; } });
  const { data: audit, refetch } = trpc.audit.results.useQuery({ id: auditId }, { enabled: false });
  const { data: fixData } = trpc.audit.canFix.useQuery({ id: auditId }, { enabled: false });

  const dryRunMutation = trpc.audit.dryRunFixes.useQuery({ id: auditId, issueIds: [] }, { enabled: false });
  const applyMutation = trpc.audit.applyFixes.useMutation();

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

  // Loading state
  if (!statusData || (statusData.status !== "completed" && statusData.status !== "failed")) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center max-w-md">
          <div className="relative w-20 h-20 mx-auto mb-6">
            <div className="absolute inset-0 border-4 border-indigo-200 rounded-full" />
            <div className="absolute inset-0 border-4 border-t-indigo-600 rounded-full animate-spin" />
          </div>
          <h2 className="text-xl font-bold text-slate-800 mb-1">{statusData?.currentStep || "Initializing audit..."}</h2>
          <p className="text-sm text-slate-500 mb-6">Analyzing your website across 16 modules</p>
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
        <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-red-50 flex items-center justify-center">
          <svg className="w-10 h-10 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-slate-800 mb-2">Audit Failed</h2>
        <p className="text-slate-500 mb-6 max-w-md mx-auto">{statusData.currentStep}</p>
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

  const fixMap = fixData ? new Map(fixData.map((f: any) => [f.id, f])) : new Map();

  async function handleFix(issueIds: string[]) {
    setFixBusy(issueIds);
    setPreviewIssueIds(issueIds);
    try {
      const result = await dryRunMutation.refetch({ queryKey: ["dryRunFixes", { id: auditId, issueIds }] } as any);
      if (result.data) {
        setFixPreview(result.data);
      }
    } catch (err) {
      alert("Dry-run failed: " + (err instanceof Error ? err.message : String(err)));
    }
    setFixBusy([]);
  }

  async function handleApplyFix() {
    setFixResults(null);
    try {
      const result = await applyMutation.mutateAsync({ id: auditId, issueIds: previewIssueIds });
      setFixResults(result);
      setFixPreview(null);
      setTimeout(() => { setFixResults(null); refetch(); }, 3000);
    } catch (err) {
      alert("Fix failed: " + (err instanceof Error ? err.message : String(err)));
    }
  }

  function getModuleIssues(mod: any) {
    return (mod.issues || []).filter((i: any) => fixMap.get(i.id)?.canFix);
  }

  return (
    <div className="animate-fadeIn">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-indigo-600 transition-colors font-medium">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
            Back
          </button>
          <div>
            <h1 className="text-xl font-bold text-slate-900">{a.name || "Untitled Audit"}</h1>
            <p className="text-sm text-slate-400 flex items-center gap-2">
              <span className="px-2 py-0.5 bg-slate-100 rounded text-xs font-medium text-slate-600">{a.sourceType}</span>
              {a.sourcePath} &middot; {formatDate(a.createdAt)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2"></div>
      </div>

      {/* Score + Severity Row */}
      <div className="grid grid-cols-6 gap-4 mb-8">
        {/* Score Gauge */}
        <div className="col-span-2 bg-white rounded-2xl border border-slate-200 p-5 flex items-center gap-5">
          <div className="relative flex-shrink-0" style={{ width: svgSize, height: svgSize }}>
            <svg className="transform -rotate-90" width={svgSize} height={svgSize}>
              <circle cx={center} cy={center} r={radius} fill="none" stroke="#e2e8f0" strokeWidth="10" />
              <circle cx={center} cy={center} r={radius} fill="none" stroke={scoreColor} strokeWidth="10" strokeLinecap="round"
                strokeDasharray={circumference} strokeDashoffset={offset}
                className="transition-all duration-1000 ease-out" />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center flex-col">
              <span className="text-3xl font-extrabold" style={{ color: scoreColor }}>{score}</span>
              <span className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">/100</span>
            </div>
          </div>
          <div>
            <div className="text-lg font-bold text-slate-800">
              {score >= 80 ? "Great Shape" : score >= 60 ? "Needs Work" : score >= 40 ? "Poor" : "Critical"}
            </div>
            <p className="text-sm text-slate-500 mt-0.5">Overall Website Integrity Score</p>
            <div className="flex items-center gap-3 mt-3 text-xs text-slate-500">
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
          <div key={key} className={`bg-white rounded-2xl border ${border} p-4 flex flex-col items-center justify-center text-center`}>
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
        <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
          <svg className="w-5 h-5 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" /></svg>
          16 Audit Modules
        </h2>
        <div className="flex gap-1">
          {[{ l: "All", v: null }, { l: "Critical", v: "critical" }, { l: "Failed", v: "fail" }, { l: "Warning", v: "warning" }, { l: "Passed", v: "zero" }].map(({ l, v }) => (
              <button key={l} onClick={() => setActiveModule(activeModule === v ? null : v)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                activeModule === v
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}>{l}</button>
          ))}
        </div>
      </div>

      {/* Fix results banner */}
      {fixResults && (
        <div className="mb-4 p-4 rounded-xl bg-emerald-50 border border-emerald-200">
          <div className="flex items-center gap-2 text-emerald-800 font-medium mb-2">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Fixes Applied
          </div>
          <div className="text-sm text-emerald-700 space-y-1">
            {fixResults.map((r: any, i: number) => (
              <div key={i} className="flex items-center gap-2">
                <span>{r.success ? "✓" : "✗"}</span>
                <span className="font-mono text-xs">{r.filePath}</span>
                <span className="text-emerald-600">{r.description}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Fix preview modal */}
      {fixPreview && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setFixPreview(null)}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-slate-200">
              <h3 className="font-bold text-slate-800">Fix Preview — {fixPreview.length} change{fixPreview.length !== 1 ? "s" : ""}</h3>
              <button onClick={() => setFixPreview(null)} className="text-slate-400 hover:text-slate-600">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-auto p-5 space-y-4">
              {fixPreview.map((r: any, i: number) => (
                <div key={i} className="border border-slate-200 rounded-xl overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-2 bg-slate-50 text-sm font-medium text-slate-700 border-b border-slate-200">
                    <span className="text-xs font-mono text-indigo-600">{r.filePath}</span>
                    <span className="text-slate-400">·</span>
                    <span className="text-xs text-slate-500">{r.description}</span>
                  </div>
                  {r.diff && (
                    <pre className="p-4 text-xs font-mono overflow-auto max-h-60 bg-slate-900 text-slate-200 leading-relaxed">{r.diff}</pre>
                  )}
                </div>
              ))}
            </div>
            <div className="flex items-center justify-end gap-3 p-5 border-t border-slate-200">
              <button onClick={() => setFixPreview(null)} className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 transition-colors">
                Cancel
              </button>
              <button onClick={handleApplyFix} disabled={applyMutation.isPending} className="px-5 py-2.5 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 transition-colors shadow-sm disabled:opacity-50 flex items-center gap-2">
                {applyMutation.isPending ? (
                  <>
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" /></svg>
                    Applying...
                  </>
                ) : "Apply Fixes"}
              </button>
            </div>
          </div>
        </div>
      )}

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
            const fixableIssues = getModuleIssues(mod);
            return (
              <details key={def.id} className="group bg-white rounded-2xl border border-slate-200 overflow-hidden card-hover">
                <summary className="p-5 cursor-pointer">
                  <div className="flex items-start gap-4">
                    <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${def.color} flex items-center justify-center shadow-sm flex-shrink-0`}>
                      <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d={def.icon} />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-1">
                        <span className="font-semibold text-slate-800">{def.name}</span>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${statusBadge}`}>{statusLabel}</span>
                      </div>
                      <div className="text-xs text-slate-400">{def.desc}</div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-xl font-extrabold text-slate-700">{mod.score}</div>
                      <div className="text-[10px] text-slate-400 uppercase tracking-wider">/100</div>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-4">
                    <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all duration-700 animate-fill-bar ${issueCount === 0 ? "bg-emerald-500" : hasCritical || mod.status === "fail" ? "bg-red-500" : "bg-amber-500"}`}
                        style={{ width: `${mod.score}%` }} />
                    </div>
                    <span className="text-xs text-slate-400 font-medium">{issueCount} issue{issueCount !== 1 ? "s" : ""}</span>
                    {fixableIssues.length > 0 && (
                      <button onClick={(e) => { e.stopPropagation(); e.preventDefault(); handleFix(fixableIssues.map((i: any) => i.id)); }}
                        className="flex items-center gap-1 px-2.5 py-1 bg-indigo-50 text-indigo-700 rounded-lg text-xs font-medium hover:bg-indigo-100 transition-colors">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        Fix {fixableIssues.length}
                      </button>
                    )}
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
                              {issue.filePath && (
                                <div className="flex items-center gap-1.5 mt-1.5 text-xs text-indigo-600 font-mono">
                                  <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                                  {issue.filePath}
                                </div>
                              )}
                              {issue.suggestion && (
                                <div className="mt-3 p-3 bg-indigo-50 rounded-xl text-xs text-indigo-700 flex items-center justify-center gap-2">
                                  <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
                                  <span className="px-2 py-0.5 bg-indigo-600 text-white text-[10px] font-bold uppercase tracking-wider rounded">Pro Feature</span>
                                </div>
                              )}
                              {fixMap.get(issue.id)?.canFix && (
                                <button onClick={() => handleFix([issue.id])} disabled={fixBusy.includes(issue.id)}
                                  className="mt-2 flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-lg text-xs font-medium hover:bg-emerald-100 transition-colors disabled:opacity-50">
                                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                  </svg>
                                  {fixBusy.includes(issue.id) ? "Checking..." : "Auto-fix"}
                                </button>
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

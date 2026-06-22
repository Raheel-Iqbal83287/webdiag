import { useState } from "react";
import { trpc } from "../lib/trpc";
import { formatDate } from "../lib/utils";
import { isProTier } from "../lib/tier";

interface Props { onSelectAudit: (id: string) => void; onCompare: (id1: string, id2: string) => void; onBack: () => void }

const statusConfig: Record<string, { bg: string; text: string; dot: string }> = {
  completed: { bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-500" },
  failed: { bg: "bg-red-50", text: "text-red-700", dot: "bg-red-500" },
  running: { bg: "bg-amber-50", text: "text-amber-700", dot: "bg-amber-500" },
};

export default function History({ onSelectAudit, onCompare, onBack }: Props) {
  const { data: audits, isLoading, error } = trpc.audit.list.useQuery();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [hoveredRow, setHoveredRow] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmDeleteIds, setConfirmDeleteIds] = useState<string[] | null>(null);
  const isPro = isProTier();
  const clearMutation = trpc.audit.clearAll.useMutation();
  const deleteMutation = trpc.audit.delete.useMutation();

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  if (isLoading) return (
    <div className="flex items-center justify-center py-20">
      <div className="text-center">
        <div className="relative w-16 h-16 mx-auto mb-4">
          <div className="absolute inset-0 border-4 border-indigo-200 rounded-full" />
          <div className="absolute inset-0 border-4 border-t-indigo-600 rounded-full animate-spin" />
        </div>
        <p className="text-sm text-slate-500">Loading history...</p>
      </div>
    </div>
  );

  if (error) return (
    <div className="text-center py-20">
      <div className={`w-20 h-20 mx-auto mb-6 rounded-2xl flex items-center justify-center ${isPro ? "bg-red-900/20" : "bg-red-50"}`}>
        <svg className="w-10 h-10 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
        </svg>
      </div>
      <h2 className={`text-xl font-bold mb-2 ${isPro ? "text-white" : "text-slate-800"}`}>Failed to load audits</h2>
      <p className={`text-sm ${isPro ? "text-indigo-300/60" : "text-slate-500"}`}>{error.message}</p>
    </div>
  );

  if (!audits || audits.length === 0) return (
    <div className="text-center py-20">
      <div className={`w-20 h-20 mx-auto mb-6 rounded-2xl flex items-center justify-center ${isPro ? "bg-slate-800" : "bg-slate-100"}`}>
        <svg className={`w-10 h-10 ${isPro ? "text-slate-600" : "text-slate-300"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
        </svg>
      </div>
      <h2 className={`text-xl font-bold mb-2 ${isPro ? "text-white" : "text-slate-800"}`}>No audits yet</h2>
      <p className={`text-sm ${isPro ? "text-indigo-300/60" : "text-slate-500"}`}>Run your first audit to see results here.</p>
    </div>
  );

  const displayAudits = audits as any[];

  return (
    <div className="animate-fadeIn">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className={`p-2 rounded-lg transition-all ${isPro ? "text-indigo-300 hover:text-white hover:bg-white/5" : "text-slate-400 hover:text-slate-600 hover:bg-slate-100"}`} aria-label="Go back">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
          </button>
          <div>
          <h1 className={`text-2xl font-bold ${isPro ? "text-white" : "text-slate-900"}`}>Audit History</h1>
          <p className={`text-sm mt-0.5 ${isPro ? "text-indigo-300/60" : "text-slate-500"}`}>{displayAudits.length} audit{displayAudits.length !== 1 ? "s" : ""} total</p>
        </div>
          </div>
        <div className="flex items-center gap-4">
          <div className={`flex items-center gap-3 text-[11px] ${isPro ? "text-indigo-300/60" : "text-slate-500"}`}>
            <span className="font-medium">Legend:</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-red-500" />Critical</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-amber-500" />High</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-blue-500" />Medium</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-slate-400" />Low</span>
          </div>
          {confirmDeleteIds ? (
            <div className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-medium ${isPro ? "bg-red-900/30 text-red-300" : "bg-red-50 text-red-700"}`}>
              <span>Delete {confirmDeleteIds.length} audit{confirmDeleteIds.length !== 1 ? "s" : ""}?</span>
              <button onClick={() => { Promise.all(confirmDeleteIds.map(id => deleteMutation.mutateAsync({ id }))).then(() => { setConfirmDeleteIds(null); setSelectedIds([]); window.location.reload(); }); }}
                className="px-2.5 py-1 bg-red-600 text-white rounded-lg hover:bg-red-500 transition-colors font-semibold">Yes</button>
              <button onClick={() => setConfirmDeleteIds(null)}
                className="px-2.5 py-1 bg-slate-600 text-white rounded-lg hover:bg-slate-500 transition-colors font-semibold">No</button>
            </div>
          ) : selectedIds.length > 0 ? (
            <button onClick={() => setConfirmDeleteIds(selectedIds)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-red-400 hover:text-red-300 hover:bg-red-900/20 transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
              Delete Selected ({selectedIds.length})
            </button>
          ) : (
            <span></span>
          )}
        </div>
      </div>

      <div className="flex justify-end mb-4">
        {confirmClear ? (
          <div className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-medium ${isPro ? "bg-red-900/30 text-red-300" : "bg-red-50 text-red-700"}`}>
            <span>Delete all audits?</span>
            <button onClick={() => { clearMutation.mutate(undefined, { onSuccess: () => { window.location.reload(); } }); setConfirmClear(false); }}
              className="px-2.5 py-1 bg-red-600 text-white rounded-lg hover:bg-red-500 transition-colors font-semibold">Yes</button>
            <button onClick={() => setConfirmClear(false)}
              className="px-2.5 py-1 bg-slate-600 text-white rounded-lg hover:bg-slate-500 transition-colors font-semibold">No</button>
          </div>
        ) : (
          <button onClick={() => setConfirmClear(true)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${isPro ? "text-red-400 hover:text-red-300 hover:bg-red-900/20" : "text-red-600 hover:text-red-700 hover:bg-red-50"}`}>
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
            Clear History
          </button>
        )}
      </div>

      <div className={`rounded-2xl border overflow-x-auto shadow-sm ${isPro ? "bg-slate-900/50 border-indigo-900/30" : "bg-white border-slate-200"}`}>
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className={`border-b ${isPro ? "bg-slate-800/50 border-indigo-900/20" : "bg-slate-50 border-slate-200"}`}>
              <th className="p-4 w-10">
                <input type="checkbox" checked={selectedIds.length === displayAudits.length} onChange={() => setSelectedIds(selectedIds.length === displayAudits.length ? [] : displayAudits.map(a => a.id))}
                  className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
              </th>
              <th className={`p-4 text-center font-semibold text-xs uppercase tracking-wider ${isPro ? "text-indigo-300" : "text-slate-700"}`}>No.</th>
              <th className={`p-4 text-center font-semibold text-xs uppercase tracking-wider ${isPro ? "text-indigo-300" : "text-slate-700"}`}>Name</th>
              <th className={`p-4 text-center font-semibold text-xs uppercase tracking-wider ${isPro ? "text-indigo-300" : "text-slate-700"}`}>Source</th>
              <th className={`p-4 text-center font-semibold text-xs uppercase tracking-wider ${isPro ? "text-indigo-300" : "text-slate-700"}`}>Status</th>
              <th className={`p-4 text-center font-semibold text-xs uppercase tracking-wider ${isPro ? "text-indigo-300" : "text-slate-700"}`}>Score</th>
              <th className={`p-4 text-center font-semibold text-xs uppercase tracking-wider ${isPro ? "text-indigo-300" : "text-slate-700"}`}>Issues</th>
              <th className={`p-4 text-center font-semibold text-xs uppercase tracking-wider ${isPro ? "text-indigo-300" : "text-slate-700"}`}>Date</th>
              <th className={`p-4 text-center font-semibold text-xs uppercase tracking-wider ${isPro ? "text-indigo-300" : "text-slate-700"}`}></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {displayAudits.map((audit, idx) => {
              const status = statusConfig[audit.status] || statusConfig.running;
              const isSelected = selectedIds.includes(audit.id);
              return (
                <tr key={audit.id}
                  className={`transition-colors cursor-pointer ${isSelected ? (isPro ? "bg-indigo-900/20" : "bg-indigo-50") : ""} ${!isSelected && isPro ? "hover:bg-white/5" : ""}`}
                  onMouseEnter={() => setHoveredRow(audit.id)}
                  onMouseLeave={() => setHoveredRow(null)}
                  onClick={() => onSelectAudit(audit.id)}
                >
                  <td className="p-4" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(audit.id)}
                      className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
                  </td>
                  <td className={`p-4 text-center text-xs ${isPro ? "text-indigo-300/50" : "text-slate-400"}`}>{idx + 1}</td>
                  <td className="p-4 text-center">
                    <span className={`font-semibold ${isPro ? "text-indigo-100" : "text-slate-800"}`}>{audit.name || "Untitled"}</span>
                  </td>
                  <td className="p-4">
                    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium ${isPro ? "bg-slate-800 text-indigo-300" : "bg-slate-100 text-slate-600"}`}>
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                      </svg>
                      {audit.sourceType}
                    </span>
                  </td>
                  <td className="p-4">
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium ${status.bg} ${status.text}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`} />
                      {audit.status}
                    </span>
                  </td>
                  <td className="p-4 text-right">
                    {audit.overallScore != null ? (
                      <span className="font-bold text-lg" style={{ color: audit.overallScore >= 80 ? "#10B981" : audit.overallScore >= 50 ? "#F59E0B" : "#EF4444" }}>{audit.overallScore}</span>
                    ) : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="p-4 text-right">
                    <div className="flex flex-col items-end gap-1">
                      {audit.totalIssues > 0 ? (
                        <>
                          <span className={`text-xs font-medium ${isPro ? "text-indigo-300" : "text-slate-700"}`}>{audit.totalIssues} total</span>
                          <div className="flex items-center gap-1">
                            {audit.criticalIssues > 0 && <span className="px-1.5 py-0.5 bg-red-500 text-white rounded text-[10px] font-bold" title="Critical">{audit.criticalIssues}</span>}
                            {audit.highIssues > 0 && <span className="px-1.5 py-0.5 bg-amber-500 text-white rounded text-[10px] font-bold" title="High">{audit.highIssues}</span>}
                            {audit.mediumIssues > 0 && <span className="px-1.5 py-0.5 bg-blue-500 text-white rounded text-[10px] font-bold" title="Medium">{audit.mediumIssues}</span>}
                            {audit.lowIssues > 0 && <span className="px-1.5 py-0.5 bg-slate-400 text-white rounded text-[10px] font-bold" title="Low">{audit.lowIssues}</span>}
                          </div>
                        </>
                      ) : (
                        <span className={`text-xs ${isPro ? "text-indigo-300/30" : "text-slate-300"}`}>—</span>
                      )}
                    </div>
                  </td>
                  <td className={`p-4 text-right text-xs ${isPro ? "text-indigo-300/50" : "text-slate-400"}`}>{formatDate(audit.createdAt)}</td>
                  <td className="p-4 text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1">

                      <button aria-label="View audit" onClick={(e) => { e.stopPropagation(); onSelectAudit(audit.id); }}
                        className={`p-1.5 rounded-lg transition-colors ${hoveredRow === audit.id ? "bg-indigo-600 text-white shadow-sm" : isPro ? "text-indigo-300 hover:text-white" : "text-slate-400 hover:text-indigo-600"}`}>
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

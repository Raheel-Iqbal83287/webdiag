import { useState } from "react";
import { trpc } from "../lib/trpc";
import { formatDate } from "../lib/utils";

interface Props { onSelectAudit: (id: string) => void; onCompare: (id1: string, id2: string) => void; onBack: () => void }

const statusConfig: Record<string, { bg: string; text: string; dot: string }> = {
  completed: { bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-500" },
  failed: { bg: "bg-red-50", text: "text-red-700", dot: "bg-red-500" },
  running: { bg: "bg-amber-50", text: "text-amber-700", dot: "bg-amber-500" },
};

export default function History({ onSelectAudit, onCompare }: Props) {
  const { data: audits, isLoading, error } = trpc.audit.list.useQuery();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [hoveredRow, setHoveredRow] = useState<string | null>(null);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : prev.length < 2 ? [...prev, id] : [prev[1], id]
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
      <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-red-50 flex items-center justify-center">
        <svg className="w-10 h-10 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
        </svg>
      </div>
      <h2 className="text-xl font-bold text-slate-800 mb-2">Failed to load audits</h2>
      <p className="text-slate-500 text-sm">{error.message}</p>
    </div>
  );

  if (!audits || audits.length === 0) return (
    <div className="text-center py-20">
      <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-slate-100 flex items-center justify-center">
        <svg className="w-10 h-10 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
        </svg>
      </div>
      <h2 className="text-xl font-bold text-slate-800 mb-2">No audits yet</h2>
      <p className="text-slate-500 text-sm">Run your first audit to see results here.</p>
    </div>
  );

  const displayAudits = audits as any[];

  return (
    <div className="animate-fadeIn">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <button onClick={() => { if (window.history.length > 1) { window.history.back() } else { onBack() } }} className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-all" aria-label="Go back">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
          </button>
          <div>
          <h1 className="text-2xl font-bold text-slate-900">Audit History <span className="ml-2 px-1.5 py-0.5 bg-indigo-600 text-white text-[9px] font-bold uppercase tracking-wider rounded align-middle">Pro</span></h1>
          <p className="text-sm text-slate-500 mt-0.5">{displayAudits.length} audit{displayAudits.length !== 1 ? "s" : ""} total</p>
        </div>
          </div>
        {selectedIds.length === 2 && (
          <button onClick={() => onCompare(selectedIds[0], selectedIds[1])} className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 transition-all shadow-sm">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
            Compare Selected
          </button>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 overflow-x-auto shadow-sm">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="p-4 w-10"></th>
              <th className="p-4 text-left font-semibold text-slate-700 text-xs uppercase tracking-wider">Name</th>
              <th className="p-4 text-left font-semibold text-slate-700 text-xs uppercase tracking-wider">Source</th>
              <th className="p-4 text-left font-semibold text-slate-700 text-xs uppercase tracking-wider">Status</th>
              <th className="p-4 text-right font-semibold text-slate-700 text-xs uppercase tracking-wider">Score</th>
              <th className="p-4 text-right font-semibold text-slate-700 text-xs uppercase tracking-wider">Issues</th>
              <th className="p-4 text-right font-semibold text-slate-700 text-xs uppercase tracking-wider">Date</th>
              <th className="p-4 text-right font-semibold text-slate-700 text-xs uppercase tracking-wider"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {displayAudits.map((audit) => {
              const status = statusConfig[audit.status] || statusConfig.running;
              const isSelected = selectedIds.includes(audit.id);
              return (
                <tr key={audit.id}
                  className={`transition-colors cursor-pointer ${isSelected ? "bg-indigo-50" : ""}`}
                  onMouseEnter={() => setHoveredRow(audit.id)}
                  onMouseLeave={() => setHoveredRow(null)}
                  onClick={() => onSelectAudit(audit.id)}
                >
                  <td className="p-4" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(audit.id)}
                      className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
                  </td>
                  <td className="p-4">
                    <span className="font-semibold text-slate-800">{audit.name || "Untitled"}</span>
                  </td>
                  <td className="p-4">
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-100 rounded-lg text-xs font-medium text-slate-600">
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
                    <div className="flex items-center justify-end gap-1.5">
                      {audit.criticalIssues > 0 && <span className="px-1.5 py-0.5 bg-red-50 text-red-700 rounded text-xs font-bold">{audit.criticalIssues}C</span>}
                      {audit.highIssues > 0 && <span className="px-1.5 py-0.5 bg-amber-50 text-amber-700 rounded text-xs font-bold">{audit.highIssues}H</span>}
                      {audit.mediumIssues > 0 && <span className="px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded text-xs font-bold">{audit.mediumIssues}M</span>}
                      {!audit.criticalIssues && !audit.highIssues && !audit.mediumIssues && <span className="text-slate-300">—</span>}
                    </div>
                  </td>
                  <td className="p-4 text-right text-slate-400 text-xs">{formatDate(audit.createdAt)}</td>
                  <td className="p-4 text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1">

                      <button aria-label="View audit" onClick={(e) => { e.stopPropagation(); onSelectAudit(audit.id); }}
                        className={`p-1.5 rounded-lg transition-colors ${hoveredRow === audit.id ? "bg-indigo-600 text-white shadow-sm" : "text-slate-400 hover:text-indigo-600"}`}>
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

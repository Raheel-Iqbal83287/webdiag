import { trpc } from "../lib/trpc";
import { formatDate } from "../lib/utils";

interface Props { id1: string; id2: string; onBack: () => void }

export default function Compare({ id1, id2, onBack }: Props) {
  const { data, isLoading } = trpc.audit.compare.useQuery({ id1, id2 });

  if (isLoading) return (
    <div className="flex items-center justify-center py-20">
      <div className="relative w-16 h-16">
        <div className="absolute inset-0 border-4 border-indigo-200 rounded-full" />
        <div className="absolute inset-0 border-4 border-t-indigo-600 rounded-full animate-spin" />
      </div>
    </div>
  );
  if (!data) return <p className="text-center py-20 text-slate-500">Failed to load comparison.</p>;

  const { audit1, audit2, moduleComparison, newIssues, resolvedIssues, commonIssues } = data;
  const scoreDiff = audit2.score! - audit1.score!;

  return (
    <div className="animate-fadeIn">
      <div className="flex items-center gap-4 mb-8">
        <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-indigo-600 transition-colors font-medium">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
          Back
        </button>
        <h1 className="text-2xl font-bold text-slate-900">Audit Comparison</h1>
      </div>

      {/* Side-by-side Audit Cards */}
      <div className="grid grid-cols-2 gap-5 mb-6">
        {([audit1, audit2] as const).map((a, i) => (
          <div key={i} className={`bg-white rounded-2xl border-2 p-5 shadow-sm ${i === 0 ? "border-slate-200" : "border-indigo-200"}`}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Audit {i + 1}</span>
              {i === 1 && <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded-lg text-xs font-bold">Newer</span>}
            </div>
            <div className="font-bold text-slate-800 text-lg">{a.name}</div>
            <div className="text-xs text-slate-400 mb-4">{formatDate(a.createdAt)}</div>
            <div className="flex items-baseline gap-1.5 mb-3">
              <span className="text-4xl font-extrabold text-indigo-600">{a.score}</span>
              <span className="text-sm text-slate-400">/100</span>
            </div>
            <div className="flex gap-3 text-sm">
              <span className="text-slate-500">{a.totalIssues} issues</span>
              <span className="text-red-600 font-medium">{a.critical}C</span>
              <span className="text-amber-600 font-medium">{a.high}H</span>
              <span className="text-blue-600 font-medium">{a.medium}M</span>
            </div>
          </div>
        ))}
      </div>

      {/* Diff Summary */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 mb-6 shadow-sm">
        <h2 className="font-bold text-slate-800 mb-4">Changes Summary</h2>
        <div className="flex items-center gap-8 mb-6">
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-500">Score</span>
            <span className={`text-2xl font-extrabold ${scoreDiff >= 0 ? "text-emerald-600" : "text-red-600"}`}>
              {scoreDiff >= 0 ? "+" : ""}{scoreDiff}
            </span>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4">
          {[
            { value: newIssues, label: "New Issues", color: "text-red-600", bg: "bg-red-50", icon: "M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" },
            { value: resolvedIssues, label: "Resolved", color: "text-emerald-600", bg: "bg-emerald-50", icon: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" },
            { value: commonIssues, label: "Still Present", color: "text-slate-600", bg: "bg-slate-50", icon: "M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" },
          ].map(({ value, label, color, bg, icon }) => (
            <div key={label} className={`${bg} rounded-xl p-4 text-center`}>
              <svg className="w-6 h-6 mx-auto mb-2" style={{ color }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d={icon} />
              </svg>
              <div className={`text-3xl font-extrabold ${color} mb-1`}>{value}</div>
              <div className="text-xs text-slate-500 font-medium">{label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Module Comparison Table */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
        <div className="p-5 border-b border-slate-100">
          <h2 className="font-bold text-slate-800">Module Breakdown</h2>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="text-left p-4 font-semibold text-slate-600 text-xs uppercase tracking-wider">Module</th>
              <th className="text-right p-4 font-semibold text-slate-600 text-xs uppercase tracking-wider">Audit 1</th>
              <th className="text-right p-4 font-semibold text-slate-600 text-xs uppercase tracking-wider">Audit 2</th>
              <th className="text-right p-4 font-semibold text-slate-600 text-xs uppercase tracking-wider w-24">Trend</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {moduleComparison.map((mod: any) => {
              const sDiff = mod.score2 - mod.score1;
              return (
                <tr key={mod.moduleName} className="hover:bg-slate-50 transition-colors">
                  <td className="p-4 font-medium text-slate-800">{mod.moduleName}</td>
                  <td className="p-4 text-right">
                    <span className="font-medium">{mod.score1}</span>
                    <span className="text-xs text-slate-400 ml-1">({mod.issues1})</span>
                  </td>
                  <td className="p-4 text-right">
                    <span className="font-medium">{mod.score2}</span>
                    <span className="text-xs text-slate-400 ml-1">({mod.issues2})</span>
                  </td>
                  <td className="p-4 text-right">
                    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold ${
                      sDiff > 0 ? "bg-emerald-50 text-emerald-700" : sDiff < 0 ? "bg-red-50 text-red-700" : "bg-slate-50 text-slate-400"
                    }`}>
                      {sDiff > 0 ? "+" : ""}{sDiff}
                    </span>
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

import { moduleDefs } from "../lib/modules";
import { isProTier } from "../lib/tier";

interface LandingProps {
  onStartFree: () => void;
}

export default function Landing({ onStartFree }: LandingProps) {
  const isPro = isProTier();

  return (
    <div className="max-w-4xl mx-auto">
      {/* Simple header */}
      <div className="flex items-center gap-3 py-6 mb-6">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-sm">
          <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
        </div>
        <div>
          <span className="font-bold text-lg tracking-tight text-slate-800">WebDiag</span>
          <span className="text-xs ml-2 font-medium text-slate-400">Website Diagnostics</span>
        </div>
      </div>

      {/* Hero */}
      <div className="text-center mb-12 pt-8">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-indigo-50 rounded-full text-xs font-semibold text-indigo-700 mb-6">
          <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
          Autonomous Website Integrity Scanner
        </div>
        <h1 className="text-5xl font-extrabold mb-4 tracking-tight text-slate-900">
          Scan. <span className="gradient-text">Analyze.</span>
        </h1>
        <div className="text-lg max-w-2xl mx-auto leading-relaxed text-slate-500">
          Comprehensive AI-powered Auditing for Integrity, SEO, Accessibility, and Compliance.
          Get your website scanned before Deployment.
        </div>
      </div>

      {/* CTA Buttons */}
      <div className="flex items-center justify-center gap-4 mb-12">
        <button onClick={onStartFree}
          className="px-8 py-3.5 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-xl font-semibold shadow-md shadow-indigo-200 hover:shadow-lg hover:from-indigo-700 hover:to-purple-700 transition-all active:scale-[0.98]">
          Start Free
        </button>
        <button onClick={onStartFree}
          className="px-8 py-3.5 bg-white text-slate-700 rounded-xl font-semibold border border-slate-300 hover:border-indigo-400 hover:text-indigo-600 shadow-sm hover:shadow transition-all active:scale-[0.98]">
          Sign up / Log in
        </button>
      </div>

      {/* Feature highlight bar */}
      <div className="flex items-center justify-center gap-6 mb-12 text-sm text-slate-500">
        <span className="flex items-center gap-1.5">
          <svg className="w-4 h-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          3 free scans / month
        </span>
        <span className="flex items-center gap-1.5">
          <svg className="w-4 h-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          No credit card
        </span>
        <span className="flex items-center gap-1.5">
          <svg className="w-4 h-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          16 audit modules
        </span>
      </div>

      {/* Module Cards */}
      <div>
        <h2 className="text-lg font-bold mb-4 flex items-center gap-2 text-slate-800">
          <svg className="w-5 h-5 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" /></svg>
          16 Audit Modules
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {moduleDefs.map((mod) => (
            <div key={mod.id} className="rounded-xl border border-slate-200 p-4 transition-all group bg-white card-hover">
              <div className="flex items-start justify-between mb-3">
                <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${mod.color} flex items-center justify-center shadow-sm`}>
                  <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d={mod.icon} />
                  </svg>
                </div>
              </div>
              <div className="font-semibold text-sm text-slate-800">{mod.name}</div>
              <div className="text-xs mt-0.5 leading-relaxed text-slate-400">{mod.desc}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

interface PricingProps {
  onBack: () => void;
  isPro: boolean;
}

const tiers = [
  {
    name: "Free",
    price: "$0",
    scans: "3 per month",
    modules: 4,
    export: "None",
    features: ["4 basic audit modules", "3 scans per month", "Local folder upload", "Email support"],
    highlighted: false,
    cta: "Start Free",
    color: "emerald",
  },
  {
    name: "Starter",
    price: "$9.99",
    scans: "20 per month",
    modules: 8,
    export: "JSON, TXT",
    features: ["8 audit modules", "20 scans per month", "Local folder upload", "JSON & TXT export", "Email support"],
    highlighted: false,
    cta: "Choose Starter",
    color: "indigo",
  },
  {
    name: "Plus",
    price: "$19.99",
    scans: "50 per month",
    modules: 12,
    export: "JSON, DOC, TXT",
    features: ["12 audit modules", "50 scans per month", "Local folder upload", "JSON, DOC & TXT export", "Priority support"],
    highlighted: true,
    cta: "Choose Plus",
    color: "purple",
  },
  {
    name: "Pro",
    price: "$49.99",
    scans: "Unlimited",
    modules: 16,
    export: "JSON, PDF, DOC, TXT",
    features: ["All 16 audit modules", "Unlimited scans", "Local folder upload", "JSON, PDF, DOC & TXT export", "Premium support"],
    highlighted: false,
    cta: "Choose Pro",
    color: "amber",
  },
];

export default function Pricing({ onBack, isPro }: PricingProps) {
  return (
    <div className="max-w-6xl mx-auto">
      <button onClick={onBack} className={`flex items-center gap-1.5 mb-6 text-sm font-medium transition-colors ${isPro ? "text-indigo-300 hover:text-white" : "text-slate-500 hover:text-slate-800"}`}>
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        Back
      </button>

      <div className="text-center mb-10">
        <h1 className={`text-4xl font-extrabold tracking-tight ${isPro ? "text-white" : "text-slate-900"}`}>
          Simple, transparent pricing
        </h1>
        <p className={`mt-3 text-lg ${isPro ? "text-indigo-300" : "text-slate-500"}`}>
          Choose the plan that fits your needs
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {tiers.map((tier) => (
          <div
            key={tier.name}
            className={`relative rounded-2xl border p-6 transition-all flex flex-col ${
              tier.highlighted
                ? isPro
                  ? "border-indigo-400 bg-slate-900 shadow-xl shadow-indigo-500/10 scale-105"
                  : "border-indigo-400 bg-white shadow-xl shadow-indigo-500/10 scale-105"
                : isPro
                  ? "border-indigo-900/40 bg-slate-900/80"
                  : "border-slate-200 bg-white"
            }`}
          >
            {tier.highlighted && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 bg-gradient-to-r from-indigo-500 to-purple-600 text-white text-xs font-bold uppercase tracking-wider rounded-full">
                Popular
              </div>
            )}
            <div className="mb-6">
              <h3 className={`text-lg font-bold ${isPro ? "text-white" : "text-slate-800"}`}>{tier.name}</h3>
              <div className="mt-3 flex items-baseline gap-1">
                <span className={`text-3xl font-extrabold ${isPro ? "text-white" : "text-slate-900"}`}>{tier.price}</span>
                <span className={`text-sm ${isPro ? "text-indigo-400" : "text-slate-400"}`}>/month</span>
              </div>
            </div>
            <div className={`space-y-2 mb-6 ${isPro ? "text-indigo-300" : "text-slate-600"}`}>
              <div className="flex items-center justify-between text-sm">
                <span>Scans</span>
                <span className={`font-semibold ${isPro ? "text-white" : "text-slate-800"}`}>{tier.scans}</span>
              </div>
              <div className={`h-px ${isPro ? "bg-indigo-900/40" : "bg-slate-100"}`} />
              <div className="flex items-center justify-between text-sm">
                <span>Modules</span>
                <span className={`font-semibold ${isPro ? "text-white" : "text-slate-800"}`}>{tier.modules}</span>
              </div>
              <div className={`h-px ${isPro ? "bg-indigo-900/40" : "bg-slate-100"}`} />
              <div className="flex items-center justify-between text-sm">
                <span>Export</span>
                <span className={`font-semibold ${isPro ? "text-white" : "text-slate-800"}`}>{tier.export}</span>
              </div>
            </div>
            <ul className={`space-y-2 mb-8 flex-1 ${isPro ? "text-indigo-300" : "text-slate-500"}`}>
              {tier.features.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm">
                  <svg className="w-4 h-4 mt-0.5 shrink-0 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  {f}
                </li>
              ))}
            </ul>
            <button
              className={`w-full py-2.5 rounded-xl font-semibold text-sm transition-all active:scale-[0.98] ${
                tier.name === "Free"
                  ? "bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-md hover:shadow-lg hover:from-indigo-700 hover:to-purple-700"
                  : isPro
                    ? "border border-indigo-400/50 text-indigo-200 hover:bg-indigo-500/10 hover:border-indigo-400"
                    : "border border-slate-300 text-slate-700 hover:border-indigo-400 hover:text-indigo-600"
              }`}
            >
              {tier.cta}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

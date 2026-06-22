import { useState, useEffect } from "react";
import Home from "./pages/Home";
import Dashboard from "./pages/Dashboard";
import History from "./pages/History";
import Compare from "./pages/Compare";
import Landing from "./pages/Landing";
import Pricing from "./pages/Pricing";
import { isProTier } from "./lib/tier";

type Page = { name: "landing" } | { name: "home" } | { name: "dashboard"; auditId: string } | { name: "history" } | { name: "compare"; id1: string; id2: string } | { name: "pricing" };

export default function App() {
  const [isPro] = useState(isProTier());
  const [page, setPage] = useState<Page>(isPro ? { name: "home" } : { name: "landing" });
  const [prevPage, setPrevPage] = useState<Page>(isPro ? { name: "home" } : { name: "landing" });
  const [showScrollTop, setShowScrollTop] = useState(false);

  const navigateToHistory = () => {
    setPrevPage(page);
    setPage({ name: "history" });
  };

  useEffect(() => {
    const onScroll = () => setShowScrollTop(window.scrollY > 400);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (isPro || page.name === "landing") return;
    const onContextMenu = (e: MouseEvent) => { e.preventDefault(); };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "F12" || (e.ctrlKey && e.shiftKey && ["I", "J", "C"].includes(e.key)) || (e.ctrlKey && e.key === "U")) {
        e.preventDefault();
      }
    };
    document.addEventListener("contextmenu", onContextMenu);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("contextmenu", onContextMenu);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isPro, page.name]);

  return (
    <div className={`min-h-screen ${isPro ? "bg-slate-950" : "bg-slate-100"}`}>
      <header className={`sticky top-0 z-50 transition-all ${isPro ? "pro-header" : "bg-white border-b border-slate-200"}`}>
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <button onClick={() => setPage({ name: page.name === "home" ? "landing" : "home" })} className="flex items-center gap-3 hover:opacity-80 transition-all group">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center shadow-sm group-hover:shadow-md transition-shadow ${isPro ? "bg-gradient-to-br from-indigo-400 to-purple-500" : "bg-gradient-to-br from-indigo-500 to-purple-600"}`}>
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            <div>
                <span className={`font-bold text-lg tracking-tight ${isPro ? "text-white" : "text-slate-800"}`}>WebDiag</span>
                <span className={`text-xs ml-2 font-medium ${isPro ? "text-indigo-300" : "text-slate-400"}`}>Website Diagnostics</span>
                {page.name !== "landing" && <span className={`ml-2 px-1.5 py-0.5 text-white text-[9px] font-bold uppercase tracking-wider rounded align-middle ${isPro ? "pro-badge" : "bg-emerald-500"}`}>{isPro ? "Pro" : "Free Tier"}</span>}
              </div>
          </button>
          <button onClick={() => { setPrevPage(page); setPage({ name: "pricing" }); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
              isPro ? "text-indigo-300 hover:text-white hover:bg-white/5" : "text-slate-600 hover:text-slate-800 hover:bg-slate-50"
            }`}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            Pricing
          </button>
          {page.name !== "landing" && <nav className="flex items-center gap-1">
              <button disabled={!isPro}
                onClick={() => setPage({ name: "home" })}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${!isPro ? "text-slate-300 cursor-not-allowed" : isPro ? (page.name === "home" ? "bg-indigo-500/20 text-indigo-300 shadow-sm" : "text-indigo-200 hover:text-white hover:bg-white/5") : page.name === "home" ? "bg-indigo-50 text-indigo-700 shadow-sm" : "text-slate-600 hover:text-slate-800 hover:bg-slate-50"}`}>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
                New Audit {!isPro && <span className="px-1 py-0.5 bg-indigo-600 text-white text-[8px] font-bold uppercase rounded">Pro</span>}
              </button>
              <button disabled={!isPro}
                onClick={navigateToHistory}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${!isPro ? "text-slate-300 cursor-not-allowed" : isPro ? (page.name === "history" || page.name === "compare" ? "bg-indigo-500/20 text-indigo-300 shadow-sm" : "text-indigo-200 hover:text-white hover:bg-white/5") : page.name === "history" || page.name === "compare" ? "bg-indigo-50 text-indigo-700 shadow-sm" : "text-slate-600 hover:text-slate-800 hover:bg-slate-50"}`}>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                </svg>
                History {!isPro && <span className="px-1 py-0.5 bg-indigo-600 text-white text-[8px] font-bold uppercase rounded">Pro</span>}
              </button>
          </nav>}
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="animate-fadeIn">
          {page.name === "landing" && <Landing onStartFree={() => setPage({ name: "home" })} onPricing={() => { setPrevPage(page); setPage({ name: "pricing" }); }} />}
          {page.name === "home" && <Home isPro={isPro} onAuditStarted={(id) => setPage({ name: "dashboard", auditId: id })} />}
          {page.name === "dashboard" && <Dashboard auditId={page.auditId} onBack={() => setPage({ name: "home" })} />}
          {page.name === "history" && <History onSelectAudit={(id) => setPage({ name: "dashboard", auditId: id })} onCompare={(id1, id2) => setPage({ name: "compare", id1, id2 })} onBack={() => setPage(prevPage)} />}
          {page.name === "compare" && <Compare id1={page.id1} id2={page.id2} onBack={() => setPage({ name: "history" })} />}
          {page.name === "pricing" && <Pricing isPro={isPro} onBack={() => setPage(prevPage)} />}
        </div>
      </main>

      {showScrollTop && (
        <button aria-label="Scroll to top" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className={`fixed bottom-6 right-6 z-50 w-12 h-12 rounded-2xl text-white shadow-lg hover:shadow-xl hover:scale-105 active:scale-95 transition-all flex items-center justify-center ${isPro ? "bg-gradient-to-br from-indigo-500 to-purple-600 pro-glow" : "bg-gradient-to-br from-indigo-500 to-purple-600"}`}>
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
          </svg>
        </button>
      )}

      <footer className={`border-t ${isPro ? "border-indigo-900/40 bg-slate-900" : "border-slate-200 bg-white"}`}>
        <div className={`max-w-7xl mx-auto px-6 py-4 text-center text-xs ${isPro ? "text-indigo-300" : "text-slate-400"}`}>
          &copy; 2026 WebDiag{isPro && <span className="ml-2 text-indigo-400 font-semibold">Pro</span>}
        </div>
      </footer>
    </div>
  );
}

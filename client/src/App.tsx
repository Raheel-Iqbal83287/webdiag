import { useState, useEffect } from "react";
import Home from "./pages/Home";
import Dashboard from "./pages/Dashboard";
import History from "./pages/History";
import Compare from "./pages/Compare";

type Page = { name: "home" } | { name: "dashboard"; auditId: string } | { name: "history" } | { name: "compare"; id1: string; id2: string };

export default function App() {
  const [page, setPage] = useState<Page>({ name: "home" });
  const [showScrollTop, setShowScrollTop] = useState(false);

  useEffect(() => {
    const onScroll = () => setShowScrollTop(window.scrollY > 400);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <button onClick={() => setPage({ name: "home" })} className="flex items-center gap-3 hover:opacity-80 transition-all group">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-sm group-hover:shadow-md transition-shadow">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            <div>
              <span className="font-bold text-slate-800 text-lg tracking-tight">WebDiag</span>
              <span className="text-xs text-slate-400 ml-2 font-medium">Website Diagnostics</span>
            </div>
          </button>
          <nav className="flex items-center gap-1">
            <button onClick={() => setPage({ name: "home" })}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${page.name === "home" ? "bg-indigo-50 text-indigo-700 shadow-sm" : "text-slate-600 hover:text-slate-800 hover:bg-slate-50"}`}>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
              New Audit
            </button>
            <button disabled
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-slate-300 cursor-not-allowed">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
              </svg>
              History
            </button>
          </nav>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="animate-fadeIn">
          {page.name === "home" && <Home onAuditStarted={(id) => setPage({ name: "dashboard", auditId: id })} />}
          {page.name === "dashboard" && <Dashboard auditId={page.auditId} onBack={() => setPage({ name: "home" })} />}
          {page.name === "history" && <History onSelectAudit={(id) => setPage({ name: "dashboard", auditId: id })} onCompare={(id1, id2) => setPage({ name: "compare", id1, id2 })} />}
          {page.name === "compare" && <Compare id1={page.id1} id2={page.id2} onBack={() => setPage({ name: "history" })} />}
        </div>
      </main>

      {showScrollTop && (
        <button aria-label="Scroll to top" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="fixed bottom-6 right-6 z-50 w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-lg hover:shadow-xl hover:scale-105 active:scale-95 transition-all flex items-center justify-center">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
          </svg>
        </button>
      )}

      <footer className="border-t border-slate-200 bg-white">
        <div className="max-w-7xl mx-auto px-6 py-4 text-center text-xs text-slate-400">
          &copy; 2026 WebDiag
        </div>
      </footer>
    </div>
  );
}

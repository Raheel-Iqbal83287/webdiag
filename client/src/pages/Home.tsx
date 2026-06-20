import { useState, useRef, type FormEvent } from "react";
import { trpc } from "../lib/trpc";
import { moduleDefs } from "../lib/modules";

interface HomeProps {
  onAuditStarted: (id: string) => void;
}

export default function Home({ onAuditStarted }: HomeProps) {
  const [sourceType, setSourceType] = useState<"folder" | "url" | "github" | "zip">("url");
  const [sourcePath, setSourcePath] = useState("");
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const createAudit = trpc.audit.create.useMutation({ onSuccess: (data) => onAuditStarted(data.id), onError: (err) => setError(err.message) });

  const tabs: { key: typeof sourceType; label: string; icon: string; placeholder: string }[] = [
    { key: "url", label: "Live URL", icon: "M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1", placeholder: "https://example.com" },
    { key: "folder", label: "Local Folder", icon: "M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z", placeholder: "/path/to/website" },
    { key: "github", label: "GitHub Repo", icon: "M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4", placeholder: "https://github.com/user/repo" },
    { key: "zip", label: "ZIP Upload", icon: "M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12", placeholder: "Upload a ZIP file" },
  ];

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (sourceType === "zip") {
      if (!zipFile) { setError("Please select a ZIP file"); return; }
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(",")[1];
        createAudit.mutate({ name: name || undefined, sourceType: "zip", sourcePath: zipFile.name, fileBase64: base64 });
      };
      reader.onerror = () => setError("Failed to read file");
      reader.readAsDataURL(zipFile);
    } else {
      if (!sourcePath.trim()) { setError("Please provide a source path"); return; }
      createAudit.mutate({ name: name || undefined, sourceType, sourcePath: sourcePath.trim() });
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      {/* Hero */}
      <div className="text-center mb-12">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-indigo-50 rounded-full text-xs font-semibold text-indigo-700 mb-6">
          <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
          Autonomous Website Integrity Scanner
        </div>
        <h1 className="text-5xl font-extrabold text-slate-900 mb-4 tracking-tight">
          Scan. Analyze. <span className="relative"><span className="gradient-text">Fix.</span><span className="absolute -top-4 left-1/2 -translate-x-1/2 px-1.5 py-0.5 bg-indigo-600 text-white text-[9px] font-bold uppercase tracking-wider rounded whitespace-nowrap z-10">Pro Feature</span></span>
        </h1>
        <div className="text-lg text-slate-500 max-w-2xl mx-auto leading-relaxed">
          Comprehensive AI-powered auditing for integrity, SEO, accessibility, and compliance.
        </div>
      </div>

      {/* Input Form */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 mb-8">
        <form onSubmit={handleSubmit}>
          <div className="flex gap-1 bg-slate-100 rounded-xl p-1 mb-6">
            {tabs.map(({ key, label, icon }) => (
              <button type="button" key={key} onClick={() => { setSourceType(key); setSourcePath(""); setError(""); }}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-sm font-semibold transition-all ${
                  sourceType === key ? "bg-white text-indigo-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d={icon} /></svg>
                {label}
              </button>
            ))}
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">
              {sourceType === "url" ? "Website URL" : sourceType === "github" ? "Repository URL" : sourceType === "zip" ? "ZIP File" : "Folder Path"}
            </label>
            {sourceType === "zip" ? (
              <div>
                <input type="file" ref={fileInputRef} accept=".zip" onChange={e => setZipFile(e.target.files?.[0] || null)}
                  className="w-full px-4 py-3 border border-slate-300 rounded-xl text-sm file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-indigo-50 file:text-indigo-700 file:font-semibold hover:file:bg-indigo-100" />
                {zipFile && <p className="mt-1.5 text-xs text-slate-500">Selected: {zipFile.name} ({(zipFile.size / 1024).toFixed(1)} KB)</p>}
              </div>
            ) : (
              <input type="text" value={sourcePath} onChange={e => setSourcePath(e.target.value)}
                placeholder={tabs.find(t => t.key === sourceType)?.placeholder}
                className="w-full px-4 py-3 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-shadow" />
            )}
          </div>

          <div className="mt-5">
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Audit Name <span className="text-slate-400 font-normal">(optional)</span></label>
            <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="My Site Audit" className="w-full px-4 py-3 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-shadow" />
          </div>

          {error && (
            <div className="mt-5 p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 flex items-start gap-3">
              <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={createAudit.isPending || (sourceType === "zip" ? !zipFile : !sourcePath.trim())}
            className="mt-6 w-full py-3.5 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-xl font-semibold hover:from-indigo-700 hover:to-purple-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-md shadow-indigo-200 hover:shadow-lg active:scale-[0.98]"
          >
            {createAudit.isPending ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                Starting Audit...
              </span>
            ) : (
              <span className="flex items-center justify-center gap-2">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
                Start Audit
              </span>
            )}
          </button>
        </form>
      </div>

      {/* Module Cards */}
      <div>
        <h2 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
          <svg className="w-5 h-5 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" /></svg>
          16 Audit Modules
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {moduleDefs.map(({ name, desc, icon, color }) => (
            <div key={name} className="group bg-white rounded-xl border border-slate-200 p-4 card-hover">
              <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${color} flex items-center justify-center mb-3 shadow-sm`}>
                <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d={icon} />
                </svg>
              </div>
              <div className="font-semibold text-slate-800 text-sm group-hover:text-indigo-600 transition-colors">{name}</div>
              <div className="text-xs text-slate-400 mt-0.5 leading-relaxed">{desc}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

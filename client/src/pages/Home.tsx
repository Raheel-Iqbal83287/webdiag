import { useState, useRef, type FormEvent } from "react";
import { trpc } from "../lib/trpc";
import { moduleDefs } from "../lib/modules";

interface HomeProps {
  onAuditStarted: (id: string) => void;
}

export default function Home({ onAuditStarted }: HomeProps) {
  const [folderName, setFolderName] = useState("");
  const [fileCount, setFileCount] = useState(0);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const handleFolderSelect = () => {
    const files = folderInputRef.current?.files;
    if (files && files.length > 0) {
      setFolderName(files[0].webkitRelativePath.split("/")[0]);
      setFileCount(files.length);
      setError("");
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const files = folderInputRef.current?.files;
    if (!files || files.length === 0) { setError("Please select a folder"); return; }

    setUploading(true);
    setError("");

    try {
      const formData = new FormData();
      for (let i = 0; i < files.length; i++) {
        formData.append("files", files[i], files[i].webkitRelativePath);
      }
      if (name.trim()) formData.append("name", name.trim());

      const res = await fetch("/api/upload-folder", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      onAuditStarted(data.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
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
          16 modules for comprehensive website auditing. Upload your site folder to get started.
        </div>
      </div>

      {/* Upload Form */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 mb-8">
        <form onSubmit={handleSubmit}>
          <div className="border-2 border-dashed border-slate-300 rounded-xl p-8 text-center hover:border-indigo-400 transition-colors cursor-pointer" onClick={() => folderInputRef.current?.click()}>
            <input type="file" ref={folderInputRef} webkitdirectory="" multiple className="hidden" onChange={handleFolderSelect} />
            <svg className="w-12 h-12 mx-auto text-slate-400 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
            {folderName ? (
              <div>
                <p className="text-indigo-700 font-semibold">{folderName}</p>
                <p className="text-sm text-slate-500 mt-1">{fileCount} files selected</p>
              </div>
            ) : (
              <div>
                <p className="text-slate-700 font-semibold">Click to select a website folder</p>
                <p className="text-sm text-slate-400 mt-1">Select your project folder to upload and audit</p>
              </div>
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
            disabled={uploading || !folderName}
            className="mt-6 w-full py-3.5 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-xl font-semibold hover:from-indigo-700 hover:to-purple-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-md shadow-indigo-200 hover:shadow-lg active:scale-[0.98]"
          >
            {uploading ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                Uploading & Starting Audit...
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

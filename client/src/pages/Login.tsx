import { useState, type FormEvent } from "react";
import { useAuth } from "../lib/auth";

interface LoginProps {
  onSuccess: () => void;
  onBack: () => void;
  isPro: boolean;
}

export default function Login({ onSuccess, onBack, isPro }: LoginProps) {
  const { login } = useAuth();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const endpoint = mode === "login" ? "auth.login" : "auth.signup";
      const body: Record<string, unknown> = { email, password };
      if (mode === "signup") body.name = name;
      const res = await fetch("/trpc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          0: { procedure: endpoint, input: body, type: "mutation" },
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message || "Request failed");
      const result = data[0]?.result?.data || data.result?.data;
      if (!result) throw new Error("Invalid response");
      login(result.token, result.user);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-md mx-auto">
      <button onClick={onBack} className={`flex items-center gap-1.5 mb-6 text-sm font-medium transition-colors ${isPro ? "text-indigo-300 hover:text-white" : "text-slate-500 hover:text-slate-800"}`}>
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        Back
      </button>

      <div className={`rounded-2xl p-8 ${isPro ? "pro-card bg-slate-900/50 backdrop-blur-sm border border-indigo-900/40" : "bg-white shadow-sm border border-slate-200"}`}>
        <div className="text-center mb-6">
          <h2 className={`text-2xl font-bold ${isPro ? "text-white" : "text-slate-800"}`}>
            {mode === "login" ? "Welcome back" : "Create your account"}
          </h2>
          <p className={`text-sm mt-1 ${isPro ? "text-indigo-300" : "text-slate-500"}`}>
            {mode === "login" ? "Sign in to access your audits" : "Start auditing your websites"}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === "signup" && (
            <div>
              <label className={`block text-sm font-semibold mb-1.5 ${isPro ? "text-indigo-200" : "text-slate-700"}`}>Name</label>
              <input type="text" value={name} onChange={e => setName(e.target.value)} required
                className={`w-full px-4 py-3 border rounded-xl text-sm focus:ring-2 outline-none transition-shadow ${isPro ? "bg-slate-800/50 border-indigo-800/40 text-indigo-100 placeholder-indigo-300/30 focus:ring-indigo-500 focus:border-indigo-500" : "bg-white border-slate-300 focus:ring-indigo-500 focus:border-indigo-500"}`}
                placeholder="Your name" />
            </div>
          )}

          <div>
            <label className={`block text-sm font-semibold mb-1.5 ${isPro ? "text-indigo-200" : "text-slate-700"}`}>Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
              className={`w-full px-4 py-3 border rounded-xl text-sm focus:ring-2 outline-none transition-shadow ${isPro ? "bg-slate-800/50 border-indigo-800/40 text-indigo-100 placeholder-indigo-300/30 focus:ring-indigo-500 focus:border-indigo-500" : "bg-white border-slate-300 focus:ring-indigo-500 focus:border-indigo-500"}`}
              placeholder="you@example.com" />
          </div>

          <div>
            <label className={`block text-sm font-semibold mb-1.5 ${isPro ? "text-indigo-200" : "text-slate-700"}`}>Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={6}
              className={`w-full px-4 py-3 border rounded-xl text-sm focus:ring-2 outline-none transition-shadow ${isPro ? "bg-slate-800/50 border-indigo-800/40 text-indigo-100 placeholder-indigo-300/30 focus:ring-indigo-500 focus:border-indigo-500" : "bg-white border-slate-300 focus:ring-indigo-500 focus:border-indigo-500"}`}
              placeholder={mode === "signup" ? "At least 6 characters" : "Your password"} />
          </div>

          {error && (
            <div className={`p-4 border rounded-xl text-sm flex items-start gap-3 ${isPro ? "bg-red-900/20 border-red-800/30 text-red-300" : "bg-red-50 border-red-200 text-red-700"}`}>
              <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              <span>{error}</span>
            </div>
          )}

          <button type="submit" disabled={submitting}
            className={`w-full py-3.5 text-white rounded-xl font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-all active:scale-[0.98] ${isPro ? "bg-gradient-to-r from-indigo-600 to-purple-600 shadow-lg shadow-indigo-500/20 hover:shadow-xl" : "bg-gradient-to-r from-indigo-600 to-purple-600 shadow-md shadow-indigo-200 hover:shadow-lg hover:from-indigo-700 hover:to-purple-700"}`}>
            {submitting ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                {mode === "login" ? "Signing in..." : "Creating account..."}
              </span>
            ) : (
              mode === "login" ? "Sign In" : "Create Account"
            )}
          </button>
        </form>

        <div className="mt-6 text-center">
          <button onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(""); }}
            className={`text-sm font-medium transition-colors ${isPro ? "text-indigo-400 hover:text-indigo-300" : "text-indigo-600 hover:text-indigo-800"}`}>
            {mode === "login" ? "Don't have an account? Sign up" : "Already have an account? Sign in"}
          </button>
        </div>
      </div>
    </div>
  );
}

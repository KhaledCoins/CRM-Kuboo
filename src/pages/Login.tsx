import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useAuth } from "../context/AuthContext";

export function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível entrar.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen grid place-items-center px-4"
      style={{ background: "linear-gradient(135deg, #0A1628 0%, #0D4F8A 60%, #1873BA 100%)" }}
    >
      <div className="w-full max-w-[400px]">
        <div className="text-center mb-6">
          <span className="w-14 h-14 rounded-2xl bg-white grid place-items-center mx-auto mb-3 shadow-lg">
            <img src="/kuboo-symbol.png" alt="Kuboo" className="h-8 w-auto" draggable={false} />
          </span>
          <h1 className="text-3xl text-white tracking-wide">KUBOO CRM</h1>
          <p className="text-white/60 text-sm mt-1">Sistema de Gestão — Equipe</p>
        </div>

        <form onSubmit={submit} className="bg-white rounded-2xl p-7 shadow-2xl">
          <label className="block text-xs font-bold text-slate-600 mb-1.5">E-mail</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="voce@kuboo.com.br"
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-3 text-sm outline-none mb-4"
            required
          />

          <label className="block text-xs font-bold text-slate-600 mb-1.5">Senha</label>
          <div className="relative mb-4">
            <input
              type={show ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-3 pr-11 text-sm outline-none"
              required
            />
            <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
              {show ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2.5 mb-4 text-sm text-red-600">{error}</div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-gradient-to-br from-brand-500 to-brand-600 text-white font-bold rounded-xl py-3 text-sm shadow-[0_6px_20px_rgba(24,115,186,0.35)] disabled:opacity-60"
          >
            {loading ? "Entrando..." : "Entrar na Área da Equipe"}
          </button>

          <p className="text-center text-xs text-slate-400 mt-4">
            🔒 Acesso restrito a consultores e gestores Kuboo
          </p>
        </form>
      </div>
    </div>
  );
}

import { useState } from "react";
import { Eye, EyeOff, ShieldCheck, Check } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";

// Tela mostrada quando a pessoa chega por um link de CONVITE ou de
// "definir senha" (evento PASSWORD_RECOVERY do Supabase). Sem ela, quem clica
// no convite entraria logado sem nunca ter senha — e ficaria trancado depois.
export function DefinirSenha() {
  const { user, concluirDefinicaoDeSenha, logout } = useAuth();
  const [senha, setSenha] = useState("");
  const [confirma, setConfirma] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState("");

  const regras = [
    { ok: senha.length >= 8, txt: "Pelo menos 8 caracteres" },
    { ok: /[a-zA-Z]/.test(senha), txt: "Uma letra" },
    { ok: /\d/.test(senha), txt: "Um número" },
    { ok: senha.length > 0 && senha === confirma, txt: "As duas senhas são iguais" },
  ];
  const podeSalvar = regras.every((r) => r.ok) && !loading;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!podeSalvar || !supabase) return;
    setErro("");
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: senha });
      if (error) throw new Error(error.message);
      await concluirDefinicaoDeSenha();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível salvar a senha.");
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen grid place-items-center px-4"
      style={{ background: "linear-gradient(135deg, #0A1628 0%, #0D4F8A 60%, #1873BA 100%)" }}
    >
      <div className="w-full max-w-[420px]">
        <div className="text-center mb-6">
          <span className="w-16 h-16 rounded-2xl bg-white grid place-items-center mx-auto mb-3 shadow-lg">
            <img src="/kuboo-symbol-3d.png" alt="Kuboo" className="h-11 w-auto" draggable={false} />
          </span>
          <h1 className="text-3xl text-white tracking-wide">KUBOO CRM</h1>
          <p className="text-white/60 text-sm mt-1">Bem-vindo(a) à equipe</p>
        </div>

        <form onSubmit={submit} className="bg-white rounded-2xl p-7 shadow-2xl">
          <h2 className="text-lg font-extrabold text-ink mb-1">Crie a sua senha</h2>
          <p className="text-sm text-muted mb-5">
            {user?.email ? <>Acesso de <strong className="text-ink">{user.email}</strong>. </> : null}
            Escolha uma senha só sua — ninguém da equipe consegue vê-la.
          </p>

          <label htmlFor="nova-senha" className="block text-xs font-bold text-slate-600 mb-1.5">Nova senha</label>
          <div className="relative mb-4">
            <input
              id="nova-senha"
              type={show ? "text" : "password"}
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              placeholder="••••••••"
              autoComplete="new-password"
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-3 pr-11 text-sm outline-none"
              required
            />
            <button
              type="button"
              onClick={() => setShow((s) => !s)}
              aria-label={show ? "Ocultar senha" : "Mostrar senha"}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500"
            >
              {show ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>

          <label htmlFor="confirma-senha" className="block text-xs font-bold text-slate-600 mb-1.5">Repita a senha</label>
          <input
            id="confirma-senha"
            type={show ? "text" : "password"}
            value={confirma}
            onChange={(e) => setConfirma(e.target.value)}
            placeholder="••••••••"
            autoComplete="new-password"
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-3 text-sm outline-none mb-4"
            required
          />

          <ul className="mb-4 space-y-1.5">
            {regras.map((r) => (
              <li key={r.txt} className={`flex items-center gap-2 text-xs ${r.ok ? "text-emerald-600" : "text-slate-400"}`}>
                <span className={`w-4 h-4 rounded-full grid place-items-center shrink-0 ${r.ok ? "bg-emerald-100" : "bg-slate-100"}`}>
                  <Check size={11} />
                </span>
                {r.txt}
              </li>
            ))}
          </ul>

          {erro && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2.5 mb-4 text-sm text-red-600">{erro}</div>
          )}

          <button
            type="submit"
            disabled={!podeSalvar}
            className="w-full bg-gradient-to-br from-brand-500 to-brand-600 text-white font-bold rounded-xl py-3 text-sm shadow-[0_6px_20px_rgba(24,115,186,0.35)] disabled:opacity-60"
          >
            {loading ? "Salvando..." : "Salvar e entrar no CRM"}
          </button>

          <div className="flex items-center justify-between mt-4">
            <p className="text-xs text-slate-400 flex items-center gap-1.5">
              <ShieldCheck size={12} /> Sua senha é pessoal
            </p>
            <button type="button" onClick={logout} className="text-xs text-slate-400 hover:text-brand-600">
              Sair
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

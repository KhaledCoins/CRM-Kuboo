import { useEffect, useState, type FormEvent } from "react";
import { UserCircle, KeyRound, PenLine, Mail, Phone, Info, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { PageHeader, Card, Button, Spinner } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabase";
import { renderTemplate, VARIAVEIS_TEMPLATE } from "../lib/c2s";

// Meu perfil: dados básicos (read-only — RLS bloqueia edição direta), troca
// de senha (auth.updateUser) e assinatura de mensagens (profiles.assinatura).
const inputCls = "w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none text-ink focus:border-brand-400 transition-colors";
const labelCls = "text-xs font-bold text-muted uppercase tracking-wide block mb-1.5";

interface PerfilRow { phone: string | null; assinatura: string | null }

export function Perfil() {
  const { user } = useAuth();
  const [perfil, setPerfil] = useState<PerfilRow | null>(null);
  const [loading, setLoading] = useState(true);

  const [novaSenha, setNovaSenha] = useState("");
  const [confirmarSenha, setConfirmarSenha] = useState("");
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [salvandoSenha, setSalvandoSenha] = useState(false);

  const [assinatura, setAssinatura] = useState("");
  const [salvandoAssinatura, setSalvandoAssinatura] = useState(false);
  const [assinaturaBloqueada, setAssinaturaBloqueada] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!supabase || !user) { setLoading(false); return; }
      try {
        const { data, error } = await supabase.from("profiles").select("phone, assinatura").eq("id", user.id).maybeSingle();
        if (!active) return;
        if (!error && data) {
          setPerfil(data as PerfilRow);
          setAssinatura((data as PerfilRow).assinatura || "");
        }
      } catch (e) {
        console.error("[perfil] carregar:", e);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [user?.id]);

  async function trocarSenha(e: FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    if (novaSenha.length < 8) { toast.error("A nova senha precisa ter pelo menos 8 caracteres."); return; }
    if (novaSenha !== confirmarSenha) { toast.error("As senhas não coincidem."); return; }
    setSalvandoSenha(true);
    const { error } = await supabase.auth.updateUser({ password: novaSenha });
    setSalvandoSenha(false);
    if (error) {
      if (/same|different/i.test(error.message)) toast.error("A nova senha precisa ser diferente da senha atual.");
      else toast.error("Não foi possível trocar a senha: " + error.message);
      return;
    }
    toast.success("Senha atualizada com sucesso!");
    setNovaSenha(""); setConfirmarSenha("");
  }

  async function salvarAssinatura(e: FormEvent) {
    e.preventDefault();
    if (!supabase || !user) return;
    setSalvandoAssinatura(true);
    const { error } = await supabase.from("profiles").update({ assinatura }).eq("id", user.id);
    setSalvandoAssinatura(false);
    if (error) {
      // RLS ainda bloqueia update direto em profiles — não quebra a tela, só avisa.
      setAssinaturaBloqueada(true);
      return;
    }
    setAssinaturaBloqueada(false);
    toast.success("Assinatura atualizada!");
  }

  const preview = renderTemplate(assinatura || "", { nomeVendedor: user?.name, telefoneVendedor: perfil?.phone });

  return (
    <>
      <PageHeader title="Meu Perfil" subtitle="Seus dados, senha e assinatura de mensagens" icon={UserCircle} />

      {loading ? (
        <Spinner label="Carregando perfil..." />
      ) : (
        <div className="grid gap-5 max-w-2xl">
          {/* ─── Dados ─────────────────────────────────────────────────── */}
          <Card>
            <h2 className="font-extrabold text-ink text-base mb-4 flex items-center gap-2"><UserCircle size={17} className="text-brand-500" /> Meus dados</h2>
            <div className="grid gap-3">
              <div>
                <span className={labelCls}>Nome</span>
                <p className="text-sm font-semibold text-ink">{user?.name || "—"}</p>
              </div>
              <div>
                <span className={labelCls}>E-mail</span>
                <p className="text-sm text-ink flex items-center gap-1.5"><Mail size={13} className="text-slate-400" /> {user?.email || "—"}</p>
              </div>
              <div>
                <span className={labelCls}>Telefone</span>
                <p className="text-sm text-ink flex items-center gap-1.5"><Phone size={13} className="text-slate-400" /> {perfil?.phone || "—"}</p>
              </div>
              <p className="text-xs text-muted flex items-start gap-1.5 mt-1 bg-slate-50 rounded-lg px-3 py-2">
                <Info size={13} className="shrink-0 mt-0.5" />
                Nome e telefone só podem ser alterados por um gestor, na tela de Usuários.
              </p>
            </div>
          </Card>

          {/* ─── Trocar senha ──────────────────────────────────────────── */}
          <Card>
            <h2 className="font-extrabold text-ink text-base mb-4 flex items-center gap-2"><KeyRound size={17} className="text-brand-500" /> Trocar senha</h2>
            <form onSubmit={trocarSenha} className="grid gap-3">
              <div className="grid sm:grid-cols-2 gap-3">
                <label className="block">
                  <span className={labelCls}>Nova senha</span>
                  <div className="relative">
                    <input type={mostrarSenha ? "text" : "password"} className={`${inputCls} pr-9`} value={novaSenha}
                      onChange={(e) => setNovaSenha(e.target.value)} placeholder="Mínimo 8 caracteres" autoComplete="new-password" minLength={8} required />
                    <button type="button" onClick={() => setMostrarSenha((v) => !v)} aria-label={mostrarSenha ? "Ocultar senha" : "Mostrar senha"}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                      {mostrarSenha ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </label>
                <label className="block">
                  <span className={labelCls}>Confirmar nova senha</span>
                  <input type={mostrarSenha ? "text" : "password"} className={inputCls} value={confirmarSenha}
                    onChange={(e) => setConfirmarSenha(e.target.value)} placeholder="Repita a senha" autoComplete="new-password" minLength={8} required />
                </label>
              </div>
              <div>
                <Button type="submit" icon={KeyRound} disabled={salvandoSenha || !novaSenha || !confirmarSenha}>
                  {salvandoSenha ? "Salvando…" : "Atualizar senha"}
                </Button>
              </div>
            </form>
          </Card>

          {/* ─── Assinatura de mensagens ───────────────────────────────── */}
          <Card>
            <h2 className="font-extrabold text-ink text-base mb-4 flex items-center gap-2"><PenLine size={17} className="text-brand-500" /> Assinatura de mensagens</h2>
            {assinaturaBloqueada && (
              <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2 mb-3 flex items-start gap-1.5">
                <Info size={13} className="shrink-0 mt-0.5" />
                A edição da assinatura será liberada quando a coluna/grant estiver disponível — peça ao gestor.
              </p>
            )}
            <form onSubmit={salvarAssinatura} className="grid gap-3">
              <label className="block">
                <span className={labelCls}>Sua assinatura</span>
                <textarea className={inputCls} rows={4} value={assinatura} onChange={(e) => setAssinatura(e.target.value)}
                  placeholder={"Ex.: Att, [NOME_VENDEDOR]\nKuboo Seguros e Consórcios\n[TELEFONE_VENDEDOR]"} />
              </label>
              <p className="text-xs text-muted">
                Variáveis disponíveis: {VARIAVEIS_TEMPLATE.map((v) => <code key={v} className="bg-slate-100 rounded px-1 mx-0.5">{v}</code>)}
              </p>
              {assinatura.trim() && (
                <div>
                  <span className={labelCls}>Pré-visualização</span>
                  <p className="text-sm text-ink bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 whitespace-pre-wrap">{preview}</p>
                </div>
              )}
              <div>
                <Button type="submit" icon={PenLine} disabled={salvandoAssinatura}>
                  {salvandoAssinatura ? "Salvando…" : "Salvar assinatura"}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </>
  );
}

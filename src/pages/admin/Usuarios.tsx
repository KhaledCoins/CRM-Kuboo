import { useEffect, useState } from "react";
import {
  UserCog, UserPlus, Mail, Phone, X, Check, Copy, KeyRound, Pencil,
  Power, AlertTriangle, ShieldAlert, Info,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader, Button, Card, Table, Th, Td, Tr, Badge, EmptyState, Spinner, Select } from "../../components/ui";
import { ModalShell } from "../../components/ModalShell";
import { supabase } from "../../lib/supabase";
import { useAuth, type Role } from "../../context/AuthContext";
import { dateBR, initials } from "../../lib/format";

// Tela "Usuários" — paridade com o C2S (docs/C2S-SCAN.md §Usuários): criar
// usuário de equipe, editar papel/assinatura/permissões granulares e
// desativar com transferência de leads (ativos e arquivados separadamente).
// Edição/desativação passam pelo endpoint server-side api/atualizar-equipe.js
// (o client não tem mais UPDATE em profiles — fix de escalada de privilégio).

interface TeamRow {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  role?: string | null;
  nivel?: string | null;
  aprovado?: boolean;
  created_at?: string;
  permissoes?: Record<string, boolean> | null;
  assinatura?: string | null;
}

const roleTone = (r?: string | null) => (r === "admin" ? "violet" : r === "gestor" ? "blue" : "slate") as any;
const roleLabel = (r?: string | null) => (r === "admin" ? "Administrador" : r === "gestor" ? "Gestor" : "Vendedor");

const inputCls = "w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none text-ink focus:border-brand-400 transition-colors";
const labelCls = "text-xs font-bold text-muted uppercase tracking-wide block mb-1.5";

const PERMISSOES: { chave: string; rotulo: string }[] = [
  { chave: "editar_usuarios", rotulo: "Pode editar usuários" },
  { chave: "editar_filas", rotulo: "Pode editar filas de distribuição" },
  { chave: "editar_bolsao", rotulo: "Pode editar bolsão" },
  { chave: "editar_etiquetas", rotulo: "Pode editar etiquetas" },
  { chave: "acessar_config", rotulo: "Pode acessar configurações" },
  { chave: "acessar_financeiro", rotulo: "Pode acessar financeiro" },
  { chave: "extrair_relatorios", rotulo: "Pode extrair relatórios" },
  { chave: "visivel_relatorios", rotulo: "Visível nos relatórios" },
];

async function tokenSessao(): Promise<string> {
  if (!supabase) throw new Error("Supabase não configurado.");
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Sessão expirada — faça login novamente.");
  return token;
}

function AvisoMigracao() {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 flex items-start gap-2">
      <AlertTriangle size={16} className="mt-0.5 shrink-0" />
      <span>Rode a migration <code className="font-mono">supabase/c2s-parity.sql</code> no Supabase para liberar assinatura e permissões granulares.</span>
    </div>
  );
}

function PermToggle({ label, value, onChange, disabled }: { label: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-3 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 ${disabled ? "opacity-50" : ""}`}>
      <span className="text-sm font-bold text-ink">{label}</span>
      <div className="inline-flex rounded-lg overflow-hidden border border-slate-200 shrink-0">
        <button type="button" disabled={disabled} onClick={() => onChange(true)}
          className={`px-3 py-1 text-xs font-bold transition-colors ${value ? "bg-brand-500 text-white" : "bg-white text-muted"}`}>SIM</button>
        <button type="button" disabled={disabled} onClick={() => onChange(false)}
          className={`px-3 py-1 text-xs font-bold transition-colors ${!value ? "bg-red-500 text-white" : "bg-white text-muted"}`}>NÃO</button>
      </div>
    </div>
  );
}

export function Usuarios() {
  const { user, isManager } = useAuth();
  const [rows, setRows] = useState<TeamRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [colunasFaltando, setColunasFaltando] = useState(false);
  const [novoAberto, setNovoAberto] = useState(false);
  const [editando, setEditando] = useState<TeamRow | null>(null);
  const [desativando, setDesativando] = useState<TeamRow | null>(null);

  async function carregar() {
    if (!supabase) { setLoading(false); return; }
    setLoading(true);
    try {
      const completo = await supabase
        .from("profiles")
        .select("id, name, email, phone, role, nivel, aprovado, created_at, permissoes, assinatura")
        .in("role", ["admin", "gestor", "vendedor"])
        .order("name");

      if (completo.error) {
        // Migration c2s-parity.sql ainda não rodou — cai pro select sem as colunas novas.
        const basico = await supabase
          .from("profiles")
          .select("id, name, email, phone, role, nivel, aprovado, created_at")
          .in("role", ["admin", "gestor", "vendedor"])
          .order("name");
        setColunasFaltando(true);
        setRows((basico.data as any) ?? []);
      } else {
        setColunasFaltando(false);
        setRows((completo.data as any) ?? []);
      }
    } catch (e) {
      console.error("[usuarios]", e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { carregar(); }, []);

  async function reativar(u: TeamRow) {
    try {
      const token = await tokenSessao();
      const r = await fetch("/api/atualizar-equipe", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ userId: u.id, acao: "reativar" }),
      });
      const json = await r.json().catch(() => null);
      if (!r.ok) throw new Error(json?.error || "Não foi possível reativar o usuário.");
      toast.success(`${u.name} reativado(a).`);
      carregar();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível reativar o usuário.");
    }
  }

  return (
    <>
      <PageHeader
        title="Usuários"
        subtitle="Equipe de consultores e gestores"
        icon={UserCog}
        actions={<Button icon={UserPlus} onClick={() => setNovoAberto(true)}>Novo Usuário</Button>}
      />

      {colunasFaltando && <div className="mb-5"><AvisoMigracao /></div>}

      <Card pad={false}>
        {loading ? (
          <Spinner label="Carregando equipe..." />
        ) : rows.length === 0 ? (
          <EmptyState icon={UserCog} title="Nenhum usuário de equipe cadastrado" hint="Cadastre consultores e gestores com o botão Novo Usuário." />
        ) : (
          <div className="p-2">
            <Table head={<><Th>Usuário</Th><Th>Contato</Th><Th>Cargo</Th><Th>Status</Th><Th>Cadastro</Th><Th right>Ações</Th></>}>
              {rows.map((u) => (
                <Tr key={u.id} className={u.aprovado === false ? "opacity-60" : ""}>
                  <Td>
                    <div className="flex items-center gap-2.5">
                      <span className="w-8 h-8 rounded-full bg-brand-500 text-white grid place-items-center text-xs font-bold shrink-0">{initials(u.name)}</span>
                      <span className="font-bold text-ink">{u.name}</span>
                    </div>
                  </Td>
                  <Td>
                    <div className="text-xs text-muted space-y-0.5">
                      {u.email && <span className="flex items-center gap-1"><Mail size={11} /> {u.email}</span>}
                      {u.phone && <span className="flex items-center gap-1"><Phone size={11} /> {u.phone}</span>}
                    </div>
                  </Td>
                  <Td>
                    <Badge tone={roleTone(u.role)}>{roleLabel(u.role)}{u.nivel ? ` · ${u.nivel}` : ""}</Badge>
                  </Td>
                  <Td>{u.aprovado === false ? <Badge tone="red">Desativado</Badge> : <Badge tone="green">Ativo</Badge>}</Td>
                  <Td>{dateBR(u.created_at)}</Td>
                  <Td right>
                    <div className="flex items-center justify-end gap-1.5">
                      {u.aprovado === false ? (
                        <button onClick={() => reativar(u)} title="Reativar" aria-label={`Reativar ${u.name}`}
                          className="p-2 rounded-lg text-slate-400 hover:text-green-600 hover:bg-green-50"><Power size={16} /></button>
                      ) : (
                        <button onClick={() => setEditando(u)} title="Editar" aria-label={`Editar ${u.name}`}
                          className="p-2 rounded-lg text-slate-400 hover:text-brand-600 hover:bg-brand-50"><Pencil size={16} /></button>
                      )}
                    </div>
                  </Td>
                </Tr>
              ))}
            </Table>
          </div>
        )}
      </Card>

      {!isManager && (
        <Card className="mt-5">
          <div className="flex items-start gap-2.5">
            <span className="w-8 h-8 rounded-lg bg-brand-50 text-brand-500 grid place-items-center shrink-0"><Info size={16} /></span>
            <p className="text-xs text-muted">Fale com um gestor ou administrador para gerenciar a equipe.</p>
          </div>
        </Card>
      )}

      {novoAberto && (
        <NovoUsuarioModal onFechar={() => setNovoAberto(false)} onCriado={carregar} />
      )}

      {editando && (
        <EditarUsuarioModal
          usuario={editando}
          colunasFaltando={colunasFaltando}
          callerRole={user?.role ?? "vendedor"}
          onClose={() => setEditando(null)}
          onSaved={() => { setEditando(null); carregar(); }}
          onAbrirDesativar={() => { setDesativando(editando); setEditando(null); }}
          podeDesativar={editando.id !== user?.id}
        />
      )}

      {desativando && (
        <DesativarModal
          usuario={desativando}
          equipe={rows.filter((r) => r.id !== desativando.id && r.aprovado !== false)}
          onClose={() => setDesativando(null)}
          onDone={() => { setDesativando(null); carregar(); }}
        />
      )}
    </>
  );
}

/* ─────────────────────────── Novo Usuário ─────────────────────────── */

interface ResultadoCriacao { id: string; loginEmail: string; tempPassword: string; role: string }

function NovoUsuarioModal({ onFechar, onCriado }: { onFechar: () => void; onCriado: () => void }) {
  const [form, setForm] = useState({ name: "", email: "", phone: "", role: "vendedor" });
  const [salvando, setSalvando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoCriacao | null>(null);

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((p) => ({ ...p, [k]: e.target.value }));

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setSalvando(true);
    try {
      const token = await tokenSessao();
      const r = await fetch("/api/criar-equipe", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(form),
      });
      const json = await r.json().catch(() => null);
      if (!r.ok) throw new Error(json?.error || "Não foi possível criar o usuário.");
      setResultado(json);
      onCriado();
      toast.success("Usuário criado com sucesso!");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível criar o usuário.");
    } finally {
      setSalvando(false);
    }
  }

  function copiar(texto: string) {
    navigator.clipboard.writeText(texto);
    toast.success("Copiado.");
  }

  return (
    <ModalShell onClose={onFechar} label="Novo Usuário" className="bg-white rounded-2xl shadow-2xl w-[min(520px,94vw)] max-h-[90vh] overflow-y-auto">
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 sticky top-0 bg-white z-10">
        <div className="flex items-center gap-2.5">
          <span className="w-9 h-9 rounded-xl bg-brand-50 text-brand-500 grid place-items-center shrink-0"><UserPlus size={18} /></span>
          <h3 className="font-extrabold text-ink text-lg">Novo Usuário</h3>
        </div>
        <button onClick={onFechar} aria-label="Fechar" className="text-slate-500 hover:text-slate-700"><X size={20} /></button>
      </div>

      {resultado ? (
        <div className="p-6">
          <div className="text-center py-4">
            <span className="w-14 h-14 rounded-2xl bg-green-50 text-green-600 grid place-items-center mx-auto mb-4"><Check size={26} /></span>
            <p className="font-extrabold text-ink text-lg">Usuário cadastrado</p>
            <p className="text-sm text-muted mt-1">Repasse o acesso abaixo por WhatsApp ou e-mail. No 1º login é recomendável trocar a senha.</p>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3 mt-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm min-w-0">
                <Mail size={15} className="text-brand-500 shrink-0" />
                <span className="font-mono truncate">{resultado.loginEmail}</span>
              </div>
              <button type="button" onClick={() => copiar(resultado.loginEmail)} title="Copiar e-mail" aria-label="Copiar e-mail" className="text-slate-400 hover:text-brand-600 shrink-0"><Copy size={14} /></button>
            </div>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm min-w-0">
                <KeyRound size={15} className="text-brand-500 shrink-0" />
                <span className="font-mono truncate">{resultado.tempPassword}</span>
              </div>
              <button type="button" onClick={() => copiar(resultado.tempPassword)} title="Copiar senha" aria-label="Copiar senha" className="text-slate-400 hover:text-brand-600 shrink-0"><Copy size={14} /></button>
            </div>
          </div>
          <p className="text-xs text-amber-700 bg-amber-50 rounded-xl px-3 py-2 mt-3">
            Esta senha só aparece agora — anote antes de fechar.
          </p>

          <div className="flex justify-end gap-3 mt-6">
            <Button onClick={onFechar}>Fechar</Button>
          </div>
        </div>
      ) : (
        <form onSubmit={salvar} className="p-6 grid grid-cols-1 gap-4">
          <label className="block">
            <span className={labelCls}>Nome completo *</span>
            <input className={inputCls} required value={form.name} onChange={set("name")} placeholder="Nome do usuário" />
          </label>
          <label className="block">
            <span className={labelCls}>E-mail *</span>
            <input className={inputCls} type="email" required value={form.email} onChange={set("email")} placeholder="nome@kubooseguros.com.br" />
          </label>
          <label className="block">
            <span className={labelCls}>Telefone/WhatsApp</span>
            <input className={inputCls} value={form.phone} onChange={set("phone")} placeholder="(12) 90000-0000" />
          </label>
          <label className="block">
            <span className={labelCls}>Papel *</span>
            <select className={inputCls} value={form.role} onChange={(e) => setForm((p) => ({ ...p, role: e.target.value }))}>
              <option value="vendedor">Vendedor</option>
              <option value="gestor">Gestor</option>
              <option value="admin">Administrador</option>
            </select>
          </label>

          <p className="text-xs text-muted bg-slate-50 rounded-xl px-3 py-2">
            O usuário recebe uma senha temporária. Só administradores podem criar outro administrador.
          </p>

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={onFechar}>Cancelar</Button>
            <Button type="submit" disabled={salvando}>{salvando ? "Criando…" : "Criar usuário"}</Button>
          </div>
        </form>
      )}
    </ModalShell>
  );
}

/* ─────────────────────────── Editar Usuário ─────────────────────────── */

function EditarUsuarioModal({ usuario, colunasFaltando, callerRole, podeDesativar, onClose, onSaved, onAbrirDesativar }: {
  usuario: TeamRow;
  colunasFaltando: boolean;
  callerRole: Role;
  podeDesativar: boolean;
  onClose: () => void;
  onSaved: () => void;
  onAbrirDesativar: () => void;
}) {
  const [name, setName] = useState(usuario.name ?? "");
  const [phone, setPhone] = useState(usuario.phone ?? "");
  const [role, setRole] = useState(usuario.role ?? "vendedor");
  const [assinatura, setAssinatura] = useState(usuario.assinatura ?? "");
  const [permissoes, setPermissoes] = useState<Record<string, boolean>>(() => {
    const base: Record<string, boolean> = {};
    for (const p of PERMISSOES) base[p.chave] = usuario.permissoes?.[p.chave] === true;
    return base;
  });
  const [salvando, setSalvando] = useState(false);

  const alvoEraAdmin = usuario.role === "admin";
  const travaPapel = alvoEraAdmin && callerRole !== "admin";
  const opcoesPapel = callerRole === "admin" ? ["vendedor", "gestor", "admin"] : ["vendedor", "gestor"];
  const permissoesRelevantes = role === "vendedor";

  function setPerm(chave: string, valor: boolean) {
    setPermissoes((p) => ({ ...p, [chave]: valor }));
  }

  async function salvar() {
    if (!name.trim()) { toast.error("Nome não pode ficar em branco."); return; }
    setSalvando(true);
    try {
      const token = await tokenSessao();
      const payload: Record<string, unknown> = { name: name.trim(), phone: phone.trim() || null };
      if (!travaPapel) payload.role = role;
      if (!colunasFaltando) {
        payload.assinatura = assinatura;
        payload.permissoes = permissoes;
      }
      const r = await fetch("/api/atualizar-equipe", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ userId: usuario.id, acao: "atualizar", payload }),
      });
      const json = await r.json().catch(() => null);
      if (!r.ok) throw new Error(json?.error || "Não foi possível salvar as alterações.");
      toast.success("Usuário atualizado.");
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível salvar as alterações.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <ModalShell onClose={onClose} label={`Editar — ${usuario.name}`} className="bg-white rounded-2xl shadow-2xl w-[min(640px,94vw)] max-h-[92vh] overflow-y-auto">
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 sticky top-0 bg-white z-10">
        <div className="flex items-center gap-2.5">
          <span className="w-9 h-9 rounded-xl bg-brand-50 text-brand-500 grid place-items-center shrink-0"><Pencil size={18} /></span>
          <h3 className="font-extrabold text-ink text-lg">Editar usuário</h3>
        </div>
        <button onClick={onClose} aria-label="Fechar" className="text-slate-500 hover:text-slate-700"><X size={20} /></button>
      </div>

      <div className="p-6 space-y-6">
        {colunasFaltando && <AvisoMigracao />}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block sm:col-span-2">
            <span className={labelCls}>Nome completo *</span>
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="block">
            <span className={labelCls}>Telefone/WhatsApp</span>
            <input className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(12) 90000-0000" />
          </label>
          <label className="block">
            <span className={labelCls}>Papel</span>
            {travaPapel ? (
              <>
                <input className={`${inputCls} opacity-60`} value={roleLabel(usuario.role)} disabled />
                <p className="text-xs text-muted mt-1">Só um admin muda o papel de/para administrador.</p>
              </>
            ) : (
              <select className={inputCls} value={role} onChange={(e) => setRole(e.target.value)}>
                {opcoesPapel.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
              </select>
            )}
          </label>
        </div>

        <label className="block">
          <span className={labelCls}>Assinatura de mensagens</span>
          <textarea
            className={`${inputCls} min-h-[90px] resize-y`}
            value={assinatura}
            onChange={(e) => setAssinatura(e.target.value)}
            disabled={colunasFaltando}
            placeholder="Ex.: Atenciosamente, [NOME_VENDEDOR] — Kuboo Seguros — [TELEFONE_VENDEDOR]"
          />
          <p className="text-xs text-muted mt-1">Use as variáveis <code className="font-mono">[NOME_VENDEDOR]</code> e <code className="font-mono">[TELEFONE_VENDEDOR]</code> — são substituídas automaticamente nas mensagens.</p>
        </label>

        <div>
          <span className={labelCls}>Permissões</span>
          {!permissoesRelevantes && (
            <p className="text-xs text-muted bg-slate-50 rounded-xl px-3 py-2 mb-2">
              Gestor e administrador têm acesso total ao sistema — as permissões abaixo só refinam o que um <b>vendedor</b> pode fazer.
            </p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {PERMISSOES.map((p) => (
              <PermToggle
                key={p.chave}
                label={p.rotulo}
                value={permissoes[p.chave]}
                onChange={(v) => setPerm(p.chave, v)}
                disabled={colunasFaltando || !permissoesRelevantes}
              />
            ))}
          </div>
        </div>

        {podeDesativar && (
          <div className="pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onAbrirDesativar}
              className="inline-flex items-center gap-1.5 text-sm font-bold text-red-600 hover:text-red-700"
            >
              <ShieldAlert size={15} /> Desativar usuário
            </button>
          </div>
        )}
      </div>

      <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 sticky bottom-0 bg-white">
        <Button variant="outline" onClick={onClose}>Cancelar</Button>
        <Button onClick={salvar} disabled={salvando}>{salvando ? "Salvando..." : "Salvar alterações"}</Button>
      </div>
    </ModalShell>
  );
}

/* ─────────────────────────── Desativar Usuário ─────────────────────────── */

function DesativarModal({ usuario, equipe, onClose, onDone }: {
  usuario: TeamRow;
  equipe: TeamRow[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [ativosPara, setAtivosPara] = useState("redistribuir");
  const [arquivadosPara, setArquivadosPara] = useState("redistribuir");
  const [enviando, setEnviando] = useState(false);

  const opcoes = [
    { value: "redistribuir", label: "Redistribuir pelas regras" },
    ...equipe.map((u) => ({ value: u.id, label: u.name })),
  ];

  async function confirmar() {
    setEnviando(true);
    try {
      const token = await tokenSessao();
      const r = await fetch("/api/atualizar-equipe", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          userId: usuario.id,
          acao: "desativar",
          payload: { transferirAtivosPara: ativosPara, transferirArquivadosPara: arquivadosPara },
        }),
      });
      const json = await r.json().catch(() => null);
      if (!r.ok) throw new Error(json?.error || "Não foi possível desativar o usuário.");
      toast.success(`${usuario.name} desativado(a). ${json.ativosMovidos} lead(s) ativo(s) e ${json.arquivadosMovidos} arquivado(s) movidos.`);
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível desativar o usuário.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <ModalShell onClose={onClose} label={`Desativar ${usuario.name}`} className="bg-white rounded-2xl shadow-2xl w-[min(480px,94vw)] max-h-[90vh] overflow-y-auto">
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
        <div className="flex items-center gap-2.5">
          <span className="w-9 h-9 rounded-xl bg-red-50 text-red-600 grid place-items-center shrink-0"><ShieldAlert size={18} /></span>
          <h3 className="font-extrabold text-ink text-lg">Desativar {usuario.name}?</h3>
        </div>
        <button onClick={onClose} aria-label="Fechar" className="text-slate-500 hover:text-slate-700"><X size={20} /></button>
      </div>

      <div className="p-6 space-y-4">
        <p className="text-sm text-muted">
          O usuário perde o acesso ao CRM. Escolha para onde vão os leads que estão com ele(a) — ativos e arquivados são tratados separadamente, como no C2S.
        </p>

        <label className="block">
          <span className={labelCls}>Leads ativos vão para:</span>
          <Select value={ativosPara} onChange={setAtivosPara} options={opcoes} />
        </label>
        <label className="block">
          <span className={labelCls}>Leads arquivados vão para:</span>
          <Select value={arquivadosPara} onChange={setArquivadosPara} options={opcoes} />
        </label>

        <p className="text-xs text-amber-700 bg-amber-50 rounded-xl px-3 py-2">
          "Redistribuir pelas regras" libera os leads sem dono para o motor de filas/bolsão pegar de novo.
        </p>
      </div>

      <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100">
        <Button variant="outline" onClick={onClose}>Cancelar</Button>
        <Button variant="danger" onClick={confirmar} disabled={enviando}>{enviando ? "Desativando..." : "Desativar usuário"}</Button>
      </div>
    </ModalShell>
  );
}

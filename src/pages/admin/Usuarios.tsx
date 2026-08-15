import { useEffect, useMemo, useState } from "react";
import {
  UserCog, UserPlus, Mail, Phone, X, Check, Copy, KeyRound, Pencil,
  Power, AlertTriangle, ShieldAlert, Info, Download, CheckCircle2, XCircle, Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader, Button, Card, Table, Th, Td, Tr, Badge, EmptyState, Spinner, Select } from "../../components/ui";
import { ModalShell } from "../../components/ModalShell";
import { supabase } from "../../lib/supabase";
import { useAuth, type Role } from "../../context/AuthContext";
import { can, permissaoEfetiva } from "../../lib/permissoes";
import { dateBR, initials } from "../../lib/format";
import { exportarCsv } from "../../lib/csv";

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
// `nivel` é o CARGO de exibição: quem é vendedor pode se chamar "Consultor" na
// tela sem que isso mude uma permissão sequer. Ver OPCOES_CARGO mais abaixo.
// Papel + cargo num valor só ("vendedor|Consultor"), porque as três telas
// (criar, convidar e editar) precisam oferecer exatamente as mesmas opções.
// Consultor e Vendedor são o MESMO papel (role='vendedor'): mudam de nome, não
// de permissão. Criar um papel de verdade obrigaria a mexer em is_team() na
// RLS, no rodízio do Bolsão (filtra role='vendedor') e em toda checagem —
// risco alto para uma diferença de nomenclatura.
export const PAPEIS_COM_CARGO: { valor: string; rotulo: string; role: string; nivel: string | null }[] = [
  { valor: "vendedor|Consultor", rotulo: "Consultor", role: "vendedor", nivel: "Consultor" },
  { valor: "vendedor|",          rotulo: "Vendedor",  role: "vendedor", nivel: null },
  { valor: "gestor|",            rotulo: "Gestor",    role: "gestor",   nivel: null },
  { valor: "admin|",             rotulo: "Administrador", role: "admin", nivel: null },
];

const roleLabel = (r?: string | null, nivel?: string | null) =>
  r === "admin" ? "Administrador"
  : r === "gestor" ? "Gestor"
  : nivel === "Consultor" ? "Consultor"
  : "Vendedor";

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

/* ─────────────────────────── Convidar equipe — parser ─────────────────────────── */
// Aceita "Nome, email@dominio, papel" (papel opcional; ; ou tab também servem de
// separador) e linhas só com e-mail (nome vira a parte antes do @, capitalizada).

function normalizarTexto(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function papelDoTexto(s: string): Role | null {
  const n = normalizarTexto(s);
  if (!n) return null;
  if (n.startsWith("admin")) return "admin";
  if (n.startsWith("gestor") || n.startsWith("gerente")) return "gestor";
  if (n.startsWith("vend") || n.startsWith("consult")) return "vendedor";
  return null;
}

function capitalizar(s: string): string {
  return s
    .split(/[\s._-]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function parseLinhaConvite(rawLinha: string): { name: string; email: string; role: string } {
  const partes = rawLinha.split(/[,;\t]+/).map((p) => p.trim()).filter(Boolean);
  if (!partes.length) return { name: "", email: "", role: "vendedor|Consultor" };

  const idxEmail = partes.findIndex((p) => p.includes("@"));
  const email = idxEmail >= 0 ? partes[idxEmail] : "";
  const resto = partes.filter((_, i) => i !== idxEmail);

  let role = "vendedor|Consultor";
  const nomeParts: string[] = [];
  for (const p of resto) {
    const papel = papelDoTexto(p);
    if (papel) role = papel;
    else nomeParts.push(p);
  }

  const name = nomeParts.join(" ").trim() || (email ? capitalizar(email.split("@")[0].replace(/[.\-_]+/g, " ")) : "");
  return { name, email, role };
}

let uidSeq = 0;
function uid(): string {
  uidSeq += 1;
  return `convite-${Date.now()}-${uidSeq}`;
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
  const podeEditarUsuarios = can(user, "editar_usuarios");
  const podeExtrair = can(user, "extrair_relatorios");
  const [rows, setRows] = useState<TeamRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [colunasFaltando, setColunasFaltando] = useState(false);
  // user_ids com pelo menos uma fila ativa — alimenta o chip "Fora do rodízio".
  const [noRodizio, setNoRodizio] = useState<Set<string> | null>(null);
  const [novoAberto, setNovoAberto] = useState(false);
  const [convidarAberto, setConvidarAberto] = useState(false);
  const [editando, setEditando] = useState<TeamRow | null>(null);
  const [desativando, setDesativando] = useState<TeamRow | null>(null);
  const [reenviandoIds, setReenviandoIds] = useState<Set<string>>(new Set());

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

    // Quem está em alguma fila de distribuição. A auditoria mostrou que esse
    // estado era INVISÍVEL: vendedor fora de todas as filas nunca recebia lead
    // automático e ninguém via isso em tela nenhuma (só enterrado no modal de
    // Check-in). Alguns estão fora DE PROPÓSITO (decisão de gestão) — por isso
    // é um chip informativo, não um alerta vermelho. Falha nesta consulta não
    // pode derrubar a tela: sem dado, simplesmente não mostra chip.
    try {
      const { data: fu } = await supabase.from("fila_usuarios").select("user_id").eq("ativo", true);
      setNoRodizio(new Set(((fu as { user_id: string }[]) ?? []).map((r) => r.user_id)));
    } catch { /* chip é informativo — segue sem ele */ }
  }

  useEffect(() => { carregar(); }, []);

  function exportar() {
    if (!podeExtrair || !rows.length) return;
    const dados = rows.map((u) => ({
      nome: u.name,
      email: u.email || "",
      telefone: u.phone || "",
      papel: roleLabel(u.role, u.nivel),
      status: u.aprovado === false ? "Desativado" : "Ativo",
    }));
    exportarCsv(
      `usuarios-${new Date().toISOString().slice(0, 10)}`,
      [
        { chave: "nome", rotulo: "Nome" },
        { chave: "email", rotulo: "E-mail" },
        { chave: "telefone", rotulo: "Telefone" },
        { chave: "papel", rotulo: "Papel" },
        { chave: "status", rotulo: "Status" },
      ],
      dados
    );
  }

  async function reativar(u: TeamRow) {
    if (!podeEditarUsuarios) return;
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

  async function reenviarConvite(u: TeamRow) {
    if (!podeEditarUsuarios) return;
    if (!u.email) { toast.error("Usuário sem e-mail cadastrado."); return; }
    setReenviandoIds((s) => new Set(s).add(u.id));
    try {
      const token = await tokenSessao();
      const r = await fetch("/api/convidar-equipe", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        // Passa o cargo junto, senão reenviar convite rebaixaria um Consultor
        // pra "Vendedor" sem ninguém pedir.
        body: JSON.stringify({ pessoas: [{ name: u.name, email: u.email, role: u.role || "vendedor", nivel: u.nivel ?? null }] }),
      });
      const json = await r.json().catch(() => null);
      if (!r.ok) throw new Error(json?.error || "Não foi possível reenviar o convite.");
      const resultado = json?.resultados?.[0];
      if (resultado?.actionLink) {
        // O e-mail automático falhou, mas o convite é válido. Dizer "reenviado"
        // aqui seria mentira: ninguém receberia nada. Copia o link direto pra
        // área de transferência, que é o que a pessoa precisa fazer em seguida.
        try {
          await navigator.clipboard.writeText(resultado.actionLink);
          toast.warning(`O e-mail não saiu, mas copiei o link de acesso de ${u.name}. Cole no WhatsApp dele(a) — expira em 1 hora.`, { duration: 12000 });
        } catch {
          toast.warning(`O e-mail não saiu. Link de acesso de ${u.name}: ${resultado.actionLink}`, { duration: 30000 });
        }
      } else if (resultado?.ok) {
        toast.success(resultado.criado ? `Convite enviado para ${u.name}.` : `Convite reenviado para ${u.name}.`);
      } else {
        toast.error(resultado?.erro || "Não foi possível reenviar o convite.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível reenviar o convite.");
    } finally {
      setReenviandoIds((s) => { const n = new Set(s); n.delete(u.id); return n; });
    }
  }

  return (
    <>
      <PageHeader
        title="Usuários"
        subtitle="Equipe de consultores e gestores"
        icon={UserCog}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            {podeExtrair && <Button variant="outline" icon={Download} onClick={exportar} disabled={!rows.length}>Exportar CSV</Button>}
            {podeEditarUsuarios && <Button variant="outline" icon={Mail} onClick={() => setConvidarAberto(true)}>Convidar equipe</Button>}
            {podeEditarUsuarios && <Button icon={UserPlus} onClick={() => setNovoAberto(true)}>Novo Usuário</Button>}
          </div>
        }
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
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Badge tone={roleTone(u.role)}>{roleLabel(u.role, u.nivel)}</Badge>
                      {/* Só faz sentido pra vendedor ativo; alguns estão fora DE
                          PROPÓSITO (decisão de gestão), por isso tom neutro. */}
                      {noRodizio && u.role === "vendedor" && u.aprovado !== false && !noRodizio.has(u.id) && (
                        <span title="Não está em nenhuma fila de distribuição — não recebe lead automático. Para incluir, use Distribuição de Leads.">
                          <Badge tone="slate">Fora do rodízio</Badge>
                        </span>
                      )}
                    </div>
                  </Td>
                  <Td>{u.aprovado === false ? <Badge tone="red">Desativado</Badge> : <Badge tone="green">Ativo</Badge>}</Td>
                  <Td>{dateBR(u.created_at)}</Td>
                  <Td right>
                    <div className="flex items-center justify-end gap-1.5">
                      {podeEditarUsuarios && (
                        <button onClick={() => reenviarConvite(u)} disabled={reenviandoIds.has(u.id)} title="Reenviar convite" aria-label={`Reenviar convite para ${u.name}`}
                          className="p-2 rounded-lg text-slate-400 hover:text-brand-600 hover:bg-brand-50 disabled:opacity-50"><Mail size={16} /></button>
                      )}
                      {!podeEditarUsuarios ? (
                        <span className="text-xs text-muted">—</span>
                      ) : u.aprovado === false ? (
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

      {isManager && !podeEditarUsuarios && (
        <Card className="mt-5">
          <div className="flex items-start gap-2.5">
            <span className="w-8 h-8 rounded-lg bg-brand-50 text-brand-500 grid place-items-center shrink-0"><Info size={16} /></span>
            <p className="text-xs text-muted">Você não tem permissão para criar, editar ou desativar usuários — modo somente leitura.</p>
          </div>
        </Card>
      )}

      {novoAberto && podeEditarUsuarios && (
        <NovoUsuarioModal onFechar={() => setNovoAberto(false)} onCriado={carregar} />
      )}

      {convidarAberto && podeEditarUsuarios && (
        <ConvidarEquipeModal onFechar={() => setConvidarAberto(false)} onEnviado={carregar} />
      )}

      {editando && podeEditarUsuarios && (
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
  const [form, setForm] = useState<{ name: string; email: string; phone: string; role: string; nivel: string | null }>(
    { name: "", email: "", phone: "", role: "vendedor", nivel: "Consultor" }
  );
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
            <select
              className={inputCls}
              value={`${form.role}|${form.nivel ?? ""}`}
              onChange={(e) => {
                const [papel, cargo] = e.target.value.split("|");
                setForm((p) => ({ ...p, role: papel, nivel: cargo || null }));
              }}
            >
              {PAPEIS_COM_CARGO.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
            </select>
            {form.role === "vendedor" && (
              <p className="text-xs text-muted mt-1">Consultor e Vendedor têm as mesmas permissões — muda só o nome.</p>
            )}
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

/* ─────────────────────────── Convidar equipe ─────────────────────────── */

// O campo "role" aqui guarda o valor COMPOSTO do seletor ("vendedor|Consultor").
// Ele é separado em papel + cargo na hora de montar o payload do convite.
interface LinhaConvite { id: string; name: string; email: string; role: string }
// actionLink/aviso: quando o envio automático falha (Resend com o domínio
// pendente, por exemplo), o servidor devolve o LINK do convite em vez de um
// erro seco — ele é válido e quem convidou repassa por WhatsApp.
// Ver api/convidar-equipe.js.
interface ResultadoConvite {
  email: string; ok: boolean; criado?: boolean; role?: string; erro?: string;
  via?: string; actionLink?: string; aviso?: string;
}

// Mesmas opções das telas de criar e editar — o valor carrega papel e cargo.
const ROLE_OPCOES = PAPEIS_COM_CARGO.map((o) => ({ value: o.valor, label: o.rotulo }));

function ConvidarEquipeModal({ onFechar, onEnviado }: { onFechar: () => void; onEnviado: () => void }) {
  const [texto, setTexto] = useState("");
  const [linhas, setLinhas] = useState<LinhaConvite[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [resultados, setResultados] = useState<ResultadoConvite[] | null>(null);

  const contagemEmails = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of linhas) {
      const k = l.email.trim().toLowerCase();
      if (!k) continue;
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [linhas]);

  function motivoInvalido(l: LinhaConvite): string | null {
    if (!l.email.includes("@")) return "E-mail inválido";
    if ((contagemEmails.get(l.email.trim().toLowerCase()) ?? 0) > 1) return "E-mail duplicado na lista";
    if (!l.name.trim()) return "Nome obrigatório";
    return null;
  }

  const temInvalida = linhas.some((l) => motivoInvalido(l) !== null);
  const podeEnviar = linhas.length > 0 && linhas.length <= 40 && !temInvalida && !enviando;

  function adicionarAlista() {
    const brutas = texto.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!brutas.length) return;
    const novas = brutas.map((raw) => {
      const p = parseLinhaConvite(raw);
      return { id: uid(), name: p.name, email: p.email, role: p.role };
    });
    setLinhas((prev) => [...prev, ...novas]);
    setTexto("");
  }

  function removerLinha(id: string) {
    setLinhas((prev) => prev.filter((l) => l.id !== id));
  }

  function mudarPapel(id: string, role: string) {
    setLinhas((prev) => prev.map((l) => (l.id === id ? { ...l, role } : l)));
  }

  async function enviar() {
    if (!podeEnviar) return;
    setEnviando(true);
    try {
      const token = await tokenSessao();
      const r = await fetch("/api/convidar-equipe", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ pessoas: linhas.map((l) => { const [papel, cargo] = l.role.split("|"); return { name: l.name, email: l.email, role: papel, nivel: cargo || null }; }) }),
      });
      const json = await r.json().catch(() => null);
      if (!r.ok) throw new Error(json?.error || "Não foi possível enviar os convites.");
      const lista: ResultadoConvite[] = json?.resultados ?? [];
      const enviados: number = json?.enviados ?? 0;
      const total: number = json?.total ?? lista.length;
      setResultados(lista);
      if (enviados === total && total > 0) {
        toast.success(`${enviados} de ${total} convites enviados.`);
        onEnviado();
      } else if (enviados > 0) {
        toast.warning(`${enviados} de ${total} convites enviados.`);
      } else {
        toast.error(`0 de ${total} convites enviados.`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível enviar os convites.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <ModalShell onClose={onFechar} label="Convidar equipe" className="bg-white rounded-2xl shadow-2xl w-[min(720px,94vw)] max-h-[90vh] overflow-y-auto">
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 sticky top-0 bg-white z-10">
        <div className="flex items-center gap-2.5">
          <span className="w-9 h-9 rounded-xl bg-brand-50 text-brand-500 grid place-items-center shrink-0"><Mail size={18} /></span>
          <h3 className="font-extrabold text-ink text-lg">Convidar equipe</h3>
        </div>
        <button onClick={onFechar} aria-label="Fechar" className="text-slate-500 hover:text-slate-700"><X size={20} /></button>
      </div>

      {resultados ? (
        <div className="p-6">
          <p className="text-sm text-muted mb-4">Resultado do envio:</p>
          <div className="space-y-2">
            {resultados.map((r) => {
              const linha = linhas.find((l) => l.email.trim().toLowerCase() === r.email.trim().toLowerCase());
              return (
                <div key={r.email} className={`px-3 py-2.5 rounded-xl border ${r.actionLink ? "bg-amber-50 border-amber-200" : "bg-slate-50 border-slate-200"}`}>
                  <div className="flex items-center gap-3">
                    {r.ok
                      ? (r.actionLink ? <AlertTriangle size={18} className="text-amber-600 shrink-0" /> : <CheckCircle2 size={18} className="text-green-600 shrink-0" />)
                      : <XCircle size={18} className="text-red-600 shrink-0" />}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-ink truncate">{linha?.name || r.email}</p>
                      <p className="text-xs text-muted truncate">{r.email}</p>
                    </div>
                    <span className={`text-xs font-bold text-right shrink-0 max-w-[45%] ${!r.ok ? "text-red-700" : r.actionLink ? "text-amber-800" : "text-green-700"}`}>
                      {r.ok
                        ? (r.actionLink ? "Envie o link à mão" : r.criado ? "Convite enviado" : "Reenviado (já tinha login)")
                        : (r.erro || "Erro ao enviar")}
                    </span>
                  </div>

                  {/* O e-mail automático falhou, mas o convite existe e é válido.
                      Mostrar o link é o que evita perder o convite — a conta já
                      foi criada do lado do Supabase. */}
                  {r.actionLink && (
                    <div className="mt-2.5 pt-2.5 border-t border-amber-200">
                      <p className="text-xs text-amber-900 leading-relaxed mb-2">{r.aviso}</p>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 min-w-0 truncate text-[11px] bg-white border border-amber-200 rounded-lg px-2.5 py-2 text-slate-700">
                          {r.actionLink}
                        </code>
                        <Button
                          variant="outline"
                          icon={Copy}
                          onClick={() => {
                            navigator.clipboard.writeText(r.actionLink!)
                              .then(() => toast.success("Link copiado — cole no WhatsApp da pessoa."))
                              .catch(() => toast.error("Não consegui copiar. Selecione o link e copie manualmente."));
                          }}
                        >
                          Copiar
                        </Button>
                      </div>
                      <p className="text-[11px] text-amber-700 mt-2">
                        O link é pessoal e expira em 1 hora. Mande só para {r.email}.
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex justify-end gap-3 mt-6">
            <Button onClick={onFechar}>Fechar</Button>
          </div>
        </div>
      ) : (
        <div className="p-6 space-y-5">
          <label className="block">
            <span className={labelCls}>Colar equipe (uma pessoa por linha)</span>
            <textarea
              className={`${inputCls} min-h-[110px] resize-y font-mono text-xs`}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder={"Ex.:\nJoão Silva, joao@kubooseguros.com.br, vendedor\nmaria@kubooseguros.com.br"}
            />
            <p className="text-xs text-muted mt-1">
              Formato livre: <code className="font-mono">Nome, e-mail, papel</code> (papel opcional, vírgula/ponto-e-vírgula/tab servem de separador). Linhas só com e-mail também valem.
            </p>
          </label>

          <div className="flex justify-end">
            <Button type="button" variant="outline" onClick={adicionarAlista} disabled={!texto.trim()}>Adicionar à lista</Button>
          </div>

          {linhas.length > 0 && (
            <div>
              <span className={labelCls}>Prévia ({linhas.length})</span>
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <Table head={<><Th>Nome</Th><Th>E-mail</Th><Th>Papel</Th><Th right>—</Th></>}>
                  {linhas.map((l) => {
                    const erro = motivoInvalido(l);
                    return (
                      <Tr key={l.id} className={erro ? "bg-red-50/70" : ""}>
                        <Td>
                          <span className={`text-sm font-bold ${erro ? "text-red-700" : "text-ink"}`}>{l.name || "—"}</span>
                        </Td>
                        <Td>
                          <div className={`text-sm ${erro ? "text-red-700" : "text-ink"}`}>{l.email || "—"}</div>
                          {erro && <div className="text-xs text-red-600 mt-0.5">{erro}</div>}
                        </Td>
                        <Td>
                          <Select value={l.role} onChange={(v) => mudarPapel(l.id, v)} options={ROLE_OPCOES} />
                        </Td>
                        <Td right>
                          <button type="button" onClick={() => removerLinha(l.id)} title="Remover" aria-label={`Remover ${l.name || l.email}`}
                            className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50"><Trash2 size={16} /></button>
                        </Td>
                      </Tr>
                    );
                  })}
                </Table>
              </div>
              {linhas.length > 40 && (
                <p className="text-xs text-red-600 mt-1.5">Máximo de 40 pessoas por envio — remova algumas linhas.</p>
              )}
            </div>
          )}

          <p className="text-xs text-muted bg-slate-50 rounded-xl px-3 py-2">
            Ninguém vê a senha de ninguém: a pessoa recebe um e-mail e define a própria senha.
          </p>

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={onFechar}>Cancelar</Button>
            <Button onClick={enviar} disabled={!podeEnviar}>{enviando ? "Enviando…" : `Enviar convites (${linhas.length})`}</Button>
          </div>
        </div>
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
  // Cargo é só rótulo (profiles.nivel). Não confere permissão nenhuma.
  const [nivel, setNivel] = useState<string | null>(usuario.nivel ?? null);
  const [assinatura, setAssinatura] = useState(usuario.assinatura ?? "");
  const [permissoes, setPermissoes] = useState<Record<string, boolean>>(() => {
    const base: Record<string, boolean> = {};
    // permissaoEfetiva é a MESMA função que o resto do app usa pra decidir
    // acesso. Antes aqui era `usuario.permissoes?.[chave] === true`, que ignora
    // o padrão do papel: admin/gestor sem nada salvo aparecia com tudo "NÃO"
    // mesmo tendo tudo liberado de verdade.
    for (const p of PERMISSOES) base[p.chave] = permissaoEfetiva(usuario.role, usuario.permissoes, p.chave);
    return base;
  });
  const [salvando, setSalvando] = useState(false);

  const alvoEraAdmin = usuario.role === "admin";
  const travaPapel = alvoEraAdmin && callerRole !== "admin";
  // "Consultor" e "Vendedor" são o MESMO papel pro sistema (role='vendedor') —
  // mudam só de nome na tela, que é o que foi pedido. Criar um papel de verdade
  // no banco obrigaria a mexer em is_team()/is_manager() na RLS, no rodízio do
  // Bolsão (que filtra role='vendedor') e em toda checagem de papel; risco alto
  // para uma diferença de nomenclatura. O valor do <select> carrega os dois:
  // "vendedor|Consultor" => role vendedor + cargo Consultor.
  const OPCOES_CARGO = PAPEIS_COM_CARGO.filter((o) => o.role !== "admin" || callerRole === "admin");
  const cargoAtual = `${role}|${role === "vendedor" && nivel === "Consultor" ? "Consultor" : ""}`;
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
      if (!travaPapel) {
        payload.role = role;
        // Cargo só faz sentido em vendedor; gestor/admin não carregam rótulo.
        payload.nivel = role === "vendedor" ? nivel : null;
      }
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
              <>
                <select
                  className={inputCls}
                  value={cargoAtual}
                  onChange={(e) => {
                    const [novoPapel, novoCargo] = e.target.value.split("|");
                    setRole(novoPapel);
                    setNivel(novoCargo || null);
                  }}
                >
                  {OPCOES_CARGO.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
                </select>
                {role === "vendedor" && (
                  <p className="text-xs text-muted mt-1">Consultor e Vendedor têm exatamente as mesmas permissões — muda só o nome.</p>
                )}
              </>
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

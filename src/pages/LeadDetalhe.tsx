import { useEffect, useState, type FormEvent } from "react";
import { useParams, useLocation, Link } from "react-router-dom";
import { toast } from "sonner";
import {
  MessageCircle, Phone, Mail, Star, ArrowLeftRight, HelpCircle, ArrowLeft,
  CheckCircle2, AlertTriangle, Archive, Trophy, Undo2, Copy, Send, Plus,
  ChevronDown, ChevronUp, Tag, X, User as UserIcon, Inbox, FileText, Pencil, RotateCcw,
} from "lucide-react";
import { PageHeader, Card, Button, Badge, EmptyState, Spinner } from "../components/ui";
import { ModalShell } from "../components/ModalShell";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";
import type { TeamUser } from "../context/AuthContext";
import { onlyDigits } from "../lib/format";
import {
  type Lead, registrarContato, devolverBolsao, descartarLead, moverEtapa, limiteSlaMinutos,
} from "../lib/leads";
import {
  type Atividade, type Observacao, type Etiqueta, type MensagemPronta,
  type MotivoArquivamento, type DistribuicaoLog, TIPOS_ATIVIDADE,
  atividadesDoLead, atividadeAtual, atividadeAtrasada, concluirAtividade,
  observacoesDoLead, etiquetasDoLead, alternarEtiqueta, favoritosDoUsuario,
  alternarFavorito, logDoLead, renderTemplate, listar, inserir, atualizar,
  CORES_ETIQUETA,
} from "../lib/c2s";
import type { Modulo } from "../lib/nav";

// ─── Lead 360º — clona/supera a página de detalhe do C2S (docs/C2S-SCAN.md) ──
// campanha/fonte/canal/formulario/interagido_em vêm da migration c2s-parity.sql
// e ainda não fazem parte da interface Lead base (src/lib/leads.ts) — estendemos
// localmente em vez de mexer naquele arquivo (fora do escopo desta página).
interface LeadDetalhado extends Lead {
  campanha?: string | null;
  fonte?: string | null;
  canal?: string | null;
  formulario?: Record<string, unknown> | null;
  interagido_em?: string | null;
}

const dateTimeBR = (v?: string | null) => {
  if (!v) return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
};

function waLink(telefone?: string | null, texto?: string) {
  const digits = onlyDigits(telefone || "");
  if (!digits) return null;
  const comPais = digits.startsWith("55") ? digits : `55${digits}`;
  return `https://wa.me/${comPais}${texto ? `?text=${encodeURIComponent(texto)}` : ""}`;
}

const rotuloTipo = (t: string) => TIPOS_ATIVIDADE.find((x) => x.valor === t)?.rotulo ?? t;

// Chip de etapa do lead no header (paridade C2S: "Status: Em negociação")
const ETAPA_INFO: Record<string, { rotulo: string; tone: "slate" | "green" | "blue" | "amber" | "red" | "violet" }> = {
  novos: { rotulo: "Novo", tone: "slate" },
  contato: { rotulo: "Em atendimento", tone: "blue" },
  cotacao: { rotulo: "Cotação enviada", tone: "violet" },
  negociacao: { rotulo: "Em negociação", tone: "amber" },
  ganho: { rotulo: "Negócio fechado", tone: "green" },
  perdido: { rotulo: "Perdido", tone: "red" },
};

// "1.500,50" | "1500,50" | "1500.50" | "1.500" → número certo (nunca ×100).
// Ponto único a 1–2 casas do fim = decimal; caso contrário é separador de milhar.
function parseValorBR(s: string): number {
  let t = s.trim().replace(/[R$\s]/gi, "");
  if (!t) return NaN;
  const temVirgula = t.includes(",");
  const temPonto = t.includes(".");
  if (temVirgula && temPonto) t = t.replace(/\./g, "").replace(",", ".");
  else if (temVirgula) t = t.replace(",", ".");
  else if (temPonto) {
    const i = t.lastIndexOf(".");
    const casasDecimais = t.length - i - 1;
    const pontoUnico = t.indexOf(".") === i;
    if (!(pontoUnico && casasDecimais >= 1 && casasDecimais <= 2)) t = t.replace(/\./g, "");
  }
  return Number(t);
}

const inputCls = "w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none text-ink focus:border-brand-400";
const lblCls = "block text-xs font-bold text-slate-600 mb-1.5";

// ─── Modal: Transferir lead (só gestor/admin) ────────────────────────────────
function ModalTransferir({ lead, gestor, onClose, onDone }: {
  lead: LeadDetalhado; gestor: TeamUser | null; onClose: () => void; onDone: () => void;
}) {
  const [equipe, setEquipe] = useState<{ id: string; name: string }[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [alvo, setAlvo] = useState("");
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!supabase) { setCarregando(false); return; }
      // Só usuários aprovados — transferir p/ conta desativada mataria o lead em silêncio
      // (mesmo critério do motor de filas em c2s-parity.sql).
      const { data } = await supabase.from("profiles").select("id,name,aprovado")
        .in("role", ["admin", "gestor", "vendedor"]).order("name");
      if (alive) {
        setEquipe(((data as any[]) ?? []).filter((p) => p.aprovado !== false));
        setCarregando(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  async function salvar() {
    if (!alvo) { toast.error("Escolha um usuário."); return; }
    setSalvando(true);
    const now = new Date().toISOString();
    // SLA renovado pro novo dono: sem isso um lead com SLA estourado continuaria
    // satisfazendo noBolsao() e qualquer vendedor poderia "roubá-lo" do bolsão
    // segundos depois da decisão do gestor.
    const minutos = await limiteSlaMinutos();
    const sla = new Date(Date.now() + minutos * 60000).toISOString();
    const ok = await atualizar("leads", lead.id, { vendedor_id: alvo, atribuido_em: now, sla_expira_em: sla });
    if (ok) {
      // Auditoria: "Por que recebi este lead?" precisa refletir a transferência manual.
      await inserir("distribuicao_log", {
        lead_id: lead.id, user_id: alvo,
        motivo: `Transferido manualmente${gestor ? ` por ${gestor.name}` : ""}`,
      });
    }
    setSalvando(false);
    if (ok) { toast.success("Lead transferido."); onDone(); } else toast.error("Não foi possível transferir o lead.");
  }

  return (
    <ModalShell onClose={onClose} label="Transferir lead"
      backdropClassName="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold text-ink flex items-center gap-2"><ArrowLeftRight size={18} className="text-brand-500" /> Transferir lead</h3>
        <button onClick={onClose} aria-label="Fechar" className="text-slate-400 hover:text-slate-600 p-1"><X size={18} /></button>
      </div>
      {carregando ? <Spinner /> : (
        <>
          <label className={lblCls}>Novo responsável</label>
          <select className={inputCls} value={alvo} onChange={(e) => setAlvo(e.target.value)}>
            <option value="">Selecione…</option>
            {equipe.filter((p) => p.id !== lead.vendedor_id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <div className="flex gap-2 justify-end mt-4">
            <Button variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button onClick={salvar} disabled={salvando || !alvo}>{salvando ? "Transferindo…" : "Transferir"}</Button>
          </div>
        </>
      )}
    </ModalShell>
  );
}

// ─── Modal: "Por que recebi este lead?" (auditoria da distribuição) ─────────
function ModalPorQue({ leadId, onClose }: { leadId: string; onClose: () => void }) {
  const [logs, setLogs] = useState<DistribuicaoLog[]>([]);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    let alive = true;
    logDoLead(leadId).then((l) => { if (alive) { setLogs(l); setCarregando(false); } });
    return () => { alive = false; };
  }, [leadId]);

  return (
    <ModalShell onClose={onClose} label="Por que recebi este lead?"
      backdropClassName="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[80vh] overflow-y-auto p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold text-ink flex items-center gap-2"><HelpCircle size={18} className="text-brand-500" /> Por que recebi este lead?</h3>
        <button onClick={onClose} aria-label="Fechar" className="text-slate-400 hover:text-slate-600 p-1"><X size={18} /></button>
      </div>
      {carregando ? <Spinner /> : logs.length === 0 ? (
        <p className="text-sm text-muted">Nenhum registro de distribuição encontrado pra este lead.</p>
      ) : (
        <ul className="space-y-3">
          {logs.map((l) => (
            <li key={l.id} className="text-sm border-b border-slate-100 pb-2 last:border-0 last:pb-0">
              <p className="text-ink">{l.motivo}</p>
              <p className="text-xs text-muted mt-0.5">{dateTimeBR(l.created_at)}</p>
            </li>
          ))}
        </ul>
      )}
    </ModalShell>
  );
}

// ─── Modal: Arquivar lead (motivo + observação opcional) ────────────────────
function ModalArquivar({ lead, motivos, userId, onClose, onDone }: {
  lead: LeadDetalhado; motivos: MotivoArquivamento[]; userId?: string; onClose: () => void; onDone: () => void;
}) {
  const [motivo, setMotivo] = useState("");
  const [obs, setObs] = useState("");
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    if (!motivo) { toast.error("Escolha um motivo."); return; }
    setSalvando(true);
    const ok = await descartarLead(lead.id, motivo);
    if (ok && obs.trim() && userId) {
      await inserir("lead_observacoes", { lead_id: lead.id, texto: obs.trim(), criado_por: userId });
    }
    setSalvando(false);
    if (ok) { toast.success("Lead arquivado."); onDone(); } else toast.error("Não foi possível arquivar o lead.");
  }

  return (
    <ModalShell onClose={onClose} label="Arquivar lead"
      backdropClassName="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold text-ink flex items-center gap-2"><Archive size={18} className="text-red-500" /> Arquivar lead</h3>
        <button onClick={onClose} aria-label="Fechar" className="text-slate-400 hover:text-slate-600 p-1"><X size={18} /></button>
      </div>
      <label className={lblCls}>Motivo *</label>
      <select className={inputCls} value={motivo} onChange={(e) => setMotivo(e.target.value)}>
        <option value="">Selecione um motivo…</option>
        {motivos.map((m) => <option key={m.id} value={m.nome}>{m.nome}</option>)}
      </select>
      <label className={`${lblCls} mt-3`}>Observação (opcional)</label>
      <textarea className={`${inputCls} resize-none`} rows={3} value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Detalhe o motivo, se quiser…" />
      <div className="flex gap-2 justify-end mt-4">
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button variant="danger" onClick={salvar} disabled={salvando || !motivo}>{salvando ? "Arquivando…" : "Arquivar"}</Button>
      </div>
    </ModalShell>
  );
}

// ─── Modal: Cadastrar proposta (paridade C2S) ────────────────────────────────
function ModalProposta({ lead, userId, onClose, onDone }: {
  lead: LeadDetalhado; userId?: string; onClose: () => void; onDone: () => void;
}) {
  const [valor, setValor] = useState("");
  const [obs, setObs] = useState("");
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    const num = parseValorBR(valor);
    if (!valor.trim() || !Number.isFinite(num) || num <= 0) { toast.error("Informe o valor da proposta."); return; }
    if (!userId) { toast.error("Sessão expirada — faça login novamente."); return; }
    setSalvando(true);
    const agora = new Date().toISOString();
    const okLead = await atualizar("leads", lead.id, { etapa: "negociacao", valor_potencial: num, interagido_em: agora });
    if (!okLead) { setSalvando(false); toast.error("Não foi possível cadastrar a proposta."); return; }
    const valorFmt = num.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    await inserir("lead_atividades", {
      lead_id: lead.id, tipo: "proposta", titulo: `Proposta enviada — ${valorFmt}`,
      quando: agora, status: "concluida", concluida_em: agora, criado_por: userId,
    });
    if (obs.trim()) {
      await inserir("lead_observacoes", { lead_id: lead.id, texto: obs.trim(), criado_por: userId });
    }
    setSalvando(false);
    toast.success("Proposta cadastrada.");
    onDone();
  }

  return (
    <ModalShell onClose={onClose} label="Cadastrar proposta"
      backdropClassName="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold text-ink flex items-center gap-2"><FileText size={18} className="text-brand-500" /> Cadastrar proposta</h3>
        <button onClick={onClose} aria-label="Fechar" className="text-slate-400 hover:text-slate-600 p-1"><X size={18} /></button>
      </div>
      <label className={lblCls}>Valor da proposta (R$) *</label>
      <input className={inputCls} inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="Ex.: 1500,00" autoFocus />
      <label className={`${lblCls} mt-3`}>Observação (opcional)</label>
      <textarea className={`${inputCls} resize-none`} rows={3} value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Detalhe a proposta, se quiser…" />
      <div className="flex gap-2 justify-end mt-4">
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button onClick={salvar} disabled={salvando}>{salvando ? "Salvando…" : "Salvar proposta"}</Button>
      </div>
    </ModalShell>
  );
}

// ─── Modal: Editar dados do lead (paridade C2S: "editar" no header) ──────────
// Telefone digitado errado quebrava o wa.me sem nenhum caminho de correção.
function ModalEditar({ lead, onClose, onDone }: { lead: LeadDetalhado; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({
    nome: lead.nome || "", telefone: lead.telefone || "", email: lead.email || "",
    produto_interesse: lead.produto_interesse || "",
    valor_potencial: lead.valor_potencial != null ? String(lead.valor_potencial).replace(".", ",") : "",
  });
  const [salvando, setSalvando] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((p) => ({ ...p, [k]: e.target.value }));

  async function salvar() {
    const nome = form.nome.trim();
    if (nome.length < 2) { toast.error("Informe o nome do lead."); return; }
    let valor: number | null = null;
    if (form.valor_potencial.trim()) {
      valor = parseValorBR(form.valor_potencial);
      if (!Number.isFinite(valor) || valor < 0) { toast.error("Valor potencial inválido."); return; }
    }
    setSalvando(true);
    const ok = await atualizar("leads", lead.id, {
      nome, telefone: form.telefone.trim() || null, email: form.email.trim() || null,
      produto_interesse: form.produto_interesse.trim() || null, valor_potencial: valor,
    });
    setSalvando(false);
    if (ok) { toast.success("Lead atualizado."); onDone(); } else toast.error("Não foi possível salvar as alterações.");
  }

  return (
    <ModalShell onClose={onClose} label="Editar lead"
      backdropClassName="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold text-ink flex items-center gap-2"><Pencil size={17} className="text-brand-500" /> Editar lead</h3>
        <button onClick={onClose} aria-label="Fechar" className="text-slate-400 hover:text-slate-600 p-1"><X size={18} /></button>
      </div>
      <label className={lblCls}>Nome *</label>
      <input className={inputCls} value={form.nome} onChange={set("nome")} />
      <label className={`${lblCls} mt-3`}>Telefone/WhatsApp</label>
      <input className={inputCls} value={form.telefone} onChange={set("telefone")} inputMode="tel" placeholder="(12) 90000-0000" />
      <label className={`${lblCls} mt-3`}>E-mail</label>
      <input className={inputCls} value={form.email} onChange={set("email")} type="email" />
      <label className={`${lblCls} mt-3`}>Produto de interesse</label>
      <input className={inputCls} value={form.produto_interesse} onChange={set("produto_interesse")} placeholder="Seguro Auto, Consórcio Imóvel…" />
      <label className={`${lblCls} mt-3`}>Valor potencial (R$)</label>
      <input className={inputCls} value={form.valor_potencial} onChange={set("valor_potencial")} inputMode="decimal" placeholder="Ex.: 1500,00" />
      <div className="flex gap-2 justify-end mt-4">
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button onClick={salvar} disabled={salvando}>{salvando ? "Salvando…" : "Salvar"}</Button>
      </div>
    </ModalShell>
  );
}

// ─── Card: WhatsApp rápido com mensagens prontas ─────────────────────────────
function CardWhatsapp({ lead, atual, mensagens, user, meuPerfil, onUsar }: {
  lead: LeadDetalhado; atual: Atividade | null; mensagens: MensagemPronta[]; user: TeamUser | null;
  meuPerfil: { phone?: string | null; assinatura?: string | null } | null; onUsar: () => void;
}) {
  const [selecionada, setSelecionada] = useState("");
  const template = mensagens.find((m) => m.id === selecionada);
  // A assinatura pode conter variáveis (o Perfil faz preview dela assim) —
  // renderiza primeiro e injeta o resultado como [ASSINATURA] do template.
  const ctxBase = {
    nomeContato: lead.nome,
    nomeVendedor: user?.name,
    telefoneVendedor: meuPerfil?.phone,
    produto: lead.produto_interesse,
    campanha: lead.campanha,
    nomeAtividade: atual ? rotuloTipo(atual.tipo) : undefined,
    dataAtividade: atual ? dateTimeBR(atual.quando) ?? undefined : undefined,
  };
  const assinatura = meuPerfil?.assinatura ? renderTemplate(meuPerfil.assinatura, ctxBase) : undefined;
  const texto = template ? renderTemplate(template.conteudo, { ...ctxBase, assinatura }) : "";
  const href = waLink(lead.telefone, texto || undefined);

  async function copiar() {
    if (!texto) return;
    try { await navigator.clipboard.writeText(texto); toast.success("Mensagem copiada."); onUsar(); }
    catch { toast.error("Não foi possível copiar a mensagem."); }
  }

  return (
    <Card>
      <h3 className="font-bold text-ink mb-3">WhatsApp rápido</h3>
      {mensagens.length === 0 ? (
        <p className="text-sm text-muted">Nenhuma mensagem pronta cadastrada ainda.</p>
      ) : (
        <>
          <select className={inputCls} value={selecionada} onChange={(e) => setSelecionada(e.target.value)}>
            <option value="">Escolha uma mensagem…</option>
            {mensagens.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
          </select>
          {texto && <div className="mt-3 rounded-xl bg-slate-50 border border-slate-200 p-3 text-sm text-ink whitespace-pre-wrap">{texto}</div>}
          <div className="flex gap-2 mt-3">
            <Button size="sm" variant="outline" icon={Copy} disabled={!texto} onClick={copiar}>Copiar</Button>
            {href && (
              <a href={href} target="_blank" rel="noopener noreferrer" onClick={onUsar}>
                <Button size="sm" variant="wa" icon={Send}>Abrir WhatsApp</Button>
              </a>
            )}
          </div>
        </>
      )}
    </Card>
  );
}

// ─── Painel: Atividades (atual, criar, próximas, histórico) ─────────────────
function PainelAtividades({ atividades, onConcluir, onCriar }: {
  atividades: Atividade[]; onConcluir: (id: string) => void;
  onCriar: (tipo: Atividade["tipo"], titulo: string, quando: string) => void;
}) {
  const atual = atividadeAtual(atividades);
  const pendentes = atividades.filter((a) => a.status === "pendente" && a.id !== atual?.id)
    .sort((a, b) => a.quando.localeCompare(b.quando));
  const concluidas = atividades.filter((a) => a.status !== "pendente")
    .sort((a, b) => (b.concluida_em || b.created_at || "").localeCompare(a.concluida_em || a.created_at || ""));

  const [tipo, setTipo] = useState<Atividade["tipo"]>("retornar");
  const [titulo, setTitulo] = useState(rotuloTipo("retornar"));
  const [data, setData] = useState("");
  const [hora, setHora] = useState("");
  const [historico, setHistorico] = useState(false);

  function mudarTipo(v: string) {
    const t = v as Atividade["tipo"];
    setTipo(t);
    setTitulo(rotuloTipo(t)); // título tem o rótulo como default; usuário pode sobrescrever
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!data || !hora) { toast.error("Informe data e hora da atividade."); return; }
    const quando = new Date(`${data}T${hora}:00`).toISOString();
    onCriar(tipo, titulo.trim() || rotuloTipo(tipo), quando);
    setTitulo(rotuloTipo(tipo)); setData(""); setHora("");
  }

  return (
    <Card>
      <h3 className="font-bold text-ink mb-3">Atividades</h3>

      {atual ? (
        <div className={`rounded-xl p-3 mb-3 flex items-center justify-between gap-3 ${atividadeAtrasada(atual) ? "bg-red-50 border border-red-200" : "bg-brand-50 border border-brand-100"}`}>
          <div className="min-w-0">
            <p className={`text-xs font-bold flex items-center gap-1 ${atividadeAtrasada(atual) ? "text-red-600" : "text-brand-600"}`}>
              {atividadeAtrasada(atual) && <AlertTriangle size={12} />} {atividadeAtrasada(atual) ? "Atrasada" : "Atividade atual"} · {rotuloTipo(atual.tipo)}
            </p>
            <p className="text-sm font-bold text-ink truncate">{atual.titulo}</p>
            <p className="text-xs text-muted">{dateTimeBR(atual.quando)}</p>
          </div>
          <Button size="sm" icon={CheckCircle2} onClick={() => onConcluir(atual.id)}>Concluir</Button>
        </div>
      ) : (
        <p className="text-sm text-muted mb-3">Nenhuma atividade pendente.</p>
      )}

      {pendentes.length > 0 && (
        <div className="mb-3 space-y-1.5">
          <p className="text-xs font-bold text-slate-500">Próximas</p>
          {pendentes.map((a) => (
            <div key={a.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="text-ink truncate">{rotuloTipo(a.tipo)} — {a.titulo} <span className="text-xs text-muted">({dateTimeBR(a.quando)})</span></span>
              <button onClick={() => onConcluir(a.id)} title="Concluir" aria-label={`Concluir ${a.titulo}`} className="text-slate-400 hover:text-green-600 shrink-0"><CheckCircle2 size={16} /></button>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={submit} className="border-t border-slate-100 pt-3 space-y-2">
        <p className="text-xs font-bold text-slate-500">Criar nova atividade</p>
        <select className={inputCls} value={tipo} onChange={(e) => mudarTipo(e.target.value)}>
          {TIPOS_ATIVIDADE.map((t) => <option key={t.valor} value={t.valor}>{t.rotulo}</option>)}
        </select>
        <input className={inputCls} value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Título" />
        <div className="grid grid-cols-2 gap-2">
          <input type="date" className={inputCls} value={data} onChange={(e) => setData(e.target.value)} />
          <input type="time" className={inputCls} value={hora} onChange={(e) => setHora(e.target.value)} />
        </div>
        <Button size="sm" type="submit" icon={Plus}>Criar atividade</Button>
      </form>

      {concluidas.length > 0 && (
        <div className="border-t border-slate-100 mt-3 pt-3">
          <button onClick={() => setHistorico((h) => !h)} className="text-xs font-bold text-slate-500 flex items-center gap-1">
            {historico ? <ChevronUp size={13} /> : <ChevronDown size={13} />} Histórico ({concluidas.length})
          </button>
          {historico && (
            <ul className="mt-2 space-y-1.5">
              {concluidas.map((a) => (
                <li key={a.id} className="text-xs text-muted flex items-center gap-1.5">
                  <CheckCircle2 size={12} className="text-green-500 shrink-0" /> {rotuloTipo(a.tipo)} — {a.titulo} ({dateTimeBR(a.concluida_em ?? a.quando)})
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}

// ─── Painel: Etiquetas ────────────────────────────────────────────────────────
// Paridade C2S: "Etiquetas (select + CRIAR)" — dá pra criar direto na página do
// lead (RLS libera INSERT pra equipe; gerenciar/editar continua no ConfigHub).
function PainelEtiquetas({ tags, disponiveis, onToggle, onCriar }: {
  tags: Etiqueta[]; disponiveis: Etiqueta[]; onToggle: (etiquetaId: string, tem: boolean) => void;
  onCriar: (nome: string, cor: string) => Promise<void>;
}) {
  const [novaId, setNovaId] = useState("");
  const [criando, setCriando] = useState(false);
  const [nomeNova, setNomeNova] = useState("");
  const [corNova, setCorNova] = useState(CORES_ETIQUETA[0]);
  const [salvando, setSalvando] = useState(false);
  const restantes = disponiveis.filter((d) => !tags.some((t) => t.id === d.id));

  async function criar() {
    const n = nomeNova.trim();
    if (n.length < 2) { toast.error("Dê um nome à etiqueta."); return; }
    setSalvando(true);
    await onCriar(n, corNova);
    setSalvando(false);
    setNomeNova(""); setCriando(false);
  }

  return (
    <Card>
      <h3 className="font-bold text-ink mb-3 flex items-center gap-1.5"><Tag size={16} className="text-brand-500" /> Etiquetas</h3>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {tags.length === 0 && <p className="text-sm text-muted">Nenhuma etiqueta ainda.</p>}
        {tags.map((t) => (
          <span key={t.id} className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full text-white" style={{ background: t.cor }}>
            {t.nome}
            <button onClick={() => onToggle(t.id, true)} aria-label={`Remover etiqueta ${t.nome}`} className="hover:opacity-70"><X size={11} /></button>
          </span>
        ))}
      </div>
      {restantes.length > 0 && (
        <div className="flex gap-2">
          <select className={inputCls} value={novaId} onChange={(e) => setNovaId(e.target.value)}>
            <option value="">Adicionar etiqueta…</option>
            {restantes.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
          </select>
          <Button size="sm" disabled={!novaId} onClick={() => { onToggle(novaId, false); setNovaId(""); }}>Adicionar</Button>
        </div>
      )}
      {!criando ? (
        <button onClick={() => setCriando(true)} className="mt-2 text-xs font-bold text-brand-500 hover:text-brand-700 inline-flex items-center gap-1">
          <Plus size={12} /> Criar etiqueta
        </button>
      ) : (
        <div className="mt-3 border-t border-slate-100 pt-3 space-y-2">
          <input className={inputCls} value={nomeNova} onChange={(e) => setNomeNova(e.target.value)} placeholder="Nome da etiqueta" autoFocus />
          <div className="flex items-center gap-1.5 flex-wrap">
            {CORES_ETIQUETA.map((c) => (
              <button key={c} onClick={() => setCorNova(c)} aria-label={`Cor ${c}`}
                className={`w-6 h-6 rounded-full border-2 ${corNova === c ? "border-ink scale-110" : "border-transparent"}`}
                style={{ background: c }} />
            ))}
          </div>
          <div className="flex gap-2 justify-end">
            <Button size="sm" variant="ghost" onClick={() => setCriando(false)}>Cancelar</Button>
            <Button size="sm" disabled={salvando || nomeNova.trim().length < 2} onClick={criar}>{salvando ? "Criando…" : "Criar e aplicar"}</Button>
          </div>
        </div>
      )}
    </Card>
  );
}

// ─── Painel: Observações ──────────────────────────────────────────────────────
function PainelObservacoes({ observacoes, pessoas, texto, onTexto, onAdicionar }: {
  observacoes: Observacao[]; pessoas: Record<string, string>;
  texto: string; onTexto: (v: string) => void; onAdicionar: () => void;
}) {
  return (
    <Card>
      <h3 className="font-bold text-ink mb-3">Observações</h3>
      <textarea className={`${inputCls} resize-none`} rows={3} placeholder="Escreva uma observação sobre este lead…" value={texto} onChange={(e) => onTexto(e.target.value)} />
      <div className="flex justify-end mt-2">
        <Button size="sm" icon={Plus} disabled={!texto.trim()} onClick={onAdicionar}>Adicionar</Button>
      </div>
      {observacoes.length > 0 && (
        <ul className="mt-4 space-y-3 border-t border-slate-100 pt-3">
          {observacoes.map((o) => (
            <li key={o.id} className="text-sm">
              <p className="text-ink whitespace-pre-wrap">{o.texto}</p>
              <p className="text-xs text-muted mt-0.5">{o.criado_por ? (pessoas[o.criado_por] ?? "—") : "—"} · {dateTimeBR(o.created_at)}</p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────
export function LeadDetalhe() {
  const { id } = useParams();
  const location = useLocation();
  const { user, isManager } = useAuth();
  // A rota é /seguros/leads/:id ou /consorcios/leads/:id (sem :modulo real na
  // definição de rota) — o módulo vem do prefixo do caminho.
  const modulo: Modulo = location.pathname.startsWith("/consorcios") ? "consorcios" : "seguros";

  const [lead, setLead] = useState<LeadDetalhado | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [avisoParity, setAvisoParity] = useState(false);

  const [responsavel, setResponsavel] = useState<{ id: string; name: string } | null>(null);
  const [favorito, setFavorito] = useState(false);
  const [pessoas, setPessoas] = useState<Record<string, string>>({});
  // phone+assinatura do usuário logado — [TELEFONE_VENDEDOR]/[ASSINATURA] dos templates
  const [meuPerfil, setMeuPerfil] = useState<{ phone?: string | null; assinatura?: string | null } | null>(null);

  const [atividades, setAtividades] = useState<Atividade[]>([]);
  const [observacoes, setObservacoes] = useState<Observacao[]>([]);
  const [etiquetasLead, setEtiquetasLead] = useState<Etiqueta[]>([]);
  const [todasEtiquetas, setTodasEtiquetas] = useState<Etiqueta[]>([]);
  const [mensagensProntas, setMensagensProntas] = useState<MensagemPronta[]>([]);
  const [motivos, setMotivos] = useState<MotivoArquivamento[]>([]);
  const [novaObs, setNovaObs] = useState("");

  const [showTransferir, setShowTransferir] = useState(false);
  const [showPorque, setShowPorque] = useState(false);
  const [showArquivar, setShowArquivar] = useState(false);
  const [showProposta, setShowProposta] = useState(false);
  const [showEditar, setShowEditar] = useState(false);

  async function carregarTudo(leadId: string, aliveRef: { current: boolean }) {
    if (!supabase) { if (aliveRef.current) setLoading(false); return; }
    const { data: leadData, error } = await supabase.from("leads").select("*").eq("id", leadId).single();
    if (!aliveRef.current) return;
    if (error || !leadData) { setNotFound(true); setLoading(false); return; }
    const l = leadData as LeadDetalhado;

    const [parityCheck, ativs, obs, tags, allTags, msgs, mots, favs, perfilRes] = await Promise.all([
      supabase.from("lead_atividades").select("id").limit(1),
      atividadesDoLead(leadId),
      observacoesDoLead(leadId),
      etiquetasDoLead(leadId),
      listar<Etiqueta>("etiquetas"),
      listar<MensagemPronta>("mensagens_prontas", "ordem"),
      listar<MotivoArquivamento>("motivos_arquivamento", "nome"),
      user ? favoritosDoUsuario(user.id) : Promise.resolve(new Set<string>()),
      user ? supabase.from("profiles").select("phone, assinatura").eq("id", user.id).single() : Promise.resolve({ data: null }),
    ]);
    if (!aliveRef.current) return;

    // Nomes de responsável/autores num único round-trip
    const ids = new Set<string>();
    if (l.vendedor_id) ids.add(l.vendedor_id);
    ativs.forEach((a) => a.criado_por && ids.add(a.criado_por));
    obs.forEach((o) => o.criado_por && ids.add(o.criado_por));
    let mapaPessoas: Record<string, string> = {};
    if (ids.size) {
      const { data: perfis } = await supabase.from("profiles").select("id,name").in("id", Array.from(ids));
      (perfis || []).forEach((p: any) => { mapaPessoas[p.id] = p.name; });
    }
    if (!aliveRef.current) return;

    setLead(l);
    setAvisoParity(!!parityCheck.error);
    setAtividades(ativs);
    setObservacoes(obs);
    setEtiquetasLead(tags);
    setTodasEtiquetas(allTags.filter((e) => e.ativa));
    setMensagensProntas(msgs.filter((m) => m.ativa));
    setMotivos(mots.filter((m) => m.ativo));
    setFavorito(favs.has(leadId));
    setMeuPerfil((perfilRes as any)?.data ?? null);
    setPessoas(mapaPessoas);
    setResponsavel(l.vendedor_id && mapaPessoas[l.vendedor_id] ? { id: l.vendedor_id, name: mapaPessoas[l.vendedor_id] } : null);
    setLoading(false);
  }

  useEffect(() => {
    const aliveRef = { current: true };
    if (!id) { setNotFound(true); setLoading(false); return; }
    setLoading(true);
    setNotFound(false);
    carregarTudo(id, aliveRef);
    return () => { aliveRef.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  function reload() { if (id) carregarTudo(id, { current: true }); }

  async function toggleFavorito() {
    if (!user || !lead) return;
    const era = favorito;
    setFavorito(!era);
    const ok = await alternarFavorito(user.id, lead.id, era);
    if (!ok) { setFavorito(era); toast.error("Não foi possível atualizar o favorito."); }
  }

  async function onFecharNegocio() {
    if (!lead) return;
    try {
      await moverEtapa(lead.id, "ganho");
      setLead((p) => (p ? { ...p, etapa: "ganho" } : p));
      toast.success("Negócio marcado como fechado!");
    } catch { toast.error("Não foi possível fechar o negócio."); }
  }

  async function onDevolverBolsao() {
    if (!lead) return;
    await devolverBolsao(lead.id);
    setLead((p) => (p ? { ...p, vendedor_id: null, atribuido_em: null, sla_expira_em: null } : p));
    setResponsavel(null);
    toast.success("Lead devolvido ao bolsão.");
  }

  async function onUsarWhatsapp() {
    if (!lead) return;
    const now = new Date().toISOString();
    await atualizar("leads", lead.id, { interagido_em: now });
    if (!lead.primeiro_contato_em) await registrarContato(lead.id);
    setLead((p) => (p ? { ...p, interagido_em: now, primeiro_contato_em: p.primeiro_contato_em ?? now } : p));
  }

  async function onConcluirAtividade(atividadeId: string) {
    const ok = await concluirAtividade(atividadeId);
    if (!ok) { toast.error("Não foi possível concluir a atividade."); return; }
    if (lead) {
      const now = new Date().toISOString();
      await atualizar("leads", lead.id, { interagido_em: now });
      setLead((p) => (p ? { ...p, interagido_em: now } : p));
    }
    toast.success("Atividade concluída.");
    reload();
  }

  async function onCriarAtividade(tipo: Atividade["tipo"], titulo: string, quando: string) {
    if (!lead || !user) return;
    const ok = await inserir("lead_atividades", { lead_id: lead.id, tipo, titulo, quando, status: "pendente", criado_por: user.id });
    if (!ok) { toast.error(`Não foi possível criar a atividade.${avisoParity ? " Rode a migration supabase/c2s-parity.sql." : ""}`); return; }
    toast.success("Atividade criada.");
    reload();
  }

  async function onToggleEtiqueta(etiquetaId: string, tem: boolean) {
    if (!lead) return;
    const ok = await alternarEtiqueta(lead.id, etiquetaId, tem);
    if (!ok) { toast.error("Não foi possível atualizar a etiqueta."); return; }
    setEtiquetasLead((prev) => {
      if (tem) return prev.filter((e) => e.id !== etiquetaId);
      const nova = todasEtiquetas.find((e) => e.id === etiquetaId);
      return nova ? [...prev, nova] : prev;
    });
  }

  // Cria a etiqueta na hora (paridade C2S) e já aplica no lead.
  async function onCriarEtiqueta(nome: string, cor: string) {
    if (!lead || !supabase) return;
    const { data, error } = await supabase.from("etiquetas").insert({ nome, cor }).select("id, nome, cor, ativa").single();
    if (error || !data) { toast.error("Não foi possível criar a etiqueta."); return; }
    const nova = data as Etiqueta;
    setTodasEtiquetas((prev) => [...prev, nova]);
    const ok = await alternarEtiqueta(lead.id, nova.id, false);
    if (ok) { setEtiquetasLead((prev) => [...prev, nova]); toast.success("Etiqueta criada e aplicada."); }
    else toast.success("Etiqueta criada.");
  }

  // Reabrir lead arquivado (o C2S mantém arquivados acessíveis e reativáveis).
  async function onReabrir() {
    if (!lead) return;
    const patch: Record<string, unknown> = { descartado: false, motivo_descarte: null };
    if (lead.etapa === "perdido") patch.etapa = "contato"; // volta pro funil em atendimento
    const ok = await atualizar("leads", lead.id, patch);
    if (ok) { toast.success("Lead reaberto."); reload(); } else toast.error("Não foi possível reabrir o lead.");
  }

  async function onAdicionarObs() {
    if (!lead || !user || !novaObs.trim()) return;
    const ok = await inserir("lead_observacoes", { lead_id: lead.id, texto: novaObs.trim(), criado_por: user.id });
    if (!ok) { toast.error(`Não foi possível salvar a observação.${avisoParity ? " Rode a migration supabase/c2s-parity.sql." : ""}`); return; }
    const now = new Date().toISOString();
    await atualizar("leads", lead.id, { interagido_em: now });
    setLead((p) => (p ? { ...p, interagido_em: now } : p));
    setNovaObs("");
    toast.success("Observação adicionada.");
    reload();
  }

  if (loading) {
    return (
      <>
        <PageHeader title="Lead" icon={MessageCircle} />
        <Spinner label="Carregando lead..." />
      </>
    );
  }

  if (notFound || !lead) {
    return (
      <>
        <PageHeader title="Lead" icon={MessageCircle} />
        <Card pad={false}>
          <EmptyState icon={Inbox} title="Lead não encontrado"
            hint="Esse lead pode ter sido removido ou o link está incorreto."
            action={<Link to={`/${modulo}/pipeline`}><Button variant="outline" icon={ArrowLeft}>Voltar ao pipeline</Button></Link>} />
        </Card>
      </>
    );
  }

  const waHref = waLink(lead.telefone);

  return (
    <>
      <Link to={`/${modulo}/pipeline`} className="inline-flex items-center gap-1.5 text-xs font-bold text-muted hover:text-brand-600 mb-3">
        <ArrowLeft size={14} /> Voltar
      </Link>

      {avisoParity && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 text-amber-800 text-xs font-semibold px-4 py-3 flex items-center gap-2">
          <AlertTriangle size={15} className="shrink-0" />
          Algumas funções (atividades, etiquetas, observações, mensagens prontas) exigem uma migration ainda não aplicada. Rode <code className="bg-amber-100 px-1 rounded">supabase/c2s-parity.sql</code> no Supabase.
        </div>
      )}

      {/* Lead arquivado: banner com motivo + reabrir (a página não pode fingir que está ativo) */}
      {lead.descartado && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          <p className="text-sm font-bold text-red-700 flex items-center gap-2">
            <Archive size={15} /> Lead arquivado{lead.motivo_descarte ? ` — motivo: ${lead.motivo_descarte}` : ""}
          </p>
          <Button size="sm" variant="outline" icon={RotateCcw} onClick={onReabrir}>Reabrir lead</Button>
        </div>
      )}

      {/* Cabeçalho */}
      <Card className="mb-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-display text-ink leading-tight">{lead.nome}</h1>
              {(() => { const e = ETAPA_INFO[lead.etapa || "novos"]; return e ? <Badge tone={e.tone}>{e.rotulo}</Badge> : null; })()}
              <button onClick={toggleFavorito} title={favorito ? "Remover dos favoritos" : "Favoritar"}
                aria-label={favorito ? "Remover dos favoritos" : "Favoritar"}
                className={`p-1.5 rounded-lg ${favorito ? "text-amber-500" : "text-slate-300 hover:text-amber-400"}`}>
                <Star size={20} fill={favorito ? "currentColor" : "none"} />
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {lead.produto_interesse && <Badge tone="blue">{lead.produto_interesse}</Badge>}
              {lead.campanha && <Badge tone="violet">{lead.campanha}</Badge>}
              {(lead.fonte || lead.canal) && <Badge tone="amber">{[lead.fonte, lead.canal].filter(Boolean).join(" · ")}</Badge>}
              {lead.origem && <Badge tone="slate">{lead.origem}</Badge>}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-3 text-sm text-muted">
              {lead.telefone && <span className="flex items-center gap-1.5"><Phone size={13} /> {lead.telefone}</span>}
              {waHref && (
                <a href={waHref} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-bold text-[#25d366] bg-green-50 px-2 py-1 rounded-lg">
                  <MessageCircle size={12} /> WhatsApp
                </a>
              )}
              {lead.email && <a href={`mailto:${lead.email}`} className="flex items-center gap-1.5 hover:text-brand-600"><Mail size={13} /> {lead.email}</a>}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs text-muted">
              <span className="flex items-center gap-1"><UserIcon size={12} /> {responsavel ? responsavel.name : "Sem responsável"}</span>
              <span>Recebido em {dateTimeBR(lead.created_at) ?? "—"}</span>
              <span>Interagido em {dateTimeBR(lead.interagido_em) ?? "nunca"}</span>
            </div>
            <button onClick={() => setShowPorque(true)} className="text-xs font-bold text-brand-500 hover:text-brand-700 mt-2 inline-flex items-center gap-1">
              <HelpCircle size={12} /> Por que recebi este lead?
            </button>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" icon={Pencil} onClick={() => setShowEditar(true)}>Editar</Button>
            {isManager && (
              <Button variant="outline" icon={ArrowLeftRight} onClick={() => setShowTransferir(true)}>Transferir</Button>
            )}
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-[1.3fr_1fr] gap-5">
        {/* Coluna esquerda */}
        <div className="space-y-5">
          <Card>
            <h3 className="font-bold text-ink mb-3">Mensagem do lead</h3>
            {lead.mensagem ? <p className="text-sm text-ink whitespace-pre-wrap">{lead.mensagem}</p> : <p className="text-sm text-muted">Sem mensagem inicial.</p>}
            {lead.formulario && typeof lead.formulario === "object" && Object.keys(lead.formulario).length > 0 && (
              <div className="mt-4 border-t border-slate-100 pt-3">
                <p className="text-xs font-bold text-slate-500 mb-2">Respostas do formulário</p>
                <dl className="space-y-2">
                  {Object.entries(lead.formulario).map(([pergunta, resposta]) => (
                    <div key={pergunta} className="text-sm">
                      <dt className="text-xs text-muted">{pergunta}</dt>
                      <dd className="text-ink font-semibold">{String(resposta)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
          </Card>

          <CardWhatsapp lead={lead} atual={atividadeAtual(atividades)} mensagens={mensagensProntas} user={user} meuPerfil={meuPerfil} onUsar={onUsarWhatsapp} />
        </div>

        {/* Coluna direita */}
        <div className="space-y-5">
          <Card>
            <h3 className="font-bold text-ink mb-3">Mantenha seu lead atualizado</h3>
            {lead.descartado ? (
              <p className="text-sm text-muted">Este lead está arquivado — reabra para voltar a trabalhar nele.</p>
            ) : lead.etapa === "ganho" ? (
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="green">Negócio fechado</Badge>
                <Button size="sm" variant="outline" icon={Archive} onClick={() => setShowArquivar(true)}>Arquivar lead</Button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" icon={Trophy} onClick={onFecharNegocio}>Marcar negócio fechado</Button>
                <Button size="sm" variant="outline" icon={FileText} onClick={() => setShowProposta(true)}>Cadastrar proposta</Button>
                <Button size="sm" variant="outline" icon={Archive} onClick={() => setShowArquivar(true)}>Arquivar lead</Button>
                <Button size="sm" variant="outline" icon={Undo2} onClick={onDevolverBolsao}>Devolver ao bolsão</Button>
              </div>
            )}
          </Card>

          <PainelAtividades atividades={atividades} onConcluir={onConcluirAtividade} onCriar={onCriarAtividade} />
          <PainelEtiquetas tags={etiquetasLead} disponiveis={todasEtiquetas} onToggle={onToggleEtiqueta} onCriar={onCriarEtiqueta} />
          <PainelObservacoes observacoes={observacoes} pessoas={pessoas} texto={novaObs} onTexto={setNovaObs} onAdicionar={onAdicionarObs} />
        </div>
      </div>

      {showTransferir && (
        <ModalTransferir lead={lead} gestor={user} onClose={() => setShowTransferir(false)} onDone={() => { setShowTransferir(false); reload(); }} />
      )}
      {showEditar && (
        <ModalEditar lead={lead} onClose={() => setShowEditar(false)} onDone={() => { setShowEditar(false); reload(); }} />
      )}
      {showPorque && <ModalPorQue leadId={lead.id} onClose={() => setShowPorque(false)} />}
      {showArquivar && (
        <ModalArquivar lead={lead} motivos={motivos} userId={user?.id} onClose={() => setShowArquivar(false)} onDone={() => { setShowArquivar(false); reload(); }} />
      )}
      {showProposta && (
        <ModalProposta lead={lead} userId={user?.id} onClose={() => setShowProposta(false)} onDone={() => { setShowProposta(false); reload(); }} />
      )}
    </>
  );
}

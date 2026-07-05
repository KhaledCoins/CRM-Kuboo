import { useEffect, useMemo, useState } from "react";
import {
  DndContext, useDraggable, useDroppable, PointerSensor, useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core";
import { KanbanSquare, MessageCircle, User, Clock, DollarSign, CheckCircle2, AlertTriangle, Inbox, ListPlus, Trophy, X } from "lucide-react";
import { toast } from "sonner";
import { PageHeader, Button, KpiCard, Card } from "../components/ui";
import { fetchLeads, moverEtapa, registrarContato, noBolsao, slaRestanteMin, moduloDe, temperaturaLead, type Lead } from "../lib/leads";

const TEMP_DOT: Record<string, string> = { quente: "#ef4444", morno: "#f59e0b", frio: "#5bc4f5" };
import { criarTarefa } from "../lib/tarefas";
import { useAuth } from "../context/AuthContext";
import { brl, brlShort, onlyDigits } from "../lib/format";
import { supabase } from "../lib/supabase";
import type { Modulo } from "../lib/nav";

const STAGES = [
  { id: "novos", label: "Novos", color: "#1873BA" },
  { id: "contato", label: "Em Contato", color: "#36ABE2" },
  { id: "cotacao", label: "Cotação Enviada", color: "#5BC4F5" },
  { id: "negociacao", label: "Em Negociação", color: "#F59E0B" },
  { id: "ganho", label: "Fechado", color: "#16A34A" },
  { id: "perdido", label: "Perdido", color: "#94A3B8" },
];

function SlaBadge({ lead }: { lead: Lead }) {
  if (lead.primeiro_contato_em) return <span className="text-[10px] font-bold text-green-600 flex items-center gap-0.5"><CheckCircle2 size={11} /> contatado</span>;
  const min = slaRestanteMin(lead);
  if (min === null) return null;
  if (min < 0) return <span className="text-[10px] font-bold text-red-600 flex items-center gap-0.5"><AlertTriangle size={11} /> SLA estourado</span>;
  return <span className="text-[10px] font-bold text-amber-600 flex items-center gap-0.5"><Clock size={11} /> {min} min</span>;
}

function LeadCard({ lead, onContato }: { lead: Lead; onContato: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: lead.id });
  const style = transform ? { transform: `translate(${transform.x}px, ${transform.y}px)`, zIndex: 50 } : undefined;
  const wa = lead.telefone ? `https://wa.me/55${onlyDigits(lead.telefone)}` : null;
  return (
    <div ref={setNodeRef} style={style} {...listeners} {...attributes}
      className={`bg-white rounded-xl border border-slate-200 p-3 mb-2.5 cursor-grab active:cursor-grabbing shadow-sm ${isDragging ? "opacity-60 ring-2 ring-brand-300" : ""}`}>
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <p className="font-bold text-ink text-sm flex items-center gap-1.5">
          <span title={`Lead ${temperaturaLead(lead)}`} style={{ width: 8, height: 8, borderRadius: 999, background: TEMP_DOT[temperaturaLead(lead)], flexShrink: 0, boxShadow: `0 0 0 2px ${TEMP_DOT[temperaturaLead(lead)]}22` }} />
          {lead.nome}
        </p>
        <SlaBadge lead={lead} />
      </div>
      <div className="flex items-center justify-between gap-2 mb-2">
        {lead.produto_interesse && <span className="text-[11px] font-bold text-brand-700 bg-brand-50 px-2 py-0.5 rounded-md">{lead.produto_interesse}</span>}
        {lead.valor_potencial ? <span className="text-xs font-bold text-ink">{brl(lead.valor_potencial)}</span> : null}
      </div>
      <div className="flex items-center gap-1.5" onPointerDown={(e) => e.stopPropagation()}>
        {wa && <a href={wa} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[11px] font-bold text-[#25d366] bg-green-50 px-2 py-1 rounded-lg"><MessageCircle size={12} /> WhatsApp</a>}
        {!lead.primeiro_contato_em && (
          <button onClick={() => onContato(lead.id)} className="flex items-center gap-1 text-[11px] font-bold text-brand-600 bg-brand-50 px-2 py-1 rounded-lg">
            <CheckCircle2 size={12} /> Contato
          </button>
        )}
        <button
          onClick={async () => {
            const { error } = await criarTarefa({
              titulo: `Follow-up: ${lead.nome}`,
              descricao: lead.produto_interesse ? `Interesse: ${lead.produto_interesse}` : undefined,
              cliente_nome: lead.nome, status: "a_fazer", prioridade: "media", modulo: moduloDe(lead),
            });
            if (error) toast.error("Não foi possível criar a tarefa"); else toast.success("Tarefa criada no quadro!");
          }}
          className="flex items-center gap-1 text-[11px] font-bold text-violet-600 bg-violet-50 px-2 py-1 rounded-lg">
          <ListPlus size={12} /> Tarefa
        </button>
      </div>
    </div>
  );
}

function Column({ stage, leads, onContato }: { stage: typeof STAGES[number]; leads: Lead[]; onContato: (id: string) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  const total = leads.reduce((s, l) => s + (l.valor_potencial ?? 0), 0);
  return (
    <div className="w-[270px] shrink-0">
      <div className="flex items-center justify-between mb-1 px-1">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: stage.color }} />
          <h3 className="text-sm text-ink font-bold" style={{ fontFamily: "var(--font-sans)" }}>{stage.label}</h3>
          <span className="text-xs bg-slate-100 text-slate-500 rounded-full px-1.5 font-bold">{leads.length}</span>
        </div>
      </div>
      <div className="text-[11px] text-muted px-1 mb-2">{brlShort(total)}</div>
      <div ref={setNodeRef} className={`min-h-[140px] rounded-xl p-2 transition-colors ${isOver ? "bg-brand-50" : "bg-slate-100/60"}`}>
        {leads.map((l) => <LeadCard key={l.id} lead={l} onContato={onContato} />)}
      </div>
    </div>
  );
}

// ─── Lead → Venda em 1 clique ─────────────────────────────────────────────────
// Abre ao soltar um lead em "Fechado": registra a venda pré-preenchida e gera
// AUTOMATICAMENTE as N parcelas + a comissão do consultor (fim do retrabalho em 3 telas).
function RegistrarVendaModal({
  lead, onClose, onSaved,
}: { lead: Lead; onClose: () => void; onSaved: () => void }) {
  const { user } = useAuth();
  const hoje = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    produto: lead.produto_interesse ?? "",
    seguradora: "",
    valor: lead.valor_potencial ? String(lead.valor_potencial) : "",
    parcelas: "1",
    comissao_pct: "15",
    data_venda: hoje,
  });
  const [salvando, setSalvando] = useState(false);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((p) => ({ ...p, [k]: e.target.value }));

  const valorNum = parseFloat(form.valor.replace(",", ".")) || 0;
  const nParc = Math.max(1, parseInt(form.parcelas) || 1);
  const pct = parseFloat(form.comissao_pct.replace(",", ".")) || 0;
  const comissaoValor = Math.round(valorNum * pct) / 100;

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase || !user) return;
    if (!form.produto.trim() || valorNum <= 0) { toast.error("Preencha produto e valor."); return; }
    setSalvando(true);
    let vendaId: string | null = null;
    try {
      const dv = new Date(form.data_venda + "T12:00:00");
      const vigFim = new Date(dv); vigFim.setFullYear(vigFim.getFullYear() + 1);

      // 1) Venda
      const { data: venda, error: e1 } = await supabase.from("vendas").insert({
        data_venda: form.data_venda,
        cliente_nome: lead.nome,
        vendedor_id: user.id,
        vendedor_nome: user.name,
        seguradora: form.seguradora.trim() || null,
        produto: form.produto.trim(),
        valor: valorNum,
        parcelas: nParc,
        comissao_pct: pct,
        comissao_valor: comissaoValor,
        tipo: "novo",
        status: "ativa",
        vigencia_inicio: form.data_venda,
        vigencia_fim: vigFim.toISOString().slice(0, 10),
        observacoes: `Origem: lead ${lead.nome}${lead.origem ? ` (${lead.origem})` : ""}`,
      }).select("id").single();
      if (e1 || !venda) throw e1 ?? new Error("sem id");
      vendaId = venda.id;

      // 2) Parcelas (última ajusta o arredondamento)
      const base = Math.floor((valorNum / nParc) * 100) / 100;
      const rows = Array.from({ length: nParc }, (_, i) => {
        const venc = new Date(dv); venc.setMonth(venc.getMonth() + i + 1);
        const valor = i === nParc - 1 ? Math.round((valorNum - base * (nParc - 1)) * 100) / 100 : base;
        return { venda_id: venda.id, numero: i + 1, valor, vencimento: venc.toISOString().slice(0, 10), status: "aberta" };
      });
      const { error: e2 } = await supabase.from("parcelas").insert(rows);
      if (e2) throw e2;

      // 3) Comissão do consultor
      const lib = new Date(dv); lib.setMonth(lib.getMonth() + 1);
      const { error: e3 } = await supabase.from("comissoes").insert({
        venda_id: venda.id, vendedor_id: user.id, valor: comissaoValor, pct,
        liberacao: lib.toISOString().slice(0, 10), status: "a_pagar",
      });
      if (e3) throw e3;

      toast.success(`Venda registrada! ${nParc} parcela(s) e comissão de ${brl(comissaoValor)} geradas automaticamente.`);
      onSaved();
    } catch {
      // Sem transação no PostgREST: se falhou depois de criar a venda, desfaz
      // pra não deixar venda órfã (parcelas caem por ON DELETE CASCADE).
      if (vendaId) { try { await supabase.from("vendas").delete().eq("id", vendaId); } catch { /* nada */ } }
      toast.error("Não foi possível registrar a venda. Nada foi salvo — tente novamente.");
    }
    setSalvando(false);
  }

  const inputCls = "w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-ink outline-none focus:border-brand-400";
  const lblCls = "block text-xs font-bold text-slate-600 mb-1.5";

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-xl bg-green-50 text-green-600 grid place-items-center"><Trophy size={20} /></span>
            <div>
              <h3 className="font-bold text-ink">Fechou! Registrar a venda</h3>
              <p className="text-xs text-muted">{lead.nome} · parcelas e comissão são geradas sozinhas</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1"><X size={18} /></button>
        </div>
        <form onSubmit={salvar} className="px-5 pb-5 grid gap-3">
          <div>
            <label className={lblCls}>Produto *</label>
            <input className={inputCls} value={form.produto} onChange={set("produto")} placeholder="Seguro Auto" required />
          </div>
          <div>
            <label className={lblCls}>Seguradora / Administradora</label>
            <input className={inputCls} value={form.seguradora} onChange={set("seguradora")} placeholder="Porto Seguro" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={lblCls}>Valor total (R$) *</label>
              <input className={inputCls} value={form.valor} onChange={set("valor")} placeholder="2400" inputMode="decimal" required />
            </div>
            <div>
              <label className={lblCls}>Parcelas</label>
              <input className={inputCls} value={form.parcelas} onChange={set("parcelas")} inputMode="numeric" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={lblCls}>Comissão (%)</label>
              <input className={inputCls} value={form.comissao_pct} onChange={set("comissao_pct")} inputMode="decimal" />
            </div>
            <div>
              <label className={lblCls}>Data da venda</label>
              <input type="date" className={inputCls} value={form.data_venda} onChange={set("data_venda")} />
            </div>
          </div>
          {valorNum > 0 && (
            <div className="rounded-xl bg-brand-50 border border-brand-100 px-3.5 py-2.5 text-xs text-brand-700 font-semibold">
              {nParc}x de {brl(Math.round((valorNum / nParc) * 100) / 100)} · comissão {brl(comissaoValor)} ({pct}%)
            </div>
          )}
          <div className="flex gap-2 justify-end pt-1">
            <Button type="button" variant="ghost" onClick={onClose}>Agora não</Button>
            <Button type="submit" disabled={salvando}>{salvando ? "Registrando…" : "Registrar venda"}</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function Pipeline({ modulo = "seguros" }: { modulo?: Modulo }) {
  const { user, isManager } = useAuth();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [escopo, setEscopo] = useState<"meus" | "todos">("meus");
  const [vendaLead, setVendaLead] = useState<Lead | null>(null); // lead recém-fechado → modal de venda
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  useEffect(() => { (async () => { setLeads(await fetchLeads()); setLoading(false); })(); }, []);

  // Pipeline = leads COM dono e fora do bolsão (em atendimento)
  const ativos = useMemo(() => leads.filter((l) => moduloDe(l) === modulo && !noBolsao(l)), [leads, modulo]);
  const visiveis = useMemo(
    () => (escopo === "meus" && user ? ativos.filter((l) => l.vendedor_id === user.id) : ativos),
    [ativos, escopo, user]
  );

  async function onDragEnd(e: DragEndEvent) {
    const id = String(e.active.id);
    const to = e.over?.id ? String(e.over.id) : null;
    const atual = leads.find((l) => l.id === id);
    if (!to || !atual || (atual.etapa ?? "novos") === to) return; // drop fora ou mesma coluna
    const anterior = atual.etapa ?? "novos";
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, etapa: to } : l)));
    try {
      await moverEtapa(id, to);
      // fechou o negócio → oferece registrar a venda na hora (parcelas + comissão automáticas)
      if (to === "ganho") setVendaLead(atual);
    } catch {
      setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, etapa: anterior } : l)));
    }
  }

  async function onContato(id: string) {
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, primeiro_contato_em: new Date().toISOString() } : l)));
    await registrarContato(id);
  }

  const potencial = visiveis.reduce((s, l) => s + (l.valor_potencial ?? 0), 0);
  const fechados = visiveis.filter((l) => l.etapa === "ganho").length;

  return (
    <>
      <PageHeader
        title="Pipeline"
        subtitle="Funil de leads — arraste entre as etapas"
        icon={KanbanSquare}
        actions={isManager ? (
          <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
            {(["meus", "todos"] as const).map((e) => (
              <button key={e} onClick={() => setEscopo(e)}
                className={`text-xs font-bold px-3 py-1.5 rounded-lg ${escopo === e ? "bg-white shadow text-brand-600" : "text-slate-500"}`}>
                {e === "meus" ? "Meus leads" : "Equipe"}
              </button>
            ))}
          </div>
        ) : undefined}
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <KpiCard label="Potencial no Funil" value={brlShort(potencial)} icon={DollarSign} accent="brand" />
        <KpiCard label="Leads Ativos" value={String(visiveis.length)} icon={User} accent="sky" />
        <KpiCard label="Fechados" value={String(fechados)} icon={CheckCircle2} accent="success" />
      </div>

      {loading ? (
        <Card><p className="text-muted text-sm">Carregando funil...</p></Card>
      ) : ativos.length === 0 ? (
        <Card pad={false}>
          <div className="text-center py-14 px-6">
            <span className="w-14 h-14 rounded-2xl bg-brand-50 text-brand-400 grid place-items-center mx-auto mb-4"><Inbox size={26} /></span>
            <p className="font-bold text-ink">Nenhum lead em atendimento</p>
            <p className="text-sm text-muted mt-1 max-w-md mx-auto">Pegue leads no <strong>Bolsão</strong> pra começar a trabalhá-los aqui no funil.</p>
          </div>
        </Card>
      ) : (
        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
          <div className="flex gap-4 overflow-x-auto pb-4">
            {STAGES.map((s) => (
              <Column key={s.id} stage={s} leads={visiveis.filter((l) => (l.etapa ?? "novos") === s.id)} onContato={onContato} />
            ))}
          </div>
        </DndContext>
      )}

      {vendaLead && (
        <RegistrarVendaModal
          lead={vendaLead}
          onClose={() => setVendaLead(null)}
          onSaved={() => setVendaLead(null)}
        />
      )}
    </>
  );
}

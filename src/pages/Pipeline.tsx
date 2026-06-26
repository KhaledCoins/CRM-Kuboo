import { useEffect, useMemo, useState } from "react";
import {
  DndContext, useDraggable, useDroppable, PointerSensor, useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core";
import { KanbanSquare, Phone, MessageCircle, User, Clock, DollarSign, CheckCircle2, AlertTriangle, Inbox } from "lucide-react";
import { PageHeader, Button, KpiCard, Card } from "../components/ui";
import { fetchLeads, moverEtapa, registrarContato, noBolsao, slaRestanteMin, moduloDe, type Lead } from "../lib/leads";
import { useAuth } from "../context/AuthContext";
import { brl, brlShort, onlyDigits } from "../lib/format";
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
        <p className="font-bold text-ink text-sm">{lead.nome}</p>
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
            <CheckCircle2 size={12} /> Registrar contato
          </button>
        )}
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

export function Pipeline({ modulo = "seguros", renovacoes = false }: { modulo?: Modulo; renovacoes?: boolean }) {
  const { user, isManager } = useAuth();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [escopo, setEscopo] = useState<"meus" | "todos">("meus");
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
    if (!to) return;
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, etapa: to } : l)));
    await moverEtapa(id, to);
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
        title={renovacoes ? "Pipeline (Renovações)" : "Pipeline (Novos)"}
        subtitle={renovacoes ? "Funil de retenção — apólices a vencer" : "Funil de novos leads — arraste entre as etapas"}
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
    </>
  );
}

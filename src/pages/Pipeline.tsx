import { useEffect, useState } from "react";
import {
  DndContext, useDraggable, useDroppable, PointerSensor, useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core";
import { KanbanSquare, Plus, Phone, MessageCircle, User, Clock, DollarSign } from "lucide-react";
import { PageHeader, Button, KpiCard, Card } from "../components/ui";
import { supabase } from "../lib/supabase";
import { brl, brlShort, onlyDigits } from "../lib/format";
import type { Modulo } from "../lib/nav";

interface Lead {
  id: string;
  nome: string;
  telefone?: string | null;
  produto_interesse?: string | null;
  valor_potencial?: number | null;
  responsavel?: string | null;
  etapa?: string | null;
  proxima_acao?: string | null;
}

const STAGES = [
  { id: "novos", label: "Novos Leads", color: "#1873BA" },
  { id: "contato", label: "Tentativa de Contato", color: "#36ABE2" },
  { id: "cotacao", label: "Cotação Enviada", color: "#5BC4F5" },
  { id: "negociacao", label: "Em Negociação", color: "#F59E0B" },
  { id: "ganho", label: "Venda Fechada", color: "#16A34A" },
  { id: "perdido", label: "Arquivado / Perdido", color: "#94A3B8" },
];

function LeadCard({ lead }: { lead: Lead }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: lead.id });
  const style = transform ? { transform: `translate(${transform.x}px, ${transform.y}px)` } : undefined;
  const wa = lead.telefone ? `https://wa.me/55${onlyDigits(lead.telefone)}` : null;
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={`bg-white rounded-xl border border-slate-200 p-3 mb-2.5 cursor-grab active:cursor-grabbing shadow-sm ${isDragging ? "opacity-50 ring-2 ring-brand-300" : ""}`}
    >
      <p className="font-bold text-ink text-sm mb-1.5">{lead.nome}</p>
      {lead.telefone && (
        <div className="flex items-center justify-between text-xs text-muted mb-1.5">
          <span className="flex items-center gap-1"><Phone size={12} /> {lead.telefone}</span>
          {wa && (
            <a href={wa} target="_blank" rel="noreferrer" onPointerDown={(e) => e.stopPropagation()} className="text-[#25d366]">
              <MessageCircle size={15} />
            </a>
          )}
        </div>
      )}
      <div className="flex items-center justify-between gap-2">
        {lead.produto_interesse && <span className="text-[11px] font-bold text-brand-700 bg-brand-50 px-2 py-0.5 rounded-md">{lead.produto_interesse}</span>}
        {lead.valor_potencial ? <span className="text-xs font-bold text-ink">{brl(lead.valor_potencial)}</span> : null}
      </div>
      {lead.responsavel && <p className="text-[11px] text-muted mt-1.5 flex items-center gap-1"><User size={11} /> {lead.responsavel}</p>}
      {lead.proxima_acao && <p className="text-[11px] text-amber-600 mt-1 flex items-center gap-1"><Clock size={11} /> {lead.proxima_acao}</p>}
    </div>
  );
}

function Column({ stage, leads }: { stage: typeof STAGES[number]; leads: Lead[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  const total = leads.reduce((s, l) => s + (l.valor_potencial ?? 0), 0);
  return (
    <div className="w-[280px] shrink-0">
      <div className="flex items-center justify-between mb-2 px-1">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: stage.color }} />
          <h3 className="text-sm text-ink font-bold tracking-normal" style={{ fontFamily: "var(--font-sans)" }}>{stage.label}</h3>
          <span className="text-xs bg-slate-100 text-slate-500 rounded-full px-1.5 font-bold">{leads.length}</span>
        </div>
      </div>
      <div className="text-[11px] text-muted px-1 mb-2">{brlShort(total)}</div>
      <div ref={setNodeRef} className={`min-h-[120px] rounded-xl p-2 transition-colors ${isOver ? "bg-brand-50" : "bg-slate-100/60"}`}>
        {leads.map((l) => <LeadCard key={l.id} lead={l} />)}
      </div>
    </div>
  );
}

export function Pipeline({ modulo = "seguros", renovacoes = false }: { modulo?: Modulo; renovacoes?: boolean }) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  useEffect(() => {
    (async () => {
      if (!supabase) { setLoading(false); return; }
      const { data } = await supabase.from("leads").select("*").order("created_at", { ascending: false }).limit(500);
      setLeads((data as any) ?? []);
      setLoading(false);
    })();
  }, []);

  const stageOf = (l: Lead) => l.etapa ?? "novos";

  async function onDragEnd(e: DragEndEvent) {
    const id = String(e.active.id);
    const to = e.over?.id ? String(e.over.id) : null;
    if (!to) return;
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, etapa: to } : l)));
    if (supabase) await supabase.from("leads").update({ etapa: to }).eq("id", id).then(() => {}, () => {});
  }

  const potencialTotal = leads.reduce((s, l) => s + (l.valor_potencial ?? 0), 0);

  return (
    <>
      <PageHeader
        title={renovacoes ? "Pipeline (Renovações)" : "Pipeline (Novos)"}
        subtitle={renovacoes ? "Funil de retenção — apólices a vencer" : "Funil de novos leads — captação"}
        icon={KanbanSquare}
        actions={<Button icon={Plus}>Novo Lead</Button>}
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <KpiCard label="Potencial Total" value={brlShort(potencialTotal)} icon={DollarSign} accent="brand" />
        <KpiCard label="Leads no Funil" value={String(leads.length)} icon={KanbanSquare} accent="success" />
        <KpiCard label="Tempo Médio Resp." value="—" hint="Disponível com histórico" icon={Clock} accent="sky" />
      </div>

      {loading ? (
        <Card><p className="text-muted text-sm">Carregando funil...</p></Card>
      ) : (
        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
          <div className="flex gap-4 overflow-x-auto pb-4">
            {STAGES.map((s) => (
              <Column key={s.id} stage={s} leads={leads.filter((l) => stageOf(l) === s.id)} />
            ))}
          </div>
        </DndContext>
      )}
    </>
  );
}

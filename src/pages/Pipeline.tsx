import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  DndContext, useDraggable, useDroppable, PointerSensor, KeyboardSensor, useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core";
import { KanbanSquare, MessageCircle, User, Clock, DollarSign, CheckCircle2, AlertTriangle, Inbox, ListPlus, X, Archive } from "lucide-react";
import { toast } from "sonner";
import { PageHeader, Button, KpiCard, Card, Spinner } from "../components/ui";
import { ModalShell } from "../components/ModalShell";
import { RegistrarVendaModal } from "../components/RegistrarVendaModal";
import { criarColumnKeyboardCoordinateGetter } from "../lib/dndKeyboard";
import { fetchLeads, moverEtapa, registrarContato, descartarLead, noBolsao, slaRestanteMin, moduloDe, temperaturaLead, type Lead } from "../lib/leads";
import { listar, type MotivoArquivamento } from "../lib/c2s";

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
  // "Perdido" NÃO é coluna: todo perdido vira arquivado (descartado) no mesmo
  // fluxo, então a coluna vivia permanentemente vazia ocupando 270px do quadro.
  // O drop para perder continua existindo — na ZonaPerdido, abaixo do funil.
];
// Coordenadas de teclado do funil: seta esquerda/direita pula de coluna
// (ordem fixa, definida uma vez fora do componente).
const stageKeyboardCoordinateGetter = criarColumnKeyboardCoordinateGetter(STAGES.map((s) => s.id));

// campanha/fonte/canal vêm da c2s-parity.sql (fetchLeads faz select *) — o card
// do C2S mostra tudo isso e o gestor precisa saber de quem é cada card na visão Equipe.
interface LeadPipe extends Lead {
  campanha?: string | null;
  fonte?: string | null;
  canal?: string | null;
}
// Atividade atual do lead (pendente mais próxima) — atrasada = vermelho, como no C2S.
interface AtivAtual { titulo: string; quando: string; atrasada: boolean }

// Colunas "fora do funil" (dossiê: Fechado/Arquivado ficam fora): mostramos só a
// janela recente pra não acumular pra sempre — e elas não contam no potencial.
const FORA_DO_FUNIL = new Set(["ganho", "perdido"]);
const JANELA_FECHADOS_DIAS = 30;

function SlaBadge({ lead }: { lead: Lead }) {
  if (lead.primeiro_contato_em) return <span className="text-[10px] font-bold text-green-600 flex items-center gap-0.5"><CheckCircle2 size={11} /> contatado</span>;
  const min = slaRestanteMin(lead);
  if (min === null) return null;
  if (min < 0) return <span className="text-[10px] font-bold text-red-600 flex items-center gap-0.5"><AlertTriangle size={11} /> SLA estourado</span>;
  return <span className="text-[10px] font-bold text-amber-600 flex items-center gap-0.5"><Clock size={11} /> {min} min</span>;
}

function LeadCard({ lead, consultor, ativ, onContato, onAbrir }: {
  lead: LeadPipe; consultor?: string; ativ?: AtivAtual; onContato: (id: string) => void; onAbrir: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: lead.id });
  const style = transform ? { transform: `translate(${transform.x}px, ${transform.y}px)`, zIndex: 50 } : undefined;
  const wa = lead.telefone ? `https://wa.me/55${onlyDigits(lead.telefone)}` : null;
  const fonteCanal = [lead.fonte, lead.canal].filter(Boolean).join(" · ");
  return (
    <div ref={setNodeRef} style={style} {...listeners} {...attributes}
      className={`bg-white rounded-xl border border-slate-200 p-3 mb-2.5 cursor-grab active:cursor-grabbing shadow-sm ${isDragging ? "opacity-60 ring-2 ring-brand-300" : ""}`}>
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => onAbrir(lead.id)}
          title="Abrir detalhe do lead"
          className="font-bold text-ink text-sm flex items-center gap-1.5 text-left hover:text-brand-600 hover:underline underline-offset-2"
        >
          <span title={`Lead ${temperaturaLead(lead)}`} style={{ width: 8, height: 8, borderRadius: 999, background: TEMP_DOT[temperaturaLead(lead)], flexShrink: 0, boxShadow: `0 0 0 2px ${TEMP_DOT[temperaturaLead(lead)]}22` }} />
          {lead.nome}
        </button>
        <SlaBadge lead={lead} />
      </div>
      <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
        {lead.produto_interesse && <span className="text-[11px] font-bold text-brand-700 bg-brand-50 px-2 py-0.5 rounded-md">{lead.produto_interesse}</span>}
        {lead.valor_potencial ? <span className="text-xs font-bold text-ink">{brl(lead.valor_potencial)}</span> : null}
      </div>
      {(lead.campanha || fonteCanal) && (
        <p className="text-[10px] text-muted mb-1 truncate" title={[lead.campanha, fonteCanal].filter(Boolean).join(" — ")}>
          {[lead.campanha, fonteCanal].filter(Boolean).join(" — ")}
        </p>
      )}
      {ativ && (
        <p className={`text-[10px] font-bold mb-1 flex items-center gap-1 ${ativ.atrasada ? "text-red-600" : "text-brand-600"}`}>
          {ativ.atrasada ? <AlertTriangle size={10} /> : <Clock size={10} />}
          <span className="truncate">{ativ.titulo} · {new Date(ativ.quando).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
        </p>
      )}
      {consultor && (
        <p className="text-[10px] text-muted mb-1.5 flex items-center gap-1"><User size={10} /> {consultor}</p>
      )}
      <div className="flex items-center gap-1.5" onPointerDown={(e) => e.stopPropagation()}>
        {wa && <a href={wa} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[11px] font-bold text-[#25d366] bg-green-50 px-2 py-1 rounded-lg"><MessageCircle size={12} /> WhatsApp</a>}
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

function Column({ stage, leads, pessoas, ativs, mostrarConsultor, onContato, onAbrir }: {
  stage: typeof STAGES[number]; leads: LeadPipe[];
  pessoas: Record<string, string>; ativs: Record<string, AtivAtual>; mostrarConsultor: boolean;
  onContato: (id: string) => void; onAbrir: (id: string) => void;
}) {
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
      <div className="text-[11px] text-muted px-1 mb-2">
        {brlShort(total)}{FORA_DO_FUNIL.has(stage.id) ? ` · últimos ${JANELA_FECHADOS_DIAS}d` : ""}
      </div>
      <div ref={setNodeRef} className={`min-h-[140px] rounded-xl p-2 transition-colors ${isOver ? "bg-brand-50" : "bg-slate-100/60"}`}>
        {leads.map((l) => (
          <LeadCard key={l.id} lead={l} ativ={ativs[l.id]}
            consultor={mostrarConsultor && l.vendedor_id ? pessoas[l.vendedor_id] : undefined}
            onContato={onContato} onAbrir={onAbrir} />
        ))}
      </div>
    </div>
  );
}

// ─── Zona de descarte: arrastar aqui = perdido (pede motivo) ─────────────────
// Substitui a antiga coluna "Perdido", que ficava sempre vazia porque perder um
// lead o arquiva (descartado) e ele sai do funil. Fica abaixo do kanban, discreta,
// e só acende quando um card está sendo arrastado por cima.
function ZonaPerdido() {
  const { setNodeRef, isOver } = useDroppable({ id: "perdido" });
  return (
    <div ref={setNodeRef}
      className={`mt-1 mb-4 rounded-xl border-2 border-dashed px-4 py-3 flex items-center justify-center gap-2 text-sm font-bold transition-colors ${
        isOver ? "border-red-400 bg-red-50 text-red-700" : "border-slate-200 text-slate-400"
      }`}>
      <Archive size={16} />
      {isOver ? "Solte para arquivar como perdido" : "Arraste um lead aqui para marcar como perdido"}
    </div>
  );
}

// ─── Modal: motivo do "Perdido" (todo arquivamento passa por motivo — C2S) ────
function ModalPerdido({ lead, motivos, onConfirm, onCancel }: {
  lead: Lead; motivos: MotivoArquivamento[]; onConfirm: (motivo: string) => void; onCancel: () => void;
}) {
  const [motivo, setMotivo] = useState("");
  return (
    <ModalShell onClose={onCancel} label="Motivo da perda"
      backdropClassName="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold text-ink flex items-center gap-2"><Archive size={17} className="text-red-500" /> Por que perdemos?</h3>
        <button onClick={onCancel} aria-label="Fechar" className="text-slate-400 hover:text-slate-600 p-1"><X size={18} /></button>
      </div>
      <p className="text-xs text-muted mb-3">{lead.nome} sai do funil e vai pros arquivados com o motivo escolhido.</p>
      <select className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-ink outline-none focus:border-brand-400"
        value={motivo} onChange={(e) => setMotivo(e.target.value)} autoFocus>
        <option value="">Selecione um motivo…</option>
        {motivos.map((m) => <option key={m.id} value={m.nome}>{m.nome}</option>)}
      </select>
      <div className="flex gap-2 justify-end mt-4">
        <Button variant="ghost" onClick={onCancel}>Cancelar</Button>
        <Button variant="danger" disabled={!motivo} onClick={() => onConfirm(motivo)}>Arquivar como perdido</Button>
      </div>
    </ModalShell>
  );
}

export function Pipeline({ modulo = "seguros" }: { modulo?: Modulo }) {
  const navigate = useNavigate();
  const { user, isManager } = useAuth();
  const [leads, setLeads] = useState<LeadPipe[]>([]);
  const [loading, setLoading] = useState(true);
  // "meus" | "todos" | id de um consultor específico ("Ver como" do C2S)
  const [escopo, setEscopo] = useState<string>("meus");
  const [vendaLead, setVendaLead] = useState<Lead | null>(null); // lead recém-fechado → modal de venda
  const [perdidoPend, setPerdidoPend] = useState<{ lead: Lead; anterior: string } | null>(null);
  const [pessoas, setPessoas] = useState<Record<string, string>>({});
  const [ativs, setAtivs] = useState<Record<string, AtivAtual>>({});
  const [motivos, setMotivos] = useState<MotivoArquivamento[]>([]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: stageKeyboardCoordinateGetter }),
  );

  useEffect(() => {
    (async () => {
      const [ls, mots] = await Promise.all([fetchLeads(), listar<MotivoArquivamento>("motivos_arquivamento", "nome")]);
      setLeads(ls as LeadPipe[]);
      setMotivos(mots.filter((m) => m.ativo));
      if (supabase) {
        // Nomes da equipe (consultor no card, dono da venda, "Ver como")
        const { data: perfis } = await supabase.from("profiles").select("id,name")
          .in("role", ["admin", "gestor", "vendedor"]).order("name");
        const mapa: Record<string, string> = {};
        (perfis || []).forEach((p: any) => { mapa[p.id] = p.name; });
        setPessoas(mapa);
        // Atividade atual (pendente mais próxima) por lead — em lote, 1 query
        const { data: pend } = await supabase.from("lead_atividades")
          .select("lead_id, titulo, quando").eq("status", "pendente").order("quando").limit(2000);
        const porLead: Record<string, AtivAtual> = {};
        const agora = Date.now();
        (pend || []).forEach((a: any) => {
          if (!porLead[a.lead_id]) porLead[a.lead_id] = { titulo: a.titulo, quando: a.quando, atrasada: new Date(a.quando).getTime() < agora };
        });
        setAtivs(porLead);
      }
      setLoading(false);
    })();
  }, []);

  // Pipeline = leads COM dono e fora do bolsão (em atendimento), exceto os descartados
  // (lead arquivado não pode ficar preso pra sempre numa coluna do kanban).
  // Ganho/Perdido só aparecem na janela recente — no C2S ficam fora do funil.
  const corteFechados = useMemo(() => Date.now() - JANELA_FECHADOS_DIAS * 24 * 60 * 60 * 1000, []);
  const ativos = useMemo(() => leads.filter((l) => {
    if (moduloDe(l) !== modulo || noBolsao(l) || l.descartado) return false;
    if (FORA_DO_FUNIL.has(l.etapa ?? "")) {
      const ref = l.interagido_em ?? l.created_at;
      return !!ref && new Date(ref).getTime() >= corteFechados;
    }
    return true;
  }), [leads, modulo, corteFechados]);
  const visiveis = useMemo(() => {
    if (escopo === "todos") return ativos;
    if (escopo === "meus") return user ? ativos.filter((l) => l.vendedor_id === user.id) : ativos;
    return ativos.filter((l) => l.vendedor_id === escopo); // "Ver como" consultor específico
  }, [ativos, escopo, user]);

  async function onDragEnd(e: DragEndEvent) {
    const id = String(e.active.id);
    const to = e.over?.id ? String(e.over.id) : null;
    const atual = leads.find((l) => l.id === id);
    if (!to || !atual || (atual.etapa ?? "novos") === to) return; // drop fora ou mesma coluna
    const anterior = atual.etapa ?? "novos";
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, etapa: to } : l)));
    // Perdido exige MOTIVO (C2S: todo arquivamento tem motivo) — confirma no modal
    // antes de gravar; cancelar devolve o card pra coluna de origem.
    if (to === "perdido") { setPerdidoPend({ lead: atual, anterior }); return; }
    try {
      await moverEtapa(id, to);
      // fechou o negócio → oferece registrar a venda na hora (parcelas + comissão automáticas)
      if (to === "ganho") setVendaLead(atual);
    } catch {
      setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, etapa: anterior } : l)));
    }
  }

  async function confirmarPerdido(motivo: string) {
    if (!perdidoPend) return;
    const { lead } = perdidoPend;
    setPerdidoPend(null);
    try {
      await moverEtapa(lead.id, "perdido");
      const ok = await descartarLead(lead.id, motivo);
      if (!ok) throw new Error("descartar falhou");
      setLeads((prev) => prev.map((l) => (l.id === lead.id ? { ...l, etapa: "perdido", descartado: true, motivo_descarte: motivo } : l)));
      toast.success("Lead arquivado como perdido.");
    } catch {
      setLeads((prev) => prev.map((l) => (l.id === lead.id ? { ...l, etapa: perdidoPend.anterior } : l)));
      toast.error("Não foi possível arquivar o lead.");
    }
  }

  function cancelarPerdido() {
    if (!perdidoPend) return;
    const { lead, anterior } = perdidoPend;
    setLeads((prev) => prev.map((l) => (l.id === lead.id ? { ...l, etapa: anterior } : l)));
    setPerdidoPend(null);
  }

  async function onContato(id: string) {
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, primeiro_contato_em: new Date().toISOString() } : l)));
    // Não gravou? DESFAZ o card. Deixá-lo marcado é pior do que não marcar: o
    // SLA continua correndo no servidor e o lead volta pro bolsão com o
    // consultor achando que já atendeu.
    const ok = await registrarContato(id);
    if (!ok) {
      setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, primeiro_contato_em: null } : l)));
      toast.error("Não consegui registrar o contato. O SLA continua correndo — tente de novo.");
    }
  }

  function onAbrir(id: string) {
    navigate(`/${modulo}/leads/${id}`);
  }

  // Potencial = só o que ainda está EM ABERTO no funil (contar ganho/perdido
  // inflava o número reportado ao gestor com negócio já resolvido).
  const potencial = visiveis.filter((l) => !FORA_DO_FUNIL.has(l.etapa ?? "")).reduce((s, l) => s + (l.valor_potencial ?? 0), 0);
  const fechados = visiveis.filter((l) => l.etapa === "ganho").length;

  return (
    <>
      <PageHeader
        title="Pipeline"
        subtitle="Funil de leads — arraste entre as etapas"
        icon={KanbanSquare}
        actions={isManager ? (
          <select
            value={escopo} onChange={(e) => setEscopo(e.target.value)}
            aria-label="Ver funil como"
            className="bg-slate-100 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-ink outline-none focus:border-brand-400"
          >
            <option value="meus">Meus leads</option>
            <option value="todos">Equipe (todos)</option>
            {Object.entries(pessoas).filter(([pid]) => pid !== user?.id).map(([pid, nome]) => (
              <option key={pid} value={pid}>{nome}</option>
            ))}
          </select>
        ) : undefined}
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <KpiCard label="Potencial no Funil" value={brlShort(potencial)} hint="Só etapas em aberto" icon={DollarSign} accent="brand" />
        <KpiCard label="Leads Ativos" value={String(visiveis.filter((l) => !FORA_DO_FUNIL.has(l.etapa ?? "")).length)} icon={User} accent="sky" />
        <KpiCard label="Fechados" value={String(fechados)} hint={`Últimos ${JANELA_FECHADOS_DIAS} dias`} icon={CheckCircle2} accent="success" />
      </div>

      {loading ? (
        <Spinner label="Carregando funil..." />
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
              <Column key={s.id} stage={s} leads={visiveis.filter((l) => (l.etapa ?? "novos") === s.id)}
                pessoas={pessoas} ativs={ativs} mostrarConsultor={escopo !== "meus"}
                onContato={onContato} onAbrir={onAbrir} />
            ))}
          </div>
          <ZonaPerdido />
        </DndContext>
      )}

      {vendaLead && (
        <RegistrarVendaModal
          lead={vendaLead}
          pessoas={pessoas}
          onClose={() => setVendaLead(null)}
          onSaved={() => setVendaLead(null)}
        />
      )}
      {perdidoPend && (
        <ModalPerdido lead={perdidoPend.lead} motivos={motivos} onConfirm={confirmarPerdido} onCancel={cancelarPerdido} />
      )}
    </>
  );
}

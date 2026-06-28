import { useEffect, useMemo, useState } from "react";
import { DndContext, useDraggable, useDroppable, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { KanbanSquare, Plus, Trash2, User, Calendar, Flag, X, ListChecks, Loader2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader, Button, KpiCard, Card } from "../components/ui";
import { fetchTarefas, criarTarefa, moverTarefa, excluirTarefa, type Tarefa } from "../lib/tarefas";
import { useAuth } from "../context/AuthContext";
import { dateBR } from "../lib/format";
import type { Modulo } from "../lib/nav";

const COLS = [
  { id: "a_fazer", label: "A fazer", color: "#94A3B8" },
  { id: "fazendo", label: "Fazendo", color: "#F59E0B" },
  { id: "concluido", label: "Concluído", color: "#16A34A" },
] as const;

const prioTone: Record<string, string> = { alta: "bg-red-100 text-red-700", media: "bg-amber-100 text-amber-700", baixa: "bg-slate-100 text-slate-600" };
const inputCls = "w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none text-ink focus:border-brand-400";

function TarefaCard({ t, onDelete }: { t: Tarefa; onDelete: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: t.id });
  const style = transform ? { transform: `translate(${transform.x}px, ${transform.y}px)`, zIndex: 50 } : undefined;
  return (
    <div ref={setNodeRef} style={style} {...listeners} {...attributes}
      className={`bg-white rounded-xl border border-slate-200 p-3 mb-2.5 cursor-grab active:cursor-grabbing shadow-sm ${isDragging ? "opacity-60 ring-2 ring-brand-300" : ""}`}>
      <div className="flex items-start justify-between gap-2 mb-1">
        <p className="font-bold text-ink text-sm leading-snug">{t.titulo}</p>
        <button onClick={() => onDelete(t.id)} onPointerDown={(e) => e.stopPropagation()} className="text-slate-300 hover:text-red-500 shrink-0"><Trash2 size={14} /></button>
      </div>
      {t.descricao && <p className="text-xs text-muted mb-2 leading-snug">{t.descricao}</p>}
      <div className="flex flex-wrap items-center gap-1.5">
        {t.prioridade && <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md flex items-center gap-1 ${prioTone[t.prioridade]}`}><Flag size={10} /> {t.prioridade}</span>}
        {t.cliente_nome && <span className="text-[10px] font-bold text-brand-700 bg-brand-50 px-2 py-0.5 rounded-md">{t.cliente_nome}</span>}
      </div>
      {(t.responsavel_nome || t.vencimento) && (
        <div className="flex items-center gap-3 mt-2 text-[11px] text-muted">
          {t.responsavel_nome && <span className="flex items-center gap-1"><User size={11} /> {t.responsavel_nome}</span>}
          {t.vencimento && <span className="flex items-center gap-1"><Calendar size={11} /> {dateBR(t.vencimento)}</span>}
        </div>
      )}
    </div>
  );
}

function Coluna({ col, tarefas, onDelete }: { col: typeof COLS[number]; tarefas: Tarefa[]; onDelete: (id: string) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: col.id });
  return (
    <div className="w-[290px] shrink-0">
      <div className="flex items-center gap-2 mb-2 px-1">
        <span className="w-2.5 h-2.5 rounded-full" style={{ background: col.color }} />
        <h3 className="text-sm text-ink font-bold">{col.label}</h3>
        <span className="text-xs bg-slate-100 text-slate-500 rounded-full px-1.5 font-bold">{tarefas.length}</span>
      </div>
      <div ref={setNodeRef} className={`min-h-[180px] rounded-xl p-2 transition-colors ${isOver ? "bg-brand-50" : "bg-slate-100/60"}`}>
        {tarefas.map((t) => <TarefaCard key={t.id} t={t} onDelete={onDelete} />)}
      </div>
    </div>
  );
}

export function Tarefas({ modulo = "seguros" }: { modulo?: Modulo }) {
  const { user } = useAuth();
  const [tarefas, setTarefas] = useState<Tarefa[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Partial<Tarefa>>({ status: "a_fazer", prioridade: "media", modulo });
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  async function load() {
    setLoading(true);
    const { data, error } = await fetchTarefas();
    setTarefas(data.filter((t) => !t.modulo || t.modulo === modulo)); setErro(error); setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [modulo]);

  async function onDragEnd(e: DragEndEvent) {
    const id = String(e.active.id);
    const to = e.over?.id ? String(e.over.id) as Tarefa["status"] : null;
    if (!to) return;
    setTarefas((prev) => prev.map((t) => (t.id === id ? { ...t, status: to } : t)));
    await moverTarefa(id, to);
  }

  async function onDelete(id: string) {
    setTarefas((prev) => prev.filter((t) => t.id !== id));
    await excluirTarefa(id);
    toast.success("Tarefa removida");
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!form.titulo) return;
    setSaving(true);
    const { error } = await criarTarefa({ ...form, modulo, responsavel_nome: form.responsavel_nome || user?.name });
    setSaving(false);
    if (error) { toast.error("Não foi possível salvar: " + error); return; }
    toast.success("Tarefa criada!");
    setShowForm(false); setForm({ status: "a_fazer", prioridade: "media", modulo });
    load();
  }

  const porCol = useMemo(() => (id: string) => tarefas.filter((t) => t.status === id), [tarefas]);
  const concluidas = tarefas.filter((t) => t.status === "concluido").length;

  return (
    <>
      <PageHeader title="Tarefas & Atividades" subtitle="Quadro da equipe — arraste os cartões entre as colunas" icon={KanbanSquare}
        actions={<Button icon={Plus} onClick={() => setShowForm(true)}>Nova Tarefa</Button>} />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <KpiCard label="Total de Tarefas" value={String(tarefas.length)} icon={ListChecks} accent="brand" />
        <KpiCard label="Em andamento" value={String(porCol("fazendo").length)} icon={Loader2} accent="warning" />
        <KpiCard label="Concluídas" value={String(concluidas)} icon={CheckCircle2} accent="success" />
      </div>

      {erro ? (
        <Card>
          <p className="font-bold text-ink mb-1">Quadro de Tarefas quase pronto</p>
          <p className="text-sm text-muted">Rode a migração <code className="bg-slate-100 px-1 rounded">supabase/crm-tarefas.sql</code> no Supabase para ativar o quadro. Depois é só recarregar.</p>
        </Card>
      ) : loading ? (
        <Card><p className="text-muted text-sm">Carregando quadro…</p></Card>
      ) : (
        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
          <div className="flex gap-4 overflow-x-auto pb-4">
            {COLS.map((c) => <Coluna key={c.id} col={c} tarefas={porCol(c.id)} onDelete={onDelete} />)}
          </div>
        </DndContext>
      )}

      {showForm && (
        <div onClick={() => setShowForm(false)} className="fixed inset-0 bg-slate-900/45 backdrop-blur-sm grid place-items-center z-50 p-4">
          <form onClick={(e) => e.stopPropagation()} onSubmit={salvar} className="bg-white rounded-2xl shadow-2xl w-[min(460px,94vw)]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <h3 className="font-extrabold text-ink text-lg">Nova Tarefa</h3>
              <button type="button" onClick={() => setShowForm(false)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
            </div>
            <div className="p-6 grid gap-4">
              <label className="block"><span className="text-xs font-bold text-muted uppercase tracking-wide block mb-1.5">Título *</span>
                <input className={inputCls} required value={form.titulo || ""} onChange={(e) => setForm((p) => ({ ...p, titulo: e.target.value }))} placeholder="Ex: Ligar para o cliente sobre renovação" /></label>
              <label className="block"><span className="text-xs font-bold text-muted uppercase tracking-wide block mb-1.5">Descrição</span>
                <textarea className={inputCls} rows={2} value={form.descricao || ""} onChange={(e) => setForm((p) => ({ ...p, descricao: e.target.value }))} /></label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block"><span className="text-xs font-bold text-muted uppercase tracking-wide block mb-1.5">Prioridade</span>
                  <select className={inputCls} value={form.prioridade || "media"} onChange={(e) => setForm((p) => ({ ...p, prioridade: e.target.value as Tarefa["prioridade"] }))}>
                    <option value="baixa">Baixa</option><option value="media">Média</option><option value="alta">Alta</option>
                  </select></label>
                <label className="block"><span className="text-xs font-bold text-muted uppercase tracking-wide block mb-1.5">Coluna</span>
                  <select className={inputCls} value={form.status || "a_fazer"} onChange={(e) => setForm((p) => ({ ...p, status: e.target.value as Tarefa["status"] }))}>
                    <option value="a_fazer">A fazer</option><option value="fazendo">Fazendo</option><option value="concluido">Concluído</option>
                  </select></label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block"><span className="text-xs font-bold text-muted uppercase tracking-wide block mb-1.5">Cliente</span>
                  <input className={inputCls} value={form.cliente_nome || ""} onChange={(e) => setForm((p) => ({ ...p, cliente_nome: e.target.value }))} /></label>
                <label className="block"><span className="text-xs font-bold text-muted uppercase tracking-wide block mb-1.5">Vencimento</span>
                  <input type="date" className={inputCls} value={form.vencimento || ""} onChange={(e) => setForm((p) => ({ ...p, vencimento: e.target.value }))} /></label>
              </div>
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-slate-100">
              <Button variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
              <Button type="submit" disabled={saving}>{saving ? "Salvando…" : "Criar tarefa"}</Button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

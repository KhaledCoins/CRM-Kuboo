import { useEffect, useMemo, useState } from "react";
import { Shuffle, Plus, Pencil, Trash2, ChevronUp, ChevronDown, ShieldCheck, Users, Clock, X, Info, AlertTriangle, Power } from "lucide-react";
import { toast } from "sonner";
import { PageHeader, Card, Button, Badge, EmptyState, Spinner } from "../../components/ui";
import { ModalShell } from "../../components/ModalShell";
import {
  atualizar, excluir, listarFilas, listarEquipe, listarTodosFilaUsuarios, salvarFila, sincronizarFilaUsuarios, trocarOrdemFilas,
  regrasResumoFila, horarioResumo, horaVazia, horarioPadrao, CAMPO_OPCOES, OP_ROTULOS, opsPermitidas, DIAS_SEMANA,
  type Fila, type FilaUsuario, type RegraFila, type HorarioSemana, type HorarioDia,
} from "../../lib/c2s";

// Clone do C2S /distribution_lines (ver docs/C2S-SCAN.md §Distribuição).

const inputCls = "w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none text-ink focus:border-brand-400 transition-colors";
const labelCls = "text-xs font-bold text-muted uppercase tracking-wide block mb-1.5";

interface EquipeMembro { id: string; name: string; role: string | null }

function AvisoMigracao() {
  return (
    <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 flex items-start gap-2">
      <AlertTriangle size={16} className="mt-0.5 shrink-0" />
      <span>Rode a migration <code className="font-mono">supabase/c2s-parity.sql</code> no Supabase para ativar esta tela.</span>
    </div>
  );
}

function ToggleRow({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="flex items-center justify-between gap-3 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 cursor-pointer">
      <span>
        <span className="text-sm font-bold text-ink block">{label}</span>
        {hint && <span className="text-xs text-muted">{hint}</span>}
      </span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="w-4 h-4 accent-brand-500 shrink-0" />
    </label>
  );
}

export function Filas() {
  const [filas, setFilas] = useState<Fila[]>([]);
  const [equipe, setEquipe] = useState<EquipeMembro[]>([]);
  const [filaUsuarios, setFilaUsuarios] = useState<FilaUsuario[]>([]);
  const [loading, setLoading] = useState(true);
  const [erroMigracao, setErroMigracao] = useState(false);
  const [editando, setEditando] = useState<Fila | "novo" | null>(null);
  const [movendo, setMovendo] = useState<string | null>(null);

  async function carregar() {
    setLoading(true);
    const [filasR, eq, fu] = await Promise.all([listarFilas(), listarEquipe(), listarTodosFilaUsuarios()]);
    setFilas(filasR.data);
    setErroMigracao(filasR.erro);
    setEquipe(eq);
    setFilaUsuarios(fu);
    setLoading(false);
  }
  useEffect(() => { carregar(); }, []);

  const ordenadas = useMemo(() => [...filas].sort((a, b) => a.ordem - b.ordem), [filas]);

  const contagemAtivos = useMemo(() => {
    const m = new Map<string, number>();
    for (const fu of filaUsuarios) if (fu.ativo) m.set(fu.fila_id, (m.get(fu.fila_id) ?? 0) + 1);
    return m;
  }, [filaUsuarios]);

  async function mover(fila: Fila, direcao: -1 | 1) {
    const idx = ordenadas.findIndex((f) => f.id === fila.id);
    const alvo = ordenadas[idx + direcao];
    if (!alvo) return;
    setMovendo(fila.id);
    const ok = await trocarOrdemFilas(fila, alvo);
    setMovendo(null);
    if (ok) { toast.success("Prioridade atualizada."); carregar(); }
    else toast.error("Não foi possível reordenar.");
  }

  async function alternarAtiva(fila: Fila) {
    const ok = await atualizar("filas", fila.id, { ativa: !fila.ativa });
    if (ok) { toast.success(fila.ativa ? "Fila desativada." : "Fila ativada."); setFilas((p) => p.map((f) => (f.id === fila.id ? { ...f, ativa: !f.ativa } : f))); }
    else toast.error("Não foi possível atualizar a fila.");
  }

  async function excluirFila(fila: Fila) {
    if (!window.confirm(`Excluir a fila "${fila.nome}"? Esta ação não pode ser desfeita.`)) return;
    const ok = await excluir("filas", fila.id);
    if (ok) { toast.success("Fila excluída."); setFilas((p) => p.filter((f) => f.id !== fila.id)); }
    else toast.error("Não foi possível excluir a fila.");
  }

  return (
    <>
      <PageHeader
        title="Distribuição de Leads"
        subtitle="Filas ordenadas por prioridade — regras, memória, rodízio e fila de segurança"
        icon={Shuffle}
        actions={<Button icon={Plus} onClick={() => setEditando("novo")} disabled={erroMigracao}>Adicionar fila</Button>}
      />

      {erroMigracao && <AvisoMigracao />}

      {!erroMigracao && (
        loading ? (
          <Card><Spinner label="Carregando filas..." /></Card>
        ) : ordenadas.length === 0 ? (
          <Card>
            <EmptyState icon={Shuffle} title="Nenhuma fila cadastrada" hint="Crie a primeira fila de distribuição para começar a rotear leads automaticamente."
              action={<Button icon={Plus} onClick={() => setEditando("novo")}>Adicionar fila</Button>} />
          </Card>
        ) : (
          <div className="space-y-3">
            {ordenadas.map((f, i) => {
              const ativos = contagemAtivos.get(f.id) ?? 0;
              return (
                <Card key={f.id} className={!f.ativa ? "opacity-60" : ""}>
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="flex flex-col items-center gap-0.5 shrink-0 pt-0.5">
                        <button disabled={i === 0 || movendo === f.id} onClick={() => mover(f, -1)} title="Subir prioridade" aria-label={`Subir prioridade de ${f.nome}`}
                          className="p-1 rounded-lg text-slate-400 hover:text-brand-600 hover:bg-brand-50 disabled:opacity-30 disabled:cursor-not-allowed">
                          <ChevronUp size={16} />
                        </button>
                        <span className="w-7 h-7 rounded-lg bg-brand-50 text-brand-600 grid place-items-center text-xs font-extrabold">{i + 1}</span>
                        <button disabled={i === ordenadas.length - 1 || movendo === f.id} onClick={() => mover(f, 1)} title="Descer prioridade" aria-label={`Descer prioridade de ${f.nome}`}
                          className="p-1 rounded-lg text-slate-400 hover:text-brand-600 hover:bg-brand-50 disabled:opacity-30 disabled:cursor-not-allowed">
                          <ChevronDown size={16} />
                        </button>
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-extrabold text-ink">{f.nome}</p>
                          {f.is_seguranca && <Badge tone="violet"><ShieldCheck size={11} /> Fila de segurança</Badge>}
                          {f.ativa ? <Badge tone="green">Ativa</Badge> : <Badge tone="slate">Inativa</Badge>}
                        </div>
                        <ul className="text-xs text-muted mt-1.5 space-y-0.5">
                          {regrasResumoFila(f).map((linha, idx) => <li key={idx}>{linha}</li>)}
                        </ul>
                        <div className="flex items-center gap-3 mt-2 text-xs text-muted flex-wrap">
                          <span className="inline-flex items-center gap-1"><Users size={12} /> {ativos} usuário{ativos !== 1 ? "s" : ""} ativo{ativos !== 1 ? "s" : ""}</span>
                          <span className="inline-flex items-center gap-1"><Clock size={12} /> {horarioResumo(f.horario)}</span>
                          {f.limite_abertos != null && <span>Limite: {f.limite_abertos} leads abertos/consultor</span>}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button onClick={() => setEditando(f)} title="Editar" aria-label={`Editar ${f.nome}`} className="p-2 rounded-lg text-slate-400 hover:text-brand-600 hover:bg-brand-50"><Pencil size={16} /></button>
                      <button onClick={() => alternarAtiva(f)} title={f.ativa ? "Desativar" : "Ativar"} aria-label={f.ativa ? `Desativar ${f.nome}` : `Ativar ${f.nome}`} className="p-2 rounded-lg text-slate-400 hover:text-brand-600 hover:bg-brand-50"><Power size={16} /></button>
                      <button onClick={() => excluirFila(f)} title="Excluir" aria-label={`Excluir ${f.nome}`} className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50"><Trash2 size={16} /></button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )
      )}

      <Card className="mt-6">
        <div className="flex items-start gap-2.5">
          <span className="w-8 h-8 rounded-lg bg-brand-50 text-brand-500 grid place-items-center shrink-0"><Info size={16} /></span>
          <div className="text-xs text-muted space-y-1">
            <p><b className="text-ink">Como funciona:</b> as filas são avaliadas na ordem de prioridade acima — a primeira fila ativa cujas regras casam com o lead o recebe.</p>
            <p>Filas com "dias de memória" tentam devolver o lead ao mesmo consultor que já o atendeu; as demais fazem rodízio entre os usuários ativos.</p>
            <p>Se nenhuma fila casar, o lead cai na fila de segurança (se houver) ou fica disponível no Bolsão. O motor roda automaticamente no banco a cada lead novo.</p>
          </div>
        </div>
      </Card>

      {editando && (
        <FilaEditor
          fila={editando === "novo" ? null : editando}
          equipe={equipe}
          filaUsuarios={editando === "novo" ? [] : filaUsuarios.filter((fu) => fu.fila_id === (editando as Fila).id)}
          proximaOrdem={filas.length ? Math.max(...filas.map((f) => f.ordem)) + 1 : 1}
          onClose={() => setEditando(null)}
          onSaved={() => { setEditando(null); carregar(); }}
        />
      )}
    </>
  );
}

function FilaEditor({ fila, equipe, filaUsuarios, proximaOrdem, onClose, onSaved }: {
  fila: Fila | null;
  equipe: EquipeMembro[];
  filaUsuarios: FilaUsuario[];
  proximaOrdem: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [nome, setNome] = useState(fila?.nome ?? "");
  const [ativa, setAtiva] = useState(fila?.ativa ?? true);
  const [isSeguranca, setIsSeguranca] = useState(fila?.is_seguranca ?? false);
  const [diasMemoria, setDiasMemoria] = useState<string>(fila?.dias_memoria != null ? String(fila.dias_memoria) : "");
  const [limiteAbertos, setLimiteAbertos] = useState<string>(fila?.limite_abertos != null ? String(fila.limite_abertos) : "");
  const [regras, setRegras] = useState<RegraFila[]>(fila?.regras ?? []);
  const [usarHorario, setUsarHorario] = useState<boolean>(!!fila?.horario);
  const [horario, setHorario] = useState<HorarioSemana>(fila?.horario ?? horarioPadrao());
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set(filaUsuarios.filter((fu) => fu.ativo).map((fu) => fu.user_id)));
  const [salvando, setSalvando] = useState(false);
  const ultimaPorUsuario = useMemo(() => new Map(filaUsuarios.map((fu) => [fu.user_id, fu.ultima_atribuicao])), [filaUsuarios]);

  function addRegra() { setRegras((p) => [...p, { campo: "origem", op: "igual", valor: "" }]); }
  function updRegra(i: number, patch: Partial<RegraFila>) {
    setRegras((p) => p.map((r, idx) => {
      if (idx !== i) return r;
      const novo = { ...r, ...patch };
      if (patch.campo && !opsPermitidas(patch.campo).includes(novo.op)) novo.op = opsPermitidas(patch.campo)[0];
      return novo;
    }));
  }
  function rmRegra(i: number) { setRegras((p) => p.filter((_, idx) => idx !== i)); }

  function toggleUsuario(id: string) {
    setSelecionados((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  function setDiaHorario(chave: keyof HorarioSemana, patch: Partial<HorarioDia>) {
    setHorario((p) => ({ ...p, [chave]: { ...(p[chave] ?? horaVazia()), ...patch } }));
  }

  async function salvar() {
    if (!nome.trim()) { toast.error("Dê um nome para a fila."); return; }
    setSalvando(true);
    const id = await salvarFila({
      id: fila?.id,
      nome: nome.trim(),
      ordem: fila?.ordem ?? proximaOrdem,
      ativa, is_seguranca: isSeguranca,
      dias_memoria: diasMemoria ? Number(diasMemoria) : null,
      limite_abertos: limiteAbertos ? Number(limiteAbertos) : null,
      regras, horario: usarHorario ? horario : null,
    });
    if (!id) { setSalvando(false); toast.error("Não foi possível salvar a fila."); return; }
    const okUsuarios = await sincronizarFilaUsuarios(id, selecionados, equipe.map((e) => e.id));
    setSalvando(false);
    if (!okUsuarios) { toast.error("Fila salva, mas houve erro ao atualizar os usuários."); onSaved(); return; }
    toast.success(fila ? "Fila atualizada." : "Fila criada.");
    onSaved();
  }

  return (
    <ModalShell onClose={onClose} label={fila ? `Editar fila — ${fila.nome}` : "Nova fila"} className="bg-white rounded-2xl shadow-2xl w-[min(720px,94vw)] max-h-[92vh] overflow-y-auto">
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 sticky top-0 bg-white z-10">
        <div className="flex items-center gap-2.5">
          <span className="w-9 h-9 rounded-xl bg-brand-50 text-brand-500 grid place-items-center shrink-0"><Shuffle size={18} /></span>
          <h3 className="font-extrabold text-ink text-lg">{fila ? "Editar fila" : "Nova fila"}</h3>
        </div>
        <button onClick={onClose} aria-label="Fechar" className="text-slate-500 hover:text-slate-700"><X size={20} /></button>
      </div>

      <div className="p-6 space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block sm:col-span-2">
            <span className={labelCls}>Nome da fila *</span>
            <input className={inputCls} value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Rodízio igualitário" />
          </label>
          <ToggleRow label="Fila ativa" checked={ativa} onChange={setAtiva} />
          <ToggleRow label="Fila de segurança (fallback)" checked={isSeguranca} onChange={setIsSeguranca} hint="Recebe o lead quando nenhuma outra fila atribuir" />
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <span className={`${labelCls} mb-0`}>Regras</span>
            <button type="button" onClick={addRegra} className="inline-flex items-center gap-1.5 text-xs font-bold text-brand-600 bg-brand-50 hover:bg-brand-100 px-2.5 py-1.5 rounded-lg transition-colors">
              <Plus size={13} /> Nova condição
            </button>
          </div>
          {regras.length === 0 ? (
            <p className="text-xs text-amber-700 bg-amber-50 rounded-xl px-3 py-2">Sem condição: qualquer lead pode ser distribuído nesta fila.</p>
          ) : (
            <div className="space-y-2">
              {regras.map((r, i) => (
                <div key={i} className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                  <select className={`${inputCls} sm:w-48`} value={r.campo} onChange={(e) => updRegra(i, { campo: e.target.value as RegraFila["campo"] })}>
                    {CAMPO_OPCOES.map((c) => <option key={c.valor} value={c.valor}>{c.rotulo}</option>)}
                  </select>
                  <select className={`${inputCls} sm:w-40`} value={r.op} onChange={(e) => updRegra(i, { op: e.target.value as RegraFila["op"] })}>
                    {opsPermitidas(r.campo).map((op) => <option key={op} value={op}>{OP_ROTULOS[op]}</option>)}
                  </select>
                  {r.campo === "modulo" ? (
                    <select className={inputCls} value={r.valor} onChange={(e) => updRegra(i, { valor: e.target.value })}>
                      <option value="">selecione</option>
                      <option value="seguros">Seguros</option>
                      <option value="consorcios">Consórcios</option>
                    </select>
                  ) : (
                    <input
                      className={inputCls}
                      type={r.campo === "score" || r.campo === "valor_potencial" ? "number" : "text"}
                      value={r.valor}
                      onChange={(e) => updRegra(i, { valor: e.target.value })}
                      placeholder="Valor"
                    />
                  )}
                  <button type="button" onClick={() => rmRegra(i)} title="Remover condição" aria-label="Remover condição" className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 shrink-0"><Trash2 size={15} /></button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block">
            <span className={labelCls}>Dias de memória</span>
            <input className={inputCls} type="number" min={0} value={diasMemoria} onChange={(e) => setDiasMemoria(e.target.value)} placeholder="Ex.: 16" />
            <p className="text-xs text-muted mt-1">Lead retornante volta pro mesmo consultor que o atendeu nos últimos N dias.</p>
          </label>
          <label className="block">
            <span className={labelCls}>Limite de leads abertos por consultor</span>
            <input className={inputCls} type="number" min={0} value={limiteAbertos} onChange={(e) => setLimiteAbertos(e.target.value)} placeholder="Sem limite" />
            <p className="text-xs text-muted mt-1">Consultor só recebe se estiver abaixo deste limite de leads abertos.</p>
          </label>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <span className={`${labelCls} mb-0`}>Horário / plantão</span>
            <label className="inline-flex items-center gap-2 text-xs font-bold text-muted cursor-pointer">
              <input type="checkbox" className="accent-brand-500" checked={usarHorario} onChange={(e) => setUsarHorario(e.target.checked)} />
              Restringir horário
            </label>
          </div>
          {!usarHorario ? (
            <p className="text-xs text-muted bg-slate-50 rounded-xl px-3 py-2">Sem restrição — a fila fica sempre ativa.</p>
          ) : (
            <div className="space-y-1.5">
              {DIAS_SEMANA.map((d) => {
                const cfg = horario[d.chave] ?? horaVazia();
                return (
                  <div key={d.chave} className="flex items-center gap-2 flex-wrap sm:flex-nowrap bg-slate-50 rounded-xl px-3 py-2">
                    <label className="inline-flex items-center gap-2 w-24 shrink-0">
                      <input type="checkbox" className="accent-brand-500" checked={cfg.ativo} onChange={(e) => setDiaHorario(d.chave, { ativo: e.target.checked })} />
                      <span className="text-xs font-bold text-ink">{d.rotulo}</span>
                    </label>
                    <input type="time" disabled={!cfg.ativo} className={`${inputCls} disabled:opacity-40`} value={cfg.ini} onChange={(e) => setDiaHorario(d.chave, { ini: e.target.value })} />
                    <span className="text-xs text-muted">até</span>
                    <input type="time" disabled={!cfg.ativo} className={`${inputCls} disabled:opacity-40`} value={cfg.fim} onChange={(e) => setDiaHorario(d.chave, { fim: e.target.value })} />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div>
          <span className={labelCls}>Usuários na fila</span>
          {equipe.length === 0 ? (
            <p className="text-xs text-muted">Nenhum usuário de equipe cadastrado.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {equipe.map((u) => {
                const ultima = ultimaPorUsuario.get(u.id);
                return (
                  <label key={u.id} className="flex items-center justify-between gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 cursor-pointer">
                    <span className="flex items-center gap-2 min-w-0">
                      <input type="checkbox" className="accent-brand-500 shrink-0" checked={selecionados.has(u.id)} onChange={() => toggleUsuario(u.id)} />
                      <span className="text-sm font-bold text-ink truncate">{u.name}</span>
                    </span>
                    {ultima && <span className="text-[10px] text-muted shrink-0">últ. {new Date(ultima).toLocaleDateString("pt-BR")}</span>}
                  </label>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 sticky bottom-0 bg-white">
        <Button variant="outline" onClick={onClose}>Cancelar</Button>
        <Button onClick={salvar} disabled={salvando}>{salvando ? "Salvando..." : "Salvar fila"}</Button>
      </div>
    </ModalShell>
  );
}

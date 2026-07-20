import { useEffect, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { Settings, Inbox, Bell, Archive, Tag, MessageSquare, Plus, Trash2, Pencil, Power, X, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { PageHeader, Card, Button, Table, Th, Td, Tr, EmptyState, Spinner } from "../../components/ui";
import { ModalShell } from "../../components/ModalShell";
import {
  inserir, atualizar, excluir, listarComStatus, buscarBolsaoConfig, salvarBolsaoConfig, minutosLabel,
  horaVazia, DIAS_SEMANA, CORES_ETIQUETA, VARIAVEIS_TEMPLATE,
  type AlertaConfig, type MotivoArquivamento, type Etiqueta, type MensagemPronta, type BolsaoConfig, type HorarioSemana, type HorarioDia,
} from "../../lib/c2s";

// Clone das telas de configuração do C2S: Bolsão / Alertas / Motivos de
// arquivamento / Etiquetas / Mensagens prontas (ver docs/C2S-SCAN.md).

const inputCls = "w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none text-ink focus:border-brand-400 transition-colors";
const labelCls = "text-xs font-bold text-muted uppercase tracking-wide block mb-1.5";

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
    <label className="flex items-center justify-between gap-3 cursor-pointer">
      <span>
        <span className="text-sm font-bold text-ink block">{label}</span>
        {hint && <span className="text-xs text-muted">{hint}</span>}
      </span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="w-4 h-4 accent-brand-500 shrink-0" />
    </label>
  );
}

type Aba = "bolsao" | "alertas" | "motivos" | "etiquetas" | "mensagens";
const ABAS: { valor: Aba; rotulo: string; icon: LucideIcon }[] = [
  { valor: "bolsao", rotulo: "Bolsão", icon: Inbox },
  { valor: "alertas", rotulo: "Alertas", icon: Bell },
  { valor: "motivos", rotulo: "Motivos de arquivamento", icon: Archive },
  { valor: "etiquetas", rotulo: "Etiquetas", icon: Tag },
  { valor: "mensagens", rotulo: "Mensagens prontas", icon: MessageSquare },
];

export function ConfigHub() {
  const [aba, setAba] = useState<Aba>("bolsao");
  return (
    <>
      <PageHeader title="Configurações" subtitle="Bolsão, alertas, motivos de arquivamento, etiquetas e mensagens prontas" icon={Settings} />

      <div className="flex items-center gap-1 border-b border-slate-200 mb-6 overflow-x-auto">
        {ABAS.map((a) => (
          <button
            key={a.valor}
            onClick={() => setAba(a.valor)}
            className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-bold border-b-2 -mb-px whitespace-nowrap transition-colors ${
              aba === a.valor ? "border-brand-500 text-brand-600" : "border-transparent text-muted hover:text-ink"
            }`}
          >
            <a.icon size={15} /> {a.rotulo}
          </button>
        ))}
      </div>

      {aba === "bolsao" && <AbaBolsao />}
      {aba === "alertas" && <AbaAlertas />}
      {aba === "motivos" && <AbaMotivos />}
      {aba === "etiquetas" && <AbaEtiquetas />}
      {aba === "mensagens" && <AbaMensagens />}
    </>
  );
}

// ─── Bolsão ───────────────────────────────────────────────────────────────
const OPCOES_SLA = [5, 10, 15, 20, 30, 45, 60, 90, 120, 240];

function AbaBolsao() {
  const [cfg, setCfg] = useState<BolsaoConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState(false);

  async function carregar() {
    setLoading(true);
    const r = await buscarBolsaoConfig();
    setCfg(r.data ?? { id: 1, ativo: true, limite_minutos: 20, escopo: "empresa", horario: null });
    setErro(r.erro);
    setLoading(false);
  }
  useEffect(() => { carregar(); }, []);

  async function salvar(patch: Partial<BolsaoConfig>) {
    setCfg((p) => (p ? { ...p, ...patch } : p));
    const ok = await salvarBolsaoConfig(patch);
    if (ok) toast.success("Configuração do bolsão salva.");
    else toast.error("Não foi possível salvar.");
  }

  function setDiaHorario(chave: keyof HorarioSemana, patchDia: Partial<HorarioDia>) {
    if (!cfg) return;
    const horario: HorarioSemana = { ...(cfg.horario ?? {}), [chave]: { ...(cfg.horario?.[chave] ?? horaVazia()), ...patchDia } };
    salvar({ horario });
  }

  if (loading) return <Card><Spinner label="Carregando..." /></Card>;

  return (
    <div className="space-y-5">
      {erro && <AvisoMigracao />}

      <Card>
        <ToggleRow label="Bolsão ativo" hint="Leads sem interação a tempo ficam disponíveis para qualquer um pegar" checked={cfg?.ativo ?? true} onChange={(v) => salvar({ ativo: v })} />
      </Card>

      <Card>
        <span className={labelCls}>Limite de tempo para atendimento</span>
        <select className={`${inputCls} max-w-xs`} value={cfg?.limite_minutos ?? 20} onChange={(e) => salvar({ limite_minutos: Number(e.target.value) })}>
          {OPCOES_SLA.map((m) => <option key={m} value={m}>{minutosLabel(m)}</option>)}
        </select>
        <p className="text-xs text-muted mt-2">Tempo para o consultor interagir com o lead antes dele ficar disponível no bolsão para qualquer um pegar.</p>
      </Card>

      <Card>
        <span className={labelCls}>Escopo</span>
        <div className="space-y-2 mt-1">
          <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
            <input type="radio" name="escopo" className="accent-brand-500" checked={(cfg?.escopo ?? "empresa") === "empresa"} onChange={() => salvar({ escopo: "empresa" })} />
            Qualquer usuário da empresa pode pegar
          </label>
          <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
            <input type="radio" name="escopo" className="accent-brand-500" checked={cfg?.escopo === "equipe"} onChange={() => salvar({ escopo: "equipe" })} />
            Só a equipe que recebeu o lead
          </label>
        </div>
      </Card>

      <Card>
        <span className={labelCls}>Horário de funcionamento do bolsão</span>
        <div className="space-y-1.5 mt-1">
          {DIAS_SEMANA.map((d) => {
            const c = cfg?.horario?.[d.chave] ?? horaVazia();
            return (
              <div key={d.chave} className="flex items-center gap-2 flex-wrap sm:flex-nowrap bg-slate-50 rounded-xl px-3 py-2">
                <label className="inline-flex items-center gap-2 w-24 shrink-0">
                  <input type="checkbox" className="accent-brand-500" checked={c.ativo} onChange={(e) => setDiaHorario(d.chave, { ativo: e.target.checked })} />
                  <span className="text-xs font-bold text-ink">{d.rotulo}</span>
                </label>
                <input type="time" disabled={!c.ativo} className={`${inputCls} disabled:opacity-40`} value={c.ini} onChange={(e) => setDiaHorario(d.chave, { ini: e.target.value })} />
                <span className="text-xs text-muted">até</span>
                <input type="time" disabled={!c.ativo} className={`${inputCls} disabled:opacity-40`} value={c.fim} onChange={(e) => setDiaHorario(d.chave, { fim: e.target.value })} />
              </div>
            );
          })}
        </div>
        <p className="text-xs text-muted mt-2">Deixe todos os dias desmarcados para o bolsão funcionar o tempo todo.</p>
      </Card>
    </div>
  );
}

// ─── Alertas ──────────────────────────────────────────────────────────────
const NOTIFICAR_OPCOES: { valor: AlertaConfig["notificar"]; rotulo: string }[] = [
  { valor: "usuario", rotulo: "Usuário que recebeu o lead" },
  { valor: "gestores", rotulo: "Gestores da equipe" },
];

function AbaAlertas() {
  const [itens, setItens] = useState<AlertaConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState(false);

  async function carregar() {
    setLoading(true);
    const r = await listarComStatus<AlertaConfig>("alertas_config", "minutos");
    setItens(r.data);
    setErro(r.erro);
    setLoading(false);
  }
  useEffect(() => { carregar(); }, []);

  async function novo() {
    const ok = await inserir("alertas_config", { minutos: 60, notificar: "usuario", ativo: true });
    if (ok) { toast.success("Alerta criado."); carregar(); } else toast.error("Não foi possível criar o alerta.");
  }
  async function salvar(id: string, patch: Partial<AlertaConfig>) {
    setItens((p) => p.map((a) => (a.id === id ? { ...a, ...patch } : a)));
    const ok = await atualizar("alertas_config", id, patch);
    if (!ok) { toast.error("Não foi possível salvar."); carregar(); }
  }
  async function remover(id: string) {
    if (!window.confirm("Excluir este alerta?")) return;
    const ok = await excluir("alertas_config", id);
    if (ok) { toast.success("Alerta excluído."); setItens((p) => p.filter((a) => a.id !== id)); }
    else toast.error("Não foi possível excluir.");
  }

  if (loading) return <Card><Spinner label="Carregando..." /></Card>;

  return (
    <div className="space-y-4">
      {erro && <AvisoMigracao />}
      <p className="text-sm text-muted">Alerta quando um lead está sem atendimento há mais de X.</p>
      <div className="flex justify-end">
        <Button icon={Plus} size="sm" onClick={novo}>Novo alerta</Button>
      </div>
      {itens.length === 0 ? (
        <Card><EmptyState icon={Bell} title="Nenhum alerta configurado" hint="Crie escalonamentos para avisar quando um lead fica sem atendimento." /></Card>
      ) : (
        <Card pad={false}>
          <div className="p-2">
            <Table head={<><Th>Sem atendimento há</Th><Th>Notificar</Th><Th>Status</Th><Th right>Ações</Th></>}>
              {itens.map((a) => (
                <Tr key={a.id}>
                  <Td>
                    <div className="flex items-center gap-2">
                      <input type="number" min={1} className={`${inputCls} w-24`} value={a.minutos} onChange={(e) => salvar(a.id, { minutos: Number(e.target.value) || 1 })} />
                      <span className="text-xs text-muted">{minutosLabel(a.minutos)}</span>
                    </div>
                  </Td>
                  <Td>
                    <select className={inputCls} value={a.notificar} onChange={(e) => salvar(a.id, { notificar: e.target.value as AlertaConfig["notificar"] })}>
                      {NOTIFICAR_OPCOES.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
                    </select>
                  </Td>
                  <Td>
                    <label className="inline-flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" className="accent-brand-500" checked={a.ativo} onChange={(e) => salvar(a.id, { ativo: e.target.checked })} />
                      <span className="text-xs text-muted">{a.ativo ? "Ativo" : "Inativo"}</span>
                    </label>
                  </Td>
                  <Td right>
                    <button onClick={() => remover(a.id)} title="Excluir" aria-label="Excluir alerta" className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50"><Trash2 size={15} /></button>
                  </Td>
                </Tr>
              ))}
            </Table>
          </div>
        </Card>
      )}
    </div>
  );
}

// ─── Motivos de arquivamento ─────────────────────────────────────────────
function AbaMotivos() {
  const [itens, setItens] = useState<MotivoArquivamento[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState(false);
  const [novoNome, setNovoNome] = useState("");
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [editandoNome, setEditandoNome] = useState("");

  async function carregar() {
    setLoading(true);
    const r = await listarComStatus<MotivoArquivamento>("motivos_arquivamento", "nome");
    setItens(r.data);
    setErro(r.erro);
    setLoading(false);
  }
  useEffect(() => { carregar(); }, []);

  async function criar() {
    if (!novoNome.trim()) return;
    const ok = await inserir("motivos_arquivamento", { nome: novoNome.trim(), ativo: true });
    if (ok) { toast.success("Motivo criado."); setNovoNome(""); carregar(); }
    else toast.error("Não foi possível criar (nome já existe?).");
  }
  async function alternar(m: MotivoArquivamento) {
    const ok = await atualizar("motivos_arquivamento", m.id, { ativo: !m.ativo });
    if (ok) setItens((p) => p.map((x) => (x.id === m.id ? { ...x, ativo: !x.ativo } : x)));
    else toast.error("Não foi possível atualizar.");
  }
  function iniciarEdicao(m: MotivoArquivamento) { setEditandoId(m.id); setEditandoNome(m.nome); }
  async function salvarEdicao(id: string) {
    const nome = editandoNome.trim();
    setEditandoId(null);
    if (!nome) return;
    const ok = await atualizar("motivos_arquivamento", id, { nome });
    if (ok) { setItens((p) => p.map((x) => (x.id === id ? { ...x, nome } : x))); toast.success("Motivo renomeado."); }
    else toast.error("Não foi possível renomear.");
  }

  if (loading) return <Card><Spinner label="Carregando..." /></Card>;

  return (
    <div className="space-y-4">
      {erro && <AvisoMigracao />}
      <Card>
        <div className="flex gap-2">
          <input className={inputCls} value={novoNome} onChange={(e) => setNovoNome(e.target.value)} placeholder="Novo motivo de arquivamento" onKeyDown={(e) => e.key === "Enter" && criar()} />
          <Button icon={Plus} onClick={criar}>Criar</Button>
        </div>
      </Card>
      {itens.length === 0 ? (
        <Card><EmptyState icon={Archive} title="Nenhum motivo cadastrado" /></Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {itens.map((m) => (
            <Card key={m.id} pad={false} className="flex items-center justify-between gap-2 p-3">
              {editandoId === m.id ? (
                <input
                  autoFocus
                  className={inputCls}
                  value={editandoNome}
                  onChange={(e) => setEditandoNome(e.target.value)}
                  onBlur={() => salvarEdicao(m.id)}
                  onKeyDown={(e) => e.key === "Enter" && salvarEdicao(m.id)}
                />
              ) : (
                <button onClick={() => iniciarEdicao(m)} title="Clique para renomear" className={`text-sm font-bold text-left truncate flex-1 ${m.ativo ? "text-ink" : "text-muted line-through"}`}>
                  {m.nome}
                </button>
              )}
              <label className="inline-flex items-center gap-1.5 shrink-0 cursor-pointer" title={m.ativo ? "Desativar" : "Ativar"}>
                <input type="checkbox" className="accent-brand-500" checked={m.ativo} onChange={() => alternar(m)} />
              </label>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Etiquetas ────────────────────────────────────────────────────────────
function AbaEtiquetas() {
  const [itens, setItens] = useState<Etiqueta[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState(false);
  const [nome, setNome] = useState("");
  const [cor, setCor] = useState(CORES_ETIQUETA[0]);

  async function carregar() {
    setLoading(true);
    const r = await listarComStatus<Etiqueta>("etiquetas", "nome");
    setItens(r.data);
    setErro(r.erro);
    setLoading(false);
  }
  useEffect(() => { carregar(); }, []);

  async function criar() {
    if (!nome.trim()) return;
    const ok = await inserir("etiquetas", { nome: nome.trim(), cor, ativa: true });
    if (ok) { toast.success("Etiqueta criada."); setNome(""); carregar(); }
    else toast.error("Não foi possível criar (nome já existe?).");
  }
  async function alternar(e: Etiqueta) {
    const ok = await atualizar("etiquetas", e.id, { ativa: !e.ativa });
    if (ok) setItens((p) => p.map((x) => (x.id === e.id ? { ...x, ativa: !x.ativa } : x)));
    else toast.error("Não foi possível atualizar.");
  }
  async function mudarCor(e: Etiqueta, novaCor: string) {
    setItens((p) => p.map((x) => (x.id === e.id ? { ...x, cor: novaCor } : x)));
    const ok = await atualizar("etiquetas", e.id, { cor: novaCor });
    if (!ok) toast.error("Não foi possível salvar a cor.");
  }
  async function remover(e: Etiqueta) {
    if (!window.confirm(`Excluir a etiqueta "${e.nome}"?`)) return;
    const ok = await excluir("etiquetas", e.id);
    if (ok) { toast.success("Etiqueta excluída."); setItens((p) => p.filter((x) => x.id !== e.id)); }
    else toast.error("Não foi possível excluir.");
  }

  if (loading) return <Card><Spinner label="Carregando..." /></Card>;

  return (
    <div className="space-y-4">
      {erro && <AvisoMigracao />}
      <Card>
        <span className={labelCls}>Nova etiqueta</span>
        <div className="flex items-center gap-2 flex-wrap mt-1">
          <input className={`${inputCls} flex-1 min-w-[160px]`} value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome da etiqueta" onKeyDown={(ev) => ev.key === "Enter" && criar()} />
          <div className="flex items-center gap-1">
            {CORES_ETIQUETA.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCor(c)}
                title={c}
                aria-label={`Cor ${c}`}
                style={{ backgroundColor: c }}
                className={`w-6 h-6 rounded-full border-2 ${cor === c ? "border-ink" : "border-transparent"}`}
              />
            ))}
            <input type="color" value={cor} onChange={(e) => setCor(e.target.value)} className="w-8 h-8 rounded-lg border border-slate-200 cursor-pointer" title="Cor personalizada" />
          </div>
          <Button icon={Plus} onClick={criar}>Criar</Button>
        </div>
      </Card>
      {itens.length === 0 ? (
        <Card><EmptyState icon={Tag} title="Nenhuma etiqueta cadastrada" /></Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {itens.map((e) => (
            <Card key={e.id} pad={false} className={`flex items-center justify-between gap-2 p-3 ${!e.ativa ? "opacity-60" : ""}`}>
              <div className="flex items-center gap-2 min-w-0">
                <input type="color" value={e.cor} onChange={(ev) => mudarCor(e, ev.target.value)} className="w-6 h-6 rounded-full border border-slate-200 cursor-pointer shrink-0" title="Mudar cor" />
                <span className="text-sm font-bold text-ink truncate">{e.nome}</span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <input type="checkbox" className="accent-brand-500" checked={e.ativa} onChange={() => alternar(e)} title={e.ativa ? "Desativar" : "Ativar"} />
                <button onClick={() => remover(e)} title="Excluir" aria-label={`Excluir ${e.nome}`} className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50"><Trash2 size={14} /></button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Mensagens prontas ────────────────────────────────────────────────────
const EXPLICACAO_VARIAVEL: Record<string, string> = {
  "[NOME_CONTATO]": "Primeiro nome do cliente/lead",
  "[NOME_VENDEDOR]": "Nome do consultor responsável",
  "[TELEFONE_VENDEDOR]": "Telefone/WhatsApp do consultor",
  "[ASSINATURA]": "Assinatura cadastrada no perfil do consultor",
  "[PRODUTO]": "Produto de interesse do lead",
  "[CAMPANHA]": "Campanha de origem do lead",
  "[NOME_ATIVIDADE]": "Nome da atividade/tarefa atual",
  "[DATA_ATIVIDADE]": "Data/hora da atividade atual",
};

function AbaMensagens() {
  const [itens, setItens] = useState<MensagemPronta[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState(false);
  const [subaba, setSubaba] = useState<"ativas" | "inativas">("ativas");
  const [editando, setEditando] = useState<MensagemPronta | "novo" | null>(null);

  async function carregar() {
    setLoading(true);
    const r = await listarComStatus<MensagemPronta>("mensagens_prontas", "ordem");
    setItens(r.data);
    setErro(r.erro);
    setLoading(false);
  }
  useEffect(() => { carregar(); }, []);

  async function alternar(m: MensagemPronta) {
    const ok = await atualizar("mensagens_prontas", m.id, { ativa: !m.ativa });
    if (ok) setItens((p) => p.map((x) => (x.id === m.id ? { ...x, ativa: !x.ativa } : x)));
    else toast.error("Não foi possível atualizar.");
  }
  async function remover(m: MensagemPronta) {
    if (!window.confirm(`Excluir a mensagem "${m.nome}"?`)) return;
    const ok = await excluir("mensagens_prontas", m.id);
    if (ok) { toast.success("Mensagem excluída."); setItens((p) => p.filter((x) => x.id !== m.id)); }
    else toast.error("Não foi possível excluir.");
  }

  const filtradas = itens.filter((m) => (subaba === "ativas" ? m.ativa : !m.ativa));

  if (loading) return <Card><Spinner label="Carregando..." /></Card>;

  return (
    <div className="space-y-4">
      {erro && <AvisoMigracao />}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="inline-flex bg-slate-100 rounded-xl p-1 gap-1">
          <button onClick={() => setSubaba("ativas")} className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${subaba === "ativas" ? "bg-white text-brand-600 shadow-sm" : "text-muted"}`}>
            Ativas ({itens.filter((m) => m.ativa).length})
          </button>
          <button onClick={() => setSubaba("inativas")} className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${subaba === "inativas" ? "bg-white text-brand-600 shadow-sm" : "text-muted"}`}>
            Inativas ({itens.filter((m) => !m.ativa).length})
          </button>
        </div>
        <Button icon={Plus} size="sm" onClick={() => setEditando("novo")}>Nova mensagem</Button>
      </div>

      {filtradas.length === 0 ? (
        <Card><EmptyState icon={MessageSquare} title={subaba === "ativas" ? "Nenhuma mensagem ativa" : "Nenhuma mensagem inativa"} /></Card>
      ) : (
        <div className="space-y-2">
          {filtradas.map((m) => (
            <Card key={m.id} className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-bold text-ink">{m.nome}</p>
                <p className="text-xs text-muted mt-1 line-clamp-2 whitespace-pre-line">{m.conteudo}</p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => setEditando(m)} title="Editar" aria-label={`Editar ${m.nome}`} className="p-2 rounded-lg text-slate-400 hover:text-brand-600 hover:bg-brand-50"><Pencil size={15} /></button>
                <button onClick={() => alternar(m)} title={m.ativa ? "Desativar" : "Ativar"} aria-label={m.ativa ? `Desativar ${m.nome}` : `Ativar ${m.nome}`} className="p-2 rounded-lg text-slate-400 hover:text-brand-600 hover:bg-brand-50"><Power size={15} /></button>
                <button onClick={() => remover(m)} title="Excluir" aria-label={`Excluir ${m.nome}`} className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50"><Trash2 size={15} /></button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {editando && (
        <MensagemEditor
          mensagem={editando === "novo" ? null : editando}
          proximaOrdem={itens.length}
          onClose={() => setEditando(null)}
          onSaved={() => { setEditando(null); carregar(); }}
        />
      )}
    </div>
  );
}

function MensagemEditor({ mensagem, proximaOrdem, onClose, onSaved }: {
  mensagem: MensagemPronta | null;
  proximaOrdem: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [nome, setNome] = useState(mensagem?.nome ?? "");
  const [conteudo, setConteudo] = useState(mensagem?.conteudo ?? "");
  const [ativa, setAtiva] = useState(mensagem?.ativa ?? true);
  const [salvando, setSalvando] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  function inserirVariavel(v: string) {
    const ta = taRef.current;
    if (!ta) { setConteudo((p) => p + v); return; }
    const ini = ta.selectionStart ?? conteudo.length;
    const fim = ta.selectionEnd ?? conteudo.length;
    const novoConteudo = conteudo.slice(0, ini) + v + conteudo.slice(fim);
    setConteudo(novoConteudo);
    requestAnimationFrame(() => {
      ta.focus();
      ta.selectionStart = ta.selectionEnd = ini + v.length;
    });
  }

  async function salvar() {
    if (!nome.trim() || !conteudo.trim()) { toast.error("Preencha nome e conteúdo."); return; }
    setSalvando(true);
    const ok = mensagem
      ? await atualizar("mensagens_prontas", mensagem.id, { nome: nome.trim(), conteudo, ativa })
      : await inserir("mensagens_prontas", { nome: nome.trim(), conteudo, ativa, ordem: proximaOrdem });
    setSalvando(false);
    if (ok) { toast.success(mensagem ? "Mensagem atualizada." : "Mensagem criada."); onSaved(); }
    else toast.error("Não foi possível salvar.");
  }

  return (
    <ModalShell onClose={onClose} label={mensagem ? "Editar mensagem" : "Nova mensagem"} className="bg-white rounded-2xl shadow-2xl w-[min(560px,94vw)] max-h-[90vh] overflow-y-auto">
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 sticky top-0 bg-white z-10">
        <div className="flex items-center gap-2.5">
          <span className="w-9 h-9 rounded-xl bg-brand-50 text-brand-500 grid place-items-center shrink-0"><MessageSquare size={18} /></span>
          <h3 className="font-extrabold text-ink text-lg">{mensagem ? "Editar mensagem" : "Nova mensagem"}</h3>
        </div>
        <button onClick={onClose} aria-label="Fechar" className="text-slate-500 hover:text-slate-700"><X size={20} /></button>
      </div>

      <div className="p-6 space-y-4">
        <label className="block">
          <span className={labelCls}>Nome</span>
          <input className={inputCls} value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Agendar visita" />
        </label>
        <label className="block">
          <span className={labelCls}>Conteúdo</span>
          <textarea ref={taRef} className={`${inputCls} min-h-[120px] resize-y`} value={conteudo} onChange={(e) => setConteudo(e.target.value)} placeholder="Escreva a mensagem. Use os chips abaixo para inserir variáveis." />
        </label>
        <div>
          <span className={labelCls}>Variáveis</span>
          <div className="flex flex-wrap gap-1.5">
            {VARIAVEIS_TEMPLATE.map((v) => (
              <button key={v} type="button" onClick={() => inserirVariavel(v)} title={EXPLICACAO_VARIAVEL[v] ?? v}
                className="text-[11px] font-bold text-brand-600 bg-brand-50 hover:bg-brand-100 px-2 py-1 rounded-lg transition-colors">
                {v}
              </button>
            ))}
          </div>
          <ul className="text-xs text-muted mt-2 space-y-0.5">
            {VARIAVEIS_TEMPLATE.map((v) => (
              <li key={v}><b className="text-ink font-mono">{v}</b> — {EXPLICACAO_VARIAVEL[v] ?? ""}</li>
            ))}
          </ul>
        </div>
        <ToggleRow label="Mensagem ativa" checked={ativa} onChange={setAtiva} />
      </div>

      <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 sticky bottom-0 bg-white">
        <Button variant="outline" onClick={onClose}>Cancelar</Button>
        <Button onClick={salvar} disabled={salvando}>{salvando ? "Salvando..." : "Salvar"}</Button>
      </div>
    </ModalShell>
  );
}

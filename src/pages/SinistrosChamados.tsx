import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ShieldAlert, Phone, MessageCircle, Clock, AlertTriangle, FileSearch, FileClock,
  CheckCircle2, Hand, X, Users as UsersIcon, Tag, Building2, Radio, Trash2,
} from "lucide-react";
import { PageHeader, Card, KpiCard, Button, Badge, EmptyState, Spinner, FilterBar, Select, SearchInput, Table, Th, Td, Tr } from "../components/ui";
import { ModalShell } from "../components/ModalShell";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";
import { listarEquipe, atualizar } from "../lib/c2s";
import { onlyDigits, waLink } from "../lib/format";

// Chamados de sinistro triados pelo Kubinho (site) — gravados direto em
// sinistros_chamados (ver supabase/sinistros-triagem.sql). A equipe assume,
// trabalha e conclui aqui. Sino da MainLayout avisa sobre chamados 'novo'
// (ver src/lib/avisos.ts).
interface SinistroChamado {
  id: string;
  created_at: string;
  atualizado_em: string;
  nome: string;
  telefone?: string | null;
  email?: string | null;
  cliente_id?: string | null;
  seguradora?: string | null;
  tipo?: string | null;
  resumo?: string | null;
  dados?: Record<string, unknown> | null;
  conversa?: string | null;
  status: "novo" | "em_analise" | "aguardando_docs" | "concluido";
  responsavel_id?: string | null;
  origem: string;
}

const TIPOS: { value: string; label: string }[] = [
  { value: "furto", label: "Furto" },
  { value: "roubo", label: "Roubo" },
  { value: "colisao", label: "Colisão" },
  { value: "incendio", label: "Incêndio" },
  { value: "enchente", label: "Enchente" },
  { value: "vidros", label: "Vidros" },
  { value: "vida", label: "Vida" },
  { value: "assistencia", label: "Assistência" },
];
const rotuloTipo = (t?: string | null) => TIPOS.find((x) => x.value === t)?.label ?? (t || "—");

const STATUS_OPCOES: { value: SinistroChamado["status"]; label: string }[] = [
  { value: "novo", label: "Novo" },
  { value: "em_analise", label: "Em análise" },
  { value: "aguardando_docs", label: "Aguardando docs" },
  { value: "concluido", label: "Concluído" },
];
const STATUS_META: Record<SinistroChamado["status"], { label: string; tone: "red" | "blue" | "amber" | "green" }> = {
  novo: { label: "Novo", tone: "red" },
  em_analise: { label: "Em análise", tone: "blue" },
  aguardando_docs: { label: "Aguardando docs", tone: "amber" },
  concluido: { label: "Concluído", tone: "green" },
};

const dateTimeBR = (v?: string | null) => {
  if (!v) return "—";
  const d = new Date(v);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
};

function matchBusca(c: SinistroChamado, termo: string) {
  if (!termo) return true;
  const t = termo.toLowerCase();
  return (c.nome || "").toLowerCase().includes(t) || (c.telefone || "").toLowerCase().includes(t);
}

export function SinistrosChamados() {
  const { user, isManager } = useAuth();
  const [chamados, setChamados] = useState<SinistroChamado[]>([]);
  const [equipe, setEquipe] = useState<{ id: string; name: string; role: string | null }[]>([]);
  const [loading, setLoading] = useState(true);
  const [tabelaAusente, setTabelaAusente] = useState(false);

  const [statusFiltro, setStatusFiltro] = useState("");
  const [tipoFiltro, setTipoFiltro] = useState("");
  const [busca, setBusca] = useState("");

  const [selecionado, setSelecionado] = useState<SinistroChamado | null>(null);
  const [salvando, setSalvando] = useState(false);

  // guarda de corrida no load (mesmo padrão do Bolsão/Meus Leads).
  const loadReq = useRef(0);
  async function load() {
    const req = ++loadReq.current;
    try {
      const [chamadosRes, equipeRes] = await Promise.all([
        supabase
          ? supabase.from("sinistros_chamados").select("*").order("created_at", { ascending: false }).limit(300)
          : Promise.resolve({ data: [] as SinistroChamado[], error: null }),
        listarEquipe(),
      ]);
      if (req !== loadReq.current) return;
      if (chamadosRes.error) console.error("[sinistros] load:", chamadosRes.error.message);
      setTabelaAusente(!!chamadosRes.error);
      setChamados((chamadosRes.data as SinistroChamado[]) ?? []);
      setEquipe(equipeRes);
    } catch (e) {
      console.error("[sinistros] load:", e);
    } finally {
      if (req === loadReq.current) setLoading(false);
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const nomePorId = useMemo(() => {
    const m: Record<string, string> = {};
    equipe.forEach((p) => { m[p.id] = p.name; });
    return m;
  }, [equipe]);

  const filtered = useMemo(
    () => chamados
      .filter((c) => (!statusFiltro || c.status === statusFiltro) && (!tipoFiltro || c.tipo === tipoFiltro) && matchBusca(c, busca))
      .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || "")),
    [chamados, statusFiltro, tipoFiltro, busca]
  );

  const kpiNovos = chamados.filter((c) => c.status === "novo").length;
  const kpiEmAnalise = chamados.filter((c) => c.status === "em_analise").length;
  const kpiAguardandoDocs = chamados.filter((c) => c.status === "aguardando_docs").length;
  const kpiConcluidos30d = chamados.filter((c) => {
    if (c.status !== "concluido") return false;
    const base = c.atualizado_em ? new Date(c.atualizado_em).getTime() : 0;
    return Date.now() - base <= 30 * 86400000;
  }).length;

  function patchLocal(id: string, patch: Partial<SinistroChamado>) {
    setChamados((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    setSelecionado((prev) => (prev && prev.id === id ? { ...prev, ...patch } : prev));
  }

  async function handleAssumir(c: SinistroChamado) {
    if (!user) return;
    setSalvando(true);
    const atualizado_em = new Date().toISOString();
    // Assumir TAMBÉM tira o chamado de "novo": o alerta vermelho do sino é
    // keyed em status='novo' (lib/avisos.ts) e a Ajuda documenta o fluxo como
    // "quem pegar clica em Assumir", sem pedir pra mexer no Status. Sem isto o
    // alerta de prioridade máxima nunca sumia — os 8 consultores seguiam vendo
    // um chamado que já tem dono e ligavam de novo pra vítima do acidente.
    // Só avança a partir de 'novo'; status já trabalhado é preservado.
    const patch: Record<string, string> = { responsavel_id: user.id, atualizado_em };
    if (c.status === "novo") patch.status = "em_analise";
    const ok = await atualizar("sinistros_chamados", c.id, patch);
    setSalvando(false);
    if (ok) {
      toast.success("Chamado assumido — ele é seu.");
      patchLocal(c.id, patch as Partial<SinistroChamado>);
    } else {
      toast.error("Não foi possível assumir o chamado agora.");
    }
  }

  // O insert do chamado é público (chat sem login) — gestor precisa poder
  // remover spam/teste sem abrir o SQL Editor.
  async function handleExcluir(c: SinistroChamado) {
    if (!supabase) return;
    if (!window.confirm(`Excluir o chamado de "${c.nome}"? Essa ação não tem volta.`)) return;
    setSalvando(true);
    const { error } = await supabase.from("sinistros_chamados").delete().eq("id", c.id);
    setSalvando(false);
    if (!error) {
      toast.success("Chamado excluído.");
      setChamados((prev) => prev.filter((x) => x.id !== c.id));
      setSelecionado(null);
    } else {
      toast.error("Não foi possível excluir o chamado.");
    }
  }

  async function handleStatus(c: SinistroChamado, status: SinistroChamado["status"]) {
    setSalvando(true);
    const atualizado_em = new Date().toISOString();
    const ok = await atualizar("sinistros_chamados", c.id, { status, atualizado_em });
    setSalvando(false);
    if (ok) {
      toast.success("Status atualizado.");
      patchLocal(c.id, { status, atualizado_em });
    } else {
      toast.error("Não foi possível atualizar o status.");
    }
  }

  return (
    <>
      <PageHeader title="Sinistros & Assistências" subtitle="Chamados triados pelo Kubinho — assuma e conduza" icon={ShieldAlert} />

      {tabelaAusente && (
        <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 text-amber-800 text-xs font-semibold px-4 py-3 flex items-center gap-2">
          <AlertTriangle size={15} className="shrink-0" />
          Sinistros ainda não estão disponíveis. Rode <code className="bg-amber-100 px-1 rounded">supabase/sinistros-triagem.sql</code> no Supabase para ativar esta tela.
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KpiCard label="Novos" value={String(kpiNovos)} icon={ShieldAlert} accent="danger" hint="Chegaram do Kubinho e ninguém assumiu" />
        <KpiCard label="Em análise" value={String(kpiEmAnalise)} icon={FileSearch} accent="sky" />
        <KpiCard label="Aguardando docs" value={String(kpiAguardandoDocs)} icon={FileClock} accent="warning" />
        <KpiCard label="Concluídos (30d)" value={String(kpiConcluidos30d)} icon={CheckCircle2} accent="success" />
      </div>

      <FilterBar>
        <Select value={statusFiltro} onChange={setStatusFiltro} placeholder="Todos os status" options={STATUS_OPCOES} />
        <Select value={tipoFiltro} onChange={setTipoFiltro} placeholder="Todos os tipos" options={TIPOS} />
        <SearchInput value={busca} onChange={setBusca} placeholder="Buscar por nome ou telefone..." />
      </FilterBar>

      {loading ? (
        <Spinner label="Carregando os chamados..." />
      ) : filtered.length === 0 ? (
        <Card pad={false}>
          <EmptyState icon={ShieldAlert} title="Nenhum sinistro — que assim continue!" hint="Assim que o Kubinho triar um sinistro ou assistência, o chamado aparece aqui." />
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((c) => {
            const wa = waLink(c.telefone);
            const sm = STATUS_META[c.status] ?? STATUS_META.novo;
            const responsavel = c.responsavel_id ? (nomePorId[c.responsavel_id] ?? "—") : null;
            return (
              <Card key={c.id} className={`cursor-pointer hover:border-brand-300 transition-colors ${c.status === "novo" ? "ring-2 ring-red-300" : ""}`}>
                <div onClick={() => setSelecionado(c)}>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <span className="font-bold text-ink">{c.nome}</span>
                    <span className="text-xs text-muted flex items-center gap-1 shrink-0"><Clock size={12} /> {dateTimeBR(c.created_at)}</span>
                  </div>

                  <div className="flex flex-wrap gap-1.5 mb-3">
                    <Badge tone={sm.tone}>{sm.label}</Badge>
                    <Badge tone="blue"><Tag size={11} /> {rotuloTipo(c.tipo)}</Badge>
                    {c.seguradora && <Badge tone="violet"><Building2 size={11} /> {c.seguradora}</Badge>}
                    {c.origem && <Badge tone="slate"><Radio size={11} /> {c.origem}</Badge>}
                  </div>

                  {c.telefone && <p className="text-xs text-muted flex items-center gap-1 mb-1"><Phone size={12} /> {c.telefone}</p>}
                  {c.resumo && <p className="text-xs text-slate-500 line-clamp-2 mb-3">{c.resumo}</p>}

                  <div className="flex items-center gap-1 text-xs text-muted mt-2">
                    <UsersIcon size={11} /> {responsavel ?? "Sem responsável"}
                  </div>
                </div>

                {wa && (
                  <div className="mt-3">
                    <a href={wa} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
                      <Button size="sm" variant="wa" icon={MessageCircle}>WhatsApp</Button>
                    </a>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {selecionado && (
        <ModalShell
          onClose={() => !salvando && setSelecionado(null)}
          label={`Chamado de ${selecionado.nome}`}
          className="bg-white rounded-2xl shadow-2xl w-[min(680px,94vw)] max-h-[90vh] overflow-y-auto"
        >
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 sticky top-0 bg-white z-10">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="w-9 h-9 rounded-xl bg-brand-50 text-brand-500 grid place-items-center shrink-0"><ShieldAlert size={18} /></span>
              <h3 className="font-extrabold text-ink text-lg truncate">{selecionado.nome}</h3>
            </div>
            <button type="button" onClick={() => !salvando && setSelecionado(null)} aria-label="Fechar" className="text-slate-500 hover:text-slate-700 shrink-0"><X size={20} /></button>
          </div>

          <div className="p-6 space-y-5">
            <div className="flex flex-wrap gap-1.5">
              <Badge tone={STATUS_META[selecionado.status].tone}>{STATUS_META[selecionado.status].label}</Badge>
              <Badge tone="blue"><Tag size={11} /> {rotuloTipo(selecionado.tipo)}</Badge>
              {selecionado.seguradora && <Badge tone="violet"><Building2 size={11} /> {selecionado.seguradora}</Badge>}
              {selecionado.origem && <Badge tone="slate"><Radio size={11} /> {selecionado.origem}</Badge>}
            </div>

            {selecionado.resumo && <p className="text-sm text-ink font-semibold">{selecionado.resumo}</p>}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs font-bold text-muted uppercase tracking-wide mb-1">Telefone</p>
                {selecionado.telefone ? (
                  <div className="flex items-center gap-2">
                    <a href={`tel:${onlyDigits(selecionado.telefone)}`} className="text-brand-600 font-semibold hover:underline">{selecionado.telefone}</a>
                    <a href={waLink(selecionado.telefone) ?? undefined} target="_blank" rel="noopener noreferrer" title="WhatsApp" className="text-muted hover:text-[#25d366] transition-colors">
                      <MessageCircle size={16} />
                    </a>
                  </div>
                ) : <p className="text-muted">—</p>}
              </div>
              <div>
                <p className="text-xs font-bold text-muted uppercase tracking-wide mb-1">E-mail</p>
                <p className="text-ink">{selecionado.email || "—"}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-muted uppercase tracking-wide mb-1">Recebido em</p>
                <p className="text-ink">{dateTimeBR(selecionado.created_at)}</p>
              </div>
              <div>
                <p className="text-xs font-bold text-muted uppercase tracking-wide mb-1">Atualizado em</p>
                <p className="text-ink">{dateTimeBR(selecionado.atualizado_em)}</p>
              </div>
            </div>

            <div className="flex flex-wrap items-end gap-3 bg-slate-50 border border-slate-200 rounded-xl p-4">
              <div>
                <p className="text-xs font-bold text-muted uppercase tracking-wide mb-1.5">Responsável</p>
                <p className="text-sm text-ink font-semibold flex items-center gap-1.5">
                  <UsersIcon size={14} />
                  {selecionado.responsavel_id ? (nomePorId[selecionado.responsavel_id] ?? "—") : "Sem responsável"}
                </p>
              </div>
              <Button size="sm" icon={Hand} disabled={salvando || selecionado.responsavel_id === user?.id} onClick={() => handleAssumir(selecionado)}>
                {selecionado.responsavel_id === user?.id ? "Você é o responsável" : "Assumir chamado"}
              </Button>
              <div className="ml-auto">
                <p className="text-xs font-bold text-muted uppercase tracking-wide mb-1.5">Status</p>
                <Select
                  value={selecionado.status}
                  onChange={(v) => handleStatus(selecionado, v as SinistroChamado["status"])}
                  options={STATUS_OPCOES}
                />
              </div>
            </div>

            {selecionado.dados && Object.keys(selecionado.dados).length > 0 && (
              <div>
                <p className="text-xs font-bold text-muted uppercase tracking-wide mb-2">Triagem do Kubinho</p>
                <Table head={<><Th>Pergunta</Th><Th>Resposta</Th></>}>
                  {Object.entries(selecionado.dados).map(([pergunta, resposta]) => (
                    <Tr key={pergunta}>
                      <Td>{pergunta}</Td>
                      <Td>{resposta == null || resposta === "" ? "—" : String(resposta)}</Td>
                    </Tr>
                  ))}
                </Table>
              </div>
            )}

            {selecionado.conversa && (
              <div>
                <p className="text-xs font-bold text-muted uppercase tracking-wide mb-2">Transcrição da conversa</p>
                <pre className="whitespace-pre-wrap text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-xl p-3 max-h-64 overflow-y-auto">{selecionado.conversa}</pre>
              </div>
            )}

            {isManager && (
              <div className="flex justify-end pt-1 border-t border-slate-100">
                <button
                  onClick={() => handleExcluir(selecionado)}
                  disabled={salvando}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-red-600 px-2 py-1.5 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50"
                >
                  <Trash2 size={13} /> Excluir chamado
                </button>
              </div>
            )}
          </div>
        </ModalShell>
      )}
    </>
  );
}

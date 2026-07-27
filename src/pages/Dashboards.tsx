import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { BarChart3, Download, Radio, Megaphone, Workflow, CalendarDays, ArchiveX, Percent as PercentIcon, BookmarkPlus, Trash2, Timer, Trophy, Package } from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
  AreaChart, Area, Line, LineChart,
} from "recharts";
import { toast } from "sonner";
import { Card, PageHeader, EmptyState, Select, Button, Spinner } from "../components/ui";
import { supabase } from "../lib/supabase";
import { exportarCsv } from "../lib/csv";
import { dateBR, pct } from "../lib/format";
import { useAuth } from "../context/AuthContext";

// Dashboards de leads — clone melhorado dos "Dashboards personalizados" do
// C2S (docs/C2S-SCAN.md §Relatórios: Leads por Canal/Fonte, período), com
// mais recortes: etapa do funil, motivos de arquivamento e % atendimento/
// semana (bônus — o C2S não tem essa visão) + "Análises salvas"
// (supabase/dashboards-analises.sql) pra guardar combinações de filtros.

type PeriodoDias = 7 | 30 | 90;
const PERIODOS: { dias: PeriodoDias; label: string }[] = [
  { dias: 7, label: "7 dias" },
  { dias: 30, label: "30 dias" },
  { dias: 90, label: "90 dias" },
];

interface LeadRow {
  id: string;
  nome: string;
  origem: string | null;
  fonte: string | null;
  canal: string | null;
  campanha: string | null;
  modulo: string | null;
  etapa: string | null;
  descartado: boolean | null;
  motivo_descarte: string | null;
  produto_interesse: string | null;
  score: number | null;
  created_at: string;
  primeiro_contato_em: string | null;
}

const moduloDeLead = (l: LeadRow): "seguros" | "consorcios" => (l.modulo === "consorcios" ? "consorcios" : "seguros");

type EtapaBucket = "novo" | "em_atendimento" | "proposta" | "ganho" | "perdido" | "arquivado";
const ETAPA_BUCKETS: { id: EtapaBucket; label: string; color: string }[] = [
  { id: "novo", label: "Novo / sem etapa", color: "#94A3B8" },
  { id: "em_atendimento", label: "Em atendimento", color: "#36ABE2" },
  { id: "proposta", label: "Proposta", color: "#F5B53D" },
  { id: "ganho", label: "Ganho", color: "#22C55E" },
  { id: "perdido", label: "Perdido", color: "#F87171" },
  { id: "arquivado", label: "Arquivado", color: "#EF4444" },
];
// Classificação sintética — o schema não tem uma coluna única "status do
// funil": arquivado = soft-delete do bolsão (descartado, ex.: spam/duplicado);
// ganho/perdido = etapas finais do kanban (perdido tem bucket próprio, igual
// o FunilConversao.tsx trata — é um desfecho do funil, não um descarte);
// proposta = leads em cotação/negociação; "em atendimento" é definido por
// primeiro_contato_em (igual o C2S faz, não por um valor fixo de etapa); o
// resto cai em "novo/sem etapa". Perdido é checado antes de descartado: um
// lead perdido pode ou não estar com `descartado` marcado (import histórico
// marca os dois — ver ImportarLeads.tsx), mas o desfecho "perdido" é sempre
// mais informativo que o genérico "arquivado".
function etapaBucket(l: LeadRow): EtapaBucket {
  if (l.etapa === "perdido") return "perdido";
  if (l.descartado) return "arquivado";
  if (l.etapa === "ganho") return "ganho";
  if (l.etapa === "negociacao" || l.etapa === "cotacao" || l.etapa === "proposta") return "proposta";
  if (l.primeiro_contato_em) return "em_atendimento";
  return "novo";
}

function fmtDiaMes(d: Date): string {
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// Agrupa por rótulo e mantém só o top N + "Outras" (soma do resto) — evita
// gráfico de barra com dezenas de categorias ilegíveis.
function groupTopN(labels: (string | null | undefined)[], fallback: string, n = 8): { label: string; total: number }[] {
  const map: Record<string, number> = {};
  for (const raw of labels) {
    const k = (raw || "").trim() || fallback;
    map[k] = (map[k] || 0) + 1;
  }
  const arr = Object.entries(map).map(([label, total]) => ({ label, total })).sort((a, b) => b.total - a.total);
  if (arr.length <= n) return arr;
  const outrasTotal = arr.slice(n).reduce((s, x) => s + x.total, 0);
  return [...arr.slice(0, n), { label: "Outras", total: outrasTotal }];
}

function porDiaData(leads: LeadRow[], dias: number): { dia: string; total: number }[] {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const map = new Map<string, number>();
  for (let i = dias - 1; i >= 0; i--) {
    const d = new Date(hoje);
    d.setDate(d.getDate() - i);
    map.set(d.toISOString().slice(0, 10), 0);
  }
  for (const l of leads) {
    const key = (l.created_at || "").slice(0, 10);
    if (map.has(key)) map.set(key, (map.get(key) ?? 0) + 1);
  }
  return Array.from(map.entries()).map(([key, total]) => {
    const [, m, d] = key.split("-");
    return { dia: `${d}/${m}`, total };
  });
}

function pctSemanalData(leads: LeadRow[], dias: number): { label: string; pct: number; total: number }[] {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const inicio = new Date(hoje);
  inicio.setDate(inicio.getDate() - (dias - 1));
  const nSemanas = Math.max(1, Math.ceil(dias / 7));
  const semanas = Array.from({ length: nSemanas }, (_, i) => {
    const ini = new Date(inicio);
    ini.setDate(ini.getDate() + i * 7);
    const fimBruto = new Date(ini);
    fimBruto.setDate(fimBruto.getDate() + 6);
    const fim = fimBruto > hoje ? hoje : fimBruto;
    return { label: `${fmtDiaMes(ini)}–${fmtDiaMes(fim)}`, total: 0, atendidos: 0 };
  });
  for (const l of leads) {
    const created = new Date(`${(l.created_at || "").slice(0, 10)}T00:00:00`);
    const diff = Math.floor((created.getTime() - inicio.getTime()) / 86400000);
    if (diff < 0) continue;
    const idx = Math.min(nSemanas - 1, Math.floor(diff / 7));
    semanas[idx].total += 1;
    if (l.primeiro_contato_em) semanas[idx].atendidos += 1;
  }
  return semanas.map((s) => ({ label: s.label, total: s.total, pct: s.total ? (s.atendidos / s.total) * 100 : 0 }));
}

// Formato humano de duração em minutos (ex.: 90 -> "1h 30min"; 45 -> "45min").
function fmtMinutos(min: number): string {
  const total = Math.max(0, Math.round(min));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}min`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}min`;
}

// Tempo médio de 1ª resposta por dia (minutos entre created_at e
// primeiro_contato_em) — só considera leads com os dois carimbos e diferença
// não-negativa; dias sem nenhum lead atendido ficam com minutos: null (o
// gráfico abre um vão e o tooltip mostra "—", igual pediu o requisito).
function tempoRespostaPorDiaData(leads: LeadRow[], dias: number): { dia: string; minutos: number | null }[] {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const map = new Map<string, { soma: number; n: number }>();
  for (let i = dias - 1; i >= 0; i--) {
    const d = new Date(hoje);
    d.setDate(d.getDate() - i);
    map.set(d.toISOString().slice(0, 10), { soma: 0, n: 0 });
  }
  for (const l of leads) {
    if (!l.primeiro_contato_em) continue;
    const key = (l.created_at || "").slice(0, 10);
    const entry = map.get(key);
    if (!entry) continue;
    const diffMin = (new Date(l.primeiro_contato_em).getTime() - new Date(l.created_at).getTime()) / 60000;
    if (!isFinite(diffMin) || diffMin < 0) continue;
    entry.soma += diffMin;
    entry.n += 1;
  }
  return Array.from(map.entries()).map(([key, { soma, n }]) => {
    const [, m, d] = key.split("-");
    return { dia: `${d}/${m}`, minutos: n > 0 ? soma / n : null };
  });
}

// Análise salva = snapshot dos filtros do dashboard (paridade com os
// "dashboards personalizados" do C2S). A tabela é opcional — se a migration
// supabase/dashboards-analises.sql não rodou ainda, escondemos a feature
// sem exibir nenhum banner novo (o aviso de parity já existente é sobre
// outra migration).
interface AnaliseConfig {
  periodo: PeriodoDias;
  moduloFiltro: "" | "seguros" | "consorcios";
}
interface AnaliseSalva {
  id: string;
  nome: string;
  config: AnaliseConfig;
}

const BRAND = "#1873BA";
const axisTick = { fontSize: 11, fill: "#94a3b8" };

function ChartCard({ icon: Icon, titulo, total, vazio, hintVazio, children }: {
  icon: LucideIcon; titulo: string; total: number; vazio: boolean; hintVazio?: string; children: ReactNode;
}) {
  return (
    <Card>
      <h3 className="text-lg text-ink mb-1 flex items-center gap-2">
        <Icon size={18} className="text-brand-500" /> {titulo} <span className="text-muted font-normal text-sm">({total})</span>
      </h3>
      {vazio ? (
        <EmptyState icon={Icon} title="Sem dados no período" hint={hintVazio} />
      ) : (
        <div style={{ height: 260 }} className="mt-3">{children}</div>
      )}
    </Card>
  );
}

export function Dashboards() {
  const { user } = useAuth();
  const [periodo, setPeriodo] = useState<PeriodoDias>(30);
  const [moduloFiltro, setModuloFiltro] = useState<"" | "seguros" | "consorcios">("");
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [avisoParity, setAvisoParity] = useState(false); // migration c2s-parity ainda não rodou

  // Análises salvas — some silenciosamente se a tabela não existir ainda.
  const [analises, setAnalises] = useState<AnaliseSalva[]>([]);
  const [analisesDisponiveis, setAnalisesDisponiveis] = useState(true);
  const [analiseSelecionadaId, setAnaliseSelecionadaId] = useState("");

  useEffect(() => {
    if (!supabase || !user) return;
    (async () => {
      const { data, error } = await supabase!
        .from("dashboards_analises")
        .select("id,nome,config")
        .order("created_at", { ascending: false });
      if (error) { setAnalisesDisponiveis(false); return; } // tabela ainda não existe (migration pendente)
      setAnalises((data ?? []) as unknown as AnaliseSalva[]);
    })();
  }, [user]);

  function aplicarAnalise(id: string) {
    setAnaliseSelecionadaId(id);
    if (!id) return;
    const analise = analises.find((a) => a.id === id);
    if (!analise) return;
    setPeriodo(analise.config.periodo);
    setModuloFiltro(analise.config.moduloFiltro);
  }

  async function salvarAnalise() {
    if (!supabase || !user) return;
    const nome = window.prompt("Nome da análise:", "");
    if (!nome || !nome.trim()) return;
    const config: AnaliseConfig = { periodo, moduloFiltro };
    const { data, error } = await supabase
      .from("dashboards_analises")
      .insert({ nome: nome.trim(), user_id: user.id, config })
      .select("id,nome,config")
      .single();
    if (error) { toast.error("Não foi possível salvar a análise."); return; }
    const nova = data as unknown as AnaliseSalva;
    setAnalises((prev) => [nova, ...prev]);
    setAnaliseSelecionadaId(nova.id);
    toast.success(`Análise "${nova.nome}" salva.`);
  }

  async function excluirAnalise() {
    if (!supabase || !analiseSelecionadaId) return;
    const analise = analises.find((a) => a.id === analiseSelecionadaId);
    if (!analise) return;
    if (!window.confirm(`Excluir a análise "${analise.nome}"?`)) return;
    const { error } = await supabase.from("dashboards_analises").delete().eq("id", analise.id);
    if (error) { toast.error("Não foi possível excluir a análise."); return; }
    setAnalises((prev) => prev.filter((a) => a.id !== analise.id));
    setAnaliseSelecionadaId("");
    toast.success("Análise excluída.");
  }

  // Colunas base sempre existem; fonte/campanha/canal/motivo_descarte vêm da
  // migration c2s-parity.sql. Sem ela, o select cheio dá 400 e zeraria a tela —
  // então caímos pras colunas base e mostramos o aviso (os gráficos por
  // fonte/campanha/motivo ficam com fallback "Sem ...", o resto funciona).
  const COLS_BASE = "id,nome,origem,modulo,etapa,descartado,score,created_at,primeiro_contato_em";
  const COLS_FULL = "id,nome,origem,fonte,canal,campanha,modulo,etapa,descartado,motivo_descarte,produto_interesse,score,created_at,primeiro_contato_em";

  // guarda de corrida: trocar o período rápido não pode deixar uma resposta
  // antiga sobrescrever a mais recente (mesmo padrão do Desempenho.tsx).
  const loadReq = useRef(0);
  useEffect(() => {
    let active = true;
    const req = ++loadReq.current;
    setLoading(true);
    (async () => {
      if (!supabase) { setLoading(false); return; }
      const desde = new Date(Date.now() - periodo * 86400000).toISOString();
      const q = (cols: string) => supabase!.from("leads").select(cols).gte("created_at", desde).limit(5000);
      let data: Partial<LeadRow>[] | null = null;
      let erro: unknown = null;
      let parity = false;
      {
        const full = await q(COLS_FULL);
        if (full.error) { // colunas novas não existem → tenta só as base
          parity = true;
          const base = await q(COLS_BASE);
          data = (base.data as Partial<LeadRow>[]) ?? null;
          erro = base.error;
        } else {
          data = (full.data as Partial<LeadRow>[]) ?? null;
        }
      }
      if (!active || req !== loadReq.current) return;
      if (erro) console.error("[dashboards]", erro);
      // as colunas novas podem faltar no fallback — normaliza pra LeadRow completo
      setLeads((data ?? []).map((r) => ({
        fonte: null, canal: null, campanha: null, motivo_descarte: null, produto_interesse: null, ...r,
      })) as LeadRow[]);
      setAvisoParity(parity);
      if (active && req === loadReq.current) setLoading(false);
    })();
    return () => { active = false; };
  }, [periodo]);

  const leadsFiltrados = useMemo(
    () => (moduloFiltro ? leads.filter((l) => moduloDeLead(l) === moduloFiltro) : leads),
    [leads, moduloFiltro]
  );

  const porFonte = useMemo(() => groupTopN(leadsFiltrados.map((l) => l.fonte || l.origem), "Sem fonte"), [leadsFiltrados]);
  const porCampanha = useMemo(() => groupTopN(leadsFiltrados.map((l) => l.campanha), "Sem campanha"), [leadsFiltrados]);
  const porEtapa = useMemo(() => {
    const cont: Record<EtapaBucket, number> = { novo: 0, em_atendimento: 0, proposta: 0, ganho: 0, perdido: 0, arquivado: 0 };
    for (const l of leadsFiltrados) cont[etapaBucket(l)] += 1;
    return ETAPA_BUCKETS.map((b) => ({ label: b.label, total: cont[b.id], color: b.color }));
  }, [leadsFiltrados]);
  const porDia = useMemo(() => porDiaData(leadsFiltrados, periodo), [leadsFiltrados, periodo]);
  const arquivados = useMemo(() => leadsFiltrados.filter((l) => l.descartado), [leadsFiltrados]);
  const porMotivo = useMemo(() => groupTopN(arquivados.map((l) => l.motivo_descarte), "Sem motivo"), [arquivados]);
  const porSemana = useMemo(() => pctSemanalData(leadsFiltrados, periodo), [leadsFiltrados, periodo]);
  const porTempoResposta = useMemo(() => tempoRespostaPorDiaData(leadsFiltrados, periodo), [leadsFiltrados, periodo]);
  const respostas = useMemo(
    () => leadsFiltrados.filter((l) => {
      if (!l.primeiro_contato_em) return false;
      const diff = new Date(l.primeiro_contato_em).getTime() - new Date(l.created_at).getTime();
      return isFinite(diff) && diff >= 0;
    }),
    [leadsFiltrados]
  );
  const ganhos = useMemo(() => leadsFiltrados.filter((l) => l.etapa === "ganho"), [leadsFiltrados]);
  const ganhosPorFonte = useMemo(() => groupTopN(ganhos.map((l) => l.fonte || l.origem), "Sem fonte"), [ganhos]);
  const ganhosPorProduto = useMemo(() => groupTopN(ganhos.map((l) => l.produto_interesse), "Sem produto"), [ganhos]);

  function exportar() {
    if (!leadsFiltrados.length) return;
    const linhas = leadsFiltrados.map((l) => ({
      nome: l.nome,
      modulo: moduloDeLead(l) === "consorcios" ? "Consórcios" : "Seguros",
      origem: l.origem || "",
      fonte: l.fonte || "",
      canal: l.canal || "",
      campanha: l.campanha || "",
      etapa: ETAPA_BUCKETS.find((b) => b.id === etapaBucket(l))?.label ?? "",
      score: l.score ?? "",
      criado_em: dateBR(l.created_at),
      primeiro_contato_em: l.primeiro_contato_em ? dateBR(l.primeiro_contato_em) : "",
      descartado: l.descartado ? "Sim" : "Não",
      motivo_descarte: l.motivo_descarte || "",
    }));
    exportarCsv(
      `leads-dashboard-${periodo}d-${new Date().toISOString().slice(0, 10)}`,
      [
        { chave: "nome", rotulo: "Nome" },
        { chave: "modulo", rotulo: "Módulo" },
        { chave: "origem", rotulo: "Origem" },
        { chave: "fonte", rotulo: "Fonte" },
        { chave: "canal", rotulo: "Canal" },
        { chave: "campanha", rotulo: "Campanha" },
        { chave: "etapa", rotulo: "Etapa" },
        { chave: "score", rotulo: "Score" },
        { chave: "criado_em", rotulo: "Criado em" },
        { chave: "primeiro_contato_em", rotulo: "1º contato em" },
        { chave: "descartado", rotulo: "Arquivado" },
        { chave: "motivo_descarte", rotulo: "Motivo do arquivamento" },
      ],
      linhas
    );
    toast.success(`${leadsFiltrados.length} lead(s) exportado(s).`);
  }

  return (
    <>
      <PageHeader
        title="Dashboards"
        subtitle="Análises de leads por fonte, campanha e funil"
        icon={BarChart3}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            {analisesDisponiveis && (
              <>
                <Select
                  value={analiseSelecionadaId}
                  onChange={aplicarAnalise}
                  placeholder="Análises salvas"
                  options={analises.map((a) => ({ value: a.id, label: a.nome }))}
                />
                {analiseSelecionadaId && (
                  <button
                    onClick={excluirAnalise}
                    title="Excluir análise"
                    aria-label="Excluir análise salva"
                    className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
                <Button variant="outline" icon={BookmarkPlus} onClick={salvarAnalise}>
                  Salvar análise
                </Button>
              </>
            )}
            <Select
              value={moduloFiltro}
              onChange={(v) => { setModuloFiltro(v as "" | "seguros" | "consorcios"); setAnaliseSelecionadaId(""); }}
              placeholder="Todos os módulos"
              options={[{ value: "seguros", label: "Seguros" }, { value: "consorcios", label: "Consórcios" }]}
            />
            <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
              {PERIODOS.map((p) => (
                <button
                  key={p.dias}
                  onClick={() => { setPeriodo(p.dias); setAnaliseSelecionadaId(""); }}
                  className={`text-xs font-bold px-3 py-1.5 rounded-lg transition-colors ${periodo === p.dias ? "bg-white shadow text-brand-600" : "text-slate-500 hover:text-slate-700"}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <Button variant="outline" icon={Download} onClick={exportar} disabled={!leadsFiltrados.length}>
              Exportar CSV
            </Button>
          </div>
        }
      />

      {avisoParity && (
        <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 flex items-start gap-2">
          <BarChart3 size={16} className="mt-0.5 shrink-0" />
          <span>Rode a migration <code className="font-mono">supabase/c2s-parity.sql</code> para desbloquear as análises por fonte, campanha e motivo de arquivamento. Os demais gráficos já funcionam.</span>
        </div>
      )}

      {loading ? (
        <Spinner label="Carregando leads..." />
      ) : leadsFiltrados.length === 0 ? (
        <Card pad={false}>
          <EmptyState icon={BarChart3} title="Sem leads no período" hint="Ajuste o período ou o módulo para ver as análises." />
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ChartCard icon={Radio} titulo="Leads por Fonte" total={leadsFiltrados.length} vazio={porFonte.length === 0}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={porFonte} margin={{ top: 8, right: 8, left: -10, bottom: 24 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
                <XAxis dataKey="label" tick={axisTick} axisLine={false} tickLine={false} angle={-25} textAnchor="end" interval={0} height={50} />
                <YAxis tick={axisTick} axisLine={false} tickLine={false} allowDecimals={false} width={30} />
                <Tooltip />
                <Bar dataKey="total" fill={BRAND} radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard icon={Megaphone} titulo="Leads por Campanha" total={leadsFiltrados.length} vazio={porCampanha.length === 0}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={porCampanha} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" horizontal={false} />
                <XAxis type="number" tick={axisTick} axisLine={false} tickLine={false} allowDecimals={false} />
                <YAxis type="category" dataKey="label" tick={axisTick} axisLine={false} tickLine={false} width={140} />
                <Tooltip />
                <Bar dataKey="total" fill="#36ABE2" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard icon={Workflow} titulo="Leads por Etapa do Funil" total={leadsFiltrados.length} vazio={false}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={porEtapa} margin={{ top: 8, right: 8, left: -10, bottom: 24 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
                <XAxis dataKey="label" tick={axisTick} axisLine={false} tickLine={false} angle={-20} textAnchor="end" interval={0} height={50} />
                <YAxis tick={axisTick} axisLine={false} tickLine={false} allowDecimals={false} width={30} />
                <Tooltip />
                <Bar dataKey="total" radius={[6, 6, 0, 0]}>
                  {porEtapa.map((e, i) => <Cell key={i} fill={e.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard icon={CalendarDays} titulo="Leads por Dia" total={leadsFiltrados.length} vazio={false}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={porDia} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="gDia" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={BRAND} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={BRAND} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                <XAxis dataKey="dia" tick={axisTick} axisLine={false} tickLine={false} interval={periodo > 30 ? Math.ceil(periodo / 15) : 0} />
                <YAxis tick={axisTick} axisLine={false} tickLine={false} allowDecimals={false} width={30} />
                <Tooltip />
                <Area type="monotone" dataKey="total" stroke={BRAND} strokeWidth={2.5} fill="url(#gDia)" />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard icon={ArchiveX} titulo="Motivos de Arquivamento" total={arquivados.length} vazio={porMotivo.length === 0} hintVazio="Nenhum lead arquivado neste período.">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={porMotivo} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" horizontal={false} />
                <XAxis type="number" tick={axisTick} axisLine={false} tickLine={false} allowDecimals={false} />
                <YAxis type="category" dataKey="label" tick={axisTick} axisLine={false} tickLine={false} width={140} />
                <Tooltip />
                <Bar dataKey="total" fill="#EF4444" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard icon={PercentIcon} titulo="% Atendimento por Semana" total={leadsFiltrados.length} vazio={false}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={porSemana} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
                <XAxis dataKey="label" tick={axisTick} axisLine={false} tickLine={false} />
                <YAxis tick={axisTick} axisLine={false} tickLine={false} domain={[0, 100]} tickFormatter={(v) => `${v}%`} width={40} />
                <Tooltip formatter={(v: number) => pct(v, 0)} />
                <Bar dataKey="pct" fill="#22C55E" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard icon={Timer} titulo="Tempo médio de 1ª resposta" total={respostas.length} vazio={respostas.length === 0} hintVazio="Nenhum lead com 1º contato registrado neste período.">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={porTempoResposta} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                <XAxis dataKey="dia" tick={axisTick} axisLine={false} tickLine={false} interval={periodo > 30 ? Math.ceil(periodo / 15) : 0} />
                <YAxis tick={axisTick} axisLine={false} tickLine={false} allowDecimals={false} width={30} tickFormatter={(v) => `${v}min`} />
                <Tooltip formatter={(v) => (v == null ? "—" : fmtMinutos(Number(v)))} labelFormatter={(l) => `Dia ${l}`} />
                <Line type="monotone" dataKey="minutos" stroke={BRAND} strokeWidth={2.5} dot={{ r: 2 }} connectNulls={false} />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard icon={Trophy} titulo="Negócios Ganhos por Fonte" total={ganhos.length} vazio={ganhosPorFonte.length === 0} hintVazio="Nenhum negócio ganho neste período.">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={ganhosPorFonte} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" horizontal={false} />
                <XAxis type="number" tick={axisTick} axisLine={false} tickLine={false} allowDecimals={false} />
                <YAxis type="category" dataKey="label" tick={axisTick} axisLine={false} tickLine={false} width={140} />
                <Tooltip />
                <Bar dataKey="total" fill="#22C55E" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard icon={Package} titulo="Negócios Ganhos por Produto" total={ganhos.length} vazio={ganhosPorProduto.length === 0} hintVazio="Nenhum negócio ganho neste período.">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={ganhosPorProduto} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" horizontal={false} />
                <XAxis type="number" tick={axisTick} axisLine={false} tickLine={false} allowDecimals={false} />
                <YAxis type="category" dataKey="label" tick={axisTick} axisLine={false} tickLine={false} width={140} />
                <Tooltip />
                <Bar dataKey="total" fill="#22C55E" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>
      )}
    </>
  );
}

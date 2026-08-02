import { useEffect, useMemo, useRef, useState } from "react";
import { Gauge, Users, CheckCircle2, Clock, AlertTriangle, Zap, Download } from "lucide-react";
import { PageHeader, Card, KpiCard, Spinner, EmptyState, Select, Badge, Button } from "../components/ui";
import { supabase } from "../lib/supabase";
import { useAuth, type Role, type TeamUser } from "../context/AuthContext";
import { can } from "../lib/permissoes";
import { pct } from "../lib/format";
import { exportarCsv } from "../lib/csv";

// Métricas de desempenho por consultor — clone do relatório "Métricas de
// desempenho" do C2S (docs/C2S-SCAN.md §Relatórios), calculado no cliente a
// partir de leads.created_at → leads.primeiro_contato_em.

type PeriodoDias = 7 | 30 | 90;
const PERIODOS: { dias: PeriodoDias; label: string }[] = [
  { dias: 7, label: "7 dias" },
  { dias: 30, label: "30 dias" },
  { dias: 90, label: "90 dias" },
];

interface LeadRow {
  id: string;
  nome: string;
  vendedor_id: string | null;
  modulo: string | null;
  etapa: string | null;
  descartado: boolean | null;
  created_at: string;
  primeiro_contato_em: string | null;
}
interface Equipe { id: string; name: string; role: string | null; permissoes?: Record<string, boolean> | null }

// Uma visita já normalizada: quem responde por ela, de que módulo é o lead e as
// duas datas que interessam (quando foi agendada / quando foi realizada).
interface VisitaRow {
  userId: string | null;
  modulo: string | null;
  criadaEm: string | null;
  concluidaEm: string | null;
  concluida: boolean;
}

// lead_atividades pode não existir (migration supabase/c2s-parity.sql não rodada)
// — nesse caso o relatório perde as colunas de visita, mas não quebra.
function normalizarVisitas(res: { data: unknown; error: unknown } | null): VisitaRow[] {
  if (!res || res.error || !Array.isArray(res.data)) return [];
  return (res.data as Record<string, any>[]).map((a) => {
    // embed to-one do PostgREST vem como objeto, mas defensivo contra array de 1
    const lead = Array.isArray(a.lead) ? a.lead[0] : a.lead;
    return {
      // A visita conta pro dono do lead; se o lead sumiu do alcance, cai pra
      // quem criou a atividade (na prática é o próprio consultor).
      userId: lead?.vendedor_id ?? a.criado_por ?? null,
      modulo: lead?.modulo ?? null,
      criadaEm: a.created_at ?? null,
      concluidaEm: a.concluida_em ?? null,
      concluida: a.status === "concluida",
    };
  });
}

// visível como TeamUser só o suficiente pra can() avaliar visivel_relatorios
const comoTeamUser = (u: Equipe): TeamUser => ({ id: u.id, email: "", name: u.name, role: (u.role as Role) ?? "vendedor", permissoes: u.permissoes });

interface LinhaConsultor {
  id: string;
  nome: string;
  role: string | null;
  recebidos: number;
  atendidos: number;
  pctAtendido: number;
  tempoMedioMin: number | null;
  maisRapidoMin: number | null;
  maisLentoMin: number | null;
  visitasAgendadas: number;
  visitasRealizadas: number;
  fechados: number;
  arquivados: number;
}

// Linha só entra no CSV / tira a tela do vazio se tiver algum número
const temDados = (l: LinhaConsultor) => l.recebidos > 0 || l.visitasAgendadas > 0 || l.visitasRealizadas > 0;

// "12min" / "1h20" / "2h" — mais compacto que minutosLabel() (usado nos avisos/config)
// porque aqui aparece repetido numa tabela inteira.
function formatarTempo(min: number): string {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  const resto = m % 60;
  return resto > 0 ? `${h}h${resto}` : `${h}h`;
}

const normalizarModulo = (m: string | null): "seguros" | "consorcios" => (m === "consorcios" ? "consorcios" : "seguros");
const moduloDeLead = (l: LeadRow) => normalizarModulo(l.modulo);

export function Desempenho() {
  const { user } = useAuth();
  const podeExtrair = can(user, "extrair_relatorios");
  const [periodo, setPeriodo] = useState<PeriodoDias>(30);
  const [moduloFiltro, setModuloFiltro] = useState<"" | "seguros" | "consorcios">("");
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [visitas, setVisitas] = useState<VisitaRow[]>([]);
  const [equipe, setEquipe] = useState<Equipe[]>([]);
  const [loading, setLoading] = useState(true);

  // guarda de corrida: trocar o período/módulo rápido não pode deixar uma
  // resposta antiga sobrescrever a mais recente.
  const loadReq = useRef(0);
  useEffect(() => {
    let active = true;
    const req = ++loadReq.current;
    setLoading(true);
    (async () => {
      if (!supabase) { setLoading(false); return; }
      try {
        const desde = new Date(Date.now() - periodo * 86400000).toISOString();
        const [leadsR, visitasR, equipeR] = await Promise.all([
          supabase.from("leads")
            .select("id,nome,vendedor_id,modulo,etapa,descartado,created_at,primeiro_contato_em")
            .gte("created_at", desde)
            .limit(5000),
          // Visitas (C2S §Relatórios "Visitas e Negócios Fechados"). O filtro é OR
          // porque uma visita agendada ANTES do período pode ter sido realizada
          // DENTRO dele — filtrar só por created_at perderia a coluna de realizadas.
          supabase.from("lead_atividades")
            .select("id,status,created_at,concluida_em,criado_por,lead:leads(vendedor_id,modulo)")
            .eq("tipo", "visita")
            .or(`created_at.gte.${desde},concluida_em.gte.${desde}`)
            .limit(5000),
          supabase.from("profiles").select("id,name,role,permissoes")
            .in("role", ["vendedor", "gestor", "admin"]).order("name"),
        ]);
        if (!active || req !== loadReq.current) return;
        setLeads((leadsR.data as LeadRow[]) ?? []);
        setVisitas(normalizarVisitas(visitasR));
        // "Visível nos relatórios" (paridade C2S): consultor com a permissão
        // desligada some das linhas do relatório, mesmo que tenha leads.
        const todaEquipe = (equipeR.data as Equipe[]) ?? [];
        setEquipe(todaEquipe.filter((u) => can(comoTeamUser(u), "visivel_relatorios")));
      } catch (e) {
        console.error("[desempenho]", e);
      } finally {
        if (active && req === loadReq.current) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [periodo, moduloFiltro]);

  const leadsFiltrados = useMemo(
    () => (moduloFiltro ? leads.filter((l) => moduloDeLead(l) === moduloFiltro) : leads),
    [leads, moduloFiltro]
  );

  // Agendadas = criadas no período; realizadas = concluídas no período. São
  // janelas diferentes sobre a MESMA linha, por isso os dois contadores juntos.
  const visitasPorConsultor = useMemo(() => {
    const desdeMs = Date.now() - periodo * 86400000;
    const mapa = new Map<string, { agendadas: number; realizadas: number }>();
    for (const v of visitas) {
      if (!v.userId) continue;
      if (moduloFiltro && normalizarModulo(v.modulo) !== moduloFiltro) continue;
      const acc = mapa.get(v.userId) ?? { agendadas: 0, realizadas: 0 };
      if (v.criadaEm && new Date(v.criadaEm).getTime() >= desdeMs) acc.agendadas++;
      if (v.concluida && v.concluidaEm && new Date(v.concluidaEm).getTime() >= desdeMs) acc.realizadas++;
      mapa.set(v.userId, acc);
    }
    return mapa;
  }, [visitas, moduloFiltro, periodo]);

  const linhas: LinhaConsultor[] = useMemo(() => {
    const porVendedor = new Map<string, LeadRow[]>();
    for (const l of leadsFiltrados) {
      if (!l.vendedor_id) continue;
      const arr = porVendedor.get(l.vendedor_id) ?? [];
      arr.push(l);
      porVendedor.set(l.vendedor_id, arr);
    }
    const rows = equipe.map((u): LinhaConsultor => {
      const meus = porVendedor.get(u.id) ?? [];
      const vis = visitasPorConsultor.get(u.id);
      const atendidosLeads = meus.filter((l) => l.primeiro_contato_em);
      const tempos = atendidosLeads.map((l) => (new Date(l.primeiro_contato_em!).getTime() - new Date(l.created_at).getTime()) / 60000).filter((n) => n >= 0);
      const tempoMedio = tempos.length ? tempos.reduce((a, b) => a + b, 0) / tempos.length : null;
      return {
        id: u.id,
        nome: u.name,
        role: u.role,
        recebidos: meus.length,
        atendidos: atendidosLeads.length,
        pctAtendido: meus.length ? (atendidosLeads.length / meus.length) * 100 : 0,
        tempoMedioMin: tempoMedio,
        maisRapidoMin: tempos.length ? Math.min(...tempos) : null,
        maisLentoMin: tempos.length ? Math.max(...tempos) : null,
        visitasAgendadas: vis?.agendadas ?? 0,
        visitasRealizadas: vis?.realizadas ?? 0,
        fechados: meus.filter((l) => l.etapa === "ganho").length,
        arquivados: meus.filter((l) => l.descartado).length,
      };
    });
    // Melhor (tempo médio menor) primeiro; quem não atendeu nada vai pro fim.
    return rows.sort((a, b) => {
      if (a.tempoMedioMin == null && b.tempoMedioMin == null) return b.recebidos - a.recebidos;
      if (a.tempoMedioMin == null) return 1;
      if (b.tempoMedioMin == null) return -1;
      return a.tempoMedioMin - b.tempoMedioMin;
    });
  }, [leadsFiltrados, equipe, visitasPorConsultor]);

  const melhorId = linhas.find((l) => l.tempoMedioMin != null)?.id ?? null;

  function exportar() {
    if (!podeExtrair) return;
    const linhasComDados = linhas.filter(temDados);
    if (!linhasComDados.length) return;
    const dados = linhasComDados.map((l) => ({
      nome: l.nome,
      papel: l.role === "admin" ? "Administrador" : l.role === "gestor" ? "Gestor" : "Vendedor",
      recebidos: l.recebidos,
      atendidos: l.atendidos,
      pctAtendido: pct(l.pctAtendido, 0),
      tempoMedio: l.tempoMedioMin != null ? formatarTempo(l.tempoMedioMin) : "—",
      maisRapido: l.maisRapidoMin != null ? formatarTempo(l.maisRapidoMin) : "—",
      maisLento: l.maisLentoMin != null ? formatarTempo(l.maisLentoMin) : "—",
      visitasAgendadas: l.visitasAgendadas,
      visitasRealizadas: l.visitasRealizadas,
      fechados: l.fechados,
      arquivados: l.arquivados,
    }));
    exportarCsv(
      `desempenho-${periodo}d-${new Date().toISOString().slice(0, 10)}`,
      [
        { chave: "nome", rotulo: "Consultor" },
        { chave: "papel", rotulo: "Papel" },
        { chave: "recebidos", rotulo: "Recebidos" },
        { chave: "atendidos", rotulo: "Atendidos" },
        { chave: "pctAtendido", rotulo: "% Atendido" },
        { chave: "tempoMedio", rotulo: "Tempo Médio" },
        { chave: "maisRapido", rotulo: "Mais Rápido" },
        { chave: "maisLento", rotulo: "Mais Lento" },
        { chave: "visitasAgendadas", rotulo: "Visitas Agendadas" },
        { chave: "visitasRealizadas", rotulo: "Visitas Realizadas" },
        { chave: "fechados", rotulo: "Fechados" },
        { chave: "arquivados", rotulo: "Arquivados" },
      ],
      dados
    );
  }

  const kpis = useMemo(() => {
    const total = leadsFiltrados.length;
    const atendidos = leadsFiltrados.filter((l) => l.primeiro_contato_em).length;
    const tempos = leadsFiltrados
      .filter((l) => l.primeiro_contato_em)
      .map((l) => (new Date(l.primeiro_contato_em!).getTime() - new Date(l.created_at).getTime()) / 60000)
      .filter((n) => n >= 0);
    const tempoMedio = tempos.length ? tempos.reduce((a, b) => a + b, 0) / tempos.length : null;
    const semAtendimento = leadsFiltrados.filter((l) => !l.primeiro_contato_em && !l.descartado).length;
    return { total, pctAtendido: total ? (atendidos / total) * 100 : 0, tempoMedio, semAtendimento };
  }, [leadsFiltrados]);

  return (
    <>
      <PageHeader
        title="Desempenho da Equipe"
        subtitle="Tempo de resposta e atendimento por consultor"
        icon={Gauge}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <Select
              value={moduloFiltro}
              onChange={(v) => setModuloFiltro(v as "" | "seguros" | "consorcios")}
              placeholder="Todos os módulos"
              options={[{ value: "seguros", label: "Seguros" }, { value: "consorcios", label: "Consórcios" }]}
            />
            <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
              {PERIODOS.map((p) => (
                <button
                  key={p.dias}
                  onClick={() => setPeriodo(p.dias)}
                  className={`text-xs font-bold px-3 py-1.5 rounded-lg transition-colors ${periodo === p.dias ? "bg-white shadow text-brand-600" : "text-slate-500 hover:text-slate-700"}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {podeExtrair && (
              <Button variant="outline" icon={Download} onClick={exportar} disabled={!linhas.some(temDados)}>
                Exportar CSV
              </Button>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KpiCard label="Leads Recebidos" value={String(kpis.total)} hint={`Últimos ${periodo} dias`} icon={Users} accent="brand" />
        <KpiCard label="% Atendidos" value={pct(kpis.pctAtendido, 0)} icon={CheckCircle2} accent="success" />
        <KpiCard label="Tempo Médio de 1ª Resposta" value={kpis.tempoMedio != null ? formatarTempo(kpis.tempoMedio) : "—"} icon={Clock} accent="sky" />
        <KpiCard label="Sem Atendimento Agora" value={String(kpis.semAtendimento)} icon={AlertTriangle} accent={kpis.semAtendimento > 0 ? "danger" : "brand"} />
      </div>

      {loading ? (
        <Spinner label="Calculando desempenho..." />
      ) : !linhas.some(temDados) ? (
        <Card pad={false}>
          <EmptyState icon={Gauge} title="Sem dados no período" hint="Nenhum lead recebido nem visita registrada. Ajuste o período ou o módulo para ver o desempenho da equipe." />
        </Card>
      ) : (
        <Card pad={false}>
          <div className="p-2 overflow-x-auto">
            <table className="w-full text-sm min-w-[1080px]">
              <thead>
                <tr className="text-left text-muted border-b border-slate-200">
                  <th className="font-bold text-xs uppercase tracking-wide py-3 px-3">Consultor</th>
                  <th className="font-bold text-xs uppercase tracking-wide py-3 px-3 text-right">Recebidos</th>
                  <th className="font-bold text-xs uppercase tracking-wide py-3 px-3 text-right">Atendidos</th>
                  <th className="font-bold text-xs uppercase tracking-wide py-3 px-3 min-w-[140px]">% Atendido</th>
                  <th className="font-bold text-xs uppercase tracking-wide py-3 px-3 text-right">Tempo Médio</th>
                  <th className="font-bold text-xs uppercase tracking-wide py-3 px-3 text-right">Mais Rápido</th>
                  <th className="font-bold text-xs uppercase tracking-wide py-3 px-3 text-right">Mais Lento</th>
                  <th className="font-bold text-xs uppercase tracking-wide py-3 px-3 text-right">Visitas Agendadas</th>
                  <th className="font-bold text-xs uppercase tracking-wide py-3 px-3 text-right">Visitas Realizadas</th>
                  <th className="font-bold text-xs uppercase tracking-wide py-3 px-3 text-right">Fechados</th>
                  <th className="font-bold text-xs uppercase tracking-wide py-3 px-3 text-right">Arquivados</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((l) => (
                  <tr key={l.id} className="border-b border-slate-100 hover:bg-slate-50/60 transition-colors">
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-ink">{l.nome}</span>
                        {l.id === melhorId && (
                          <Badge tone="green"><Zap size={11} /> mais rápido</Badge>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-3 text-right text-ink">{l.recebidos}</td>
                    <td className="py-3 px-3 text-right text-ink">{l.atendidos}</td>
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden min-w-[70px]">
                          <div className="h-full rounded-full bg-brand-500" style={{ width: `${Math.min(100, l.pctAtendido)}%` }} />
                        </div>
                        <span className="text-xs text-muted w-9 text-right shrink-0">{pct(l.pctAtendido, 0)}</span>
                      </div>
                    </td>
                    <td className="py-3 px-3 text-right font-semibold text-ink">{l.tempoMedioMin != null ? formatarTempo(l.tempoMedioMin) : "—"}</td>
                    <td className="py-3 px-3 text-right text-green-600">{l.maisRapidoMin != null ? formatarTempo(l.maisRapidoMin) : "—"}</td>
                    <td className="py-3 px-3 text-right text-amber-600">{l.maisLentoMin != null ? formatarTempo(l.maisLentoMin) : "—"}</td>
                    <td className="py-3 px-3 text-right text-ink">{l.visitasAgendadas || "—"}</td>
                    <td className="py-3 px-3 text-right font-semibold text-ink">
                      {l.visitasRealizadas > 0 ? (
                        <span className="text-green-600">{l.visitasRealizadas}</span>
                      ) : (
                        <span className="text-muted font-normal">—</span>
                      )}
                    </td>
                    <td className="py-3 px-3 text-right text-ink">{l.fechados}</td>
                    <td className="py-3 px-3 text-right text-muted">{l.arquivados}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}

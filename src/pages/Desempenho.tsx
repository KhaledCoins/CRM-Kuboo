import { useEffect, useMemo, useRef, useState } from "react";
import { Gauge, Users, CheckCircle2, Clock, AlertTriangle, Zap } from "lucide-react";
import { PageHeader, Card, KpiCard, Spinner, EmptyState, Select, Badge } from "../components/ui";
import { supabase } from "../lib/supabase";
import { listarEquipe } from "../lib/c2s";
import { pct } from "../lib/format";

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
interface Equipe { id: string; name: string; role: string | null }

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
  fechados: number;
  arquivados: number;
}

// "12min" / "1h20" / "2h" — mais compacto que minutosLabel() (usado nos avisos/config)
// porque aqui aparece repetido numa tabela inteira.
function formatarTempo(min: number): string {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  const resto = m % 60;
  return resto > 0 ? `${h}h${resto}` : `${h}h`;
}

const moduloDeLead = (l: LeadRow): "seguros" | "consorcios" => (l.modulo === "consorcios" ? "consorcios" : "seguros");

export function Desempenho() {
  const [periodo, setPeriodo] = useState<PeriodoDias>(30);
  const [moduloFiltro, setModuloFiltro] = useState<"" | "seguros" | "consorcios">("");
  const [leads, setLeads] = useState<LeadRow[]>([]);
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
        const [leadsR, equipeR] = await Promise.all([
          supabase.from("leads")
            .select("id,nome,vendedor_id,modulo,etapa,descartado,created_at,primeiro_contato_em")
            .gte("created_at", desde)
            .limit(5000),
          listarEquipe(),
        ]);
        if (!active || req !== loadReq.current) return;
        setLeads((leadsR.data as LeadRow[]) ?? []);
        setEquipe(equipeR);
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
  }, [leadsFiltrados, equipe]);

  const melhorId = linhas.find((l) => l.tempoMedioMin != null)?.id ?? null;

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
      ) : linhas.every((l) => l.recebidos === 0) ? (
        <Card pad={false}>
          <EmptyState icon={Gauge} title="Sem leads no período" hint="Ajuste o período ou o módulo para ver o desempenho da equipe." />
        </Card>
      ) : (
        <Card pad={false}>
          <div className="p-2 overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead>
                <tr className="text-left text-muted border-b border-slate-200">
                  <th className="font-bold text-xs uppercase tracking-wide py-3 px-3">Consultor</th>
                  <th className="font-bold text-xs uppercase tracking-wide py-3 px-3 text-right">Recebidos</th>
                  <th className="font-bold text-xs uppercase tracking-wide py-3 px-3 text-right">Atendidos</th>
                  <th className="font-bold text-xs uppercase tracking-wide py-3 px-3 min-w-[140px]">% Atendido</th>
                  <th className="font-bold text-xs uppercase tracking-wide py-3 px-3 text-right">Tempo Médio</th>
                  <th className="font-bold text-xs uppercase tracking-wide py-3 px-3 text-right">Mais Rápido</th>
                  <th className="font-bold text-xs uppercase tracking-wide py-3 px-3 text-right">Mais Lento</th>
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

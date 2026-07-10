import { useEffect, useMemo, useState } from "react";
import { Layers, DollarSign, Award, TrendingUp, Building2, PieChart as PieIcon, CalendarDays } from "lucide-react";
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend } from "recharts";
import { Card, KpiCard, PageHeader, EmptyState, Badge } from "../components/ui";
import { FunilConversaoCard } from "../components/FunilConversao";
import { brl, dateBR } from "../lib/format";
import { supabase } from "../lib/supabase";
import { fetchLeads, moduloDe, type Lead } from "../lib/leads";

interface Cota { valor_credito: number | null; administradora: string | null; tipo: string | null; status: string | null; created_at?: string | null; }
interface Grupo { id: string; administradora: string | null; numero: string | null; tipo: string | null; proxima_assembleia: string | null; participantes: number | null; }

function groupTop(rows: Cota[], key: keyof Cota, n = 5) {
  const map: Record<string, number> = {};
  for (const r of rows) { const k = (r[key] as string) || "—"; map[k] = (map[k] || 0) + (Number(r.valor_credito) || 0); }
  return Object.entries(map).map(([label, total]) => ({ label, total })).sort((a, b) => b.total - a.total).slice(0, n);
}

function BarList({ items, color }: { items: { label: string; total: number }[]; color: string }) {
  const max = Math.max(...items.map((i) => i.total), 1);
  return (
    <div className="p-5 pt-3 space-y-3">
      {items.map((it) => (
        <div key={it.label}>
          <div className="flex justify-between text-sm mb-1"><span className="text-ink font-medium truncate">{it.label}</span><span className="text-muted">{brl(it.total)}</span></div>
          <div className="h-2 bg-slate-100 rounded-full overflow-hidden"><div className="h-full rounded-full" style={{ width: `${(it.total / max) * 100}%`, background: color }} /></div>
        </div>
      ))}
    </div>
  );
}

const PIE_COLORS = ["#1873BA", "#2DD4A7", "#F5B53D", "#EC7000", "#7C3AED"];
function PieDist({ items }: { items: { label: string; total: number }[] }) {
  return (
    <div className="p-3" style={{ height: 250 }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={items} dataKey="total" nameKey="label" cx="50%" cy="50%" innerRadius={45} outerRadius={80} paddingAngle={2}>
            {items.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
          </Pie>
          <Tooltip formatter={(v: number) => brl(v)} />
          <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

export function DashboardConsorcios() {
  const [cotas, setCotas] = useState<Cota[]>([]);
  const [grupos, setGrupos] = useState<Grupo[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!supabase) { setLoading(false); return; }
      try {
        const hoje = new Date().toISOString().slice(0, 10);
        const [cotasR, gruposR, ls] = await Promise.all([
          supabase.from("cotas").select("valor_credito,administradora,tipo,status,created_at").limit(3000),
          supabase.from("grupos").select("id,administradora,numero,tipo,proxima_assembleia,participantes")
            .not("proxima_assembleia", "is", null).gte("proxima_assembleia", hoje)
            .order("proxima_assembleia", { ascending: true }).limit(6),
          fetchLeads(),
        ]);
        if (!active) return;
        setCotas(cotasR.data || []); setGrupos(gruposR.data || []); setLeads(ls);
      } catch (e) {
        console.error("[dashboard-consorcios]", e);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  const m = useMemo(() => {
    const mesPrefix = new Date().toISOString().slice(0, 7);
    let credito = 0, ativas = 0, contempladas = 0, nMes = 0, creditoMes = 0;
    for (const c of cotas) {
      const v = Number(c.valor_credito) || 0;
      credito += v;
      if (c.status === "ativa") ativas += 1;
      if (c.status === "contemplada") contempladas += 1;
      if ((c.created_at || "").slice(0, 7) === mesPrefix) { nMes += 1; creditoMes += v; }
    }
    return {
      credito, ativas, contempladas, nMes, creditoMes, total: cotas.length,
      medio: cotas.length ? credito / cotas.length : 0,
      porAdmin: groupTop(cotas, "administradora"), porTipo: groupTop(cotas, "tipo"),
    };
  }, [cotas]);

  const temDados = cotas.length > 0;
  const diasAte = (s: string) => Math.ceil((new Date(s).getTime() - Date.now()) / 86400000);

  return (
    <>
      <PageHeader title="Dashboard" subtitle="Visão geral — Consórcios" icon={Layers} />

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <KpiCard label="Cotas Ativas" value={String(m.ativas)} hint={`${m.total} no total`} icon={Layers} accent="brand" />
        <KpiCard label="Novas no Mês" value={String(m.nMes)} hint={brl(m.creditoMes)} icon={TrendingUp} accent="success" />
        <KpiCard label="Crédito Comercializado" value={brl(m.credito)} hint={`Médio ${brl(m.medio)} por cota`} icon={DollarSign} accent="sky" />
        <KpiCard label="Contemplações" value={String(m.contempladas)} hint="Cotas contempladas" icon={Award} accent="warning" />
      </div>

      <FunilConversaoCard leads={leads.filter((l) => moduloDe(l) === "consorcios")} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card pad={false}>
          <div className="p-5 pb-0"><h3 className="text-lg text-ink flex items-center gap-2"><Building2 size={18} className="text-brand-500" /> Crédito por Administradora</h3></div>
          {temDados ? <BarList items={m.porAdmin} color="#1873BA" /> : <EmptyState icon={Building2} title="Nenhuma cota cadastrada" hint="Cadastre cotas em Consórcios → Cotas para ver os números aqui." />}
        </Card>
        <Card pad={false}>
          <div className="p-5 pb-0"><h3 className="text-lg text-ink flex items-center gap-2"><PieIcon size={18} className="text-brand-500" /> Crédito por Tipo de Bem</h3></div>
          {temDados ? <PieDist items={m.porTipo} /> : <EmptyState icon={PieIcon} title="Nenhuma cota cadastrada" />}
        </Card>
        <Card pad={false} className="lg:col-span-2">
          <div className="p-5 pb-0"><h3 className="text-lg text-ink flex items-center gap-2"><CalendarDays size={18} className="text-brand-500" /> Próximas Assembleias</h3></div>
          {grupos.length ? (
            <div className="p-5 pt-3 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {grupos.map((g) => {
                const d = g.proxima_assembleia ? diasAte(g.proxima_assembleia) : null;
                return (
                  <div key={g.id} className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <p className="font-bold text-ink text-sm">Grupo {g.numero || "—"}</p>
                      {d != null && <Badge tone={d <= 7 ? "amber" : "slate"}>{d === 0 ? "hoje" : `em ${d}d`}</Badge>}
                    </div>
                    <p className="text-xs text-muted">{g.administradora || "—"}{g.tipo ? ` · ${g.tipo}` : ""}</p>
                    <p className="text-xs text-muted mt-1">{dateBR(g.proxima_assembleia)}{g.participantes ? ` · ${g.participantes} participantes` : ""}</p>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState icon={CalendarDays} title="Nenhuma assembleia agendada" hint="Cadastre grupos com a próxima assembleia em Consórcios → Grupos & Assembleias." />
          )}
        </Card>
      </div>
      {loading && <p className="text-xs text-muted mt-4">Carregando…</p>}
    </>
  );
}

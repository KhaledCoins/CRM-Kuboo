import { useEffect, useMemo, useState } from "react";
import { Layers, DollarSign, Award, TrendingUp, Building2, PieChart as PieIcon } from "lucide-react";
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend } from "recharts";
import { Card, KpiCard, PageHeader, EmptyState } from "../components/ui";
import { brl } from "../lib/format";
import { supabase } from "../lib/supabase";

interface Cota { valor_credito: number | null; administradora: string | null; tipo: string | null; status: string | null; }

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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!supabase) { setLoading(false); return; }
      const { data } = await supabase.from("cotas").select("valor_credito,administradora,tipo,status").limit(3000);
      if (!active) return;
      setCotas(data || []); setLoading(false);
    })();
    return () => { active = false; };
  }, []);

  const m = useMemo(() => {
    let credito = 0, ativas = 0, contempladas = 0;
    for (const c of cotas) {
      credito += Number(c.valor_credito) || 0;
      if (c.status === "ativa") ativas += 1;
      if (c.status === "contemplada") contempladas += 1;
    }
    return {
      credito, ativas, contempladas, total: cotas.length,
      medio: cotas.length ? credito / cotas.length : 0,
      porAdmin: groupTop(cotas, "administradora"), porTipo: groupTop(cotas, "tipo"),
    };
  }, [cotas]);

  const temDados = cotas.length > 0;

  return (
    <>
      <PageHeader title="Dashboard" subtitle="Visão geral — Consórcios" icon={Layers} />

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <KpiCard label="Cotas Ativas" value={String(m.ativas)} hint={`${m.total} no total`} icon={Layers} accent="brand" />
        <KpiCard label="Crédito Comercializado" value={brl(m.credito)} hint="Soma das cartas" icon={DollarSign} accent="success" />
        <KpiCard label="Contemplações" value={String(m.contempladas)} hint="Cotas contempladas" icon={Award} accent="warning" />
        <KpiCard label="Crédito Médio" value={brl(m.medio)} hint="Por cota" icon={TrendingUp} accent="sky" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card pad={false}>
          <div className="p-5 pb-0"><h3 className="text-lg text-ink flex items-center gap-2"><Building2 size={18} className="text-brand-500" /> Crédito por Administradora</h3></div>
          {temDados ? <BarList items={m.porAdmin} color="#1873BA" /> : <EmptyState icon={Building2} title="Nenhuma cota cadastrada" hint="Cadastre cotas em Consórcios → Cotas para ver os números aqui." />}
        </Card>
        <Card pad={false}>
          <div className="p-5 pb-0"><h3 className="text-lg text-ink flex items-center gap-2"><PieIcon size={18} className="text-brand-500" /> Crédito por Tipo de Bem</h3></div>
          {temDados ? <PieDist items={m.porTipo} /> : <EmptyState icon={PieIcon} title="Nenhuma cota cadastrada" />}
        </Card>
      </div>
      {loading && <p className="text-xs text-muted mt-4">Carregando…</p>}
    </>
  );
}

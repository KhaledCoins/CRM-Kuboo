import { useEffect, useMemo, useState } from "react";
import { BarChart3, DollarSign, ShoppingCart, Percent, Package, Building2, Users, RefreshCw } from "lucide-react";
import { Card, KpiCard, PageHeader, EmptyState } from "../components/ui";
import { brl } from "../lib/format";
import { supabase } from "../lib/supabase";

interface Venda { valor: number | null; comissao_valor: number | null; data_venda: string | null; produto: string | null; seguradora: string | null; vendedor_nome: string | null; tipo: string | null; }
const monthPrefix = () => new Date().toISOString().slice(0, 7);

function groupTop(rows: Venda[], key: keyof Venda, n = 6) {
  const map: Record<string, number> = {};
  for (const r of rows) { const k = (r[key] as string) || "—"; map[k] = (map[k] || 0) + (Number(r.valor) || 0); }
  return Object.entries(map).map(([label, total]) => ({ label, total })).sort((a, b) => b.total - a.total).slice(0, n);
}
function BarBlock({ title, icon: Icon, items, color }: { title: string; icon: any; items: { label: string; total: number }[]; color: string }) {
  const max = Math.max(...items.map((i) => i.total), 1);
  return (
    <Card pad={false}>
      <div className="p-5 pb-2"><h3 className="text-base text-ink flex items-center gap-2 font-bold"><Icon size={17} style={{ color }} /> {title}</h3></div>
      <div className="p-5 pt-1 space-y-3">
        {items.length === 0 ? <p className="text-sm text-muted">Sem dados.</p> : items.map((it) => (
          <div key={it.label}>
            <div className="flex justify-between text-sm mb-1"><span className="text-ink font-medium truncate">{it.label}</span><span className="text-muted">{brl(it.total)}</span></div>
            <div className="h-2 bg-slate-100 rounded-full overflow-hidden"><div className="h-full rounded-full" style={{ width: `${(it.total / max) * 100}%`, background: color }} /></div>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function Producao() {
  const [vendas, setVendas] = useState<Venda[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!supabase) { setLoading(false); return; }
      const { data } = await supabase.from("vendas").select("valor,comissao_valor,data_venda,produto,seguradora,vendedor_nome,tipo").gte("data_venda", monthPrefix() + "-01").limit(3000);
      if (!active) return;
      setVendas(data || []); setLoading(false);
    })();
    return () => { active = false; };
  }, []);

  const m = useMemo(() => {
    let prod = 0, com = 0, novos = 0, renov = 0;
    for (const v of vendas) {
      prod += Number(v.valor) || 0; com += Number(v.comissao_valor) || 0;
      if (v.tipo === "renovacao") renov += Number(v.valor) || 0; else novos += Number(v.valor) || 0;
    }
    return {
      prod, com, n: vendas.length, novos, renov,
      ticket: vendas.length ? prod / vendas.length : 0,
      comPct: prod ? (com / prod) * 100 : 0,
      porProduto: groupTop(vendas, "produto"), porSeg: groupTop(vendas, "seguradora"), porVend: groupTop(vendas, "vendedor_nome"),
    };
  }, [vendas]);

  const mesNome = new Date().toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

  return (
    <>
      <PageHeader title="Produção Mensal" subtitle={`Relatório consolidado — ${mesNome}`} icon={BarChart3} />

      {loading ? (
        <Card><p className="text-muted text-sm">Carregando relatório…</p></Card>
      ) : vendas.length === 0 ? (
        <Card pad={false}><EmptyState icon={BarChart3} title="Sem produção no período" hint="O consolidado por consultor, seguradora e produto aparece aqui assim que houver vendas no mês." /></Card>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
            <KpiCard label="Produção Total" value={brl(m.prod)} hint={`${m.n} vendas`} icon={DollarSign} accent="brand" />
            <KpiCard label="Comissões" value={brl(m.com)} hint={`${m.comPct.toFixed(1)}% sobre vendas`} icon={Percent} accent="success" />
            <KpiCard label="Ticket Médio" value={brl(m.ticket)} icon={ShoppingCart} accent="sky" />
            <KpiCard label="Novos vs Renovação" value={`${brl(m.novos)} / ${brl(m.renov)}`} icon={RefreshCw} accent="warning" />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <BarBlock title="Por Vendedor" icon={Users} items={m.porVend} color="#1873BA" />
            <BarBlock title="Por Seguradora" icon={Building2} items={m.porSeg} color="#2DD4A7" />
            <BarBlock title="Por Produto" icon={Package} items={m.porProduto} color="#F5B53D" />
          </div>
        </>
      )}
    </>
  );
}

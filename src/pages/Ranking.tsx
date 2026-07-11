import { useEffect, useMemo, useState } from "react";
import { Trophy, DollarSign, TrendingUp, Medal } from "lucide-react";
import { Card, KpiCard, PageHeader, EmptyState } from "../components/ui";
import { PeriodoSelect, rangeFor, labelDe, type PeriodoKey } from "../components/Periodo";
import { brl, brlShort } from "../lib/format";
import { supabase } from "../lib/supabase";

interface Venda { valor: number | null; comissao_valor: number | null; data_venda: string | null; vendedor_nome: string | null; }

export function Ranking() {
  const [vendas, setVendas] = useState<Venda[]>([]);
  const [loading, setLoading] = useState(true);
  const [periodo, setPeriodo] = useState<PeriodoKey>("mes");

  useEffect(() => {
    let active = true;
    setLoading(true);
    (async () => {
      if (!supabase) { setLoading(false); return; }
      try {
        const r = rangeFor(periodo);
        let qy: any = supabase.from("vendas").select("valor,comissao_valor,data_venda,vendedor_nome").gte("data_venda", r.gte);
        if (r.lte) qy = qy.lte("data_venda", r.lte);
        const { data } = await qy.limit(5000);
        if (!active) return;
        setVendas(data || []);
      } catch (e) {
        console.error("[ranking]", e);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [periodo]);

  const { rank, totVendas, totComissao } = useMemo(() => {
    const map: Record<string, { producao: number; comissao: number; n: number }> = {};
    let tv = 0, tc = 0;
    for (const v of vendas) {
      const nome = v.vendedor_nome || "Sem vendedor";
      const val = Number(v.valor) || 0, com = Number(v.comissao_valor) || 0;
      tv += val; tc += com;
      map[nome] = map[nome] || { producao: 0, comissao: 0, n: 0 };
      map[nome].producao += val; map[nome].comissao += com; map[nome].n += 1;
    }
    const rank = Object.entries(map).map(([nome, d]) => ({ nome, ...d, ticket: d.n ? d.producao / d.n : 0 })).sort((a, b) => b.producao - a.producao);
    return { rank, totVendas: tv, totComissao: tc };
  }, [vendas]);

  const medalColor = ["#F5B53D", "#9CA3AF", "#CD7F32"];

  return (
    <>
      <PageHeader title="Ranking de Vendedores" subtitle={`Desempenho da equipe — ${labelDe(periodo).toLowerCase()}`} icon={Trophy}
        actions={<PeriodoSelect value={periodo} onChange={setPeriodo} />} />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <KpiCard label="Total em Vendas" value={brlShort(totVendas)} icon={TrendingUp} accent="brand" />
        <KpiCard label="Total em Comissões" value={brlShort(totComissao)} icon={DollarSign} accent="success" />
        <KpiCard label="Vendedores Ativos" value={String(rank.length)} icon={Trophy} accent="warning" />
      </div>

      {loading ? (
        <Card><p className="text-muted text-sm">Carregando ranking…</p></Card>
      ) : rank.length === 0 ? (
        <Card pad={false}><EmptyState icon={Trophy} title="Sem vendas no período" hint="O ranking por produção e comissão aparece aqui assim que houver vendas registradas." /></Card>
      ) : (
        <>
          {/* Pódio */}
          {rank.length >= 2 && (
            <div className="grid grid-cols-3 gap-3 mb-6 items-end">
              {[1, 0, 2].map((idx) => {
                const r = rank[idx]; if (!r) return <div key={idx} />;
                const h = idx === 0 ? 130 : idx === 1 ? 100 : 84;
                return (
                  <div key={idx} className="text-center">
                    <div className="w-12 h-12 rounded-full grid place-items-center mx-auto mb-2 font-bold text-white" style={{ background: medalColor[idx] }}>
                      <Medal size={22} />
                    </div>
                    <p className="font-bold text-ink text-sm truncate px-1">{r.nome}</p>
                    <p className="text-xs text-muted mb-2">{brlShort(r.producao)}</p>
                    <div className="rounded-t-xl mx-auto" style={{ height: h, width: "100%", maxWidth: 150, background: `linear-gradient(180deg, ${medalColor[idx]}33, ${medalColor[idx]}11)`, border: `1px solid ${medalColor[idx]}55` }}>
                      <span className="block pt-3 text-2xl font-extrabold" style={{ color: medalColor[idx], fontFamily: "var(--font-display, sans-serif)" }}>{idx + 1}º</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <Card pad={false}>
            <div className="p-2 overflow-x-auto">
              <table className="w-full text-sm min-w-[560px]">
                <thead><tr className="text-left text-muted border-b border-slate-200">
                  <th className="font-bold text-xs uppercase tracking-wide py-3 px-3">#</th>
                  <th className="font-bold text-xs uppercase tracking-wide py-3 px-3">Vendedor</th>
                  <th className="font-bold text-xs uppercase tracking-wide py-3 px-3">Vendas</th>
                  <th className="font-bold text-xs uppercase tracking-wide py-3 px-3 text-right">Produção</th>
                  <th className="font-bold text-xs uppercase tracking-wide py-3 px-3 text-right">Comissão</th>
                  <th className="font-bold text-xs uppercase tracking-wide py-3 px-3 text-right">Ticket Médio</th>
                </tr></thead>
                <tbody>
                  {rank.map((r, i) => (
                    <tr key={r.nome} className="border-b border-slate-100 hover:bg-slate-50/60">
                      <td className="py-3 px-3 font-bold" style={{ color: i < 3 ? medalColor[i] : "#94a3b8" }}>{i + 1}º</td>
                      <td className="py-3 px-3 font-semibold text-ink">{r.nome}</td>
                      <td className="py-3 px-3">{r.n}</td>
                      <td className="py-3 px-3 text-right font-bold text-ink">{brl(r.producao)}</td>
                      <td className="py-3 px-3 text-right text-green-600 font-semibold">{brl(r.comissao)}</td>
                      <td className="py-3 px-3 text-right text-muted">{brl(r.ticket)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </>
  );
}

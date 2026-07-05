import { useEffect, useMemo, useState } from "react";
import { ShoppingCart, TrendingUp, DollarSign, Percent, Package, Trophy, PieChart as PieIcon, Filter } from "lucide-react";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, PieChart, Pie, Cell, Legend } from "recharts";
import { Card, KpiCard, PageHeader, EmptyState } from "../../components/ui";
import { brl, brlShort } from "../../lib/format";
import { supabase } from "../../lib/supabase";
import { fetchLeads, type Lead } from "../../lib/leads";

// Etapas do funil na ordem do Pipeline (mesmos ids do Pipeline.tsx)
const FUNIL_STAGES = [
  { id: "novos", label: "Novos", color: "#1873BA" },
  { id: "contato", label: "Em contato", color: "#36ABE2" },
  { id: "cotacao", label: "Cotação enviada", color: "#5BC4F5" },
  { id: "negociacao", label: "Em negociação", color: "#F59E0B" },
  { id: "ganho", label: "Fechado", color: "#16A34A" },
];

function Funil({ leads }: { leads: Lead[] }) {
  const ativos = leads.filter((l) => !l.descartado);
  const cont = (id: string) => ativos.filter((l) => (l.etapa ?? "novos") === id).length;
  const stages = FUNIL_STAGES.map((s) => ({ ...s, n: cont(s.id) }));
  const max = Math.max(...stages.map((s) => s.n), 1);
  const ganhos = cont("ganho"), perdidos = cont("perdido");
  const emAberto = ativos.length - ganhos - perdidos;
  const winRate = ganhos + perdidos ? (ganhos / (ganhos + perdidos)) * 100 : 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_240px] gap-5 p-5 pt-3">
      <div className="space-y-2.5">
        {stages.map((s) => (
          <div key={s.id}>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-ink font-medium">{s.label}</span>
              <span className="text-muted font-semibold">{s.n}</span>
            </div>
            <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all" style={{ width: `${Math.max((s.n / max) * 100, s.n ? 6 : 0)}%`, background: s.color }} />
            </div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-1 gap-2.5 content-start">
        <div className="rounded-xl bg-green-50 border border-green-100 px-3 py-2.5">
          <p className="text-2xl font-extrabold text-green-600 leading-none">{winRate.toFixed(0)}%</p>
          <p className="text-xs text-muted mt-1">Taxa de conversão <span className="text-slate-400">(ganhos ÷ fechados)</span></p>
        </div>
        <div className="rounded-xl bg-slate-50 border border-slate-100 px-3 py-2.5">
          <p className="text-2xl font-extrabold text-ink leading-none">{emAberto}</p>
          <p className="text-xs text-muted mt-1">Em aberto (ainda no funil)</p>
        </div>
        <div className="rounded-xl bg-slate-50 border border-slate-100 px-3 py-2.5">
          <p className="text-lg font-extrabold text-ink leading-none">{ganhos} <span className="text-green-600">ganhos</span> · {perdidos} <span className="text-slate-400">perdidos</span></p>
          <p className="text-xs text-muted mt-1">Fechados no total</p>
        </div>
      </div>
    </div>
  );
}

interface Venda { valor: number | null; comissao_valor: number | null; data_venda: string | null; produto: string | null; seguradora: string | null; vendedor_nome: string | null; }

const monthPrefix = () => new Date().toISOString().slice(0, 7);
const todayISO = () => new Date().toISOString().slice(0, 10);

function groupTop(rows: Venda[], key: keyof Venda, n = 5) {
  const map: Record<string, number> = {};
  for (const r of rows) { const k = (r[key] as string) || "—"; map[k] = (map[k] || 0) + (Number(r.valor) || 0); }
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

const PIE_COLORS = ["#1873BA", "#2DD4A7", "#F5B53D", "#EC7000", "#7C3AED", "#36ABE2"];
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

export function DashboardSeguros() {
  const [vendas, setVendas] = useState<Venda[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!supabase) { setLoading(false); return; }
      const [{ data }, ls] = await Promise.all([
        supabase.from("vendas").select("valor,comissao_valor,data_venda,produto,seguradora,vendedor_nome").gte("data_venda", monthPrefix() + "-01").limit(3000),
        fetchLeads(),
      ]);
      if (!active) return;
      setVendas(data || []); setLeads(ls); setLoading(false);
    })();
    return () => { active = false; };
  }, []);

  const m = useMemo(() => {
    const hoje = todayISO();
    const diaCount = new Date().getDate();
    const days = Array.from({ length: diaCount }, (_, i) => ({ dia: String(i + 1).padStart(2, "0"), valor: 0 }));
    let prodMes = 0, nMes = 0, prodHoje = 0, nHoje = 0, comissao = 0;
    for (const v of vendas) {
      const val = Number(v.valor) || 0; prodMes += val; nMes += 1; comissao += Number(v.comissao_valor) || 0;
      const d = (v.data_venda || "").slice(0, 10);
      if (d === hoje) { prodHoje += val; nHoje += 1; }
      const dayN = parseInt((v.data_venda || "").slice(8, 10), 10);
      if (dayN >= 1 && dayN <= diaCount) days[dayN - 1].valor += val;
    }
    return {
      days, prodMes, nMes, prodHoje, nHoje,
      ticket: nMes ? prodMes / nMes : 0,
      comissaoPct: prodMes ? (comissao / prodMes) * 100 : 0,
      topProdutos: groupTop(vendas, "produto"), topVendedores: groupTop(vendas, "vendedor_nome"), topSeg: groupTop(vendas, "seguradora"),
    };
  }, [vendas]);

  const temDados = vendas.length > 0;

  return (
    <>
      <PageHeader title="Dashboard" subtitle="Visão geral de produção — Seguros" />

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <KpiCard label="Vendas Hoje" value={String(m.nHoje)} hint={brl(m.prodHoje)} icon={ShoppingCart} accent="brand" />
        <KpiCard label="Vendas no Mês" value={String(m.nMes)} hint={brl(m.prodMes)} icon={TrendingUp} accent="success" />
        <KpiCard label="Ticket Médio" value={brl(m.ticket)} hint={`Baseado em ${m.nMes} venda${m.nMes === 1 ? "" : "s"}`} icon={DollarSign} accent="sky" />
        <KpiCard label="Comissão Média" value={`${m.comissaoPct.toFixed(1)}%`} hint="Margem sobre vendas do mês" icon={Percent} accent="warning" />
      </div>

      <Card pad={false} className="mb-6">
        <div className="p-5 pb-0">
          <h3 className="text-lg text-ink flex items-center gap-2"><Filter size={18} className="text-brand-500" /> Funil de Conversão</h3>
          <p className="text-sm text-muted">Onde estão seus leads agora — do primeiro contato ao fechamento</p>
        </div>
        {leads.length ? <Funil leads={leads} /> : <EmptyState icon={Filter} title="Sem leads no funil ainda" hint="Assim que entrarem leads (site, Kubinho, WhatsApp) o funil aparece aqui." />}
      </Card>

      <Card className="mb-6">
        <h3 className="text-lg text-ink mb-1 flex items-center gap-2"><TrendingUp size={18} className="text-brand-500" /> Produção Diária do Mês</h3>
        <p className="text-sm text-muted mb-4">Evolução das vendas ao longo do mês</p>
        <div style={{ height: 260 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={m.days} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
              <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#1873BA" stopOpacity={0.35} /><stop offset="100%" stopColor="#1873BA" stopOpacity={0} /></linearGradient></defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
              <XAxis dataKey="dia" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={(v) => brlShort(v)} tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} width={60} />
              <Tooltip formatter={(v: number) => brl(v)} />
              <Area type="monotone" dataKey="valor" stroke="#1873BA" strokeWidth={2.5} fill="url(#g)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card pad={false}>
          <div className="p-5 pb-0"><h3 className="text-lg text-ink flex items-center gap-2"><Trophy size={18} className="text-amber-500" /> Top Vendedores do Mês</h3></div>
          {temDados ? <BarList items={m.topVendedores} color="#F5B53D" /> : <EmptyState icon={Trophy} title="Nenhuma venda registrada este mês" />}
        </Card>
        <Card pad={false}>
          <div className="p-5 pb-0"><h3 className="text-lg text-ink flex items-center gap-2"><Package size={18} className="text-brand-500" /> Top Produtos do Mês</h3></div>
          {temDados ? <BarList items={m.topProdutos} color="#1873BA" /> : <EmptyState icon={Package} title="Nenhuma venda registrada este mês" />}
        </Card>
        <Card pad={false}>
          <div className="p-5 pb-0"><h3 className="text-lg text-ink flex items-center gap-2"><PieIcon size={18} className="text-brand-500" /> Produção por Seguradora</h3></div>
          {temDados ? <PieDist items={m.topSeg} /> : <EmptyState icon={PieIcon} title="Nenhuma venda registrada este mês" />}
        </Card>
        <Card pad={false}>
          <div className="p-5 pb-0"><h3 className="text-lg text-ink flex items-center gap-2"><DollarSign size={18} className="text-green-600" /> Resumo do Mês</h3></div>
          <div className="p-5 pt-3 space-y-3">
            <div className="flex justify-between text-sm"><span className="text-muted">Produção total</span><span className="text-ink font-bold">{brl(m.prodMes)}</span></div>
            <div className="flex justify-between text-sm"><span className="text-muted">Nº de vendas</span><span className="text-ink font-bold">{m.nMes}</span></div>
            <div className="flex justify-between text-sm"><span className="text-muted">Ticket médio</span><span className="text-ink font-bold">{brl(m.ticket)}</span></div>
            <div className="flex justify-between text-sm"><span className="text-muted">Vendas hoje</span><span className="text-ink font-bold">{m.nHoje} · {brl(m.prodHoje)}</span></div>
            {loading && <p className="text-xs text-muted">Carregando…</p>}
          </div>
        </Card>
      </div>
    </>
  );
}

import { useMemo } from "react";
import {
  ShoppingCart, TrendingUp, DollarSign, Percent, Package, Trophy, PieChart as PieIcon, Plus, FileEdit,
} from "lucide-react";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { Card, KpiCard, PageHeader, Button, EmptyState } from "../../components/ui";
import { brl, brlShort } from "../../lib/format";

export function DashboardSeguros() {
  const days = useMemo(
    () => Array.from({ length: new Date().getDate() }, (_, i) => ({ dia: String(i + 1).padStart(2, "0"), valor: 0 })),
    []
  );

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle="Visão geral de produção — Seguros"
        actions={<Button icon={Plus}>Nova Venda</Button>}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <KpiCard label="Vendas Hoje" value="0" hint={brl(0)} icon={ShoppingCart} accent="brand" />
        <KpiCard label="Vendas no Mês" value="0" hint={brl(0)} icon={TrendingUp} accent="success" />
        <KpiCard label="Ticket Médio" value={brl(0)} hint="Baseado em 0 vendas" icon={DollarSign} accent="sky" />
        <KpiCard label="Comissão Média" value="0,00%" hint="Margem sobre vendas do mês" icon={Percent} accent="warning" />
      </div>

      <Card className="mb-6">
        <h3 className="text-lg text-ink mb-1 flex items-center gap-2"><TrendingUp size={18} className="text-brand-500" /> Produção Diária do Mês</h3>
        <p className="text-sm text-muted mb-4">Evolução das vendas ao longo do mês</p>
        <div style={{ height: 260 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={days} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#1873BA" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#1873BA" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
              <XAxis dataKey="dia" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={(v) => brlShort(v)} tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} width={60} />
              <Tooltip formatter={(v: number) => brl(v)} />
              <Area type="monotone" dataKey="valor" stroke="#1873BA" strokeWidth={2.5} fill="url(#g)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="lg:col-span-2">
          <Card pad={false}>
            <div className="p-5 pb-0"><h3 className="text-lg text-ink flex items-center gap-2"><Package size={18} className="text-brand-500" /> Top 5 Produtos do Mês</h3></div>
            <EmptyState icon={Package} title="Nenhuma venda registrada este mês" hint="Os produtos mais vendidos aparecem aqui assim que houver vendas." />
          </Card>
        </div>
        <div className="space-y-4">
          {[
            { label: "Novos", icon: Plus, accent: "success" as const },
            { label: "Renovações", icon: TrendingUp, accent: "sky" as const },
            { label: "Endossos", icon: FileEdit, accent: "warning" as const },
          ].map((c) => (
            <KpiCard key={c.label} label={c.label} value={brl(0)} hint="0 apólices" icon={c.icon} accent={c.accent} />
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card pad={false}>
          <div className="p-5 pb-0"><h3 className="text-lg text-ink flex items-center gap-2"><Trophy size={18} className="text-amber-500" /> Top 5 Vendedores do Mês</h3></div>
          <EmptyState icon={Trophy} title="Nenhuma venda registrada este mês" />
        </Card>
        <Card pad={false}>
          <div className="p-5 pb-0"><h3 className="text-lg text-ink flex items-center gap-2"><PieIcon size={18} className="text-brand-500" /> Produção por Seguradora</h3></div>
          <EmptyState icon={PieIcon} title="Nenhuma venda registrada este mês" />
        </Card>
      </div>
    </>
  );
}

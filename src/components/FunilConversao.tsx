import { Filter } from "lucide-react";
import { Card, EmptyState } from "./ui";
import type { Lead } from "../lib/leads";

// Funil de conversão de leads — compartilhado pelos dashboards de Seguros e
// Consórcios (cada um passa só os leads do próprio módulo).
// Etapas na ordem do Pipeline (mesmos ids do Pipeline.tsx).
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

export function FunilConversaoCard({ leads }: { leads: Lead[] }) {
  return (
    <Card pad={false} className="mb-6">
      <div className="p-5 pb-0">
        <h3 className="text-lg text-ink flex items-center gap-2"><Filter size={18} className="text-brand-500" /> Funil de Conversão</h3>
        <p className="text-sm text-muted">Onde estão seus leads agora — do primeiro contato ao fechamento</p>
      </div>
      {leads.length
        ? <Funil leads={leads} />
        : <EmptyState icon={Filter} title="Sem leads no funil ainda" hint="Assim que entrarem leads (site, Kubinho, WhatsApp) o funil aparece aqui." />}
    </Card>
  );
}

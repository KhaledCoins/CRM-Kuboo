export type PeriodoKey = "mes" | "mes_passado" | "tri" | "ano";

export const PERIODOS: { key: PeriodoKey; label: string }[] = [
  { key: "mes", label: "Este mês" },
  { key: "mes_passado", label: "Mês passado" },
  { key: "tri", label: "Últimos 3 meses" },
  { key: "ano", label: "Este ano" },
];

const iso = (d: Date) => d.toISOString().slice(0, 10);

// Retorna o intervalo de datas (YYYY-MM-DD) para filtrar data_venda.
export function rangeFor(key: PeriodoKey): { gte: string; lte?: string } {
  const n = new Date();
  switch (key) {
    case "mes_passado":
      return { gte: iso(new Date(n.getFullYear(), n.getMonth() - 1, 1)), lte: iso(new Date(n.getFullYear(), n.getMonth(), 0)) };
    case "tri":
      return { gte: iso(new Date(n.getFullYear(), n.getMonth() - 2, 1)) };
    case "ano":
      return { gte: iso(new Date(n.getFullYear(), 0, 1)) };
    case "mes":
    default:
      return { gte: iso(new Date(n.getFullYear(), n.getMonth(), 1)) };
  }
}

export function labelDe(key: PeriodoKey) {
  return PERIODOS.find((p) => p.key === key)?.label ?? "Este mês";
}

export function PeriodoSelect({ value, onChange }: { value: PeriodoKey; onChange: (k: PeriodoKey) => void }) {
  return (
    <div className="flex gap-1 bg-slate-100 rounded-xl p-1 flex-wrap">
      {PERIODOS.map((p) => (
        <button key={p.key} onClick={() => onChange(p.key)}
          className={`text-xs font-bold px-3 py-1.5 rounded-lg transition-colors ${value === p.key ? "bg-white shadow text-brand-600" : "text-slate-500 hover:text-slate-700"}`}>
          {p.label}
        </button>
      ))}
    </div>
  );
}

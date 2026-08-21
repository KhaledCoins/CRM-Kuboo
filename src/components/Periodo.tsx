import { hojeLocal } from "../lib/format";
export type PeriodoKey = "mes" | "mes_passado" | "tri" | "ano";

export const PERIODOS: { key: PeriodoKey; label: string }[] = [
  { key: "mes", label: "Este mês" },
  { key: "mes_passado", label: "Mês passado" },
  { key: "tri", label: "Últimos 3 meses" },
  { key: "ano", label: "Este ano" },
];

// Primeiro e último dia de um mês (1-based), no calendário — sem Date local,
// que muda de dia conforme o fuso da máquina de quem abriu a tela.
const primeiroDia = (a: number, m: number) => `${a}-${String(m).padStart(2, "0")}-01`;
const ultimoDia = (a: number, m: number) =>
  `${a}-${String(m).padStart(2, "0")}-${String(new Date(Date.UTC(a, m, 0)).getUTCDate()).padStart(2, "0")}`;

// Intervalo de datas (YYYY-MM-DD) para filtrar data_venda.
//
// TODO período tem TETO. "Mês passado" era o único que tinha — e por isso era o
// único lugar onde o número voltava ao normal. Sem teto, uma venda digitada com
// o ano errado (2027 no lugar de 2026) entra em "Este mês", "Últimos 3 meses" e
// "Este ano", e continua entrando em todos eles pelo resto do ano: infla a
// produção, estampa "Meta batida" com dinheiro que não existe, sobe o consultor
// no Ranking e aparece na comissão.
//
// O "hoje" vem do fuso da OPERAÇÃO (America/Sao_Paulo), não do relógio da
// máquina: depois das 21h de Brasília o UTC já virou o dia.
export function rangeFor(key: PeriodoKey): { gte: string; lte: string } {
  const hoje = hojeLocal();
  const [ano, mes] = hoje.split("-").map(Number);
  switch (key) {
    case "mes_passado": {
      const a = mes === 1 ? ano - 1 : ano;
      const m = mes === 1 ? 12 : mes - 1;
      return { gte: primeiroDia(a, m), lte: ultimoDia(a, m) };
    }
    case "tri": {
      let a = ano, m = mes - 2;
      while (m < 1) { m += 12; a -= 1; }
      return { gte: primeiroDia(a, m), lte: hoje };
    }
    case "ano":
      return { gte: `${ano}-01-01`, lte: hoje };
    case "mes":
    default:
      return { gte: primeiroDia(ano, mes), lte: hoje };
  }
}

/** Primeiro e último dia do mês corrente na operação. */
export function mesCorrente(): { gte: string; lte: string } {
  const [ano, mes] = hojeLocal().split("-").map(Number);
  return { gte: primeiroDia(ano, mes), lte: ultimoDia(ano, mes) };
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

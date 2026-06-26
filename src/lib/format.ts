export const brl = (v: number | null | undefined) =>
  (v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export const brlShort = (v: number | null | undefined) => {
  const n = v ?? 0;
  if (Math.abs(n) >= 1_000_000) return `R$ ${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `R$ ${(n / 1_000).toFixed(0)}k`;
  return brl(n);
};

export const pct = (v: number | null | undefined, digits = 1) =>
  `${(v ?? 0).toFixed(digits)}%`;

export const dateBR = (v: string | Date | null | undefined) => {
  if (!v) return "—";
  const d = typeof v === "string" ? new Date(v) : v;
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR");
};

export const initials = (name?: string | null) =>
  (name || "?")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");

export const onlyDigits = (s: string) => s.replace(/\D/g, "");

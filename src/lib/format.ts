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

// Documento do cliente para EXIBIÇÃO: 11 dígitos vira CPF, 14 vira CNPJ.
// A validação de verdade (dígito verificador) é do servidor, em
// api/_documento.js — aqui é só máscara. Valor legado já formatado, ou de
// tamanho estranho, volta como veio em vez de ganhar uma máscara errada.
export function formatarDocumento(valor?: string | null): string {
  const d = onlyDigits(String(valor ?? ""));
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  return String(valor ?? "");
}

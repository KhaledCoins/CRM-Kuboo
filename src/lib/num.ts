// Parser de moeda/número pt-BR — fonte ÚNICA (antes cada tela reinventava e errava).
// "R$ 1.234,56" / "1.234,56" → 1234.56 · "1234.56" (ISO) → 1234.56 · "2.400,00" → 2400
// Regra: ponto só é milhar quando há VÍRGULA decimal junto; sozinho, é decimal ISO.
export function paraNumero(bruto: unknown): number | null {
  if (bruto == null) return null;
  let s = String(bruto).trim();
  if (!s) return null;
  s = s.replace(/R\$/gi, "").replace(/\s/g, "").replace(/[^\d.,-]/g, "");
  if (!s) return null;
  const temVirgula = s.includes(",");
  const temPonto = s.includes(".");
  if (temVirgula && temPonto) s = s.replace(/\./g, "").replace(",", ".");
  else if (temVirgula) s = s.replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

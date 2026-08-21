// Parser de moeda/número pt-BR — fonte ÚNICA de TODA entrada de dinheiro do CRM
// (vendas, comissões, parcelas, cotas, importador de planilha).
//
// A regra antiga só tratava o ponto como milhar quando havia vírgula decimal
// junto. Resultado medido: "1.500" virava 1,5 — mil vezes menos —, "R$ 3.200"
// virava 3,2 e "10.000.000" virava null (o campo era simplesmente omitido e a
// linha entrava sem valor, contada como "importada com sucesso"). Como o
// brasileiro escreve valor redondo SEM centavos ("R$ 1.500"), o caminho errado
// era o mais comum.
//
// Regra correta (a mesma que o parser do funil de leads já usava — agora as
// duas são a mesma): ponto ÚNICO com 1 ou 2 casas depois é decimal; qualquer
// outro ponto é separador de milhar.
//   "1.500" → 1500 · "R$ 3.200" → 3200 · "10.000.000" → 10000000
//   "1234.56" → 1234.56 · "0.5" → 0.5 · "1.234,56" → 1234.56 · "2.400,00" → 2400
export function paraNumero(bruto: unknown): number | null {
  if (bruto == null) return null;
  let s = String(bruto).trim();
  if (!s) return null;
  s = s.replace(/R\$/gi, "").replace(/\s/g, "").replace(/[^\d.,-]/g, "");
  if (!s) return null;

  const temVirgula = s.includes(",");
  const temPonto = s.includes(".");
  if (temVirgula && temPonto) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (temVirgula) {
    s = s.replace(",", ".");
  } else if (temPonto) {
    const ultimo = s.lastIndexOf(".");
    const casasDepois = s.length - ultimo - 1;
    const pontoUnico = s.indexOf(".") === ultimo;
    // Decimal só quando é UM ponto com 1-2 casas ("1234.56", "0.5").
    // "1.500", "12.000" e "10.000.000" são milhar.
    if (!(pontoUnico && casasDepois >= 1 && casasDepois <= 2)) s = s.replace(/\./g, "");
  }

  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

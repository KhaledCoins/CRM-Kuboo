// Normalização de telefone COMPARTILHADA entre os dois receptores de lead
// (c2s-webhook e lead-inbound). Não é estética: o c2s-webhook adota leads
// pré-existentes por igualdade EXATA de telefone — Make e C2S só se fundem no
// mesmo lead se os dois lados gravarem o MESMO formato. Se esta regra viver
// copiada em cada arquivo, uma mudança num lado só ressuscita o lead duplicado
// em silêncio (dois vendedores ligando pro mesmo cliente).

export const digits = (v) => String(v ?? "").replace(/\D/g, "");

// Telefone no formato usado pelo resto do CRM (DDI 55 removido, máscara BR).
// Menos de 10 dígitos não é telefone ("0", "999", lixo de formulário) — vira
// null pra nunca virar chave de deduplicação e fundir leads distintos.
export function formatarTelefone(bruto) {
  let d = digits(bruto);
  if (d.startsWith("55") && d.length >= 12) d = d.slice(2);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return null;
}

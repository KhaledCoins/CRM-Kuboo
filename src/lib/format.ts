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

// Link de WhatsApp que NÃO duplica o DDI: telefone salvo como "+55 12 9..."
// virava wa.me/5555... (link morto) nas telas que concatenavam "55" na mão.
// Fonte única — o botão de WhatsApp é o mais clicado do CRM.
export function waLink(telefone?: string | null, texto?: string): string | null {
  const digits = onlyDigits(telefone || "");
  if (!digits) return null;
  const comPais = digits.startsWith("55") && digits.length >= 12 ? digits : `55${digits}`;
  return `https://wa.me/${comPais}${texto ? `?text=${encodeURIComponent(texto)}` : ""}`;
}

// Mesma regra pro discador: tel: sem DDI disca de qualquer celular BR, mas
// softphone/discador corporativo exige E.164 — prefixa +55 quando não veio.
// Fonte única, igual ao waLink (as telas montavam o tel: na mão).
export function telLink(telefone?: string | null): string | null {
  const digits = onlyDigits(telefone || "");
  if (!digits) return null;
  const comPais = digits.startsWith("55") && digits.length >= 12 ? digits : `55${digits}`;
  return `tel:+${comPais}`;
}

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

// ─── Datas no fuso da operação ──────────────────────────────────────────────
// O banco guarda timestamp em UTC; a corretora vive em America/Sao_Paulo
// (UTC-3). Cortar o ISO com .slice(0,10) devolve o dia UTC: um lead das 22h de
// Brasília (01:00Z do dia seguinte) era contado no dia seguinte nos gráficos
// diários — justamente o horário em que anúncio de madrugada gera lead.
// Use SEMPRE isto para agrupar/rotular por dia.
export const FUSO_OPERACAO = "America/Sao_Paulo";

/** "2026-08-21T01:00:00Z" → "2026-08-20" (o dia que a equipe viveu). */
export function diaLocal(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(normalizarTimestamp(iso));
  if (Number.isNaN(d.getTime())) return "";
  // en-CA formata como YYYY-MM-DD, que é o formato usado como chave.
  return d.toLocaleDateString("en-CA", { timeZone: FUSO_OPERACAO });
}

// O Postgres devolve "2026-08-21 05:44:33.801542+00": espaço em vez de T e
// offset SEM minutos. O V8 (Node/Chrome) é tolerante e parseia assim mesmo, mas
// Safari/iOS é ESTRITO e devolve Invalid Date — o gráfico perderia o dia
// inteiro justamente no aparelho que metade da equipe usa na rua.
// Exportada porque só dá pra provar a regra olhando a STRING normalizada: um
// teste rodando no Node passaria mesmo sem a normalização (ver tools/mutantes.mjs).
export function normalizarTimestamp(v: string): string {
  let s = String(v).trim().replace(" ", "T");
  s = s.replace(/([+-]\d{2})$/, "$1:00"); // "+00" → "+00:00"
  return s;
}

/** Hoje no fuso da operação, como YYYY-MM-DD. */
export function hojeLocal(): string {
  return diaLocal(new Date().toISOString());
}

/** Uma Date qualquer no dia da operação, como YYYY-MM-DD. */
export function diaLocalDe(d: Date): string {
  return diaLocal(d.toISOString());
}

/** Mês corrente no fuso da operação, como YYYY-MM.
 *  Depois das 21h de Brasília o relógio UTC já virou o dia — e virava o MÊS
 *  no dia 31. Às 21h05 de 31/08 a TV do Salão mostrava produção do mês R$ 0,00
 *  e ranking vazio, com a equipe no push final olhando. */
export function mesLocal(): string {
  return hojeLocal().slice(0, 7);
}

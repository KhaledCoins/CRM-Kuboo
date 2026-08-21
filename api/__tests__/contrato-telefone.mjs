// ─────────────────────────────────────────────────────────────────────────────
// CONTRATO DO TELEFONE — este arquivo é IDÊNTICO em dois repositórios:
//   Site Kuboo   src/lib/__tests__/contrato-telefone.mjs
//   Kuboo-CRM    api/__tests__/contrato-telefone.mjs
// Se você mudar aqui, mude LÁ TAMBÉM.
//
// Por que existe: o telefone formatado é a CHAVE que funde o mesmo cliente
// vindo do anúncio (Meta → Make → CRM) e do site. Se as duas máscaras
// divergirem em UM caso, o cliente vira DOIS leads e dois consultores ligam
// pra mesma pessoa. As implementações são separadas (repos diferentes), então
// o que as mantém honestas é esta tabela.
//
// O SELO é o hash da tabela. Mexeu na tabela de um lado e esqueceu o outro? O
// teste do repo que ficou pra trás quebra na hora, com nome e sobrenome.
// Recalcular: node -e "import('./contrato-telefone.mjs').then(m=>console.log(m.selo(m.CONTRATO)))"
// ─────────────────────────────────────────────────────────────────────────────
import { createHash } from "node:crypto";

/** [o que chega, o que TEM que ser gravado] — null = não é telefone BR válido */
export const CONTRATO = [
  // O mesmo celular, das formas que Meta, C2S, site e cliente mandam
  ["12988776655",         "(12) 98877-6655"],
  ["(12) 98877-6655",     "(12) 98877-6655"],
  ["12 98877-6655",       "(12) 98877-6655"],
  ["+55 12 98877-6655",   "(12) 98877-6655"],
  ["5512988776655",       "(12) 98877-6655"],
  ["55 12 98877-6655",    "(12) 98877-6655"],
  ["12 9 8877-6655",      "(12) 98877-6655"],
  ["(12)98877-6655",      "(12) 98877-6655"],
  ["12.98877.6655",       "(12) 98877-6655"],
  // Fixo de 10 dígitos
  ["1238224455",          "(12) 3822-4455"],
  ["(12) 3822-4455",      "(12) 3822-4455"],
  ["1155554444",          "(11) 5555-4444"],
  // Leads REAIS que já passaram pelas duas pontes (regressão de verdade)
  ["54991179507",         "(54) 99117-9507"],  // DDD 54, Caxias do Sul
  ["13997502020",         "(13) 99750-2020"],  // fundido Make+C2S em 21/08
  ["11987654321",         "(11) 98765-4321"],
  ["+55 (11) 98765-4321", "(11) 98765-4321"],
  // O que NÃO pode virar máscara BR errada
  ["351913786400",        null],  // Portugal — inventar DDD daria número morto
  ["0012988776655",       null],  // DDI 00 — 15 dígitos, não dá pra adivinhar
  ["98877-6655",          null],  // sem DDD, ninguém liga
  ["",                    null],
  ["   ",                 null],
  ["abc",                 null],
];

export const SELO = "90699f685060270c";

export const selo = (t) => createHash("sha256").update(JSON.stringify(t)).digest("hex").slice(0, 16);

// Gráfico diário tem que contar o lead no dia que a EQUIPE viveu, não no dia
// UTC. Anúncio de madrugada gera lead à noite — justo a faixa que quebrava.
// Rodar com: npx vite-node src/lib/__tests__/data-fuso.test.mjs
import assert from "node:assert/strict";
import { diaLocal, hojeLocal, normalizarTimestamp } from "../format.ts";

let ok = 0;
const t = (nome, fn) => { fn(); ok++; console.log(`  ok  ${nome}`); };

t("lead das 22h de Brasília conta no dia certo (era jogado pro dia seguinte)", () => {
  // 22:00 de 20/08 em Brasília = 01:00Z de 21/08
  assert.equal(diaLocal("2026-08-21T01:00:00Z"), "2026-08-20");
});

t("lead das 23h59 ainda é do mesmo dia", () => {
  assert.equal(diaLocal("2026-08-21T02:59:00Z"), "2026-08-20");
});

t("lead da 00h01 já é do dia novo", () => {
  assert.equal(diaLocal("2026-08-21T03:01:00Z"), "2026-08-21");
});

t("lead do meio do dia não muda", () => {
  assert.equal(diaLocal("2026-08-21T15:00:00Z"), "2026-08-21");
});

t("o lead real do Luiz (02:44 BRT) cai no dia 21", () => {
  assert.equal(diaLocal("2026-08-21T05:44:33.801542+00"), "2026-08-21");
});

t("o lead real do Antonio (18:40 BRT) cai no dia 20", () => {
  assert.equal(diaLocal("2026-08-20T21:40:13.435440+00"), "2026-08-20");
});

t("vazio/inválido não quebra o gráfico", () => {
  assert.equal(diaLocal(null), "");
  assert.equal(diaLocal(""), "");
  assert.equal(diaLocal("não é data"), "");
});

t("hojeLocal devolve YYYY-MM-DD", () => {
  assert.match(hojeLocal(), /^\d{4}-\d{2}-\d{2}$/);
});

// O formato que o Postgres devolve tem ESPAÇO no lugar do T. Sem normalizar,
// `new Date()` devolve Invalid Date e o gráfico perde o dia inteiro — e o
// teste de mutação mostrou que nenhum teste pegava isso.
t("timestamp do Postgres (com espaço) é entendido", () => {
  assert.equal(diaLocal("2026-08-21 05:44:33.801542+00"), "2026-08-21");
  assert.equal(diaLocal("2026-08-21 01:00:00+00"), "2026-08-20", "22h de Brasília");
  assert.equal(diaLocal("2026-08-20 21:40:13.435440+00"), "2026-08-20");
});

// Prova a REGRA, não o parser: o Node aceita o formato do Postgres mesmo sem
// normalizar, então só verificando a string dá pra garantir que o Safari (que
// é estrito) também vai entender. Sem isto, remover a normalização passava
// despercebido — flagrado pelo teste de mutação.
t("normaliza o formato do Postgres para ISO que qualquer navegador entende", () => {
  assert.equal(normalizarTimestamp("2026-08-21 05:44:33.801542+00"), "2026-08-21T05:44:33.801542+00:00");
  assert.equal(normalizarTimestamp("2026-08-21 01:00:00+00"), "2026-08-21T01:00:00+00:00");
  assert.equal(normalizarTimestamp("2026-08-21T05:44:33Z"), "2026-08-21T05:44:33Z", "ISO puro não é alterado");
  assert.equal(normalizarTimestamp("2026-08-21T05:44:33-03:00"), "2026-08-21T05:44:33-03:00", "offset completo intacto");
});

console.log(`\n${ok} testes de fuso passaram`);

// DINHEIRO. Um erro aqui grava valor de venda/comissão errado no banco.
// Rodar com: npx vite-node src/lib/__tests__/num.test.mjs
import assert from "node:assert/strict";
import { paraNumero } from "../num.ts";

let ok = 0;
const t = (nome, fn) => { fn(); ok++; console.log(`  ok  ${nome}`); };

t("valor redondo do jeito brasileiro NÃO é dividido por 1000", () => {
  assert.equal(paraNumero("1.500"), 1500);
  assert.equal(paraNumero("R$ 3.200"), 3200);
  assert.equal(paraNumero("12.000"), 12000);
  assert.equal(paraNumero("850"), 850);
});

t("milhão com dois pontos não vira null (o campo sumia da planilha)", () => {
  assert.equal(paraNumero("10.000.000"), 10000000);
  assert.equal(paraNumero("R$ 1.250.000"), 1250000);
});

t("centavos com vírgula continuam certos", () => {
  assert.equal(paraNumero("1.234,56"), 1234.56);
  assert.equal(paraNumero("2.400,00"), 2400);
  assert.equal(paraNumero("R$ 99,90"), 99.9);
});

t("decimal ISO (planilha/export) continua certo", () => {
  assert.equal(paraNumero("1234.56"), 1234.56);
  assert.equal(paraNumero("0.5"), 0.5);
  assert.equal(paraNumero("99.9"), 99.9);
});

t("vazio/lixo vira null, não zero silencioso", () => {
  assert.equal(paraNumero(""), null);
  assert.equal(paraNumero("   "), null);
  assert.equal(paraNumero(null), null);
  assert.equal(paraNumero(undefined), null);
  assert.equal(paraNumero("abc"), null);
});

t("número puro passa direto", () => {
  assert.equal(paraNumero(1500), 1500);
  assert.equal(paraNumero(0), 0);
});

t("negativo (estorno) é preservado", () => {
  assert.equal(paraNumero("-1.500"), -1500);
});

console.log(`\n${ok} testes de dinheiro passaram`);

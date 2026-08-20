// A máscara de telefone é a CHAVE de fusão entre o lead do Make (Meta Lead Ads)
// e o espelho do C2S — se os dois lados divergirem no formato, o mesmo cliente
// vira dois leads pra dois vendedores. Rodar com:
//   npx vite-node api/__tests__/telefone.test.mjs
import assert from "node:assert/strict";
import { formatarTelefone, digits } from "../_telefone.js";

let ok = 0;
const t = (nome, fn) => { fn(); ok++; console.log(`  ok  ${nome}`); };

t("celular 11 dígitos ganha a máscara do CRM", () => {
  assert.equal(formatarTelefone("12988776655"), "(12) 98877-6655");
});

t("fixo 10 dígitos ganha a máscara do CRM", () => {
  assert.equal(formatarTelefone("1238224455"), "(12) 3822-4455");
});

t("DDI 55 é removido antes da máscara (formato que o Meta manda)", () => {
  assert.equal(formatarTelefone("+5512988776655"), "(12) 98877-6655");
  assert.equal(formatarTelefone("5512988776655"), "(12) 98877-6655");
});

t("pontuação do usuário não muda o resultado", () => {
  assert.equal(formatarTelefone("(12) 98877-6655"), "(12) 98877-6655");
  assert.equal(formatarTelefone("12 9 8877 6655"), "(12) 98877-6655");
});

t("o que não é telefone vira null (nunca chave de dedup)", () => {
  assert.equal(formatarTelefone("999"), null);
  assert.equal(formatarTelefone("me liga depois das 18h"), null);
  assert.equal(formatarTelefone(""), null);
  assert.equal(formatarTelefone(null), null);
});

t("mesmo número em formatos diferentes converge pro MESMO texto (chave de fusão Make↔C2S)", () => {
  const formas = ["+55 (12) 98877-6655", "5512988776655", "12988776655", "12 98877 6655"];
  const norm = formas.map(formatarTelefone);
  assert.ok(norm.every((v) => v === "(12) 98877-6655"), JSON.stringify(norm));
});

t("digits extrai só os números", () => {
  assert.equal(digits("+55 (12) 98877-6655"), "5512988776655");
  assert.equal(digits(null), "");
});

console.log(`\n${ok} testes de telefone passaram`);

// CPF/CNPJ — validação de dígito verificador. Rodar com:
//   npx vite-node api/__tests__/documento.test.mjs
import assert from "node:assert/strict";
import { validarCPF, validarCNPJ, tipoPorDocumento, formatarDocumento, analisarDocumento } from "../_documento.js";

let ok = 0;
const t = (nome, fn) => { fn(); ok++; console.log(`  ok  ${nome}`); };

// CNPJ real do teste do Eduardo (GRAEFF TURISMO E TRANSPORTES LTDA)
const CNPJ_GRAEFF = "28618902000105";

t("o CNPJ que o cadastro recusou agora passa", () => {
  assert.equal(validarCNPJ(CNPJ_GRAEFF), true);
  const r = analisarDocumento(CNPJ_GRAEFF);
  assert.equal(r.ok, true);
  assert.equal(r.tipo, "PJ");
  assert.equal(r.formatado, "28.618.902/0001-05");
});

t("CNPJ com máscara é aceito igual", () => {
  assert.equal(analisarDocumento("28.618.902/0001-05").digitos, CNPJ_GRAEFF);
});

t("CPF válido passa", () => {
  for (const c of ["52998224725", "529.982.247-25", "11144477735"]) {
    assert.equal(validarCPF(c), true, c);
  }
});

t("dígito verificador errado é recusado (o ponto do exercício)", () => {
  assert.equal(validarCPF("52998224724"), false);   // último dígito trocado
  assert.equal(validarCNPJ("28618902000104"), false);
});

t("sequência repetida não passa, mesmo com tamanho certo", () => {
  for (const c of ["11111111111", "00000000000", "99999999999"]) assert.equal(validarCPF(c), false, c);
  for (const c of ["11111111111111", "00000000000000"]) assert.equal(validarCNPJ(c), false, c);
});

t("tipo é deduzido pelo tamanho", () => {
  assert.equal(tipoPorDocumento("52998224725"), "PF");
  assert.equal(tipoPorDocumento(CNPJ_GRAEFF), "PJ");
  assert.equal(tipoPorDocumento("123"), null);
  assert.equal(tipoPorDocumento(""), null);
});

t("formatação de cada tipo", () => {
  assert.equal(formatarDocumento("52998224725"), "529.982.247-25");
  assert.equal(formatarDocumento(CNPJ_GRAEFF), "28.618.902/0001-05");
  assert.equal(formatarDocumento("123"), "123"); // não inventa máscara
});

t("erros explicam o que fazer, sem jargão", () => {
  assert.match(analisarDocumento("").erro, /CPF.*CNPJ/);
  assert.match(analisarDocumento("123456").erro, /6 dígitos/);
  assert.match(analisarDocumento("123456").erro, /11 e CNPJ tem 14/);
  assert.match(analisarDocumento("52998224724").erro, /CPF inválido/);
  assert.match(analisarDocumento("28618902000104").erro, /CNPJ inválido/);
});

t("12 ou 13 dígitos (erro de digitação comum) não passa como nenhum dos dois", () => {
  assert.equal(analisarDocumento("286189020001").ok, false);
  assert.equal(analisarDocumento("2861890200010").ok, false);
});

t("não explode com null, undefined e número", () => {
  for (const v of [null, undefined, 12345, {}, []]) {
    assert.equal(analisarDocumento(v).ok, false);
    assert.equal(validarCPF(v), false);
    assert.equal(validarCNPJ(v), false);
  }
});

console.log(`\n${ok}/${ok} testes passaram`);

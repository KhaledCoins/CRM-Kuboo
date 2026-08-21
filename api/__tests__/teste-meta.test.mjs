// O lead falso da Meta não pode chegar em consultor nem em relatório — e
// cliente de verdade chamado "Teste" não pode ser barrado junto.
// Rodar com: npx vite-node api/__tests__/teste-meta.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ehLeadDeTeste } from "../_teste.js";

let ok = 0;
const t = (nome, fn) => { fn(); ok++; console.log(`  ok  ${nome}`); };

// O lead real que entrou no CRM em 21/08, copiado do banco.
t("o lead que furou a barreira em 21/08 é barrado", () => {
  assert.equal(ehLeadDeTeste({
    nome: "<test Lead: Dummy Data for Full_name>",
    email: "test@meta.com", telefone: null,
  }), true);
});

t("as outras caras da ferramenta de teste da Meta", () => {
  assert.equal(ehLeadDeTeste({ nome: "<test Lead: Dummy Data for Name>" }), true);
  assert.equal(ehLeadDeTeste({ email: "TEST@META.COM" }), true, "case não importa");
  assert.equal(ehLeadDeTeste({ email: " test@fb.com " }), true, "espaço não escapa");
  assert.equal(ehLeadDeTeste({ nome: "João", mensagem: "Dummy data for message" }), true);
  assert.equal(ehLeadDeTeste({ nome: "João", produto_interesse: "<test Lead: x>" }), true);
});

// A parte que mais importa: NÃO barrar cliente de verdade.
t("cliente de verdade com 'teste' no nome/email PASSA", () => {
  for (const real of [
    { nome: "Teste Silva", email: "teste.silva@gmail.com" },
    { nome: "Tester Almeida" },
    { nome: "Ernesto Testa", email: "ernesto@empresa.com.br" },
    { nome: "Maria", email: "contato@testes.com.br" },
    { nome: "Protesto Advocacia" },
    { nome: "Celeste Lima" },
  ]) {
    assert.equal(ehLeadDeTeste(real), false, JSON.stringify(real));
  }
});

t("lead vazio/torto não vira teste (nem quebra)", () => {
  assert.equal(ehLeadDeTeste(), false);
  assert.equal(ehLeadDeTeste({}), false);
  assert.equal(ehLeadDeTeste({ nome: null, email: undefined }), false);
});

// A barreira só vale se os DOIS caminhos de captação usarem ela.
t("as duas portas de entrada usam a barreira", () => {
  for (const arq of ["../lead-inbound.js", "../c2s-webhook.js"]) {
    const src = readFileSync(new URL(arq, import.meta.url), "utf8");
    assert.ok(src.includes("ehLeadDeTeste"), `${arq} não filtra lead de teste`);
  }
});

console.log(`\n${ok} testes de lead de teste passaram`);

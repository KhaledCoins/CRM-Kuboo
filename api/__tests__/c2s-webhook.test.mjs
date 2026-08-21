// Testes das duas decisões que, se erradas, corrompem a base inteira de leads:
// (1) qual lead existente o evento do C2S está falando, (2) o que ele pode
// sobrescrever. Rodar com:  npx vite-node api/__tests__/c2s-webhook.test.mjs
import assert from "node:assert/strict";
import { escolherExistente, montarPatch } from "../c2s-webhook.js";

let ok = 0;
const t = (nome, fn) => { fn(); ok++; console.log(`  ok  ${nome}`); };

// ── escolherExistente ───────────────────────────────────────────────────────
t("sem candidatos devolve null (vira lead novo)", () => {
  assert.equal(escolherExistente([], "Maria"), null);
  assert.equal(escolherExistente(null, "Maria"), null);
});

t("telefone de casal: escolhe quem tem o mesmo nome, não o mais recente", () => {
  const cands = [{ id: "b", nome: "João Silva" }, { id: "a", nome: "Maria Silva" }];
  assert.equal(escolherExistente(cands, "Maria Silva").id, "a");
  assert.equal(escolherExistente(cands, "João Silva").id, "b");
});

t("nome com caixa diferente ainda casa", () => {
  assert.equal(escolherExistente([{ id: "a", nome: "MARIA SILVA" }], "maria silva").id, "a");
});

t("C2S sem nome: cai no mais recente (lista já vem ordenada desc)", () => {
  assert.equal(escolherExistente([{ id: "novo", nome: "X" }, { id: "velho", nome: "Y" }], null).id, "novo");
});

// ── montarPatch ─────────────────────────────────────────────────────────────
const linhaBase = {
  nome: "Maria Silva", telefone: "(12) 99999-1234", email: null,
  origem: "webhook", modulo: "consorcios", fonte: "Instagram Leads",
  canal: "Internet", campanha: "CAMPANHA AUTO", fb_pagina: null,
  etapa: "contato", descartado: false, status: "novo", urgencia: "breve",
  mensagem: "primeira mensagem do form", c2s_lead_id: "c2s-123", interagido_em: null,
};

t("adoção carimba o c2s_lead_id no lead importado", () => {
  const p = montarPatch(linhaBase, { etapa: "novos", descartado: false }, "Maria Silva");
  assert.equal(p.c2s_lead_id, "c2s-123");
});

t("NÃO sobrescreve modulo, mensagem e origem de lead que já existe", () => {
  const p = montarPatch(linhaBase, { etapa: "novos", descartado: false }, "Maria Silva");
  for (const k of ["modulo", "mensagem", "origem", "status", "urgencia"]) {
    assert.equal(k in p, false, `${k} não deveria estar no patch`);
  }
});

t("campo nulo do C2S não apaga o que o CRM tem", () => {
  const p = montarPatch(linhaBase, { etapa: "novos", descartado: false }, "Maria Silva");
  assert.equal("email" in p, false);
  assert.equal("fb_pagina" in p, false);
});

t("C2S sem nome não substitui o nome por 'Sem nome — telefone'", () => {
  const semNome = { ...linhaBase, nome: "Sem nome — (12) 99999-1234" };
  const p = montarPatch(semNome, { etapa: "novos", descartado: false }, null);
  assert.equal("nome" in p, false);
});

t("fonte de nascimento não é sobrescrita (Make batizou 'Meta Lead Ads', C2S não apaga)", () => {
  const p = montarPatch(linhaBase, { etapa: "novos", descartado: false, fonte: "Meta Lead Ads" }, "Maria Silva");
  assert.equal("fonte" in p, false, "fonte existente não deveria estar no patch");
});

t("lead ainda sem fonte GANHA a fonte do C2S", () => {
  const p = montarPatch(linhaBase, { etapa: "novos", descartado: false, fonte: null }, "Maria Silva");
  assert.equal(p.fonte, "Instagram Leads");
});

t("etapa avançada no C2S espelha o 1º contato (para o relógio do CRM)", () => {
  const linha = { ...linhaBase, primeiro_contato_em: "2026-08-20T21:43:41Z" };
  const p = montarPatch(linha, { etapa: "novos", descartado: false }, "Maria Silva");
  assert.equal(p.primeiro_contato_em, "2026-08-20T21:43:41Z");
});

t("1º contato já gravado é fato histórico — evento não move o timestamp", () => {
  const linha = { ...linhaBase, primeiro_contato_em: "2026-08-21T10:00:00Z" };
  const p = montarPatch(linha, { etapa: "novos", descartado: false, primeiro_contato_em: "2026-08-20T21:43:41Z" }, "Maria Silva");
  assert.equal("primeiro_contato_em" in p, false);
});

t("evento sem atendimento (etapa novos) não inventa 1º contato", () => {
  const linha = { ...linhaBase, primeiro_contato_em: null };
  const p = montarPatch(linha, { etapa: "novos", descartado: false }, "Maria Silva");
  assert.equal("primeiro_contato_em" in p, false, "null não pode entrar no patch");
});

t("etapa só AVANÇA: evento atrasado não rebaixa negociacao para contato", () => {
  const p = montarPatch(linhaBase, { etapa: "negociacao", descartado: false }, "Maria Silva");
  assert.equal("etapa" in p, false);
});

t("etapa avança quando o C2S está à frente", () => {
  const ganho = { ...linhaBase, etapa: "ganho" };
  const p = montarPatch(ganho, { etapa: "contato", descartado: false }, "Maria Silva");
  assert.equal(p.etapa, "ganho");
});

t("mesma etapa não gera update redundante", () => {
  const p = montarPatch(linhaBase, { etapa: "contato", descartado: false }, "Maria Silva");
  assert.equal("etapa" in p, false);
});

t("pode arquivar, não pode desarquivar sozinho", () => {
  const arquiva = { ...linhaBase, etapa: "perdido", descartado: true };
  assert.equal(montarPatch(arquiva, { etapa: "contato", descartado: false }, "M").descartado, true);
  const reabre = { ...linhaBase, descartado: false };
  assert.equal("descartado" in montarPatch(reabre, { etapa: "novos", descartado: true }, "M"), false);
});

t("etapa desconhecida não vira rebaixamento silencioso", () => {
  // RANK['lixo'] é undefined -> ?? 0; lead já em 'ganho' (5) não regride.
  const p = montarPatch({ ...linhaBase, etapa: "lixo" }, { etapa: "ganho", descartado: false }, "M");
  assert.equal("etapa" in p, false);
});

console.log(`\n${ok}/${ok} testes passaram`);

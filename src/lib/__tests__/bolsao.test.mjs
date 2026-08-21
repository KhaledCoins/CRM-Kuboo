// O bolsão é rede de segurança, NÃO um ladrão de leads: lead que a equipe já
// está trabalhando não pode voltar pra fila pública e ser pego por um colega.
// Rodar com: npx vite-node src/lib/__tests__/bolsao.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ETAPAS_DE_ATENDIMENTO, noBolsao, slaRestanteMin } from "../leads.ts";

let ok = 0;
const t = (nome, fn) => { fn(); ok++; console.log(`  ok  ${nome}`); };
const ONTEM = new Date(Date.now() - 86400000).toISOString();
const DAQUI1H = new Date(Date.now() + 3600000).toISOString();

t("lead sem dono está no bolsão", () => {
  assert.equal(noBolsao({ id: "1", nome: "x", vendedor_id: null }), true);
});

t("lead NOVO com SLA estourado e sem contato cai no bolsão (regra do C2S)", () => {
  assert.equal(noBolsao({ id: "1", nome: "x", vendedor_id: "v", etapa: "novos", sla_expira_em: ONTEM }), true);
});

t("lead EM NEGOCIAÇÃO nunca cai no bolsão, mesmo sem 1º contato registrado", () => {
  for (const etapa of ["contato", "cotacao", "negociacao", "ganho"]) {
    assert.equal(
      noBolsao({ id: "1", nome: "x", vendedor_id: "v", etapa, sla_expira_em: ONTEM }),
      false,
      `${etapa} não pode voltar pro bolsão`
    );
  }
});

t("lead perdido/arquivado com SLA velho ainda segue a regra normal", () => {
  assert.equal(noBolsao({ id: "1", nome: "x", vendedor_id: "v", etapa: "perdido", sla_expira_em: ONTEM }), true);
});

t("lead com 1º contato registrado não cai no bolsão", () => {
  assert.equal(noBolsao({ id: "1", nome: "x", vendedor_id: "v", etapa: "novos", sla_expira_em: ONTEM, primeiro_contato_em: ONTEM }), false);
});

t("SLA dentro do prazo não é bolsão", () => {
  assert.equal(noBolsao({ id: "1", nome: "x", vendedor_id: "v", etapa: "novos", sla_expira_em: DAQUI1H }), false);
});

t("slaRestanteMin: já contatado não tem relógio", () => {
  assert.equal(slaRestanteMin({ id: "1", nome: "x", primeiro_contato_em: ONTEM, sla_expira_em: DAQUI1H }), null);
});

// ── As três regras do bolsão têm que concordar ─────────────────────────────
// noBolsao() (a LISTA), pegarLead() (a trava de corrida) e contarBolsao() (o
// BADGE) respondem a mesma pergunta. Só a primeira conhecia a rede de
// segurança das etapas de atendimento: o badge contava lead em negociação que
// a lista não mostrava, e pegarLead deixava outro consultor TOMAR esse lead.
t("as duas queries do banco usam o MESMO filtro (nenhuma monta o .or() na mão)", () => {
  const src = readFileSync(new URL("../leads.ts", import.meta.url), "utf8");
  const naMao = src.match(/\.or\(`vendedor_id\.is\.null/g) ?? [];
  assert.equal(naMao.length, 0, "query do bolsão montada na mão: vai divergir do noBolsao()");
  assert.equal((src.match(/\.or\(filtroBolsao\(/g) ?? []).length, 2, "pegarLead e contarBolsao usam filtroBolsao");
});

t("o filtro do banco carrega a rede de segurança das etapas", () => {
  const src = readFileSync(new URL("../leads.ts", import.meta.url), "utf8");
  const corpo = src.slice(src.indexOf("function filtroBolsao"), src.indexOf("/** Lead está no bolsão?"));
  assert.ok(corpo.includes("etapa.not.in"), "lead em atendimento não pode voltar pro bolsão");
  // `null not in (...)` é NULL no SQL, não true: sem isto o lead SEM etapa
  // sumia do bolsão em vez de entrar nele.
  assert.ok(corpo.includes("etapa.is.null"), "lead sem etapa tem que continuar entrando no bolsão");
  assert.ok(corpo.includes("ETAPAS_DE_ATENDIMENTO.join"), "a lista de etapas tem que ser a MESMA do noBolsao()");
});

t("cada etapa de atendimento tira o lead do bolsão mesmo com SLA estourado", () => {
  const estourado = { vendedor_id: "v1", primeiro_contato_em: null,
    sla_expira_em: new Date(Date.now() - 3600e3).toISOString() };
  for (const etapa of ETAPAS_DE_ATENDIMENTO) {
    assert.equal(noBolsao({ ...estourado, etapa }), false, `etapa ${etapa} está sendo trabalhada`);
  }
  // "novo"/sem etapa continuam voltando: ninguém falou com o cliente.
  assert.equal(noBolsao({ ...estourado, etapa: "novo" }), true);
  assert.equal(noBolsao({ ...estourado, etapa: null }), true);
});

console.log(`\n${ok} testes de bolsão passaram`);

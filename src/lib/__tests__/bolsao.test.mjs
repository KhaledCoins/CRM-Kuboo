// O bolsão é rede de segurança, NÃO um ladrão de leads: lead que a equipe já
// está trabalhando não pode voltar pra fila pública e ser pego por um colega.
// Rodar com: npx vite-node src/lib/__tests__/bolsao.test.mjs
import assert from "node:assert/strict";
import { noBolsao, slaRestanteMin } from "../leads.ts";

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

console.log(`\n${ok} testes de bolsão passaram`);

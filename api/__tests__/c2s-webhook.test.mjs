// Testes das duas decisões que, se erradas, corrompem a base inteira de leads:
// (1) qual lead existente o evento do C2S está falando, (2) o que ele pode
// sobrescrever. Rodar com:  npx vite-node api/__tests__/c2s-webhook.test.mjs
import assert from "node:assert/strict";
import { concordaIdentidade, escolherExistente, montarPatch, contatoDaEtapa, motivoDoC2S } from "../c2s-webhook.js";

let ok = 0;
const t = (nome, fn) => { fn(); ok++; console.log(`  ok  ${nome}`); };

// ── escolherExistente ───────────────────────────────────────────────────────
// A regra mudou em 21/08 (auditoria): adotar exige PROVA de identidade (nome
// ou e-mail). O comportamento antigo — cair no mais recente quando o nome não
// batia — foi o que deixava o cliente-que-volta preso numa linha arquivada e
// misturava a identidade de duas pessoas que dividem telefone.
t("sem candidatos devolve null (vira lead novo)", () => {
  assert.equal(escolherExistente([], "Maria"), null);
  assert.equal(escolherExistente(null, "Maria"), null);
});

t("telefone de casal: escolhe quem tem o mesmo nome, não o mais recente", () => {
  const cands = [{ id: "b", nome: "João Silva" }, { id: "a", nome: "Maria Silva" }];
  assert.equal(escolherExistente(cands, "Maria Silva").id, "a");
  assert.equal(escolherExistente(cands, "João Silva").id, "b");
});

t("nome com caixa e acento diferentes ainda casa", () => {
  assert.equal(escolherExistente([{ id: "a", nome: "MARIA SILVA" }], "maria silva").id, "a");
  assert.equal(escolherExistente([{ id: "a", nome: "José Antônio" }], "Jose Antonio").id, "a");
});

t("e-mail igual prova identidade mesmo com nome divergente (apelido)", () => {
  const cands = [{ id: "a", nome: "Zé da Silva", email: "jose@x.com" }];
  assert.equal(escolherExistente(cands, "José da Silva Filho", "jose@x.com").id, "a");
});

t("identidade provada adota até lead ARQUIVADO (é a costura da migração)", () => {
  const cands = [{ id: "a", nome: "Maria Silva", descartado: true }];
  assert.equal(escolherExistente(cands, "Maria Silva").id, "a");
});

t("sem prova de identidade: único candidato ATIVO ainda é adotado (nome editado no CRM)", () => {
  assert.equal(escolherExistente([{ id: "a", nome: "Nome Corrigido", descartado: false }], "Nome Antigo").id, "a");
});

t("sem prova + único candidato ARQUIVADO = null — o cliente que volta vira lead NOVO", () => {
  // O caso do fantasma: linha de abril arquivada, cliente preenche de novo em
  // setembro com outro id do C2S. Adotar prenderia o lead pago numa linha que
  // montarPatch nunca desarquiva, invisível pra rodízio (trigger é AFTER INSERT).
  assert.equal(escolherExistente([{ id: "abril", nome: "Outro Nome", descartado: true }], "Cliente Que Volta"), null);
});

t("sem prova + vários candidatos = null (não chuta identidade de ninguém)", () => {
  const cands = [{ id: "novo", nome: "X" }, { id: "velho", nome: "Y" }];
  assert.equal(escolherExistente(cands, null), null);
  assert.equal(escolherExistente(cands, "Terceiro Nome"), null);
});

t("cliente que VOLTA (evento ativo x linha arquivada) vira lead NOVO mesmo com o MESMO nome", () => {
  // O caso do fantasma em que a identidade bate de propósito: é a mesma
  // pessoa preenchendo o anúncio de novo meses depois. O que denuncia é o
  // estado do evento (vivo) contra o da linha (encerrada).
  const abril = [{ id: "abril", nome: "Cliente Que Volta", descartado: true }];
  assert.equal(escolherExistente(abril, "Cliente Que Volta", null, true), null);
  // Já a costura da migração chega com o MESMO estado (arquivado x arquivado):
  assert.equal(escolherExistente(abril, "Cliente Que Volta", null, false).id, "abril");
});

t("concordaIdentidade: nome vazio dos dois lados NÃO é concordância", () => {
  assert.equal(concordaIdentidade({ nome: "", email: "" }, "", ""), false);
  assert.equal(concordaIdentidade({ nome: null }, null, null), false);
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


// ── motivoDoC2S ─────────────────────────────────────────────────────────────
// O C2S manda alias interno; sem traduzir, o lead virava "perdido sem motivo"
// e o gráfico de motivos do gestor nascia furado (42 leads em 14-21/08).
t("traduz os aliases reais do C2S para o catálogo do CRM", () => {
  const caso = (alias) => motivoDoC2S({ lost_reasons: { name: alias } }, true);
  assert.equal(caso("inactive"), "Falta de interação do usuário");
  assert.equal(caso("return_delay"), "Cliente não responde");
  assert.equal(caso("invalid"), "Contato inválido");
  assert.equal(caso("bought_elsewhere"), "Fechou com concorrente");
  assert.equal(caso("duplicated"), "Lead duplicado");
  assert.equal(caso("z_others"), "Outros");
});

t("alias novo/desconhecido vira 'Outros' (melhor que null no relatório)", () => {
  assert.equal(motivoDoC2S({ lost_reasons: { name: "alias_que_nao_existe" } }, true), "Outros");
});

t("lead NÃO descartado nunca ganha motivo", () => {
  assert.equal(motivoDoC2S({ lost_reasons: { name: "inactive" } }, false), null);
});

t("arquivado sem motivo na origem continua sem motivo (não inventa)", () => {
  assert.equal(motivoDoC2S({ lost_reasons: { name: null } }, true), null);
  assert.equal(motivoDoC2S({}, true), null);
  assert.equal(motivoDoC2S(undefined, true), null);
});

t("motivo escolhido no CRM não é sobrescrito por evento do C2S", () => {
  const linha = { ...linhaBase, descartado: true, motivo_descarte: "Falta de interação do usuário" };
  const p = montarPatch(linha, { etapa: "novos", descartado: false, motivo_descarte: "Preço alto" }, "Maria Silva");
  assert.equal("motivo_descarte" in p, false, "o gestor manda no motivo");
});

t("lead sem motivo no CRM RECEBE o motivo do C2S", () => {
  const linha = { ...linhaBase, descartado: true, motivo_descarte: "Contato inválido" };
  const p = montarPatch(linha, { etapa: "novos", descartado: false, motivo_descarte: null }, "Maria Silva");
  assert.equal(p.motivo_descarte, "Contato inválido");
});

// ── contatoDaEtapa ──────────────────────────────────────────────────────────
// A regra vivia SOLTA dentro do handler (que faz I/O e nenhum teste importa):
// apagá-la inteira mantinha a suíte verde. Agora é função exportada e testada.
t("etapa de atendimento no C2S gera 1º contato; 'novos' e 'perdido' não", () => {
  const at = { replied_at: "2026-08-20T21:43:41Z", read_at: "2026-08-20T21:40:00Z" };
  for (const etapa of ["contato", "cotacao", "negociacao", "ganho"]) {
    assert.equal(contatoDaEtapa(etapa, at), "2026-08-20T21:43:41Z", `${etapa} devia espelhar`);
  }
  assert.equal(contatoDaEtapa("novos", at), null);
  assert.equal(contatoDaEtapa("perdido", at), null, "arquivar sem nunca ter falado existe");
});

t("prefere replied_at; sem ele usa read_at; sem os dois, o agora", () => {
  assert.equal(contatoDaEtapa("contato", { read_at: "2026-08-20T21:40:00Z" }), "2026-08-20T21:40:00Z");
  assert.equal(contatoDaEtapa("contato", {}, "2026-08-21T10:00:00Z"), "2026-08-21T10:00:00Z");
  assert.equal(contatoDaEtapa("contato", undefined, "2026-08-21T10:00:00Z"), "2026-08-21T10:00:00Z");
});

t("etapa desconhecida não inventa contato", () => {
  assert.equal(contatoDaEtapa("qualquer_coisa", { replied_at: "x" }), null);
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

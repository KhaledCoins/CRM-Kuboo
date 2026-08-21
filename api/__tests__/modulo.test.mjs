// A decisão de funil testada contra as campanhas REAIS da conta do C2S
// (extraídas do banco: 822 leads). Rodar com:
//   npx vite-node api/__tests__/modulo.test.mjs
import assert from "node:assert/strict";
import { decidirModulo } from "../_modulo.js";

let ok = 0;
const t = (nome, fn) => { fn(); ok++; console.log(`  ok  ${nome}`); };

// ── explícito manda em tudo ─────────────────────────────────────────────────
t("modulo explícito ganha da heurística", () => {
  assert.equal(decidirModulo({ modulo: "seguros", campanha: "MÊS DO CONSÓRCIO" }), "seguros");
  assert.equal(decidirModulo({ modulo: "consorcios", campanha: "Seguro Auto Porto" }), "consorcios");
});

t("modulo inválido é ignorado (não vira lixo no banco)", () => {
  const r = decidirModulo({ modulo: "banana", campanha: "MÊS DO CONSÓRCIO" });
  assert.equal(r, "consorcios");
  assert.ok(["seguros", "consorcios"].includes(decidirModulo({ modulo: "" })));
});

// ── campanhas reais da conta (todas de consórcio) ───────────────────────────
t("as 16 campanhas reais do C2S caem em consórcios", () => {
  const reais = [
    "CAMPANHA CONSUMIDOR - TABELA COMPLETA", "CAMPANHA AUTO", "MÊS DO CONSÓRCIO",
    "CAMPANHA CONSUMIDOR - TABELA MAIOR PRETA", "Leads Kuboo", "CAMPANHA ABRIL - BENEFÍCIOS",
    "[CAMPANHA][PADRÃO]", "Campanha 35% tabela", "Imóvel R - Kuboo",
    "CAMPANHA MÊS DO CONSUMIDOR - DESTAQUE PARCELA", "CAMPANHA CONSUMIDOR VÍDEO 2",
    "CAMPANHA MÊS DO CONSUMIDOR - TABELA MAIOR", "CAMPANHA 50%",
    "CAMPANHA FLEX - CASA DESTAQUE", "CAMPANHA DO CONSUMIDOR - VÍDEO NAH",
    "[1199444-5566] Carro - Leads Kuboo",
  ];
  for (const c of reais) {
    assert.equal(decidirModulo({ campanha: c, fonte: "Instagram Leads" }), "consorcios", `falhou: ${c}`);
  }
});

// ── captação de seguro ──────────────────────────────────────────────────────
t("campanha de seguro cai em seguros", () => {
  for (const c of ["Seguro Auto Porto", "Cotação de apólice residencial",
                   "Seguro de Vida", "Seguro Empresarial - Frota", "Seguro Viagem"]) {
    assert.equal(decidirModulo({ campanha: c }), "seguros", `falhou: ${c}`);
  }
});

t("sinistro e seguradora também puxam pra seguros", () => {
  assert.equal(decidirModulo({ mensagem: "quero abrir um sinistro na seguradora" }), "seguros");
});

// ── o caso que motivou o módulo compartilhado ───────────────────────────────
t("lead do Meta sem modulo NÃO cai mais em seguros por omissão", () => {
  // Antes o lead-inbound devolvia 'seguros' aqui — foi o defeito achado ao vivo.
  const r = decidirModulo({
    campanha: "CAMPANHA AUTO", fonte: "Instagram Leads",
    fb_formulario: "Form consorcio",
    formulario: { valor_desejado: "100000", parcela_ideal: "900", renda: "6000" },
  });
  assert.equal(r, "consorcios");
});

t("conta sinais dos dois lados — o mais forte vence", () => {
  // "seguro" solto no meio de campanha de consórcio não sequestra o lead.
  assert.equal(decidirModulo({
    campanha: "MÊS DO CONSÓRCIO - TABELA", mensagem: "é seguro esse consórcio?",
  }), "consorcios");
  // e o inverso: consórcio citado de passagem numa cotação de seguro.
  assert.equal(decidirModulo({
    campanha: "Seguro Auto", mensagem: "tenho apólice e queria franquia menor",
  }), "seguros");
});

t("respostas do formulário do anúncio entram na conta", () => {
  assert.equal(decidirModulo({ formulario: { "carta de credito": "80 mil" } }), "consorcios");
  assert.equal(decidirModulo({ formulario: { produto: "apolice residencial" } }), "seguros");
});

// ── bordas ──────────────────────────────────────────────────────────────────
t("sem nenhum sinal cai em consórcios (captação externa da Kuboo)", () => {
  assert.equal(decidirModulo({}), "consorcios");
  assert.equal(decidirModulo({ campanha: "xyz", fonte: "abc" }), "consorcios");
});

t("não explode com null, undefined e tipo errado", () => {
  for (const s of [null, undefined, { campanha: null, formulario: null }, { formulario: "texto solto" }, { campanha: 123 }]) {
    assert.ok(["seguros", "consorcios"].includes(decidirModulo(s)));
  }
});

t("acento faltando não muda a decisão", () => {
  assert.equal(decidirModulo({ campanha: "MES DO CONSORCIO" }), "consorcios");
  assert.equal(decidirModulo({ campanha: "cotacao de apolice" }), "seguros");
});

// ── Palavra inteira, não pedaço de palavra ─────────────────────────────────
// "cota" (termo de consórcio) casava dentro de "cotAÇÃO" — e cotação é
// palavra de SEGURO. "Cotação de seguro auto" empatava 1x1 e caía no funil
// errado. Flagrado ao testar o direcionamento com nomes de campanha reais.
t("cotação de seguro vai pra SEGUROS (cota não casa dentro de cotação)", () => {
  assert.equal(decidirModulo({ campanha: "Cotação de seguro auto" }), "seguros");
  assert.equal(decidirModulo({ campanha: "Cotar seguro residencial" }), "seguros");
});

t("cota/cotas de verdade continuam indo pra CONSÓRCIOS", () => {
  assert.equal(decidirModulo({ campanha: "Venda de cotas contempladas" }), "consorcios");
  assert.equal(decidirModulo({ campanha: "Transferência de cota" }), "consorcios");
});

t("palavra dentro de outra não pontua (convida ≠ vida, lancheteria ≠ lance)", () => {
  assert.equal(decidirModulo({ campanha: "Convida um amigo", mensagem: "consórcio" }), "consorcios");
  assert.equal(decidirModulo({ campanha: "Seguro de vida em grupo" }), "seguros");
});

// As 9 campanhas REAIS da página da Kuboo (inventário de 21/08) — todas de
// consórcio. Se o direcionamento quebrar, o lead cai no funil errado.
t("as campanhas reais da Kuboo caem todas em consórcios", () => {
  const reais = ["CAMPANHA 50%", "CAMPANHA AUTO", "MÊS DO CONSÓRCIO",
    "CAMPANHA CONSUMIDOR - TABELA COMPLETA", "CAMPANHA FLEX - IMOVEL",
    "CAMPANHA 50% IMOVEL", "Campanha 35% tabela", "IMOVEL - VIDEO ANA",
    "CAMPANHA FLEX - CONSORCIO PORTO"];
  for (const c of reais) {
    assert.equal(decidirModulo({ campanha: c, fonte: "Facebook Leads" }), "consorcios", c);
  }
});

// Quando a Kuboo criar campanha de SEGURO, ela precisa cair no funil certo.
t("campanha de seguro futura cai em SEGUROS", () => {
  for (const c of ["CAMPANHA SEGURO AUTO", "Seguro Residencial", "SEGURO DE VIDA - FAMÍLIA", "Renovação de apólice"]) {
    assert.equal(decidirModulo({ campanha: c, fonte: "Facebook Leads" }), "seguros", c);
  }
});

console.log(`\n${ok}/${ok} testes passaram`);

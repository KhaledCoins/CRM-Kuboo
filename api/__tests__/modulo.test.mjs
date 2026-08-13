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

console.log(`\n${ok}/${ok} testes passaram`);

// A rede final da captação: um formulário NOVO do Meta (que o mapeamento fixo
// do Make não conhece) precisa continuar entregando formulário, mensagem e
// telefone via respostas_raw. Rodar com:
//   npx vite-node api/__tests__/lead-inbound-raw.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { camposParaEnriquecer, extrairRespostas, formularioDoRaw, telefoneDoRaw } from "../lead-inbound.js";

let ok = 0;
const t = (nome, fn) => { fn(); ok++; console.log(`  ok  ${nome}`); };

// O formato real do Meta (field_data da Graph API) e as variantes que a app
// do Make pode emitir — o parse aceita todas.
const RAW_META = [
  { name: "full_name", values: ["Maria Silva"] },
  { name: "email", values: ["maria@x.com"] },
  { name: "phone_number", values: ["+5512988776655"] },
  { name: "qual_valor_deseja_adquirir?", values: ["R$ 100.000"] },
  { name: "qual_seu_whatsapp_para_contato?", values: ["12 98877-6655"] },
];

t("formato Graph API: campos padrão ficam fora do formulário", () => {
  const f = formularioDoRaw(extrairRespostas(RAW_META));
  assert.deepEqual(Object.keys(f), ["qual_valor_deseja_adquirir?", "qual_seu_whatsapp_para_contato?"]);
});

t("variante do Make (field_label/values) também parseia", () => {
  const f = formularioDoRaw(extrairRespostas([
    { field_key: "renda_mensal?", field_label: "Renda mensal?", values: ["R$ 5.000"] },
  ]));
  assert.deepEqual(f, { "Renda mensal?": "R$ 5.000" });
});

t("múltiplas escolhas viram texto legível (join por vírgula)", () => {
  const f = formularioDoRaw(extrairRespostas([{ name: "interesses", values: ["carro", "imóvel"] }]));
  assert.equal(f["interesses"], "carro, imóvel");
});

t("pergunta de WhatsApp GANHA do phone_number nativo (número que o cliente digitou)", () => {
  assert.equal(telefoneDoRaw(extrairRespostas(RAW_META)), "12 98877-6655");
});

t("sem pergunta de WhatsApp, qualquer resposta que pareça telefone serve", () => {
  assert.equal(telefoneDoRaw(extrairRespostas([{ name: "seu_celular", values: ["12 3822-4455"] }])), "12 3822-4455");
  assert.equal(telefoneDoRaw(extrairRespostas([{ name: "phone_number", values: ["+5512988776655"] }])), "+5512988776655");
});

// A regressão que a auditoria de 21/08 pegou: casar a PERGUNTA não basta.
t("pergunta sim/não sobre WhatsApp NÃO vira telefone (era 'Sim' no campo)", () => {
  const raw = [
    { name: "podemos_te_chamar_no_whatsapp?", values: ["Sim"] },
    { name: "phone_number", values: ["+5512988776655"] },
  ];
  assert.equal(telefoneDoRaw(extrairRespostas(raw)), "+5512988776655", "tem que cair no número real, não no 'Sim'");
});

t("resposta de texto livre em pergunta de contato NÃO vira telefone", () => {
  assert.equal(telefoneDoRaw(extrairRespostas([{ name: "melhor_horario_de_contato?", values: ["Depois das 18h"] }])), "");
  assert.equal(telefoneDoRaw(extrairRespostas([{ name: "prefere_contato_por?", values: ["Email"] }])), "");
});

t("número absurdo (CPF, valor, ano) não é aceito como telefone", () => {
  assert.equal(telefoneDoRaw(extrairRespostas([{ name: "qual_valor?", values: ["2026"] }])), "", "4 dígitos não é telefone");
  assert.equal(telefoneDoRaw(extrairRespostas([{ name: "documento", values: ["1234567890123456789"] }])), "", "19 dígitos não é telefone");
});

t("sem nada que pareça telefone devolve vazio (não inventa)", () => {
  assert.equal(telefoneDoRaw(extrairRespostas([{ name: "renda", values: ["R$ 5.000"] }])), "");
});

t("lixo não derruba: null, item torto, values vazio, tudo ignorado", () => {
  assert.deepEqual(extrairRespostas(null), []);
  assert.deepEqual(extrairRespostas("não é array"), []);
  assert.deepEqual(extrairRespostas([null, 42, {}, { name: "x" }, { name: "y", values: ["", null] }]), []);
});

t("respostas custom vazias não criam formulário fantasma", () => {
  assert.equal(formularioDoRaw(extrairRespostas([{ name: "full_name", values: ["Zé"] }])), null);
});

// ── Dedup: lead ARQUIVADO não absorve contato novo ─────────────────────────
// Achado no teste real de ponta a ponta (21/08): o dedup de 24h devolveu um
// lead perdido/arquivado e o contato novo evaporou. Cenário real: cliente
// arquivado de manhã ("não consegui contato") volta à tarde decidido — esse
// contato PRECISA virar lead e ir pro rodízio. A regra vive na query, então o
// teste verifica o código do endpoint.
t("a consulta de dedup exclui leads arquivados", () => {
  const src = readFileSync(new URL("../lead-inbound.js", import.meta.url), "utf8");
  const ini = src.indexOf("const { data: recentes }");
  const fim = src.indexOf("const existente");
  assert.ok(ini > 0 && fim > ini, "nao achei o bloco de dedup");
  assert.ok(src.slice(ini, fim).includes('.eq("descartado", false)'), "o dedup precisa ignorar lead arquivado");
});

// ── Enriquecimento no dedup ────────────────────────────────────────────────
// O C2S é instantâneo, o Make passa por fila. Quando o C2S cria o lead
// primeiro, o payload do Make caía no dedup e era jogado fora inteiro — junto
// iam as respostas do formulário e o nome do anúncio, que SÓ o Make traz.
t("preenche o que falta no lead que o C2S criou primeiro", () => {
  const doMake = { formulario: { "Valor do crédito?": "R$ 100.000" }, fb_anuncio: "AUTO - VIDEO ANA", campanha: "CAMPANHA AUTO" };
  const doC2S = { formulario: null, fb_anuncio: null, campanha: "CAMPANHA AUTO" };
  assert.deepEqual(camposParaEnriquecer(doMake, doC2S), {
    formulario: { "Valor do crédito?": "R$ 100.000" },
    fb_anuncio: "AUTO - VIDEO ANA",
  }, "campanha já estava lá: não entra no patch");
});

t("NUNCA sobrescreve o que já está preenchido", () => {
  const patch = camposParaEnriquecer(
    { campanha: "OUTRA", email: "novo@x.com", mensagem: "outra msg", produto_interesse: "outro" },
    { campanha: "CAMPANHA AUTO", email: "cliente@x.com", mensagem: "msg original", produto_interesse: "Consórcio" },
  );
  assert.deepEqual(patch, {});
});

t("dono, etapa, valor e telefone NÃO são enriquecíveis (posse e identidade)", () => {
  const patch = camposParaEnriquecer(
    { vendedor_id: "invasor", etapa: "ganho", valor_potencial: 999999, telefone: "(11) 90000-0000", descartado: false },
    { vendedor_id: null, etapa: null, valor_potencial: null, telefone: null, descartado: null },
  );
  assert.deepEqual(patch, {}, "enriquecimento não pode roubar lead nem mexer no funil");
});

t("formulário vazio {} conta como buraco, não como preenchido", () => {
  const cheio = { "Valor?": "R$ 50.000" };
  assert.deepEqual(camposParaEnriquecer({ formulario: cheio }, { formulario: {} }), { formulario: cheio });
  assert.deepEqual(camposParaEnriquecer({ formulario: {} }, { formulario: null }), {}, "vazio não preenche nada");
});

t("string só com espaço é buraco, dos dois lados", () => {
  assert.deepEqual(camposParaEnriquecer({ fb_anuncio: "   " }, { fb_anuncio: null }), {});
  assert.deepEqual(camposParaEnriquecer({ fb_anuncio: "ANUNCIO X" }, { fb_anuncio: "   " }), { fb_anuncio: "ANUNCIO X" });
});

t("lead torto não quebra", () => {
  assert.deepEqual(camposParaEnriquecer(undefined, undefined), {});
  assert.deepEqual(camposParaEnriquecer({}, {}), {});
});

// O UPDATE do enriquecimento tem que conferir se voltou linha: PostgREST
// devolve ZERO linhas SEM erro quando a RLS barra.
t("o update do enriquecimento confere se a linha voltou", () => {
  const src = readFileSync(new URL("../lead-inbound.js", import.meta.url), "utf8");
  const bloco = src.slice(src.indexOf("const patch = camposParaEnriquecer"), src.indexOf("enriquecer falhou"));
  assert.ok(bloco.includes('.select("id")'), "sem .select() o enriquecido seria mentira");
  assert.ok(bloco.includes("upd?.length"), "precisa conferir se voltou linha");
});

console.log(`\n${ok} testes de respostas_raw passaram`);

// A rede final da captação: um formulário NOVO do Meta (que o mapeamento fixo
// do Make não conhece) precisa continuar entregando formulário, mensagem e
// telefone via respostas_raw. Rodar com:
//   npx vite-node api/__tests__/lead-inbound-raw.test.mjs
import assert from "node:assert/strict";
import { extrairRespostas, formularioDoRaw, telefoneDoRaw } from "../lead-inbound.js";

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

console.log(`\n${ok} testes de respostas_raw passaram`);

// A rede final da captação: um formulário NOVO do Meta (que o mapeamento fixo
// do Make não conhece) precisa continuar entregando formulário, mensagem e
// telefone via respostas_raw. Rodar com:
//   npx vite-node api/__tests__/lead-inbound-raw.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { camposParaEnriquecer, extrairRespostas, formularioDoRaw, nomeDoRaw, telefoneDoRaw } from "../lead-inbound.js";

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

t("dono, etapa, valor e descartado NÃO são enriquecíveis (posse e funil)", () => {
  const patch = camposParaEnriquecer(
    { vendedor_id: "invasor", etapa: "ganho", valor_potencial: 999999, descartado: false },
    { vendedor_id: null, etapa: null, valor_potencial: null, descartado: null },
  );
  assert.deepEqual(patch, {}, "enriquecimento não pode roubar lead nem mexer no funil");
});

// Regra ajustada em 21/08 (auditoria, achado 5): o espelho do C2S cria lead
// SEM telefone (número que a máscara BR rejeita) ou rotulado "Sem nome — ...",
// e o Make chega minutos depois com o dado real. Buraco pode ser preenchido;
// valor preenchido continua intocável.
t("telefone: preenche o buraco, nunca troca o que está lá", () => {
  assert.deepEqual(camposParaEnriquecer({ telefone: "(12) 98877-6655" }, { telefone: null }),
    { telefone: "(12) 98877-6655" });
  assert.deepEqual(camposParaEnriquecer({ telefone: "(11) 90000-0000" }, { telefone: "(12) 98877-6655" }),
    {}, "telefone preenchido é identidade — não se troca");
});

t("nome: o rótulo 'Sem nome — ...' conta como buraco; nome real não", () => {
  assert.deepEqual(camposParaEnriquecer({ nome: "Maria Silva" }, { nome: "Sem nome — (12) 98877-6655" }),
    { nome: "Maria Silva" });
  assert.deepEqual(camposParaEnriquecer({ nome: "Outra Pessoa" }, { nome: "Maria Silva" }),
    {}, "nome de verdade nunca é sobrescrito");
  // Simetria: o rótulo é vazio dos DOIS lados — rótulo não substitui rótulo.
  assert.deepEqual(camposParaEnriquecer({ nome: "Sem nome — x" }, { nome: "Sem nome — y" }), {});
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

// ── Nome que não vem mapeado (achado 2 da auditoria) ───────────────────────
// A agência publica um formulário onde o nome é pergunta custom, ou vem
// partido em first_name+last_name. O Make segue mandando a chave antiga,
// agora vazia. Antes: 400 e a CAMPANHA INTEIRA no chão, com telefone, e-mail
// e respostas dentro do payload que foi descartado.
t("nome vem do full_name do raw quando a chave mapeada veio vazia", () => {
  assert.equal(nomeDoRaw(extrairRespostas(RAW_META)), "Maria Silva");
});

t("first_name + last_name separados viram nome completo", () => {
  const raw = [{ name: "first_name", values: ["Ana"] }, { name: "last_name", values: ["Prado"] }];
  assert.equal(nomeDoRaw(extrairRespostas(raw)), "Ana Prado");
});

t("só first_name já serve (melhor meio nome que nenhum)", () => {
  assert.equal(nomeDoRaw(extrairRespostas([{ name: "first_name", values: ["Ana"] }])), "Ana");
});

t("pergunta CUSTOM de nome é aproveitada", () => {
  for (const chave of ["qual_e_o_seu_nome?", "nome_completo", "Seu nome", "What is your name?"]) {
    assert.equal(nomeDoRaw(extrairRespostas([{ name: chave, values: ["João Pedro"] }])), "João Pedro", chave);
  }
});

t("NÃO confunde nome de empresa com nome da pessoa", () => {
  const raw = [{ name: "nome_da_empresa", values: ["Kuboo Ltda"] }, { name: "full_name", values: ["Carlos"] }];
  assert.equal(nomeDoRaw(extrairRespostas(raw)), "Carlos");
  assert.equal(nomeDoRaw(extrairRespostas([{ name: "razao_social", values: ["ACME SA"] }])), "");
});

t("telefone respondido numa pergunta de nome não vira nome", () => {
  assert.equal(nomeDoRaw(extrairRespostas([{ name: "nome_e_telefone", values: ["(12) 98877-6655"] }])), "");
});

t("palavra dentro de outra não casa (sobrenome ≠ nome)", () => {
  assert.equal(nomeDoRaw(extrairRespostas([{ name: "renomear", values: ["x"] }])), "");
});

t("sem nada que pareça nome devolve vazio, não inventa", () => {
  assert.equal(nomeDoRaw(extrairRespostas([{ name: "renda", values: ["R$ 5.000"] }])), "");
  assert.equal(nomeDoRaw([]), "");
});

// A regra que decide entre gravar o lead e devolver 400.
t("400 SÓ quando não há nome NEM contato — com contato, o lead entra", () => {
  const src = readFileSync(new URL("../lead-inbound.js", import.meta.url), "utf8");
  const bloco = src.slice(src.indexOf("let nome = String(b.nome"), src.indexOf("// origem fora do catálogo"));
  assert.ok(bloco.includes("nomeDoRaw(rawItens)"), "tem que tentar o raw antes de desistir");
  assert.ok(bloco.includes("!telBrutoPreliminar && !emailPreliminar"),
    "400 só sem NENHUM contato — lead com telefone tem que entrar mesmo sem nome");
  assert.ok(bloco.includes("Sem nome —"), "sem nome mas com contato vira lead rotulado, igual ao espelho do C2S");
  // O parse do raw tem que vir ANTES da validação, senão o payload é descartado.
  assert.ok(src.indexOf("const rawItens = extrairRespostas") < src.indexOf("let nome = String(b.nome"),
    "o raw precisa ser lido ANTES de validar o nome");
});

// O casamento de telefone do dedup é por IGUALDADE EXATA (achado 4): depois
// da máscara, sufixo só conseguia fundir pessoas diferentes.
t("dedup não casa telefone por sufixo (fixo DDD 29 x celular DDD 12)", () => {
  const src = readFileSync(new URL("../lead-inbound.js", import.meta.url), "utf8");
  const bloco = src.slice(src.indexOf("const mesmoTelefone"), src.indexOf("try {"));
  assert.ok(bloco.includes("return a === b;"), "igualdade exata");
  assert.ok(!bloco.includes("a.endsWith(b)"), "sufixo funde fixo (29) 8877-6655 com celular (12) 98877-6655");
});

// Score de nascimento: o espelho do C2S manda 60 explícito (achado 3) — sem
// isso o default 0 da coluna afundava todo lead espelhado no fim do bolsão.
t("os dois receptores dão o MESMO score de nascimento", () => {
  const inbound = readFileSync(new URL("../lead-inbound.js", import.meta.url), "utf8");
  const c2s = readFileSync(new URL("../c2s-webhook.js", import.meta.url), "utf8");
  assert.ok(inbound.includes(": 60"), "lead-inbound nasce com 60");
  assert.ok(c2s.includes("score: 60"), "espelho do C2S nasce com 60");
  assert.ok(c2s.includes("delete patch.score"), "e o 60 não sobrescreve score já ajustado num update");
});

console.log(`\n${ok} testes de respostas_raw passaram`);

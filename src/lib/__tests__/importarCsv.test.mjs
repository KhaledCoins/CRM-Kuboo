// Encaixe de valor de planilha no catálogo do banco + tradução do erro do
// Postgres. Rodar com:  npx vite-node src/lib/__tests__/importarCsv.test.mjs
import assert from "node:assert/strict";
import { casarOpcao, explicarErro, paraData } from "../../components/ImportarCsv.tsx";

let ok = 0;
const t = (nome, fn) => { fn(); ok++; console.log(`  ok  ${nome}`); };

const TIPO_APOLICE = ["Auto", "Vida", "Residencial", "Empresarial", "Condomínio", "Pet", "Viagem", "Saúde", "Outros"];
const TIPO_CONSORCIO = ["Imóvel", "Veículo", "Empresarial"];
const ADMIN = ["Âncora", "Porto", "Tradição", "Outros"];
const STATUS_APOLICE = ["ativa", "vencida", "cancelada", "em_renovação", "pendente"];

// ── casarOpcao ──────────────────────────────────────────────────────────────
t("acento faltando na planilha ainda casa", () => {
  assert.equal(casarOpcao("imovel", TIPO_CONSORCIO), "Imóvel");
  assert.equal(casarOpcao("veiculo", TIPO_CONSORCIO), "Veículo");
  assert.equal(casarOpcao("ancora", ADMIN), "Âncora");
  assert.equal(casarOpcao("condominio", TIPO_APOLICE), "Condomínio");
  assert.equal(casarOpcao("saude", TIPO_APOLICE), "Saúde");
});

t("caixa alta, espaço sobrando e underscore não atrapalham", () => {
  assert.equal(casarOpcao("  IMÓVEL ", TIPO_CONSORCIO), "Imóvel");
  assert.equal(casarOpcao("Em Renovação", STATUS_APOLICE), "em_renovação");
  assert.equal(casarOpcao("em renovacao", STATUS_APOLICE), "em_renovação");
  assert.equal(casarOpcao("ATIVA", STATUS_APOLICE), "ativa");
});

t("valor que não existe no catálogo devolve null (não inventa dado)", () => {
  assert.equal(casarOpcao("Moto", TIPO_CONSORCIO), null);
  assert.equal(casarOpcao("Bradesco", ADMIN), null);
  assert.equal(casarOpcao("", TIPO_CONSORCIO), null);
  assert.equal(casarOpcao("   ", TIPO_CONSORCIO), null);
});

t("não confunde opções parecidas", () => {
  // "Empresarial" existe nos dois catálogos; "Imóvel" não existe em apólices.
  assert.equal(casarOpcao("empresarial", TIPO_APOLICE), "Empresarial");
  assert.equal(casarOpcao("imovel", TIPO_APOLICE), null);
});

// ── explicarErro ────────────────────────────────────────────────────────────
const campos = [
  { key: "tipo", label: "Tipo", opcoes: TIPO_CONSORCIO },
  { key: "status", label: "Status" },
  { key: "valor_credito", label: "Carta de crédito" },
];

t("CHECK violado vira frase com o campo e os valores aceitos", () => {
  const m = explicarErro(
    'new row for relation "consorcios" violates check constraint "consorcios_tipo_check"', campos);
  assert.match(m, /Tipo/);
  assert.match(m, /Imóvel, Veículo, Empresarial/);
});

t("CHECK de campo sem catálogo não promete lista que não existe", () => {
  const m = explicarErro(
    'new row for relation "vendas" violates check constraint "vendas_status_check"', campos);
  assert.match(m, /Status/);
  assert.equal(/Aceitos/.test(m), false);
});

t("coluna obrigatória em branco é traduzida", () => {
  assert.match(explicarErro('null value in column "valor_credito" violates not-null', campos), /Carta de crédito/);
});

t("erros comuns viram instrução, não jargão", () => {
  assert.match(explicarErro("duplicate key value violates unique constraint", campos), /duplicado/i);
  assert.match(explicarErro('invalid input syntax for type numeric: "1.2.3"', campos), /Número inválido/);
  assert.match(explicarErro('invalid input syntax for type date: "31/31/2026"', campos), /Data inválida/);
  assert.match(explicarErro("new row violates row-level security policy", campos), /permissão/i);
});

t("erro desconhecido não some — aparece truncado", () => {
  assert.equal(explicarErro("boom inesperado", campos), "boom inesperado");
});

// ── paraData (regressão: já era usado, sem teste) ───────────────────────────
t("datas pt-BR e ISO", () => {
  assert.equal(paraData("31/12/2026"), "2026-12-31");
  assert.equal(paraData("1/2/26"), "2026-02-01");
  assert.equal(paraData("2026-12-31T10:00:00Z"), "2026-12-31");
  assert.equal(paraData("banana"), null);
});

console.log(`\n${ok}/${ok} testes passaram`);

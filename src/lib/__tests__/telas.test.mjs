// Telas que MENTEM pro consultor. Cada teste nasceu de um achado confirmado
// pela auditoria de 21/08. O padrão que se repete: no PostgREST, UPDATE ou
// DELETE barrado por RLS volta ZERO linhas SEM erro — então `if (error)`
// sozinho reporta sucesso pra escrita que não aconteceu.
// Rodar com: npx vite-node src/lib/__tests__/telas.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let ok = 0;
const t = (nome, fn) => { fn(); ok++; console.log(`  ok  ${nome}`); };
const ler = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const semComentarios = (src) =>
  src.split(/\r?\n/).filter((l) => !l.trimStart().startsWith("//")).join("\n");

// ── [20] Quadro de Tarefas ─────────────────────────────────────────────────
t("os três escritores de tarefas conferem se a linha voltou", () => {
  const src = semComentarios(ler("../tarefas.ts"));
  for (const fn of ["moverTarefa", "atualizarTarefa", "excluirTarefa"]) {
    const ini = src.indexOf(`export async function ${fn}`);
    assert.ok(ini > 0, `${fn} não encontrada — teste cego`);
    const corpo = src.slice(ini, src.indexOf("\n}", ini));
    assert.ok(corpo.includes('.select("id")'), `${fn}: sem .select() a gravação barrada por RLS passa por sucesso`);
    assert.ok(/data\?\.length/.test(corpo), `${fn}: precisa conferir se voltou linha`);
  }
});

t("arrastar tarefa sem permissão LANÇA (o card tem que voltar)", () => {
  const src = semComentarios(ler("../tarefas.ts"));
  const corpo = src.slice(src.indexOf("export async function moverTarefa"), src.indexOf("export async function atualizarTarefa"));
  assert.ok(corpo.includes("throw new Error(NADA_GRAVADO)"),
    "o onDragEnd desfaz o card no catch — sem throw, o card fica na coluna errada até recarregar");
});

// ── [24] etiqueta e favorito ───────────────────────────────────────────────
t("remover etiqueta e desfavoritar conferem a linha", () => {
  const src = semComentarios(ler("../c2s.ts"));
  for (const [fn, ate] of [["alternarEtiqueta", "export async function favoritosDoUsuario"], ["alternarFavorito", "export async function logDoLead"]]) {
    const ini = src.indexOf(`export async function ${fn}`);
    const fim = src.indexOf(ate);
    assert.ok(ini > 0 && fim > ini, `${fn}: âncoras do slice quebradas — teste cego`);
    const corpo = src.slice(ini, fim);
    assert.ok(corpo.includes(".select("), `${fn}: DELETE sem .select() some da tela e fica no banco`);
    assert.ok(/data\?\.length/.test(corpo), `${fn}: precisa conferir se voltou linha`);
    assert.ok(corpo.includes("0 linhas afetadas"), `${fn}: o zero-linhas tem que virar false, não sucesso`);
  }
});

// ── [19] falha de carga virando "vazio" ────────────────────────────────────
t("fetchLeads devolve o erro junto — ninguém pode ignorar sem o compilador ver", () => {
  const src = ler("../leads.ts");
  assert.ok(src.includes("export type LeadsCarregados = { leads: Lead[]; erro: string | null }"),
    "o erro precisa estar no tipo, senão a tela mostra lista vazia numa falha de rede");
  const corpo = src.slice(src.indexOf("export async function fetchLeads"), src.indexOf("// ─── Aba \"Arquivados\""));
  assert.ok(corpo.includes("return { leads: [], erro: error.message }"), "erro tem que subir, não virar lista vazia");
});

t("contarBolsao devolve null no erro (badge some) em vez de 0 (badge mente)", () => {
  const src = ler("../leads.ts");
  const corpo = src.slice(src.indexOf("export async function contarBolsao"), src.indexOf("// ATENÇÃO ao padrão"));
  assert.ok(corpo.includes("Promise<number | null>"), "0 é uma afirmação: 'contei e está vazio'");
  // A linha exata: o `if (!supabase) return null` do topo também contém
  // "return null" e mascarava a mutação que remove o return DO ERRO.
  assert.ok(/if \(error\) \{[^}]*return null;? \}/.test(corpo), "no erro, não sabemos a contagem — o return null tem que estar no ramo do erro");
});

t("as três telas de trabalho separam 'vazio' de 'não consegui carregar'", () => {
  for (const [arq, oQue] of [
    ["../../pages/Bolsao.tsx", "o bolsão"],
    ["../../pages/MeusLeads.tsx", "seus leads"],
    ["../../pages/Pipeline.tsx", "o funil"],
  ]) {
    const src = ler(arq);
    assert.ok(src.includes("setErroCarga"), `${arq}: não guarda o erro`);
    assert.ok(src.includes("<ErroCarga"), `${arq}: falha de rede continua virando estado vazio`);
    assert.ok(src.includes(oQue), `${arq}: o aviso tem que dizer O QUE não carregou`);
  }
});

t("o badge do bolsão não estampa contagem que não apurou", () => {
  const src = ler("../../components/Layout.tsx");
  assert.ok(src.includes("bolsaoCount !== null && bolsaoCount > 0"),
    "com null, `bolsaoCount > 0` é false e o badge some — mas o tipo tem que dizer isso");
});

// ── [18] rodízio manual abortando no meio ──────────────────────────────────
t("uma falha no meio não aborta a distribuição inteira", () => {
  const src = semComentarios(ler("../leads.ts"));
  const corpo = src.slice(src.indexOf("export async function distribuirBolsao"), src.indexOf("export async function distribuirBolsao") + 1800);
  assert.ok(corpo.includes("try {") && corpo.includes("falhados++"),
    "pegarLead LANÇA; sem catch, os leads seguintes nem são tentados");
  assert.ok(corpo.includes("falhados"), "a tela precisa poder dizer quantos falharam");
});

t("o botão Distribuir não fica travado quando algo falha", () => {
  const src = ler("../../pages/Bolsao.tsx");
  const corpo = src.slice(src.indexOf("async function handleDistribuir"), src.indexOf("async function handleDescartar"));
  assert.ok(corpo.includes("finally"), "sem finally, setDistribuindo(false) não roda na falha");
  assert.ok(corpo.includes("setDistribuindo(false)") && corpo.indexOf("finally") < corpo.indexOf("setDistribuindo(false)", corpo.indexOf("finally")),
    "o setDistribuindo(false) tem que estar DENTRO do finally");
  assert.ok(/falha\(s\) de gravação|com falha/.test(corpo), "o toast precisa reportar as falhas, não só os sucessos");
});

// ── [6][7] rodízio manual sempre no mesmo consultor ────────────────────────
t("o rodízio manual RETOMA de onde parou", () => {
  const libs = semComentarios(ler("../leads.ts"));
  const corpo = libs.slice(libs.indexOf("export async function distribuirBolsao"), libs.indexOf("export async function distribuirBolsao") + 1800);
  assert.ok(corpo.includes("let i = comecarEm;"),
    "o índice tem que PARTIR do comecarEm — só recebê-lo na assinatura e ignorar deixa tudo começando em 0");
  assert.ok(corpo.includes("proximoIndice"), "o chamador precisa saber onde parou pra retomar");

  const tela = ler("../../pages/Bolsao.tsx");
  assert.ok(tela.includes("kuboo_rodizio_manual_proximo"), "o ponto de partida precisa sobreviver ao recarregamento");
  assert.ok(tela.includes('.order("id", { ascending: true })'),
    "sem ordem estável, o índice salvo aponta pra outra pessoa na próxima execução");
});

console.log(`\n${ok} testes de telas passaram`);

// Os números que decidem dinheiro. Cada teste abaixo nasceu de um achado
// confirmado pela auditoria de 21/08 — todos em código que a equipe começa a
// exercitar no dia em que ligar o CRM (vendas/comissoes/metas estavam vazias).
// Rodar com: npx vite-node src/lib/__tests__/dinheiro.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { rangeFor, mesCorrente } from "../../components/Periodo.tsx";
import { hojeLocal, mesLocal, diaLocalDe } from "../format.ts";

let ok = 0;
const t = (nome, fn) => { fn(); ok++; console.log(`  ok  ${nome}`); };
const ler = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

// ── [29] período sem teto ──────────────────────────────────────────────────
t("TODO período tem teto — venda com data futura não entra em lugar nenhum", () => {
  const hoje = hojeLocal();
  for (const k of ["mes", "mes_passado", "tri", "ano"]) {
    const r = rangeFor(k);
    assert.ok(r.lte, `${k} sem teto: venda digitada com o ano errado infla o período pra sempre`);
    assert.ok(r.lte <= hoje || k === "mes_passado", `${k}: teto no futuro (${r.lte})`);
    assert.ok(r.gte <= r.lte, `${k}: intervalo invertido`);
  }
});

t("os períodos cobrem o que prometem", () => {
  const hoje = hojeLocal();
  const [ano, mes] = hoje.split("-").map(Number);
  assert.equal(rangeFor("mes").gte, `${ano}-${String(mes).padStart(2, "0")}-01`);
  assert.equal(rangeFor("mes").lte, hoje);
  assert.equal(rangeFor("ano").gte, `${ano}-01-01`);
  // "Mês passado" é o único fechado nas duas pontas — e o único que já estava certo.
  const rp = rangeFor("mes_passado");
  assert.ok(rp.lte < rangeFor("mes").gte, "mês passado tem que terminar antes deste mês começar");
  assert.match(rp.lte, /-(28|29|30|31)$/, "tem que fechar no último dia do mês");
});

t("virada de ano não quebra 'mês passado' nem 'últimos 3 meses'", () => {
  // A aritmética é sobre números, não sobre Date local — janeiro tem que
  // voltar pra dezembro do ano anterior.
  const src = ler("../../components/Periodo.tsx");
  assert.ok(src.includes("mes === 1 ? ano - 1 : ano"), "janeiro tem que voltar pra dezembro/ano-1");
  assert.ok(src.includes("while (m < 1) { m += 12; a -= 1; }"), "o trimestre tem que atravessar a virada");
});

// ── [30] meta de mês futuro ────────────────────────────────────────────────
t("mesCorrente fecha nas duas pontas (meta de mês FUTURO não vira a meta de hoje)", () => {
  const m = mesCorrente();
  assert.equal(m.gte, `${mesLocal()}-01`);
  assert.ok(m.lte.startsWith(mesLocal()), "o teto tem que ser do MESMO mês");
  assert.ok(m.lte >= m.gte);
});

t("as queries de meta e de venda do card usam o teto", () => {
  const src = ler("../../components/MetaRealizado.tsx");
  assert.ok(src.includes("mesCorrente()"), "sem mesCorrente o mês vem do relógio UTC");
  assert.ok(src.includes('.lte("mes", fim)'), "meta de mês futuro viraria a meta do mês corrente");
  assert.ok(src.includes('.lte("data_venda", fim)'), "venda com data futura entraria como realizado");
});

// ── [26] realizado de um módulo creditado no outro ─────────────────────────
t("Meta × Realizado soma só a produção DO MÓDULO", () => {
  const src = ler("../../components/MetaRealizado.tsx");
  assert.ok(src.includes('.eq("modulo", modulo)'),
    "as metas já eram filtradas por módulo; sem filtrar as vendas, a produção de Seguros aparecia na meta de Consórcios");
});

t("toda venda e toda comissão nascem sabendo de que módulo são", () => {
  const src = ler("../../components/RegistrarVendaModal.tsx");
  assert.equal((src.match(/modulo: moduloDe\(lead\)/g) ?? []).length, 2, "venda E comissão precisam do módulo");
});

// ── [27][28] datas lidas em UTC ────────────────────────────────────────────
t("nenhuma decisão de negócio lê a data em UTC", () => {
  // Depois das 21h de Brasília o relógio UTC já virou o dia — e no dia 31,
  // o mês. A TV do Salão zerava a produção do mês no push final.
  const arquivos = [
    "../../pages/seguros/DashboardSeguros.tsx",
    "../../pages/TvSalao.tsx",
    "../../pages/DashboardConsorcios.tsx",
    "../../components/RegistrarVendaModal.tsx",
    "../../components/Periodo.tsx",
    "../avisos.ts",
    "../../pages/Renovacoes.tsx",
  ];
  for (const arq of arquivos) {
    const linhas = ler(arq).split(/\r?\n/);
    for (const [i, l] of linhas.entries()) {
      if (l.trimStart().startsWith("//")) continue;
      // `new Date()` sem argumento + toISOString = relógio UTC da máquina.
      assert.ok(!/new Date\(\)\.toISOString\(\)\.slice/.test(l),
        `${arq}:${i + 1} lê a data em UTC -> ${l.trim()}`);
    }
  }
});

t("hojeLocal e mesLocal concordam entre si", () => {
  assert.equal(mesLocal(), hojeLocal().slice(0, 7));
  assert.match(hojeLocal(), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(diaLocalDe(new Date()), hojeLocal());
});

// ── [25] taxa de conversão travada em 100% ─────────────────────────────────
t("o funil conta os perdidos vindos do servidor, não da lista de ativos", () => {
  const src = ler("../../components/FunilConversao.tsx");
  assert.ok(src.includes("contarPerdidos"), "a lista só traz ativos; perdido nasce arquivado");
  assert.ok(!src.includes('cont("perdido")'),
    "contar 'perdido' entre os ativos dá zero e trava a taxa em 100%");
  assert.ok(src.includes("perdidosFechados"), "o denominador tem que vir de fora");
});

t("contarPerdidos não conta venda ganha como perda", () => {
  const src = ler("../leads.ts");
  const bloco = src.slice(src.indexOf("export async function contarPerdidos"), src.indexOf("// Badge do bolsão"));
  assert.ok(bloco.includes('.not("etapa", "eq", "ganho")'), "lead ganho e arquivado é VENDA, não perda");
  assert.ok(bloco.includes("descartado.eq.true,etapa.eq.perdido"), "perdido = arquivado OU etapa perdido");
  assert.ok(bloco.includes("head: true"), "contagem no servidor — baixar 778 linhas só pra contar é caro");
});

// ── [31] parcela cancelada contada como dinheiro a entrar ──────────────────
t("'A receber' lista o que É a receber, não 'tudo que não foi pago'", () => {
  const src = ler("../../pages/sections.tsx");
  const linha = src.split(/\r?\n/).find((l) => l.includes('label: "A receber"'));
  assert.ok(linha, "KPI 'A receber' não encontrado — teste cego");
  assert.ok(!linha.includes('!== "paga"'),
    "parcela CANCELADA (cascata do cancelamento da venda) entrava como dinheiro a entrar");
  assert.ok(linha.includes('=== "aberta"') && linha.includes('=== "atrasada"'),
    "inclusão explícita: status novo no futuro não entra sozinho na conta");
});

console.log(`\n${ok} testes de dinheiro passaram`);

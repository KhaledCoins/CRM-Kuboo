#!/usr/bin/env node
// TESTE DE MUTAÇÃO do caminho crítico da captação.
//
// Ideia: corromper de propósito cada regra que protege o lead e verificar se a
// suíte GRITA. Mutação que sobrevive = regra sem teste = bug futuro que ninguém
// vai perceber. Não substitui os testes: mede se eles valem alguma coisa.
//
// Rodar: node tools/mutantes.mjs
import { readFileSync, writeFileSync, copyFileSync, unlinkSync } from "node:fs";
import { execSync } from "node:child_process";

const SUITES = {
  "api/lead-inbound.js": ["api/__tests__/lead-inbound-raw.test.mjs"],
  "api/_telefone.js": ["api/__tests__/telefone.test.mjs", "api/__tests__/c2s-webhook.test.mjs"],
  "api/_modulo.js": ["api/__tests__/modulo.test.mjs"],
  "api/c2s-webhook.js": ["api/__tests__/c2s-webhook.test.mjs"],
  "api/_env.js": ["api/__tests__/env.test.mjs"],
  "api/_documento.js": ["api/__tests__/documento.test.mjs"],
  "src/lib/num.ts": ["src/lib/__tests__/num.test.mjs"],
  "src/lib/leads.ts": ["src/lib/__tests__/bolsao.test.mjs"],
  "src/lib/format.ts": ["src/lib/__tests__/data-fuso.test.mjs"],
};

// [arquivo, descrição do que a mutação quebra, texto original, texto mutado]
const MUTACOES = [
  // ─── Captação: chave de fusão com o C2S ───────────────────────────────────
  ["api/_telefone.js", "DDI 55 deixa de ser removido (lead do Meta não funde com C2S)",
    'if (d.startsWith("55") && d.length >= 12) d = d.slice(2);', ''],
  ["api/_telefone.js", "celular de 11 dígitos perde a máscara",
    'if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;', ''],
  ["api/_telefone.js", "lixo de 3 dígitos vira telefone válido",
    '  return null;\n}', '  return d;\n}'],

  // ─── Captação: formulário novo do Meta ────────────────────────────────────
  ["api/lead-inbound.js", "resposta sim/não vira telefone (o bug do 'Sim')",
    'const candidatos = itens.filter((i) => pareceTelefone(i.resposta));', 'const candidatos = itens;'],
  ["api/lead-inbound.js", "campos padrão do Meta poluem o formulário",
    'const custom = itens.filter((i) => !CAMPOS_PADRAO.has(i.chave));', 'const custom = itens;'],
  ["api/lead-inbound.js", "dedup volta a absorver lead ARQUIVADO",
    '.eq("descartado", false)', '.limit(200)'],
  ["api/lead-inbound.js", "null vira a string 'null' na resposta",
    '.filter((x) => x != null)', '.filter(() => true)'],

  // ─── Direcionamento: seguros x consórcios ─────────────────────────────────
  ["api/_modulo.js", "casa pedaço de palavra (cota dentro de cotação)",
    'regexTermo(termo).test(t)', 't.includes(semAcento(termo))'],
  ["api/_modulo.js", "modulo explícito deixa de ganhar da heurística",
    'if (sinais.modulo === "seguros" || sinais.modulo === "consorcios") return sinais.modulo;', ''],

  // ─── Espelho do C2S ───────────────────────────────────────────────────────
  ["api/c2s-webhook.js", "etapa avançada não espelha 1º contato (lead volta pro bolsão)",
    '  if (!ETAPAS_COM_CONTATO.includes(etapa)) return null;', '  return null;'],
  ["api/c2s-webhook.js", "motivo do arquivamento deixa de ser traduzido",
    '  return MOTIVO_C2S[alias] || "Outros";', '  return null;'],
  ["api/c2s-webhook.js", "C2S passa a sobrescrever a fonte de nascimento",
    '  if (existente.fonte) delete patch.fonte;', ''],
  ["api/c2s-webhook.js", "etapa pode REGREDIR (evento atrasado rebaixa negociação)",
    '  if ((RANK[patch.etapa] ?? 0) <= (RANK[existente.etapa] ?? 0)) delete patch.etapa;', ''],
  ["api/c2s-webhook.js", "C2S reescreve o 1º contato já registrado",
    '  if (existente.primeiro_contato_em) delete patch.primeiro_contato_em;', ''],

  // ─── Bolsão / SLA ─────────────────────────────────────────────────────────
  ["src/lib/leads.ts", "lead em negociação volta a cair no bolsão",
    '  if (ETAPAS_DE_ATENDIMENTO.includes(String(l.etapa ?? ""))) return false;', ''],
  ["src/lib/leads.ts", "lead sem dono deixa de aparecer no bolsão",
    '  if (!l.vendedor_id) return true;', ''],

  // ─── Dinheiro ─────────────────────────────────────────────────────────────
  ["src/lib/num.ts", "ponto volta a ser sempre decimal (R$ 1.500 -> 1,50)",
    'if (!(pontoUnico && casasDepois >= 1 && casasDepois <= 2))', 'if (false)'],

  // ─── Datas ────────────────────────────────────────────────────────────────
  ["src/lib/format.ts", "volta a usar o dia UTC (lead da noite no dia errado)",
    '  return d.toLocaleDateString("en-CA", { timeZone: FUSO_OPERACAO });', '  return d.toISOString().slice(0, 10);'],
  ["src/lib/format.ts", "timestamp do Postgres deixa de ser normalizado",
    'let s = String(v).trim().replace(" ", "T");', 'let s = String(v);'],

  // ─── Segredos ─────────────────────────────────────────────────────────────
  ["api/_env.js", "comparação de segredo deixa de aparar espaços/CR",
    'export function segredoConfere', 'export function segredoConfereDESATIVADO'],
];

let sobreviventes = [];
let mortas = 0;

for (const [arquivo, descricao, de, para] of MUTACOES) {
  const src = readFileSync(arquivo, "utf8");
  if (!src.includes(de)) {
    sobreviventes.push({ arquivo, descricao, motivo: "ÂNCORA NÃO ENCONTRADA (mutação não aplicada)" });
    continue;
  }
  const backup = `${arquivo}.mutbak`;
  copyFileSync(arquivo, backup);
  try {
    writeFileSync(arquivo, src.replace(de, para));
    let alguemGritou = false;
    for (const suite of SUITES[arquivo] ?? []) {
      try {
        execSync(`npx vite-node ${suite}`, { stdio: "pipe", timeout: 120000 });
      } catch {
        alguemGritou = true; // teste falhou = mutação detectada
        break;
      }
    }
    if (alguemGritou) { mortas++; console.log(`  MORTA    ${descricao}`); }
    else { sobreviventes.push({ arquivo, descricao, motivo: "NENHUM TESTE FALHOU" }); console.log(`  VIVA ⚠   ${descricao}`); }
  } finally {
    copyFileSync(backup, arquivo);
    unlinkSync(backup);
  }
}

console.log(`\n${mortas}/${MUTACOES.length} mutações detectadas pelos testes`);
if (sobreviventes.length) {
  console.log(`\n${sobreviventes.length} SOBREVIVENTES (regra sem teste):`);
  for (const s of sobreviventes) console.log(`  - [${s.arquivo}] ${s.descricao}\n      ${s.motivo}`);
  process.exit(1);
}
console.log("Nenhuma mutação sobreviveu.");

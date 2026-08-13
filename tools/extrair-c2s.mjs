#!/usr/bin/env node
// ============================================================================
// EXTRATOR TOTAL DO CONTACT2SALE — roda ANTES do acesso morrer.
//
// POR QUE EXISTE: a importação em massa que trouxe os 818 leads pegou só os
// campos do cabeçalho. Ficou de fora, e SÓ existe dentro do C2S:
//   - messages[]            conversa inteira com o cliente
//   - log[]                 auditoria ("Lead criado por X para Y", "Atividade
//                           criada | Retornar para o cliente | 17/04 10:00")
//   - schedulated_actions[] atividades agendadas
//   - done_details.done_price   VALOR do negócio fechado
//   - archive_details.archive_notes  por que foi arquivado, por extenso
//   - tags[], observation, created_at real
// Cancelada a assinatura, isso é irrecuperável. Este script salva TUDO em
// disco como JSON cru, sem interpretar nada. Interpretar vem depois
// (tools/importar-historico-c2s.mjs), sem pressa e sem risco.
//
// USO:
//   node tools/extrair-c2s.mjs SEU_TOKEN_C2S
//   node tools/extrair-c2s.mjs SEU_TOKEN_C2S --saida ./backup-c2s
//
// É RETOMÁVEL: se cair a internet ou a API reclamar, rode de novo — ele pula
// o que já baixou. Nada é sobrescrito.
// ============================================================================

import { writeFile, readFile, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

const BASE = "https://api.contact2sale.com/integration";
const args = process.argv.slice(2);
const TOKEN = (args.find((a) => !a.startsWith("--")) || "").trim();
const SAIDA = (() => {
  const i = args.indexOf("--saida");
  return i >= 0 && args[i + 1] ? args[i + 1] : "./backup-c2s";
})();

if (!TOKEN) {
  console.error(`
Falta o token do C2S.

  node tools/extrair-c2s.mjs SEU_TOKEN_C2S

Onde pegar: C2S -> Integrações -> clique no "v" da barra cinza "Informações de
integração por e-mail e API" -> botão azul "Gerar Token".
`);
  process.exit(1);
}

const dorme = (ms) => new Promise((r) => setTimeout(r, ms));

// A API do C2S é lenta e às vezes devolve 5xx sob carga. Tentar de novo com
// espera crescente é a diferença entre trazer 822 leads e trazer 700.
async function buscar(caminho, tentativa = 1) {
  const MAX = 5;
  try {
    const r = await fetch(BASE + caminho, {
      headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/json" },
    });
    if (r.status === 401 || r.status === 403) {
      throw new Error(`TOKEN RECUSADO (${r.status}). Gere um novo no C2S.`);
    }
    if (r.status === 429 || r.status >= 500) {
      if (tentativa > MAX) throw new Error(`${r.status} depois de ${MAX} tentativas em ${caminho}`);
      const espera = Math.min(30000, 1500 * 2 ** (tentativa - 1));
      console.log(`   ${r.status} em ${caminho} — nova tentativa em ${espera / 1000}s (${tentativa}/${MAX})`);
      await dorme(espera);
      return buscar(caminho, tentativa + 1);
    }
    if (!r.ok) throw new Error(`${r.status} em ${caminho}: ${(await r.text()).slice(0, 200)}`);
    return await r.json();
  } catch (e) {
    // Erro de rede (não HTTP) também merece nova tentativa.
    if (tentativa <= MAX && /fetch failed|ECONN|ETIMEDOUT|network/i.test(String(e))) {
      const espera = Math.min(30000, 1500 * 2 ** (tentativa - 1));
      console.log(`   rede falhou em ${caminho} — nova tentativa em ${espera / 1000}s (${tentativa}/${MAX})`);
      await dorme(espera);
      return buscar(caminho, tentativa + 1);
    }
    throw e;
  }
}

async function main() {
  const dirLeads = join(SAIDA, "leads");
  await mkdir(dirLeads, { recursive: true });

  console.log(`\nExtraindo o Contact2Sale para ${SAIDA}\n`);

  // ── 1. Quem somos + equipe (contexto que dá sentido aos ids dos leads) ────
  for (const [nome, caminho] of [["empresa", "/me"], ["vendedores", "/sellers"], ["etiquetas", "/tags"], ["filas", "/distribution_queues/list_queues"], ["regras-distribuicao", "/distribution_rules"]]) {
    try {
      const dado = await buscar(caminho);
      await writeFile(join(SAIDA, `${nome}.json`), JSON.stringify(dado, null, 2), "utf8");
      console.log(`  ok  ${nome}.json`);
    } catch (e) {
      // Endpoint indisponível no plano não pode derrubar a extração dos LEADS,
      // que é o que realmente importa.
      console.log(`  --  ${nome}: ${String(e.message).slice(0, 90)}`);
    }
  }

  // ── 2. Índice de todos os leads (paginado, máx 50 por página) ─────────────
  const indice = [];
  for (let page = 1; page <= 200; page++) {
    const r = await buscar(`/leads?page=${page}&perpage=50&sort=-created_at`);
    const lote = r?.data ?? [];
    if (!lote.length) break;
    indice.push(...lote);
    console.log(`  pagina ${page}: +${lote.length} (total ${indice.length})`);
    if (lote.length < 50) break;
    await dorme(250);
  }
  await writeFile(join(SAIDA, "indice-leads.json"), JSON.stringify(indice, null, 2), "utf8");
  console.log(`\n  ${indice.length} leads no índice\n`);

  // ── 3. Detalhe completo de cada lead (aqui moram conversa, log e valor) ───
  const jaBaixados = new Set(
    existsSync(dirLeads) ? (await readdir(dirLeads)).map((f) => f.replace(/\.json$/, "")) : []
  );
  let novos = 0, pulados = 0, falhas = [];

  for (let i = 0; i < indice.length; i++) {
    const id = indice[i]?.id;
    if (!id) continue;
    if (jaBaixados.has(id)) { pulados++; continue; }
    try {
      const det = await buscar(`/leads/${id}`);
      await writeFile(join(dirLeads, `${id}.json`), JSON.stringify(det, null, 2), "utf8");
      novos++;
    } catch (e) {
      falhas.push({ id, erro: String(e.message).slice(0, 200) });
    }
    if ((i + 1) % 25 === 0) console.log(`  ${i + 1}/${indice.length} — ${novos} baixados, ${pulados} já tinha, ${falhas.length} falhas`);
    await dorme(150); // gentil com a API deles
  }

  if (falhas.length) {
    await writeFile(join(SAIDA, "falhas.json"), JSON.stringify(falhas, null, 2), "utf8");
  }

  // ── 4. Conferência: o que de fato veio ───────────────────────────────────
  const arquivos = await readdir(dirLeads);
  let comMensagem = 0, comLog = 0, comAtividade = 0, comValorFechado = 0, totalMensagens = 0;
  for (const f of arquivos) {
    try {
      const at = JSON.parse(await readFile(join(dirLeads, f), "utf8"))?.data?.attributes ?? {};
      const m = at.messages?.length ?? 0;
      if (m) { comMensagem++; totalMensagens += m; }
      if (at.log?.length) comLog++;
      if (at.schedulated_actions?.length) comAtividade++;
      if (at.done_details?.done_price) comValorFechado++;
    } catch { /* arquivo corrompido é contado como falha silenciosa */ }
  }

  console.log(`
─────────────────────────────────────────────
  leads salvos em disco   ${arquivos.length} de ${indice.length}
  com conversa            ${comMensagem}  (${totalMensagens} mensagens)
  com log de auditoria    ${comLog}
  com atividade agendada  ${comAtividade}
  com valor de fechamento ${comValorFechado}
  falhas                  ${falhas.length}${falhas.length ? "  -> falhas.json (rode de novo pra tentar só elas)" : ""}
─────────────────────────────────────────────

Backup em ${SAIDA}. GUARDE ESSA PASTA — depois que o C2S desligar não tem
como buscar de novo. Nada foi enviado pro CRM ainda; isso é o próximo passo.
`);
}

main().catch((e) => {
  console.error(`\nFALHOU: ${e.message}\n`);
  console.error("O que já baixou está salvo. Rode de novo pra continuar de onde parou.");
  process.exit(1);
});

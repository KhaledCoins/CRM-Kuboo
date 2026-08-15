// Vercel Cron — BACKUP SEMANAL do banco em JSON no Storage do próprio Supabase.
//
// POR QUE EXISTE: o plano free do Supabase não tem point-in-time recovery. Um
// DELETE errado, uma migration ruim ou um engano da equipe apagando algo em
// massa seria irrecuperável. Este job tira uma foto semanal de TODAS as
// tabelas operacionais e guarda no bucket privado `backups` (sem policy de
// storage → só a service role lê), com rotação de 60 dias (~8 semanas).
//
// AGENDAMENTO: vercel.json → crons → segunda 09:00 UTC (06:00 BRT).
// AUTENTICAÇÃO: com a env CRON_SECRET presente, o Vercel manda
// `Authorization: Bearer <CRON_SECRET>` na invocação do cron. Qualquer
// chamada sem esse header é recusada — o endpoint não é público.
//
// RESTAURAÇÃO (dia de crise): baixar o backup-AAAA-MM-DD.json no painel do
// Supabase (Storage → backups) e reinserir a(s) tabela(s) afetada(s) via SQL
// Editor. O arquivo é JSON puro: { gerado_em, tabelas: { nome: [linhas] } }.

import { createClient } from "@supabase/supabase-js";
import { env, segredoConfere } from "./_env.js";

// Todas as tabelas operacionais. Uma tabela nova que não entrar aqui fica FORA
// do backup — ao criar tabela, adicionar na lista (o resumo no fim denuncia:
// o job loga o que exportou e quantas linhas).
const TABELAS = [
  "profiles", "leads", "lead_atividades", "lead_observacoes", "lead_etiquetas",
  "lead_favoritos", "etiquetas", "mensagens_prontas", "motivos_arquivamento",
  "alertas_config", "bolsao_config", "filas", "fila_usuarios", "distribuicao_log",
  "vendas", "parcelas", "comissoes", "apolices", "consorcios", "cotas",
  "contemplacoes", "endossos", "atendimentos", "sinistros_chamados",
  "metas", "tarefas", "grupos", "produtos", "seguradoras", "notificacoes",
  "dashboards_analises", "newsletter_inscritos", "erros_front",
];

const PAGINA = 1000;
const RETENCAO_DIAS = 60;

async function exportarTabela(admin, tabela) {
  const linhas = [];
  for (let de = 0; de < 200000; de += PAGINA) {
    const { data, error } = await admin.from(tabela).select("*").range(de, de + PAGINA - 1);
    if (error) return { erro: error.message, linhas: [] };
    linhas.push(...(data ?? []));
    if (!data || data.length < PAGINA) break;
  }
  return { erro: null, linhas };
}

export default async function handler(req, res) {
  const segredo = env("CRON_SECRET");
  if (!segredo) return res.status(500).json({ error: "CRON_SECRET não configurada" });
  const auth = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!segredoConfere(auth, segredo)) return res.status(401).json({ error: "Não autorizado" });

  const supaUrl = env("VITE_SUPABASE_URL");
  const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!supaUrl || !serviceKey) return res.status(500).json({ error: "Supabase env ausente" });
  const admin = createClient(supaUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  try {
    const resumo = {};
    const tabelas = {};
    for (const t of TABELAS) {
      const { erro, linhas } = await exportarTabela(admin, t);
      if (erro) {
        // Tabela com problema não pode matar o backup das outras.
        resumo[t] = `ERRO: ${erro}`;
      } else {
        tabelas[t] = linhas;
        resumo[t] = linhas.length;
      }
    }

    const agora = new Date();
    const nome = `backup-${agora.toISOString().slice(0, 10)}.json`;
    const corpo = JSON.stringify({ gerado_em: agora.toISOString(), resumo, tabelas });

    const { error: upErr } = await admin.storage.from("backups")
      .upload(nome, new Blob([corpo], { type: "application/json" }), { upsert: true, contentType: "application/json" });
    if (upErr) throw new Error(`upload: ${upErr.message}`);

    // Rotação: apaga o que passou da retenção. Falha aqui não invalida o
    // backup de hoje — só loga.
    let removidos = 0;
    try {
      const { data: arquivos } = await admin.storage.from("backups").list("", { limit: 200 });
      const corte = Date.now() - RETENCAO_DIAS * 86400000;
      const velhos = (arquivos ?? [])
        .filter((a) => /^backup-\d{4}-\d{2}-\d{2}\.json$/.test(a.name))
        .filter((a) => new Date(a.name.slice(7, 17)).getTime() < corte)
        .map((a) => a.name);
      if (velhos.length) {
        await admin.storage.from("backups").remove(velhos);
        removidos = velhos.length;
      }
    } catch (e) {
      console.error(JSON.stringify({ level: "warn", fn: "backup-semanal", msg: `rotacao: ${String(e).slice(0, 200)}` }));
    }

    console.log(JSON.stringify({ level: "info", fn: "backup-semanal", arquivo: nome, bytes: corpo.length, removidos, resumo }));
    return res.status(200).json({ ok: true, arquivo: nome, bytes: corpo.length, removidos, resumo });
  } catch (err) {
    console.error(JSON.stringify({ level: "error", fn: "backup-semanal", msg: String(err).slice(0, 300) }));
    return res.status(500).json({ error: err instanceof Error ? err.message : "Falha no backup" });
  }
}

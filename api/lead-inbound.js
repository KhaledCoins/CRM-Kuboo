// Vercel Serverless — CAPTAÇÃO DE LEADS por webhook (substitui a captação do C2S).
// Qualquer fonte externa (Meta Lead Ads via Make/Zapier/n8n, landing pages,
// parceiros) faz POST aqui e o lead cai no CRM já passando pelo MOTOR DE
// DISTRIBUIÇÃO (trigger leads_distribuir do c2s-parity.sql): filas → regra de
// retorno → rodízio → fila de segurança. Sem intervenção manual.
//
// Auth: header  x-webhook-token: $LEAD_WEBHOOK_TOKEN  (env no Vercel; gere um
// token longo aleatório). Sem o token correto → 401.
//
// Body (JSON): { nome*, telefone, email, produto_interesse, mensagem, modulo
//   ('seguros'|'consorcios'), origem, fonte, canal, campanha, formulario{},
//   score, fb_pagina, fb_anuncio, fb_formulario }
//
// origem aceita: 'chatbot' | 'formulario' | 'whatsapp' | 'indicacao' |
//   'portal' | 'manual' | 'webhook' (default deste endpoint quando omitido).
//
// fb_pagina / fb_anuncio / fb_formulario: campos do Meta Lead Ads (Facebook/
// Instagram), aceitos também como page_name / ad_name / form_name — usados
// pelo motor de filas (fila_regras_match) como critério de regra.

import { createClient } from "@supabase/supabase-js";

const BUCKET = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const e = BUCKET.get(ip) ?? { n: 0, t: now };
  if (now - e.t > 60_000) { e.n = 0; e.t = now; }
  e.n += 1;
  BUCKET.set(ip, e);
  if (BUCKET.size > 5000) BUCKET.clear();
  return e.n > 60;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const token = req.headers["x-webhook-token"];
  const expected = process.env.LEAD_WEBHOOK_TOKEN;
  if (!expected) return res.status(503).json({ error: "LEAD_WEBHOOK_TOKEN não configurado no Vercel" });
  if (!token || token !== expected) return res.status(401).json({ error: "Token inválido" });

  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0] || "anon";
  if (rateLimited(ip)) return res.status(429).json({ error: "Rate limit" });

  const supaUrl = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !serviceKey) return res.status(500).json({ error: "Supabase env ausente" });
  const admin = createClient(supaUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const b = req.body ?? {};
  const nome = String(b.nome || "").trim().slice(0, 200);
  if (!nome) return res.status(400).json({ error: "nome é obrigatório" });

  // origem fora do catálogo do CHECK do banco viraria 500 e o lead pago do Meta
  // seria PERDIDO em silêncio (quem monta o Make mapeia "facebook"/"instagram"
  // naturalmente). Fora do catálogo → 'webhook'; o valor original vira fonte.
  const ORIGENS = new Set(["chatbot", "formulario", "whatsapp", "indicacao", "portal", "manual", "webhook"]);
  const origemBruta = String(b.origem || "webhook").trim().slice(0, 60);
  const origem = ORIGENS.has(origemBruta) ? origemBruta : "webhook";
  const fonteBruta = String(b.fonte || "").trim().slice(0, 80);
  const fonte = fonteBruta || (origem !== origemBruta ? origemBruta : "") || null;

  // No C2S a 1ª mensagem do lead É o formulário respondido — se o cenário do
  // Make só mapear formulario{}, sintetizamos a mensagem a partir dele.
  let mensagem = String(b.mensagem || "").trim().slice(0, 4000) || null;
  const formulario = b.formulario && typeof b.formulario === "object" ? b.formulario : null;
  if (!mensagem && formulario) {
    mensagem = Object.entries(formulario)
      .map(([p, r]) => `• ${String(p).slice(0, 120)}: ${String(r).slice(0, 300)}`)
      .join("\n").slice(0, 4000) || null;
  }

  const lead = {
    nome,
    telefone: String(b.telefone || "").trim().slice(0, 30) || null,
    email: String(b.email || "").trim().toLowerCase().slice(0, 200) || null,
    produto_interesse: String(b.produto_interesse || "").trim().slice(0, 120) || null,
    mensagem,
    modulo: b.modulo === "consorcios" ? "consorcios" : "seguros",
    origem,
    fonte,                                                          // ex.: Instagram Leads
    canal: String(b.canal || "Internet").trim().slice(0, 60),
    campanha: String(b.campanha || "").trim().slice(0, 160) || null,
    formulario,
    fb_pagina: String(b.fb_pagina || b.page_name || "").trim().slice(0, 120) || null,
    fb_anuncio: String(b.fb_anuncio || b.ad_name || "").trim().slice(0, 120) || null,
    fb_formulario: String(b.fb_formulario || b.form_name || "").trim().slice(0, 120) || null,
    status: "novo",
    score: Number.isFinite(+b.score) ? Math.max(0, Math.min(100, +b.score)) : 60,
  };

  try {
    const { data, error } = await admin.from("leads").insert(lead).select("id, vendedor_id").single();
    if (error) throw new Error(error.message);
    // vendedor_id já vem preenchido se o motor de filas atribuiu no trigger
    return res.status(200).json({ ok: true, id: data.id, distribuido_para: data.vendedor_id ?? null });
  } catch (err) {
    console.error(JSON.stringify({ level: "error", fn: "lead-inbound", msg: String(err).slice(0, 300) }));
    return res.status(500).json({ error: "Falha ao criar lead" });
  }
}

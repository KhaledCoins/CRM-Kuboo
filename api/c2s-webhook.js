// Vercel Serverless — RECEPTOR DO WEBHOOK DO CONTACT2SALE.
//
// POR QUE EXISTE: enquanto o C2S ainda estiver ativo, todo lead que chega lá é
// espelhado aqui em tempo real. É o que permite rodar os dois em paralelo,
// conferir que está batendo, e só então cancelar a assinatura — sem janela de
// leads perdidos e sem depender de Make/Zapier.
//
// COMO ASSINAR (no C2S: Integrações → Gerar Token, depois):
//   curl -X POST https://api.contact2sale.com/integration/api/subscribe \
//     -H "Authorization: SEU_TOKEN" -H "Content-Type: application/json" \
//     -d '{"hook_action":"on_create_lead","hook_url":"https://crm-kuboo.vercel.app/api/c2s-webhook?token=SEGREDO"}'
//   (repetir para on_update_lead e on_close_lead — mesmo hook_url)
//
// AUTENTICAÇÃO: o C2S só envia a URL (não deixa configurar header), então o
// segredo vai na query string — por isso ele precisa ser longo e aleatório.
// Configure a env C2S_WEBHOOK_TOKEN no Vercel.
//
// IDEMPOTENTE: casa por c2s_lead_id (e, na falta dele, por telefone). Reenvios
// e os 3 gatilhos no mesmo lead atualizam a mesma linha em vez de duplicar.
//
// NÃO dispara o rodízio da equipe: o lead entra já com o dono que o C2S
// atribuiu (resolvido por e-mail/nome). Se o consultor não existir no CRM,
// cai no bolsão para alguém pegar — que é o comportamento correto.

import { createClient } from "@supabase/supabase-js";

const ORIGENS_VALIDAS = ["chatbot", "formulario", "whatsapp", "indicacao", "portal", "manual", "webhook"];
const ETAPAS_VALIDAS = ["novos", "contato", "cotacao", "negociacao", "ganho", "perdido"];

const txt = (v, max = 200) => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};
const digits = (v) => String(v ?? "").replace(/\D/g, "");

// Telefone no formato usado pelo resto do CRM (DDI removido, máscara BR)
function formatarTelefone(bruto) {
  let d = digits(bruto);
  if (d.startsWith("55") && d.length >= 12) d = d.slice(2);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return d || null;
}

// lead_status.alias do C2S → etapa do funil do CRM
function mapearEtapa(a) {
  const alias = String(a?.attributes?.lead_status?.alias || "").toLowerCase();
  const nome = String(a?.attributes?.lead_status?.name || "").toLowerCase();
  const arquivado = a?.attributes?.archive_details?.archived === true;
  const fechado = a?.attributes?.done_details?.done === true;
  if (fechado) return { etapa: "ganho", descartado: false };
  if (arquivado) return { etapa: "perdido", descartado: true };
  if (/lost|perdid/.test(alias + nome)) return { etapa: "perdido", descartado: true };
  if (/won|done|fechad|ganho/.test(alias + nome)) return { etapa: "ganho", descartado: false };
  if (/negotiation|negocia/.test(alias + nome)) return { etapa: "negociacao", descartado: false };
  if (/attendance|atendimento|contact|contato/.test(alias + nome)) return { etapa: "contato", descartado: false };
  return { etapa: "novos", descartado: false };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // Segredo na query (o C2S não permite header customizado)
  const esperado = process.env.C2S_WEBHOOK_TOKEN;
  if (!esperado) {
    console.error(JSON.stringify({ level: "error", fn: "c2s-webhook", msg: "C2S_WEBHOOK_TOKEN ausente" }));
    return res.status(500).json({ error: "Webhook não configurado" });
  }
  const recebido = String(req.query?.token || "");
  if (recebido !== esperado) return res.status(401).json({ error: "Token inválido" });

  const supaUrl = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !serviceKey) return res.status(500).json({ error: "Supabase não configurado no servidor" });
  const admin = createClient(supaUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  try {
    // O C2S manda { data: { id, attributes: {...} } }; toleramos o objeto cru também.
    const d = req.body?.data ?? req.body ?? {};
    const at = d.attributes ?? d ?? {};
    const cliente = at.customer ?? {};
    const produto = at.product ?? {};
    const vendedor = at.seller ?? {};
    const fb = d.facebook_attributes ?? at.facebook_attributes ?? {};

    const telefone = formatarTelefone(cliente.phone_global || cliente.phone || cliente.phone2);
    const email = txt(cliente.email, 200)?.toLowerCase() ?? null;
    if (!telefone && !email) {
      // Sem contato não há lead útil — 200 pra não gerar retry infinito no C2S
      return res.status(200).json({ ok: true, ignorado: "lead sem telefone e sem e-mail" });
    }

    const c2sId = txt(d.id || at.id, 120);
    const { etapa, descartado } = mapearEtapa({ attributes: at });

    // Consultor do C2S → perfil do CRM (e-mail primeiro, depois nome)
    let vendedorId = null;
    const vEmail = txt(vendedor.email, 200)?.toLowerCase();
    const vNome = txt(vendedor.name, 200);
    if (vEmail) {
      const { data } = await admin.from("profiles").select("id").eq("email", vEmail).limit(1);
      vendedorId = data?.[0]?.id ?? null;
    }
    if (!vendedorId && vNome && !/kuboo/i.test(vNome)) {
      const { data } = await admin.from("profiles").select("id, name")
        .in("role", ["vendedor", "gestor", "admin"]).ilike("name", `%${vNome.split(/\s+/)[0]}%`).limit(5);
      const alvo = (data || []).find((p) => String(p.name).toLowerCase() === vNome.toLowerCase()) || data?.[0];
      vendedorId = alvo?.id ?? null;
    }

    const fonte = txt(at.lead_source?.name, 120);
    const canal = txt(at.channel?.name, 60) || "Internet";
    const campanha = txt(fb.campaign_name || fb.ad_campaign || produto.description || at.description, 200);
    const primeiraMsg = txt(
      (Array.isArray(at.messages) && at.messages[0]?.body) || at.description || at.observation,
      4000
    );

    const linha = {
      nome: txt(cliente.name, 200) || `Sem nome — ${telefone || email}`,
      telefone,
      email,
      origem: ORIGENS_VALIDAS.includes("webhook") ? "webhook" : "formulario",
      modulo: /seguro/i.test(`${campanha ?? ""} ${fonte ?? ""} ${primeiraMsg ?? ""}`) ? "seguros" : "consorcios",
      fonte,
      canal,
      campanha,
      fb_pagina: txt(fb.page_name, 120),
      fb_anuncio: txt(fb.ad_name, 120),
      fb_formulario: txt(fb.form_name, 120),
      etapa: ETAPAS_VALIDAS.includes(etapa) ? etapa : "novos",
      descartado,
      status: "novo",
      urgencia: "breve",
      mensagem: primeiraMsg,
      c2s_lead_id: c2sId,
      interagido_em: at.read_at || at.replied_at || null,
    };

    // Já existe? (por id do C2S; senão por telefone)
    let existente = null;
    if (c2sId) {
      const { data } = await admin.from("leads").select("id").eq("c2s_lead_id", c2sId).limit(1);
      existente = data?.[0] ?? null;
    }
    if (!existente && telefone) {
      const { data } = await admin.from("leads").select("id").eq("telefone", telefone).limit(1);
      existente = data?.[0] ?? null;
    }

    if (existente) {
      // Atualização (on_update/on_close): não sobrescreve o dono já definido no
      // CRM nem apaga campos que o C2S mandou vazios.
      const patch = {};
      for (const [k, v] of Object.entries(linha)) {
        if (v !== null && v !== undefined && k !== "status" && k !== "urgencia") patch[k] = v;
      }
      const { error } = await admin.from("leads").update(patch).eq("id", existente.id);
      if (error) throw new Error(error.message);
      return res.status(200).json({ ok: true, acao: "atualizado", id: existente.id });
    }

    if (vendedorId) {
      linha.vendedor_id = vendedorId;
      linha.atribuido_em = new Date().toISOString();
    }
    const { data: criado, error } = await admin.from("leads").insert(linha).select("id").single();
    if (error) throw new Error(error.message);
    return res.status(200).json({ ok: true, acao: "criado", id: criado.id, comDono: !!vendedorId });
  } catch (err) {
    console.error(JSON.stringify({ level: "error", fn: "c2s-webhook", msg: String(err).slice(0, 300) }));
    // 200 de propósito: erro nosso não deve fazer o C2S reenviar em loop.
    return res.status(200).json({ ok: false, erro: "Falha ao processar — registrado no log" });
  }
}

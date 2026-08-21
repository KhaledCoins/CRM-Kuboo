// Vercel Serverless — CAPTAÇÃO DE LEADS por webhook (substitui a captação do C2S).
// Qualquer fonte externa (Meta Lead Ads via Make/Zapier/n8n, landing pages,
// parceiros) faz POST aqui e o lead cai no CRM já passando pelo MOTOR DE
// DISTRIBUIÇÃO (trigger leads_distribuir do c2s-parity.sql): filas → regra de
// retorno → rodízio → fila de segurança. Sem intervenção manual.
//
// Auth: header  x-webhook-token: $LEAD_WEBHOOK_TOKEN  (env no Vercel; gere um
// token longo aleatório). Sem o token correto → 401.
//
// Body (JSON): { nome*, telefone, telefone_alt, email, produto_interesse,
//   mensagem, modulo ('seguros'|'consorcios'), origem, fonte, canal, campanha,
//   formulario{}, score, fb_pagina, fb_anuncio, fb_formulario }
//
// telefone_alt: fallback quando `telefone` vem vazio. No Make, `telefone` mapeia
// a pergunta CUSTOM de WhatsApp (existe só em alguns formulários do Meta) e
// `telefone_alt` o campo nativo phone_number — um formulário novo sem a pergunta
// custom continua entregando telefone.
//
// respostas_raw: field_data BRUTO do lead ([{name|field_key|field_label,
// values[]}]) — o Make manda o mappable_field_data inteiro. É a rede final:
// formulário novo que o mapeamento fixo não conhece ainda entrega formulário,
// mensagem e telefone (ver extrairRespostas/formularioDoRaw/telefoneDoRaw).
//
// origem aceita: 'chatbot' | 'formulario' | 'whatsapp' | 'indicacao' |
//   'portal' | 'manual' | 'webhook' (default deste endpoint quando omitido).
//
// fb_pagina / fb_anuncio / fb_formulario: campos do Meta Lead Ads (Facebook/
// Instagram), aceitos também como page_name / ad_name / form_name — usados
// pelo motor de filas (fila_regras_match) como critério de regra.

import { createClient } from "@supabase/supabase-js";
import { env, segredoConfere } from "./_env.js";
import { decidirModulo } from "./_modulo.js";
import { formatarTelefone } from "./_telefone.js";

// ─── Respostas brutas do Meta (à prova de formulário novo) ──────────────────
// O body do Make mapeia as perguntas do formulário ATUAL por chave fixa — um
// formulário novo chegaria com formulario{} vazio e o lead perderia as
// respostas (e, sem a pergunta custom de WhatsApp, até o telefone).
// respostas_raw carrega o field_data bruto do lead (mappable_field_data do
// Make / field_data da Graph API): [{ name|field_key|field_label, values[] }].
// O parse é tolerante às variantes de chave porque o formato exato depende da
// versão da app do Make. Exportadas para teste.
const CAMPOS_PADRAO = new Set(["full_name", "first_name", "last_name", "email", "phone_number"]);
export function extrairRespostas(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const chave = String(item.field_key ?? item.name ?? "").trim();
      const pergunta = String(item.field_label ?? item.label ?? item.name ?? item.field_key ?? "").trim();
      const v = item.values ?? item.value;
      const valores = (Array.isArray(v) ? v : v == null ? [] : [v])
        .filter((x) => x != null) // null dentro do array viraria a string "null"
        .map((x) => String(x).trim()).filter(Boolean);
      if (!pergunta || valores.length === 0) return null;
      return { chave: (chave || pergunta).toLowerCase(), pergunta, resposta: valores.join(", ") };
    })
    .filter(Boolean);
}
export function formularioDoRaw(itens) {
  const custom = itens.filter((i) => !CAMPOS_PADRAO.has(i.chave));
  if (!custom.length) return null;
  return Object.fromEntries(custom.map((i) => [i.pergunta.slice(0, 200), i.resposta.slice(0, 1000)]));
}
export function telefoneDoRaw(itens) {
  // Pergunta de WhatsApp primeiro — é o número que o cliente DIGITOU pra ser
  // chamado; o phone_number nativo (prefill do perfil) é o plano B.
  const whats = itens.find((i) => /whats/i.test(`${i.chave} ${i.pergunta}`));
  const tel = whats ?? itens.find((i) => /telefone|phone|celular|contato/i.test(`${i.chave} ${i.pergunta}`));
  return tel?.resposta ?? "";
}

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

  const expected = env("LEAD_WEBHOOK_TOKEN");
  if (!expected) return res.status(503).json({ error: "LEAD_WEBHOOK_TOKEN não configurado no Vercel" });
  // Normaliza os dois lados: env com "\r" invisível (grava por pipe) ou header
  // com espaço sobrando (Make/Zapier) davam 401 sem explicação.
  if (!segredoConfere(req.headers["x-webhook-token"], expected)) return res.status(401).json({ error: "Token inválido" });

  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0] || "anon";
  if (rateLimited(ip)) return res.status(429).json({ error: "Rate limit" });

  const supaUrl = env("VITE_SUPABASE_URL");
  const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
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

  // Formulário: o mapeado por chave fixa ganha; vazio (formulário novo que o
  // Make ainda não conhece) → reconstrói das respostas brutas. Objeto só com
  // valores vazios é descartado — 5 perguntas em branco no lead 360º é pior
  // que nada.
  const rawItens = extrairRespostas(b.respostas_raw);
  let formulario = b.formulario && typeof b.formulario === "object" ? b.formulario : null;
  const temConteudo = !!formulario && Object.values(formulario).some((v) => String(v ?? "").trim() !== "");
  if (!temConteudo) formulario = formularioDoRaw(rawItens);

  // No C2S a 1ª mensagem do lead É o formulário respondido — se o cenário do
  // Make só mapear formulario{}, sintetizamos a mensagem a partir dele.
  let mensagem = String(b.mensagem || "").trim().slice(0, 4000) || null;
  if (!mensagem && formulario) {
    mensagem = Object.entries(formulario)
      .map(([p, r]) => `• ${String(p).slice(0, 120)}: ${String(r).slice(0, 300)}`)
      .join("\n").slice(0, 4000) || null;
  }

  // Mesma máscara do c2s-webhook (via _telefone.js): a adoção de leads lá casa
  // por igualdade EXATA de telefone — formato divergente = lead do Meta em dobro
  // no período paralelo. Resposta que não parseia como telefone BR (texto livre
  // da pergunta de WhatsApp, número estrangeiro) fica como veio: cru > perdido.
  // Cadeia: pergunta custom de WhatsApp > phone_number nativo > qualquer
  // resposta bruta que pareça telefone (formulário novo sem mapeamento).
  const telBruto = String(b.telefone || "").trim() || String(b.telefone_alt || "").trim() || telefoneDoRaw(rawItens);
  const lead = {
    nome,
    telefone: telBruto ? (formatarTelefone(telBruto) ?? telBruto.slice(0, 30)) : null,
    email: String(b.email || "").trim().toLowerCase().slice(0, 200) || null,
    produto_interesse: String(b.produto_interesse || "").trim().slice(0, 120) || null,
    mensagem,
    // Antes: `b.modulo === 'consorcios' ? 'consorcios' : 'seguros'` — todo lead
    // do Meta caía em Seguros a menos que o Make mandasse o campo certo. Agora a
    // decisão é do decidirModulo() (mesma regra do c2s-webhook), e `b.modulo`
    // explícito continua ganhando de tudo.
    modulo: decidirModulo({
      modulo: b.modulo, campanha: b.campanha, fonte, mensagem,
      produto: b.produto_interesse, formulario,
      fb_anuncio: b.fb_anuncio || b.ad_name, fb_formulario: b.fb_formulario || b.form_name,
    }),
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

  // ─── Idempotência (24h por telefone/e-mail) ────────────────────────────────
  // Make/Zapier fazem RETRY automático quando a resposta demora (cold start +
  // trigger de distribuição são candidatos clássicos a timeout), e o mesmo
  // cliente reenvia formulário — sem esta trava cada tentativa virava um lead
  // NOVO, distribuído possivelmente pra OUTRO vendedor: dois consultores
  // ligando pra mesma pessoa. Dentro de 24h, mesmo telefone (por dígitos, com
  // tolerância ao prefixo 55) ou mesmo e-mail devolve o lead EXISTENTE com 200
  // (Make não re-tenta). Depois de 24h, contato novo é interesse novo: vira
  // lead e a fila de retorno (memória 16d) devolve ao mesmo consultor.
  // Falha na checagem NUNCA segura a captação — lead pago não se perde.
  // A CHAVE de dedup só pode ser telefone que PARSEIA como BR (formatarTelefone
  // ok, 10-11 dígitos). O texto cru que guardamos como fallback ("me liga às
  // 18h", CEP, data de nascimento) tem 8+ dígitos e o casamento por sufixo
  // fundiria duas pessoas do mesmo CEP — o 2º lead pago sumiria em silêncio.
  // Guardar é uma coisa; chavear é outra.
  const soDigitos = (s) => String(s || "").replace(/\D/g, "");
  const chaveTelefone = (t) => soDigitos(formatarTelefone(t) ?? "");
  const mesmoTelefone = (a, b) => {
    if (a.length < 10 || b.length < 10) return false; // menor telefone BR válido: DDD+8
    return a === b || a.endsWith(b) || b.endsWith(a); // "5512988..." casa "12988..."
  };
  try {
    const digitos = chaveTelefone(lead.telefone);
    if (digitos.length >= 10 || lead.email) {
      const desde = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: recentes } = await admin
        .from("leads").select("id, vendedor_id, telefone, email, mensagem")
        .gte("created_at", desde)
        .order("created_at", { ascending: false }).limit(200);
      const existente = (recentes ?? []).find((r) =>
        mesmoTelefone(chaveTelefone(r.telefone), digitos) ||
        (lead.email && r.email && r.email.toLowerCase() === lead.email)
      );
      if (existente) {
        console.log(JSON.stringify({ level: "info", fn: "lead-inbound", msg: `dedup 24h: reaproveitando lead ${existente.id}` }));
        // Retry do Make manda payload IDÊNTICO — silêncio é o correto. Mensagem
        // DIFERENTE é o cliente reenviando o formulário (está quente): vira
        // atividade pendente "retornar" pro dono ver na aba A fazer. Falha aqui
        // nunca muda a resposta — o dedup já cumpriu o papel dele.
        try {
          if (lead.mensagem && existente.mensagem && lead.mensagem !== existente.mensagem) {
            await admin.from("lead_atividades").insert({
              lead_id: existente.id,
              tipo: "retornar",
              titulo: "Cliente reenviou o formulário do anúncio — respondeu de novo, está quente",
              quando: new Date().toISOString(),
            });
          }
        } catch (e) {
          console.error(JSON.stringify({ level: "warn", fn: "lead-inbound", msg: `atividade de reenvio falhou: ${String(e).slice(0, 150)}` }));
        }
        return res.status(200).json({ ok: true, id: existente.id, duplicado: true, distribuido_para: existente.vendedor_id ?? null });
      }
    }
  } catch (err) {
    console.error(JSON.stringify({ level: "warn", fn: "lead-inbound", msg: `dedup falhou (seguindo com insert): ${String(err).slice(0, 200)}` }));
  }

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

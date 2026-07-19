// Vercel Serverless Function — envia (ou reenvia) as credenciais da Área do
// Cliente por E-MAIL: gera uma senha temporária NOVA, marca must_change_password
// (o portal força o cliente a criar a própria senha no 1º login) e dispara um
// e-mail bonito e explicativo via Resend.
//
// SEGURANÇA: JWT válido + papel de equipe (mesmo padrão do api/clientes.js).
// A senha temporária volta na resposta — se o e-mail falhar, a equipe ainda
// consegue repassar por WhatsApp sem repetir a operação.
//
// ENVS necessárias (Vercel):
//   RESEND_API_KEY  — chave da conta Resend (resend.com)
//   EMAIL_FROM      — opcional; ex.: "Kuboo <acesso@kuboo.com.br>" (domínio
//                     verificado no Resend). Sem ela usa onboarding@resend.dev,
//                     que SÓ entrega pro e-mail do dono da conta (modo teste).
//   SITE_URL        — opcional; default https://kuboo-site.vercel.app

import { createClient } from "@supabase/supabase-js";

const BUCKET = new Map();
function rateLimited(id) {
  const now = Date.now();
  const e = BUCKET.get(id) ?? { n: 0, t: now };
  if (now - e.t > 60_000) { e.n = 0; e.t = now; }
  e.n += 1;
  BUCKET.set(id, e);
  if (BUCKET.size > 2000) BUCKET.clear();
  return e.n > 15;
}

async function authTeamUser(req) {
  const supaUrl = process.env.VITE_SUPABASE_URL;
  const anon = process.env.VITE_SUPABASE_ANON_KEY;
  if (!supaUrl || !anon) return { error: 500, msg: "Supabase env ausente no servidor" };

  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return { error: 401, msg: "Não autenticado" };

  const h = { apikey: anon, Authorization: `Bearer ${token}` };
  const uR = await fetch(`${supaUrl}/auth/v1/user`, { headers: h });
  if (!uR.ok) return { error: 401, msg: "Sessão inválida ou expirada" };
  const user = await uR.json();

  const pR = await fetch(`${supaUrl}/rest/v1/profiles?id=eq.${user.id}&select=role`, { headers: h });
  const rows = pR.ok ? await pR.json() : [];
  const role = rows?.[0]?.role;
  if (!["vendedor", "gestor", "admin"].includes(role)) return { error: 403, msg: "Acesso restrito à equipe" };

  return { user };
}

function senhaTemporaria() {
  // Fácil de digitar, difícil de adivinhar (sem caracteres ambíguos tipo 0/O, 1/l)
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bloco = (n) => Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  return `Kb-${bloco(4)}-${bloco(4)}`;
}

const esc = (s) => String(s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// E-mail transacional bonito e à prova de clientes de e-mail: tabelas + CSS
// inline, largura 600, cores da marca, logo hospedada no site.
// (exportado só pra pré-visualização em dev — Vercel ignora exports extras)
export function emailHtml({ nome, loginEmail, tempPassword, portalUrl, siteUrl }) {
  const primeiroNome = esc((nome || "").trim().split(/\s+/)[0] || "Cliente");
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Seu acesso à Área do Cliente Kuboo</title></head>
<body style="margin:0;padding:0;background-color:#EEF4FA;font-family:Arial,Helvetica,sans-serif;">
  <!-- preheader (aparece na prévia da caixa de entrada) -->
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">Seu acesso exclusivo à Área do Cliente Kuboo chegou — entre com a senha temporária e crie a sua.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#EEF4FA;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 10px 30px rgba(13,79,138,0.12);">

        <!-- Cabeçalho com a marca -->
        <tr><td style="background:linear-gradient(135deg,#0A1628 0%,#0D4F8A 60%,#1873BA 100%);background-color:#0D4F8A;padding:32px 40px;text-align:center;">
          <img src="${siteUrl}/kuboo-logo-white.png" alt="Kuboo Consórcios &amp; Seguros" width="150" style="display:block;margin:0 auto 14px;max-width:150px;height:auto;">
          <p style="margin:0;color:#9FD0F0;font-size:13px;letter-spacing:2px;text-transform:uppercase;">Área do Cliente</p>
        </td></tr>

        <!-- Boas-vindas -->
        <tr><td style="padding:36px 40px 8px;">
          <h1 style="margin:0 0 14px;color:#0A1628;font-size:24px;line-height:1.3;">Olá, ${primeiroNome}! Seu acesso chegou 🎉</h1>
          <p style="margin:0 0 14px;color:#4B5563;font-size:15px;line-height:1.65;">
            A <strong>Kuboo Consórcios &amp; Seguros</strong> criou um acesso exclusivo pra você acompanhar tudo
            o que tem com a gente, direto do celular ou do computador:
          </p>
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 6px;">
            <tr><td style="color:#1873BA;font-size:15px;padding:3px 8px 3px 0;">&#10004;</td><td style="color:#374151;font-size:14.5px;line-height:1.6;">Suas <strong>apólices de seguro</strong>: coberturas, vigência e vencimentos</td></tr>
            <tr><td style="color:#1873BA;font-size:15px;padding:3px 8px 3px 0;">&#10004;</td><td style="color:#374151;font-size:14.5px;line-height:1.6;">Seus <strong>consórcios</strong>: parcelas pagas, saldo e assembleias</td></tr>
            <tr><td style="color:#1873BA;font-size:15px;padding:3px 8px 3px 0;">&#10004;</td><td style="color:#374151;font-size:14.5px;line-height:1.6;"><strong>2ª via de documentos</strong> e boletos sem precisar ligar</td></tr>
            <tr><td style="color:#1873BA;font-size:15px;padding:3px 8px 3px 0;">&#10004;</td><td style="color:#374151;font-size:14.5px;line-height:1.6;"><strong>Suporte direto</strong> com nosso assistente Kubinho e a equipe</td></tr>
          </table>
        </td></tr>

        <!-- Credenciais -->
        <tr><td style="padding:16px 40px 8px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F2F8FE;border:1.5px solid #D3E6F8;border-radius:12px;">
            <tr><td style="padding:20px 24px;">
              <p style="margin:0 0 4px;color:#6B7280;font-size:12px;text-transform:uppercase;letter-spacing:1px;">Seu login</p>
              <p style="margin:0 0 14px;color:#0A1628;font-size:16px;font-weight:bold;word-break:break-all;">${esc(loginEmail)}</p>
              <p style="margin:0 0 4px;color:#6B7280;font-size:12px;text-transform:uppercase;letter-spacing:1px;">Senha temporária</p>
              <p style="margin:0;color:#0D4F8A;font-size:24px;font-weight:bold;font-family:'Courier New',Courier,monospace;letter-spacing:2px;">${esc(tempPassword)}</p>
            </td></tr>
          </table>
        </td></tr>

        <!-- Passo a passo -->
        <tr><td style="padding:20px 40px 4px;">
          <p style="margin:0 0 12px;color:#0A1628;font-size:16px;font-weight:bold;">Como entrar (leva 1 minuto):</p>
          <table role="presentation" cellpadding="0" cellspacing="0">
            <tr>
              <td style="vertical-align:top;padding:0 12px 14px 0;"><span style="display:inline-block;width:26px;height:26px;line-height:26px;text-align:center;background-color:#1873BA;color:#ffffff;border-radius:50%;font-size:14px;font-weight:bold;">1</span></td>
              <td style="color:#374151;font-size:14.5px;line-height:1.6;padding-bottom:14px;">Toque no botão <strong>“Acessar a Área do Cliente”</strong> aqui embaixo</td>
            </tr>
            <tr>
              <td style="vertical-align:top;padding:0 12px 14px 0;"><span style="display:inline-block;width:26px;height:26px;line-height:26px;text-align:center;background-color:#1873BA;color:#ffffff;border-radius:50%;font-size:14px;font-weight:bold;">2</span></td>
              <td style="color:#374151;font-size:14.5px;line-height:1.6;padding-bottom:14px;">Entre com o seu e-mail e a <strong>senha temporária</strong> acima</td>
            </tr>
            <tr>
              <td style="vertical-align:top;padding:0 12px 0 0;"><span style="display:inline-block;width:26px;height:26px;line-height:26px;text-align:center;background-color:#1873BA;color:#ffffff;border-radius:50%;font-size:14px;font-weight:bold;">3</span></td>
              <td style="color:#374151;font-size:14.5px;line-height:1.6;">O sistema vai pedir pra você <strong>criar a sua própria senha</strong> — pronto, só sua e segura</td>
            </tr>
          </table>
        </td></tr>

        <!-- CTA -->
        <tr><td style="padding:26px 40px 10px;" align="center">
          <a href="${portalUrl}" target="_blank" style="display:inline-block;background:linear-gradient(135deg,#1873BA,#1560A0);background-color:#1873BA;color:#ffffff;text-decoration:none;font-size:16px;font-weight:bold;padding:15px 42px;border-radius:999px;">Acessar a Área do Cliente&nbsp;&nbsp;&#8594;</a>
          <p style="margin:12px 0 0;color:#9CA3AF;font-size:12px;">ou copie e cole no navegador: <span style="color:#1873BA;">${portalUrl}</span></p>
        </td></tr>

        <!-- Segurança -->
        <tr><td style="padding:18px 40px 30px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#FFF8EB;border:1.5px solid #F5DFAE;border-radius:12px;">
            <tr><td style="padding:14px 20px;">
              <p style="margin:0;color:#8A5A00;font-size:13px;line-height:1.6;">
                <strong>Sua segurança em primeiro lugar:</strong> esta senha é temporária e só funciona até você criar a sua.
                Não compartilhe com ninguém — a equipe Kuboo <strong>nunca</strong> vai pedir sua senha por telefone,
                WhatsApp ou e-mail. Se você não solicitou este acesso, é só ignorar esta mensagem ou falar com a gente.
              </p>
            </td></tr>
          </table>
        </td></tr>

        <!-- Rodapé -->
        <tr><td style="background-color:#0A1628;padding:26px 40px;text-align:center;">
          <p style="margin:0 0 6px;color:#9FD0F0;font-size:14px;font-weight:bold;">Kuboo Consórcios &amp; Seguros</p>
          <p style="margin:0 0 4px;color:#64748B;font-size:11.5px;line-height:1.6;">
            Kuboo Seguros e Consórcios Ltda. · CNPJ 51.898.758/0001-20 · SUSEP 52D10J<br>
            R. Irmã Maria Demétria Kfuri, 737 — Jardim Esplanada, São José dos Campos - SP
          </p>
          <p style="margin:10px 0 0;color:#64748B;font-size:11.5px;">
            Dúvidas? Fale com a gente: <a href="https://wa.me/5511996970600" style="color:#5BC4F5;text-decoration:none;">WhatsApp (11) 99697-0600</a>
          </p>
        </td></tr>

      </table>
      <p style="margin:16px 0 0;color:#94A3B8;font-size:11px;text-align:center;">Você recebeu este e-mail porque a Kuboo criou seu acesso à Área do Cliente.</p>
    </td></tr>
  </table>
</body>
</html>`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const auth = await authTeamUser(req);
  if (auth.error) return res.status(auth.error).json({ error: auth.msg });
  if (rateLimited(auth.user.id)) return res.status(429).json({ error: "Muitos envios seguidos. Aguarde um minuto." });

  const supaUrl = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return res.status(500).json({ error: "SUPABASE_SERVICE_ROLE_KEY não configurada no Vercel" });
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    return res.status(503).json({
      error: "RESEND_API_KEY não configurada no Vercel — crie uma chave gratuita em resend.com, adicione a env e redeploye. Até lá, use o botão de copiar a senha e envie por WhatsApp.",
    });
  }

  const admin = createClient(supaUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const clientId = String(req.body?.clientId || "").trim();
  if (!clientId) return res.status(400).json({ error: "clientId é obrigatório." });

  try {
    // Só clientes (nunca contas de equipe) e só com e-mail REAL
    const { data: prof, error: pErr } = await admin
      .from("profiles").select("id, name, email, role").eq("id", clientId).single();
    if (pErr || !prof) return res.status(404).json({ error: "Cliente não encontrado." });
    if (prof.role !== "cliente") return res.status(400).json({ error: "Esse perfil não é de cliente." });
    const email = (prof.email || "").trim().toLowerCase();
    if (!email.includes("@") || email.endsWith("@sememail.kuboo.com.br")) {
      return res.status(400).json({ error: "Esse cliente não tem e-mail cadastrado. Adicione um e-mail no cadastro primeiro." });
    }

    // Nova senha temporária + troca obrigatória no 1º login (o portal força)
    const tempPassword = senhaTemporaria();
    const { error: upAuthErr } = await admin.auth.admin.updateUserById(clientId, { password: tempPassword });
    if (upAuthErr) throw new Error(`Falha ao gerar a senha temporária: ${upAuthErr.message}`);
    const { error: upProfErr } = await admin.from("profiles").update({ must_change_password: true }).eq("id", clientId);
    if (upProfErr) throw new Error(`Senha gerada, mas falhou ao marcar a troca obrigatória: ${upProfErr.message}`);

    const siteUrl = (process.env.SITE_URL || "https://kuboo-site.vercel.app").replace(/\/$/, "");
    const portalUrl = `${siteUrl}/portal`;
    const html = emailHtml({ nome: prof.name, loginEmail: email, tempPassword, portalUrl, siteUrl });

    const sendR = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${resendKey}` },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || "Kuboo <onboarding@resend.dev>",
        to: [email],
        subject: "Seu acesso à Área do Cliente Kuboo chegou",
        html,
      }),
    });
    const sendD = await sendR.json().catch(() => ({}));
    if (!sendR.ok) {
      // A senha JÁ foi trocada — devolve a temporária pra equipe repassar por WhatsApp
      return res.status(502).json({
        error: `O e-mail não foi enviado (${sendD?.message || sendR.status}). A senha temporária NOVA é ${tempPassword} — envie por WhatsApp, ou tente de novo.`,
        tempPassword,
      });
    }

    return res.status(200).json({ ok: true, sentTo: email, tempPassword });
  } catch (err) {
    console.error(JSON.stringify({ level: "error", fn: "enviar-credenciais", msg: String(err).slice(0, 300) }));
    return res.status(500).json({ error: err instanceof Error ? err.message : "Falha ao enviar credenciais" });
  }
}

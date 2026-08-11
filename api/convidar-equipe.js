// Vercel Serverless — CONVITE de acesso ao CRM para a equipe.
//
// Diferente de api/criar-equipe.js (que gera senha temporária), aqui NINGUÉM
// nunca vê uma senha: o Supabase gera um link de convite e a própria pessoa
// define a senha dela. Mais seguro e é o que o C2S fazia.
//
// Como funciona:
//   1. generateLink({type:'invite'}) cria o usuário e devolve o link — SEM
//      passar pelo SMTP do Supabase (que é limitado a poucos e-mails/hora).
//   2. O e-mail bonito sai pela Resend (mesma infra do envio de credenciais).
//   3. Se a pessoa JÁ tem login, manda link de 'recovery' ("definir senha"),
//      então reenviar convite é sempre seguro e idempotente.
//
// SEGURANÇA: exige JWT de GESTOR/ADMIN; só admin convida outro admin.
//
// ENVS (Vercel): SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY,
//                EMAIL_FROM (opcional), CRM_URL (opcional)
//
// IMPORTANTE: a URL de redirect precisa estar na allowlist do Supabase
// (Authentication → URL Configuration → Redirect URLs), senão o link cai no
// Site URL padrão.

import { createClient } from "@supabase/supabase-js";

const BUCKET = new Map();
function rateLimited(id) {
  const now = Date.now();
  const e = BUCKET.get(id) ?? { n: 0, t: now };
  if (now - e.t > 60_000) { e.n = 0; e.t = now; }
  e.n += 1;
  BUCKET.set(id, e);
  if (BUCKET.size > 2000) BUCKET.clear();
  return e.n > 5; // 5 chamadas/min (cada uma pode levar vários convites)
}

async function authCaller(req) {
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
  if (!["gestor", "admin"].includes(role)) return { error: 403, msg: "Só gestores e admins convidam a equipe" };
  return { user, callerRole: role };
}

const esc = (s) => String(s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const PAPEL_LABEL = { vendedor: "Consultor(a)", gestor: "Gestor(a)", admin: "Administrador(a)" };

export function conviteHtml({ nome, loginEmail, actionLink, crmUrl, papel, novo }) {
  const primeiroNome = esc((nome || "").trim().split(/\s+/)[0] || "equipe");
  const cargo = PAPEL_LABEL[papel] || "Consultor(a)";
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Seu acesso ao CRM Kuboo</title></head>
<body style="margin:0;padding:0;background-color:#EEF4FA;font-family:Arial,Helvetica,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">Crie sua senha e comece a usar o CRM da Kuboo — leva menos de um minuto.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#EEF4FA;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 10px 30px rgba(13,79,138,0.12);">

        <tr><td style="background:linear-gradient(135deg,#0A1628 0%,#0D4F8A 60%,#1873BA 100%);background-color:#0D4F8A;padding:32px 40px;text-align:center;">
          <p style="margin:0 0 8px;color:#ffffff;font-size:26px;font-weight:bold;letter-spacing:1px;">KUBOO</p>
          <p style="margin:0;color:#9FD0F0;font-size:13px;letter-spacing:2px;text-transform:uppercase;">CRM — Área da Equipe</p>
        </td></tr>

        <tr><td style="padding:36px 40px 8px;">
          <h1 style="margin:0 0 14px;color:#0A1628;font-size:24px;line-height:1.3;">${primeiroNome}, seu acesso ao CRM está pronto</h1>
          <p style="margin:0 0 16px;color:#4B5563;font-size:15px;line-height:1.65;">
            Você foi cadastrado(a) como <strong>${esc(cargo)}</strong> no novo CRM da
            <strong>Kuboo Consórcios &amp; Seguros</strong> — o sistema que substitui o Contact2Sale.
            É nele que a partir de agora acontece o dia a dia:
          </p>
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 6px;">
            <tr><td style="color:#1873BA;font-size:15px;padding:3px 8px 3px 0;">&#10004;</td><td style="color:#374151;font-size:14.5px;line-height:1.6;">Seus <strong>leads</strong> chegam e são distribuídos automaticamente</td></tr>
            <tr><td style="color:#1873BA;font-size:15px;padding:3px 8px 3px 0;">&#10004;</td><td style="color:#374151;font-size:14.5px;line-height:1.6;"><strong>Funil, atividades e follow-ups</strong> num lugar só</td></tr>
            <tr><td style="color:#1873BA;font-size:15px;padding:3px 8px 3px 0;">&#10004;</td><td style="color:#374151;font-size:14.5px;line-height:1.6;"><strong>Bolsão</strong>, metas, ranking e comissões em tempo real</td></tr>
            <tr><td style="color:#1873BA;font-size:15px;padding:3px 8px 3px 0;">&#10004;</td><td style="color:#374151;font-size:14.5px;line-height:1.6;">Sinistros triados pelo <strong>Kubinho</strong> caem direto pra equipe</td></tr>
          </table>
        </td></tr>

        <tr><td style="padding:16px 40px 8px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F2F8FE;border:1.5px solid #D3E6F8;border-radius:12px;">
            <tr><td style="padding:20px 24px;">
              <p style="margin:0 0 4px;color:#6B7280;font-size:12px;text-transform:uppercase;letter-spacing:1px;">Seu login</p>
              <p style="margin:0;color:#0A1628;font-size:16px;font-weight:bold;word-break:break-all;">${esc(loginEmail)}</p>
            </td></tr>
          </table>
        </td></tr>

        <tr><td style="padding:24px 40px 10px;" align="center">
          <a href="${actionLink}" target="_blank" style="display:inline-block;background:linear-gradient(135deg,#1873BA,#1560A0);background-color:#1873BA;color:#ffffff;text-decoration:none;font-size:16px;font-weight:bold;padding:15px 42px;border-radius:999px;">Criar minha senha&nbsp;&nbsp;&#8594;</a>
          <p style="margin:14px 0 0;color:#6B7280;font-size:13px;line-height:1.6;">
            Você define a senha que quiser — <strong>ninguém da equipe vê ou escolhe</strong> a sua senha.
          </p>
        </td></tr>

        <tr><td style="padding:10px 40px 4px;">
          <p style="margin:0 0 12px;color:#0A1628;font-size:16px;font-weight:bold;">Depois de criar a senha:</p>
          <table role="presentation" cellpadding="0" cellspacing="0">
            <tr>
              <td style="vertical-align:top;padding:0 12px 12px 0;"><span style="display:inline-block;width:26px;height:26px;line-height:26px;text-align:center;background-color:#1873BA;color:#ffffff;border-radius:50%;font-size:14px;font-weight:bold;">1</span></td>
              <td style="color:#374151;font-size:14.5px;line-height:1.6;padding-bottom:12px;">Acesse <a href="${crmUrl}" style="color:#1873BA;">${crmUrl.replace(/^https?:\/\//, "")}</a> e entre com o seu e-mail</td>
            </tr>
            <tr>
              <td style="vertical-align:top;padding:0 12px 12px 0;"><span style="display:inline-block;width:26px;height:26px;line-height:26px;text-align:center;background-color:#1873BA;color:#ffffff;border-radius:50%;font-size:14px;font-weight:bold;">2</span></td>
              <td style="color:#374151;font-size:14.5px;line-height:1.6;padding-bottom:12px;">Em <strong>Meu Perfil</strong>, ligue sua <strong>disponibilidade</strong> pra entrar no rodízio de leads</td>
            </tr>
            <tr>
              <td style="vertical-align:top;padding:0 12px 0 0;"><span style="display:inline-block;width:26px;height:26px;line-height:26px;text-align:center;background-color:#1873BA;color:#ffffff;border-radius:50%;font-size:14px;font-weight:bold;">3</span></td>
              <td style="color:#374151;font-size:14.5px;line-height:1.6;">Salve o site no celular — funciona como app, sem instalar nada</td>
            </tr>
          </table>
        </td></tr>

        <tr><td style="padding:22px 40px 30px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#FFF8EB;border:1.5px solid #F5DFAE;border-radius:12px;">
            <tr><td style="padding:14px 20px;">
              <p style="margin:0;color:#8A5A00;font-size:13px;line-height:1.6;">
                <strong>Este link é pessoal e expira.</strong> Não repasse pra ninguém. Se ele vencer antes de você
                usar, é só pedir um novo convite pra gestão — leva 5 segundos.
              </p>
            </td></tr>
          </table>
        </td></tr>

        <tr><td style="background-color:#0A1628;padding:26px 40px;text-align:center;">
          <p style="margin:0 0 6px;color:#9FD0F0;font-size:14px;font-weight:bold;">Kuboo Consórcios &amp; Seguros</p>
          <p style="margin:0;color:#64748B;font-size:11.5px;line-height:1.6;">
            Kuboo Seguros e Consórcios Ltda. · CNPJ 51.898.758/0001-20 · SUSEP 52D10J<br>
            R. Irmã Maria Demétria Kfuri, 737 — Jardim Esplanada, São José dos Campos - SP
          </p>
        </td></tr>

      </table>
      <p style="margin:16px 0 0;color:#94A3B8;font-size:11px;text-align:center;">Você recebeu este e-mail porque a gestão da Kuboo criou seu acesso ao CRM${novo ? "" : " (reenvio de convite)"}.</p>
    </td></tr>
  </table>
</body>
</html>`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const auth = await authCaller(req);
  if (auth.error) return res.status(auth.error).json({ error: auth.msg });
  if (rateLimited(auth.user.id)) return res.status(429).json({ error: "Muitos envios seguidos. Aguarde um minuto." });

  const supaUrl = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return res.status(500).json({ error: "SUPABASE_SERVICE_ROLE_KEY não configurada no Vercel" });
  // Sem Resend o convite AINDA funciona: cai no e-mail nativo do Supabase.
  // (mais simples de ligar, porém com limite de poucos envios por hora e mais
  // chance de cair em spam — por isso o Resend é o caminho preferido)
  const resendKey = process.env.RESEND_API_KEY;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;

  const admin = createClient(supaUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const crmUrl = (process.env.CRM_URL || "https://crm-kuboo.vercel.app").replace(/\/$/, "");
  const redirectTo = `${crmUrl}/seguros/perfil`;

  // Aceita 1 pessoa ({name,email,role}) ou uma lista ({pessoas:[...]})
  const brutos = Array.isArray(req.body?.pessoas) ? req.body.pessoas : [req.body ?? {}];
  if (!brutos.length || brutos.length > 40) return res.status(400).json({ error: "Envie de 1 a 40 pessoas por vez." });

  const resultados = [];
  for (const bruto of brutos) {
    const name = String(bruto?.name || "").trim().slice(0, 200);
    const email = String(bruto?.email || "").trim().toLowerCase().slice(0, 200);
    const role = ["vendedor", "gestor", "admin"].includes(bruto?.role) ? bruto.role : "vendedor";

    if (!name || !email.includes("@")) {
      resultados.push({ email: email || "(sem e-mail)", ok: false, erro: "Nome e e-mail válidos são obrigatórios." });
      continue;
    }
    if (role === "admin" && auth.callerRole !== "admin") {
      resultados.push({ email, ok: false, erro: "Só um admin pode convidar outro admin." });
      continue;
    }

    try {
      // Já existe login com este e-mail? Então é reenvio → link de definir senha.
      const { data: jaTem } = await admin.from("profiles").select("id, role").eq("email", email).limit(1);
      const existente = jaTem?.[0] ?? null;

      // generateLink cria o usuário (quando novo) e devolve o link SEM enviar
      // e-mail — assim o envio fica por nossa conta (Resend) ou, sem ele, pelo
      // próprio Supabase logo abaixo.
      const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink(
        existente
          ? { type: "recovery", email, options: { redirectTo } }
          : { type: "invite", email, options: { redirectTo, data: { name } } }
      );
      if (linkErr) throw new Error(linkErr.message);

      const actionLink = linkData?.properties?.action_link;
      const userId = existente?.id || linkData?.user?.id;
      if (!actionLink || !userId) throw new Error("Supabase não devolveu o link de convite.");

      // Garante o perfil de equipe correto (papel, nome, aprovado).
      // Não rebaixa quem já é admin/gestor por engano.
      const patch = { name, email, aprovado: true };
      const ordem = { vendedor: 1, gestor: 2, admin: 3 };
      if (!existente || (ordem[role] ?? 0) >= (ordem[existente.role] ?? 0)) patch.role = role;
      const { error: upErr } = await admin.from("profiles").update(patch).eq("id", userId);
      if (upErr) throw new Error(`Convite gerado, mas falhou ao salvar o perfil: ${upErr.message}`);

      if (resendKey) {
        // Caminho preferido: e-mail da marca, sem limite prático de volume.
        const html = conviteHtml({ nome: name, loginEmail: email, actionLink, crmUrl, papel: role, novo: !existente });
        const sendR = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${resendKey}` },
          body: JSON.stringify({
            from: process.env.EMAIL_FROM || "Kuboo <onboarding@resend.dev>",
            to: [email],
            subject: existente ? "Kuboo CRM — link para definir sua senha" : "Seu acesso ao CRM da Kuboo chegou",
            html,
          }),
        });
        const sendD = await sendR.json().catch(() => ({}));
        if (!sendR.ok) {
          resultados.push({ email, ok: false, criado: !existente, erro: `E-mail não enviado: ${sendD?.message || sendR.status}` });
          continue;
        }
        resultados.push({ email, ok: true, criado: !existente, via: "resend", role: patch.role ?? existente?.role });
      } else {
        // Fallback sem Resend: o próprio Supabase manda o e-mail padrão dele.
        // Funciona sem nenhuma env extra, mas tem limite de poucos envios por
        // hora — por isso reportamos 'via' pra UI poder avisar.
        let sendErr = null;
        if (existente) {
          if (!anonKey) sendErr = "VITE_SUPABASE_ANON_KEY ausente no servidor";
          else {
            const r = await fetch(`${supaUrl}/auth/v1/recover`, {
              method: "POST",
              headers: { "Content-Type": "application/json", apikey: anonKey },
              body: JSON.stringify({ email, gotrue_meta_security: {} }),
            });
            if (!r.ok) sendErr = `Supabase recusou o envio (${r.status}) — pode ser limite de e-mails por hora.`;
          }
        } else {
          const { error: invErr } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo, data: { name } });
          // O usuário já foi criado pelo generateLink acima; "already registered"
          // aqui significa só que o convite nativo não repetiu a criação.
          if (invErr && !/already|registered|exists/i.test(String(invErr.message))) {
            sendErr = `${invErr.message} — pode ser limite de e-mails por hora do Supabase.`;
          }
        }
        if (sendErr) {
          resultados.push({ email, ok: false, criado: !existente, erro: sendErr });
          continue;
        }
        resultados.push({ email, ok: true, criado: !existente, via: "supabase", role: patch.role ?? existente?.role });
      }
    } catch (err) {
      resultados.push({ email, ok: false, erro: err instanceof Error ? err.message : "Falha ao convidar" });
    }
  }

  const enviados = resultados.filter((r) => r.ok).length;
  return res.status(200).json({ enviados, total: resultados.length, resultados });
}

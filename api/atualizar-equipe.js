// Vercel Serverless — ATUALIZA/DESATIVA/REATIVA usuário de equipe (consultor/
// gestor/admin) no CRM. Paridade com a tela "Usuários" do C2S (edição, papel,
// assinatura, permissões granulares, desativar com transferência de leads —
// docs/C2S-SCAN.md §Usuários).
//
// SEGURANÇA: o fix de escalada de privilégio revogou UPDATE em profiles pro
// client (só must_change_password segue liberado). Qualquer edição de
// role/aprovado/permissoes/assinatura/phone/name de OUTRO usuário passa por
// aqui, com service role, e exige JWT de GESTOR/ADMIN. Só admin muda papel
// de/para admin. Nunca mexe em profiles com role 'cliente'.

import { createClient } from "@supabase/supabase-js";

const TEAM_ROLES = ["vendedor", "gestor", "admin"];
const PERMISSOES_CHAVES = [
  "editar_usuarios", "editar_filas", "editar_bolsao", "editar_etiquetas",
  "acessar_config", "acessar_financeiro", "extrair_relatorios", "visivel_relatorios",
];

const BUCKET = new Map();
function rateLimited(id) {
  const now = Date.now();
  const e = BUCKET.get(id) ?? { n: 0, t: now };
  if (now - e.t > 60_000) { e.n = 0; e.t = now; }
  e.n += 1;
  BUCKET.set(id, e);
  if (BUCKET.size > 2000) BUCKET.clear();
  return e.n > 20;
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
  if (!["gestor", "admin"].includes(role)) return { error: 403, msg: "Só gestores e admins gerenciam a equipe" };
  return { user, callerRole: role };
}

function isColumnMissing(err) {
  const code = err?.code || "";
  const msg = String(err?.message || "");
  return code === "42703" || code === "PGRST204" || /column .* does not exist/i.test(msg);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const auth = await authCaller(req);
  if (auth.error) return res.status(auth.error).json({ error: auth.msg });
  if (rateLimited(auth.user.id)) return res.status(429).json({ error: "Muitas ações seguidas. Aguarde um minuto." });

  const supaUrl = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return res.status(500).json({ error: "SUPABASE_SERVICE_ROLE_KEY não configurada no Vercel" });
  const admin = createClient(supaUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const b = req.body ?? {};
  const userId = String(b.userId || "").trim();
  const acao = String(b.acao || "").trim();
  if (!userId) return res.status(400).json({ error: "userId é obrigatório." });
  if (!["atualizar", "desativar", "reativar"].includes(acao)) {
    return res.status(400).json({ error: "Ação inválida." });
  }

  try {
    // Alvo tem que ser da equipe — nunca mexe em profile de cliente.
    const { data: alvo, error: alvoErr } = await admin
      .from("profiles").select("id, role, name").eq("id", userId).single();
    if (alvoErr || !alvo) return res.status(404).json({ error: "Usuário não encontrado." });
    if (!TEAM_ROLES.includes(alvo.role)) {
      return res.status(403).json({ error: "Este endpoint só gerencia usuários de equipe." });
    }

    if (acao === "atualizar") {
      const p = b.payload ?? {};
      const patch = {};

      if (p.name !== undefined) {
        const name = String(p.name || "").trim().slice(0, 200);
        if (!name) return res.status(400).json({ error: "Nome não pode ficar em branco." });
        patch.name = name;
      }
      if (p.phone !== undefined) {
        patch.phone = String(p.phone || "").trim().slice(0, 30) || null;
      }
      if (p.role !== undefined) {
        if (!TEAM_ROLES.includes(p.role)) return res.status(400).json({ error: "Papel inválido." });
        const mexeEmAdmin = p.role === "admin" || alvo.role === "admin";
        if (mexeEmAdmin && auth.callerRole !== "admin") {
          return res.status(403).json({ error: "Só um admin muda o papel de/para administrador." });
        }
        patch.role = p.role;
      }
      if (p.assinatura !== undefined) {
        patch.assinatura = String(p.assinatura || "").slice(0, 2000) || null;
      }
      if (p.permissoes !== undefined) {
        const entrada = p.permissoes && typeof p.permissoes === "object" ? p.permissoes : {};
        const permissoes = {};
        for (const chave of PERMISSOES_CHAVES) {
          if (chave in entrada) permissoes[chave] = entrada[chave] === true;
        }
        patch.permissoes = permissoes;
      }

      if (Object.keys(patch).length === 0) {
        return res.status(400).json({ error: "Nada para atualizar." });
      }

      const { error: upErr } = await admin.from("profiles").update(patch).eq("id", userId);
      if (upErr) {
        if (isColumnMissing(upErr)) {
          return res.status(409).json({ error: "Permissões/assinatura ainda não existem no banco — rode supabase/c2s-parity.sql." });
        }
        throw new Error(upErr.message);
      }
      return res.status(200).json({ ok: true });
    }

    if (acao === "desativar") {
      if (userId === auth.user.id) return res.status(400).json({ error: "Você não pode desativar a si mesmo." });

      const p = b.payload ?? {};
      const transferirAtivosPara = String(p.transferirAtivosPara || "").trim();
      const transferirArquivadosPara = String(p.transferirArquivadosPara || "").trim();
      if (!transferirAtivosPara || !transferirArquivadosPara) {
        return res.status(400).json({ error: "Escolha o destino dos leads ativos e arquivados." });
      }

      for (const destino of [transferirAtivosPara, transferirArquivadosPara]) {
        if (destino === "redistribuir") continue;
        const { data: destinoProfile } = await admin.from("profiles").select("id, role").eq("id", destino).single();
        if (!destinoProfile || !TEAM_ROLES.includes(destinoProfile.role)) {
          return res.status(400).json({ error: "Destino de transferência inválido." });
        }
      }

      const patchAtivos = transferirAtivosPara === "redistribuir" ? { vendedor_id: null } : { vendedor_id: transferirAtivosPara };
      const { data: ativosUpdated, error: ativosErr } = await admin
        .from("leads").update(patchAtivos).eq("vendedor_id", userId)
        .or("descartado.is.null,descartado.eq.false").select("id");
      if (ativosErr) throw new Error(ativosErr.message);

      const patchArquivados = transferirArquivadosPara === "redistribuir" ? { vendedor_id: null } : { vendedor_id: transferirArquivadosPara };
      const { data: arquivadosUpdated, error: arquivadosErr } = await admin
        .from("leads").update(patchArquivados).eq("vendedor_id", userId)
        .eq("descartado", true).select("id");
      if (arquivadosErr) throw new Error(arquivadosErr.message);

      const { error: aprovErr } = await admin.from("profiles").update({ aprovado: false }).eq("id", userId);
      if (aprovErr) throw new Error(aprovErr.message);

      await admin.from("fila_usuarios").delete().eq("user_id", userId);

      return res.status(200).json({
        ativosMovidos: ativosUpdated?.length ?? 0,
        arquivadosMovidos: arquivadosUpdated?.length ?? 0,
      });
    }

    if (acao === "reativar") {
      const { error: reativErr } = await admin.from("profiles").update({ aprovado: true }).eq("id", userId);
      if (reativErr) throw new Error(reativErr.message);
      return res.status(200).json({ ok: true });
    }
  } catch (err) {
    console.error(JSON.stringify({ level: "error", fn: "atualizar-equipe", msg: String(err).slice(0, 300) }));
    return res.status(500).json({ error: err instanceof Error ? err.message : "Falha ao atualizar usuário" });
  }
}

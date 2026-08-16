// Vercel Serverless — EXCLUI um CLIENTE (cadastro + login do portal).
//
// POR QUE server-side: o client não tem DELETE em profiles (RLS), e apagar o
// login exige a admin API do Auth — service role só vive aqui.
//
// TRAVA DE SEGURANÇA (importante): apolices.client_id e consorcios.client_id
// têm ON DELETE CASCADE — excluir o profile de um cliente com contrato apagaria
// as apólices/consórcios JUNTO, em silêncio. Por isso a exclusão é BLOQUEADA
// enquanto o cliente tiver qualquer vínculo (apólices, consórcios, vendas,
// cotas ou sinistros): o caso de uso real é limpar cadastro errado/duplicado,
// não destruir histórico. Cliente com vínculo: transfira/exclua os registros
// antes, conscientemente, tela a tela.
//
// SEGURANÇA: exige JWT de GESTOR/ADMIN. Só mexe em profile de CLIENTE — nunca
// em usuário de equipe (pra isso existe o desativar do atualizar-equipe).

import { createClient } from "@supabase/supabase-js";

const BUCKET = new Map();
function rateLimited(id) {
  const now = Date.now();
  const e = BUCKET.get(id) ?? { n: 0, t: now };
  if (now - e.t > 60_000) { e.n = 0; e.t = now; }
  e.n += 1;
  BUCKET.set(id, e);
  if (BUCKET.size > 2000) BUCKET.clear();
  return e.n > 10;
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
  if (!["gestor", "admin"].includes(role)) return { error: 403, msg: "Só gestores e admins excluem clientes" };
  return { user };
}

// (tabela, coluna, rótulo humano) — tudo que prende um cliente ao histórico.
const VINCULOS = [
  ["apolices", "client_id", "apólice(s)"],
  ["consorcios", "client_id", "consórcio(s)"],
  ["vendas", "cliente_id", "venda(s)"],
  ["cotas", "cliente_id", "cota(s)"],
  ["sinistros_chamados", "cliente_id", "sinistro(s)"],
];

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const auth = await authCaller(req);
  if (auth.error) return res.status(auth.error).json({ error: auth.msg });
  if (rateLimited(auth.user.id)) return res.status(429).json({ error: "Muitas exclusões seguidas. Aguarde um minuto." });

  const supaUrl = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return res.status(500).json({ error: "SUPABASE_SERVICE_ROLE_KEY não configurada no Vercel" });
  const admin = createClient(supaUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const clientId = String(req.body?.clientId || "").trim();
  if (!clientId) return res.status(400).json({ error: "clientId é obrigatório." });

  try {
    const { data: alvo, error: alvoErr } = await admin
      .from("profiles").select("id, name, role").eq("id", clientId).single();
    if (alvoErr || !alvo) return res.status(404).json({ error: "Cliente não encontrado." });
    if (alvo.role && alvo.role !== "cliente") {
      return res.status(403).json({ error: "Este endpoint só exclui CLIENTES. Usuário de equipe se desativa na tela de Usuários." });
    }

    // Vínculos bloqueiam — head+count é barato e roda em paralelo.
    const contagens = await Promise.all(VINCULOS.map(([tabela, coluna]) =>
      admin.from(tabela).select("id", { count: "exact", head: true }).eq(coluna, clientId)
    ));
    const presos = [];
    contagens.forEach(({ count, error }, i) => {
      // Erro na contagem = trata como vínculo: melhor recusar do que apagar às cegas.
      if (error) presos.push(`${VINCULOS[i][2]} (não foi possível conferir)`);
      else if ((count ?? 0) > 0) presos.push(`${count} ${VINCULOS[i][2]}`);
    });
    if (presos.length) {
      return res.status(409).json({
        error: `"${alvo.name}" tem ${presos.join(", ")} vinculado(s). Transfira ou exclua esses registros antes — excluir o cliente apagaria esse histórico junto.`,
      });
    }

    // Livre de vínculos: apaga o LOGIN (cascateia profile + notificações).
    // Cliente importado sem login não existe no Auth — aí apaga só o profile.
    let loginRemovido = false;
    const { error: authErr } = await admin.auth.admin.deleteUser(clientId);
    if (!authErr) loginRemovido = true;
    else if (!/not.?found/i.test(String(authErr.message || ""))) {
      throw new Error(`Falha ao remover o login: ${authErr.message}`);
    }

    // Garante o profile fora (cobre tanto o "sem login" quanto FK sem cascade).
    const { data: apagados, error: profErr } = await admin
      .from("profiles").delete().eq("id", clientId).select("id");
    if (profErr) throw new Error(`Login removido, mas o cadastro resistiu: ${profErr.message}`);
    if (!loginRemovido && !(apagados?.length)) {
      return res.status(404).json({ error: "Nada foi excluído — o cliente já não existia." });
    }

    return res.status(200).json({ ok: true, nome: alvo.name, loginRemovido });
  } catch (err) {
    console.error(JSON.stringify({ level: "error", fn: "excluir-cliente", msg: String(err).slice(0, 300) }));
    return res.status(500).json({ error: err instanceof Error ? err.message : "Falha ao excluir cliente" });
  }
}

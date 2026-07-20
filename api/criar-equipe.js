// Vercel Serverless — cria USUÁRIO DE EQUIPE (consultor/gestor) no CRM.
// Paridade com o "Criar usuário" do C2S (docs/C2S-SCAN.md §Usuários).
//
// SEGURANÇA: exige JWT de GESTOR/ADMIN (vendedor não cria usuário; só admin
// cria outro admin). Service role só aqui no servidor. Dedup por e-mail.
// Retorna a senha temporária UMA vez — a equipe repassa e a pessoa troca.

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
  if (!["gestor", "admin"].includes(role)) return { error: 403, msg: "Só gestores e admins criam usuários de equipe" };
  return { user, callerRole: role };
}

function senhaTemporaria() {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bloco = (n) => Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  return `Kb-${bloco(4)}-${bloco(4)}`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const auth = await authCaller(req);
  if (auth.error) return res.status(auth.error).json({ error: auth.msg });
  if (rateLimited(auth.user.id)) return res.status(429).json({ error: "Muitas criações seguidas. Aguarde um minuto." });

  const supaUrl = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return res.status(500).json({ error: "SUPABASE_SERVICE_ROLE_KEY não configurada no Vercel" });
  const admin = createClient(supaUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const b = req.body ?? {};
  const name = String(b.name || "").trim().slice(0, 200);
  const email = String(b.email || "").trim().toLowerCase().slice(0, 200);
  const phone = String(b.phone || "").trim().slice(0, 30) || null;
  const role = ["vendedor", "gestor", "admin"].includes(b.role) ? b.role : "vendedor";
  if (!name || !email.includes("@")) return res.status(400).json({ error: "Nome e e-mail válidos são obrigatórios." });
  if (role === "admin" && auth.callerRole !== "admin") {
    return res.status(403).json({ error: "Só um admin pode criar outro admin." });
  }

  try {
    // Dedup por e-mail no profiles
    const { data: existentes } = await admin.from("profiles").select("id, name").eq("email", email).limit(1);
    if (existentes && existentes.length) {
      return res.status(409).json({ error: `Já existe um usuário com este e-mail: ${existentes[0].name}.` });
    }

    const tempPassword = senhaTemporaria();
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { name },
    });
    if (error) {
      const msg = String(error.message || "");
      if (/already|registered|exists/i.test(msg)) return res.status(409).json({ error: "Este e-mail já tem login no sistema." });
      throw new Error(`Criação de usuário falhou: ${msg}`);
    }
    const userId = data.user.id;

    // handle_new_user criou profile mínimo — promove pra equipe com os dados reais
    const { error: upErr } = await admin.from("profiles").update({
      name, email, phone, role, aprovado: true,
    }).eq("id", userId);
    if (upErr) throw new Error(`Login criado mas falhou ao salvar o perfil: ${upErr.message}`);

    return res.status(200).json({ id: userId, loginEmail: email, tempPassword, role });
  } catch (err) {
    console.error(JSON.stringify({ level: "error", fn: "criar-equipe", msg: String(err).slice(0, 300) }));
    return res.status(500).json({ error: err instanceof Error ? err.message : "Falha ao criar usuário" });
  }
}

// Vercel Serverless Function — cria cliente REAL (Supabase Auth + profile).
// Só aqui a SUPABASE_SERVICE_ROLE_KEY é usada (nunca no frontend). Sem ela,
// não existe forma seguro de criar login de cliente a partir do CRM.
//
// SEGURANÇA: exige JWT válido do Supabase + papel de equipe (mesmo padrão do
// api/trello.js). Rate limit por usuário. O DOCUMENTO é único (dedup) — se já
// existe profile com o mesmo CPF/CNPJ, retorna 409 em vez de criar duplicata.
//
// PF e PJ: a coluna profiles.cpf guarda CPF (11) ou CNPJ (14); profiles.tipo_pessoa
// diz qual é. Empresa é caso comum aqui — RCO é seguro de ônibus/van de
// passageiros, logo o cliente é transportadora.

import { createClient } from "@supabase/supabase-js";
import { analisarDocumento } from "./_documento.js";

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

const soDigitos = (s) => String(s || "").replace(/\D/g, "");

function senhaTemporaria() {
  // Fácil de ditar por telefone/WhatsApp, difícil de adivinhar.
  const bloco = () => Math.random().toString(36).slice(2, 6).toUpperCase();
  return `Kb${bloco()}${Math.floor(Math.random() * 90 + 10)}!`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const auth = await authTeamUser(req);
  if (auth.error) return res.status(auth.error).json({ error: auth.msg });
  if (rateLimited(auth.user.id)) return res.status(429).json({ error: "Muitos cadastros seguidos. Aguarde um minuto." });

  const supaUrl = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return res.status(500).json({ error: "SUPABASE_SERVICE_ROLE_KEY não configurada no Vercel" });
  const admin = createClient(supaUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const body = req.body ?? {};
  const name = String(body.name || "").trim().slice(0, 200);
  const cpf = soDigitos(body.cpf);
  const emailInformado = String(body.email || "").trim().toLowerCase().slice(0, 200);
  const phone = String(body.phone || "").trim().slice(0, 30);
  const birth_date = body.birth_date || null;
  const address = String(body.address || "").trim().slice(0, 300) || null;
  const city = String(body.city || "").trim().slice(0, 120) || null;
  const state = String(body.state || "").trim().slice(0, 2).toUpperCase() || null;
  const cep = soDigitos(body.cep) || null;

  // analisarDocumento confere o DÍGITO VERIFICADOR — só contar dígitos deixaria
  // "11111111111" entrar e envenenar a deduplicação e a vinculação de apólice
  // por planilha (que casa cliente pelo documento).
  if (!name) return res.status(400).json({ error: "O nome (ou a razão social) é obrigatório." });
  const doc = analisarDocumento(cpf);
  if (!doc.ok) return res.status(400).json({ error: doc.erro });
  const tipoPessoa = doc.tipo;

  try {
    // Dedup: já existe cliente com esse CPF? O banco pode ter o CPF em DÍGITOS
    // (novos cadastros) OU FORMATADO (dados legados/importados) — checa as duas
    // formas pra o anti-duplicata nunca deixar passar duplicata por formatação.
    const { data: existentes } = await admin.from("profiles").select("id, name").in("cpf", [doc.digitos, doc.formatado]);
    const existente = (existentes || [])[0];
    if (existente) {
      return res.status(409).json({ error: `Já existe um cliente com este ${tipoPessoa === "PJ" ? "CNPJ" : "CPF"}: ${existente.name}.` });
    }

    const temEmailReal = emailInformado.includes("@");
    const emailParaLogin = temEmailReal ? emailInformado : `${doc.digitos}@sememail.kuboo.com.br`;

    // SEMPRE senha temporária + troca obrigatória no 1º login (o portal força).
    // Com e-mail real, a UI chama /api/enviar-credenciais na sequência — o
    // cliente recebe o e-mail bonito da Kuboo (não o convite genérico do Supabase).
    const tempPassword = senhaTemporaria();
    const { data, error } = await admin.auth.admin.createUser({
      email: emailParaLogin,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { name },
    });
    if (error) throw new Error(`Criação de usuário falhou: ${error.message}`);
    const userId = data.user.id;

    // O trigger handle_new_user já criou um profile mínimo — atualiza com os dados reais.
    const { error: upErr } = await admin.from("profiles").update({
      name, cpf: doc.digitos, tipo_pessoa: tipoPessoa,
      // PJ não tem data de nascimento; se vier preenchida por engano, ignora.
      phone: phone || null, birth_date: tipoPessoa === "PJ" ? null : birth_date,
      address, city, state, cep,
      email: temEmailReal ? emailParaLogin : null,
      must_change_password: true,
    }).eq("id", userId);
    if (upErr) throw new Error(`Perfil criado mas falhou ao salvar dados: ${upErr.message}`);

    return res.status(200).json({
      id: userId,
      temEmail: temEmailReal,
      tempPassword, // mostrar 1x na UI (e enviar por e-mail quando temEmail)
      loginEmail: emailParaLogin,
    });
  } catch (err) {
    console.error(JSON.stringify({ level: "error", fn: "clientes", msg: String(err).slice(0, 300) }));
    return res.status(500).json({ error: err instanceof Error ? err.message : "Falha ao criar cliente" });
  }
}

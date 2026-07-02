// Vercel Serverless Function — ponte segura com a API do Trello.
// Chave/token do Trello ficam APENAS no servidor (env TRELLO_KEY / TRELLO_TOKEN).
// SEGURANÇA: endpoint exige JWT válido do Supabase E papel de equipe
// (vendedor/gestor/admin) — sem isso, 401/403. Nada de acesso anônimo.

const LISTAS = { a_fazer: "A fazer", fazendo: "Fazendo", concluido: "Concluído" };

// Rate limit simples por usuário (memória da instância)
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

  // Papel via RLS (o próprio usuário lê o próprio profile)
  const pR = await fetch(`${supaUrl}/rest/v1/profiles?id=eq.${user.id}&select=role`, { headers: h });
  const rows = pR.ok ? await pR.json() : [];
  const role = rows?.[0]?.role;
  if (!["vendedor", "gestor", "admin"].includes(role)) return { error: 403, msg: "Acesso restrito à equipe" };

  return { user };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const auth = await authTeamUser(req);
  if (auth.error) return res.status(auth.error).json({ error: auth.msg });
  if (rateLimited(auth.user.id)) return res.status(429).json({ error: "Muitas sincronizações. Aguarde um minuto." });

  const key = process.env.TRELLO_KEY;
  const token = process.env.TRELLO_TOKEN;
  if (!key || !token) {
    return res.status(500).json({ error: "TRELLO_KEY/TRELLO_TOKEN não configurados no Vercel" });
  }
  const qauth = `key=${key}&token=${token}`;
  const api = (path, opts) => fetch(`https://api.trello.com/1${path}${path.includes("?") ? "&" : "?"}${qauth}`, opts);

  const { tarefas } = req.body ?? {};
  if (!Array.isArray(tarefas) || tarefas.length > 200) {
    return res.status(400).json({ error: "Body inválido: esperado { tarefas: [...] }" });
  }

  try {
    // 1) Board "Kuboo CRM" (cria se não existir)
    const boardsR = await api("/members/me/boards?fields=name,url,closed");
    if (!boardsR.ok) return res.status(502).json({ error: "Trello recusou a autenticação — confira TRELLO_KEY/TRELLO_TOKEN" });
    const boards = await boardsR.json();
    let board = boards.find((b) => b.name === "Kuboo CRM" && !b.closed);
    if (!board) {
      const r = await api(`/boards/?name=${encodeURIComponent("Kuboo CRM")}&defaultLists=false`, { method: "POST" });
      board = await r.json();
    }

    // 2) Listas (cria as que faltarem)
    const listsR = await api(`/boards/${board.id}/lists?fields=name`);
    const lists = await listsR.json();
    const listId = {};
    for (const nome of Object.values(LISTAS)) {
      let l = lists.find((x) => x.name === nome);
      if (!l) {
        const r = await api(`/lists?name=${encodeURIComponent(nome)}&idBoard=${board.id}&pos=bottom`, { method: "POST" });
        l = await r.json();
      }
      listId[nome] = l.id;
    }

    // 3) Cards existentes (dedup por título)
    const cardsR = await api(`/boards/${board.id}/cards?fields=name`);
    const existentes = new Set((await cardsR.json()).map((c) => c.name));

    // 4) Cria o que falta
    let created = 0, skipped = 0;
    for (const t of tarefas.slice(0, 100)) {
      const titulo = String(t.titulo || "").trim().slice(0, 200);
      if (!titulo) continue;
      if (existentes.has(titulo)) { skipped++; continue; }
      const lista = listId[LISTAS[t.status] || LISTAS.a_fazer];
      const params = new URLSearchParams({ idList: lista, name: titulo });
      if (t.descricao) params.set("desc", String(t.descricao).slice(0, 2000));
      const r = await api(`/cards?${params.toString()}`, { method: "POST" });
      if (r.ok) { created++; existentes.add(titulo); }
    }

    return res.status(200).json({ created, skipped, boardUrl: board.url });
  } catch (err) {
    console.error(JSON.stringify({ level: "error", fn: "trello", msg: String(err).slice(0, 300) }));
    return res.status(500).json({ error: "Falha ao sincronizar com o Trello" });
  }
}

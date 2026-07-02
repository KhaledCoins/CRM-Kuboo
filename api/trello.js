// Vercel Serverless Function — ponte segura com a API do Trello.
// A chave/token ficam APENAS no servidor (env TRELLO_KEY / TRELLO_TOKEN).
// POST { tarefas: [{ titulo, descricao, status }] }
//  -> garante o board "Kuboo CRM" (listas: A fazer / Fazendo / Concluído)
//  -> cria os cards que ainda não existem (dedup por título)
//  -> retorna { created, skipped, boardUrl }

const LISTAS = { a_fazer: "A fazer", fazendo: "Fazendo", concluido: "Concluído" };

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const key = process.env.TRELLO_KEY;
  const token = process.env.TRELLO_TOKEN;
  if (!key || !token) {
    return res.status(500).json({ error: "TRELLO_KEY/TRELLO_TOKEN não configurados no Vercel" });
  }
  const auth = `key=${key}&token=${token}`;
  const api = (path, opts) => fetch(`https://api.trello.com/1${path}${path.includes("?") ? "&" : "?"}${auth}`, opts);

  const { tarefas } = req.body ?? {};
  if (!Array.isArray(tarefas)) return res.status(400).json({ error: "Body inválido: esperado { tarefas: [...] }" });

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
      const titulo = String(t.titulo || "").trim();
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
    console.error("Trello sync error:", err);
    return res.status(500).json({ error: "Falha ao sincronizar com o Trello" });
  }
}

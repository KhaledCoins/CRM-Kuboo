// Inscrição automática de consultor novo nas filas de distribuição.
//
// POR QUE EXISTE: a auditoria de 8 dimensões provou que fila_usuarios só
// ENCOLHIA. Criar usuário nunca inscrevia em fila nenhuma — o consultor novo
// logava, aparecia em toda a UI como equipe, e nunca recebia um único lead
// automático, em silêncio. Em produção: 7 dos 11 vendedores aprovados estavam
// em ZERO filas (todos criados em 12/08), enquanto os 4 veteranos acumulavam
// 45–176 leads cada. O motor exige a linha: fila_proximo_usuario lê
// exclusivamente de fila_usuarios; não há fallback "todos os aprovados".
//
// REGRA: só role='vendedor' com cargo VENDEDOR entra sozinho, e apenas nas
// filas ativas que não são a de segurança. O cargo CONSULTOR (profiles.nivel)
// é a equipe de SEGUROS: recebe lead por atribuição manual/transferência e fica
// FORA da distribuição automática — o rodízio do bolsão é dos vendedores
// (consórcios). Gestor/admin também NÃO são inscritos automaticamente — receber
// lead é decisão de gestão (Anna e Nathan recebem; Nahed não), então gestor
// entra pela tela de Filas, à mão. Upsert idempotente pela PK (fila_id,
// user_id): reconvidar alguém que já está na fila não duplica nem reseta.
//
// Arquivos em api/ que começam com "_" não viram rota no Vercel.

export async function inscreverNasFilas(admin, userId, role, nivel) {
  if (role !== "vendedor" || !userId) return 0;
  if (nivel === "Consultor") return 0; // seguros: fora do rodízio por definição
  const { data: filas, error: fErr } = await admin
    .from("filas").select("id")
    .eq("ativa", true).eq("is_seguranca", false);
  if (fErr || !filas?.length) {
    if (fErr) console.error(JSON.stringify({ level: "warn", fn: "_filas", msg: `listar filas: ${fErr.message}` }));
    return 0;
  }
  const linhas = filas.map((f) => ({ fila_id: f.id, user_id: userId, ativo: true }));
  const { data, error } = await admin
    .from("fila_usuarios")
    .upsert(linhas, { onConflict: "fila_id,user_id" })
    .select("fila_id");
  if (error) {
    // Não pode derrubar a criação do usuário — a conta já existe; a inscrição
    // dá pra refazer pela tela de Filas. Mas o log precisa gritar.
    console.error(JSON.stringify({ level: "warn", fn: "_filas", msg: `inscrever ${userId}: ${error.message}` }));
    return 0;
  }
  return data?.length ?? 0;
}

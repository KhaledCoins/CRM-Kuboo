import { supabase } from "./supabase";

export interface Tarefa {
  id: string;
  titulo: string;
  descricao?: string | null;
  status: "a_fazer" | "fazendo" | "concluido";
  prioridade?: "baixa" | "media" | "alta" | null;
  responsavel_nome?: string | null;
  cliente_nome?: string | null;
  vencimento?: string | null;
  modulo?: string | null;
  trello_card_id?: string | null; // vínculo idempotente com o card (crm-tarefas-trello.sql)
  created_at?: string;
}

export async function fetchTarefas(): Promise<{ data: Tarefa[]; error: boolean }> {
  if (!supabase) return { data: [], error: false };
  const { data, error } = await supabase.from("tarefas").select("*").order("created_at", { ascending: false }).limit(500);
  return { data: (data as Tarefa[]) || [], error: !!error };
}

export async function criarTarefa(t: Partial<Tarefa>): Promise<{ error: string | null }> {
  if (!supabase) return { error: "Supabase não configurado" };
  const { error } = await supabase.from("tarefas").insert(t);
  return { error: error ? error.message : null };
}

export async function moverTarefa(id: string, status: Tarefa["status"]) {
  if (!supabase) return;
  // propaga o erro pra quem chama poder desfazer o card se a gravação falhar
  const { error } = await supabase.from("tarefas").update({ status }).eq("id", id);
  if (error) throw error;
}

export async function atualizarTarefa(id: string, patch: Partial<Tarefa>): Promise<{ error: string | null }> {
  if (!supabase) return { error: "Supabase não configurado" };
  const { error } = await supabase.from("tarefas").update(patch).eq("id", id);
  return { error: error ? error.message : null };
}

export async function excluirTarefa(id: string) {
  if (!supabase) return;
  await supabase.from("tarefas").delete().eq("id", id);
}

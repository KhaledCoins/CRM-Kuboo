// Domínios da paridade C2S (filas, atividades, etiquetas, observações,
// mensagens prontas, motivos, alertas, bolsão config, log de distribuição).
// Schema: supabase/c2s-parity.sql · Scan de referência: docs/C2S-SCAN.md
import { supabase } from "./supabase";

// ─── Tipos ───────────────────────────────────────────────────────────────────
export interface RegraFila {
  campo: "modulo" | "origem" | "fonte" | "canal" | "campanha" | "produto_interesse" | "urgencia" | "etiqueta" | "score" | "valor_potencial";
  op: "igual" | "contem" | "maior" | "menor";
  valor: string;
}
export interface HorarioDia { ativo: boolean; ini: string; fim: string }
export type HorarioSemana = Partial<Record<"seg" | "ter" | "qua" | "qui" | "sex" | "sab" | "dom", HorarioDia>>;

export interface Fila {
  id: string;
  nome: string;
  ordem: number;
  ativa: boolean;
  is_seguranca: boolean;
  dias_memoria?: number | null;
  limite_abertos?: number | null;
  regras: RegraFila[];
  horario?: HorarioSemana | null;
  created_at?: string;
}
export interface FilaUsuario { fila_id: string; user_id: string; ativo: boolean; ultima_atribuicao?: string | null }

export interface Atividade {
  id: string;
  lead_id: string;
  tipo: "retornar" | "primeiro_contato" | "visita" | "reuniao" | "proposta" | "outro";
  titulo: string;
  quando: string;
  status: "pendente" | "concluida" | "cancelada";
  criado_por?: string | null;
  concluida_em?: string | null;
  created_at?: string;
}
export const TIPOS_ATIVIDADE: { valor: Atividade["tipo"]; rotulo: string }[] = [
  { valor: "retornar", rotulo: "Retornar para o cliente" },
  { valor: "primeiro_contato", rotulo: "Primeiro contato" },
  { valor: "visita", rotulo: "Visita" },
  { valor: "reuniao", rotulo: "Reunião" },
  { valor: "proposta", rotulo: "Enviar proposta" },
  { valor: "outro", rotulo: "Outra atividade" },
];

export interface Etiqueta { id: string; nome: string; cor: string; ativa: boolean }
export interface Observacao { id: string; lead_id: string; texto: string; criado_por?: string | null; created_at: string }
export interface MensagemPronta { id: string; nome: string; conteudo: string; ativa: boolean; ordem: number }
export interface MotivoArquivamento { id: string; nome: string; ativo: boolean }
export interface AlertaConfig { id: string; minutos: number; notificar: "usuario" | "gestores"; ativo: boolean }
export interface BolsaoConfig { id: 1; ativo: boolean; limite_minutos: number; escopo: "empresa" | "equipe"; horario?: HorarioSemana | null }
export interface DistribuicaoLog { id: string; lead_id: string; fila_id?: string | null; user_id?: string | null; motivo: string; created_at: string }

// ─── Helpers genéricos (todas as tabelas têm RLS is_team FOR ALL) ────────────
const err = (ctx: string, e: { message: string } | null) => { if (e) console.error(`[c2s] ${ctx}:`, e.message); return !e; };

export async function listar<T>(tabela: string, ordem = "created_at"): Promise<T[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from(tabela).select("*").order(ordem, { ascending: true });
  err(`listar ${tabela}`, error);
  return (data as T[]) ?? [];
}
export async function inserir(tabela: string, row: Record<string, unknown>): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase.from(tabela).insert(row);
  return err(`inserir ${tabela}`, error);
}
export async function atualizar(tabela: string, id: string | number, patch: Record<string, unknown>): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase.from(tabela).update(patch).eq("id", id);
  return err(`atualizar ${tabela}`, error);
}
export async function excluir(tabela: string, id: string): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase.from(tabela).delete().eq("id", id);
  return err(`excluir ${tabela}`, error);
}

// ─── Atividades ──────────────────────────────────────────────────────────────
export async function atividadesDoLead(leadId: string): Promise<Atividade[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from("lead_atividades").select("*").eq("lead_id", leadId).order("quando");
  err("atividadesDoLead", error);
  return (data as Atividade[]) ?? [];
}
/** Atividade ATUAL = pendente mais próxima (atrasada primeiro). */
export function atividadeAtual(list: Atividade[]): Atividade | null {
  const pend = list.filter((a) => a.status === "pendente").sort((a, b) => a.quando.localeCompare(b.quando));
  return pend[0] ?? null;
}
export const atividadeAtrasada = (a: Atividade) => a.status === "pendente" && new Date(a.quando).getTime() < Date.now();

export async function concluirAtividade(id: string): Promise<boolean> {
  return atualizar("lead_atividades", id, { status: "concluida", concluida_em: new Date().toISOString() });
}

// ─── Observações / Etiquetas do lead ────────────────────────────────────────
export async function observacoesDoLead(leadId: string): Promise<Observacao[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from("lead_observacoes").select("*").eq("lead_id", leadId).order("created_at", { ascending: false });
  err("observacoesDoLead", error);
  return (data as Observacao[]) ?? [];
}
export async function etiquetasDoLead(leadId: string): Promise<Etiqueta[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from("lead_etiquetas").select("etiqueta_id, etiquetas(*)").eq("lead_id", leadId);
  err("etiquetasDoLead", error);
  return ((data as any[]) ?? []).map((r) => r.etiquetas).filter(Boolean);
}
export async function alternarEtiqueta(leadId: string, etiquetaId: string, tem: boolean): Promise<boolean> {
  if (!supabase) return false;
  if (tem) {
    const { error } = await supabase.from("lead_etiquetas").delete().eq("lead_id", leadId).eq("etiqueta_id", etiquetaId);
    return err("removerEtiqueta", error);
  }
  const { error } = await supabase.from("lead_etiquetas").insert({ lead_id: leadId, etiqueta_id: etiquetaId });
  return err("adicionarEtiqueta", error);
}

// ─── Favoritos ───────────────────────────────────────────────────────────────
export async function favoritosDoUsuario(userId: string): Promise<Set<string>> {
  if (!supabase) return new Set();
  const { data, error } = await supabase.from("lead_favoritos").select("lead_id").eq("user_id", userId);
  err("favoritos", error);
  return new Set(((data as any[]) ?? []).map((r) => r.lead_id));
}
export async function alternarFavorito(userId: string, leadId: string, fav: boolean): Promise<boolean> {
  if (!supabase) return false;
  if (fav) {
    const { error } = await supabase.from("lead_favoritos").delete().eq("user_id", userId).eq("lead_id", leadId);
    return err("desfavoritar", error);
  }
  const { error } = await supabase.from("lead_favoritos").insert({ user_id: userId, lead_id: leadId });
  return err("favoritar", error);
}

// ─── Log de distribuição ("Por que recebi este lead?") ──────────────────────
export async function logDoLead(leadId: string): Promise<DistribuicaoLog[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from("distribuicao_log").select("*").eq("lead_id", leadId).order("created_at", { ascending: false });
  err("logDoLead", error);
  return (data as DistribuicaoLog[]) ?? [];
}

// ─── Mensagens prontas: substituição de variáveis ───────────────────────────
export function renderTemplate(
  conteudo: string,
  ctx: { nomeContato?: string | null; nomeVendedor?: string | null; telefoneVendedor?: string | null; assinatura?: string | null; produto?: string | null; campanha?: string | null; nomeAtividade?: string | null; dataAtividade?: string | null }
): string {
  const primeiro = (ctx.nomeContato || "").trim().split(/\s+/)[0] || "";
  const rep = (s: string, de: string, para: string) => s.split(de).join(para);
  let out = conteudo;
  out = rep(out, "[NOME_CONTATO]", primeiro || "cliente");
  out = rep(out, "[NOME_VENDEDOR]", ctx.nomeVendedor || "");
  out = rep(out, "[TELEFONE_VENDEDOR]", ctx.telefoneVendedor || "");
  out = rep(out, "[ASSINATURA]", ctx.assinatura || "");
  out = rep(out, "[PRODUTO]", ctx.produto || "");
  out = rep(out, "[CAMPANHA]", ctx.campanha || "");
  out = rep(out, "[NOME_ATIVIDADE]", ctx.nomeAtividade || "");
  out = rep(out, "[DATA_ATIVIDADE]", ctx.dataAtividade || "");
  return out;
}
export const VARIAVEIS_TEMPLATE = [
  "[NOME_CONTATO]", "[NOME_VENDEDOR]", "[TELEFONE_VENDEDOR]", "[ASSINATURA]",
  "[PRODUTO]", "[CAMPANHA]", "[NOME_ATIVIDADE]", "[DATA_ATIVIDADE]",
] as const;

// ─── Listagem com status de erro (telas de config precisam saber se a
// migration supabase/c2s-parity.sql ainda não rodou, pra mostrar o aviso) ────
export async function listarComStatus<T>(tabela: string, ordem = "created_at", ascending = true): Promise<{ data: T[]; erro: boolean }> {
  if (!supabase) return { data: [], erro: false };
  const { data, error } = await supabase.from(tabela).select("*").order(ordem, { ascending });
  if (error) { console.error(`[c2s] listar ${tabela}:`, error.message); return { data: [], erro: true }; }
  return { data: (data as T[]) ?? [], erro: false };
}

// ─── Horário semanal (usado por Filas e pelo Bolsão) ────────────────────────
export const DIAS_SEMANA: { chave: keyof HorarioSemana; rotulo: string; curto: string }[] = [
  { chave: "seg", rotulo: "Segunda", curto: "Seg" },
  { chave: "ter", rotulo: "Terça", curto: "Ter" },
  { chave: "qua", rotulo: "Quarta", curto: "Qua" },
  { chave: "qui", rotulo: "Quinta", curto: "Qui" },
  { chave: "sex", rotulo: "Sexta", curto: "Sex" },
  { chave: "sab", rotulo: "Sábado", curto: "Sab" },
  { chave: "dom", rotulo: "Domingo", curto: "Dom" },
];
export const horaVazia = (): HorarioDia => ({ ativo: false, ini: "08:00", fim: "18:00" });
export function horarioPadrao(): HorarioSemana {
  const h: HorarioSemana = {};
  for (const d of DIAS_SEMANA) h[d.chave] = horaVazia();
  return h;
}
export function horarioResumo(h?: HorarioSemana | null): string {
  if (!h) return "Sempre ativa (sem restrição de horário)";
  const ativos = DIAS_SEMANA.filter((d) => h[d.chave]?.ativo);
  if (!ativos.length) return "Sempre ativa (sem restrição de horário)";
  return ativos.map((d) => `${d.curto} ${h[d.chave]!.ini}–${h[d.chave]!.fim}`).join(" · ");
}

// ─── Filas de distribuição — regras (builder de condições) ──────────────────
export const CAMPO_OPCOES: { valor: RegraFila["campo"]; rotulo: string }[] = [
  { valor: "modulo", rotulo: "Módulo" },
  { valor: "origem", rotulo: "Origem" },
  { valor: "fonte", rotulo: "Fonte" },
  { valor: "canal", rotulo: "Canal" },
  { valor: "campanha", rotulo: "Campanha" },
  { valor: "produto_interesse", rotulo: "Produto de interesse" },
  { valor: "urgencia", rotulo: "Urgência" },
  { valor: "etiqueta", rotulo: "Etiqueta" },
  { valor: "score", rotulo: "Score" },
  { valor: "valor_potencial", rotulo: "Valor potencial" },
];
export const OP_ROTULOS: Record<RegraFila["op"], string> = {
  igual: "É igual a", contem: "Contém", maior: "Maior que", menor: "Menor que",
};
export function opsPermitidas(campo: RegraFila["campo"]): RegraFila["op"][] {
  if (campo === "score" || campo === "valor_potencial") return ["maior", "menor", "igual"];
  if (campo === "etiqueta") return ["igual"];
  return ["igual", "contem"];
}
export function rotuloCampo(campo: string): string {
  return CAMPO_OPCOES.find((c) => c.valor === campo)?.rotulo ?? campo;
}
export function regraFraseResumo(r: RegraFila): string {
  const op = OP_ROTULOS[r.op]?.toLowerCase() ?? r.op;
  return `${rotuloCampo(r.campo)} ${op} "${r.valor}"`;
}
export function regrasResumoFila(f: { regras: RegraFila[]; dias_memoria?: number | null }): string[] {
  const linhas: string[] = [];
  if (f.dias_memoria) linhas.push(`Dias de memória: ${f.dias_memoria} dia${f.dias_memoria > 1 ? "s" : ""}`);
  if (!f.regras || f.regras.length === 0) linhas.push("sem condições — pega qualquer lead");
  else linhas.push(...f.regras.map(regraFraseResumo));
  return linhas;
}

// ─── Filas de distribuição — CRUD e ordenação ────────────────────────────────
export async function listarFilas(): Promise<{ data: Fila[]; erro: boolean }> {
  return listarComStatus<Fila>("filas", "ordem", true);
}
export async function listarTodosFilaUsuarios(): Promise<FilaUsuario[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from("fila_usuarios").select("*");
  err("listarTodosFilaUsuarios", error);
  return (data as FilaUsuario[]) ?? [];
}
export async function listarEquipe(): Promise<{ id: string; name: string; role: string | null }[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from("profiles").select("id, name, role")
    .in("role", ["vendedor", "gestor", "admin"]).order("name");
  err("listarEquipe", error);
  return (data as { id: string; name: string; role: string | null }[]) ?? [];
}
export async function salvarFila(fila: Partial<Fila> & { id?: string }): Promise<string | null> {
  if (!supabase) return null;
  const payload = {
    nome: fila.nome, ordem: fila.ordem, ativa: fila.ativa, is_seguranca: fila.is_seguranca ?? false,
    dias_memoria: fila.dias_memoria ?? null, limite_abertos: fila.limite_abertos ?? null,
    regras: fila.regras ?? [], horario: fila.horario ?? null,
  };
  if (fila.id) {
    const { error } = await supabase.from("filas").update(payload).eq("id", fila.id);
    if (error) { console.error("[c2s] salvarFila:", error.message); return null; }
    return fila.id;
  }
  const { data, error } = await supabase.from("filas").insert(payload).select("id").single();
  if (error) { console.error("[c2s] salvarFila:", error.message); return null; }
  return (data as { id: string } | null)?.id ?? null;
}
export async function trocarOrdemFilas(a: { id: string; ordem: number }, b: { id: string; ordem: number }): Promise<boolean> {
  if (!supabase) return false;
  const [r1, r2] = await Promise.all([
    supabase.from("filas").update({ ordem: b.ordem }).eq("id", a.id),
    supabase.from("filas").update({ ordem: a.ordem }).eq("id", b.id),
  ]);
  return !r1.error && !r2.error;
}
// Grava o estado (ativo/inativo) de todos os membros da equipe na fila de uma vez —
// upsert só toca a coluna `ativo`, preservando `ultima_atribuicao` já gravada pelo motor.
export async function sincronizarFilaUsuarios(filaId: string, ativosUserIds: Set<string>, todosUserIds: string[]): Promise<boolean> {
  if (!supabase || !todosUserIds.length) return true;
  const rows = todosUserIds.map((user_id) => ({ fila_id: filaId, user_id, ativo: ativosUserIds.has(user_id) }));
  const { error } = await supabase.from("fila_usuarios").upsert(rows, { onConflict: "fila_id,user_id" });
  if (error) { console.error("[c2s] sincronizarFilaUsuarios:", error.message); return false; }
  return true;
}

// ─── Bolsão — config (linha única id=1) ──────────────────────────────────────
export async function buscarBolsaoConfig(): Promise<{ data: BolsaoConfig | null; erro: boolean }> {
  if (!supabase) return { data: null, erro: false };
  const { data, error } = await supabase.from("bolsao_config").select("*").eq("id", 1).maybeSingle();
  if (error) { console.error("[c2s] buscarBolsaoConfig:", error.message); return { data: null, erro: true }; }
  return { data: (data as BolsaoConfig) ?? null, erro: false };
}
export async function salvarBolsaoConfig(patch: Partial<BolsaoConfig>): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase.from("bolsao_config").upsert({ id: 1, ...patch });
  return err("salvarBolsaoConfig", error);
}

// ─── Alertas — rótulo legível de minutos ("30 min" / "1h" / "1 dia") ────────
export function minutosLabel(min: number): string {
  if (min < 60) return `${min} min`;
  if (min % 1440 === 0) { const d = min / 1440; return `${d} dia${d > 1 ? "s" : ""}`; }
  if (min % 60 === 0) { const h = min / 60; return `${h}h`; }
  return `${Math.floor(min / 60)}h${min % 60}min`;
}

// ─── Etiquetas — paleta de cores prontas ─────────────────────────────────────
export const CORES_ETIQUETA = ["#1873BA", "#36ABE2", "#22C55E", "#F59E0B", "#EF4444", "#8B5CF6", "#EC4899", "#64748B"];

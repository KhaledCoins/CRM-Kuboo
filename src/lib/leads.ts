import { supabase } from "./supabase";
import { buscarBolsaoConfig, type BolsaoConfig } from "./c2s";

export interface Lead {
  id: string;
  nome: string;
  telefone?: string | null;
  email?: string | null;
  produto_interesse?: string | null;
  mensagem?: string | null;
  origem?: string | null;
  modulo?: string | null;
  etapa?: string | null;
  status?: string | null;
  vendedor_id?: string | null;
  valor_potencial?: number | null;
  proxima_acao?: string | null;
  atribuido_em?: string | null;
  sla_expira_em?: string | null;
  primeiro_contato_em?: string | null;
  interagido_em?: string | null;
  score?: number | null;
  urgencia?: string | null;
  descartado?: boolean | null;
  motivo_descarte?: string | null;
  created_at?: string;
}

// ─── bolsao_config — cache simples em módulo (TTL curto) ─────────────────────
// pegarLead() precisa do limite_minutos em quase toda ação; sem cache isso
// vira 1 SELECT extra por clique. TTL de 60s: rápido o bastante pra refletir
// mudança de config, barato o bastante pra não martelar o Supabase.
const BOLSAO_CFG_TTL_MS = 60_000;
const BOLSAO_CFG_FALLBACK = 20; // mesmo default da coluna bolsao_config.limite_minutos
let bolsaoCfgCache: { data: BolsaoConfig | null; em: number } | null = null;

/** Config do bolsão (cacheada ~60s) — outras telas podem chamar à vontade. */
export async function getBolsaoConfig(): Promise<BolsaoConfig | null> {
  const agora = Date.now();
  if (bolsaoCfgCache && agora - bolsaoCfgCache.em < BOLSAO_CFG_TTL_MS) return bolsaoCfgCache.data;
  const { data, erro } = await buscarBolsaoConfig();
  if (erro) return bolsaoCfgCache?.data ?? null; // falhou: mantém o cache antigo em vez de derrubar quem chamou
  bolsaoCfgCache = { data, em: agora };
  return data;
}

/** Minutos de SLA do 1º contato — mesmo valor que o trigger de distribuição
 *  usa (bolsao_config.limite_minutos). Fallback 20 min se a config não
 *  carregar (rede fora, migration não rodada etc.) — nunca trava a UI. */
export async function limiteSlaMinutos(): Promise<number> {
  const cfg = await getBolsaoConfig();
  return cfg?.limite_minutos ?? BOLSAO_CFG_FALLBACK;
}

// ─── Priorização de leads (best practice: score + tempo de espera) ────────────
export type Temperatura = "quente" | "morno" | "frio";

// Temperatura pela qualificação (score que o site já calcula: cotação 85, contato 60…)
export function temperaturaLead(l: Lead): Temperatura {
  const s = l.score ?? 55;
  return s >= 78 ? "quente" : s >= 50 ? "morno" : "frio";
}

// Minutos esperando (desde a criação — quanto mais tempo, mais risco de esfriar)
export function minEsperando(l: Lead): number {
  const base = l.created_at ? new Date(l.created_at).getTime() : Date.now();
  return Math.max(0, Math.floor((Date.now() - base) / 60000));
}

// Prioridade de atendimento: combina qualificação (score) com urgência (espera).
// Maior = atender primeiro. Lead quente recente supera lead frio antigo, mas
// leads velhos sobem para não esfriarem/estourarem SLA.
export function prioridadeLead(l: Lead): number {
  const score = l.score ?? 55;
  const espera = Math.min(minEsperando(l), 240); // teto de 4h
  const bonusUrg = l.urgencia === "urgente" ? 25 : l.urgencia === "hoje" ? 12 : 0;
  return score + espera * 0.5 + bonusUrg;
}

/** Lead está no bolsão? (sem dono OU sem 1º contato e SLA estourado) */
export function noBolsao(l: Lead): boolean {
  if (!l.vendedor_id) return true;
  if (!l.primeiro_contato_em && l.sla_expira_em && new Date(l.sla_expira_em).getTime() < Date.now()) return true;
  return false;
}

/** Minutos restantes do SLA (negativo = estourado, null = já contatado/sem sla) */
export function slaRestanteMin(l: Lead): number | null {
  if (l.primeiro_contato_em || !l.sla_expira_em) return null;
  return Math.round((new Date(l.sla_expira_em).getTime() - Date.now()) / 60000);
}

export function moduloDe(l: Lead): "seguros" | "consorcios" {
  return l.modulo === "consorcios" ? "consorcios" : "seguros";
}

// Descartados ficam FORA por padrão (alivia o teto da query — pós-importação dos
// 754 do C2S a base cresce ~130/mês). Quem precisa deles (aba Arquivados do
// MeusLeads) pede explicitamente. Limite alto + warning quando estourar, pra
// nunca truncar a base em silêncio.
const FETCH_LIMIT = 3000;
export async function fetchLeads(opts?: { incluirDescartados?: boolean }): Promise<Lead[]> {
  if (!supabase) return [];
  let q = supabase.from("leads").select("*").order("created_at", { ascending: false }).limit(FETCH_LIMIT);
  if (!opts?.incluirDescartados) q = q.eq("descartado", false);
  const { data, error } = await q;
  if (error) console.error("[leads] fetchLeads:", error.message); // não engole em silêncio
  if (data && data.length === FETCH_LIMIT) console.warn(`[leads] fetchLeads atingiu o teto de ${FETCH_LIMIT} — leads mais antigos fora da lista; hora de paginar.`);
  return (data as any) ?? [];
}

// Retorna true se pegou; false se outro vendedor pegou primeiro.
// Proteção de corrida: o update só aplica se o lead ainda estiver "no bolsão"
// (sem dono OU com SLA estourado sem primeiro contato) — mesma regra de noBolsao().
export async function pegarLead(id: string, vendedorId: string): Promise<boolean> {
  if (!supabase) return false;
  const now = new Date().toISOString();
  const minutos = await limiteSlaMinutos();
  const sla = new Date(Date.now() + minutos * 60000).toISOString();
  const { data } = await supabase.from("leads").update({
    vendedor_id: vendedorId,
    atribuido_em: now,
    sla_expira_em: sla,
    primeiro_contato_em: null,
  }).eq("id", id)
    .or(`vendedor_id.is.null,and(primeiro_contato_em.is.null,sla_expira_em.lt.${now})`)
    .select("id");
  return !!(data && data.length);
}

export async function registrarContato(id: string) {
  if (!supabase) return;
  const now = new Date().toISOString();
  // interagido_em também: a regra de retorno de 16 dias e os alertas de
  // inatividade dependem desse campo (LeadDetalhe já seta nas ações dele).
  await supabase.from("leads").update({ primeiro_contato_em: now, interagido_em: now }).eq("id", id);
}

export async function devolverBolsao(id: string) {
  if (!supabase) return;
  await supabase.from("leads").update({ vendedor_id: null, atribuido_em: null, sla_expira_em: null }).eq("id", id);
}

export async function moverEtapa(id: string, etapa: string) {
  if (!supabase) return;
  // interagido_em junto: mover de coluna é interação — mesma regra do registrarContato.
  // propaga o erro pra quem chama (Pipeline usa try/catch p/ desfazer o card se falhar)
  const { error } = await supabase.from("leads").update({ etapa, interagido_em: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}

/** Descarta um lead do bolsão (soft-delete: não some do banco, só sai da fila).
 *  Requer a migration crm-leads-manage.sql (coluna descartado + policy da equipe). */
export async function descartarLead(id: string, motivo: string): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase.from("leads")
    .update({ descartado: true, motivo_descarte: motivo || "descartado pela equipe" })
    .eq("id", id);
  return !error;
}

/** Distribuição automática (rodízio): gestor/admin reparte os leads do bolsão
 *  entre os vendedores, na ordem de prioridade. COMPLEMENTA o "pegar lead"
 *  manual — cada atribuição usa a mesma proteção de corrida do pegarLead,
 *  então leads pegos no meio do rodízio são simplesmente pulados. */
export async function distribuirBolsao(leads: Lead[], vendedorIds: string[]): Promise<{ distribuidos: number; pulados: number }> {
  if (!supabase || !vendedorIds.length) return { distribuidos: 0, pulados: leads.length };
  const ordenados = [...leads].sort((a, b) => prioridadeLead(b) - prioridadeLead(a));
  let distribuidos = 0, pulados = 0, i = 0;
  for (const l of ordenados) {
    const ok = await pegarLead(l.id, vendedorIds[i % vendedorIds.length]);
    if (ok) { distribuidos++; i++; } else pulados++;
  }
  return { distribuidos, pulados };
}

import { supabase } from "./supabase";

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
  score?: number | null;
  urgencia?: string | null;
  created_at?: string;
}

export const SLA_MINUTOS = 15;

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

export async function fetchLeads(): Promise<Lead[]> {
  if (!supabase) return [];
  const { data } = await supabase.from("leads").select("*").order("created_at", { ascending: false }).limit(1000);
  return (data as any) ?? [];
}

// Retorna true se pegou; false se outro vendedor pegou primeiro.
// Proteção de corrida: o update só aplica se o lead ainda estiver "no bolsão"
// (sem dono OU com SLA estourado sem primeiro contato) — mesma regra de noBolsao().
export async function pegarLead(id: string, vendedorId: string): Promise<boolean> {
  if (!supabase) return false;
  const now = new Date().toISOString();
  const sla = new Date(Date.now() + SLA_MINUTOS * 60000).toISOString();
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
  await supabase.from("leads").update({ primeiro_contato_em: new Date().toISOString() }).eq("id", id);
}

export async function devolverBolsao(id: string) {
  if (!supabase) return;
  await supabase.from("leads").update({ vendedor_id: null, atribuido_em: null, sla_expira_em: null }).eq("id", id);
}

export async function moverEtapa(id: string, etapa: string) {
  if (!supabase) return;
  await supabase.from("leads").update({ etapa }).eq("id", id);
}

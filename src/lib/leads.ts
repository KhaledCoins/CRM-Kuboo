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
  created_at?: string;
}

export const SLA_MINUTOS = 15;

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

export async function pegarLead(id: string, vendedorId: string) {
  if (!supabase) return;
  const sla = new Date(Date.now() + SLA_MINUTOS * 60000).toISOString();
  await supabase.from("leads").update({
    vendedor_id: vendedorId,
    atribuido_em: new Date().toISOString(),
    sla_expira_em: sla,
    primeiro_contato_em: null,
  }).eq("id", id);
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

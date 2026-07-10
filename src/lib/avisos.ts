import { supabase } from "./supabase";
import { slaRestanteMin, type Lead } from "./leads";

// Central de avisos da equipe — computada no cliente a partir dos dados
// (sem cron/tabela nova): SLA estourando, renovações da semana.
export interface Aviso {
  id: string;
  tone: "red" | "amber" | "blue";
  titulo: string;
  detalhe: string;
  to: string; // rota pra resolver
}

export async function fetchAvisos(modulo: "seguros" | "consorcios"): Promise<Aviso[]> {
  if (!supabase) return [];
  const seguros = modulo === "seguros"; // renovações (vendas/apólices) só existem no módulo seguros
  try {
    const avisos: Aviso[] = [];
    const em7d = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    const hoje = new Date().toISOString().slice(0, 10);

    // Leads DO módulo atual (seguros inclui os legados com modulo nulo). `modulo` é
    // literal ('seguros'|'consorcios'), não entrada do usuário → .or() seguro.
    let leadsQ = supabase.from("leads")
      .select("id,nome,vendedor_id,sla_expira_em,primeiro_contato_em,etapa,modulo")
      .not("vendedor_id", "is", null).is("primeiro_contato_em", null).not("sla_expira_em", "is", null).limit(200);
    leadsQ = seguros ? leadsQ.or("modulo.eq.seguros,modulo.is.null") : leadsQ.eq("modulo", "consorcios");

    const [leadsR, vendasR, apolR] = await Promise.all([
      leadsQ,
      // Só busca renovações no módulo seguros (evita avisos que apontam p/ /consorcios/renovacoes, rota inexistente).
      seguros ? supabase.from("vendas").select("id,cliente_nome,vigencia_fim").not("vigencia_fim", "is", null).neq("status", "cancelada").gte("vigencia_fim", hoje).lte("vigencia_fim", em7d).limit(50) : Promise.resolve({ data: [] as any[] }),
      seguros ? supabase.from("apolices").select("id,tipo,vigencia_fim,profiles(name)").not("vigencia_fim", "is", null).neq("status", "cancelada").gte("vigencia_fim", hoje).lte("vigencia_fim", em7d).limit(50) : Promise.resolve({ data: [] as any[] }),
    ]);

    // SLA de 1º contato: estourando (≤10min) ou estourado
    for (const l of (leadsR.data || []) as Lead[]) {
      const min = slaRestanteMin(l);
      if (min == null) continue;
      if (min < 0) avisos.push({ id: `sla-${l.id}`, tone: "red", titulo: `SLA estourado — ${l.nome}`, detalhe: `1º contato atrasado ${Math.abs(min)} min · lead voltou pro bolsão`, to: `/${modulo}/bolsao` });
      else if (min <= 10) avisos.push({ id: `sla-${l.id}`, tone: "amber", titulo: `SLA em ${min} min — ${l.nome}`, detalhe: "Registre o 1º contato antes de estourar", to: `/${modulo}/pipeline` });
    }

    // Renovações da semana (vendas do CRM + carteira de apólices) — só no módulo seguros
    for (const v of vendasR.data || []) {
      avisos.push({ id: `rv-${v.id}`, tone: "amber", titulo: `Renovação em breve — ${v.cliente_nome || "cliente"}`, detalhe: `Venda vence em ${new Date(v.vigencia_fim + "T12:00:00").toLocaleDateString("pt-BR")}`, to: `/${modulo}/renovacoes` });
    }
    for (const a of (apolR.data || []) as any[]) {
      avisos.push({ id: `ra-${a.id}`, tone: "blue", titulo: `Apólice ${a.tipo || ""} vence esta semana`, detalhe: `${a.profiles?.name || "Cliente"} · ${new Date(a.vigencia_fim + "T12:00:00").toLocaleDateString("pt-BR")}`, to: `/${modulo}/renovacoes` });
    }

    return avisos.slice(0, 20);
  } catch (e) {
    console.error("[avisos] fetchAvisos:", e);
    return [];
  }
}

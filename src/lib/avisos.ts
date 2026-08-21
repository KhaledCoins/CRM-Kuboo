import { supabase } from "./supabase";
import { slaRestanteMin, type Lead } from "./leads";
import { minutosLabel, type AlertaConfig } from "./c2s";

// Central de avisos da equipe — computada no cliente a partir dos dados
// (sem cron/tabela nova): SLA estourando, renovações da semana, escada de
// sem-atendimento do C2S (alertas_config — docs/C2S-SCAN.md §Alertas).
export interface Aviso {
  id: string;
  tone: "red" | "amber" | "blue";
  titulo: string;
  detalhe: string;
  to: string; // rota pra resolver
}

// Máx. de avisos que a escada de sem-atendimento injeta (não pode lotar o sino).
const LIMITE_ESCADA = 15;

export async function fetchAvisos(modulo: "seguros" | "consorcios"): Promise<Aviso[]> {
  if (!supabase) return [];
  const seguros = modulo === "seguros"; // renovações (vendas/apólices) só existem no módulo seguros
  try {
    const avisos: Aviso[] = [];
    const em7d = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    const hoje = new Date().toISOString().slice(0, 10);
    // uid uma vez só — usado pelo aviso de "lead novo" (só o dono vê) e pela
    // escada de sem-atendimento lá embaixo.
    const { data: userData } = await supabase.auth.getUser();
    const uid = userData?.user?.id ?? null;

    // Sinistros triados pelo Kubinho — prioridade MÁXIMA, sempre no TOPO da
    // lista (na frente de SLA/renovações). Só existe no módulo seguros.
    // Tabela nova/opcional (supabase/sinistros-triagem.sql) — se ainda não
    // rodou, segue em silêncio (igual à escada de sem-atendimento).
    if (seguros) {
      try {
        const { data: sinistrosData } = await supabase
          .from("sinistros_chamados")
          .select("id,nome,tipo,resumo,created_at")
          .eq("status", "novo")
          .order("created_at", { ascending: false })
          .limit(10);
        for (const s of (sinistrosData as { id: string; nome: string; tipo: string | null; resumo: string | null; created_at: string }[]) ?? []) {
          const min = Math.max(0, Math.floor((Date.now() - new Date(s.created_at).getTime()) / 60000));
          avisos.push({
            id: `sinistro-${s.id}`,
            tone: "red",
            titulo: `SINISTRO: ${s.nome} — ${s.tipo || "sem tipo"}`,
            detalhe: `${s.resumo || "Sem resumo"} · recebido há ${minutosLabel(min)}`,
            to: "/seguros/sinistros",
          });
        }
      } catch (e) {
        console.error("[avisos] sinistros:", e);
      }
    }

    // Leads DO módulo atual (seguros inclui os legados com modulo nulo). `modulo` é
    // literal ('seguros'|'consorcios'), não entrada do usuário → .or() seguro.
    let leadsQ = supabase.from("leads")
      .select("id,nome,vendedor_id,sla_expira_em,primeiro_contato_em,etapa,modulo")
      .not("vendedor_id", "is", null).is("primeiro_contato_em", null).not("sla_expira_em", "is", null)
      // Arquivado não tem SLA correndo — sem isto o sino cobrava eternamente o
      // atendimento de lead que a equipe já descartou (a consulta irmã, logo
      // abaixo, sempre filtrou; esta tinha ficado de fora).
      .eq("descartado", false).limit(200);
    leadsQ = seguros ? leadsQ.or("modulo.eq.seguros,modulo.is.null") : leadsQ.eq("modulo", "consorcios");

    const [leadsR, vendasR, apolR] = await Promise.all([
      leadsQ,
      // Só busca renovações no módulo seguros (evita avisos que apontam p/ /consorcios/renovacoes, rota inexistente).
      seguros ? supabase.from("vendas").select("id,cliente_nome,vigencia_fim").not("vigencia_fim", "is", null).neq("status", "cancelada").gte("vigencia_fim", hoje).lte("vigencia_fim", em7d).limit(50) : Promise.resolve({ data: [] as any[] }),
      seguros ? supabase.from("apolices").select("id,tipo,vigencia_fim,profiles(name)").not("vigencia_fim", "is", null).neq("status", "cancelada").gte("vigencia_fim", hoje).lte("vigencia_fim", em7d).limit(50) : Promise.resolve({ data: [] as any[] }),
    ]);

    // SLA de 1º contato: estourando (≤10min) ou estourado. E o aviso que
    // faltava: LEAD NOVO — antes, o dono só ficava sabendo do lead quando o
    // SLA já tinha queimado metade (primeiro sinal aos 10min restantes).
    // Agora o sino avisa no primeiro poll depois da atribuição.
    for (const l of (leadsR.data || []) as Lead[]) {
      const min = slaRestanteMin(l);
      if (min == null) continue;
      if (min < 0) avisos.push({ id: `sla-${l.id}`, tone: "red", titulo: `SLA estourado — ${l.nome}`, detalhe: `1º contato atrasado ${Math.abs(min)} min · lead voltou pro bolsão`, to: `/${modulo}/bolsao` });
      else if (min <= 10) avisos.push({ id: `sla-${l.id}`, tone: "amber", titulo: `SLA em ${min} min — ${l.nome}`, detalhe: "Registre o 1º contato antes de estourar", to: `/${modulo}/pipeline` });
      else if (l.vendedor_id === uid) avisos.push({ id: `novo-${l.id}`, tone: "blue", titulo: `Lead novo — ${l.nome}`, detalhe: `distribuído pra você · 1º contato em até ${min} min`, to: `/${modulo}/leads/${l.id}` });
    }

    // Renovações da semana (vendas do CRM + carteira de apólices) — só no módulo seguros
    for (const v of vendasR.data || []) {
      avisos.push({ id: `rv-${v.id}`, tone: "amber", titulo: `Renovação em breve — ${v.cliente_nome || "cliente"}`, detalhe: `Venda vence em ${new Date(v.vigencia_fim + "T12:00:00").toLocaleDateString("pt-BR")}`, to: `/${modulo}/renovacoes` });
    }
    for (const a of (apolR.data || []) as any[]) {
      avisos.push({ id: `ra-${a.id}`, tone: "blue", titulo: `Apólice ${a.tipo || ""} vence esta semana`, detalhe: `${a.profiles?.name || "Cliente"} · ${new Date(a.vigencia_fim + "T12:00:00").toLocaleDateString("pt-BR")}`, to: `/${modulo}/renovacoes` });
    }

    // Escada de sem-atendimento do C2S (supabase/c2s-parity.sql §9 alertas_config).
    // Tabela nova/opcional — se a migration ainda não rodou, segue em silêncio.
    try {
      const { data: alertasData } = await supabase.from("alertas_config").select("*").eq("ativo", true);
      const alertas = (alertasData as AlertaConfig[]) ?? [];
      if (alertas.length) {
        if (uid) {
          const { data: perfil } = await supabase.from("profiles").select("role").eq("id", uid).maybeSingle();
          const isManager = ["gestor", "admin"].includes((perfil as any)?.role ?? "");
          const maxDegrau = Math.max(0, ...alertas.map((a) => a.minutos));

          // profiles PRECISA do vínculo explícito: lead_atividades, lead_observacoes
          // e lead_favoritos também apontam para profiles, então "profiles(name)"
          // fica ambíguo e o PostgREST devolve 300/PGRST201 — a consulta falhava
          // calada e o sino dizia "tudo em dia" mesmo com SLA estourando.
          let semAtQ = supabase.from("leads")
            .select("id,nome,vendedor_id,created_at,atribuido_em,modulo,profiles!leads_vendedor_id_fkey(name)")
            .not("vendedor_id", "is", null).is("primeiro_contato_em", null).is("interagido_em", null)
            .eq("descartado", false).limit(300);
          semAtQ = seguros ? semAtQ.or("modulo.eq.seguros,modulo.is.null") : semAtQ.eq("modulo", "consorcios");
          const { data: semAtendimento } = await semAtQ;

          for (const l of (semAtendimento as any[]) ?? []) {
            // A régua é do RECEBIMENTO pelo consultor (igual C2S) — lead que
            // passou horas no bolsão não pode nascer "sem atendimento há 6h"
            // pra quem acabou de pegar.
            const base = l.atribuido_em && new Date(l.atribuido_em) > new Date(l.created_at) ? l.atribuido_em : l.created_at;
            const minSemAt = Math.floor((Date.now() - new Date(base).getTime()) / 60000);
            // Dedup: só o degrau mais alto estourado que se aplica a ESTE usuário
            // (regra de destinatário igual ao C2S: 'usuario' só se dono do lead;
            // 'gestores' só se o usuário logado é gestor/admin).
            let melhor: AlertaConfig | null = null;
            for (const al of alertas) {
              if (minSemAt < al.minutos) continue;
              if (al.notificar === "usuario" && l.vendedor_id !== uid) continue;
              if (al.notificar === "gestores" && !isManager) continue;
              if (!melhor || al.minutos > melhor.minutos) melhor = al;
            }
            if (!melhor) continue;
            avisos.push({
              id: `semat-${l.id}`,
              tone: melhor.minutos >= maxDegrau ? "red" : "amber",
              titulo: `Lead ${l.nome} sem atendimento há ${minutosLabel(minSemAt)}`,
              detalhe: `alerta de ${minutosLabel(melhor.minutos)} — responsável ${l.profiles?.name || "sem vendedor"}`,
              to: `/${modulo}/leads/${l.id}`,
            });
            if (avisos.filter((a) => a.id.startsWith("semat-")).length >= LIMITE_ESCADA) break;
          }
        }
      }
    } catch (e) {
      console.error("[avisos] escada sem-atendimento:", e);
    }

    // Severidade manda no corte, não a ordem de montagem: numa semana cheia de
    // renovações (azuis, entram antes), a escada vermelha caía fora do top-20.
    // sort é estável — dentro do mesmo tom, a ordem original (sinistros no
    // topo, SLA antes de renovação) se preserva.
    const peso = { red: 0, amber: 1, blue: 2 } as const;
    return avisos.sort((a, b) => peso[a.tone] - peso[b.tone]).slice(0, 20);
  } catch (e) {
    console.error("[avisos] fetchAvisos:", e);
    return [];
  }
}

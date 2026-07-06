import { useEffect, useState } from "react";
import { X, Inbox, ShoppingCart, Shield, Layers, LifeBuoy, ListChecks, Phone, MapPin, RefreshCcw, Award, Loader2, CircleUser } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Badge } from "./ui";
import { supabase } from "../lib/supabase";
import { brl, dateBR, initials } from "../lib/format";

// ─── Timeline 360º do cliente ────────────────────────────────────────────────
// Junta TUDO do cliente numa linha do tempo: leads → vendas → apólices →
// consórcios → sinistros/assistências → tarefas. Identidade cruzada por
// cliente_id quando existe FK e por nome/telefone quando a tabela só tem texto.
// Apólices/consórcios dependem da migração crm-portal-team.sql (sem ela a
// seção degrada em silêncio — o resto da timeline segue funcionando).

export interface ClienteResumo {
  id: string; name: string; cpf?: string | null; phone?: string | null;
  city?: string | null; state?: string | null; created_at?: string;
}

interface Evento {
  data: string;               // ISO — ordenação
  tipo: string;               // rótulo do grupo
  titulo: string;
  detalhe?: string;
  Icon: LucideIcon;
  cor: string;                // cor do dot
  badge?: { txt: string; tone: "green" | "amber" | "red" | "violet" | "blue" | "slate" };
}

const dig = (s?: string | null) => (s || "").replace(/\D/g, "");

async function carregarEventos(c: ClienteResumo): Promise<Evento[]> {
  if (!supabase) return [];
  const evs: Evento[] = [];
  const fone = dig(c.phone);

  const [leadsR, vendasR, apolR, consR, atendR, tarR] = await Promise.all([
    supabase.from("leads").select("created_at,produto_interesse,origem,etapa,score,telefone,nome").or(`nome.eq.${JSON.stringify(c.name)}${fone ? `,telefone.eq.${JSON.stringify(c.phone)}` : ""}`).limit(50),
    supabase.from("vendas").select("data_venda,created_at,produto,seguradora,valor,tipo,status").or(`cliente_id.eq.${c.id},cliente_nome.eq.${JSON.stringify(c.name)}`).limit(100),
    supabase.from("apolices").select("created_at,tipo,seguradora,vigencia_inicio,vigencia_fim,premio_mensal,status").eq("client_id", c.id).limit(100),
    supabase.from("consorcios").select("created_at,tipo,administradora,valor_credito,data_inicio,data_contemplacao,status").eq("client_id", c.id).limit(100),
    supabase.from("atendimentos").select("data,created_at,tipo,numero_registro,status,descricao").eq("cliente_nome", c.name).limit(50),
    supabase.from("tarefas").select("created_at,titulo,status,prioridade").eq("cliente_nome", c.name).limit(50),
  ]);

  for (const l of leadsR.data || []) evs.push({
    data: l.created_at, tipo: "Lead", titulo: `Lead — ${l.produto_interesse || "interesse geral"}`,
    detalhe: `origem: ${l.origem || "—"}${l.score ? ` · score ${l.score}` : ""}`,
    Icon: Inbox, cor: "#36ABE2",
    badge: l.etapa === "ganho" ? { txt: "convertido", tone: "green" } : undefined,
  });
  for (const v of vendasR.data || []) evs.push({
    data: v.data_venda || v.created_at, tipo: "Venda",
    titulo: `Venda — ${v.produto || "produto"}${v.seguradora ? ` (${v.seguradora})` : ""}`,
    detalhe: v.valor != null ? brl(v.valor) : undefined,
    Icon: v.tipo === "renovacao" ? RefreshCcw : ShoppingCart, cor: "#16A34A",
    badge: v.tipo === "renovacao" ? { txt: "renovação", tone: "violet" } : v.status === "cancelada" ? { txt: "cancelada", tone: "red" } : undefined,
  });
  for (const a of apolR.data || []) evs.push({
    data: a.vigencia_inicio || a.created_at, tipo: "Apólice",
    titulo: `Apólice ${a.tipo || ""}${a.seguradora ? ` — ${a.seguradora}` : ""}`,
    detalhe: `${a.premio_mensal != null ? `${brl(a.premio_mensal)}/mês · ` : ""}vigência até ${dateBR(a.vigencia_fim)}`,
    Icon: Shield, cor: "#1873BA",
    badge: a.status && a.status !== "ativa" ? { txt: a.status, tone: a.status === "vencida" ? "red" : "amber" } : undefined,
  });
  for (const k of consR.data || []) {
    evs.push({
      data: k.data_inicio || k.created_at, tipo: "Consórcio",
      titulo: `Consórcio ${k.tipo || ""}${k.administradora ? ` — ${k.administradora}` : ""}`,
      detalhe: k.valor_credito != null ? `crédito ${brl(k.valor_credito)}` : undefined,
      Icon: Layers, cor: "#7C3AED",
      badge: k.status === "contemplado" ? { txt: "contemplado", tone: "green" } : undefined,
    });
    if (k.data_contemplacao) evs.push({
      data: k.data_contemplacao, tipo: "Contemplação",
      titulo: `Contemplação do consórcio ${k.tipo || ""}`,
      detalhe: k.administradora || undefined, Icon: Award, cor: "#F59E0B",
    });
  }
  for (const s of atendR.data || []) evs.push({
    data: s.data || s.created_at, tipo: s.tipo === "assistencia" ? "Assistência" : "Sinistro",
    titulo: `${s.tipo === "assistencia" ? "Assistência" : "Sinistro"}${s.numero_registro ? ` #${s.numero_registro}` : ""}`,
    detalhe: s.descricao || undefined, Icon: LifeBuoy, cor: "#DC2626",
    badge: s.status ? { txt: s.status, tone: s.status === "aberto" ? "amber" : "slate" } : undefined,
  });
  for (const t of tarR.data || []) evs.push({
    data: t.created_at, tipo: "Tarefa", titulo: t.titulo,
    detalhe: t.prioridade ? `prioridade ${t.prioridade}` : undefined,
    Icon: ListChecks, cor: "#64748B",
    badge: t.status === "concluido" ? { txt: "concluída", tone: "green" } : undefined,
  });

  return evs.filter((e) => e.data).sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime());
}

export function TimelineCliente({ cliente, onFechar }: { cliente: ClienteResumo; onFechar: () => void }) {
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let vivo = true;
    setLoading(true);
    carregarEventos(cliente).then((evs) => { if (vivo) { setEventos(evs); setLoading(false); } });
    return () => { vivo = false; };
  }, [cliente]);

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-label={`Timeline de ${cliente.name}`}>
      <div className="absolute inset-0 bg-slate-900/45 backdrop-blur-sm" onClick={onFechar} />
      <aside className="absolute inset-y-0 right-0 w-[min(460px,94vw)] bg-white shadow-2xl flex flex-col animate-[slideIn_.25s_ease-out]">
        <style>{`@keyframes slideIn { from { transform: translateX(24px); opacity: 0 } to { transform: none; opacity: 1 } }`}</style>

        {/* Cabeçalho do cliente */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-start gap-3">
          <span className="w-11 h-11 rounded-full bg-brand-100 text-brand-700 grid place-items-center text-sm font-bold shrink-0">{initials(cliente.name)}</span>
          <div className="min-w-0 flex-1">
            <h3 className="font-extrabold text-ink text-lg leading-tight truncate">{cliente.name}</h3>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-xs text-muted">
              {cliente.cpf && <span className="flex items-center gap-1"><CircleUser size={11} /> {cliente.cpf}</span>}
              {cliente.phone && <span className="flex items-center gap-1"><Phone size={11} /> {cliente.phone}</span>}
              {cliente.city && <span className="flex items-center gap-1"><MapPin size={11} /> {cliente.city}/{cliente.state}</span>}
            </div>
          </div>
          <button onClick={onFechar} aria-label="Fechar" className="text-slate-400 hover:text-slate-600 p-1"><X size={20} /></button>
        </div>

        {/* Timeline */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="flex items-center gap-2 text-muted text-sm py-10 justify-center"><Loader2 size={16} className="animate-spin" /> Montando a história do cliente…</div>
          ) : eventos.length === 0 ? (
            <div className="text-center py-10">
              <span className="mx-auto w-12 h-12 rounded-xl bg-brand-50 text-brand-500 grid place-items-center mb-3"><Inbox size={22} /></span>
              <p className="font-bold text-ink text-sm">Nenhum evento ainda</p>
              <p className="text-xs text-muted mt-1 max-w-[280px] mx-auto">Leads, vendas, apólices, consórcios, sinistros e tarefas deste cliente aparecem aqui em ordem cronológica.</p>
            </div>
          ) : (
            <ol className="relative border-s-2 border-slate-100 ms-3 space-y-5">
              {eventos.map((e, i) => (
                <li key={i} className="ms-5 relative">
                  <span className="absolute -start-[27px] top-0.5 w-4 h-4 rounded-full grid place-items-center ring-4 ring-white" style={{ background: e.cor }}>
                    <e.Icon size={9} color="white" />
                  </span>
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-bold text-ink leading-tight">{e.titulo}</p>
                    {e.badge && <Badge tone={e.badge.tone}>{e.badge.txt}</Badge>}
                  </div>
                  {e.detalhe && <p className="text-xs text-muted mt-0.5">{e.detalhe}</p>}
                  <p className="text-[11px] text-slate-400 mt-0.5">{dateBR(e.data)} · {e.tipo}</p>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-100">
          <p className="text-[11px] text-muted">{eventos.length} evento{eventos.length === 1 ? "" : "s"} · cliente desde {dateBR(cliente.created_at)}</p>
        </div>
      </aside>
    </div>
  );
}

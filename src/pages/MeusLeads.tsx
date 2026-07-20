import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  MessageCircle, ListChecks, CalendarClock, Star, Layers, Clock,
  AlertTriangle, Tag, Phone, Users as UsersIcon,
} from "lucide-react";
import { PageHeader, Card, Badge, EmptyState, Spinner, SearchInput, Select } from "../components/ui";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";
import { fetchLeads, moduloDe, type Lead } from "../lib/leads";
import {
  type Atividade, TIPOS_ATIVIDADE, atividadeAtual, atividadeAtrasada,
  favoritosDoUsuario, alternarFavorito, listarEquipe,
} from "../lib/c2s";
import { onlyDigits } from "../lib/format";
import type { Modulo } from "../lib/nav";

// Clone da home de leads do C2S (ver docs/C2S-SCAN.md §Lista de leads):
// abas A fazer / Futuras / Favoritos / Todos + "Atividades para hoje".
// campanha/fonte/canal vêm da migration c2s-parity.sql e ainda não fazem
// parte da interface Lead base (src/lib/leads.ts) — estendemos localmente,
// igual ao padrão já usado em LeadDetalhe.tsx.
interface LeadRico extends Lead {
  campanha?: string | null;
  fonte?: string | null;
  canal?: string | null;
}

const dateTimeBR = (v?: string | null) => {
  if (!v) return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
};
const rotuloTipo = (t: string) => TIPOS_ATIVIDADE.find((x) => x.valor === t)?.rotulo ?? t;
const fimDoDia = () => { const d = new Date(); d.setHours(23, 59, 59, 999); return d.getTime(); };

type AbaChave = "afazer" | "futuras" | "favoritos" | "todos";
const ABAS: { valor: AbaChave; rotulo: string; icon: typeof ListChecks }[] = [
  { valor: "afazer", rotulo: "A fazer", icon: ListChecks },
  { valor: "futuras", rotulo: "Futuras", icon: CalendarClock },
  { valor: "favoritos", rotulo: "Favoritos", icon: Star },
  { valor: "todos", rotulo: "Todos", icon: Layers },
];

const origemTone: Record<string, "blue" | "green" | "violet" | "amber" | "slate"> = {
  chatbot: "blue", formulario: "green", whatsapp: "green", indicacao: "violet", portal: "amber",
};

// Info derivada das atividades pendentes de UM lead (atual + classificação de prazo).
function infoAtividade(atividades: Atividade[]) {
  const atual = atividadeAtual(atividades);
  if (!atual) return { atual: null as Atividade | null, atrasada: false, hoje: false, futura: false };
  const atrasada = atividadeAtrasada(atual);
  const quando = new Date(atual.quando).getTime();
  const hoje = !atrasada && quando <= fimDoDia();
  const futura = !atrasada && !hoje;
  return { atual, atrasada, hoje, futura };
}

function matchBusca(l: Lead, termo: string) {
  if (!termo) return true;
  const t = termo.toLowerCase();
  return (
    (l.nome || "").toLowerCase().includes(t) ||
    (l.telefone || "").toLowerCase().includes(t) ||
    (l.produto_interesse || "").toLowerCase().includes(t)
  );
}

export function MeusLeads({ modulo }: { modulo: Modulo }) {
  const navigate = useNavigate();
  const { user, isManager } = useAuth();

  const [leads, setLeads] = useState<LeadRico[]>([]);
  const [atividadesPorLead, setAtividadesPorLead] = useState<Map<string, Atividade[]>>(new Map());
  const [favoritos, setFavoritos] = useState<Set<string>>(new Set());
  const [equipe, setEquipe] = useState<{ id: string; name: string; role: string | null }[]>([]);
  const [loading, setLoading] = useState(true);
  const [avisoParity, setAvisoParity] = useState(false);

  const [busca, setBusca] = useState("");
  const [aba, setAba] = useState<AbaChave>("afazer");
  const [visao, setVisao] = useState<string>("todos"); // "todos" | userId — só relevante p/ gestor/admin

  // guarda de corrida no load (mesmo padrão do Bolsao — /seguros/leads ↔
  // /consorcios/leads é o MESMO componente, só muda a prop `modulo`).
  const loadReq = useRef(0);
  async function load() {
    const req = ++loadReq.current;
    try {
      const [todosLeads, ativsRes, favs, equipeRes] = await Promise.all([
        fetchLeads(),
        supabase ? supabase.from("lead_atividades").select("*").eq("status", "pendente") : Promise.resolve({ data: [], error: null }),
        user ? favoritosDoUsuario(user.id) : Promise.resolve(new Set<string>()),
        isManager ? listarEquipe() : Promise.resolve([]),
      ]);
      if (req !== loadReq.current) return;

      setLeads(todosLeads.filter((l) => moduloDe(l) === modulo && !l.descartado) as LeadRico[]);
      setAvisoParity(!!ativsRes.error);
      const mapa = new Map<string, Atividade[]>();
      ((ativsRes.data as Atividade[]) ?? []).forEach((a) => {
        const arr = mapa.get(a.lead_id) ?? [];
        arr.push(a);
        mapa.set(a.lead_id, arr);
      });
      setAtividadesPorLead(mapa);
      setFavoritos(favs);
      setEquipe(equipeRes);
    } catch (e) {
      console.error("[meus-leads] load:", e);
    } finally {
      if (req === loadReq.current) setLoading(false);
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [modulo, user?.id]);

  const nomePorId = useMemo(() => {
    const m: Record<string, string> = {};
    equipe.forEach((p) => { m[p.id] = p.name; });
    return m;
  }, [equipe]);

  // Escopo: vendedor sempre vê só os leads dele; gestor/admin escolhem "Ver como".
  const escopo = useMemo(() => {
    if (!isManager) return leads.filter((l) => l.vendedor_id === user?.id);
    if (visao === "todos") return leads;
    return leads.filter((l) => l.vendedor_id === visao);
  }, [leads, isManager, visao, user?.id]);

  const mostrarResponsavel = isManager && visao === "todos";

  const classificados = useMemo(
    () => escopo.map((l) => ({ lead: l, ...infoAtividade(atividadesPorLead.get(l.id) ?? []) })),
    [escopo, atividadesPorLead]
  );

  const hojeLeads = useMemo(
    () => classificados.filter((c) => c.atrasada || c.hoje).sort((a, b) => (a.atual?.quando ?? "").localeCompare(b.atual?.quando ?? "")),
    [classificados]
  );
  const semContatoLeads = useMemo(
    () => classificados.filter((c) => !c.atual && !c.lead.primeiro_contato_em).sort((a, b) => (a.lead.created_at ?? "").localeCompare(b.lead.created_at ?? "")),
    [classificados]
  );
  const futurasLeads = useMemo(
    () => classificados.filter((c) => c.futura).sort((a, b) => (a.atual?.quando ?? "").localeCompare(b.atual?.quando ?? "")),
    [classificados]
  );
  const favoritosLeads = useMemo(
    () => classificados.filter((c) => favoritos.has(c.lead.id)),
    [classificados, favoritos]
  );

  const contagens: Record<AbaChave, number> = {
    afazer: hojeLeads.length + semContatoLeads.length,
    futuras: futurasLeads.length,
    favoritos: favoritosLeads.length,
    todos: classificados.length,
  };

  async function handleFavorito(leadId: string) {
    if (!user) return;
    const era = favoritos.has(leadId);
    setFavoritos((prev) => {
      const next = new Set(prev);
      if (era) next.delete(leadId); else next.add(leadId);
      return next;
    });
    const ok = await alternarFavorito(user.id, leadId, era);
    if (!ok) {
      setFavoritos((prev) => {
        const next = new Set(prev);
        if (era) next.add(leadId); else next.delete(leadId);
        return next;
      });
      toast.error("Não foi possível atualizar o favorito.");
    }
  }

  function LeadRow({ item }: { item: (typeof classificados)[number] }) {
    const { lead: l, atual, atrasada } = item;
    const isFav = favoritos.has(l.id);
    const wa = l.telefone ? `https://wa.me/55${onlyDigits(l.telefone)}` : null;
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={() => navigate(`/${modulo}/leads/${l.id}`)}
        onKeyDown={(e) => { if (e.key === "Enter") navigate(`/${modulo}/leads/${l.id}`); }}
        className="cursor-pointer"
      >
        <Card className="hover:border-brand-300 transition-colors">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-bold text-ink">{l.nome}</span>
                {l.telefone && <span className="text-xs text-muted flex items-center gap-1"><Phone size={11} /> {l.telefone}</span>}
              </div>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {l.produto_interesse && <Badge tone="blue"><Tag size={11} /> {l.produto_interesse}</Badge>}
                {l.campanha && <Badge tone="violet">{l.campanha}</Badge>}
                {(l.fonte || l.canal) && <Badge tone="amber">{[l.fonte, l.canal].filter(Boolean).join(" · ")}</Badge>}
                {l.origem && <Badge tone={origemTone[l.origem] ?? "slate"}>{l.origem}</Badge>}
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs text-muted">
                <span>Recebido em {dateTimeBR(l.created_at) ?? "—"}</span>
                {mostrarResponsavel && (
                  <span className="flex items-center gap-1"><UsersIcon size={11} /> {l.vendedor_id ? (nomePorId[l.vendedor_id] ?? "—") : "Sem responsável"}</span>
                )}
              </div>
              {atual && (
                <p className={`text-xs font-bold mt-2 flex items-center gap-1 ${atrasada ? "text-red-600" : "text-brand-600"}`}>
                  {atrasada && <AlertTriangle size={12} />} {rotuloTipo(atual.tipo)} — {dateTimeBR(atual.quando)}
                </p>
              )}
              {!atual && !l.primeiro_contato_em && (
                <p className="text-xs font-bold text-amber-600 mt-2">Sem primeiro contato registrado</p>
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {wa && (
                <a href={wa} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
                  title="WhatsApp" aria-label={`WhatsApp de ${l.nome}`}
                  className="text-muted hover:text-[#25d366] transition-colors p-1.5 rounded-lg hover:bg-green-50">
                  <MessageCircle size={16} />
                </a>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); handleFavorito(l.id); }}
                title={isFav ? "Remover dos favoritos" : "Favoritar"}
                aria-label={isFav ? `Remover ${l.nome} dos favoritos` : `Favoritar ${l.nome}`}
                className={`p-1.5 rounded-lg transition-colors ${isFav ? "text-amber-500" : "text-slate-300 hover:text-amber-400"}`}
              >
                <Star size={18} fill={isFav ? "currentColor" : "none"} />
              </button>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  const filtro = (arr: typeof classificados) => arr.filter((c) => matchBusca(c.lead, busca));

  return (
    <>
      <PageHeader title="Meus Leads" subtitle="Atendimento de leads — acompanhe atividades, favoritos e histórico" icon={MessageCircle} />

      {avisoParity && (
        <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 text-amber-800 text-xs font-semibold px-4 py-3 flex items-center gap-2">
          <AlertTriangle size={15} className="shrink-0" />
          Atividades ainda não estão disponíveis. Rode <code className="bg-amber-100 px-1 rounded">supabase/c2s-parity.sql</code> no Supabase para ativar as abas A fazer / Futuras.
        </div>
      )}

      <Card className="mb-5">
        <div className="flex items-center gap-3 flex-wrap">
          <SearchInput value={busca} onChange={setBusca} placeholder="Buscar por nome, telefone ou produto..." />
          {isManager && (
            <Select
              value={visao}
              onChange={setVisao}
              options={[{ value: "todos", label: "Todos" }, ...equipe.map((p) => ({ value: p.id, label: p.name }))]}
            />
          )}
        </div>
      </Card>

      <div className="flex items-center gap-1 border-b border-slate-200 mb-6 overflow-x-auto">
        {ABAS.map((a) => (
          <button
            key={a.valor}
            onClick={() => setAba(a.valor)}
            className={`inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-bold border-b-2 -mb-px whitespace-nowrap transition-colors ${
              aba === a.valor ? "border-brand-500 text-brand-600" : "border-transparent text-muted hover:text-ink"
            }`}
          >
            <a.icon size={15} /> {a.rotulo}
            <span className={`ml-0.5 text-[11px] font-bold px-1.5 py-0.5 rounded-full ${aba === a.valor ? "bg-brand-100 text-brand-700" : "bg-slate-100 text-slate-500"}`}>
              {contagens[a.valor]}
            </span>
          </button>
        ))}
      </div>

      {loading ? (
        <Spinner label="Carregando seus leads..." />
      ) : (
        <>
          {aba === "afazer" && (() => {
            const hoje = filtro(hojeLeads);
            const semContato = filtro(semContatoLeads);
            if (hoje.length === 0 && semContato.length === 0) {
              return (
                <Card pad={false}>
                  <EmptyState icon={ListChecks} title="Nada pra fazer agora" hint="Nenhum lead atrasado, com atividade pra hoje ou sem primeiro contato." />
                </Card>
              );
            }
            return (
              <div className="space-y-6">
                {hoje.length > 0 && (
                  <div>
                    <h3 className="text-sm font-bold text-ink mb-2.5 flex items-center gap-1.5">
                      <Clock size={14} className="text-red-500" /> Atividades para hoje ({hoje.length})
                    </h3>
                    <div className="space-y-2">{hoje.map((c) => <LeadRow key={c.lead.id} item={c} />)}</div>
                  </div>
                )}
                {semContato.length > 0 && (
                  <div>
                    <h3 className="text-sm font-bold text-ink mb-2.5">Sem contato ainda ({semContato.length})</h3>
                    <div className="space-y-2">{semContato.map((c) => <LeadRow key={c.lead.id} item={c} />)}</div>
                  </div>
                )}
              </div>
            );
          })()}

          {aba === "futuras" && (() => {
            const arr = filtro(futurasLeads);
            return arr.length === 0 ? (
              <Card pad={false}>
                <EmptyState icon={CalendarClock} title="Nenhuma atividade futura" hint="Leads com a próxima atividade agendada para depois de hoje aparecem aqui." />
              </Card>
            ) : (
              <div className="space-y-2">{arr.map((c) => <LeadRow key={c.lead.id} item={c} />)}</div>
            );
          })()}

          {aba === "favoritos" && (() => {
            const arr = filtro(favoritosLeads);
            return arr.length === 0 ? (
              <Card pad={false}>
                <EmptyState icon={Star} title="Nenhum favorito" hint="Clique na estrela de um lead para acompanhá-lo aqui." />
              </Card>
            ) : (
              <div className="space-y-2">{arr.map((c) => <LeadRow key={c.lead.id} item={c} />)}</div>
            );
          })()}

          {aba === "todos" && (() => {
            const arr = filtro(classificados);
            return arr.length === 0 ? (
              <Card pad={false}>
                <EmptyState icon={Layers} title="Nenhum lead encontrado" hint="Ajuste a busca ou o filtro de visão." />
              </Card>
            ) : (
              <div className="space-y-2">{arr.map((c) => <LeadRow key={c.lead.id} item={c} />)}</div>
            );
          })()}
        </>
      )}
    </>
  );
}

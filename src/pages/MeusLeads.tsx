import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  MessageCircle, ListChecks, CalendarClock, Star, Layers, Clock,
  AlertTriangle, Tag, Phone, Users as UsersIcon, Plus, X, MapPin, Archive,
} from "lucide-react";
import { PageHeader, Card, Badge, EmptyState, Spinner, SearchInput, Select, Button } from "../components/ui";
import { ModalShell } from "../components/ModalShell";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";
import { fetchLeads, fetchLeadsArquivados, moduloDe, limiteSlaMinutos, type Lead } from "../lib/leads";
import {
  type Atividade, type Etiqueta, TIPOS_ATIVIDADE, atividadeAtual, atividadeAtrasada,
  favoritosDoUsuario, alternarFavorito, listarEquipe, inserir, listar,
} from "../lib/c2s";
import { onlyDigits, waLink } from "../lib/format";
import { paraNumero } from "../lib/num";
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

type AbaChave = "afazer" | "visitas" | "futuras" | "favoritos" | "todos" | "arquivados";
const ABAS: { valor: AbaChave; rotulo: string; icon: typeof ListChecks }[] = [
  { valor: "afazer", rotulo: "A fazer", icon: ListChecks },
  { valor: "visitas", rotulo: "Visitas", icon: MapPin },
  { valor: "futuras", rotulo: "Futuras", icon: CalendarClock },
  { valor: "favoritos", rotulo: "Favoritos", icon: Star },
  { valor: "todos", rotulo: "Todos", icon: Layers },
  { valor: "arquivados", rotulo: "Arquivados", icon: Archive },
];

const origemTone: Record<string, "blue" | "green" | "violet" | "amber" | "slate"> = {
  chatbot: "blue", formulario: "green", whatsapp: "green", indicacao: "violet", portal: "amber",
};

// ─── Modal "Novo lead" (paridade "Criar novo lead" do C2S — ver docs/C2S-SCAN.md) ──
const URGENCIA_OPCOES = [
  { value: "breve", label: "Breve" },
  { value: "hoje", label: "Hoje" },
  { value: "urgente", label: "Urgente" },
];
const inputCls = "w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none text-ink focus:border-brand-400 transition-colors";
const labelCls = "text-xs font-bold text-muted uppercase tracking-wide block mb-1.5";
type AtribuirA = "auto" | "mim" | "outro";
interface NovoLeadForm { nome: string; telefone: string; email: string; produto: string; valor: string; urgencia: string; obs: string }
const NOVO_LEAD_VAZIO: NovoLeadForm = { nome: "", telefone: "", email: "", produto: "", valor: "", urgencia: "breve", obs: "" };

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

// Paridade C2S: busca por produto/NOME/TELEFONE/E-MAIL. Telefone compara por
// dígitos normalizados — "(12) 98888-7777" tem que casar com "12988887777".
function matchBusca(l: Lead, termo: string) {
  if (!termo) return true;
  const t = termo.toLowerCase();
  const digitos = onlyDigits(termo);
  return (
    (l.nome || "").toLowerCase().includes(t) ||
    (l.telefone || "").toLowerCase().includes(t) ||
    (digitos.length >= 4 && onlyDigits(l.telefone || "").includes(digitos)) ||
    (l.email || "").toLowerCase().includes(t) ||
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
  // Filtros estruturados (paridade C2S: "Busca + Filtros")
  const [fOrigem, setFOrigem] = useState("");
  const [fEtiqueta, setFEtiqueta] = useState("");
  const [fPeriodo, setFPeriodo] = useState(""); // dias: "" = sempre
  const [etiquetas, setEtiquetas] = useState<Etiqueta[]>([]);
  const [etiquetasPorLead, setEtiquetasPorLead] = useState<Map<string, Set<string>>>(new Map());

  // Modal "Novo lead"
  const [novoAberto, setNovoAberto] = useState(false);
  const [novoForm, setNovoForm] = useState<NovoLeadForm>(NOVO_LEAD_VAZIO);
  const [atribuirA, setAtribuirA] = useState<AtribuirA>("auto");
  const [outroId, setOutroId] = useState("");
  const [criando, setCriando] = useState(false);

  // guarda de corrida no load (mesmo padrão do Bolsao — /seguros/leads ↔
  // /consorcios/leads é o MESMO componente, só muda a prop `modulo`).
  const loadReq = useRef(0);
  async function load() {
    const req = ++loadReq.current;
    try {
      const [todosLeads, ativsRes, favs, equipeRes, tagsRes, vinculosRes] = await Promise.all([
        // Só ativos: a aba "Arquivados" pagina no servidor (fetchLeadsArquivados) —
        // o histórico de descartados só cresce e não pode pesar em toda visita.
        fetchLeads(),
        supabase ? supabase.from("lead_atividades").select("*").eq("status", "pendente") : Promise.resolve({ data: [], error: null }),
        user ? favoritosDoUsuario(user.id) : Promise.resolve(new Set<string>()),
        isManager ? listarEquipe() : Promise.resolve([]),
        listar<Etiqueta>("etiquetas"),
        supabase ? supabase.from("lead_etiquetas").select("lead_id, etiqueta_id").limit(5000) : Promise.resolve({ data: [], error: null }),
      ]);
      if (req !== loadReq.current) return;

      setLeads(todosLeads.filter((l) => moduloDe(l) === modulo) as LeadRico[]);
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
      setEtiquetas(tagsRes.filter((t) => t.ativa));
      const mapaTags = new Map<string, Set<string>>();
      (((vinculosRes as any).data as { lead_id: string; etiqueta_id: string }[]) ?? []).forEach((v) => {
        const s = mapaTags.get(v.lead_id) ?? new Set<string>();
        s.add(v.etiqueta_id);
        mapaTags.set(v.lead_id, s);
      });
      setEtiquetasPorLead(mapaTags);
    } catch (e) {
      console.error("[meus-leads] load:", e);
    } finally {
      if (req === loadReq.current) setLoading(false);
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [modulo, user?.id]);

  // ─── Aba "Arquivados": paginada no servidor (ver fetchLeadsArquivados) ────
  const [arq, setArq] = useState<LeadRico[]>([]);
  const [arqPagina, setArqPagina] = useState(0);
  const [arqTotal, setArqTotal] = useState(0); // total do filtro atual (alimenta o "Carregar mais")
  const [arqBadge, setArqBadge] = useState(0); // total SEM busca/filtros (badge da aba, como as demais)
  const [arqLoading, setArqLoading] = useState(false);
  const arqReq = useRef(0);

  // Escopo replicado no servidor: vendedor só vê os dele; gestor usa "Ver como".
  const escopoVendedorId = !isManager ? (user?.id ?? null) : visao !== "todos" ? visao : null;

  async function carregarArquivados(pagina: number) {
    const req = ++arqReq.current;
    setArqLoading(true);
    try {
      // Etiqueta é vínculo N:N — resolve os ids no cliente (mapa já carregado)
      // e manda como pré-filtro `in`, igual ao comportamento das outras abas.
      const leadIdsEtiqueta = fEtiqueta
        ? [...etiquetasPorLead.entries()].filter(([, s]) => s.has(fEtiqueta)).map(([id]) => id)
        : null;
      const { leads: pageArq, total } = await fetchLeadsArquivados({
        modulo,
        pagina,
        busca,
        origem: fOrigem || undefined,
        periodoDias: fPeriodo ? Number(fPeriodo) : undefined,
        vendedorId: escopoVendedorId,
        leadIds: leadIdsEtiqueta,
      });
      if (req !== arqReq.current) return;
      setArqTotal(total);
      setArqPagina(pagina);
      setArq((prev) => (pagina === 0 ? pageArq : [...prev, ...pageArq]) as LeadRico[]);
    } catch (e) {
      console.error("[meus-leads] arquivados:", e);
    } finally {
      if (req === arqReq.current) setArqLoading(false);
    }
  }

  // 1ª página sempre que a aba abre ou busca/filtros/visão mudam (debounce na
  // digitação). Fora da aba, zero rede — quem nunca abre Arquivados não paga nada.
  useEffect(() => {
    if (aba !== "arquivados") return;
    const t = setTimeout(() => carregarArquivados(0), busca ? 300 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aba, modulo, busca, fOrigem, fEtiqueta, fPeriodo, visao, user?.id]);

  // Badge da aba: HEAD count (sem baixar linhas), independente de busca/filtros —
  // as demais abas também contam a lista inteira do escopo, não a filtrada.
  useEffect(() => {
    let vivo = true;
    fetchLeadsArquivados({ modulo, vendedorId: escopoVendedorId, contarApenas: true })
      .then(({ total }) => { if (vivo) setArqBadge(total); });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modulo, visao, user?.id, isManager]);

  // Troca de módulo zera a lista carregada (senão a aba reabriria mostrando
  // arquivados do módulo anterior por um instante até a nova página chegar).
  useEffect(() => { setArq([]); setArqTotal(0); setArqPagina(0); }, [modulo]);

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
  // A lista principal já vem sem descartados; o filtro fica como cinto de
  // segurança (um lead arquivado em outra aba do navegador não deve vazar aqui).
  const ativosClass = useMemo(() => classificados.filter((c) => !c.lead.descartado), [classificados]);
  // Arquivados vêm do estado paginado (servidor já aplicou escopo, ordem e filtros).
  const arquivadosLeads = useMemo(
    () => arq.map((l) => ({ lead: l, ...infoAtividade(atividadesPorLead.get(l.id) ?? []) })),
    [arq, atividadesPorLead]
  );

  const hojeLeads = useMemo(
    () => ativosClass.filter((c) => c.atrasada || c.hoje).sort((a, b) => (a.atual?.quando ?? "").localeCompare(b.atual?.quando ?? "")),
    [ativosClass]
  );
  const semContatoLeads = useMemo(
    () => ativosClass.filter((c) => !c.atual && !c.lead.primeiro_contato_em).sort((a, b) => (a.lead.created_at ?? "").localeCompare(b.lead.created_at ?? "")),
    [ativosClass]
  );
  // Aba "Visitas" do C2S: leads cuja atividade atual é uma visita agendada
  const visitasLeads = useMemo(
    () => ativosClass.filter((c) => c.atual?.tipo === "visita").sort((a, b) => (a.atual?.quando ?? "").localeCompare(b.atual?.quando ?? "")),
    [ativosClass]
  );
  const futurasLeads = useMemo(
    () => ativosClass.filter((c) => c.futura).sort((a, b) => (a.atual?.quando ?? "").localeCompare(b.atual?.quando ?? "")),
    [ativosClass]
  );
  const favoritosLeads = useMemo(
    () => ativosClass.filter((c) => favoritos.has(c.lead.id)),
    [ativosClass, favoritos]
  );

  const contagens: Record<AbaChave, number> = {
    afazer: hojeLeads.length + semContatoLeads.length,
    visitas: visitasLeads.length,
    futuras: futurasLeads.length,
    favoritos: favoritosLeads.length,
    todos: ativosClass.length,
    arquivados: arqBadge,
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

  function abrirNovoLead() {
    setNovoForm(NOVO_LEAD_VAZIO);
    setAtribuirA("auto");
    setOutroId("");
    setNovoAberto(true);
  }

  async function nomeDoVendedor(id: string): Promise<string> {
    if (nomePorId[id]) return nomePorId[id];
    if (!supabase) return "um consultor";
    const { data } = await supabase.from("profiles").select("name").eq("id", id).maybeSingle();
    return (data as { name: string } | null)?.name || "um consultor";
  }

  async function criarLead(e: FormEvent) {
    e.preventDefault();
    if (!supabase || !user) return;

    const nome = novoForm.nome.trim();
    const telefone = novoForm.telefone.trim();
    const email = novoForm.email.trim();
    if (!nome) { toast.error("Informe o nome do lead."); return; }
    if (!telefone && !email) { toast.error("Informe telefone ou e-mail."); return; }
    if (atribuirA === "outro" && !outroId) { toast.error("Escolha um membro da equipe."); return; }

    const vendedorId = atribuirA === "mim" ? user.id : atribuirA === "outro" ? outroId : null;

    setCriando(true);
    try {
      const payload: Record<string, unknown> = {
        nome,
        telefone: telefone || null,
        email: email || null,
        produto_interesse: novoForm.produto.trim() || null,
        valor_potencial: paraNumero(novoForm.valor),
        urgencia: novoForm.urgencia,
        modulo,
        origem: "manual",
        canal: "CRM",
        status: "novo",
        score: 60,
        vendedor_id: vendedorId,
      };
      if (vendedorId) {
        payload.atribuido_em = new Date().toISOString();
        // SLA de 1º contato também na atribuição manual — sem isso o lead
        // criado "pra um colega" nunca entrava nos avisos nem na reciclagem.
        const minutos = await limiteSlaMinutos();
        payload.sla_expira_em = new Date(Date.now() + minutos * 60000).toISOString();
      }

      const { data: inserido, error } = await supabase.from("leads").insert(payload).select("id").single();
      if (error) throw error;
      const leadId = (inserido as { id: string }).id;

      const obs = novoForm.obs.trim();
      if (obs) {
        // Tabela lead_observacoes vem da migration c2s-parity.sql — se ainda não
        // rodou, o erro já é logado pelo helper `inserir` e ignorado aqui.
        await inserir("lead_observacoes", { lead_id: leadId, texto: obs, criado_por: user.id });
      }

      let quem: string;
      if (vendedorId === user.id) {
        quem = "atribuído a você";
      } else if (vendedorId) {
        quem = `atribuído a ${await nomeDoVendedor(vendedorId)}`;
      } else {
        // Distribuição automática: o motor roda por TRIGGER no insert (ver
        // supabase/c2s-parity.sql), então relemos o lead pra saber quem pegou.
        const { data: atualizado } = await supabase.from("leads").select("vendedor_id").eq("id", leadId).maybeSingle();
        const finalVendedor = (atualizado as { vendedor_id: string | null } | null)?.vendedor_id ?? null;
        quem = finalVendedor ? `distribuído automaticamente para ${await nomeDoVendedor(finalVendedor)}` : "aguardando distribuição no bolsão";
      }

      toast.success(`Lead criado — ${quem}.`);
      setNovoAberto(false);
      load();
    } catch (err) {
      console.error("[meus-leads] criar lead:", err);
      toast.error("Não foi possível criar o lead.");
    } finally {
      setCriando(false);
    }
  }

  function LeadRow({ item }: { item: (typeof classificados)[number] }) {
    const { lead: l, atual, atrasada } = item;
    const isFav = favoritos.has(l.id);
    const wa = waLink(l.telefone);
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
                {l.telefone && (
                  <a href={`tel:${l.telefone.replace(/[^\d+]/g, "")}`} onClick={(e) => e.stopPropagation()} title="Ligar"
                    className="text-xs text-muted hover:text-brand-600 flex items-center gap-1">
                    <Phone size={11} /> {l.telefone}
                  </a>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {l.descartado && <Badge tone="red"><Archive size={11} /> Arquivado{l.motivo_descarte ? ` · ${l.motivo_descarte}` : ""}</Badge>}
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

  // Busca livre + filtros estruturados (origem, etiqueta, período de criação)
  const filtro = (arr: typeof classificados) => arr.filter((c) => {
    if (!matchBusca(c.lead, busca)) return false;
    if (fOrigem && c.lead.origem !== fOrigem) return false;
    if (fEtiqueta && !etiquetasPorLead.get(c.lead.id)?.has(fEtiqueta)) return false;
    if (fPeriodo) {
      const corte = Date.now() - Number(fPeriodo) * 24 * 60 * 60 * 1000;
      if (!c.lead.created_at || new Date(c.lead.created_at).getTime() < corte) return false;
    }
    return true;
  });

  return (
    <>
      <PageHeader
        title="Meus Leads"
        subtitle="Atendimento de leads — acompanhe atividades, favoritos e histórico"
        icon={MessageCircle}
        actions={<Button icon={Plus} onClick={abrirNovoLead}>Novo lead</Button>}
      />

      {avisoParity && (
        <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 text-amber-800 text-xs font-semibold px-4 py-3 flex items-center gap-2">
          <AlertTriangle size={15} className="shrink-0" />
          Atividades ainda não estão disponíveis. Rode <code className="bg-amber-100 px-1 rounded">supabase/c2s-parity.sql</code> no Supabase para ativar as abas A fazer / Futuras.
        </div>
      )}

      <Card className="mb-5">
        <div className="flex items-center gap-3 flex-wrap">
          <SearchInput value={busca} onChange={setBusca} placeholder="Buscar por nome, telefone, e-mail ou produto..." />
          <Select value={fOrigem} onChange={setFOrigem} placeholder="Todas as origens" options={[
            { value: "chatbot", label: "Kubinho (chatbot)" }, { value: "formulario", label: "Formulário" },
            { value: "whatsapp", label: "WhatsApp" }, { value: "indicacao", label: "Indicação" }, { value: "portal", label: "Portal" },
            { value: "webhook", label: "Webhook (Meta/Make)" }, { value: "manual", label: "Manual" },
          ]} />
          {etiquetas.length > 0 && (
            <Select value={fEtiqueta} onChange={setFEtiqueta} placeholder="Todas as etiquetas"
              options={etiquetas.map((t) => ({ value: t.id, label: t.nome }))} />
          )}
          <Select value={fPeriodo} onChange={setFPeriodo} placeholder="Qualquer período" options={[
            { value: "1", label: "Hoje" }, { value: "7", label: "Últimos 7 dias" },
            { value: "30", label: "Últimos 30 dias" }, { value: "90", label: "Últimos 90 dias" },
          ]} />
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

          {aba === "visitas" && (() => {
            const arr = filtro(visitasLeads);
            return arr.length === 0 ? (
              <Card pad={false}>
                <EmptyState icon={MapPin} title="Nenhuma visita agendada" hint="Leads cuja próxima atividade é uma visita aparecem aqui — sua agenda de rua." />
              </Card>
            ) : (
              <div className="space-y-2">{arr.map((c) => <LeadRow key={c.lead.id} item={c} />)}</div>
            );
          })()}

          {aba === "todos" && (() => {
            const arr = filtro(ativosClass);
            return arr.length === 0 ? (
              <Card pad={false}>
                <EmptyState icon={Layers} title="Nenhum lead encontrado" hint="Ajuste a busca ou o filtro de visão." />
              </Card>
            ) : (
              <div className="space-y-2">{arr.map((c) => <LeadRow key={c.lead.id} item={c} />)}</div>
            );
          })()}

          {aba === "arquivados" && (() => {
            // O servidor já filtrou; o filtro() do cliente entra só pra manter a
            // lista coerente enquanto a próxima página/busca está a caminho.
            const arr = filtro(arquivadosLeads);
            if (arqLoading && arq.length === 0) return <Spinner label="Carregando arquivados..." />;
            if (arr.length === 0) {
              const comFiltro = !!(busca || fOrigem || fEtiqueta || fPeriodo);
              return (
                <Card pad={false}>
                  <EmptyState icon={Archive} title="Nenhum lead arquivado"
                    hint={comFiltro ? "Nada encontrado com essa busca/filtros — a busca aqui vale pra TODOS os arquivados, não só os já carregados." : "Leads arquivados ficam aqui com o motivo — abra um para reabrir se precisar."} />
                </Card>
              );
            }
            return (
              <div className="space-y-2">
                {arr.map((c) => <LeadRow key={c.lead.id} item={c} />)}
                {arq.length < arqTotal && (
                  <div className="pt-2 text-center">
                    <Button variant="outline" onClick={() => carregarArquivados(arqPagina + 1)} disabled={arqLoading}>
                      {arqLoading ? "Carregando…" : `Carregar mais (${arqTotal - arq.length} restantes)`}
                    </Button>
                  </div>
                )}
              </div>
            );
          })()}
        </>
      )}

      {novoAberto && (
        <ModalShell onClose={() => !criando && setNovoAberto(false)} label="Novo lead" className="bg-white rounded-2xl shadow-2xl w-[min(560px,94vw)] max-h-[90vh] overflow-y-auto">
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 sticky top-0 bg-white z-10">
            <div className="flex items-center gap-2.5">
              <span className="w-9 h-9 rounded-xl bg-brand-50 text-brand-500 grid place-items-center shrink-0"><Plus size={18} /></span>
              <h3 className="font-extrabold text-ink text-lg">Novo lead</h3>
            </div>
            <button type="button" onClick={() => !criando && setNovoAberto(false)} aria-label="Fechar" className="text-slate-500 hover:text-slate-700"><X size={20} /></button>
          </div>

          <form onSubmit={criarLead} className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block sm:col-span-2">
              <span className={labelCls}>Nome *</span>
              <input className={inputCls} required value={novoForm.nome} onChange={(e) => setNovoForm((p) => ({ ...p, nome: e.target.value }))} placeholder="Nome do lead" />
            </label>
            <label className="block">
              <span className={labelCls}>Telefone</span>
              <input className={inputCls} value={novoForm.telefone} onChange={(e) => setNovoForm((p) => ({ ...p, telefone: e.target.value }))} placeholder="(12) 90000-0000" />
            </label>
            <label className="block">
              <span className={labelCls}>E-mail</span>
              <input className={inputCls} type="email" value={novoForm.email} onChange={(e) => setNovoForm((p) => ({ ...p, email: e.target.value }))} placeholder="cliente@exemplo.com" />
            </label>
            <p className="sm:col-span-2 -mt-2 text-xs text-muted">Informe telefone ou e-mail (pelo menos um).</p>
            <label className="block">
              <span className={labelCls}>Produto de interesse</span>
              <input className={inputCls} value={novoForm.produto} onChange={(e) => setNovoForm((p) => ({ ...p, produto: e.target.value }))} placeholder="Ex.: Auto, Vida, Consórcio imóvel" />
            </label>
            <label className="block">
              <span className={labelCls}>Valor potencial</span>
              <input className={inputCls} value={novoForm.valor} onChange={(e) => setNovoForm((p) => ({ ...p, valor: e.target.value }))} placeholder="R$ 0,00" inputMode="decimal" />
            </label>
            <label className="block sm:col-span-2">
              <span className={labelCls}>Urgência</span>
              <Select value={novoForm.urgencia} onChange={(v) => setNovoForm((p) => ({ ...p, urgencia: v }))} options={URGENCIA_OPCOES} />
            </label>
            <label className="block sm:col-span-2">
              <span className={labelCls}>Observação inicial</span>
              <textarea className={inputCls} rows={3} value={novoForm.obs} onChange={(e) => setNovoForm((p) => ({ ...p, obs: e.target.value }))} placeholder="Opcional — contexto pro consultor que assumir o lead" />
            </label>

            <div className="sm:col-span-2">
              <span className={labelCls}>Atribuir a</span>
              <div className="grid gap-2 mt-1">
                <label className="flex items-center gap-2 text-sm text-ink bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 cursor-pointer">
                  <input type="radio" name="atribuir-a" checked={atribuirA === "auto"} onChange={() => setAtribuirA("auto")} className="accent-brand-500" />
                  Distribuição automática (filas)
                </label>
                <label className="flex items-center gap-2 text-sm text-ink bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 cursor-pointer">
                  <input type="radio" name="atribuir-a" checked={atribuirA === "mim"} onChange={() => setAtribuirA("mim")} className="accent-brand-500" />
                  Mim mesmo
                </label>
                {isManager && (
                  <label className="flex items-center gap-2 text-sm text-ink bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 cursor-pointer">
                    <input type="radio" name="atribuir-a" checked={atribuirA === "outro"} onChange={() => setAtribuirA("outro")} className="accent-brand-500 shrink-0" />
                    <span className="shrink-0">Outro membro</span>
                    {atribuirA === "outro" && (
                      <select
                        value={outroId}
                        onChange={(e) => setOutroId(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        className="ml-auto bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs outline-none text-ink"
                      >
                        <option value="">Escolha…</option>
                        {equipe.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    )}
                  </label>
                )}
              </div>
            </div>

            <div className="sm:col-span-2 flex justify-end gap-3 pt-2">
              <Button variant="outline" onClick={() => setNovoAberto(false)} disabled={criando}>Cancelar</Button>
              <Button type="submit" disabled={criando}>{criando ? "Criando…" : "Criar lead"}</Button>
            </div>
          </form>
        </ModalShell>
      )}
    </>
  );
}

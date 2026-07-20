import { useEffect, useState, type FormEvent } from "react";
import { useParams, useLocation, Link } from "react-router-dom";
import { toast } from "sonner";
import {
  MessageCircle, Phone, Mail, Star, ArrowLeftRight, HelpCircle, ArrowLeft,
  CheckCircle2, AlertTriangle, Archive, Trophy, Undo2, Copy, Send, Plus,
  ChevronDown, ChevronUp, Tag, X, User as UserIcon, Inbox,
} from "lucide-react";
import { PageHeader, Card, Button, Badge, EmptyState, Spinner } from "../components/ui";
import { ModalShell } from "../components/ModalShell";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";
import type { TeamUser } from "../context/AuthContext";
import { onlyDigits } from "../lib/format";
import {
  type Lead, registrarContato, devolverBolsao, descartarLead, moverEtapa,
} from "../lib/leads";
import {
  type Atividade, type Observacao, type Etiqueta, type MensagemPronta,
  type MotivoArquivamento, type DistribuicaoLog, TIPOS_ATIVIDADE,
  atividadesDoLead, atividadeAtual, atividadeAtrasada, concluirAtividade,
  observacoesDoLead, etiquetasDoLead, alternarEtiqueta, favoritosDoUsuario,
  alternarFavorito, logDoLead, renderTemplate, listar, inserir, atualizar,
} from "../lib/c2s";
import type { Modulo } from "../lib/nav";

// ─── Lead 360º — clona/supera a página de detalhe do C2S (docs/C2S-SCAN.md) ──
// campanha/fonte/canal/formulario/interagido_em vêm da migration c2s-parity.sql
// e ainda não fazem parte da interface Lead base (src/lib/leads.ts) — estendemos
// localmente em vez de mexer naquele arquivo (fora do escopo desta página).
interface LeadDetalhado extends Lead {
  campanha?: string | null;
  fonte?: string | null;
  canal?: string | null;
  formulario?: Record<string, unknown> | null;
  interagido_em?: string | null;
}

const dateTimeBR = (v?: string | null) => {
  if (!v) return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
};

function waLink(telefone?: string | null, texto?: string) {
  const digits = onlyDigits(telefone || "");
  if (!digits) return null;
  const comPais = digits.startsWith("55") ? digits : `55${digits}`;
  return `https://wa.me/${comPais}${texto ? `?text=${encodeURIComponent(texto)}` : ""}`;
}

const rotuloTipo = (t: string) => TIPOS_ATIVIDADE.find((x) => x.valor === t)?.rotulo ?? t;

const inputCls = "w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none text-ink focus:border-brand-400";
const lblCls = "block text-xs font-bold text-slate-600 mb-1.5";

// ─── Modal: Transferir lead (só gestor/admin) ────────────────────────────────
function ModalTransferir({ lead, onClose, onDone }: { lead: LeadDetalhado; onClose: () => void; onDone: () => void }) {
  const [equipe, setEquipe] = useState<{ id: string; name: string }[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [alvo, setAlvo] = useState("");
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!supabase) { setCarregando(false); return; }
      const { data } = await supabase.from("profiles").select("id,name")
        .in("role", ["admin", "gestor", "vendedor"]).order("name");
      if (alive) { setEquipe((data as any) ?? []); setCarregando(false); }
    })();
    return () => { alive = false; };
  }, []);

  async function salvar() {
    if (!alvo) { toast.error("Escolha um usuário."); return; }
    setSalvando(true);
    const ok = await atualizar("leads", lead.id, { vendedor_id: alvo, atribuido_em: new Date().toISOString() });
    setSalvando(false);
    if (ok) { toast.success("Lead transferido."); onDone(); } else toast.error("Não foi possível transferir o lead.");
  }

  return (
    <ModalShell onClose={onClose} label="Transferir lead"
      backdropClassName="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold text-ink flex items-center gap-2"><ArrowLeftRight size={18} className="text-brand-500" /> Transferir lead</h3>
        <button onClick={onClose} aria-label="Fechar" className="text-slate-400 hover:text-slate-600 p-1"><X size={18} /></button>
      </div>
      {carregando ? <Spinner /> : (
        <>
          <label className={lblCls}>Novo responsável</label>
          <select className={inputCls} value={alvo} onChange={(e) => setAlvo(e.target.value)}>
            <option value="">Selecione…</option>
            {equipe.filter((p) => p.id !== lead.vendedor_id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <div className="flex gap-2 justify-end mt-4">
            <Button variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button onClick={salvar} disabled={salvando || !alvo}>{salvando ? "Transferindo…" : "Transferir"}</Button>
          </div>
        </>
      )}
    </ModalShell>
  );
}

// ─── Modal: "Por que recebi este lead?" (auditoria da distribuição) ─────────
function ModalPorQue({ leadId, onClose }: { leadId: string; onClose: () => void }) {
  const [logs, setLogs] = useState<DistribuicaoLog[]>([]);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    let alive = true;
    logDoLead(leadId).then((l) => { if (alive) { setLogs(l); setCarregando(false); } });
    return () => { alive = false; };
  }, [leadId]);

  return (
    <ModalShell onClose={onClose} label="Por que recebi este lead?"
      backdropClassName="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[80vh] overflow-y-auto p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold text-ink flex items-center gap-2"><HelpCircle size={18} className="text-brand-500" /> Por que recebi este lead?</h3>
        <button onClick={onClose} aria-label="Fechar" className="text-slate-400 hover:text-slate-600 p-1"><X size={18} /></button>
      </div>
      {carregando ? <Spinner /> : logs.length === 0 ? (
        <p className="text-sm text-muted">Nenhum registro de distribuição encontrado pra este lead.</p>
      ) : (
        <ul className="space-y-3">
          {logs.map((l) => (
            <li key={l.id} className="text-sm border-b border-slate-100 pb-2 last:border-0 last:pb-0">
              <p className="text-ink">{l.motivo}</p>
              <p className="text-xs text-muted mt-0.5">{dateTimeBR(l.created_at)}</p>
            </li>
          ))}
        </ul>
      )}
    </ModalShell>
  );
}

// ─── Modal: Arquivar lead (motivo + observação opcional) ────────────────────
function ModalArquivar({ lead, motivos, userId, onClose, onDone }: {
  lead: LeadDetalhado; motivos: MotivoArquivamento[]; userId?: string; onClose: () => void; onDone: () => void;
}) {
  const [motivo, setMotivo] = useState("");
  const [obs, setObs] = useState("");
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    if (!motivo) { toast.error("Escolha um motivo."); return; }
    setSalvando(true);
    const ok = await descartarLead(lead.id, motivo);
    if (ok && obs.trim() && userId) {
      await inserir("lead_observacoes", { lead_id: lead.id, texto: obs.trim(), criado_por: userId });
    }
    setSalvando(false);
    if (ok) { toast.success("Lead arquivado."); onDone(); } else toast.error("Não foi possível arquivar o lead.");
  }

  return (
    <ModalShell onClose={onClose} label="Arquivar lead"
      backdropClassName="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold text-ink flex items-center gap-2"><Archive size={18} className="text-red-500" /> Arquivar lead</h3>
        <button onClick={onClose} aria-label="Fechar" className="text-slate-400 hover:text-slate-600 p-1"><X size={18} /></button>
      </div>
      <label className={lblCls}>Motivo *</label>
      <select className={inputCls} value={motivo} onChange={(e) => setMotivo(e.target.value)}>
        <option value="">Selecione um motivo…</option>
        {motivos.map((m) => <option key={m.id} value={m.nome}>{m.nome}</option>)}
      </select>
      <label className={`${lblCls} mt-3`}>Observação (opcional)</label>
      <textarea className={`${inputCls} resize-none`} rows={3} value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Detalhe o motivo, se quiser…" />
      <div className="flex gap-2 justify-end mt-4">
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button variant="danger" onClick={salvar} disabled={salvando || !motivo}>{salvando ? "Arquivando…" : "Arquivar"}</Button>
      </div>
    </ModalShell>
  );
}

// ─── Card: WhatsApp rápido com mensagens prontas ─────────────────────────────
function CardWhatsapp({ lead, atual, mensagens, user, onUsar }: {
  lead: LeadDetalhado; atual: Atividade | null; mensagens: MensagemPronta[]; user: TeamUser | null; onUsar: () => void;
}) {
  const [selecionada, setSelecionada] = useState("");
  const template = mensagens.find((m) => m.id === selecionada);
  const texto = template ? renderTemplate(template.conteudo, {
    nomeContato: lead.nome,
    nomeVendedor: user?.name,
    produto: lead.produto_interesse,
    campanha: lead.campanha,
    nomeAtividade: atual ? rotuloTipo(atual.tipo) : undefined,
    dataAtividade: atual ? dateTimeBR(atual.quando) ?? undefined : undefined,
  }) : "";
  const href = waLink(lead.telefone, texto || undefined);

  async function copiar() {
    if (!texto) return;
    try { await navigator.clipboard.writeText(texto); toast.success("Mensagem copiada."); onUsar(); }
    catch { toast.error("Não foi possível copiar a mensagem."); }
  }

  return (
    <Card>
      <h3 className="font-bold text-ink mb-3">WhatsApp rápido</h3>
      {mensagens.length === 0 ? (
        <p className="text-sm text-muted">Nenhuma mensagem pronta cadastrada ainda.</p>
      ) : (
        <>
          <select className={inputCls} value={selecionada} onChange={(e) => setSelecionada(e.target.value)}>
            <option value="">Escolha uma mensagem…</option>
            {mensagens.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
          </select>
          {texto && <div className="mt-3 rounded-xl bg-slate-50 border border-slate-200 p-3 text-sm text-ink whitespace-pre-wrap">{texto}</div>}
          <div className="flex gap-2 mt-3">
            <Button size="sm" variant="outline" icon={Copy} disabled={!texto} onClick={copiar}>Copiar</Button>
            {href && (
              <a href={href} target="_blank" rel="noopener noreferrer" onClick={onUsar}>
                <Button size="sm" variant="wa" icon={Send}>Abrir WhatsApp</Button>
              </a>
            )}
          </div>
        </>
      )}
    </Card>
  );
}

// ─── Painel: Atividades (atual, criar, próximas, histórico) ─────────────────
function PainelAtividades({ atividades, onConcluir, onCriar }: {
  atividades: Atividade[]; onConcluir: (id: string) => void;
  onCriar: (tipo: Atividade["tipo"], titulo: string, quando: string) => void;
}) {
  const atual = atividadeAtual(atividades);
  const pendentes = atividades.filter((a) => a.status === "pendente" && a.id !== atual?.id)
    .sort((a, b) => a.quando.localeCompare(b.quando));
  const concluidas = atividades.filter((a) => a.status !== "pendente")
    .sort((a, b) => (b.concluida_em || b.created_at || "").localeCompare(a.concluida_em || a.created_at || ""));

  const [tipo, setTipo] = useState<Atividade["tipo"]>("retornar");
  const [titulo, setTitulo] = useState(rotuloTipo("retornar"));
  const [data, setData] = useState("");
  const [hora, setHora] = useState("");
  const [historico, setHistorico] = useState(false);

  function mudarTipo(v: string) {
    const t = v as Atividade["tipo"];
    setTipo(t);
    setTitulo(rotuloTipo(t)); // título tem o rótulo como default; usuário pode sobrescrever
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!data || !hora) { toast.error("Informe data e hora da atividade."); return; }
    const quando = new Date(`${data}T${hora}:00`).toISOString();
    onCriar(tipo, titulo.trim() || rotuloTipo(tipo), quando);
    setTitulo(rotuloTipo(tipo)); setData(""); setHora("");
  }

  return (
    <Card>
      <h3 className="font-bold text-ink mb-3">Atividades</h3>

      {atual ? (
        <div className={`rounded-xl p-3 mb-3 flex items-center justify-between gap-3 ${atividadeAtrasada(atual) ? "bg-red-50 border border-red-200" : "bg-brand-50 border border-brand-100"}`}>
          <div className="min-w-0">
            <p className={`text-xs font-bold flex items-center gap-1 ${atividadeAtrasada(atual) ? "text-red-600" : "text-brand-600"}`}>
              {atividadeAtrasada(atual) && <AlertTriangle size={12} />} {atividadeAtrasada(atual) ? "Atrasada" : "Atividade atual"} · {rotuloTipo(atual.tipo)}
            </p>
            <p className="text-sm font-bold text-ink truncate">{atual.titulo}</p>
            <p className="text-xs text-muted">{dateTimeBR(atual.quando)}</p>
          </div>
          <Button size="sm" icon={CheckCircle2} onClick={() => onConcluir(atual.id)}>Concluir</Button>
        </div>
      ) : (
        <p className="text-sm text-muted mb-3">Nenhuma atividade pendente.</p>
      )}

      {pendentes.length > 0 && (
        <div className="mb-3 space-y-1.5">
          <p className="text-xs font-bold text-slate-500">Próximas</p>
          {pendentes.map((a) => (
            <div key={a.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="text-ink truncate">{rotuloTipo(a.tipo)} — {a.titulo} <span className="text-xs text-muted">({dateTimeBR(a.quando)})</span></span>
              <button onClick={() => onConcluir(a.id)} title="Concluir" aria-label={`Concluir ${a.titulo}`} className="text-slate-400 hover:text-green-600 shrink-0"><CheckCircle2 size={16} /></button>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={submit} className="border-t border-slate-100 pt-3 space-y-2">
        <p className="text-xs font-bold text-slate-500">Criar nova atividade</p>
        <select className={inputCls} value={tipo} onChange={(e) => mudarTipo(e.target.value)}>
          {TIPOS_ATIVIDADE.map((t) => <option key={t.valor} value={t.valor}>{t.rotulo}</option>)}
        </select>
        <input className={inputCls} value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Título" />
        <div className="grid grid-cols-2 gap-2">
          <input type="date" className={inputCls} value={data} onChange={(e) => setData(e.target.value)} />
          <input type="time" className={inputCls} value={hora} onChange={(e) => setHora(e.target.value)} />
        </div>
        <Button size="sm" type="submit" icon={Plus}>Criar atividade</Button>
      </form>

      {concluidas.length > 0 && (
        <div className="border-t border-slate-100 mt-3 pt-3">
          <button onClick={() => setHistorico((h) => !h)} className="text-xs font-bold text-slate-500 flex items-center gap-1">
            {historico ? <ChevronUp size={13} /> : <ChevronDown size={13} />} Histórico ({concluidas.length})
          </button>
          {historico && (
            <ul className="mt-2 space-y-1.5">
              {concluidas.map((a) => (
                <li key={a.id} className="text-xs text-muted flex items-center gap-1.5">
                  <CheckCircle2 size={12} className="text-green-500 shrink-0" /> {rotuloTipo(a.tipo)} — {a.titulo} ({dateTimeBR(a.concluida_em ?? a.quando)})
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}

// ─── Painel: Etiquetas ────────────────────────────────────────────────────────
function PainelEtiquetas({ tags, disponiveis, onToggle }: {
  tags: Etiqueta[]; disponiveis: Etiqueta[]; onToggle: (etiquetaId: string, tem: boolean) => void;
}) {
  const [novaId, setNovaId] = useState("");
  const restantes = disponiveis.filter((d) => !tags.some((t) => t.id === d.id));

  return (
    <Card>
      <h3 className="font-bold text-ink mb-3 flex items-center gap-1.5"><Tag size={16} className="text-brand-500" /> Etiquetas</h3>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {tags.length === 0 && <p className="text-sm text-muted">Nenhuma etiqueta ainda.</p>}
        {tags.map((t) => (
          <span key={t.id} className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full text-white" style={{ background: t.cor }}>
            {t.nome}
            <button onClick={() => onToggle(t.id, true)} aria-label={`Remover etiqueta ${t.nome}`} className="hover:opacity-70"><X size={11} /></button>
          </span>
        ))}
      </div>
      {restantes.length > 0 && (
        <div className="flex gap-2">
          <select className={inputCls} value={novaId} onChange={(e) => setNovaId(e.target.value)}>
            <option value="">Adicionar etiqueta…</option>
            {restantes.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
          </select>
          <Button size="sm" disabled={!novaId} onClick={() => { onToggle(novaId, false); setNovaId(""); }}>Adicionar</Button>
        </div>
      )}
    </Card>
  );
}

// ─── Painel: Observações ──────────────────────────────────────────────────────
function PainelObservacoes({ observacoes, pessoas, texto, onTexto, onAdicionar }: {
  observacoes: Observacao[]; pessoas: Record<string, string>;
  texto: string; onTexto: (v: string) => void; onAdicionar: () => void;
}) {
  return (
    <Card>
      <h3 className="font-bold text-ink mb-3">Observações</h3>
      <textarea className={`${inputCls} resize-none`} rows={3} placeholder="Escreva uma observação sobre este lead…" value={texto} onChange={(e) => onTexto(e.target.value)} />
      <div className="flex justify-end mt-2">
        <Button size="sm" icon={Plus} disabled={!texto.trim()} onClick={onAdicionar}>Adicionar</Button>
      </div>
      {observacoes.length > 0 && (
        <ul className="mt-4 space-y-3 border-t border-slate-100 pt-3">
          {observacoes.map((o) => (
            <li key={o.id} className="text-sm">
              <p className="text-ink whitespace-pre-wrap">{o.texto}</p>
              <p className="text-xs text-muted mt-0.5">{o.criado_por ? (pessoas[o.criado_por] ?? "—") : "—"} · {dateTimeBR(o.created_at)}</p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────
export function LeadDetalhe() {
  const { id } = useParams();
  const location = useLocation();
  const { user, isManager } = useAuth();
  // A rota é /seguros/leads/:id ou /consorcios/leads/:id (sem :modulo real na
  // definição de rota) — o módulo vem do prefixo do caminho.
  const modulo: Modulo = location.pathname.startsWith("/consorcios") ? "consorcios" : "seguros";

  const [lead, setLead] = useState<LeadDetalhado | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [avisoParity, setAvisoParity] = useState(false);

  const [responsavel, setResponsavel] = useState<{ id: string; name: string } | null>(null);
  const [favorito, setFavorito] = useState(false);
  const [pessoas, setPessoas] = useState<Record<string, string>>({});

  const [atividades, setAtividades] = useState<Atividade[]>([]);
  const [observacoes, setObservacoes] = useState<Observacao[]>([]);
  const [etiquetasLead, setEtiquetasLead] = useState<Etiqueta[]>([]);
  const [todasEtiquetas, setTodasEtiquetas] = useState<Etiqueta[]>([]);
  const [mensagensProntas, setMensagensProntas] = useState<MensagemPronta[]>([]);
  const [motivos, setMotivos] = useState<MotivoArquivamento[]>([]);
  const [novaObs, setNovaObs] = useState("");

  const [showTransferir, setShowTransferir] = useState(false);
  const [showPorque, setShowPorque] = useState(false);
  const [showArquivar, setShowArquivar] = useState(false);

  async function carregarTudo(leadId: string, aliveRef: { current: boolean }) {
    if (!supabase) { if (aliveRef.current) setLoading(false); return; }
    const { data: leadData, error } = await supabase.from("leads").select("*").eq("id", leadId).single();
    if (!aliveRef.current) return;
    if (error || !leadData) { setNotFound(true); setLoading(false); return; }
    const l = leadData as LeadDetalhado;

    const [parityCheck, ativs, obs, tags, allTags, msgs, mots, favs] = await Promise.all([
      supabase.from("lead_atividades").select("id").limit(1),
      atividadesDoLead(leadId),
      observacoesDoLead(leadId),
      etiquetasDoLead(leadId),
      listar<Etiqueta>("etiquetas"),
      listar<MensagemPronta>("mensagens_prontas", "ordem"),
      listar<MotivoArquivamento>("motivos_arquivamento", "nome"),
      user ? favoritosDoUsuario(user.id) : Promise.resolve(new Set<string>()),
    ]);
    if (!aliveRef.current) return;

    // Nomes de responsável/autores num único round-trip
    const ids = new Set<string>();
    if (l.vendedor_id) ids.add(l.vendedor_id);
    ativs.forEach((a) => a.criado_por && ids.add(a.criado_por));
    obs.forEach((o) => o.criado_por && ids.add(o.criado_por));
    let mapaPessoas: Record<string, string> = {};
    if (ids.size) {
      const { data: perfis } = await supabase.from("profiles").select("id,name").in("id", Array.from(ids));
      (perfis || []).forEach((p: any) => { mapaPessoas[p.id] = p.name; });
    }
    if (!aliveRef.current) return;

    setLead(l);
    setAvisoParity(!!parityCheck.error);
    setAtividades(ativs);
    setObservacoes(obs);
    setEtiquetasLead(tags);
    setTodasEtiquetas(allTags.filter((e) => e.ativa));
    setMensagensProntas(msgs.filter((m) => m.ativa));
    setMotivos(mots.filter((m) => m.ativo));
    setFavorito(favs.has(leadId));
    setPessoas(mapaPessoas);
    setResponsavel(l.vendedor_id && mapaPessoas[l.vendedor_id] ? { id: l.vendedor_id, name: mapaPessoas[l.vendedor_id] } : null);
    setLoading(false);
  }

  useEffect(() => {
    const aliveRef = { current: true };
    if (!id) { setNotFound(true); setLoading(false); return; }
    setLoading(true);
    setNotFound(false);
    carregarTudo(id, aliveRef);
    return () => { aliveRef.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  function reload() { if (id) carregarTudo(id, { current: true }); }

  async function toggleFavorito() {
    if (!user || !lead) return;
    const era = favorito;
    setFavorito(!era);
    const ok = await alternarFavorito(user.id, lead.id, era);
    if (!ok) { setFavorito(era); toast.error("Não foi possível atualizar o favorito."); }
  }

  async function onFecharNegocio() {
    if (!lead) return;
    try {
      await moverEtapa(lead.id, "ganho");
      setLead((p) => (p ? { ...p, etapa: "ganho" } : p));
      toast.success("Negócio marcado como fechado!");
    } catch { toast.error("Não foi possível fechar o negócio."); }
  }

  async function onDevolverBolsao() {
    if (!lead) return;
    await devolverBolsao(lead.id);
    setLead((p) => (p ? { ...p, vendedor_id: null, atribuido_em: null, sla_expira_em: null } : p));
    setResponsavel(null);
    toast.success("Lead devolvido ao bolsão.");
  }

  async function onUsarWhatsapp() {
    if (!lead) return;
    const now = new Date().toISOString();
    await atualizar("leads", lead.id, { interagido_em: now });
    if (!lead.primeiro_contato_em) await registrarContato(lead.id);
    setLead((p) => (p ? { ...p, interagido_em: now, primeiro_contato_em: p.primeiro_contato_em ?? now } : p));
  }

  async function onConcluirAtividade(atividadeId: string) {
    const ok = await concluirAtividade(atividadeId);
    if (!ok) { toast.error("Não foi possível concluir a atividade."); return; }
    if (lead) {
      const now = new Date().toISOString();
      await atualizar("leads", lead.id, { interagido_em: now });
      setLead((p) => (p ? { ...p, interagido_em: now } : p));
    }
    toast.success("Atividade concluída.");
    reload();
  }

  async function onCriarAtividade(tipo: Atividade["tipo"], titulo: string, quando: string) {
    if (!lead || !user) return;
    const ok = await inserir("lead_atividades", { lead_id: lead.id, tipo, titulo, quando, status: "pendente", criado_por: user.id });
    if (!ok) { toast.error(`Não foi possível criar a atividade.${avisoParity ? " Rode a migration supabase/c2s-parity.sql." : ""}`); return; }
    toast.success("Atividade criada.");
    reload();
  }

  async function onToggleEtiqueta(etiquetaId: string, tem: boolean) {
    if (!lead) return;
    const ok = await alternarEtiqueta(lead.id, etiquetaId, tem);
    if (!ok) { toast.error("Não foi possível atualizar a etiqueta."); return; }
    setEtiquetasLead((prev) => {
      if (tem) return prev.filter((e) => e.id !== etiquetaId);
      const nova = todasEtiquetas.find((e) => e.id === etiquetaId);
      return nova ? [...prev, nova] : prev;
    });
  }

  async function onAdicionarObs() {
    if (!lead || !user || !novaObs.trim()) return;
    const ok = await inserir("lead_observacoes", { lead_id: lead.id, texto: novaObs.trim(), criado_por: user.id });
    if (!ok) { toast.error(`Não foi possível salvar a observação.${avisoParity ? " Rode a migration supabase/c2s-parity.sql." : ""}`); return; }
    const now = new Date().toISOString();
    await atualizar("leads", lead.id, { interagido_em: now });
    setLead((p) => (p ? { ...p, interagido_em: now } : p));
    setNovaObs("");
    toast.success("Observação adicionada.");
    reload();
  }

  if (loading) {
    return (
      <>
        <PageHeader title="Lead" icon={MessageCircle} />
        <Spinner label="Carregando lead..." />
      </>
    );
  }

  if (notFound || !lead) {
    return (
      <>
        <PageHeader title="Lead" icon={MessageCircle} />
        <Card pad={false}>
          <EmptyState icon={Inbox} title="Lead não encontrado"
            hint="Esse lead pode ter sido removido ou o link está incorreto."
            action={<Link to={`/${modulo}/pipeline`}><Button variant="outline" icon={ArrowLeft}>Voltar ao pipeline</Button></Link>} />
        </Card>
      </>
    );
  }

  const waHref = waLink(lead.telefone);

  return (
    <>
      <Link to={`/${modulo}/pipeline`} className="inline-flex items-center gap-1.5 text-xs font-bold text-muted hover:text-brand-600 mb-3">
        <ArrowLeft size={14} /> Voltar
      </Link>

      {avisoParity && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 text-amber-800 text-xs font-semibold px-4 py-3 flex items-center gap-2">
          <AlertTriangle size={15} className="shrink-0" />
          Algumas funções (atividades, etiquetas, observações, mensagens prontas) exigem uma migration ainda não aplicada. Rode <code className="bg-amber-100 px-1 rounded">supabase/c2s-parity.sql</code> no Supabase.
        </div>
      )}

      {/* Cabeçalho */}
      <Card className="mb-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-display text-ink leading-tight">{lead.nome}</h1>
              <button onClick={toggleFavorito} title={favorito ? "Remover dos favoritos" : "Favoritar"}
                aria-label={favorito ? "Remover dos favoritos" : "Favoritar"}
                className={`p-1.5 rounded-lg ${favorito ? "text-amber-500" : "text-slate-300 hover:text-amber-400"}`}>
                <Star size={20} fill={favorito ? "currentColor" : "none"} />
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {lead.produto_interesse && <Badge tone="blue">{lead.produto_interesse}</Badge>}
              {lead.campanha && <Badge tone="violet">{lead.campanha}</Badge>}
              {(lead.fonte || lead.canal) && <Badge tone="amber">{[lead.fonte, lead.canal].filter(Boolean).join(" · ")}</Badge>}
              {lead.origem && <Badge tone="slate">{lead.origem}</Badge>}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-3 text-sm text-muted">
              {lead.telefone && <span className="flex items-center gap-1.5"><Phone size={13} /> {lead.telefone}</span>}
              {waHref && (
                <a href={waHref} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-bold text-[#25d366] bg-green-50 px-2 py-1 rounded-lg">
                  <MessageCircle size={12} /> WhatsApp
                </a>
              )}
              {lead.email && <a href={`mailto:${lead.email}`} className="flex items-center gap-1.5 hover:text-brand-600"><Mail size={13} /> {lead.email}</a>}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs text-muted">
              <span className="flex items-center gap-1"><UserIcon size={12} /> {responsavel ? responsavel.name : "Sem responsável"}</span>
              <span>Recebido em {dateTimeBR(lead.created_at) ?? "—"}</span>
              <span>Interagido em {dateTimeBR(lead.interagido_em) ?? "nunca"}</span>
            </div>
            <button onClick={() => setShowPorque(true)} className="text-xs font-bold text-brand-500 hover:text-brand-700 mt-2 inline-flex items-center gap-1">
              <HelpCircle size={12} /> Por que recebi este lead?
            </button>
          </div>
          {isManager && (
            <Button variant="outline" icon={ArrowLeftRight} onClick={() => setShowTransferir(true)}>Transferir</Button>
          )}
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-[1.3fr_1fr] gap-5">
        {/* Coluna esquerda */}
        <div className="space-y-5">
          <Card>
            <h3 className="font-bold text-ink mb-3">Mensagem do lead</h3>
            {lead.mensagem ? <p className="text-sm text-ink whitespace-pre-wrap">{lead.mensagem}</p> : <p className="text-sm text-muted">Sem mensagem inicial.</p>}
            {lead.formulario && typeof lead.formulario === "object" && Object.keys(lead.formulario).length > 0 && (
              <div className="mt-4 border-t border-slate-100 pt-3">
                <p className="text-xs font-bold text-slate-500 mb-2">Respostas do formulário</p>
                <dl className="space-y-2">
                  {Object.entries(lead.formulario).map(([pergunta, resposta]) => (
                    <div key={pergunta} className="text-sm">
                      <dt className="text-xs text-muted">{pergunta}</dt>
                      <dd className="text-ink font-semibold">{String(resposta)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
          </Card>

          <CardWhatsapp lead={lead} atual={atividadeAtual(atividades)} mensagens={mensagensProntas} user={user} onUsar={onUsarWhatsapp} />
        </div>

        {/* Coluna direita */}
        <div className="space-y-5">
          <Card>
            <h3 className="font-bold text-ink mb-3">Mantenha seu lead atualizado</h3>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" icon={Trophy} onClick={onFecharNegocio}>Marcar negócio fechado</Button>
              <Button size="sm" variant="outline" icon={Archive} onClick={() => setShowArquivar(true)}>Arquivar lead</Button>
              <Button size="sm" variant="outline" icon={Undo2} onClick={onDevolverBolsao}>Devolver ao bolsão</Button>
            </div>
          </Card>

          <PainelAtividades atividades={atividades} onConcluir={onConcluirAtividade} onCriar={onCriarAtividade} />
          <PainelEtiquetas tags={etiquetasLead} disponiveis={todasEtiquetas} onToggle={onToggleEtiqueta} />
          <PainelObservacoes observacoes={observacoes} pessoas={pessoas} texto={novaObs} onTexto={setNovaObs} onAdicionar={onAdicionarObs} />
        </div>
      </div>

      {showTransferir && (
        <ModalTransferir lead={lead} onClose={() => setShowTransferir(false)} onDone={() => { setShowTransferir(false); reload(); }} />
      )}
      {showPorque && <ModalPorQue leadId={lead.id} onClose={() => setShowPorque(false)} />}
      {showArquivar && (
        <ModalArquivar lead={lead} motivos={motivos} userId={user?.id} onClose={() => setShowArquivar(false)} onDone={() => { setShowArquivar(false); reload(); }} />
      )}
    </>
  );
}

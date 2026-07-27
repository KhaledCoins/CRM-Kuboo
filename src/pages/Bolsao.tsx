import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Inbox, Phone, MessageCircle, Hand, Clock, Flame, Tag, AlertTriangle, Snowflake, ThermometerSun, X, Shuffle, ExternalLink, MoonStar } from "lucide-react";
import { PageHeader, Card, KpiCard, Button, Badge, EmptyState, Spinner, FilterBar, Select } from "../components/ui";
import { fetchLeads, pegarLead, descartarLead, distribuirBolsao, noBolsao, moduloDe, prioridadeLead, temperaturaLead, getBolsaoConfig, type Lead, type Temperatura } from "../lib/leads";
import { DIAS_SEMANA, minutosLabel, type BolsaoConfig, type HorarioSemana } from "../lib/c2s";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";
import { brl, onlyDigits } from "../lib/format";

function esperaLabel(l: Lead): { txt: string; urgente: boolean } {
  const base = l.created_at ? new Date(l.created_at).getTime() : Date.now();
  const min = Math.floor((Date.now() - base) / 60000);
  const urgente = min >= 15;
  if (min < 1) return { txt: "agora mesmo", urgente: false };
  if (min < 60) return { txt: `há ${min} min`, urgente };
  const h = Math.floor(min / 60);
  if (h < 24) return { txt: `há ${h}h`, urgente: true };
  return { txt: `há ${Math.floor(h / 24)}d`, urgente: true };
}

const origemTone: Record<string, "blue" | "green" | "violet" | "amber" | "slate"> = {
  chatbot: "blue", formulario: "green", whatsapp: "green", indicacao: "violet", portal: "amber",
};

const tempMeta: Record<Temperatura, { label: string; tone: "red" | "amber" | "blue"; Icon: typeof Flame }> = {
  quente: { label: "Quente", tone: "red", Icon: Flame },
  morno: { label: "Morno", tone: "amber", Icon: ThermometerSun },
  frio: { label: "Frio", tone: "blue", Icon: Snowflake },
};

// ─── Horário do bolsão (bolsao_config.horario, fuso America/Sao_Paulo) ──────
const DIAS_ORDEM: (keyof HorarioSemana)[] = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"];
const WEEKDAY_EN: Record<string, keyof HorarioSemana> = { Sun: "dom", Mon: "seg", Tue: "ter", Wed: "qua", Thu: "qui", Fri: "sex", Sat: "sab" };

/** Dia (chave de HorarioSemana) e "HH:MM" AGORA no fuso de São Paulo — não usa
 *  o relógio local do navegador (o vendedor pode estar em outro fuso). */
function agoraSP(): { dia: keyof HorarioSemana; hhmm: string } {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const mapa: Record<string, string> = {};
  partes.forEach((p) => { mapa[p.type] = p.value; });
  return { dia: WEEKDAY_EN[mapa.weekday] ?? "seg", hhmm: `${mapa.hour}:${mapa.minute}` };
}

/** Está aberto agora? horario null/undefined = sempre ativo; dia com
 *  ativo:false (ou fora da janela ini–fim) = fechado. Se fechado, calcula a
 *  próxima janela (hoje mais tarde ou os próximos dias) pro banner "volta às".
 *  cfg null (ainda carregando ou bolsao_config falhou) = trata como aberto,
 *  não bloqueia a equipe por causa de uma falha de rede. */
function statusBolsao(cfg: BolsaoConfig | null): { aberto: boolean; proximaLabel: string | null } {
  if (!cfg) return { aberto: true, proximaLabel: null };
  if (!cfg.ativo) return { aberto: false, proximaLabel: null }; // desligado manualmente, sem previsão de volta
  if (!cfg.horario) return { aberto: true, proximaLabel: null };
  const horario = cfg.horario;
  const { dia, hhmm } = agoraSP();
  const hoje = horario[dia];
  if (hoje?.ativo && hhmm >= hoje.ini && hhmm < hoje.fim) return { aberto: true, proximaLabel: null };
  if (hoje?.ativo && hhmm < hoje.ini) return { aberto: false, proximaLabel: hoje.ini }; // ainda abre hoje
  const idxHoje = DIAS_ORDEM.indexOf(dia);
  for (let i = 1; i <= 7; i++) {
    const chave = DIAS_ORDEM[(idxHoje + i) % 7];
    const d = horario[chave];
    if (d?.ativo) {
      const rotulo = DIAS_SEMANA.find((x) => x.chave === chave)?.curto ?? chave;
      return { aberto: false, proximaLabel: `${rotulo} ${d.ini}` };
    }
  }
  return { aberto: false, proximaLabel: null }; // nenhum dia da semana está ativo na config
}

export function Bolsao({ modulo }: { modulo: "seguros" | "consorcios" }) {
  const navigate = useNavigate();
  const { user, isManager } = useAuth();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [origem, setOrigem] = useState("");
  const [claiming, setClaiming] = useState<string | null>(null);
  const [distribuindo, setDistribuindo] = useState(false);
  const [tick, setTick] = useState(0);
  const [bolsaoCfg, setBolsaoCfg] = useState<BolsaoConfig | null>(null);

  // escopo 'equipe' (bolsao_config.escopo) ainda não tem efeito: o CRM hoje
  // não tem o conceito de múltiplas equipes, só uma empresa só. Quando isso
  // existir, filtrar `leads` aqui pela equipe do usuário logado. Por ora,
  // 'equipe' e 'empresa' se comportam igual (todo mundo vê o bolsão inteiro).
  useEffect(() => { getBolsaoConfig().then(setBolsaoCfg); }, [modulo]);

  // guarda de corrida: /seguros/bolsao ↔ /consorcios/bolsao é o MESMO componente
  // (só muda a prop) — sem o token, uma resposta atrasada do módulo anterior
  // sobrescreveria a lista do módulo atual.
  const loadReq = useRef(0);
  async function load() {
    const req = ++loadReq.current;
    try {
      const all = await fetchLeads();
      if (req !== loadReq.current) return;
      // só os leads DESTE módulo (antes /seguros/bolsao e /consorcios/bolsao mostravam a mesma lista)
      setLeads(all.filter((l) => moduloDe(l) === modulo && noBolsao(l) && !l.descartado));
    } catch (e) {
      console.error("[bolsao] load:", e);
    } finally {
      if (req === loadReq.current) setLoading(false);
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [modulo]);
  // Recalcula SLA/espera a cada 10s
  useEffect(() => { const t = setInterval(() => setTick((x) => x + 1), 10000); return () => clearInterval(t); }, []);

  // tick nas deps também recalcula o status (aberto/fechado pode mudar sozinho
  // quando o relógio cruza o fim da janela, sem precisar recarregar a config).
  const { aberto: bolsaoAberto, proximaLabel } = useMemo(() => statusBolsao(bolsaoCfg), [bolsaoCfg, tick]);

  // ordena por PRIORIDADE (score + espera) — o consultor ataca o melhor lead primeiro.
  // tick nas deps: reordena a cada 10s p/ um lead que esfria/atrasa subir de posição.
  const filtered = useMemo(
    () => leads.filter((l) => !origem || l.origem === origem)
               // fora do horário do bolsão, só os leads SEM DONO ficam visíveis (o
               // gestor ainda pode distribuí-los manualmente) — os "reciclados" por
               // SLA estourado somem até o bolsão reabrir.
               .filter((l) => bolsaoAberto || !l.vendedor_id)
               .sort((a, b) => prioridadeLead(b) - prioridadeLead(a)),
    [leads, origem, tick, bolsaoAberto]
  );

  async function handlePegar(id: string) {
    if (!user) return;
    if (!bolsaoAberto) { toast.warning(`Bolsão fora do horário${proximaLabel ? ` — volta às ${proximaLabel}` : ""}.`); return; }
    setClaiming(id);
    try {
      const ok = await pegarLead(id, user.id);
      if (ok) toast.success("Lead é seu! Ele já está no seu Pipeline.");
      else toast.warning("Esse lead acabou de ser pego por outro consultor.");
      setLeads((prev) => prev.filter((l) => l.id !== id)); // sai da fila nos dois casos
    } catch (e) {
      console.error("[bolsao] pegar:", e);
      toast.error("Não foi possível pegar o lead agora. Tente de novo.");
    } finally {
      setClaiming(null); // nunca deixa o botão preso em loading
    }
  }

  // Rodízio (gestor/admin): reparte o bolsão entre os vendedores por prioridade.
  // Complementa o "pegar lead" — não o substitui.
  async function handleDistribuir() {
    if (!supabase || !filtered.length) return;
    const { data: vendedores } = await supabase.from("profiles").select("id,name").in("role", ["vendedor", "gestor", "admin"]).limit(50);
    const ids = (vendedores || []).map((v) => v.id);
    if (!ids.length) { toast.error("Nenhum vendedor encontrado pra distribuir."); return; }
    if (!window.confirm(`Distribuir ${filtered.length} lead(s) em rodízio entre ${ids.length} membro(s) da equipe?`)) return;
    setDistribuindo(true);
    const r = await distribuirBolsao(filtered, ids);
    setDistribuindo(false);
    if (r.distribuidos) toast.success(`${r.distribuidos} lead(s) distribuído(s)${r.pulados ? ` · ${r.pulados} pulado(s)` : ""}.`);
    else toast.warning("Nada foi distribuído (leads já pegos ou sem permissão).");
    load();
  }

  async function handleDescartar(l: Lead) {
    const motivo = window.prompt(`Descartar "${l.nome}" do bolsão?\nMotivo (spam, duplicado, sem interesse...):`, "");
    if (motivo === null) return; // cancelou
    const ok = await descartarLead(l.id, motivo);
    if (ok) {
      toast.success("Lead descartado do bolsão.");
      setLeads((prev) => prev.filter((x) => x.id !== l.id));
    } else {
      toast.error("Não foi possível descartar (rode a migration crm-leads-manage.sql).");
    }
  }

  const urgentes = leads.filter((l) => esperaLabel(l).urgente).length;
  const quentes = leads.filter((l) => temperaturaLead(l) === "quente").length;

  return (
    <>
      <PageHeader
        title="Bolsão de Leads"
        subtitle="Ordenado por prioridade — os leads mais quentes e urgentes primeiro"
        icon={Inbox}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KpiCard label="Leads no Bolsão" value={String(leads.length)} icon={Inbox} accent="brand" />
        <KpiCard label="Leads quentes" value={String(quentes)} icon={Flame} accent="danger" hint="Alta chance de fechar — priorize" />
        <KpiCard label="Aguardando +15 min" value={String(urgentes)} icon={AlertTriangle} accent="warning" hint="Esfriando — atenda já" />
        <KpiCard label="SLA de 1º contato" value={minutosLabel(bolsaoCfg?.limite_minutos ?? 20)} icon={Clock} accent="sky" hint="Após pegar, contate no prazo" />
      </div>

      <FilterBar>
        <Select value={origem} onChange={setOrigem} placeholder="Todas as origens" options={[
          { value: "chatbot", label: "Kubinho (chatbot)" }, { value: "formulario", label: "Formulário" },
          { value: "whatsapp", label: "WhatsApp" }, { value: "indicacao", label: "Indicação" }, { value: "portal", label: "Portal" },
        ]} />
        {isManager && filtered.length > 0 && (
          <Button variant="outline" icon={Shuffle} onClick={handleDistribuir} disabled={distribuindo}>
            {distribuindo ? "Distribuindo..." : "Distribuir em rodízio"}
          </Button>
        )}
      </FilterBar>

      {!bolsaoAberto && (
        <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 flex items-center gap-2">
          <MoonStar size={16} className="shrink-0 text-slate-400" />
          <span>
            Bolsão fora do horário{proximaLabel ? ` — leads voltam a ficar disponíveis às ${proximaLabel}` : ""}.
            {isManager && " Leads sem dono continuam visíveis para distribuir manualmente."}
          </span>
        </div>
      )}

      {loading ? (
        <Spinner label="Carregando o bolsão..." />
      ) : filtered.length === 0 ? (
        <Card pad={false}>
          <EmptyState icon={Inbox} title="Bolsão vazio" hint="Nenhum lead aguardando. Assim que entrar um lead novo (site, Kubinho, WhatsApp) ou um SLA estourar, ele aparece aqui pra equipe pegar." />
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((l) => {
            const espera = esperaLabel(l);
            const wa = l.telefone ? `https://wa.me/55${onlyDigits(l.telefone)}` : null;
            const reciclado = !!l.vendedor_id; // voltou ao bolsão por SLA estourado
            const temp = temperaturaLead(l);
            const tm = tempMeta[temp];
            return (
              <Card key={l.id} className={temp === "quente" ? "ring-2 ring-red-300" : espera.urgente ? "ring-1 ring-red-200" : ""}>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <button
                    onClick={() => navigate(`/${modulo}/leads/${l.id}`)}
                    title="Abrir detalhe do lead"
                    className="font-bold text-ink text-left hover:text-brand-600 hover:underline underline-offset-2"
                  >
                    {l.nome}
                  </button>
                  <span className={`text-xs font-bold flex items-center gap-1 shrink-0 ${espera.urgente ? "text-red-600" : "text-muted"}`}>
                    {espera.urgente && <AlertTriangle size={12} />}<Clock size={12} /> {espera.txt}
                  </span>
                </div>

                <div className="flex flex-wrap gap-1.5 mb-3">
                  <Badge tone={tm.tone}><tm.Icon size={11} /> {tm.label}</Badge>
                  {l.produto_interesse && <Badge tone="blue"><Tag size={11} /> {l.produto_interesse}</Badge>}
                  {l.origem && <Badge tone={origemTone[l.origem] ?? "slate"}>{l.origem}</Badge>}
                  {reciclado && <Badge tone="amber">SLA estourado</Badge>}
                  {l.valor_potencial ? <Badge tone="green">{brl(l.valor_potencial)}</Badge> : null}
                </div>

                {l.telefone && <p className="text-xs text-muted flex items-center gap-1 mb-1"><Phone size={12} /> {l.telefone}</p>}
                {l.mensagem && <p className="text-xs text-slate-500 line-clamp-2 mb-3">"{l.mensagem}"</p>}

                <div className="flex items-center gap-2 mt-3">
                  <Button size="sm" icon={Hand} onClick={() => handlePegar(l.id)} disabled={claiming === l.id || !bolsaoAberto}>
                    {claiming === l.id ? "Pegando..." : !bolsaoAberto ? "Fora do horário" : "Pegar lead"}
                  </Button>
                  {wa && (
                    <a href={wa} target="_blank" rel="noopener noreferrer">
                      <Button size="sm" variant="wa" icon={MessageCircle}>WhatsApp</Button>
                    </a>
                  )}
                  <button
                    onClick={() => navigate(`/${modulo}/leads/${l.id}`)}
                    title="Abrir detalhe do lead"
                    aria-label={`Abrir detalhe de ${l.nome}`}
                    className="ml-auto text-muted hover:text-brand-600 transition-colors p-1.5 rounded-lg hover:bg-brand-50"
                  >
                    <ExternalLink size={16} />
                  </button>
                  <button
                    onClick={() => handleDescartar(l)}
                    title="Descartar (spam, duplicado, sem interesse)"
                    aria-label={`Descartar lead ${l.nome}`}
                    className="text-muted hover:text-red-600 transition-colors p-1.5 rounded-lg hover:bg-red-50"
                  >
                    <X size={16} />
                  </button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}

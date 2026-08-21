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

// Etapas que só existem depois de falar com o cliente. Mover pra uma delas é
// atendimento: tem que PARAR o relógio do SLA, senão o lead segue "não
// atendido", o SLA estoura e ele volta pro BOLSÃO no meio da negociação —
// qualquer colega pode pegá-lo. Mesmo estrago que o espelho do C2S causava
// (lead Antonio, 20/08), agora pelo lado do CRM.
export const ETAPAS_DE_ATENDIMENTO = ["contato", "cotacao", "negociacao", "ganho"];

// Espelho do noBolsao() em PostgREST — fonte ÚNICA do "está no bolsão?" pro
// banco. A regra tinha três donos (noBolsao, pegarLead e contarBolsao) e só o
// primeiro conhecia a rede de segurança das etapas: o badge contava lead em
// negociação (número que a lista não mostrava) e, muito pior, pegarLead
// deixava OUTRO consultor TOMAR um lead já em atendimento — exatamente o
// estrago que a rede de segurança existe pra impedir.
// `etapa.is.null` junto porque no SQL `null not in (...)` é NULL, não true: o
// lead sem etapa sumiria do bolsão em vez de entrar nele.
function filtroBolsao(agora: string): string {
  const emAtendimento = `or(etapa.is.null,etapa.not.in.(${ETAPAS_DE_ATENDIMENTO.join(",")}))`;
  return `vendedor_id.is.null,and(primeiro_contato_em.is.null,sla_expira_em.lt.${agora},${emAtendimento})`;
}

/** Lead está no bolsão? (sem dono OU sem 1º contato e SLA estourado) */
export function noBolsao(l: Lead): boolean {
  if (!l.vendedor_id) return true;
  // Rede de segurança: lead que já avançou no funil está SENDO trabalhado —
  // não pode ser reciclado pro bolsão nem que o 1º contato não tenha sido
  // registrado (dado antigo, evento do C2S fora de ordem, etc).
  if (ETAPAS_DE_ATENDIMENTO.includes(String(l.etapa ?? ""))) return false;
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
// MeusLeads) usa fetchLeadsArquivados, que pagina no SERVIDOR. Limite alto +
// warning quando estourar, pra nunca truncar a base em silêncio.
const FETCH_LIMIT = 3000;

// Devolve o ERRO junto, de propósito. Antes devolvia só `Lead[]`, e uma falha
// de rede ou de sessão virava lista vazia — que as telas mostravam como
// "Bolsão vazio", "Nenhum lead em atendimento", "Nada pra fazer agora". O
// consultor concluía que não tinha trabalho e ia embora, com leads pagos
// esperando. A assinatura mudou de propósito: assim o compilador obriga TODA
// tela a decidir o que fazer com a falha, em vez de deixar passar em silêncio.
export type LeadsCarregados = { leads: Lead[]; erro: string | null };

export async function fetchLeads(opts?: { incluirDescartados?: boolean }): Promise<LeadsCarregados> {
  if (!supabase) return { leads: [], erro: "Supabase não configurado" };
  let q = supabase.from("leads").select("*").order("created_at", { ascending: false }).limit(FETCH_LIMIT);
  if (!opts?.incluirDescartados) q = q.eq("descartado", false);
  const { data, error } = await q;
  if (error) {
    console.error("[leads] fetchLeads:", error.message);
    return { leads: [], erro: error.message };
  }
  if (data && data.length === FETCH_LIMIT) console.warn(`[leads] fetchLeads atingiu o teto de ${FETCH_LIMIT} — leads mais antigos fora da lista; hora de paginar.`);
  return { leads: (data as any) ?? [], erro: null };
}

// ─── Aba "Arquivados" pagina no SERVIDOR ────────────────────────────────────
// O histórico de descartados só cresce (todo o legado do C2S mora aqui) e vinha
// inteiro junto dos ativos — a tela Meus Leads pagava esse peso em TODA visita.
// Agora os ativos carregam sozinhos e os arquivados vêm em páginas, com busca e
// filtros resolvidos no banco: o cliente só baixa o que vai mostrar.
export const ARQUIVADOS_POR_PAGINA = 100;

export interface ArquivadosOpts {
  modulo: "seguros" | "consorcios";
  pagina?: number; // 0-based; ignorado com contarApenas
  busca?: string; // nome/telefone/e-mail/produto — ilike no servidor
  origem?: string;
  periodoDias?: number; // criados nos últimos N dias
  vendedorId?: string | null; // escopo: vendedor logado ou "Ver como" do gestor
  leadIds?: string[] | null; // pré-filtro por etiqueta (ids resolvidos no cliente)
  contarApenas?: boolean; // só o total (badge da aba), sem baixar linha nenhuma
}

export async function fetchLeadsArquivados(opts: ArquivadosOpts): Promise<{ leads: Lead[]; total: number }> {
  if (!supabase) return { leads: [], total: 0 };
  // Filtro de etiqueta sem nenhum lead vinculado: resultado é vazio por
  // definição — devolve direto em vez de mandar um `id=in.()` pro PostgREST.
  if (opts.leadIds && opts.leadIds.length === 0) return { leads: [], total: 0 };

  let q = supabase
    .from("leads")
    .select(opts.contarApenas ? "id" : "*", { count: "exact", head: !!opts.contarApenas })
    .eq("descartado", true);
  // Mesma regra de moduloDe(): só "consorcios" explícito é consórcio; o resto
  // (null incluso) conta como seguros.
  q = opts.modulo === "consorcios" ? q.eq("modulo", "consorcios") : q.or("modulo.neq.consorcios,modulo.is.null");
  if (opts.vendedorId) q = q.eq("vendedor_id", opts.vendedorId);
  if (opts.origem) q = q.eq("origem", opts.origem);
  if (opts.periodoDias) q = q.gte("created_at", new Date(Date.now() - opts.periodoDias * 86400000).toISOString());
  if (opts.leadIds) q = q.in("id", opts.leadIds);

  const termo = (opts.busca ?? "").trim();
  if (termo) {
    // Sanitiza pro .or() do PostgREST: vírgula/parênteses separam filtros e
    // %/_ são curinga do ilike — só sobram letras, números, @ . - e espaço.
    const t = termo.replace(/[^\p{L}\p{N}@.\-\s]/gu, " ").replace(/\s+/g, " ").trim();
    if (t) {
      const alvo = `%${t}%`;
      const partes = [`nome.ilike.${alvo}`, `email.ilike.${alvo}`, `produto_interesse.ilike.${alvo}`, `telefone.ilike.${alvo}`];
      // Telefone por dígitos (mesma regra ≥4 do matchBusca do cliente):
      // "12988887777" casa "(12) 98888-7777" intercalando curingas.
      const digitos = t.replace(/\D/g, "");
      if (digitos.length >= 4) partes.push(`telefone.ilike.%${digitos.split("").join("%")}%`);
      q = q.or(partes.join(",")); // vários .or() no PostgREST viram ANDs entre si
    }
  }

  if (!opts.contarApenas) {
    const de = (opts.pagina ?? 0) * ARQUIVADOS_POR_PAGINA;
    q = q.order("created_at", { ascending: false }).range(de, de + ARQUIVADOS_POR_PAGINA - 1);
  }
  const { data, count, error } = await q;
  if (error) console.error("[leads] fetchLeadsArquivados:", error.message);
  return { leads: (data as any) ?? [], total: count ?? 0 };
}

// Retorna true se pegou; false se outro vendedor pegou primeiro.
// Proteção de corrida: o update só aplica se o lead ainda estiver "no bolsão"
// (sem dono OU com SLA estourado sem primeiro contato) — mesma regra de noBolsao().
export async function pegarLead(id: string, vendedorId: string): Promise<boolean> {
  if (!supabase) return false;
  const now = new Date().toISOString();
  const minutos = await limiteSlaMinutos();
  const sla = new Date(Date.now() + minutos * 60000).toISOString();
  // primeiro_contato_em NÃO entra no patch: o ramo `vendedor_id.is.null` da
  // guarda abaixo também casa lead SEM DONO que JÁ FOI ATENDIDO (devolvido ao
  // bolsão depois da conversa). Zerar apagaria o histórico de 1ª resposta e
  // reiniciaria um SLA que já tinha sido cumprido.
  const { data, error } = await supabase.from("leads").update({
    vendedor_id: vendedorId,
    atribuido_em: now,
    sla_expira_em: sla,
  }).eq("id", id)
    .or(filtroBolsao(now))
    .select("id");
  // Erro (rede/RLS) LANÇA — false fica reservado pra corrida real ("outro
  // pegou"). Antes a falha de rede sumia com o card e mentia pro vendedor.
  if (error) throw new Error(error.message);
  const pegou = !!(data && data.length);
  // Este UPDATE casa com o filtro do canal Realtime de quem clicou (é uma
  // atribuição a ele mesmo, agorinha, sem 1º contato) — sem avisar o Layout,
  // o vendedor recebia "Lead novo" do lead que ELE acabou de pegar.
  if (pegou && typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("kuboo:lead-pego", { detail: { id } }));
  }
  return pegou;
}

// Leads FECHADOS SEM VENDA do módulo — só a contagem, via HEAD count.
//
// O funil calculava a taxa de conversão sobre os leads ATIVOS, e lead perdido
// sempre nasce com descartado=true (Pipeline.tsx marca os dois juntos). Ou
// seja: o denominador nunca tinha perdido nenhum e a taxa ficava travada em
// 100%. Em 21/08 o card de Consórcios estampava "Taxa de conversão 100%" com
// 1 ganho e 775 perdidos na base — conversão real de 0,13%. É o número que o
// gestor usa pra decidir dobrar (ou não) a verba de anúncio.
//
// Contagem no servidor de propósito: baixar as 778 linhas descartadas só pra
// contá-las custaria mais que o resto do dashboard inteiro.
export async function contarPerdidos(modulo: "seguros" | "consorcios"): Promise<number> {
  if (!supabase) return 0;
  let q = supabase.from("leads").select("id", { count: "exact", head: true })
    .not("etapa", "eq", "ganho")             // ganho arquivado é VENDA, não perda
    .or("descartado.eq.true,etapa.eq.perdido");
  q = modulo === "consorcios" ? q.eq("modulo", "consorcios") : q.or("modulo.neq.consorcios,modulo.is.null");
  const { count, error } = await q;
  if (error) { console.error("[leads] contarPerdidos:", error.message); return 0; }
  return count ?? 0;
}

// Badge do bolsão no menu: só a CONTAGEM, via HEAD count — antes o Layout
// baixava a base INTEIRA (fetchLeads, select *) a cada 60s por usuário logado
// só pra contar. Mesma regra do noBolsao(): sem dono OU SLA estourado sem 1º
// contato; mesma regra de módulo do moduloDe().
export async function contarBolsao(modulo: "seguros" | "consorcios"): Promise<number | null> {
  if (!supabase) return null;
  const agora = new Date().toISOString();
  let q = supabase.from("leads").select("id", { count: "exact", head: true })
    .eq("descartado", false)
    .or(filtroBolsao(agora));
  q = modulo === "consorcios" ? q.eq("modulo", "consorcios") : q.or("modulo.neq.consorcios,modulo.is.null");
  const { count, error } = await q;
  // null = "não sei", 0 = "sei que está vazio". O Layout esconde o badge no
  // null em vez de estampar um zero que ele não apurou.
  if (error) { console.error("[leads] contarBolsao:", error.message); return null; }
  return count ?? 0;
}

// ATENÇÃO ao padrão destas duas: `.select("id")` + conferir se voltou linha.
// No PostgREST, UPDATE barrado por RLS NÃO devolve erro — devolve ZERO linhas.
// Sem isso, `error` vem null, a tela comemora e nada foi gravado. Aqui o
// prejuízo é concreto: registrarContato é o que PARA o relógio do SLA; se
// falhar calado, o lead volta pro bolsão enquanto o consultor acha que já
// atendeu. Devolvem boolean para quem chama poder desfazer e avisar.

export async function registrarContato(id: string): Promise<boolean> {
  if (!supabase) return false;
  const now = new Date().toISOString();
  // interagido_em também: a regra de retorno de 16 dias e os alertas de
  // inatividade dependem desse campo (LeadDetalhe já seta nas ações dele).
  const { data, error } = await supabase.from("leads")
    .update({ primeiro_contato_em: now, interagido_em: now })
    .eq("id", id)
    .select("id");
  if (error) console.error("[leads] registrarContato:", error.message);
  return !error && !!(data && data.length);
}

export async function devolverBolsao(id: string): Promise<boolean> {
  if (!supabase) return false;
  const { data, error } = await supabase.from("leads")
    .update({ vendedor_id: null, atribuido_em: null, sla_expira_em: null })
    .eq("id", id)
    .select("id");
  if (error) console.error("[leads] devolverBolsao:", error.message);
  return !error && !!(data && data.length);
}

export async function moverEtapa(id: string, etapa: string) {
  if (!supabase) return;
  const agora = new Date().toISOString();
  // interagido_em junto: mover de coluna é interação — mesma regra do registrarContato.
  // propaga o erro pra quem chama (Pipeline usa try/catch p/ desfazer o card se falhar)
  const patch: Record<string, string> = { etapa, interagido_em: agora };
  const { data, error } = await supabase.from("leads")
    .update(patch)
    .eq("id", id)
    .select("id, primeiro_contato_em");
  if (error) throw error;
  // Zero linhas = RLS barrou sem erro. Sem isto o card ficava na coluna nova na
  // tela e voltava sozinho no próximo F5, sem ninguém entender o motivo.
  if (!data || data.length === 0) throw new Error("Sem permissão para mover este lead.");
  // Só depois de saber que o UPDATE passou: carimba o 1º contato se ainda não
  // existir. Em UPDATE separado porque o valor depende do que estava gravado.
  if (ETAPAS_DE_ATENDIMENTO.includes(etapa) && !data[0]?.primeiro_contato_em) {
    await supabase.from("leads").update({ primeiro_contato_em: agora })
      .eq("id", id).is("primeiro_contato_em", null);
  }
}

/** Descarta um lead do bolsão (soft-delete: não some do banco, só sai da fila).
 *  Requer a migration crm-leads-manage.sql (coluna descartado + policy da equipe). */
export async function descartarLead(id: string, motivo: string): Promise<boolean> {
  if (!supabase) return false;
  const { data, error } = await supabase.from("leads")
    .update({ descartado: true, motivo_descarte: motivo || "descartado pela equipe" })
    .eq("id", id)
    .select("id");
  if (error) console.error("[leads] descartarLead:", error.message);
  // Zero linhas = RLS barrou. Devolver true aqui fazia o lead "descartado"
  // reaparecer na lista seguinte, como se a equipe não tivesse feito nada.
  return !error && !!(data && data.length);
}

/** Distribuição automática (rodízio): gestor/admin reparte os leads do bolsão
 *  entre os vendedores, na ordem de prioridade. COMPLEMENTA o "pegar lead"
 *  manual — cada atribuição usa a mesma proteção de corrida do pegarLead,
 *  então leads pegos no meio do rodízio são simplesmente pulados. */
export async function distribuirBolsao(
  leads: Lead[], vendedorIds: string[], comecarEm = 0,
): Promise<{ distribuidos: number; pulados: number; falhados: number; proximoIndice: number }> {
  if (!supabase || !vendedorIds.length) {
    return { distribuidos: 0, pulados: leads.length, falhados: 0, proximoIndice: comecarEm };
  }
  const ordenados = [...leads].sort((a, b) => prioridadeLead(b) - prioridadeLead(a));
  let distribuidos = 0, pulados = 0, falhados = 0;
  // O ponto de partida do rodízio vem de FORA e é persistido pelo chamador.
  // Começando sempre em 0, quem estivesse no topo da lista recebia o 1º lead
  // de TODA distribuição — e como o normal é distribuir poucos leads por vez,
  // os primeiros da lista acumulavam e os últimos quase nunca eram alcançados.
  let i = comecarEm;
  for (const l of ordenados) {
    try {
      const ok = await pegarLead(l.id, vendedorIds[i % vendedorIds.length]);
      if (ok) { distribuidos++; i++; } else pulados++;
    } catch (e) {
      // pegarLead LANÇA em falha de rede/RLS. Sem este catch, uma falha no
      // meio abortava o laço inteiro: os leads seguintes não eram nem
      // tentados, o botão ficava travado (o setDistribuindo(false) não rodava)
      // e a tela não dizia o que tinha acontecido.
      console.error("[leads] distribuirBolsao:", e);
      falhados++;
    }
  }
  return { distribuidos, pulados, falhados, proximoIndice: i % vendedorIds.length };
}

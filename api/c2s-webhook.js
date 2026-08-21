// Vercel Serverless — RECEPTOR DO WEBHOOK DO CONTACT2SALE.
//
// POR QUE EXISTE: enquanto o C2S ainda estiver ativo, todo lead que chega lá é
// espelhado aqui em tempo real. É o que permite rodar os dois em paralelo,
// conferir que está batendo, e só então cancelar a assinatura — sem janela de
// leads perdidos e sem depender de Make/Zapier.
//
// COMO ASSINAR (no C2S: Integrações → Gerar Token, depois):
//   curl -X POST https://api.contact2sale.com/integration/api/subscribe \
//     -H "Authorization: SEU_TOKEN" -H "Content-Type: application/json" \
//     -d '{"hook_action":"on_create_lead","hook_url":"https://crm-kuboo.vercel.app/api/c2s-webhook?token=SEGREDO"}'
//   (repetir para on_update_lead e on_close_lead — mesmo hook_url)
//
// AUTENTICAÇÃO: o C2S só envia a URL (não deixa configurar header), então o
// segredo vai na query string — por isso ele precisa ser longo e aleatório.
// Configure a env C2S_WEBHOOK_TOKEN no Vercel.
//
// IDEMPOTENTE: casa por c2s_lead_id (e, na falta dele, por telefone). Reenvios
// e os 3 gatilhos no mesmo lead atualizam a mesma linha em vez de duplicar.
//
// NÃO dispara o rodízio da equipe: o lead entra já com o dono que o C2S
// atribuiu (resolvido por e-mail/nome). Se o consultor não existir no CRM,
// cai no bolsão para alguém pegar — que é o comportamento correto.

import { createClient } from "@supabase/supabase-js";
import { env, segredoConfere } from "./_env.js";
import { decidirModulo } from "./_modulo.js";
import { formatarTelefone } from "./_telefone.js";
import { ehLeadDeTeste, MOTIVO_TESTE } from "./_teste.js";

const ORIGENS_VALIDAS = ["chatbot", "formulario", "whatsapp", "indicacao", "portal", "manual", "webhook"];
const ETAPAS_VALIDAS = ["novos", "contato", "cotacao", "negociacao", "ganho", "perdido"];

const txt = (v, max = 200) => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};
// lead_status.alias do C2S → etapa do funil do CRM
function mapearEtapa(a) {
  const alias = String(a?.attributes?.lead_status?.alias || "").toLowerCase();
  const nome = String(a?.attributes?.lead_status?.name || "").toLowerCase();
  const arquivado = a?.attributes?.archive_details?.archived === true;
  const fechado = a?.attributes?.done_details?.done === true;
  if (fechado) return { etapa: "ganho", descartado: false };
  if (arquivado) return { etapa: "perdido", descartado: true };
  if (/lost|perdid/.test(alias + nome)) return { etapa: "perdido", descartado: true };
  if (/won|done|fechad|ganho/.test(alias + nome)) return { etapa: "ganho", descartado: false };
  if (/negotiation|negocia/.test(alias + nome)) return { etapa: "negociacao", descartado: false };
  if (/attendance|atendimento|contact|contato/.test(alias + nome)) return { etapa: "contato", descartado: false };
  return { etapa: "novos", descartado: false };
}

// Entre os leads sem c2s_lead_id que dividem o telefone, qual é ESTE lead do
// C2S — ou NENHUM, e aí o evento vira lead novo.
//
// A regra antiga caía em `lista[0]` (o mais recente) sempre que o nome não
// batia. Dois estragos, os dois medidos na base em 21/08:
//  1. Cliente que VOLTA. Ele preencheu em abril, ninguém conseguiu contato,
//     foi arquivado (734 leads da base estão nesse estado). Em setembro ele
//     preenche de novo — lead pago, novo, quente. O C2S manda um id novo, a
//     busca por id não acha, e a adoção pegava a linha ARQUIVADA de abril.
//     Como montarPatch é blindado contra desarquivar e contra rebaixar etapa,
//     o lead continuava invisível: sem dono, sem SLA, sem bolsão. E o trigger
//     de rodízio é AFTER INSERT — UPDATE não distribui nada.
//  2. Telefone compartilhado (casal, família). Existe 1 telefone na base hoje
//     em 2 linhas com primeiros nomes DIFERENTES. Como a adoção também
//     sobrescreve nome e e-mail, a linha de uma pessoa passava a carregar a
//     identidade da outra.
//
// Agora exige CONCORDÂNCIA DE IDENTIDADE (nome ou e-mail). Adotar lead
// arquivado continua permitido — a costura da migração depende disso (45 das
// linhas já carimbadas estão arquivadas) —, mas só quando é comprovadamente a
// MESMA pessoa. Sem concordância, o evento vira lead NOVO: passa pelo trigger,
// entra no rodízio, ganha SLA e aparece pro consultor.
const chaveIdent = (s) =>
  String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ").trim();

/** Este candidato é comprovadamente a mesma pessoa do evento do C2S? */
export function concordaIdentidade(cand, nomeC2S, emailC2S) {
  const nome = chaveIdent(nomeC2S), email = chaveIdent(emailC2S);
  if (nome && chaveIdent(cand?.nome) === nome) return true;
  if (email && chaveIdent(cand?.email) === email) return true;
  return false;
}

export function escolherExistente(candidatos, nomeC2S, emailC2S, eventoAtivo = false) {
  let lista = candidatos || [];
  if (!lista.length) return null;

  // Evento ATIVO batendo em linha ARQUIVADA = cliente que volta (mesmo nome!).
  // A identidade concordar não ajuda aqui — é a mesma pessoa de propósito. O
  // que denuncia é o estado: o C2S diz "lead vivo" e a linha diz "encerrado".
  // Esse par nunca é adoção: o ciclo antigo acabou, o contato novo merece
  // linha nova (INSERT → trigger → rodízio → SLA). A costura da migração não
  // passa por aqui: os eventos dela chegam com o MESMO estado da linha.
  if (eventoAtivo) lista = lista.filter((c) => !c.descartado);
  if (!lista.length) return null;

  // 1) Mesma pessoa, provada por nome ou e-mail. Vale para lead arquivado.
  const porIdentidade = lista.find((c) => concordaIdentidade(c, nomeC2S, emailC2S));
  if (porIdentidade) return porIdentidade;

  // 2) Sem prova de identidade, só adota o caso inequívoco da migração: um
  //    ÚNICO candidato e ele está ATIVO. Cobre o lead importado cujo nome foi
  //    editado no CRM depois. Lead arquivado nunca entra por aqui — é
  //    justamente o cliente que volta, e ele merece linha nova.
  const ativos = lista.filter((c) => !c.descartado);
  if (ativos.length === 1 && lista.length === 1) return ativos[0];

  // 3) Ambíguo (vários candidatos, ou o único é arquivado): não adota.
  return null;
}

// Etapa avançada no C2S = a equipe JÁ FALOU com o cliente (lá). Sem espelhar o
// 1º contato, o CRM acha o lead "não atendido": o SLA estoura, o lead volta pro
// BOLSÃO no meio da negociação (outro vendedor pode pegá-lo) e o sino grita SLA
// estourado — aconteceu com o 1º lead real do paralelo (Antonio, 20/08).
// 'perdido' fica de fora: arquivar sem nunca ter falado existe (lead lixo).
// Exportada porque o handler não é testável (faz I/O) — sem isto, apagar a
// regra inteira mantinha a suíte verde. Ver __tests__/c2s-webhook.test.mjs.
const ETAPAS_COM_CONTATO = ["contato", "cotacao", "negociacao", "ganho"];
export function contatoDaEtapa(etapa, at = {}, agoraISO = new Date().toISOString()) {
  if (!ETAPAS_COM_CONTATO.includes(etapa)) return null;
  return at.replied_at || at.read_at || agoraISO;
}

// Motivo do arquivamento: o C2S manda o ALIAS interno em lost_reasons.name
// ("inactive", "return_delay"...). Sem traduzir, o CRM marcava o lead como
// perdido SEM motivo — 42 leads arquivados entre 14 e 21/08 ficaram assim, e o
// gráfico de motivos de perda do gestor nasce furado (piora a cada dia).
// O mapa foi DERIVADO do banco real: cruzei a distribuição dos aliases no
// backup da extração com a dos motivos já gravados (invalid=17 ↔ "Contato
// inválido"=17, without_qualification=10 ↔ "Tratada sem qualificação"=10 ...).
// Alias desconhecido vira "Outros" — é melhor que null no relatório.
const MOTIVO_C2S = {
  inactive: "Falta de interação do usuário",
  return_delay: "Cliente não responde",
  invalid: "Contato inválido",
  without_qualification: "Tratada sem qualificação",
  with_qualification: "Tratada com qualificação",
  just_researching: "Apenas pesquisando",
  bought_elsewhere: "Fechou com concorrente",
  underprivileged: "Não possui renda",
  impossible_proposal: "Proposta inviável",
  duplicated: "Lead duplicado",
  not_ready_to_buy: "Compra adiada",
  service_problem: "Problema no atendimento",
  product_not_satisfy: "Produto não agradou",
  from_spreadsheet: "De planilha",
  problem_delivery_date: "Prazo de entrega",
  z_others: "Outros",
};
// Exportada para teste — o handler faz I/O e não é testável.
export function motivoDoC2S(at = {}, descartado = false) {
  if (!descartado) return null;
  const alias = String((at?.lost_reasons || {}).name || "").trim();
  if (!alias) return null;
  return MOTIVO_C2S[alias] || "Outros";
}

// Campos que o C2S NUNCA pode reescrever num lead que já existe aqui:
//   modulo   — deduzido por regex ("seguro" no texto), então um lead de seguros
//              classificado pela equipe voltaria pra consórcios a cada evento.
//              Quem manda no funil é o CRM.
//   mensagem — nos 818 importados, o rodapé dessa coluna é a ÚNICA cópia da
//              data original e do motivo de arquivamento do C2S. Sobrescrever
//              apaga o histórico pra sempre.
//   origem   — 'webhook' passaria por cima de 'formulario'/'chatbot' de um lead
//              que na verdade nasceu no site.
const NAO_SOBRESCREVER = new Set(["status", "urgencia", "modulo", "mensagem", "origem"]);
const RANK = { novos: 0, contato: 1, cotacao: 2, negociacao: 3, perdido: 4, ganho: 5 };

// O que de fato vai pro UPDATE. Exportada para teste.
export function montarPatch(linha, existente, nomeC2S) {
  const patch = {};
  for (const [k, v] of Object.entries(linha)) {
    if (v !== null && v !== undefined && !NAO_SOBRESCREVER.has(k)) patch[k] = v;
  }
  // Nome só entra se o C2S mandou um de verdade — o fallback
  // "Sem nome — (12) 99999-9999" não pode apagar um nome já cadastrado.
  if (!nomeC2S) delete patch.nome;
  // O funil do CRM é a fonte da verdade depois que o lead existe: um evento
  // atrasado do C2S não pode rebaixar quem a equipe já avançou aqui, nem
  // reabrir o que foi fechado. Só deixamos AVANÇAR.
  if ((RANK[patch.etapa] ?? 0) <= (RANK[existente.etapa] ?? 0)) delete patch.etapa;
  // Idem para o arquivamento: pode arquivar, nunca desarquivar sozinho.
  if (patch.descartado === false && existente.descartado === true) delete patch.descartado;
  // Fonte de NASCIMENTO é identidade do lead: quem chegou primeiro batizou
  // ("Meta Lead Ads" via Make). O rótulo genérico do C2S ("Facebook Leads")
  // só entra em lead que ainda não tem fonte — visto no 1º lead real do
  // paralelo (Antonio, 20/08): o espelho do C2S apagava a fonte do Make.
  if (existente.fonte) delete patch.fonte;
  // 1º contato é FATO histórico: uma vez gravado, evento nenhum o move — o
  // relatório de tempo de 1ª resposta depende do timestamp original.
  if (existente.primeiro_contato_em) delete patch.primeiro_contato_em;
  // Motivo escolhido pela equipe NO CRM manda: o C2S só preenche o que está
  // vazio (senão um evento atrasado desfaz a classificação do gestor).
  if (existente.motivo_descarte) delete patch.motivo_descarte;
  // O 60 de nascimento é pro INSERT; num lead que já existe ele apagaria o
  // score que alguém (ou a base histórica) já definiu.
  delete patch.score;
  return patch;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // Segredo na query (o C2S não permite header customizado)
  const esperado = env("C2S_WEBHOOK_TOKEN");
  if (!esperado) {
    console.error(JSON.stringify({ level: "error", fn: "c2s-webhook", msg: "C2S_WEBHOOK_TOKEN ausente" }));
    return res.status(500).json({ error: "Webhook não configurado" });
  }
  // segredoConfere normaliza os dois lados: env gravada por pipe do PowerShell
  // carrega um "\r" invisível e a comparação crua devolvia 401 pra sempre.
  if (!segredoConfere(req.query?.token, esperado)) return res.status(401).json({ error: "Token inválido" });

  const supaUrl = env("VITE_SUPABASE_URL");
  const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!supaUrl || !serviceKey) return res.status(500).json({ error: "Supabase não configurado no servidor" });
  const admin = createClient(supaUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  try {
    // O C2S manda { data: { id, attributes: {...} } }; toleramos o objeto cru também.
    const d = req.body?.data ?? req.body ?? {};
    const at = d.attributes ?? d ?? {};
    const cliente = at.customer ?? {};
    const produto = at.product ?? {};
    const vendedor = at.seller ?? {};
    const fb = d.facebook_attributes ?? at.facebook_attributes ?? {};

    const telefone = formatarTelefone(cliente.phone_global || cliente.phone || cliente.phone2);
    const email = txt(cliente.email, 200)?.toLowerCase() ?? null;
    if (!telefone && !email) {
      // Sem contato não há lead útil — 200 pra não gerar retry infinito no C2S
      return res.status(200).json({ ok: true, ignorado: "lead sem telefone e sem e-mail" });
    }

    const c2sId = txt(d.id || at.id, 120);
    const { etapa, descartado } = mapearEtapa({ attributes: at });

    // Consultor do C2S → perfil do CRM (e-mail primeiro, depois nome)
    let vendedorId = null;
    const vEmail = txt(vendedor.email, 200)?.toLowerCase();
    const vNome = txt(vendedor.name, 200);
    if (vEmail) {
      const { data } = await admin.from("profiles").select("id").eq("email", vEmail).limit(1);
      vendedorId = data?.[0]?.id ?? null;
    }
    if (!vendedorId && vNome && !/kuboo/i.test(vNome)) {
      const { data } = await admin.from("profiles").select("id, name")
        .in("role", ["vendedor", "gestor", "admin"]).ilike("name", `%${vNome.split(/\s+/)[0]}%`).limit(5);
      const alvo = (data || []).find((p) => String(p.name).toLowerCase() === vNome.toLowerCase()) || data?.[0];
      vendedorId = alvo?.id ?? null;
    }

    const fonte = txt(at.lead_source?.name, 120);
    const canal = txt(at.channel?.name, 60) || "Internet";
    const campanha = txt(fb.campaign_name || fb.ad_campaign || produto.description || at.description, 200);
    const primeiraMsg = txt(
      (Array.isArray(at.messages) && at.messages[0]?.body) || at.description || at.observation,
      4000
    );

    const nomeC2S = txt(cliente.name, 200);
    const linha = {
      nome: nomeC2S || `Sem nome — ${telefone || email}`,
      telefone,
      email,
      origem: ORIGENS_VALIDAS.includes("webhook") ? "webhook" : "formulario", // CHECK do banco
      // Mesma regra do lead-inbound (api/_modulo.js) — antes cada receptor
      // decidia sozinho e os dois discordavam.
      modulo: decidirModulo({
        campanha, fonte, mensagem: primeiraMsg, produto: produto.description,
        fb_anuncio: fb.ad_name, fb_formulario: fb.form_name,
      }),
      fonte,
      canal,
      campanha,
      // Mesmo score de nascimento do lead-inbound (60 = neutro). Sem isto o
      // default 0 da coluna fazia TODO lead espelhado do C2S nascer "frio" e
      // afundar no fim da fila de prioridade do bolsão — 839 dos 845 leads da
      // base estavam assim. 0 é um julgamento ("lead ruim"); ninguém julgou.
      score: 60,
      fb_pagina: txt(fb.page_name, 120),
      fb_anuncio: txt(fb.ad_name, 120),
      fb_formulario: txt(fb.form_name, 120),
      etapa: ETAPAS_VALIDAS.includes(etapa) ? etapa : "novos",
      descartado,
      status: "novo",
      urgencia: "breve",
      mensagem: primeiraMsg,
      c2s_lead_id: c2sId,
      interagido_em: at.read_at || at.replied_at || null,
      primeiro_contato_em: contatoDaEtapa(etapa, at),
      motivo_descarte: motivoDoC2S(at, descartado),
    };

    // Já existe? SEMPRE pelo id do C2S quando ele vier.
    let existente = null;
    if (c2sId) {
      const { data } = await admin.from("leads").select("id, etapa, descartado, fonte, primeiro_contato_em, motivo_descarte").eq("c2s_lead_id", c2sId).limit(1);
      existente = data?.[0] ?? null;
    }

    // COSTURA DA MIGRAÇÃO — sem isto a base dobra de tamanho no primeiro dia.
    // Os 818 leads que vieram da importação em massa do C2S entraram SEM
    // c2s_lead_id (a RPC de importação não gravou o campo). Como o C2S manda o
    // id em todo evento, a busca acima nunca acha esses leads e o primeiro
    // on_update_lead de cada um criaria uma DUPLICATA.
    // Só adotamos quem ainda não tem dono do lado do C2S (c2s_lead_id null):
    // um lead já carimbado pertence a OUTRO id e não pode ser roubado — é o que
    // impede a fusão de pessoas diferentes que dividem o telefone (casal,
    // família), que era o motivo do fallback antigo ter sido restringido.
    let adotadoPorTelefone = false;
    if (!existente && telefone) {
      const { data } = await admin.from("leads")
        .select("id, etapa, descartado, nome, email, fonte, primeiro_contato_em, motivo_descarte")
        .eq("telefone", telefone).is("c2s_lead_id", null)
        .order("created_at", { ascending: false }).limit(5);
      existente = escolherExistente(data, nomeC2S, email, descartado === false);
      if (existente) adotadoPorTelefone = !concordaIdentidade(existente, nomeC2S, email);
    }

    if (existente) {
      // Atualização (on_update/on_close): não sobrescreve o dono já definido no
      // CRM nem apaga campos que o C2S mandou vazios.
      const patch = montarPatch(linha, existente, nomeC2S);
      // Adotado só por telefone, sem nome nem e-mail batendo: pode não ser a
      // mesma pessoa. Espelha o funil e a campanha, mas NÃO reescreve quem o
      // lead é — era assim que a linha de um virava a identidade do outro.
      if (adotadoPorTelefone) { delete patch.nome; delete patch.email; }
      const { error } = await admin.from("leads").update(patch).eq("id", existente.id);
      if (error) throw new Error(error.message);
      return res.status(200).json({ ok: true, acao: "atualizado", id: existente.id });
    }

    // Mesma barreira do lead-inbound: o lead de teste da Meta chega pelo C2S
    // também — foi por aqui que ele entrou em 21/08, virou lead "em
    // negociação" com consultor e sem telefone pra ligar.
    if (ehLeadDeTeste({ nome: linha.nome, email: linha.email, mensagem: linha.mensagem, produto_interesse: linha.produto_interesse })) {
      linha.descartado = true;
      linha.motivo_descarte = MOTIVO_TESTE;
    }
    if (vendedorId) {
      linha.vendedor_id = vendedorId;
      linha.atribuido_em = new Date().toISOString();
    }
    const { data: criado, error } = await admin.from("leads").insert(linha).select("id").single();
    if (error) throw new Error(error.message);
    return res.status(200).json({ ok: true, acao: "criado", id: criado.id, comDono: !!vendedorId });
  } catch (err) {
    console.error(JSON.stringify({ level: "error", fn: "c2s-webhook", msg: String(err).slice(0, 300) }));
    // 200 de propósito: erro nosso não deve fazer o C2S reenviar em loop.
    return res.status(200).json({ ok: false, erro: "Falha ao processar — registrado no log" });
  }
}

// Em qual funil o lead entra: Seguros ou Consórcios.
//
// POR QUE EXISTE: os dois receptores decidiam sozinhos e DISCORDAVAM entre si —
// c2s-webhook fazia `/seguro/i.test(...) ? 'seguros' : 'consorcios'` e
// lead-inbound fazia `b.modulo === 'consorcios' ? 'consorcios' : 'seguros'`.
// O MESMO lead do Meta caía em funis diferentes dependendo da porta de entrada,
// e no lead-inbound caía sempre em Seguros a menos que o Make mandasse o campo
// certo — configuração frágil, mantida à mão fora do código.
//
// O vocabulário abaixo saiu das campanhas REAIS da conta (822 leads):
//   "CAMPANHA CONSUMIDOR - TABELA COMPLETA" (264), "CAMPANHA AUTO" (136),
//   "MÊS DO CONSÓRCIO" (47), "TABELA MAIOR PRETA" (40), "Imóvel R - Kuboo" (20),
//   "Campanha 35% tabela" (23), "[tel] Carro - Leads Kuboo", "CAMPANHA FLEX"...
// "tabela", "carta de crédito", "contemplação" e "assembleia" são jargão de
// CONSÓRCIO — não aparecem em captação de seguro.
//
// DEFAULT = consorcios para captação EXTERNA (Meta/C2S/parceiro), porque é o
// que a conta de anúncios da Kuboo de fato vende: 819 dos 822 leads históricos.
// O site NÃO usa isto — ele sabe o produto e manda `modulo` explícito.
//
// ⚠️ EM ABERTO com o Eduardo: "CAMPANHA AUTO" (136 leads) é consórcio de carro
// ou SEGURO auto? Está tratada como consórcio (o texto não diz "seguro" e a
// campanha vive ao lado das de tabela/crédito). Se for seguro, basta mover
// 'auto' e 'carro' para SEGUROS aqui e reclassificar o histórico.

// REGRA DE OURO destas listas: só entra palavra que nomeia o PRODUTO.
// Palavra que nomeia o BEM (auto, carro, moto, veículo, imóvel, caminhão) é
// NEUTRA e não pontua para ninguém — consórcio e seguro vendem os dois. Ter
// posto "auto" e "carro" do lado do consórcio fez "Seguro Auto Porto" empatar
// 1×1 e cair em Consórcios; o teste pegou. Palavra ambígua atrapalha mais do
// que ajuda: sem ela o lead cai no default, que é uma decisão consciente.
// "Empresarial" também saiu: é tipo de apólice E tipo de cota ao mesmo tempo.
const SEGUROS = [
  "seguro", "apolice", "apólice", "sinistro", "seguradora",
  "cobertura", "franquia", "residencial", "vida", "responsabilidade civil",
  "rc profissional", "frota", "garantia estendida", "viagem", "pet",
];

const CONSORCIOS = [
  "consorcio", "consórcio", "tabela", "carta de credito", "carta de crédito",
  "credito", "crédito", "contemplacao", "contemplação", "contemplado", "lance",
  "assembleia", "cota", "parcela ideal", "consumidor", "flex", "administradora",
];

const semAcento = (s) =>
  String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

// Conta quantos termos de cada lista aparecem — vence quem tiver mais sinais.
// Contar em vez de "primeiro que casar" evita que um "seguro" solto no meio de
// uma campanha de consórcio sequestre o lead (e vice-versa).
// Casa PALAVRA INTEIRA (com plural opcional), não pedaço de palavra. Com
// `includes` cru, "cota" casava dentro de "cotAÇÃO" — e "cotação" é palavra
// de SEGURO: "Cotação de seguro auto" empatava 1x1 e caía em Consórcios.
// Mesma armadilha para "vida" em "convida" e "lance" em "lancheteria".
// Os termos das listas são fixos e sem caractere especial de regex, por isso
// não há escape aqui — se algum dia entrar termo com ponto/parêntese, escapar.
const cacheRegex = new Map();
function regexTermo(termo) {
  const chave = semAcento(termo);
  let re = cacheRegex.get(chave);
  if (!re) {
    re = new RegExp("\\b" + chave + "s?\\b");
    cacheRegex.set(chave, re);
  }
  return re;
}

function pontuar(texto, termos) {
  const t = semAcento(texto);
  let n = 0;
  for (const termo of termos) if (regexTermo(termo).test(t)) n++;
  return n;
}

/**
 * @param {object} sinais  { modulo, campanha, fonte, mensagem, produto, formulario, fb_anuncio, fb_formulario }
 * @returns {'seguros'|'consorcios'}
 */
export function decidirModulo(entrada) {
  // `= {}` só cobre undefined; um webhook mandando null explodiria aqui.
  const sinais = entrada && typeof entrada === "object" ? entrada : {};
  // Quem chama sabendo o produto manda explícito e ganha de qualquer heurística.
  if (sinais.modulo === "seguros" || sinais.modulo === "consorcios") return sinais.modulo;

  const texto = [
    sinais.campanha, sinais.fonte, sinais.produto, sinais.mensagem,
    sinais.fb_anuncio, sinais.fb_formulario,
    sinais.formulario && typeof sinais.formulario === "object"
      ? Object.entries(sinais.formulario).map(([k, v]) => `${k} ${v}`).join(" ")
      : sinais.formulario,
  ].filter(Boolean).join(" ");

  const seg = pontuar(texto, SEGUROS);
  const con = pontuar(texto, CONSORCIOS);
  if (seg > con) return "seguros";
  if (con > seg) return "consorcios";
  // Empate (inclusive 0 a 0): captação externa da Kuboo é consórcio.
  return "consorcios";
}

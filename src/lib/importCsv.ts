// Parser de CSV para a tela "Importar leads" (migração histórica do Contact2Sale).
// Sem lib externa: parser próprio, separador ";" ou "," auto-detectado, BOM UTF-8
// removido, e aspas com escape "" (RFC4180-ish — aceita separador/quebra de linha
// dentro de um campo entre aspas). Ver src/pages/ImportarLeads.tsx.

export interface CsvParseResult {
  headers: string[];
  rows: string[][];
}

function removerBom(texto: string): string {
  return texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto;
}

function detectarSeparador(primeiraLinha: string): "," | ";" {
  const virgulas = (primeiraLinha.match(/,/g) || []).length;
  const pontoVirgulas = (primeiraLinha.match(/;/g) || []).length;
  return pontoVirgulas > virgulas ? ";" : ",";
}

/** Parser de CSV: aspas duplas escapam com "", campo pode conter o separador
 *  ou quebras de linha se estiver entre aspas. Linhas totalmente vazias são
 *  descartadas (comum em export de planilha). */
export function parseCsv(textoOriginal: string): CsvParseResult {
  const conteudo = removerBom(textoOriginal).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!conteudo.trim()) return { headers: [], rows: [] };

  const fimPrimeiraLinha = conteudo.indexOf("\n");
  const primeiraLinha = fimPrimeiraLinha > -1 ? conteudo.slice(0, fimPrimeiraLinha) : conteudo;
  const sep = detectarSeparador(primeiraLinha);

  const linhas: string[][] = [];
  let campo = "";
  let linhaAtual: string[] = [];
  let dentroAspas = false;
  let i = 0;
  const n = conteudo.length;

  const fecharCampo = () => { linhaAtual.push(campo); campo = ""; };
  const fecharLinha = () => { fecharCampo(); linhas.push(linhaAtual); linhaAtual = []; };

  while (i < n) {
    const c = conteudo[i];
    if (dentroAspas) {
      if (c === '"') {
        if (conteudo[i + 1] === '"') { campo += '"'; i += 2; continue; }
        dentroAspas = false; i++; continue;
      }
      campo += c; i++; continue;
    }
    if (c === '"') { dentroAspas = true; i++; continue; }
    if (c === sep) { fecharCampo(); i++; continue; }
    if (c === "\n") { fecharLinha(); i++; continue; }
    campo += c; i++;
  }
  if (campo.length > 0 || linhaAtual.length > 0) fecharLinha();

  const linhasValidas = linhas.filter((l) => !(l.length === 1 && l[0].trim() === ""));
  const [headers, ...rows] = linhasValidas;
  return { headers: (headers ?? []).map((h) => h.trim()), rows };
}

// ─── Mapeamento de colunas ────────────────────────────────────────────────────
export type CampoLead = "nome" | "telefone" | "email" | "campanha" | "fonte" | "canal" | "etapa" | "vendedor" | "produto" | "valor" | "motivo" | "ignorar";

export const CAMPOS_LEAD: { valor: CampoLead; rotulo: string; obrigatorio?: boolean }[] = [
  { valor: "nome", rotulo: "Nome", obrigatorio: true },
  { valor: "telefone", rotulo: "Telefone" },
  { valor: "email", rotulo: "E-mail" },
  { valor: "campanha", rotulo: "Campanha" },
  { valor: "produto", rotulo: "Produto de interesse" },
  { valor: "valor", rotulo: "Valor / preço" },
  { valor: "fonte", rotulo: "Fonte" },
  { valor: "canal", rotulo: "Canal" },
  { valor: "etapa", rotulo: "Etapa" },
  { valor: "motivo", rotulo: "Motivo de arquivamento" },
  { valor: "vendedor", rotulo: "Vendedor" },
  { valor: "ignorar", rotulo: "— Ignorar —" },
];

/** "R$ 1.234,56" | "1234.56" | "1.234" → número. Mesma regra do parser pt-BR do
 *  LeadDetalhe: ponto único a 1-2 casas do fim é decimal, senão é milhar. */
export function parseValorBR(bruto: string): number | null {
  let t = String(bruto ?? "").trim().replace(/[R$\s]/gi, "");
  if (!t) return null;
  const temVirgula = t.includes(","), temPonto = t.includes(".");
  if (temVirgula && temPonto) t = t.replace(/\./g, "").replace(",", ".");
  else if (temVirgula) t = t.replace(",", ".");
  else if (temPonto) {
    const i = t.lastIndexOf(".");
    const casas = t.length - i - 1;
    if (!(t.indexOf(".") === i && casas >= 1 && casas <= 2)) t = t.replace(/\./g, "");
  }
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Módulo por LINHA: o export do C2S mistura seguros e consórcios na mesma conta
 *  (campanhas AUTO e CONSUMIDOR). Sem isso, o lead de consórcio cairia no funil
 *  de seguros — mesma classe do bug já corrigido no site (commit a974668). */
export function inferirModulo(...textos: (string | null | undefined)[]): "seguros" | "consorcios" | null {
  const alvo = textos.filter(Boolean).join(" ");
  if (!alvo) return null;
  if (/cons[oó]rcio|consumidor|carta\s*de\s*cr[eé]dito|im[oó]vel/i.test(alvo)) return "consorcios";
  if (/seguro|auto|vida|residencial|frota|moto/i.test(alvo)) return "seguros";
  return null;
}

function normalizarTexto(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

// Ordem de prioridade: campos mais específicos primeiro, "nome" por último
// (senão headers como "Nome do vendedor" cairiam em "nome" antes de "vendedor").
const ORDEM_PRIORIDADE: Exclude<CampoLead, "ignorar">[] = ["email", "telefone", "vendedor", "motivo", "campanha", "produto", "valor", "fonte", "canal", "etapa", "nome"];
const PADROES: Record<Exclude<CampoLead, "ignorar">, RegExp[]> = {
  email: [/e-?mail/],
  telefone: [/telefone/, /celular/, /whats\s*app/, /^fone/, /^phone/, /contato\s*n/],
  vendedor: [/vendedor/, /responsavel/, /consultor/, /corretor/, /atendente/, /^owner$/],
  // "Motivo de arquivamento" antes de campanha/etapa pra não ser capturado por /status/
  motivo: [/motivo/, /raz[ao]o.*perda/, /lost\s*reason/],
  campanha: [/campanha/, /campaign/, /titulo\s*do\s*im[oó]vel/],
  produto: [/produto/, /interesse/, /natureza.*negocia/, /tipo\s*de\s*neg/],
  valor: [/^valor/, /^pre[cç]o/, /^price/, /valor.*proposta/, /valor.*fechamento/],
  fonte: [/^fonte/, /^origem/, /^source/, /midia\s*paga/],
  canal: [/canal/, /channel/],
  etapa: [/etapa/, /estagio/, /^status\s*do\s*lead/, /^status$/, /^stage/, /funil/],
  nome: [/^nome\s*do\s*cliente/, /^nome/, /^cliente$/, /^contato$/, /^lead$/, /nome\s*completo/],
};

/** Pré-mapeia colunas do CSV para campos do lead por heurística de header.
 *  Cada campo (exceto "ignorar") só é usado uma vez — a primeira coluna que
 *  bater ganha; as demais caem em "ignorar" pro gestor ajustar manualmente. */
export function heuristicaMapeamento(headers: string[]): Record<number, CampoLead> {
  const mapa: Record<number, CampoLead> = {};
  const usados = new Set<CampoLead>();
  headers.forEach((h, idx) => {
    const norm = normalizarTexto(h);
    const campo = ORDEM_PRIORIDADE.find((c) => !usados.has(c) && PADROES[c].some((re) => re.test(norm)));
    mapa[idx] = campo ?? "ignorar";
    if (campo) usados.add(campo);
  });
  return mapa;
}

// ─── Normalização de valores ──────────────────────────────────────────────────
// leads.etapa tem CHECK (etapa IN ('novos','contato','cotacao','negociacao','ganho','perdido')).
export const ETAPAS_VALIDAS = ["novos", "contato", "cotacao", "negociacao", "ganho", "perdido"] as const;
const ETAPA_HEURISTICA: { valor: (typeof ETAPAS_VALIDAS)[number]; padroes: RegExp[] }[] = [
  { valor: "ganho", padroes: [/ganho/, /fechad/, /convertid/, /^venda/, /won/] },
  { valor: "perdido", padroes: [/perdid/, /descart/, /cancelad/, /lost/, /arquivad/] },
  { valor: "negociacao", padroes: [/negocia/, /visita\s*realizada/] },
  // Funil real do C2S: Visita Agendada fica entre cotação e negociação —
  // sem esse padrão, leads no meio do funil regrediam pra "novos".
  { valor: "cotacao", padroes: [/cota/, /orcamento/, /proposta/, /quote/, /visita/] },
  { valor: "contato", padroes: [/contato/, /contact/, /atendiment/] },
  { valor: "novos", padroes: [/novo/, /^new/, /entrada/, /aguardando/] },
];

/** Converte o texto livre da coluna "Etapa" do CSV pro enum aceito pelo banco.
 *  Sem match → null (quem chama decide o default, geralmente 'novos'). */
export function normalizarEtapa(textoOriginal: string): (typeof ETAPAS_VALIDAS)[number] | null {
  const norm = normalizarTexto(textoOriginal);
  if (!norm) return null;
  const achado = ETAPA_HEURISTICA.find((e) => e.padroes.some((re) => re.test(norm)));
  return achado?.valor ?? null;
}

export function normalizarEmail(s: string): string {
  return s.trim().toLowerCase();
}

/** Compara nome de vendedor do CSV com o nome do profile, tolerando acentos/caixa. */
export function nomesEquivalentes(a: string, b: string): boolean {
  const na = normalizarTexto(a);
  const nb = normalizarTexto(b);
  return !!na && !!nb && na === nb;
}

export { normalizarTexto };

// CPF e CNPJ: validação de verdade (dígito verificador), não só contagem.
//
// POR QUE EXISTE: o cadastro de cliente exigia "CPF (11 dígitos)" e recusava
// qualquer PJ. Mas boa parte da carteira da Kuboo é EMPRESA — o RCO
// (Responsabilidade Civil de Ônibus) é seguro de ônibus e van de passageiros,
// então o cliente é transportadora, com CNPJ. Recusar PJ inviabilizava a
// carteira inteira desse produto.
//
// Contar dígitos não basta: "11111111111" tem 11 e não é CPF. Documento
// inválido entra no banco, vira chave de deduplicação furada, quebra a
// vinculação de apólice por CPF na importação de planilha e ninguém descobre
// até o cliente reclamar que não vê a apólice dele no Portal.
//
// Arquivos em api/ que começam com "_" não viram rota no Vercel.

export const soDigitos = (v) => String(v ?? "").replace(/\D/g, "");

// Sequência repetida ("000...", "111...") passa no cálculo do dígito
// verificador mas nunca é documento real — é o que sai de teste e de campo
// preenchido no automático.
const repetido = (d) => /^(\d)\1+$/.test(d);

export function validarCPF(valor) {
  const d = soDigitos(valor);
  if (d.length !== 11 || repetido(d)) return false;
  for (const [ate, pos] of [[9, 10], [10, 11]]) {
    let soma = 0;
    for (let i = 0; i < ate; i++) soma += Number(d[i]) * (pos - i);
    let dv = (soma * 10) % 11;
    if (dv === 10) dv = 0;
    if (dv !== Number(d[ate])) return false;
  }
  return true;
}

export function validarCNPJ(valor) {
  const d = soDigitos(valor);
  if (d.length !== 14 || repetido(d)) return false;
  // Pesos oficiais da Receita: 5..2 e depois 9..2, em duas passadas.
  for (const pesos of [[5,4,3,2,9,8,7,6,5,4,3,2], [6,5,4,3,2,9,8,7,6,5,4,3,2]]) {
    const ate = pesos.length;
    let soma = 0;
    for (let i = 0; i < ate; i++) soma += Number(d[i]) * pesos[i];
    const resto = soma % 11;
    const dv = resto < 2 ? 0 : 11 - resto;
    if (dv !== Number(d[ate])) return false;
  }
  return true;
}

/** 'PF' para 11 dígitos, 'PJ' para 14, null se não for nem um nem outro. */
export function tipoPorDocumento(valor) {
  const n = soDigitos(valor).length;
  return n === 11 ? "PF" : n === 14 ? "PJ" : null;
}

export function formatarDocumento(valor) {
  const d = soDigitos(valor);
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  return d;
}

/**
 * Valida e devolve a forma canônica. Uma função só para não haver duas
 * respostas diferentes para "esse documento serve?".
 * @returns {{ok:true, digitos:string, tipo:'PF'|'PJ', formatado:string} | {ok:false, erro:string}}
 */
export function analisarDocumento(valor) {
  const d = soDigitos(valor);
  if (!d) return { ok: false, erro: "Informe o CPF (pessoa física) ou o CNPJ (empresa)." };
  const tipo = tipoPorDocumento(d);
  if (!tipo) {
    return {
      ok: false,
      erro: `O documento tem ${d.length} dígito${d.length === 1 ? "" : "s"}. CPF tem 11 e CNPJ tem 14.`,
    };
  }
  if (tipo === "PF" && !validarCPF(d)) return { ok: false, erro: "CPF inválido — confira os números." };
  if (tipo === "PJ" && !validarCNPJ(d)) return { ok: false, erro: "CNPJ inválido — confira os números." };
  return { ok: true, digitos: d, tipo, formatado: formatarDocumento(d) };
}

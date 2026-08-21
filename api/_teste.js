// Barreira contra o lead FALSO da Meta.
//
// A Meta tem a "Lead Ads Testing Tool", que a agência usa pra conferir se um
// formulário está publicando direito. Ela dispara um lead pelo MESMO webhook
// do lead de verdade — e no dia 21/08 um deles entrou no CRM como lead real:
// nome "<test Lead: Dummy Data for Full_name>", email test@meta.com, SEM
// telefone, com consultor atribuído e em etapa "negociação". Um consultor ia
// gastar o dia tentando ligar pra um lead que não existe, e ele ainda contava
// como lead da CAMPANHA 50% no relatório que a agência usa pra decidir verba.
//
// Os marcadores abaixo são os que a Meta CRIA, não a palavra "teste" solta:
// cliente chamado "Teste Silva" ou email "teste@gmail.com" é gente de verdade
// e NÃO pode ser barrado.
const MARCADORES = [
  /^\s*<\s*test\s+lead\b/i,   // "<test Lead: Dummy Data for Full_name>"
  /\bdummy\s+data\s+for\b/i,  // a Meta preenche todo campo assim
];
const EMAILS_DA_META = new Set(["test@meta.com", "test@fb.com", "test@facebook.com"]);

/** É lead de teste da Meta? (não confundir com cliente chamado "Teste") */
export function ehLeadDeTeste({ nome, email, mensagem, produto_interesse } = {}) {
  if (EMAILS_DA_META.has(String(email ?? "").trim().toLowerCase())) return true;
  for (const campo of [nome, email, mensagem, produto_interesse]) {
    const v = String(campo ?? "");
    if (v && MARCADORES.some((re) => re.test(v))) return true;
  }
  return false;
}

export const MOTIVO_TESTE = "Lead de teste da Meta (ferramenta de teste do formulário)";

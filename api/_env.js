// Leitura de variável de ambiente à prova de espaço invisível.
//
// POR QUE EXISTE: um token gravado por pipe do PowerShell (`Get-Content x |
// vercel env add`) chega ao Vercel com um "\r" grudado no fim — o CLI remove o
// "\n" do CRLF e deixa o "\r". O painel do Vercel mostra o valor idêntico ao
// esperado, e mesmo assim toda requisição levava 401. Copiar de um PDF, do
// Notion ou do WhatsApp produz o mesmo estrago com espaço ou  .
//
// Custou um build inteiro de investigação. Comparar segredo sem normalizar é
// uma armadilha que não avisa: o erro não diz "tem um \r", diz só "não bate".
//
// Arquivos em api/ que começam com "_" não viram rota no Vercel.
const INVISIVEIS = /^[\s ​﻿]+|[\s ​﻿]+$/g;

export function env(nome, padrao = "") {
  const bruto = process.env[nome];
  if (bruto === undefined || bruto === null) return padrao;
  const limpo = String(bruto).replace(INVISIVEIS, "");
  return limpo === "" ? padrao : limpo;
}

// Comparação de segredo em tempo constante, já normalizando os dois lados.
// Tamanhos diferentes vazam pelo early-return, o que é aceitável: o tamanho de
// um token aleatório não é o segredo.
export function segredoConfere(recebido, esperado) {
  const a = String(recebido ?? "").replace(INVISIVEIS, "");
  const b = String(esperado ?? "").replace(INVISIVEIS, "");
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

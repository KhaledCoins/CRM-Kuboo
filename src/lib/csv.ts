// Exportação genérica de tabelas para CSV pt-BR — usado pelos botões
// "Exportar CSV" (Dashboards, Desempenho, Usuários). BOM UTF-8 pro Excel
// abrir acentos certo; separador ";" (padrão pt-BR/Excel). Datas/números já
// devem vir formatados como texto por quem chama esta função.
export interface ColunaCsv {
  chave: string;
  rotulo: string;
}

function escaparCampoCsv(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function exportarCsv(nomeArquivo: string, colunas: ColunaCsv[], linhas: Record<string, unknown>[]): void {
  const cabecalho = colunas.map((c) => escaparCampoCsv(c.rotulo)).join(";");
  const corpo = linhas.map((linha) => colunas.map((c) => escaparCampoCsv(linha[c.chave])).join(";"));
  const csv = [cabecalho, ...corpo].join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nomeArquivo.endsWith(".csv") ? nomeArquivo : `${nomeArquivo}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

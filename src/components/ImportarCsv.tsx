import { useMemo, useRef, useState } from "react";
import { X, Upload, FileSpreadsheet, ArrowRight, Check, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { Button } from "./ui";
import { supabase } from "../lib/supabase";

export type TipoCampo = "texto" | "moeda" | "data" | "numero";
export interface CampoImport {
  key: string;
  label: string;
  obrigatorio?: boolean;
  tipo?: TipoCampo;
}

interface Props {
  aberto: boolean;
  onFechar: () => void;
  tabela: string;
  titulo: string;
  campos: CampoImport[];
  onConcluido?: (inseridos: number) => void;
  // Resolve um CPF do CSV para o client_id real (vincula ao cadastro do cliente).
  // Sem match, a linha é pulada — apólice/consórcio sem dono não vira registro órfão.
  resolverCpf?: { origem: string; destino: string };
}

/* ─────────── Parser CSV feito à mão (zero dependência) ─────────── */

// Detecta o delimitador olhando a 1ª linha "real" (fora de aspas): ";" ou ",".
function detectarDelimitador(texto: string): ";" | "," {
  let emAspas = false;
  let ponto = 0;
  let virgula = 0;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (c === '"') {
      if (emAspas && texto[i + 1] === '"') { i++; continue; }
      emAspas = !emAspas;
    } else if (!emAspas) {
      if (c === ";") ponto++;
      else if (c === ",") virgula++;
      else if (c === "\n") break; // decide na 1ª linha
    }
  }
  return ponto >= virgula ? ";" : ",";
}

// Parser completo: respeita aspas duplas com escape ("") e quebras de linha internas.
export function parseCsv(textoBruto: string): { headers: string[]; linhas: string[][] } {
  // Tolera BOM.
  let texto = textoBruto.replace(/^﻿/, "");
  // Normaliza quebras de linha.
  texto = texto.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const delim = detectarDelimitador(texto);

  const registros: string[][] = [];
  let campo = "";
  let linha: string[] = [];
  let emAspas = false;

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (emAspas) {
      if (c === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i++; }
        else emAspas = false;
      } else {
        campo += c;
      }
    } else {
      if (c === '"') {
        emAspas = true;
      } else if (c === delim) {
        linha.push(campo); campo = "";
      } else if (c === "\n") {
        linha.push(campo); campo = "";
        registros.push(linha); linha = [];
      } else {
        campo += c;
      }
    }
  }
  // Último campo/linha (arquivos sem quebra final).
  if (campo.length > 0 || linha.length > 0) { linha.push(campo); registros.push(linha); }

  // Remove linhas totalmente vazias.
  const limpos = registros.filter((r) => r.some((c) => c.trim() !== ""));
  if (!limpos.length) return { headers: [], linhas: [] };

  const headers = limpos[0].map((h) => h.trim());
  const linhas = limpos.slice(1);
  return { headers, linhas };
}

/* ─────────── Conversões pt-BR ─────────── */

// "R$ 1.234,56" / "1.234,56" / "1234.56" → 1234.56
export function paraNumero(bruto: string): number | null {
  if (bruto == null) return null;
  let s = String(bruto).trim();
  if (!s) return null;
  s = s.replace(/R\$/gi, "").replace(/\s/g, "");
  // Remove tudo que não for dígito, sinal, ponto ou vírgula.
  s = s.replace(/[^\d.,-]/g, "");
  if (!s) return null;
  const temVirgula = s.includes(",");
  const temPonto = s.includes(".");
  if (temVirgula && temPonto) {
    // pt-BR: ponto = milhar, vírgula = decimal.
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (temVirgula) {
    s = s.replace(",", ".");
  }
  // (só ponto → assume decimal ISO)
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// "DD/MM/YYYY", "DD/MM/YY" ou ISO "YYYY-MM-DD" → "YYYY-MM-DD"
export function paraData(bruto: string): string | null {
  if (bruto == null) return null;
  const s = String(bruto).trim();
  if (!s) return null;
  // ISO já pronto (pega só a parte da data).
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  // DD/MM/YYYY ou DD/MM/YY (aceita - ou . como separador também).
  const br = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/);
  if (br) {
    const dia = br[1].padStart(2, "0");
    const mes = br[2].padStart(2, "0");
    let ano = br[3];
    if (ano.length === 2) ano = (Number(ano) >= 70 ? "19" : "20") + ano;
    return `${ano}-${mes}-${dia}`;
  }
  return null;
}

function converter(valor: string, tipo?: TipoCampo): any {
  const v = (valor ?? "").trim();
  if (v === "") return null;
  if (tipo === "moeda" || tipo === "numero") return paraNumero(v);
  if (tipo === "data") return paraData(v);
  return v;
}

/* ─────────── Pré-seleção por similaridade de nome ─────────── */

function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function melhorHeader(campo: CampoImport, headers: string[]): string {
  const alvos = [normalizar(campo.label), normalizar(campo.key)];
  // Tokens úteis extra pra casar "Cliente" → "cliente_nome".
  const chaveTokens = campo.key.split("_").map(normalizar);
  let melhor = "";
  let melhorScore = 0;
  for (const h of headers) {
    const hn = normalizar(h);
    if (!hn) continue;
    let score = 0;
    for (const alvo of alvos) {
      if (!alvo) continue;
      if (hn === alvo) score = Math.max(score, 100);
      else if (hn.includes(alvo) || alvo.includes(hn)) score = Math.max(score, 60);
    }
    for (const t of chaveTokens) {
      if (t && hn.includes(t)) score = Math.max(score, 40);
    }
    if (score > melhorScore) { melhorScore = score; melhor = h; }
  }
  return melhorScore > 0 ? melhor : "";
}

/* ─────────── Componente ─────────── */

const soDigitos = (s: any) => String(s ?? "").replace(/\D/g, "");

export function ImportarCsv({ aberto, onFechar, tabela, titulo, campos, onConcluido, resolverCpf }: Props) {
  const [passo, setPasso] = useState<1 | 2 | 3>(1);
  const [nomeArquivo, setNomeArquivo] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [linhas, setLinhas] = useState<string[][]>([]);
  const [mapa, setMapa] = useState<Record<string, string>>({});
  const [arrastando, setArrastando] = useState(false);
  const [progresso, setProgresso] = useState(0);
  const [importando, setImportando] = useState(false);
  const [resumo, setResumo] = useState<{ inseridos: number; pulados: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function resetar() {
    setPasso(1); setNomeArquivo(""); setHeaders([]); setLinhas([]);
    setMapa({}); setArrastando(false); setProgresso(0); setImportando(false); setResumo(null);
  }

  function fechar() {
    if (importando) return;
    resetar();
    onFechar();
  }

  async function receberArquivo(file: File) {
    if (!/\.csv$/i.test(file.name)) {
      toast.error("Selecione um arquivo .csv (exporte sua planilha como CSV).");
      return;
    }
    try {
      const texto = await file.text();
      const { headers: hs, linhas: ls } = parseCsv(texto);
      if (!hs.length) { toast.error("Não foi possível ler colunas neste arquivo."); return; }
      // Pré-seleção por similaridade.
      const m: Record<string, string> = {};
      for (const campo of campos) m[campo.key] = melhorHeader(campo, hs);
      setNomeArquivo(file.name);
      setHeaders(hs);
      setLinhas(ls);
      setMapa(m);
      setPasso(2);
    } catch {
      toast.error("Falha ao ler o arquivo. Tente exportar novamente como CSV.");
    }
  }

  function onInputFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) receberArquivo(f);
    e.target.value = "";
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setArrastando(false);
    const f = e.dataTransfer.files?.[0];
    if (f) receberArquivo(f);
  }

  // Índice do header selecionado para cada campo.
  const idxDe = (campoKey: string) => headers.indexOf(mapa[campoKey]);

  // Preview convertido das 8 primeiras linhas.
  const preview = useMemo(() => {
    return linhas.slice(0, 8).map((lin) => {
      const obj: Record<string, any> = {};
      for (const campo of campos) {
        const idx = idxDe(campo.key);
        obj[campo.key] = idx >= 0 ? converter(lin[idx] ?? "", campo.tipo) : null;
      }
      return obj;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linhas, mapa, campos, headers]);

  const camposObrigatorios = campos.filter((c) => c.obrigatorio);
  const faltaObrigatorio = camposObrigatorios.filter((c) => !mapa[c.key]);

  function exibir(v: any): string {
    if (v == null || v === "") return "—";
    return String(v);
  }

  async function importar() {
    if (!supabase) { toast.error("Conexão indisponível no momento."); return; }
    if (faltaObrigatorio.length) {
      toast.error(`Mapeie os campos obrigatórios: ${faltaObrigatorio.map((c) => c.label).join(", ")}.`);
      return;
    }
    setPasso(3);
    setImportando(true);
    setProgresso(0);

    // Monta os registros, pulando linhas sem campos obrigatórios.
    const registros: Record<string, any>[] = [];
    let pulados = 0;
    for (const lin of linhas) {
      const obj: Record<string, any> = {};
      let valido = true;
      for (const campo of campos) {
        const idx = idxDe(campo.key);
        const v = idx >= 0 ? converter(lin[idx] ?? "", campo.tipo) : null;
        if (campo.obrigatorio && (v == null || v === "")) { valido = false; break; }
        if (v != null) obj[campo.key] = v;
      }
      if (valido) registros.push(obj);
      else pulados++;
    }

    // Resolve CPF → client_id (vincula ao cliente cadastrado). Linhas sem match
    // são descartadas para não criar apólice/consórcio órfão (sem dono no Portal).
    if (resolverCpf && supabase) {
      const cpfs = Array.from(new Set(registros.map((r) => soDigitos(r[resolverCpf.origem])).filter(Boolean)));
      const mapa = new Map<string, string>();
      // Busca perfis em blocos e casa por CPF normalizado (o banco pode guardar formatado).
      const { data: perfis } = await supabase.from("profiles").select("id, cpf").limit(10000);
      for (const p of (perfis as any[]) || []) {
        const d = soDigitos(p.cpf);
        if (d) mapa.set(d, p.id);
      }
      const comDono: Record<string, any>[] = [];
      for (const r of registros) {
        const id = mapa.get(soDigitos(r[resolverCpf.origem]));
        if (!id) { pulados++; continue; }         // cliente não encontrado → pula
        r[resolverCpf.destino] = id;
        delete r[resolverCpf.origem];             // 'cliente_cpf' não é coluna real
        comDono.push(r);
      }
      registros.length = 0;
      registros.push(...comDono);
      void cpfs; // (mantém a leitura clara; cpfs úteis se quisermos logar depois)
    }

    if (!registros.length) {
      setResumo({ inseridos: 0, pulados });
      setImportando(false);
      setProgresso(100);
      toast.error(resolverCpf
        ? "Nenhuma linha importada. Confira se os CPFs do arquivo já têm cliente cadastrado."
        : "Nenhuma linha válida para importar (verifique os campos obrigatórios).");
      return;
    }

    // Inserts em lotes de 100.
    const LOTE = 100;
    let inseridos = 0;
    for (let i = 0; i < registros.length; i += LOTE) {
      const lote = registros.slice(i, i + LOTE);
      const { error } = await supabase.from(tabela).insert(lote);
      if (error) {
        pulados += lote.length; // lote inteiro conta como pulado, mas segue em frente
      } else {
        inseridos += lote.length;
      }
      setProgresso(Math.round(Math.min(i + LOTE, registros.length) / registros.length * 100));
    }

    setResumo({ inseridos, pulados });
    setImportando(false);
    setProgresso(100);
    if (inseridos > 0) toast.success(`${inseridos} ${inseridos === 1 ? "linha importada" : "linhas importadas"}.`);
    if (inseridos === 0) toast.error("Nenhuma linha foi importada. Confira o mapeamento e tente de novo.");
    onConcluido?.(inseridos);
  }

  if (!aberto) return null;

  const cardCls = "bg-white rounded-2xl shadow-2xl w-[min(720px,94vw)] max-h-[88vh] overflow-y-auto";
  const selectCls = "w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none text-ink focus:border-brand-400 transition-colors";

  return (
    <div onClick={fechar} className="fixed inset-0 bg-slate-900/45 backdrop-blur-sm grid place-items-center z-50 p-4">
      <div onClick={(e) => e.stopPropagation()} className={cardCls}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 sticky top-0 bg-white z-10">
          <div className="flex items-center gap-2.5">
            <span className="w-9 h-9 rounded-xl bg-brand-50 text-brand-500 grid place-items-center shrink-0">
              <FileSpreadsheet size={18} />
            </span>
            <div>
              <h3 className="font-extrabold text-ink text-lg leading-tight">{titulo}</h3>
              <p className="text-xs text-muted">
                {passo === 1 && "Passo 1 de 3 — escolha o arquivo"}
                {passo === 2 && "Passo 2 de 3 — relacione as colunas"}
                {passo === 3 && "Passo 3 de 3 — importação"}
              </p>
            </div>
          </div>
          <button type="button" onClick={fechar} disabled={importando} className="text-slate-400 hover:text-slate-600 disabled:opacity-40">
            <X size={20} />
          </button>
        </div>

        {/* Passo 1: arquivo */}
        {passo === 1 && (
          <div className="p-6">
            <div
              onDragOver={(e) => { e.preventDefault(); setArrastando(true); }}
              onDragLeave={() => setArrastando(false)}
              onDrop={onDrop}
              onClick={() => inputRef.current?.click()}
              className={`cursor-pointer rounded-2xl border-2 border-dashed grid place-items-center text-center py-14 px-6 transition-colors ${arrastando ? "border-brand-400 bg-brand-50" : "border-slate-200 hover:border-brand-300 hover:bg-slate-50"}`}
            >
              <span className="w-14 h-14 rounded-2xl bg-brand-50 text-brand-500 grid place-items-center mb-4">
                <Upload size={26} />
              </span>
              <p className="font-bold text-ink">Arraste seu arquivo .csv aqui</p>
              <p className="text-sm text-muted mt-1">ou clique para selecionar. Exporte sua planilha do Excel como CSV.</p>
              <input ref={inputRef} type="file" accept=".csv,text/csv" onChange={onInputFile} className="hidden" />
            </div>
          </div>
        )}

        {/* Passo 2: mapeamento + preview */}
        {passo === 2 && (
          <div className="p-6">
            <div className="flex items-center gap-2 mb-4 text-sm text-muted">
              <FileSpreadsheet size={15} className="text-brand-500" />
              <span className="font-bold text-ink">{nomeArquivo}</span>
              <span>· {linhas.length} {linhas.length === 1 ? "linha" : "linhas"}</span>
            </div>

            <p className="text-xs font-bold text-muted uppercase tracking-wide mb-2">Relacione as colunas do seu arquivo</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
              {campos.map((campo) => (
                <label key={campo.key} className="block">
                  <span className="text-xs font-bold text-ink block mb-1">
                    {campo.label}{campo.obrigatorio && <span className="text-red-500"> *</span>}
                  </span>
                  <select
                    className={selectCls}
                    value={mapa[campo.key] ?? ""}
                    onChange={(e) => setMapa((p) => ({ ...p, [campo.key]: e.target.value }))}
                  >
                    <option value="">— Ignorar —</option>
                    {headers.map((h, i) => <option key={`${h}-${i}`} value={h}>{h}</option>)}
                  </select>
                </label>
              ))}
            </div>

            {faltaObrigatorio.length > 0 && (
              <p className="text-xs text-amber-700 bg-amber-50 rounded-xl px-3 py-2 mb-4">
                Relacione os campos obrigatórios para continuar: {faltaObrigatorio.map((c) => c.label).join(", ")}.
              </p>
            )}

            <p className="text-xs font-bold text-muted uppercase tracking-wide mb-2">Prévia (8 primeiras linhas)</p>
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted border-b border-slate-200 bg-slate-50">
                    {campos.map((c) => (
                      <th key={c.key} className="font-bold text-xs uppercase tracking-wide py-2.5 px-3 whitespace-nowrap">{c.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.length ? preview.map((row, ri) => (
                    <tr key={ri} className="border-b border-slate-100">
                      {campos.map((c) => (
                        <td key={c.key} className="py-2 px-3 whitespace-nowrap text-ink">{exibir(row[c.key])}</td>
                      ))}
                    </tr>
                  )) : (
                    <tr><td colSpan={campos.length} className="py-6 text-center text-muted text-sm">Sem linhas para pré-visualizar.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Passo 3: progresso + resumo */}
        {passo === 3 && (
          <div className="p-6">
            {!resumo ? (
              <div className="py-6">
                <p className="text-sm font-bold text-ink mb-3">Importando registros…</p>
                <div className="h-3 rounded-full bg-slate-100 overflow-hidden">
                  <div className="h-full bg-brand-500 transition-all duration-200" style={{ width: `${progresso}%` }} />
                </div>
                <p className="text-xs text-muted mt-2 tabular-nums">{progresso}%</p>
              </div>
            ) : (
              <div className="py-6 text-center">
                <span className="w-14 h-14 rounded-2xl bg-green-50 text-green-600 grid place-items-center mx-auto mb-4">
                  <Check size={26} />
                </span>
                <p className="font-extrabold text-ink text-lg">Importação concluída</p>
                <div className="flex items-center justify-center gap-6 mt-4">
                  <div>
                    <p className="text-3xl font-display text-green-600 leading-none">{resumo.inseridos}</p>
                    <p className="text-xs text-muted mt-1">importadas</p>
                  </div>
                  <div>
                    <p className="text-3xl font-display text-slate-400 leading-none">{resumo.pulados}</p>
                    <p className="text-xs text-muted mt-1">puladas por erro</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-slate-100 sticky bottom-0 bg-white">
          {passo === 2 ? (
            <Button variant="outline" icon={ArrowLeft} onClick={() => { resetar(); }}>Trocar arquivo</Button>
          ) : <span />}

          {passo === 1 && <span className="text-xs text-muted">Nenhuma dependência externa — leitura 100% local.</span>}

          {passo === 2 && (
            <Button icon={ArrowRight} disabled={faltaObrigatorio.length > 0} onClick={importar}>
              Importar {linhas.length} {linhas.length === 1 ? "linha" : "linhas"}
            </Button>
          )}

          {passo === 3 && (
            <div className="ml-auto flex items-center gap-3">
              {resumo && <Button variant="outline" onClick={() => { resetar(); }}>Importar outro</Button>}
              <Button onClick={fechar} disabled={importando}>{resumo ? "Fechar" : "Aguarde…"}</Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

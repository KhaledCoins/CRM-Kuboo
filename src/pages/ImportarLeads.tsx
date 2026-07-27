import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { toast } from "sonner";
import {
  Upload, FileSpreadsheet, AlertTriangle, CheckCircle2, RotateCcw, Info,
} from "lucide-react";
import { PageHeader, Card, Button, Select } from "../components/ui";
import { supabase } from "../lib/supabase";
import { onlyDigits } from "../lib/format";
import type { Modulo } from "../lib/nav";
import {
  parseCsv, heuristicaMapeamento, normalizarEtapa, normalizarEmail, nomesEquivalentes,
  CAMPOS_LEAD, type CampoLead,
} from "../lib/importCsv";

// Migração histórica dos ~754 leads exportados do Contact2Sale (CSV) — ver
// ARQUIVOS QUE VOCÊ PODE EDITAR desta tarefa. Regras de banco (críticas):
//  - leads.origem tem CHECK ('chatbot'|'formulario'|'whatsapp'|'indicacao'|'portal') → import
//    usa sempre 'formulario'; a fonte real do C2S vai em leads.fonte (texto livre).
//  - leads.etapa tem CHECK — normalizamos o texto do CSV pro enum (importCsv.ts).
//  - Existe um TRIGGER AFTER INSERT que distribui leads com vendedor_id null pelo
//    rodízio real da equipe. Para import histórico isso é indesejado, então:
//    vendedor resolvido (email/nome bate com profiles) → vendedor_id preenchido
//    (trigger pula); sem match → aplica a opção escolhida (fixo | motor).
//  - Supabase PGRST102: todo objeto de um insert em lote precisa ter as MESMAS
//    chaves — os payloads abaixo sempre incluem o mesmo conjunto de campos.

const TAMANHO_LOTE = 100;

interface MembroEquipe { id: string; name: string; email: string | null; role: string | null }

interface LinhaPreparada {
  linha: number; // número da linha na planilha original (1 = header)
  nome: string;
  telefone: string | null;
  email: string | null;
  campanha: string | null;
  fonte: string | null;
  canal: string | null;
  etapa: string;
  vendedorTexto: string | null;
  vendedorId: string | null;
}

interface ErroImportacao { linha: number; nome: string; motivo: string }
interface ResultadoImportacao { importados: number; duplicados: number; erros: ErroImportacao[] }

export function ImportarLeads({ modulo: moduloRota }: { modulo: Modulo }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [arrastando, setArrastando] = useState(false);

  const [arquivoNome, setArquivoNome] = useState<string | null>(null);
  const [parsed, setParsed] = useState<{ headers: string[]; rows: string[][] } | null>(null);
  const [mapa, setMapa] = useState<Record<number, CampoLead>>({});
  const [modulo, setModulo] = useState<Modulo>(moduloRota);

  const [equipe, setEquipe] = useState<MembroEquipe[]>([]);
  const [carregandoEquipe, setCarregandoEquipe] = useState(true);

  const [dedup, setDedup] = useState(true);
  const [fallback, setFallback] = useState<"fixo" | "motor">("fixo");
  const [fallbackUserId, setFallbackUserId] = useState("");

  const [importando, setImportando] = useState(false);
  const [progresso, setProgresso] = useState(0);
  const [resultado, setResultado] = useState<ResultadoImportacao | null>(null);

  useEffect(() => {
    async function carregarEquipe() {
      if (!supabase) { setCarregandoEquipe(false); return; }
      const { data, error } = await supabase
        .from("profiles").select("id, name, email, role")
        .in("role", ["vendedor", "gestor", "admin"]).order("name");
      if (error) console.error("[importar-leads] carregar equipe:", error.message);
      setEquipe((data as MembroEquipe[]) ?? []);
      setCarregandoEquipe(false);
    }
    carregarEquipe();
  }, []);

  const nomePorId = useMemo(() => {
    const m: Record<string, string> = {};
    equipe.forEach((p) => { m[p.id] = p.name; });
    return m;
  }, [equipe]);

  function resetarTudo() {
    setArquivoNome(null); setParsed(null); setMapa({});
    setImportando(false); setProgresso(0); setResultado(null);
  }

  async function receberArquivo(file: File) {
    if (!/\.csv$/i.test(file.name)) {
      toast.error("Selecione um arquivo .csv (exporte a planilha do C2S como CSV).");
      return;
    }
    try {
      const texto = await file.text();
      const res = parseCsv(texto);
      if (!res.headers.length) { toast.error("Não foi possível ler o cabeçalho do CSV."); return; }
      if (!res.rows.length) { toast.error("O CSV não tem linhas de dados."); return; }
      setArquivoNome(file.name);
      setParsed(res);
      setMapa(heuristicaMapeamento(res.headers));
      setResultado(null);
      toast.success(`${res.rows.length} linhas detectadas em "${file.name}".`);
    } catch (err) {
      console.error("[importar-leads] parse:", err);
      toast.error("Erro ao ler o arquivo CSV.");
    }
  }

  function onInputFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) receberArquivo(f);
  }
  function onDrop(e: DragEvent) {
    e.preventDefault();
    setArrastando(false);
    const f = e.dataTransfer.files?.[0];
    if (f) receberArquivo(f);
  }

  // Mapeamento é 1:1 — escolher um campo para uma coluna libera esse campo
  // de qualquer outra coluna que o usava antes.
  function setMapeamento(colIdx: number, campo: CampoLead) {
    setMapa((prev) => {
      const next = { ...prev };
      if (campo !== "ignorar") {
        for (const k of Object.keys(next)) {
          const ki = Number(k);
          if (ki !== colIdx && next[ki] === campo) next[ki] = "ignorar";
        }
      }
      next[colIdx] = campo;
      return next;
    });
  }

  const indiceDoCampo = (campo: CampoLead): number | null => {
    const par = Object.entries(mapa).find(([, c]) => c === campo);
    return par ? Number(par[0]) : null;
  };
  const idxNome = indiceDoCampo("nome");

  const linhasPreparadas: LinhaPreparada[] = useMemo(() => {
    if (!parsed) return [];
    const idx = {
      nome: indiceDoCampo("nome"), telefone: indiceDoCampo("telefone"), email: indiceDoCampo("email"),
      campanha: indiceDoCampo("campanha"), fonte: indiceDoCampo("fonte"), canal: indiceDoCampo("canal"),
      etapa: indiceDoCampo("etapa"), vendedor: indiceDoCampo("vendedor"),
    };
    const porEmail = new Map(equipe.filter((m) => m.email).map((m) => [normalizarEmail(m.email as string), m]));

    return parsed.rows.map((cols, i) => {
      const get = (col: number | null) => (col === null ? "" : (cols[col] ?? "").trim());
      const nome = get(idx.nome);
      const vendedorTexto = get(idx.vendedor) || null;
      let vendedorId: string | null = null;
      if (vendedorTexto) {
        const porEmailMatch = porEmail.get(normalizarEmail(vendedorTexto));
        const match = porEmailMatch ?? equipe.find((m) => nomesEquivalentes(m.name, vendedorTexto));
        vendedorId = match?.id ?? null;
      }
      const etapaTexto = get(idx.etapa);
      const etapa = (etapaTexto && normalizarEtapa(etapaTexto)) || "novos";
      return {
        linha: i + 2,
        nome,
        telefone: get(idx.telefone) || null,
        email: get(idx.email) || null,
        campanha: get(idx.campanha) || null,
        fonte: get(idx.fonte) || null,
        canal: get(idx.canal) || null,
        etapa,
        vendedorTexto,
        vendedorId,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed, mapa, equipe]);

  const semVendedorResolvido = linhasPreparadas.filter((l) => !l.vendedorId).length;
  const comTextoNaoEncontrado = linhasPreparadas.filter((l) => l.vendedorTexto && !l.vendedorId).length;
  const semNome = linhasPreparadas.filter((l) => !l.nome).length;

  async function buscarContatosExistentes(): Promise<{ telefones: Set<string>; emails: Set<string> }> {
    const telefones = new Set<string>();
    const emails = new Set<string>();
    if (!supabase) return { telefones, emails };
    const TAM = 1000;
    let from = 0;
    for (;;) {
      const { data, error } = await supabase.from("leads").select("telefone, email").range(from, from + TAM - 1);
      if (error) { console.error("[importar-leads] contatos existentes:", error.message); break; }
      const linhas = (data as { telefone: string | null; email: string | null }[]) ?? [];
      linhas.forEach((l) => {
        if (l.telefone) telefones.add(onlyDigits(l.telefone));
        if (l.email) emails.add(normalizarEmail(l.email));
      });
      if (linhas.length < TAM) break;
      from += TAM;
    }
    return { telefones, emails };
  }

  async function iniciarImportacao() {
    if (!supabase) { toast.error("Supabase não configurado."); return; }
    if (idxNome === null) { toast.error("Mapeie a coluna Nome antes de importar."); return; }
    if (fallback === "fixo" && !fallbackUserId && semVendedorResolvido > 0) {
      toast.error('Escolha um vendedor fixo para os leads sem responsável identificado, ou selecione "deixar o motor distribuir".');
      return;
    }

    setImportando(true);
    setProgresso(0);
    setResultado(null);

    const erros: ErroImportacao[] = [];
    linhasPreparadas.filter((l) => !l.nome).forEach((l) => erros.push({ linha: l.linha, nome: "(sem nome)", motivo: "Nome vazio — linha ignorada" }));
    const validas = linhasPreparadas.filter((l) => !!l.nome);

    let duplicados = 0;
    let paraImportar = validas;
    if (dedup) {
      const { telefones, emails } = await buscarContatosExistentes();
      const vistosTelefone = new Set<string>();
      const vistosEmail = new Set<string>();
      paraImportar = validas.filter((l) => {
        const tel = l.telefone ? onlyDigits(l.telefone) : null;
        const em = l.email ? normalizarEmail(l.email) : null;
        const jaExiste = (!!tel && (telefones.has(tel) || vistosTelefone.has(tel))) || (!!em && (emails.has(em) || vistosEmail.has(em)));
        if (jaExiste) { duplicados++; return false; }
        if (tel) vistosTelefone.add(tel);
        if (em) vistosEmail.add(em);
        return true;
      });
    }

    const payloadDaLinha = (l: LinhaPreparada) => ({
      nome: l.nome,
      telefone: l.telefone,
      email: l.email,
      campanha: l.campanha,
      fonte: l.fonte,
      canal: l.canal,
      etapa: l.etapa,
      modulo,
      origem: "formulario",
      status: "novo",
      vendedor_id: l.vendedorId ?? (fallback === "fixo" ? (fallbackUserId || null) : null),
      // etapa "perdido" sem descartado é um formato que nenhuma tela trata
      // (Bolsão/Pipeline/Dashboards esperam soft-delete via `descartado`) —
      // marca junto pra já nascer consistente.
      descartado: l.etapa === "perdido",
    });

    let importados = 0;
    const total = paraImportar.length;
    for (let i = 0; i < total; i += TAMANHO_LOTE) {
      const loteLinhas = paraImportar.slice(i, i + TAMANHO_LOTE);
      const lotePayload = loteLinhas.map(payloadDaLinha);
      const { error } = await supabase.from("leads").insert(lotePayload);
      if (error) {
        // Uma linha ruim não pode derrubar o lote inteiro — reinsere uma a uma pra achar a real culpada.
        for (const l of loteLinhas) {
          const { error: e1 } = await supabase.from("leads").insert(payloadDaLinha(l));
          if (e1) erros.push({ linha: l.linha, nome: l.nome, motivo: e1.message });
          else importados++;
        }
      } else {
        importados += lotePayload.length;
      }
      setProgresso(Math.round((Math.min(i + TAMANHO_LOTE, total) / Math.max(total, 1)) * 100));
    }

    setResultado({ importados, duplicados, erros });
    setImportando(false);
    if (erros.length === 0) toast.success(`${importados} leads importados com sucesso.`);
    else toast.error(`${importados} importados, ${erros.length} com erro — veja o relatório abaixo.`);
  }

  const inputCls = "w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none text-ink focus:border-brand-400 transition-colors";
  const labelCls = "text-xs font-bold text-muted uppercase tracking-wide block mb-1.5";
  const selectCls = "bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none text-ink focus:border-brand-400 transition-colors w-full";

  const colunasPreview: { chave: keyof LinhaPreparada; rotulo: string }[] = [
    { chave: "nome", rotulo: "Nome" }, { chave: "telefone", rotulo: "Telefone" }, { chave: "email", rotulo: "E-mail" },
    { chave: "campanha", rotulo: "Campanha" }, { chave: "fonte", rotulo: "Fonte" }, { chave: "canal", rotulo: "Canal" },
    { chave: "etapa", rotulo: "Etapa" },
  ];

  return (
    <>
      <PageHeader
        title="Importar leads"
        subtitle="Migração histórica do Contact2Sale — envie o CSV exportado, ajuste o mapeamento e confirme."
        icon={Upload}
      />

      <Card className="mb-5">
        <div className="flex items-center justify-between gap-4 flex-wrap mb-4">
          <div>
            <span className={labelCls}>Módulo de destino</span>
            <Select
              value={modulo}
              onChange={(v) => setModulo(v as Modulo)}
              options={[{ value: "seguros", label: "Seguros" }, { value: "consorcios", label: "Consórcios" }]}
            />
          </div>
          {arquivoNome && (
            <Button variant="outline" icon={RotateCcw} onClick={resetarTudo}>Trocar arquivo</Button>
          )}
        </div>

        {!parsed ? (
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
            <p className="font-bold text-ink">Arraste o CSV do Contact2Sale aqui</p>
            <p className="text-sm text-muted mt-1">ou clique para selecionar. Aceita separador ; ou , — detectamos automaticamente.</p>
            <input ref={inputRef} type="file" accept=".csv,text/csv" onChange={onInputFile} className="hidden" />
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-muted">
            <FileSpreadsheet size={15} className="text-brand-500" />
            <span className="font-bold text-ink">{arquivoNome}</span>
            <span>· {parsed.rows.length} {parsed.rows.length === 1 ? "linha" : "linhas"} · {parsed.headers.length} colunas</span>
          </div>
        )}
      </Card>

      {parsed && (
        <>
          <Card className="mb-5">
            <h3 className="font-bold text-ink mb-1">Mapeamento de colunas</h3>
            <p className="text-sm text-muted mb-4">Relacione cada coluna do arquivo com um campo do lead. Pré-preenchido por semelhança de nome — confira antes de importar.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {parsed.headers.map((h, i) => (
                <label key={`${h}-${i}`} className="block">
                  <span className="text-xs font-bold text-ink block mb-1 truncate" title={h}>{h || `Coluna ${i + 1}`}</span>
                  <select className={selectCls} value={mapa[i] ?? "ignorar"} onChange={(e) => setMapeamento(i, e.target.value as CampoLead)}>
                    {CAMPOS_LEAD.map((c) => <option key={c.valor} value={c.valor}>{c.rotulo}</option>)}
                  </select>
                </label>
              ))}
            </div>
            {idxNome === null && (
              <p className="text-xs text-red-700 bg-red-50 rounded-xl px-3 py-2 mt-4 flex items-center gap-2">
                <AlertTriangle size={14} className="shrink-0" /> Mapeie a coluna Nome — é obrigatória para importar.
              </p>
            )}
            {semNome > 0 && idxNome !== null && (
              <p className="text-xs text-amber-700 bg-amber-50 rounded-xl px-3 py-2 mt-4 flex items-center gap-2">
                <AlertTriangle size={14} className="shrink-0" /> {semNome} linha(s) com o campo Nome vazio serão ignoradas.
              </p>
            )}
          </Card>

          <Card className="mb-5" pad={false}>
            <div className="p-5 pb-0">
              <h3 className="font-bold text-ink mb-1">Prévia</h3>
              <p className="text-sm text-muted mb-4">5 primeiras linhas já com o mapeamento aplicado.</p>
            </div>
            <div className="overflow-x-auto px-5 pb-5">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted border-b border-slate-200">
                    {colunasPreview.map((c) => <th key={c.chave} className="font-bold text-xs uppercase tracking-wide py-2.5 px-3 whitespace-nowrap">{c.rotulo}</th>)}
                    <th className="font-bold text-xs uppercase tracking-wide py-2.5 px-3 whitespace-nowrap">Vendedor</th>
                  </tr>
                </thead>
                <tbody>
                  {linhasPreparadas.slice(0, 5).map((l) => (
                    <tr key={l.linha} className="border-b border-slate-100">
                      {colunasPreview.map((c) => (
                        <td key={c.chave} className="py-2 px-3 whitespace-nowrap text-ink">{(l[c.chave] as string) || "—"}</td>
                      ))}
                      <td className="py-2 px-3 whitespace-nowrap text-ink">
                        {l.vendedorId ? nomePorId[l.vendedorId] : l.vendedorTexto ? <span className="text-amber-600">{l.vendedorTexto} (não encontrado)</span> : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="mb-5">
            <h3 className="font-bold text-ink mb-4">Opções de importação</h3>

            <label className="flex items-center justify-between gap-3 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 cursor-pointer mb-4">
              <span>
                <span className="text-sm font-bold text-ink block">Pular duplicados</span>
                <span className="text-xs text-muted">Não importa leads cujo telefone ou e-mail já exista no CRM.</span>
              </span>
              <input type="checkbox" checked={dedup} onChange={(e) => setDedup(e.target.checked)} className="w-4 h-4 accent-brand-500 shrink-0" />
            </label>

            <div className="mb-2">
              <span className={labelCls}>Leads sem vendedor identificado no arquivo</span>
              <p className="text-sm text-muted mb-3">
                {carregandoEquipe ? "Carregando equipe…" : (
                  <>{semVendedorResolvido} de {linhasPreparadas.length} linha(s) ficarão sem responsável definido pelo arquivo
                    {comTextoNaoEncontrado > 0 && ` (${comTextoNaoEncontrado} com nome/e-mail de vendedor que não bateu com a equipe)`}.
                    Escolha o que fazer com elas:</>
                )}
              </p>
              <div className="grid gap-2">
                <label className="flex items-center gap-2 text-sm text-ink bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 cursor-pointer">
                  <input type="radio" name="fallback-vendedor" checked={fallback === "fixo"} onChange={() => setFallback("fixo")} className="accent-brand-500 shrink-0" />
                  <span className="shrink-0">Atribuir tudo a um vendedor fixo</span>
                  {fallback === "fixo" && (
                    <select
                      value={fallbackUserId}
                      onChange={(e) => setFallbackUserId(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      className="ml-auto bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs outline-none text-ink"
                    >
                      <option value="">Escolha…</option>
                      {equipe.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  )}
                </label>
                <label className="flex items-center gap-2 text-sm text-ink bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 cursor-pointer">
                  <input type="radio" name="fallback-vendedor" checked={fallback === "motor"} onChange={() => setFallback("motor")} className="accent-brand-500 shrink-0" />
                  Deixar o motor distribuir (entram no rodízio real da equipe)
                </label>
              </div>
              {fallback === "motor" && (
                <p className="text-xs text-amber-700 bg-amber-50 rounded-xl px-3 py-2 mt-3 flex items-center gap-2">
                  <Info size={14} className="shrink-0" /> Atenção: leads sem vendedor caem no rodízio de distribuição em tempo real assim que forem gravados, exatamente como um lead novo do site.
                </p>
              )}
            </div>
          </Card>

          <Card className="mb-5">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <p className="font-bold text-ink">Pronto para importar</p>
                <p className="text-sm text-muted">{linhasPreparadas.length} linha(s) no arquivo · lotes de {TAMANHO_LOTE}.</p>
              </div>
              <Button icon={Upload} onClick={iniciarImportacao} disabled={importando || idxNome === null}>
                {importando ? "Importando…" : `Importar ${linhasPreparadas.length} leads`}
              </Button>
            </div>
            {importando && (
              <div className="mt-4">
                <div className="h-3 rounded-full bg-slate-100 overflow-hidden">
                  <div className="h-full bg-brand-500 transition-all duration-200" style={{ width: `${progresso}%` }} />
                </div>
                <p className="text-xs text-muted mt-2 tabular-nums">{progresso}%</p>
              </div>
            )}
          </Card>

          {resultado && (
            <Card className="mb-5">
              <div className="flex items-center gap-2 mb-4">
                <span className="w-9 h-9 rounded-xl bg-green-50 text-green-600 grid place-items-center shrink-0"><CheckCircle2 size={18} /></span>
                <h3 className="font-extrabold text-ink text-lg">Resultado da importação</h3>
              </div>
              <div className="flex items-center gap-8 flex-wrap mb-4">
                <div>
                  <p className="text-3xl font-display text-green-600 leading-none">{resultado.importados}</p>
                  <p className="text-xs text-muted mt-1">importados</p>
                </div>
                <div>
                  <p className="text-3xl font-display text-slate-400 leading-none">{resultado.duplicados}</p>
                  <p className="text-xs text-muted mt-1">duplicados pulados</p>
                </div>
                <div>
                  <p className="text-3xl font-display text-red-500 leading-none">{resultado.erros.length}</p>
                  <p className="text-xs text-muted mt-1">com erro</p>
                </div>
              </div>
              {resultado.erros.length > 0 && (
                <div className="max-h-64 overflow-y-auto rounded-xl border border-slate-200">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-slate-50">
                      <tr className="text-left text-muted border-b border-slate-200">
                        <th className="font-bold text-xs uppercase tracking-wide py-2 px-3">Linha</th>
                        <th className="font-bold text-xs uppercase tracking-wide py-2 px-3">Nome</th>
                        <th className="font-bold text-xs uppercase tracking-wide py-2 px-3">Motivo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {resultado.erros.map((e, i) => (
                        <tr key={i} className="border-b border-slate-100">
                          <td className="py-2 px-3 text-ink">{e.linha}</td>
                          <td className="py-2 px-3 text-ink">{e.nome}</td>
                          <td className="py-2 px-3 text-red-600">{e.motivo}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="mt-4">
                <Button variant="outline" icon={RotateCcw} onClick={resetarTudo}>Importar outro arquivo</Button>
              </div>
            </Card>
          )}
        </>
      )}

      {!supabase && (
        <Card className="mb-5">
          <p className="text-sm text-amber-700 flex items-center gap-2"><AlertTriangle size={14} /> Supabase não configurado — a importação real não vai funcionar neste ambiente.</p>
        </Card>
      )}
    </>
  );
}

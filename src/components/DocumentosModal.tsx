import { useEffect, useRef, useState } from "react";
import { X, Paperclip, FileText, Trash2, Download, Upload, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "./ui";
import { supabase } from "../lib/supabase";

// Documento guardado na coluna `documentos jsonb` de apolices/consorcios.
// path = caminho no Storage privado (NÃO url pública) — a URL é assinada na hora.
export interface DocumentoRegistro {
  nome: string;
  path: string;
  tipo?: string;
  tamanho?: number;
  criado_em?: string;
}

interface Props {
  aberto: boolean;
  onFechar: () => void;
  tabela: "apolices" | "consorcios";
  registroId: string;
  clientId: string;
  titulo: string;
  // Reflete a contagem/atualização de volta na linha da tabela sem recarregar tudo.
  onAtualizado?: (docs: DocumentoRegistro[]) => void;
}

const BUCKET = "documentos-clientes";
const MAX_BYTES = 10 * 1024 * 1024; // ~10MB
const TIPOS_OK = ["application/pdf", "image/jpeg", "image/jpg", "image/png"];
const EXT_OK = /\.(pdf|jpe?g|png)$/i;

function sanitizarNome(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .toLowerCase();
}

function formatarTamanho(bytes?: number): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DocumentosModal({ aberto, onFechar, tabela, registroId, clientId, titulo, onAtualizado }: Props) {
  const [docs, setDocs] = useState<DocumentoRegistro[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [progresso, setProgresso] = useState<{ atual: number; total: number } | null>(null);
  const [baixandoPath, setBaixandoPath] = useState<string | null>(null);
  const [excluindoPath, setExcluindoPath] = useState<string | null>(null);
  const [arrastando, setArrastando] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (aberto) carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto, registroId, tabela]);

  async function carregar() {
    if (!supabase) { setCarregando(false); return; }
    setCarregando(true);
    const { data, error } = await supabase.from(tabela).select("documentos").eq("id", registroId).single();
    if (error) {
      setDocs([]);
      toast.error("Não foi possível carregar os documentos.");
    } else {
      setDocs(Array.isArray(data?.documentos) ? (data!.documentos as DocumentoRegistro[]) : []);
    }
    setCarregando(false);
  }

  // Relê os documentos direto do banco na hora de gravar — evita que dois membros
  // com o mesmo registro aberto sobrescrevam o anexo um do outro (last-write-wins).
  async function lerDocsAtuais(): Promise<DocumentoRegistro[]> {
    if (!supabase) return docs;
    const { data, error } = await supabase.from(tabela).select("documentos").eq("id", registroId).single();
    if (error) return docs; // na dúvida, usa o estado local (não perde o que está por gravar)
    return Array.isArray(data?.documentos) ? (data!.documentos as DocumentoRegistro[]) : [];
  }

  function validar(file: File): string | null {
    const tipoOk = TIPOS_OK.includes(file.type) || EXT_OK.test(file.name);
    if (!tipoOk) return `"${file.name}" não é PDF, JPG ou PNG.`;
    if (file.size > MAX_BYTES) return `"${file.name}" passa de 10MB.`;
    return null;
  }

  async function enviarArquivos(files: File[]) {
    if (!supabase) { toast.error("Conexão indisponível no momento."); return; }
    if (!files.length) return;

    const validos: File[] = [];
    for (const f of files) {
      const erro = validar(f);
      if (erro) toast.error(erro);
      else validos.push(f);
    }
    if (!validos.length) return;

    setEnviando(true);
    const novos: DocumentoRegistro[] = [];
    for (let i = 0; i < validos.length; i++) {
      const file = validos[i];
      setProgresso({ atual: i + 1, total: validos.length });
      const path = `${clientId}/${tabela}-${registroId}-${Date.now()}-${sanitizarNome(file.name)}`;
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, {
        contentType: file.type || undefined,
        upsert: false,
      });
      if (upErr) {
        toast.error(`Falha ao enviar "${file.name}".`);
        continue;
      }
      novos.push({
        nome: file.name,
        path,
        tipo: file.type || undefined,
        tamanho: file.size,
        criado_em: new Date().toISOString(),
      });
    }

    if (novos.length) {
      const atualizados = [...(await lerDocsAtuais()), ...novos];
      const { error: dbErr } = await supabase.from(tabela).update({ documentos: atualizados }).eq("id", registroId);
      if (dbErr) {
        // Rollback do storage: os objetos ficariam órfãos se o jsonb não salvasse.
        await supabase.storage.from(BUCKET).remove(novos.map((d) => d.path));
        toast.error("Não foi possível registrar os documentos.");
      } else {
        setDocs(atualizados);
        onAtualizado?.(atualizados);
        toast.success(novos.length === 1 ? "Documento anexado." : `${novos.length} documentos anexados.`);
      }
    }

    setEnviando(false);
    setProgresso(null);
  }

  function onInputFile(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files ? Array.from(e.target.files) : [];
    if (files.length) enviarArquivos(files);
    e.target.value = "";
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setArrastando(false);
    if (enviando) return;
    const files = e.dataTransfer.files ? Array.from(e.dataTransfer.files) : [];
    if (files.length) enviarArquivos(files);
  }

  async function baixar(doc: DocumentoRegistro) {
    if (!supabase) return;
    setBaixandoPath(doc.path);
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(doc.path, 60);
    setBaixandoPath(null);
    if (error || !data?.signedUrl) {
      toast.error("Não foi possível gerar o link do documento.");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  async function excluir(doc: DocumentoRegistro) {
    if (!supabase) return;
    if (!window.confirm(`Excluir "${doc.nome}"? Esta ação não pode ser desfeita.`)) return;
    setExcluindoPath(doc.path);
    const { error: rmErr } = await supabase.storage.from(BUCKET).remove([doc.path]);
    if (rmErr) {
      setExcluindoPath(null);
      toast.error("Não foi possível excluir o arquivo.");
      return;
    }
    const atualizados = (await lerDocsAtuais()).filter((d) => d.path !== doc.path);
    const { error: dbErr } = await supabase.from(tabela).update({ documentos: atualizados }).eq("id", registroId);
    setExcluindoPath(null);
    if (dbErr) {
      toast.error("Arquivo removido, mas houve erro ao atualizar o registro.");
      carregar();
      return;
    }
    setDocs(atualizados);
    onAtualizado?.(atualizados);
    toast.success("Documento excluído.");
  }

  if (!aberto) return null;

  return (
    <div onClick={onFechar} className="fixed inset-0 bg-slate-900/45 backdrop-blur-sm grid place-items-center z-50 p-4">
      <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl shadow-2xl w-[min(560px,94vw)] max-h-[88vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 sticky top-0 bg-white z-10">
          <div className="flex items-center gap-2.5">
            <span className="w-9 h-9 rounded-xl bg-brand-50 text-brand-500 grid place-items-center shrink-0">
              <Paperclip size={18} />
            </span>
            <div>
              <h3 className="font-extrabold text-ink text-lg leading-tight">Documentos</h3>
              <p className="text-xs text-muted">{titulo}</p>
            </div>
          </div>
          <button type="button" onClick={onFechar} aria-label="Fechar" className="text-slate-500 hover:text-slate-700"><X size={20} /></button>
        </div>

        <div className="p-6">
          {/* Dropzone / upload */}
          <div
            onDragOver={(e) => { e.preventDefault(); if (!enviando) setArrastando(true); }}
            onDragLeave={() => setArrastando(false)}
            onDrop={onDrop}
            onClick={() => { if (!enviando) inputRef.current?.click(); }}
            className={`cursor-pointer rounded-2xl border-2 border-dashed grid place-items-center text-center py-8 px-6 transition-colors ${enviando ? "opacity-60 cursor-wait" : arrastando ? "border-brand-400 bg-brand-50" : "border-slate-200 hover:border-brand-300 hover:bg-slate-50"}`}
          >
            <span className="w-12 h-12 rounded-2xl bg-brand-50 text-brand-500 grid place-items-center mb-3">
              {enviando ? <Loader2 size={22} className="kuboo-spin" /> : <Upload size={22} />}
            </span>
            {enviando ? (
              <p className="font-bold text-ink">Enviando {progresso ? `${progresso.atual} de ${progresso.total}` : ""}…</p>
            ) : (
              <>
                <p className="font-bold text-ink">Arraste arquivos aqui ou clique</p>
                <p className="text-sm text-muted mt-1">PDF, JPG ou PNG · até 10MB cada</p>
              </>
            )}
            <input ref={inputRef} type="file" multiple accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/*" onChange={onInputFile} className="hidden" disabled={enviando} />
          </div>

          {/* Lista */}
          <div className="mt-6">
            <p className="text-xs font-bold text-muted uppercase tracking-wide mb-2">
              {docs.length > 0 ? `${docs.length} ${docs.length === 1 ? "documento" : "documentos"}` : "Documentos anexados"}
            </p>

            {carregando ? (
              <div className="space-y-2">
                {[...Array(2)].map((_, i) => <div key={i} className="h-14 rounded-xl bg-slate-100 animate-pulse" />)}
              </div>
            ) : docs.length > 0 ? (
              <ul className="space-y-2">
                {docs.map((doc) => (
                  <li key={doc.path} className="flex items-center gap-3 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5">
                    <span className="w-9 h-9 rounded-lg bg-brand-50 text-brand-500 grid place-items-center shrink-0">
                      <FileText size={16} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-ink truncate" title={doc.nome}>{doc.nome}</p>
                      <p className="text-xs text-muted">
                        {formatarTamanho(doc.tamanho)}
                        {doc.tamanho && doc.criado_em ? " · " : ""}
                        {doc.criado_em ? new Date(doc.criado_em).toLocaleDateString("pt-BR") : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => baixar(doc)}
                        disabled={baixandoPath === doc.path}
                        title="Baixar"
                        aria-label={`Baixar ${doc.nome}`}
                        className="p-2 rounded-lg text-slate-400 hover:text-brand-600 hover:bg-brand-50 disabled:opacity-50"
                      >
                        {baixandoPath === doc.path ? <Loader2 size={16} className="kuboo-spin" /> : <Download size={16} />}
                      </button>
                      <button
                        onClick={() => excluir(doc)}
                        disabled={excluindoPath === doc.path}
                        title="Excluir"
                        aria-label={`Excluir ${doc.nome}`}
                        className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-50"
                      >
                        {excluindoPath === doc.path ? <Loader2 size={16} className="kuboo-spin" /> : <Trash2 size={16} />}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-center py-8 px-6 rounded-xl bg-slate-50 border border-slate-100">
                <span className="w-12 h-12 rounded-2xl bg-brand-50 text-brand-400 grid place-items-center mx-auto mb-3">
                  <FileText size={22} />
                </span>
                <p className="font-bold text-ink text-sm">Nenhum documento anexado</p>
                <p className="text-xs text-muted mt-1">Envie a apólice, o boleto ou o contrato para o cliente baixar a 2ª via no Portal.</p>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 sticky bottom-0 bg-white">
          <Button variant="outline" onClick={onFechar}>Fechar</Button>
        </div>
      </div>
    </div>
  );
}

// Célula da tabela (coluna "Docs"): botão com contagem que gerencia seu próprio
// modal — mantém DataTablePage intacto e sem estado extra.
export function DocsCell({ row, tabela }: { row: any; tabela: "apolices" | "consorcios" }) {
  const [aberto, setAberto] = useState(false);
  const [count, setCount] = useState<number>(Array.isArray(row.documentos) ? row.documentos.length : 0);
  const clientId = row.client_id as string | undefined;
  const titulo = tabela === "apolices"
    ? `${row.tipo || "Apólice"} · ${row.profiles?.name || row.numero_apolice || "cliente"}`
    : `${row.tipo || "Consórcio"} · ${row.profiles?.name || row.numero_cota || "cliente"}`;

  if (!clientId) {
    // Sem dono vinculado não há pasta de destino no Storage (RLS por folder[1]).
    return <span className="text-xs text-muted" title="Vincule um cliente para anexar documentos">—</span>;
  }

  return (
    <>
      <button
        onClick={() => setAberto(true)}
        title="Documentos"
        aria-label={`Documentos — ${titulo}`}
        className="inline-flex items-center gap-1.5 text-xs font-bold text-brand-600 bg-brand-50 hover:bg-brand-100 px-2.5 py-1.5 rounded-lg transition-colors"
      >
        <Paperclip size={14} />
        {count > 0 && <span className="tabular-nums">{count}</span>}
      </button>
      {aberto && (
        <DocumentosModal
          aberto={aberto}
          onFechar={() => setAberto(false)}
          tabela={tabela}
          registroId={row.id}
          clientId={clientId}
          titulo={titulo}
          onAtualizado={(docs) => setCount(docs.length)}
        />
      )}
    </>
  );
}

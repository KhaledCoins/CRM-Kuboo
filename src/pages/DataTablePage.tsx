import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { X, Pencil, Trash2, Download, Upload, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { PageHeader, Button, Card, Table, Th, Td, Tr, EmptyState, KpiCard, SearchInput } from "../components/ui";
import { ImportarCsv, type CampoImport, type TipoCampo } from "../components/ImportarCsv";
import { supabase } from "../lib/supabase";
import { paraNumero } from "../lib/num";

// FormField (tipo do formulário de criar) → CampoImport (colunas do importador).
// Assim TODA tela que tem formulário de criar ganha "Importar CSV" automaticamente.
const tipoImport: Record<string, TipoCampo> = { currency: "moeda", date: "data", number: "numero" };
function camposDeFormFields(fields: FormField[]): CampoImport[] {
  return fields
    .filter((f) => !f.loadOptions) // selects relacionais (client_id, cota_id) não vêm de CSV
    .map((f) => ({ key: f.key, label: f.label, obrigatorio: f.required, tipo: tipoImport[f.type ?? "text"] ?? "texto" }));
}

function downloadCsv(filename: string, rows: any[]) {
  if (!rows.length) return;
  const keys = Array.from(rows.reduce((s: Set<string>, r) => { Object.keys(r).forEach((k) => s.add(k)); return s; }, new Set<string>()));
  const esc = (v: any) => { const s = v == null ? "" : String(v); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = [keys.join(";"), ...rows.map((r) => keys.map((k) => esc(r[k])).join(";"))].join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `${filename}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click(); URL.revokeObjectURL(url);
}

export interface Column {
  header: string;
  render: (row: any) => ReactNode;
  right?: boolean;
}
export interface Kpi {
  label: string; value: string; icon: LucideIcon;
  accent?: "brand" | "success" | "warning" | "danger" | "sky";
}
export interface FormField {
  key: string; label: string;
  type?: "text" | "number" | "currency" | "date" | "select" | "textarea";
  options?: { value: string; label: string }[];
  // opções carregadas do banco na abertura do formulário (ex.: lista de cotas)
  loadOptions?: () => Promise<{ value: string; label: string }[]>;
  required?: boolean; placeholder?: string;
}

const inputCls = "w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none text-ink focus:border-brand-400 transition-colors";

export function DataTablePage({
  title, subtitle, icon, table, select = "*", orderBy, ascending = false,
  columns, computeKpis, emptyIcon, emptyTitle, emptyHint, primaryAction, formFields,
  importCampos, importResolverCpf, importavel = true,
}: {
  title: string; subtitle?: string; icon: LucideIcon;
  table: string; select?: string; orderBy?: string; ascending?: boolean;
  columns: Column[];
  computeKpis?: (rows: any[]) => Kpi[];
  emptyIcon: LucideIcon; emptyTitle: string; emptyHint?: string;
  primaryAction?: string; formFields?: FormField[];
  // Import: por padrão deriva as colunas dos formFields; pode sobrescrever
  // (importCampos) ou vincular por CPF (importResolverCpf, p/ apólices/consórcios).
  importCampos?: CampoImport[]; importResolverCpf?: { origem: string; destino: string }; importavel?: boolean;
}) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [q, setQ] = useState("");

  // Paginação server-side: nada de cortar a base em silêncio quando crescer.
  const PAGE = 200;
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [exportando, setExportando] = useState(false);

  const filtered = useMemo(() => {
    if (!q.trim()) return rows;
    const needle = q.toLowerCase();
    return rows.filter((r) => JSON.stringify(r).toLowerCase().includes(needle));
  }, [rows, q]);

  const reqRef = useRef(0);
  async function load(p = page) {
    if (!supabase) { setLoading(false); return; }
    const myReq = ++reqRef.current; // guarda de corrida: troca rápida de tabela/página não sobrescreve com resposta antiga
    setLoading(true); setError(false);
    let query: any = supabase.from(table).select(select, { count: "exact" }).range(p * PAGE, p * PAGE + PAGE - 1);
    if (orderBy) query = query.order(orderBy, { ascending });
    query = query.order("id", { ascending: true }); // desempate estável → páginas não repetem/pulam linhas
    const { data, error, count } = await query;
    if (myReq !== reqRef.current) return; // resposta obsoleta (mudou tabela/página) → ignora
    if (error) { setError(true); setRows([]); setTotal(0); }
    else { setRows(data || []); setTotal(count ?? (data?.length || 0)); }
    setLoading(false);
  }

  useEffect(() => { setPage(0); load(0); /* eslint-disable-next-line */ }, [table, select, orderBy, ascending]);
  useEffect(() => { load(page); /* eslint-disable-next-line */ }, [page]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE));
  const multiPagina = total > PAGE;

  // Exporta a BASE INTEIRA (não só a página visível), em blocos de 1000.
  async function exportarTudo() {
    if (!supabase) return;
    setExportando(true);
    try {
      const CAP = 10_000; // teto de sanidade
      const all: any[] = [];
      for (let from = 0; from < CAP; from += 1000) {
        let qy: any = supabase.from(table).select(select).range(from, from + 999);
        if (orderBy) qy = qy.order(orderBy, { ascending });
        qy = qy.order("id", { ascending: true }); // ordem estável entre os blocos de 1000
        const { data, error } = await qy;
        if (error) throw new Error(error.message);
        all.push(...(data || []));
        if (!data || data.length < 1000) break;
      }
      downloadCsv(table, q.trim() ? all.filter((r) => JSON.stringify(r).toLowerCase().includes(q.toLowerCase())) : all);
      if (all.length >= CAP) toast.warning(`Exportação limitada a ${CAP.toLocaleString("pt-BR")} linhas.`);
      else toast.success(`CSV exportado (${all.length.toLocaleString("pt-BR")} linhas).`);
    } catch {
      toast.error("Não foi possível exportar agora.");
    }
    setExportando(false);
  }

  const [dynOpts, setDynOpts] = useState<Record<string, { value: string; label: string }[]>>({});

  async function carregarOpcoes() {
    if (!formFields) return;
    for (const ff of formFields) {
      if (ff.loadOptions && !dynOpts[ff.key]) {
        try {
          const opts = await ff.loadOptions();
          setDynOpts((p) => ({ ...p, [ff.key]: opts }));
        } catch { /* select fica vazio; usuário vê "Selecione…" */ }
      }
    }
  }

  function openCreate() { setEditingId(null); setForm({}); setShowForm(true); carregarOpcoes(); }
  function openEdit(row: any) {
    setEditingId(row.id);
    const f: Record<string, string> = {};
    for (const ff of formFields!) f[ff.key] = row[ff.key] != null ? String(row[ff.key]) : "";
    setForm(f); setShowForm(true); carregarOpcoes();
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase || !formFields) return;
    setSaving(true);
    const payload: Record<string, any> = {};
    for (const f of formFields) {
      let v: any = form[f.key];
      if (v === undefined || v === "") { v = null; }
      else if (f.type === "number" || f.type === "currency") {
        // Parser pt-BR (ponto só é milhar quando há vírgula). Antes tirava TODO ponto
        // → "1234.56" virava 123456 (100×) só de abrir Editar e salvar. Preserva null
        // quando não-numérico (não grava 0 falso).
        v = paraNumero(v);
      }
      payload[f.key] = v;
    }
    const { error } = editingId
      ? await supabase.from(table).update(payload).eq("id", editingId)
      : await supabase.from(table).insert(payload);
    setSaving(false);
    if (error) { toast.error("Não foi possível salvar: " + error.message); return; }
    toast.success(editingId ? "Registro atualizado!" : "Registro criado!");
    setShowForm(false); setForm({}); setEditingId(null);
    load();
  }

  async function handleDelete(row: any) {
    if (!supabase) return;
    if (!window.confirm("Excluir este registro? Esta ação não pode ser desfeita.")) return;
    setRows((prev) => prev.filter((r) => r.id !== row.id));
    const { error } = await supabase.from(table).delete().eq("id", row.id);
    if (error) { toast.error("Não foi possível excluir: " + error.message); load(); return; }
    setTotal((t) => Math.max(0, t - 1));
    toast.success("Registro excluído");
  }

  // Com mais de uma página, os KPIs valem só pra página visível — rótulo honesto.
  const kpis = (computeKpis && filtered.length ? computeKpis(filtered) : [])
    .map((k) => (multiPagina ? { ...k, label: `${k.label} (página)` } : k));
  const canEdit = !!(formFields && formFields.length);
  const canCreate = !!(primaryAction && canEdit);

  // Import disponível em toda tela que cria registro (deriva colunas dos formFields).
  const camposImport = importCampos ?? (formFields ? camposDeFormFields(formFields) : []);
  const podeImportar = importavel && camposImport.length > 0;
  const [importarAberto, setImportarAberto] = useState(false);

  return (
    <>
      <PageHeader title={title} subtitle={subtitle} icon={icon}
        actions={(primaryAction || podeImportar) ? (
          <div className="flex items-center gap-2">
            {podeImportar && <Button variant="outline" icon={Upload} onClick={() => setImportarAberto(true)}>Importar</Button>}
            {primaryAction && <Button onClick={canCreate ? openCreate : undefined}>{primaryAction}</Button>}
          </div>
        ) : undefined} />

      {podeImportar && (
        <ImportarCsv
          aberto={importarAberto}
          onFechar={() => setImportarAberto(false)}
          tabela={table}
          titulo={`Importar ${title.toLowerCase()} do CSV`}
          campos={camposImport}
          resolverCpf={importResolverCpf}
          onConcluido={() => { setPage(0); load(0); }}
        />
      )}

      {kpis.length > 0 && (
        <div className={`grid grid-cols-1 sm:grid-cols-2 ${kpis.length >= 4 ? "xl:grid-cols-4" : "lg:grid-cols-3"} gap-4 mb-6`}>
          {kpis.map((k) => <KpiCard key={k.label} label={k.label} value={k.value} icon={k.icon} accent={k.accent ?? "brand"} />)}
        </div>
      )}

      <Card pad={false}>
        {loading ? (
          <div className="p-4 space-y-2.5">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="h-9 flex-1 rounded-lg bg-slate-100 animate-pulse" style={{ animationDelay: `${i * 80}ms` }} />
                <div className="h-9 w-24 rounded-lg bg-slate-100 animate-pulse" />
                <div className="h-9 w-16 rounded-lg bg-slate-100 animate-pulse" />
              </div>
            ))}
          </div>
        ) : rows.length > 0 ? (
          <>
            <div className="flex items-center gap-3 p-3 border-b border-slate-100 flex-wrap">
              <SearchInput value={q} onChange={setQ} placeholder={multiPagina ? "Buscar nesta página..." : "Buscar nesta lista..."} />
              <span className="text-xs text-muted">
                {filtered.length} de {rows.length}{multiPagina ? ` · ${total.toLocaleString("pt-BR")} no total` : ""}
              </span>
              <button onClick={exportarTudo} disabled={exportando}
                className="ml-auto inline-flex items-center gap-1.5 text-xs font-bold text-brand-600 bg-brand-50 hover:bg-brand-100 disabled:opacity-50 px-3 py-2 rounded-xl transition-colors">
                <Download size={14} /> {exportando ? "Exportando..." : "Exportar CSV"}
              </button>
            </div>
            {filtered.length > 0 ? (
              <div className="p-2">
                <Table head={<>{columns.map((c, i) => <Th key={i} right={c.right}>{c.header}</Th>)}{canEdit && <Th right>Ações</Th>}</>}>
                  {filtered.map((row, ri) => (
                    <Tr key={row.id ?? ri}>
                      {columns.map((c, ci) => <Td key={ci} right={c.right}>{c.render(row)}</Td>)}
                      {canEdit && (
                        <Td right>
                          <div className="flex items-center justify-end gap-1">
                            <button onClick={() => openEdit(row)} title="Editar" aria-label="Editar registro" className="p-1.5 rounded-lg text-slate-400 hover:text-brand-600 hover:bg-brand-50"><Pencil size={15} /></button>
                            <button onClick={() => handleDelete(row)} title="Excluir" aria-label="Excluir registro" className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50"><Trash2 size={15} /></button>
                          </div>
                        </Td>
                      )}
                    </Tr>
                  ))}
                </Table>
                {multiPagina && (
                  <div className="flex items-center justify-between px-3 py-2.5 border-t border-slate-100">
                    <p className="text-xs text-muted">
                      {(page * PAGE + 1).toLocaleString("pt-BR")}–{Math.min((page + 1) * PAGE, total).toLocaleString("pt-BR")} de {total.toLocaleString("pt-BR")}
                    </p>
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}
                        className="inline-flex items-center gap-1 text-xs font-bold text-brand-600 bg-brand-50 hover:bg-brand-100 disabled:opacity-40 disabled:cursor-not-allowed px-2.5 py-1.5 rounded-lg transition-colors">
                        <ChevronLeft size={14} /> Anterior
                      </button>
                      <span className="text-xs text-muted px-1.5 tabular-nums">{page + 1}/{totalPages}</span>
                      <button onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
                        className="inline-flex items-center gap-1 text-xs font-bold text-brand-600 bg-brand-50 hover:bg-brand-100 disabled:opacity-40 disabled:cursor-not-allowed px-2.5 py-1.5 rounded-lg transition-colors">
                        Próxima <ChevronRight size={14} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-center text-sm text-muted py-10">Nenhum resultado para “{q}”.</p>
            )}
          </>
        ) : (
          <EmptyState
            icon={emptyIcon}
            title={error ? "Não foi possível carregar agora" : emptyTitle}
            hint={error
              ? "Confira sua conexão e se sua conta tem papel de equipe (vendedor/gestor/admin)."
              : (emptyHint ?? "Estrutura pronta. Assim que os dados forem inseridos, aparecem aqui automaticamente.")}
            action={canCreate ? <Button onClick={openCreate}>{primaryAction}</Button> : undefined}
          />
        )}
      </Card>

      {showForm && canEdit && (
        <div onClick={() => setShowForm(false)}
          className="fixed inset-0 bg-slate-900/45 backdrop-blur-sm grid place-items-center z-50 p-4">
          <form onClick={(e) => e.stopPropagation()} onSubmit={handleSave}
            className="bg-white rounded-2xl shadow-2xl w-[min(480px,94vw)] max-h-[88vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 sticky top-0 bg-white">
              <h3 className="font-extrabold text-ink text-lg">{editingId ? "Editar registro" : primaryAction}</h3>
              <button type="button" onClick={() => setShowForm(false)} aria-label="Fechar" className="text-slate-500 hover:text-slate-700"><X size={20} /></button>
            </div>
            <div className="p-6 grid grid-cols-1 gap-4">
              {formFields!.map((f) => (
                <label key={f.key} className="block">
                  <span className="text-xs font-bold text-muted uppercase tracking-wide block mb-1.5">{f.label}{f.required && " *"}</span>
                  {f.type === "select" ? (
                    <select className={inputCls} required={f.required} value={form[f.key] ?? ""} onChange={(e) => setForm((p) => ({ ...p, [f.key]: e.target.value }))}>
                      <option value="">{f.loadOptions && !dynOpts[f.key] ? "Carregando…" : "Selecione…"}</option>
                      {(f.options ?? dynOpts[f.key] ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  ) : f.type === "textarea" ? (
                    <textarea className={inputCls} rows={3} required={f.required} placeholder={f.placeholder} value={form[f.key] ?? ""} onChange={(e) => setForm((p) => ({ ...p, [f.key]: e.target.value }))} />
                  ) : (
                    <input className={inputCls} required={f.required}
                      type={f.type === "date" ? "date" : "text"}
                      inputMode={f.type === "number" || f.type === "currency" ? "decimal" : undefined}
                      placeholder={f.placeholder ?? (f.type === "currency" ? "R$ 0,00" : "")}
                      value={form[f.key] ?? ""} onChange={(e) => setForm((p) => ({ ...p, [f.key]: e.target.value }))} />
                  )}
                </label>
              ))}
            </div>
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100">
              <Button variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
              <Button type="submit" disabled={saving}>{saving ? "Salvando…" : editingId ? "Salvar alterações" : "Salvar"}</Button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

import { useEffect, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { PageHeader, Button, Card, Table, Th, Td, Tr, EmptyState, KpiCard } from "../components/ui";
import { supabase } from "../lib/supabase";

export interface Column {
  header: string;
  render: (row: any) => ReactNode;
  right?: boolean;
}
export interface Kpi {
  label: string; value: string; icon: LucideIcon;
  accent?: "brand" | "success" | "warning" | "danger" | "sky";
}

// Página genérica que lê uma tabela do Supabase (RLS de equipe) e exibe os dados,
// ou um empty state limpo quando ainda não há registros. "Pronta esperando os dados."
export function DataTablePage({
  title, subtitle, icon, table, select = "*", orderBy, ascending = false,
  columns, computeKpis, emptyIcon, emptyTitle, emptyHint, primaryAction,
}: {
  title: string; subtitle?: string; icon: LucideIcon;
  table: string; select?: string; orderBy?: string; ascending?: boolean;
  columns: Column[];
  computeKpis?: (rows: any[]) => Kpi[];
  emptyIcon: LucideIcon; emptyTitle: string; emptyHint?: string; primaryAction?: string;
}) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true); setError(false);
    (async () => {
      if (!supabase) { setLoading(false); return; }
      let query: any = supabase.from(table).select(select).limit(500);
      if (orderBy) query = query.order(orderBy, { ascending });
      const { data, error } = await query;
      if (!active) return;
      if (error) { setError(true); setRows([]); }
      else setRows(data || []);
      setLoading(false);
    })();
    return () => { active = false; };
  }, [table, select, orderBy, ascending]);

  const kpis = computeKpis && rows.length ? computeKpis(rows) : [];

  return (
    <>
      <PageHeader title={title} subtitle={subtitle} icon={icon}
        actions={primaryAction ? <Button>{primaryAction}</Button> : undefined} />

      {kpis.length > 0 && (
        <div className={`grid grid-cols-1 sm:grid-cols-2 ${kpis.length >= 4 ? "xl:grid-cols-4" : "lg:grid-cols-3"} gap-4 mb-6`}>
          {kpis.map((k) => <KpiCard key={k.label} label={k.label} value={k.value} icon={k.icon} accent={k.accent ?? "brand"} />)}
        </div>
      )}

      <Card pad={false}>
        {loading ? (
          <div className="p-12 text-center text-muted text-sm">Carregando…</div>
        ) : rows.length > 0 ? (
          <div className="p-2">
            <Table head={<>{columns.map((c, i) => <Th key={i} right={c.right}>{c.header}</Th>)}</>}>
              {rows.map((row, ri) => (
                <Tr key={row.id ?? ri}>
                  {columns.map((c, ci) => <Td key={ci} right={c.right}>{c.render(row)}</Td>)}
                </Tr>
              ))}
            </Table>
          </div>
        ) : (
          <EmptyState
            icon={emptyIcon}
            title={error ? "Não foi possível carregar agora" : emptyTitle}
            hint={error
              ? "Confira sua conexão e se sua conta tem papel de equipe (vendedor/gestor/admin)."
              : (emptyHint ?? "Estrutura pronta. Assim que os dados forem inseridos, aparecem aqui automaticamente.")}
          />
        )}
      </Card>
    </>
  );
}

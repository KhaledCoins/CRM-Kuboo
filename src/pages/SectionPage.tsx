import type { LucideIcon } from "lucide-react";
import { Card, KpiCard, PageHeader, EmptyState, Button } from "../components/ui";

export interface SectionKpi { label: string; value?: string; icon: LucideIcon; accent?: "brand" | "success" | "warning" | "danger" | "sky" }

export function SectionPage({
  title, subtitle, icon, kpis, emptyIcon, emptyTitle, emptyHint, primaryAction,
}: {
  title: string; subtitle?: string; icon: LucideIcon;
  kpis?: SectionKpi[];
  emptyIcon: LucideIcon; emptyTitle: string; emptyHint?: string;
  primaryAction?: string;
}) {
  return (
    <>
      <PageHeader
        title={title}
        subtitle={subtitle}
        icon={icon}
        actions={primaryAction ? <Button icon={undefined}>{primaryAction}</Button> : undefined}
      />
      {kpis && kpis.length > 0 && (
        <div className={`grid grid-cols-1 sm:grid-cols-2 ${kpis.length >= 4 ? "xl:grid-cols-4" : "lg:grid-cols-3"} gap-4 mb-6`}>
          {kpis.map((k) => (
            <KpiCard key={k.label} label={k.label} value={k.value ?? "—"} icon={k.icon} accent={k.accent ?? "brand"} />
          ))}
        </div>
      )}
      <Card pad={false}>
        <EmptyState
          icon={emptyIcon}
          title={emptyTitle}
          hint={emptyHint ?? "Estrutura pronta. Assim que os dados forem integrados, eles aparecem aqui automaticamente."}
        />
      </Card>
    </>
  );
}

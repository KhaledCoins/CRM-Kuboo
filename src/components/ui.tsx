import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

/* ---------- Card ---------- */
export function Card({ children, className = "", pad = true }: { children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <div className={`bg-white rounded-2xl border border-slate-200/70 shadow-[0_2px_12px_rgba(24,115,186,0.06)] ${pad ? "p-5" : ""} ${className}`}>
      {children}
    </div>
  );
}

/* ---------- Page header ---------- */
export function PageHeader({ title, subtitle, icon: Icon, actions }: { title: string; subtitle?: string; icon?: LucideIcon; actions?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
      <div className="flex items-center gap-3">
        {Icon && (
          <span className="w-10 h-10 rounded-xl bg-brand-50 text-brand-500 grid place-items-center shrink-0">
            <Icon size={20} />
          </span>
        )}
        <div>
          <h1 className="text-2xl text-ink leading-tight">{title}</h1>
          {subtitle && <p className="text-sm text-muted mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </div>
  );
}

/* ---------- KPI card ---------- */
export function KpiCard({ label, value, hint, icon: Icon, accent = "brand" }: {
  label: string; value: ReactNode; hint?: string; icon?: LucideIcon;
  accent?: "brand" | "success" | "warning" | "danger" | "sky";
}) {
  const map: Record<string, string> = {
    brand: "bg-brand-50 text-brand-500",
    success: "bg-green-50 text-green-600",
    warning: "bg-amber-50 text-amber-600",
    danger: "bg-red-50 text-red-600",
    sky: "bg-sky-50 text-sky-500",
  };
  return (
    <Card>
      <div className="flex items-start justify-between">
        <p className="text-sm text-muted">{label}</p>
        {Icon && <span className={`w-9 h-9 rounded-lg grid place-items-center ${map[accent]}`}><Icon size={18} /></span>}
      </div>
      <div className="text-3xl font-display text-ink mt-2 leading-none">{value}</div>
      {hint && <p className="text-xs text-muted mt-1.5">{hint}</p>}
    </Card>
  );
}

/* ---------- Button ---------- */
export function Button({ children, onClick, variant = "primary", icon: Icon, size = "md", type = "button", disabled }: {
  children?: ReactNode; onClick?: () => void; variant?: "primary" | "ghost" | "outline" | "wa" | "danger";
  icon?: LucideIcon; size?: "sm" | "md"; type?: "button" | "submit"; disabled?: boolean;
}) {
  const base = "inline-flex items-center justify-center gap-2 font-bold rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed";
  const sizes = { sm: "text-xs px-3 py-1.5", md: "text-sm px-4 py-2.5" };
  const variants: Record<string, string> = {
    primary: "bg-gradient-to-br from-brand-500 to-brand-600 text-white shadow-[0_4px_14px_rgba(24,115,186,0.3)] hover:brightness-105",
    ghost: "text-brand-600 hover:bg-brand-50",
    outline: "border border-slate-200 text-ink hover:bg-slate-50",
    wa: "bg-[#25d366] text-white hover:brightness-105",
    danger: "bg-red-50 text-red-600 hover:bg-red-100",
  };
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`${base} ${sizes[size]} ${variants[variant]}`}>
      {Icon && <Icon size={size === "sm" ? 14 : 16} />}
      {children}
    </button>
  );
}

/* ---------- Badge ---------- */
export function Badge({ children, tone = "slate" }: { children: ReactNode; tone?: "slate" | "green" | "blue" | "amber" | "red" | "violet" }) {
  const tones: Record<string, string> = {
    slate: "bg-slate-100 text-slate-600",
    green: "bg-green-100 text-green-700",
    blue: "bg-brand-100 text-brand-700",
    amber: "bg-amber-100 text-amber-700",
    red: "bg-red-100 text-red-700",
    violet: "bg-violet-100 text-violet-700",
  };
  return <span className={`inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full ${tones[tone]}`}>{children}</span>;
}

/* ---------- Table ---------- */
export function Table({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-muted border-b border-slate-200">{head}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
export const Th = ({ children, right }: { children: ReactNode; right?: boolean }) => (
  <th className={`font-bold text-xs uppercase tracking-wide py-3 px-3 ${right ? "text-right" : ""}`}>{children}</th>
);
export const Td = ({ children, right }: { children: ReactNode; right?: boolean }) => (
  <td className={`py-3 px-3 ${right ? "text-right" : ""}`}>{children}</td>
);
export const Tr = ({ children, className = "", onClick }: { children: ReactNode; className?: string; onClick?: () => void }) => (
  <tr className={`border-b border-slate-100 hover:bg-slate-50/60 transition-colors ${className}`} onClick={onClick}>{children}</tr>
);

/* ---------- Empty state ---------- */
export function EmptyState({ icon: Icon, title, hint, action }: { icon: LucideIcon; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="text-center py-16 px-6">
      <span className="w-14 h-14 rounded-2xl bg-brand-50 text-brand-400 grid place-items-center mx-auto mb-4">
        <Icon size={26} />
      </span>
      <p className="font-bold text-ink">{title}</p>
      {hint && <p className="text-sm text-muted mt-1 max-w-md mx-auto">{hint}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/* ---------- Inputs ---------- */
export function SearchInput({ value, onChange, placeholder = "Buscar..." }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="relative flex-1 min-w-[200px]">
      <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-3 py-2.5 text-sm outline-none"
      />
    </div>
  );
}

export function Select({ value, onChange, options, placeholder }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; placeholder?: string }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none text-ink min-w-[150px]">
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

/* ---------- Spinner ---------- */
export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-muted">
      <div className="w-9 h-9 rounded-full border-[3px] border-brand-100 border-t-brand-500 kuboo-spin" />
      {label && <p className="text-sm mt-3">{label}</p>}
    </div>
  );
}

/* ---------- Filtros wrapper ---------- */
export function FilterBar({ children }: { children: ReactNode }) {
  return (
    <Card className="mb-5">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-sm font-bold text-muted flex items-center gap-1.5">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" /></svg>
          Filtros
        </span>
        {children}
      </div>
    </Card>
  );
}

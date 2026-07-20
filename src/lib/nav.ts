import {
  LayoutDashboard, ShoppingCart, FileEdit, Receipt, DollarSign, Trophy,
  KanbanSquare, RefreshCcw, Target, ShieldAlert, ClipboardCheck, BarChart3,
  Tv, Users, Building2, Package, UserCog, Settings, Layers, Award, CalendarDays, Inbox, ListChecks, Shield, Shuffle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Role } from "../context/AuthContext";

export type Modulo = "seguros" | "consorcios";

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  roles?: Role[]; // se ausente, todos
  badge?: "soon";
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

const adminGroup = (modulo: Modulo): NavGroup => ({
  title: "Administração",
  items: [
    { label: "Clientes", to: `/${modulo}/clientes`, icon: Users },
    {
      label: modulo === "seguros" ? "Seguradoras" : "Administradoras",
      to: `/${modulo}/parceiros`,
      icon: Building2,
    },
    { label: "Produtos", to: `/${modulo}/produtos`, icon: Package },
    { label: "Usuários", to: `/${modulo}/usuarios`, icon: UserCog, roles: ["admin", "gestor"] },
    { label: "Distribuição de Leads", to: `/${modulo}/filas`, icon: Shuffle, roles: ["admin", "gestor"] },
    { label: "Configurações", to: `/${modulo}/configuracoes`, icon: Settings, roles: ["admin", "gestor"] },
  ],
});

export const NAV: Record<Modulo, NavGroup[]> = {
  seguros: [
    {
      title: "Menu Principal",
      items: [
        { label: "Dashboard", to: "/seguros", icon: LayoutDashboard },
        { label: "Bolsão de Leads", to: "/seguros/bolsao", icon: Inbox },
        { label: "Vendas", to: "/seguros/vendas", icon: ShoppingCart },
        { label: "Apólices", to: "/seguros/apolices", icon: Shield },
        { label: "Endossos", to: "/seguros/endossos", icon: FileEdit },
        { label: "Parcelas", to: "/seguros/parcelas", icon: Receipt },
        { label: "Comissões", to: "/seguros/comissoes", icon: DollarSign },
        { label: "Ranking", to: "/seguros/ranking", icon: Trophy },
        { label: "Pipeline (Novos)", to: "/seguros/pipeline", icon: KanbanSquare },
        { label: "Renovações", to: "/seguros/renovacoes", icon: RefreshCcw },
        { label: "Tarefas & Atividades", to: "/seguros/tarefas", icon: ListChecks },
        { label: "Metas & Performance", to: "/seguros/metas", icon: Target },
        { label: "Sinistros & Assistências", to: "/seguros/sinistros", icon: ShieldAlert },
        { label: "Auditoria & Cobrança", to: "/seguros/auditoria", icon: ClipboardCheck, roles: ["admin", "gestor"] },
        { label: "Produção Mensal", to: "/seguros/producao", icon: BarChart3 },
        { label: "TV do Salão", to: "/seguros/tv", icon: Tv },
      ],
    },
    adminGroup("seguros"),
  ],
  consorcios: [
    {
      title: "Menu Principal",
      items: [
        { label: "Dashboard", to: "/consorcios", icon: LayoutDashboard },
        { label: "Bolsão de Leads", to: "/consorcios/bolsao", icon: Inbox },
        { label: "Pipeline", to: "/consorcios/pipeline", icon: KanbanSquare },
        { label: "Tarefas & Atividades", to: "/consorcios/tarefas", icon: ListChecks },
        { label: "Consórcios (clientes)", to: "/consorcios/consorcios", icon: Shield },
        { label: "Cotas", to: "/consorcios/cotas", icon: Layers },
        { label: "Contemplações", to: "/consorcios/contemplacoes", icon: Award },
        { label: "Grupos & Assembleias", to: "/consorcios/grupos", icon: CalendarDays },
        { label: "Comissões", to: "/consorcios/comissoes", icon: DollarSign },
        { label: "Metas & Performance", to: "/consorcios/metas", icon: Target },
        { label: "Ranking", to: "/consorcios/ranking", icon: Trophy },
        { label: "TV do Salão", to: "/consorcios/tv", icon: Tv },
      ],
    },
    adminGroup("consorcios"),
  ],
};

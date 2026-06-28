import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import {
  FileEdit, Receipt, DollarSign, Trophy, Target, ShieldAlert, ClipboardCheck, BarChart3, Tv,
  Building2, Package, Settings, Layers, Award, CalendarDays, LayoutDashboard, TrendingUp,
  AlertTriangle, CheckCircle2, Wallet, Users as UsersIcon,
} from "lucide-react";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { Layout } from "./components/Layout";
import { Login } from "./pages/Login";
import { SectionPage } from "./pages/SectionPage";
import { DashboardSeguros } from "./pages/seguros/DashboardSeguros";
import { Pipeline } from "./pages/Pipeline";
import { Bolsao } from "./pages/Bolsao";
import { Clientes } from "./pages/Clientes";
import { Usuarios } from "./pages/admin/Usuarios";
// Páginas funcionais (leem o Supabase com RLS de equipe)
import {
  Vendas, Parcelas, Comissoes, Endossos, Metas, Sinistros, Parceiros, Produtos,
  Cotas, Contemplacoes, Grupos,
} from "./pages/sections";
import { TvSalao } from "./pages/TvSalao";
import { DashboardConsorcios } from "./pages/DashboardConsorcios";
import { Tarefas } from "./pages/Tarefas";
import { Ranking } from "./pages/Ranking";
import { Producao } from "./pages/Producao";

/* ---- Seções bespoke que ainda são placeholders (relatórios/configurações) ---- */
const Auditoria = () => <SectionPage title="Auditoria & Cobrança" subtitle="Pós-venda — gestão por exceção" icon={ClipboardCheck}
  kpis={[{ label: "A Conferir", icon: ClipboardCheck, accent: "warning" }, { label: "Aprovadas", icon: CheckCircle2, accent: "success" }, { label: "Cobrança em Atraso", icon: AlertTriangle, accent: "danger" }]}
  emptyIcon={ClipboardCheck} emptyTitle="Nada para auditar ainda" emptyHint="Cada venda passa por conferência e controle de cobrança." />;

const Configuracoes = () => <SectionPage title="Configurações" subtitle="Preferências do sistema" icon={Settings}
  emptyIcon={Settings} emptyTitle="Configurações" emptyHint="Dados da corretora, metas padrão, integrações (site/Kubinho) e permissões." />;

function Shell() {
  const { user, loading } = useAuth();
  if (loading)
    return (
      <div className="min-h-screen grid place-items-center" style={{ background: "linear-gradient(135deg,#0A1628,#1873BA)" }}>
        <div className="text-center text-white">
          <div className="w-10 h-10 rounded-full border-[3px] border-white/30 border-t-white kuboo-spin mx-auto mb-3" />
          <p className="text-sm">Carregando...</p>
        </div>
      </div>
    );
  if (!user) return <Login />;

  return (
    <Routes>
      <Route element={<Layout />}>
        {/* Seguros */}
        <Route path="/seguros" element={<DashboardSeguros />} />
        <Route path="/seguros/bolsao" element={<Bolsao />} />
        <Route path="/seguros/vendas" element={<Vendas />} />
        <Route path="/seguros/endossos" element={<Endossos />} />
        <Route path="/seguros/parcelas" element={<Parcelas />} />
        <Route path="/seguros/comissoes" element={<Comissoes />} />
        <Route path="/seguros/ranking" element={<Ranking />} />
        <Route path="/seguros/pipeline" element={<Pipeline modulo="seguros" />} />
        <Route path="/seguros/tarefas" element={<Tarefas modulo="seguros" />} />
        <Route path="/seguros/renovacoes" element={<Pipeline modulo="seguros" renovacoes />} />
        <Route path="/seguros/metas" element={<Metas />} />
        <Route path="/seguros/sinistros" element={<Sinistros />} />
        <Route path="/seguros/auditoria" element={<Auditoria />} />
        <Route path="/seguros/producao" element={<Producao />} />
        <Route path="/seguros/tv" element={<TvSalao />} />
        <Route path="/seguros/clientes" element={<Clientes />} />
        <Route path="/seguros/parceiros" element={<Parceiros />} />
        <Route path="/seguros/produtos" element={<Produtos />} />
        <Route path="/seguros/usuarios" element={<Usuarios />} />
        <Route path="/seguros/configuracoes" element={<Configuracoes />} />

        {/* Consórcios */}
        <Route path="/consorcios" element={<DashboardConsorcios />} />
        <Route path="/consorcios/bolsao" element={<Bolsao />} />
        <Route path="/consorcios/pipeline" element={<Pipeline modulo="consorcios" />} />
        <Route path="/consorcios/tarefas" element={<Tarefas modulo="consorcios" />} />
        <Route path="/consorcios/cotas" element={<Cotas />} />
        <Route path="/consorcios/contemplacoes" element={<Contemplacoes />} />
        <Route path="/consorcios/grupos" element={<Grupos />} />
        <Route path="/consorcios/comissoes" element={<Comissoes />} />
        <Route path="/consorcios/metas" element={<Metas />} />
        <Route path="/consorcios/ranking" element={<Ranking />} />
        <Route path="/consorcios/tv" element={<TvSalao />} />
        <Route path="/consorcios/clientes" element={<Clientes />} />
        <Route path="/consorcios/parceiros" element={<Parceiros />} />
        <Route path="/consorcios/produtos" element={<Produtos />} />
        <Route path="/consorcios/usuarios" element={<Usuarios />} />
        <Route path="/consorcios/configuracoes" element={<Configuracoes />} />
      </Route>
      <Route path="*" element={<Navigate to="/seguros" replace />} />
    </Routes>
  );
}

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Toaster position="top-center" richColors />
        <Shell />
      </BrowserRouter>
    </AuthProvider>
  );
}

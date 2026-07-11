import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import { ClipboardCheck, Settings, AlertTriangle, CheckCircle2 } from "lucide-react";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { Layout } from "./components/Layout";
import { Login } from "./pages/Login";
import { SectionPage } from "./pages/SectionPage";
// Dashboards usam recharts (~160KB gz) — lazy p/ não pesar quem não abre gráfico.
const DashboardSeguros = lazy(() => import("./pages/seguros/DashboardSeguros").then((m) => ({ default: m.DashboardSeguros })));
const DashboardConsorcios = lazy(() => import("./pages/DashboardConsorcios").then((m) => ({ default: m.DashboardConsorcios })));
import { Pipeline } from "./pages/Pipeline";
import { Bolsao } from "./pages/Bolsao";
import { Clientes } from "./pages/Clientes";
import { Usuarios } from "./pages/admin/Usuarios";
// Páginas funcionais (leem o Supabase com RLS de equipe)
import {
  Vendas, Apolices, ConsorciosCliente, Parcelas, Comissoes, Endossos, Metas, Sinistros, Parceiros, Produtos,
  Cotas, Contemplacoes, Grupos,
} from "./pages/sections";
import { TvSalao } from "./pages/TvSalao";
import { Tarefas } from "./pages/Tarefas";
import { Ranking } from "./pages/Ranking";
import { Producao } from "./pages/Producao";
import { Renovacoes } from "./pages/Renovacoes";

/* ---- Seções bespoke que ainda são placeholders (relatórios/configurações) ---- */
const Auditoria = () => <SectionPage title="Auditoria & Cobrança" subtitle="Pós-venda — gestão por exceção" icon={ClipboardCheck}
  kpis={[{ label: "A Conferir", icon: ClipboardCheck, accent: "warning" }, { label: "Aprovadas", icon: CheckCircle2, accent: "success" }, { label: "Cobrança em Atraso", icon: AlertTriangle, accent: "danger" }]}
  emptyIcon={ClipboardCheck} emptyTitle="Nada para auditar ainda" emptyHint="Cada venda passa por conferência e controle de cobrança." />;

const Configuracoes = () => <SectionPage title="Configurações" subtitle="Preferências do sistema" icon={Settings}
  emptyIcon={Settings} emptyTitle="Configurações" emptyHint="Dados da corretora, metas padrão, integrações (site/Kubinho) e permissões." />;

// Guarda de rota por papel: vendedor não acessa telas administrativas nem digitando a URL
// (o menu já esconde, mas a rota precisa barrar de verdade — defesa no client + RLS no banco).
function RequireManager({ children }: { children: React.ReactNode }) {
  const { isManager } = useAuth();
  return isManager ? <>{children}</> : <Navigate to="/seguros" replace />;
}

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
    <Suspense fallback={<div className="min-h-screen grid place-items-center text-slate-400 text-sm">Carregando…</div>}>
    <Routes>
      <Route element={<Layout />}>
        {/* Seguros */}
        <Route path="/seguros" element={<DashboardSeguros />} />
        <Route path="/seguros/bolsao" element={<Bolsao modulo="seguros" />} />
        <Route path="/seguros/vendas" element={<Vendas />} />
        <Route path="/seguros/apolices" element={<Apolices />} />
        <Route path="/seguros/endossos" element={<Endossos />} />
        <Route path="/seguros/parcelas" element={<Parcelas />} />
        <Route path="/seguros/comissoes" element={<Comissoes />} />
        <Route path="/seguros/ranking" element={<Ranking />} />
        <Route path="/seguros/pipeline" element={<Pipeline modulo="seguros" />} />
        <Route path="/seguros/tarefas" element={<Tarefas modulo="seguros" />} />
        <Route path="/seguros/renovacoes" element={<Renovacoes />} />
        <Route path="/seguros/metas" element={<Metas />} />
        <Route path="/seguros/sinistros" element={<Sinistros />} />
        <Route path="/seguros/auditoria" element={<Auditoria />} />
        <Route path="/seguros/producao" element={<Producao />} />
        <Route path="/seguros/tv" element={<TvSalao />} />
        <Route path="/seguros/clientes" element={<Clientes />} />
        <Route path="/seguros/parceiros" element={<Parceiros />} />
        <Route path="/seguros/produtos" element={<Produtos />} />
        <Route path="/seguros/usuarios" element={<RequireManager><Usuarios /></RequireManager>} />
        <Route path="/seguros/configuracoes" element={<Configuracoes />} />

        {/* Consórcios */}
        <Route path="/consorcios" element={<DashboardConsorcios />} />
        <Route path="/consorcios/bolsao" element={<Bolsao modulo="consorcios" />} />
        <Route path="/consorcios/pipeline" element={<Pipeline modulo="consorcios" />} />
        <Route path="/consorcios/tarefas" element={<Tarefas modulo="consorcios" />} />
        <Route path="/consorcios/consorcios" element={<ConsorciosCliente />} />
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
        <Route path="/consorcios/usuarios" element={<RequireManager><Usuarios /></RequireManager>} />
        <Route path="/consorcios/configuracoes" element={<Configuracoes />} />
      </Route>
      <Route path="*" element={<Navigate to="/seguros" replace />} />
    </Routes>
    </Suspense>
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

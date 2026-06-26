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
import { Vendas } from "./pages/seguros/Vendas";
import { Pipeline } from "./pages/Pipeline";
import { Bolsao } from "./pages/Bolsao";
import { Clientes } from "./pages/Clientes";
import { Usuarios } from "./pages/admin/Usuarios";

/* ---- Seções estruturadas (prontas para dados) ---- */
const Endossos = () => <SectionPage title="Endossos" subtitle="Alterações de apólices" icon={FileEdit} primaryAction="Novo Endosso"
  kpis={[{ label: "Qtd. Endossos", icon: FileEdit }, { label: "Prêmio Líquido", icon: DollarSign, accent: "success" }, { label: "Ticket Médio", icon: TrendingUp, accent: "sky" }]}
  emptyIcon={FileEdit} emptyTitle="Nenhum endosso lançado" emptyHint="Inclusão de condutor, troca de veículo, atualização de cobertura/CNPJ e mais." />;

const Parcelas = () => <SectionPage title="Parcelas" subtitle="Controle financeiro das apólices" icon={Receipt}
  kpis={[{ label: "Total em Aberto", icon: Wallet }, { label: "Total em Atraso", icon: AlertTriangle, accent: "danger" }]}
  emptyIcon={Receipt} emptyTitle="Nenhuma parcela registrada" emptyHint="Vencimentos, pagamentos e inadimplência aparecem aqui." />;

const Comissoes = () => <SectionPage title="Comissões" subtitle="Comissões por consultor" icon={DollarSign}
  kpis={[{ label: "A Pagar", icon: DollarSign, accent: "warning" }, { label: "Pagas", icon: CheckCircle2, accent: "success" }]}
  emptyIcon={DollarSign} emptyTitle="Nenhuma comissão no período" emptyHint="Vigência, %, valor, liberação e pagamento por venda." />;

const Ranking = () => <SectionPage title="Ranking de Vendedores" subtitle="Desempenho da equipe" icon={Trophy}
  kpis={[{ label: "Total em Vendas", icon: TrendingUp }, { label: "Total em Comissões", icon: DollarSign, accent: "success" }, { label: "Ticket Médio", icon: Trophy, accent: "warning" }]}
  emptyIcon={Trophy} emptyTitle="Sem vendas no período" emptyHint="O ranking por produção e comissão aparece aqui." />;

const Metas = () => <SectionPage title="Metas & Performance" subtitle="Metas da corretora, individuais e plano de carreira" icon={Target} primaryAction="Definir Meta"
  emptyIcon={Target} emptyTitle="Nenhuma meta definida para este mês" emptyHint="Defina a meta geral da corretora e metas individuais por consultor." />;

const Sinistros = () => <SectionPage title="Sinistros & Assistências" subtitle="Atendimentos vinculados às apólices" icon={ShieldAlert} primaryAction="Novo Atendimento"
  emptyIcon={ShieldAlert} emptyTitle="Nenhum atendimento registrado" emptyHint="Acompanhe sinistros e assistências com status e responsável." />;

const Auditoria = () => <SectionPage title="Auditoria & Cobrança" subtitle="Pós-venda — gestão por exceção" icon={ClipboardCheck}
  kpis={[{ label: "A Conferir", icon: ClipboardCheck, accent: "warning" }, { label: "Aprovadas", icon: CheckCircle2, accent: "success" }, { label: "Cobrança em Atraso", icon: AlertTriangle, accent: "danger" }]}
  emptyIcon={ClipboardCheck} emptyTitle="Nada para auditar ainda" emptyHint="Cada venda passa por conferência e controle de cobrança." />;

const Producao = () => <SectionPage title="Produção Mensal" subtitle="Relatório consolidado" icon={BarChart3}
  emptyIcon={BarChart3} emptyTitle="Sem produção no período" emptyHint="Consolidado por consultor, seguradora e produto." />;

const TvSalao = () => <SectionPage title="TV do Salão" subtitle="Painel de ranking e metas para o escritório" icon={Tv}
  emptyIcon={Tv} emptyTitle="Painel pronto" emptyHint="Modo apresentação (tela cheia) com ranking, metas e últimas vendas — ideal para a TV do salão." />;

/* Consórcios */
const DashboardConsorcios = () => <SectionPage title="Dashboard" subtitle="Visão geral — Consórcios" icon={LayoutDashboard}
  kpis={[{ label: "Cotas Vendidas (mês)", icon: Layers }, { label: "Crédito Comercializado", icon: DollarSign, accent: "success" }, { label: "Contemplações", icon: Award, accent: "warning" }, { label: "Comissão Média", icon: TrendingUp, accent: "sky" }]}
  emptyIcon={LayoutDashboard} emptyTitle="Sem dados de consórcio ainda" emptyHint="Produção, contemplações e grupos aparecem aqui." />;

const Cotas = () => <SectionPage title="Cotas" subtitle="Cartas de crédito dos clientes" icon={Layers} primaryAction="Nova Cota"
  emptyIcon={Layers} emptyTitle="Nenhuma cota registrada" emptyHint="Grupo, cota, administradora, crédito, parcela, status e contemplação." />;

const Contemplacoes = () => <SectionPage title="Contemplações" subtitle="Sorteios e lances" icon={Award}
  emptyIcon={Award} emptyTitle="Nenhuma contemplação" emptyHint="Acompanhe contemplações por sorteio e por lance." />;

const Grupos = () => <SectionPage title="Grupos & Assembleias" subtitle="Calendário de assembleias e grupos" icon={CalendarDays} primaryAction="Novo Grupo"
  emptyIcon={CalendarDays} emptyTitle="Nenhum grupo cadastrado" emptyHint="Administradora, grupo, datas de assembleia e participantes." />;

/* Admin compartilhado */
const Parceiros = () => <SectionPage title="Parceiros" subtitle="Seguradoras e administradoras" icon={Building2} primaryAction="Novo Parceiro"
  emptyIcon={Building2} emptyTitle="Nenhum parceiro cadastrado" emptyHint="Porto Seguro, Tokio, Allianz, Âncora, Tradição e mais." />;

const Produtos = () => <SectionPage title="Produtos" subtitle="Catálogo de produtos" icon={Package} primaryAction="Novo Produto"
  emptyIcon={Package} emptyTitle="Nenhum produto cadastrado" emptyHint="Auto, Vida, Residencial, Empresarial, Consórcio Imóvel/Veículo e mais." />;

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

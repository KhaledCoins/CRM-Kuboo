import {
  FileEdit, Receipt, DollarSign, Target, ShieldAlert, Layers, Award, CalendarDays,
  Building2, Package,
} from "lucide-react";
import { Badge } from "../components/ui";
import { brl, brlShort, dateBR, pct } from "../lib/format";
import { supabase } from "../lib/supabase";
import { DataTablePage, type FormField } from "./DataTablePage";

const sum = (rows: any[], k: string) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
const count = (rows: any[], pred: (r: any) => boolean) => rows.filter(pred).length;

const statusTone: Record<string, "slate" | "green" | "blue" | "amber" | "red" | "violet"> = {
  ativa: "green", ativo: "green", paga: "green", pago: "green", aprovado: "green", contemplada: "blue", concluido: "green",
  pendente: "amber", aberta: "amber", a_pagar: "amber", reanalise: "amber", em_andamento: "amber", aberto: "amber",
  atrasada: "red", cancelada: "red", cancelado: "red", vencida: "red", inativo: "slate",
};
const St = ({ s }: { s?: string }) => <Badge tone={statusTone[s || ""] ?? "slate"}>{s || "—"}</Badge>;

const optStatusVenda: FormField["options"] = [
  { value: "ativa", label: "Ativa" }, { value: "pendente", label: "Pendente" },
  { value: "cancelada", label: "Cancelada" }, { value: "vencida", label: "Vencida" },
];
const optModulo: FormField["options"] = [{ value: "seguros", label: "Seguros" }, { value: "consorcios", label: "Consórcios" }];

/* ───────── SEGUROS ───────── */

export const Vendas = () => (
  <DataTablePage
    title="Vendas" subtitle="Apólices e propostas registradas" icon={Receipt}
    table="vendas" orderBy="data_venda" primaryAction="Nova Venda"
    formFields={[
      { key: "data_venda", label: "Data da venda", type: "date", required: true },
      { key: "cliente_nome", label: "Cliente", required: true },
      { key: "numero_proposta", label: "Nº proposta" },
      { key: "seguradora", label: "Seguradora" },
      { key: "produto", label: "Produto", placeholder: "Auto, Vida, Residencial…" },
      { key: "valor", label: "Valor (prêmio)", type: "currency", required: true },
      { key: "parcelas", label: "Parcelas", type: "number" },
      { key: "comissao_valor", label: "Comissão (R$)", type: "currency" },
      { key: "vendedor_nome", label: "Vendedor" },
      { key: "status", label: "Status", type: "select", options: optStatusVenda },
    ]}
    computeKpis={(r) => [
      { label: "Vendas", value: String(r.length), icon: Receipt, accent: "brand" },
      { label: "Produção", value: brlShort(sum(r, "valor")), icon: DollarSign, accent: "success" },
      { label: "Comissões", value: brlShort(sum(r, "comissao_valor")), icon: DollarSign, accent: "sky" },
      { label: "Pendentes", value: String(count(r, (x) => x.status === "pendente")), icon: ShieldAlert, accent: "warning" },
    ]}
    columns={[
      { header: "Data", render: (r) => dateBR(r.data_venda) },
      { header: "Proposta", render: (r) => r.numero_proposta || "—" },
      { header: "Cliente", render: (r) => r.cliente_nome || "—" },
      { header: "Seguradora", render: (r) => r.seguradora || "—" },
      { header: "Produto", render: (r) => r.produto || "—" },
      { header: "Valor", right: true, render: (r) => brl(r.valor) },
      { header: "Status", render: (r) => <St s={r.status} /> },
    ]}
    emptyIcon={Receipt} emptyTitle="Nenhuma venda registrada ainda"
    emptyHint="Cadastre uma venda, importe sua planilha de apólices ou converta um lead do Pipeline."
  />
);

export const Parcelas = () => (
  <DataTablePage
    title="Parcelas" subtitle="Controle financeiro das apólices" icon={Receipt}
    table="parcelas" orderBy="vencimento" ascending primaryAction="Nova Parcela"
    formFields={[
      { key: "numero", label: "Nº da parcela", type: "number" },
      { key: "valor", label: "Valor", type: "currency", required: true },
      { key: "vencimento", label: "Vencimento", type: "date", required: true },
      { key: "pagamento", label: "Data de pagamento", type: "date" },
      { key: "status", label: "Status", type: "select", options: [
        { value: "aberta", label: "Aberta" }, { value: "paga", label: "Paga" },
        { value: "atrasada", label: "Atrasada" }, { value: "cancelada", label: "Cancelada" },
      ] },
    ]}
    computeKpis={(r) => [
      { label: "Parcelas", value: String(r.length), icon: Receipt, accent: "brand" },
      { label: "A receber", value: brlShort(sum(r.filter((x) => x.status !== "paga"), "valor")), icon: DollarSign, accent: "warning" },
      { label: "Recebido", value: brlShort(sum(r.filter((x) => x.status === "paga"), "valor")), icon: DollarSign, accent: "success" },
      { label: "Em atraso", value: String(count(r, (x) => x.status === "atrasada")), icon: ShieldAlert, accent: "danger" },
    ]}
    columns={[
      { header: "Nº", render: (r) => r.numero ?? "—" },
      { header: "Vencimento", render: (r) => dateBR(r.vencimento) },
      { header: "Pagamento", render: (r) => dateBR(r.pagamento) },
      { header: "Valor", right: true, render: (r) => brl(r.valor) },
      { header: "Status", render: (r) => <St s={r.status} /> },
    ]}
    emptyIcon={Receipt} emptyTitle="Nenhuma parcela lançada"
    emptyHint="As parcelas das vendas aparecem aqui para você controlar recebimentos e inadimplência."
  />
);

export const Comissoes = () => (
  <DataTablePage
    title="Comissões" subtitle="Comissões por consultor" icon={DollarSign}
    table="comissoes" orderBy="liberacao"
    computeKpis={(r) => [
      { label: "Total", value: brlShort(sum(r, "valor")), icon: DollarSign, accent: "brand" },
      { label: "A pagar", value: brlShort(sum(r.filter((x) => x.status === "a_pagar"), "valor")), icon: DollarSign, accent: "warning" },
      { label: "Pagas", value: brlShort(sum(r.filter((x) => x.status === "paga"), "valor")), icon: DollarSign, accent: "success" },
    ]}
    columns={[
      { header: "Liberação", render: (r) => dateBR(r.liberacao) },
      { header: "Percentual", render: (r) => pct(r.pct) },
      { header: "Valor", right: true, render: (r) => brl(r.valor) },
      { header: "Pagamento", render: (r) => dateBR(r.pagamento) },
      { header: "Status", render: (r) => <St s={r.status} /> },
    ]}
    emptyIcon={DollarSign} emptyTitle="Nenhuma comissão lançada"
    emptyHint="Cada venda gera a comissão do consultor automaticamente — aparece aqui para conferência e pagamento."
  />
);

export const Endossos = () => (
  <DataTablePage
    title="Endossos" subtitle="Alterações de apólices" icon={FileEdit}
    table="endossos" orderBy="data" primaryAction="Novo Endosso"
    formFields={[
      { key: "data", label: "Data", type: "date", required: true },
      { key: "cliente_nome", label: "Cliente", required: true },
      { key: "seguradora", label: "Seguradora" },
      { key: "motivo", label: "Motivo", placeholder: "Troca de veículo, inclusão de condutor…" },
      { key: "valor", label: "Valor", type: "currency" },
    ]}
    columns={[
      { header: "Data", render: (r) => dateBR(r.data) },
      { header: "Cliente", render: (r) => r.cliente_nome || "—" },
      { header: "Seguradora", render: (r) => r.seguradora || "—" },
      { header: "Motivo", render: (r) => r.motivo || "—" },
      { header: "Valor", right: true, render: (r) => brl(r.valor) },
    ]}
    emptyIcon={FileEdit} emptyTitle="Nenhum endosso registrado"
    emptyHint="Inclusões, exclusões e alterações de apólice ficam registradas aqui."
  />
);

export const Metas = () => (
  <DataTablePage
    title="Metas & Performance" subtitle="Metas da corretora e individuais" icon={Target}
    table="metas" orderBy="mes" primaryAction="Definir Meta"
    formFields={[
      { key: "mes", label: "Mês de referência", type: "date", required: true },
      { key: "escopo", label: "Escopo", type: "select", required: true, options: [
        { value: "corretora", label: "Corretora (geral)" }, { value: "individual", label: "Individual" },
      ] },
      { key: "modulo", label: "Módulo", type: "select", options: optModulo },
      { key: "valor_meta", label: "Meta (R$)", type: "currency", required: true },
    ]}
    columns={[
      { header: "Mês", render: (r) => dateBR(r.mes) },
      { header: "Escopo", render: (r) => r.escopo || "—" },
      { header: "Módulo", render: (r) => r.modulo || "—" },
      { header: "Meta", right: true, render: (r) => brl(r.valor_meta) },
    ]}
    emptyIcon={Target} emptyTitle="Nenhuma meta definida"
    emptyHint="Defina metas da corretora e por consultor para acompanhar a performance no painel."
  />
);

export const Sinistros = () => (
  <DataTablePage
    title="Sinistros & Assistências" subtitle="Atendimentos vinculados às apólices" icon={ShieldAlert}
    table="atendimentos" orderBy="data" primaryAction="Novo Atendimento"
    formFields={[
      { key: "data", label: "Data", type: "date", required: true },
      { key: "tipo", label: "Tipo", type: "select", required: true, options: [
        { value: "sinistro", label: "Sinistro" }, { value: "assistencia", label: "Assistência" },
      ] },
      { key: "numero_registro", label: "Nº de registro" },
      { key: "cliente_nome", label: "Cliente", required: true },
      { key: "descricao", label: "Descrição", type: "textarea" },
      { key: "status", label: "Status", type: "select", options: [
        { value: "aberto", label: "Aberto" }, { value: "em_andamento", label: "Em andamento" }, { value: "concluido", label: "Concluído" },
      ] },
    ]}
    computeKpis={(r) => [
      { label: "Atendimentos", value: String(r.length), icon: ShieldAlert, accent: "brand" },
      { label: "Abertos", value: String(count(r, (x) => x.status === "aberto")), icon: ShieldAlert, accent: "warning" },
      { label: "Sinistros", value: String(count(r, (x) => x.tipo === "sinistro")), icon: ShieldAlert, accent: "danger" },
    ]}
    columns={[
      { header: "Data", render: (r) => dateBR(r.data) },
      { header: "Tipo", render: (r) => <St s={r.tipo} /> },
      { header: "Registro", render: (r) => r.numero_registro || "—" },
      { header: "Cliente", render: (r) => r.cliente_nome || "—" },
      { header: "Status", render: (r) => <St s={r.status} /> },
    ]}
    emptyIcon={ShieldAlert} emptyTitle="Nenhum atendimento aberto"
    emptyHint="Sinistros e assistências dos seus clientes são acompanhados aqui, do registro à conclusão."
  />
);

export const Parceiros = () => (
  <DataTablePage
    title="Parceiros" subtitle="Seguradoras e administradoras" icon={Building2}
    table="seguradoras" orderBy="nome" ascending primaryAction="Novo Parceiro"
    formFields={[
      { key: "nome", label: "Nome", required: true, placeholder: "Porto Seguro, Âncora…" },
      { key: "tipo", label: "Tipo", type: "select", required: true, options: [
        { value: "seguradora", label: "Seguradora" }, { value: "administradora", label: "Administradora" },
      ] },
      { key: "comissao_padrao", label: "Comissão padrão (%)", type: "number" },
      { key: "site", label: "Site" },
    ]}
    columns={[
      { header: "Nome", render: (r) => <span className="font-semibold text-ink">{r.nome}</span> },
      { header: "Tipo", render: (r) => <Badge tone={r.tipo === "administradora" ? "violet" : "blue"}>{r.tipo}</Badge> },
      { header: "Comissão padrão", render: (r) => (r.comissao_padrao != null ? pct(r.comissao_padrao) : "—") },
      { header: "Site", render: (r) => r.site || "—" },
      { header: "Ativo", render: (r) => <St s={r.ativo === false ? "inativo" : "ativo"} /> },
    ]}
    emptyIcon={Building2} emptyTitle="Nenhum parceiro cadastrado"
    emptyHint="Cadastre as seguradoras e administradoras com quem a Kuboo trabalha e suas comissões padrão."
  />
);

export const Produtos = () => (
  <DataTablePage
    title="Produtos" subtitle="Catálogo de produtos" icon={Package}
    table="produtos" orderBy="nome" ascending primaryAction="Novo Produto"
    formFields={[
      { key: "nome", label: "Nome do produto", required: true, placeholder: "Seguro Auto, Consórcio Imóvel…" },
      { key: "modulo", label: "Módulo", type: "select", required: true, options: optModulo },
      { key: "descricao", label: "Descrição", type: "textarea" },
    ]}
    columns={[
      { header: "Produto", render: (r) => <span className="font-semibold text-ink">{r.nome}</span> },
      { header: "Módulo", render: (r) => <Badge tone={r.modulo === "consorcios" ? "violet" : "blue"}>{r.modulo}</Badge> },
      { header: "Descrição", render: (r) => r.descricao || "—" },
      { header: "Ativo", render: (r) => <St s={r.ativo === false ? "inativo" : "ativo"} /> },
    ]}
    emptyIcon={Package} emptyTitle="Nenhum produto cadastrado"
    emptyHint="Monte o catálogo de produtos (Auto, Vida, Imóvel, etc.) que a equipe oferece."
  />
);

/* ───────── CONSÓRCIOS ───────── */

export const Cotas = () => (
  <DataTablePage
    title="Cotas" subtitle="Cartas de crédito dos clientes" icon={Layers}
    table="cotas" orderBy="created_at" primaryAction="Nova Cota"
    formFields={[
      { key: "cliente_nome", label: "Cliente", required: true },
      { key: "administradora", label: "Administradora", placeholder: "Âncora, Porto, Tradição…" },
      { key: "tipo", label: "Tipo", type: "select", options: [
        { value: "Imóvel", label: "Imóvel" }, { value: "Veículo", label: "Veículo" }, { value: "Empresarial", label: "Empresarial" },
      ] },
      { key: "grupo", label: "Grupo" },
      { key: "numero_cota", label: "Cota" },
      { key: "valor_credito", label: "Valor do crédito", type: "currency", required: true },
      { key: "parcela", label: "Parcela mensal", type: "currency" },
      { key: "prazo", label: "Prazo (meses)", type: "number" },
      { key: "parcelas_pagas", label: "Parcelas pagas", type: "number" },
      { key: "status", label: "Status", type: "select", options: [
        { value: "ativa", label: "Ativa" }, { value: "contemplada", label: "Contemplada" },
        { value: "cancelada", label: "Cancelada" }, { value: "quitada", label: "Quitada" },
      ] },
    ]}
    computeKpis={(r) => [
      { label: "Cotas", value: String(r.length), icon: Layers, accent: "brand" },
      { label: "Crédito total", value: brlShort(sum(r, "valor_credito")), icon: DollarSign, accent: "success" },
      { label: "Contempladas", value: String(count(r, (x) => x.status === "contemplada")), icon: Award, accent: "sky" },
    ]}
    columns={[
      { header: "Cliente", render: (r) => r.cliente_nome || "—" },
      { header: "Administradora", render: (r) => r.administradora || "—" },
      { header: "Tipo", render: (r) => r.tipo || "—" },
      { header: "Grupo/Cota", render: (r) => `${r.grupo || "—"}/${r.numero_cota || "—"}` },
      { header: "Crédito", right: true, render: (r) => brl(r.valor_credito) },
      { header: "Pagas", render: (r) => `${r.parcelas_pagas ?? 0}/${r.prazo ?? "—"}` },
      { header: "Status", render: (r) => <St s={r.status} /> },
    ]}
    emptyIcon={Layers} emptyTitle="Nenhuma cota cadastrada"
    emptyHint="As cartas de crédito (cotas) dos clientes aparecem aqui com saldo, parcelas e status."
  />
);

export const Contemplacoes = () => (
  <DataTablePage
    title="Contemplações" subtitle="Sorteios e lances" icon={Award}
    table="contemplacoes" select="*, cotas(cliente_nome, numero_cota, grupo)" orderBy="data" primaryAction="Registrar Contemplação"
    formFields={[
      { key: "cota_id", label: "Cota contemplada", type: "select", required: true,
        loadOptions: async () => {
          if (!supabase) return [];
          const { data } = await supabase.from("cotas").select("id, cliente_nome, numero_cota, grupo").order("created_at", { ascending: false }).limit(500);
          return (data || []).map((c: any) => ({ value: c.id, label: `${c.cliente_nome || "—"} · grupo ${c.grupo || "—"} / cota ${c.numero_cota || "—"}` }));
        } },
      { key: "data", label: "Data", type: "date", required: true },
      { key: "forma", label: "Forma", type: "select", required: true, options: [
        { value: "sorteio", label: "Sorteio" }, { value: "lance", label: "Lance" },
      ] },
      { key: "valor_lance", label: "Valor do lance", type: "currency" },
    ]}
    columns={[
      { header: "Data", render: (r) => dateBR(r.data) },
      { header: "Cliente / Cota", render: (r) => r.cotas ? `${r.cotas.cliente_nome || "—"} · ${r.cotas.grupo || "—"}/${r.cotas.numero_cota || "—"}` : "—" },
      { header: "Forma", render: (r) => <Badge tone={r.forma === "lance" ? "amber" : "green"}>{r.forma}</Badge> },
      { header: "Valor do lance", right: true, render: (r) => (r.valor_lance != null ? brl(r.valor_lance) : "—") },
    ]}
    emptyIcon={Award} emptyTitle="Nenhuma contemplação registrada"
    emptyHint="Sorteios e lances contemplados ficam registrados aqui, vinculados à cota do cliente."
  />
);

export const Grupos = () => (
  <DataTablePage
    title="Grupos & Assembleias" subtitle="Calendário de assembleias e grupos" icon={CalendarDays}
    table="grupos" orderBy="proxima_assembleia" ascending primaryAction="Novo Grupo"
    formFields={[
      { key: "administradora", label: "Administradora", required: true },
      { key: "numero", label: "Nº do grupo" },
      { key: "tipo", label: "Tipo", placeholder: "Imóvel, Veículo…" },
      { key: "proxima_assembleia", label: "Próxima assembleia", type: "date" },
      { key: "participantes", label: "Participantes", type: "number" },
    ]}
    columns={[
      { header: "Administradora", render: (r) => r.administradora || "—" },
      { header: "Grupo", render: (r) => r.numero || "—" },
      { header: "Tipo", render: (r) => r.tipo || "—" },
      { header: "Próxima assembleia", render: (r) => dateBR(r.proxima_assembleia) },
      { header: "Participantes", right: true, render: (r) => r.participantes ?? "—" },
    ]}
    emptyIcon={CalendarDays} emptyTitle="Nenhum grupo cadastrado"
    emptyHint="Cadastre os grupos e o calendário de assembleias para acompanhar contemplações."
  />
);

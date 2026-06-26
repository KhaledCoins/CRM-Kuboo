import { useState } from "react";
import { ShoppingCart, Plus, FileSpreadsheet } from "lucide-react";
import { PageHeader, Button, Card, FilterBar, SearchInput, Select, Table, Th, EmptyState } from "../../components/ui";

export function Vendas() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");

  return (
    <>
      <PageHeader
        title="Vendas"
        subtitle="Apólices e propostas registradas"
        icon={ShoppingCart}
        actions={
          <>
            <Button variant="outline" icon={FileSpreadsheet}>Importar Planilha</Button>
            <Button icon={Plus}>Nova Venda</Button>
          </>
        }
      />

      <FilterBar>
        <SearchInput value={q} onChange={setQ} placeholder="Buscar cliente ou proposta..." />
        <Select value={status} onChange={setStatus} placeholder="Status" options={[
          { value: "ativa", label: "Ativa" }, { value: "pendente", label: "Pendente" }, { value: "cancelada", label: "Cancelada" },
        ]} />
        <Select value="" onChange={() => {}} placeholder="Seguradora" options={[
          { value: "porto", label: "Porto Seguro" }, { value: "tokio", label: "Tokio Marine" }, { value: "allianz", label: "Allianz" },
        ]} />
        <Select value="" onChange={() => {}} placeholder="Produto" options={[
          { value: "auto", label: "Auto" }, { value: "vida", label: "Vida" }, { value: "resid", label: "Residencial" },
        ]} />
        <Select value="" onChange={() => {}} placeholder="Vendedor" options={[]} />
      </FilterBar>

      <Card pad={false}>
        <div className="p-2">
          <Table head={<>
            <Th>Data</Th><Th>Proposta</Th><Th>Cliente</Th><Th>Seguradora</Th><Th>Produto</Th>
            <Th>Vendedor</Th><Th right>Valor</Th><Th>Parcelas</Th><Th>Status</Th><Th>Comissão</Th>
          </>}>
          </Table>
        </div>
        <EmptyState
          icon={ShoppingCart}
          title="Nenhuma venda registrada ainda"
          hint="Cadastre uma venda, importe sua planilha de apólices ou converta um lead do Pipeline. Tudo aparece aqui."
          action={<Button variant="outline" icon={FileSpreadsheet}>Importar Planilha de Apólices</Button>}
        />
      </Card>
    </>
  );
}

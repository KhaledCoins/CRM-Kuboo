import { useEffect, useMemo, useState, useCallback } from "react";
import { Users, Plus, MapPin, Phone, Mail } from "lucide-react";
import { PageHeader, Button, Card, Table, Th, Td, Tr, FilterBar, SearchInput, EmptyState, Spinner } from "../components/ui";
import { TimelineCliente, type ClienteResumo } from "../components/TimelineCliente";
import { NovoClienteModal } from "../components/NovoClienteModal";
import { supabase } from "../lib/supabase";
import { dateBR, initials } from "../lib/format";

interface Cliente {
  id: string; name: string; cpf?: string | null; phone?: string | null;
  email?: string | null; city?: string | null; state?: string | null; created_at?: string;
}

export function Clientes() {
  const [rows, setRows] = useState<Cliente[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [aberto, setAberto] = useState<ClienteResumo | null>(null); // timeline 360º
  const [novoAberto, setNovoAberto] = useState(false);

  const carregar = useCallback(async () => {
    if (!supabase) { setLoading(false); return; }
    // OBS: "email" só existe depois de rodar supabase/clientes-onboarding.sql.
    // Não selecionamos aqui de propósito — se essa migração ainda não rodou,
    // a lista de clientes não pode quebrar por causa de uma coluna nova.
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, name, cpf, phone, city, state, created_at")
        .order("name");
      if (error) console.error("[clientes] carregar:", error.message);
      setRows((data as any) ?? []);
    } catch (e) {
      console.error("[clientes] carregar:", e);
    } finally {
      setLoading(false); // sempre sai do skeleton, mesmo em erro de rede
    }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const filtered = useMemo(
    () => rows.filter((r) => (r.name || "").toLowerCase().includes(q.toLowerCase()) || (r.cpf || "").includes(q)),
    [rows, q]
  );

  return (
    <>
      <PageHeader title="Clientes" subtitle="Base de clientes (PF e PJ)" icon={Users} actions={<Button icon={Plus} onClick={() => setNovoAberto(true)}>Novo Cliente</Button>} />
      <FilterBar><SearchInput value={q} onChange={setQ} placeholder="Buscar por nome ou CPF/CNPJ..." /></FilterBar>

      <Card pad={false}>
        {loading ? (
          <Spinner label="Carregando clientes..." />
        ) : filtered.length === 0 ? (
          <EmptyState icon={Users} title="Nenhum cliente encontrado" hint="Os clientes do portal e os importados aparecem aqui. Use “Novo Cliente” para cadastrar manualmente."
            action={<Button icon={Plus} onClick={() => setNovoAberto(true)}>Novo Cliente</Button>} />
        ) : (
          <div className="p-2">
            <Table head={<><Th>Cliente</Th><Th>CPF/CNPJ</Th><Th>Contato</Th><Th>Cidade/UF</Th><Th>Cadastro</Th></>}>
              {filtered.map((c) => (
                <Tr key={c.id} className="cursor-pointer" onClick={() => setAberto(c)}>
                  <Td>
                    <div className="flex items-center gap-2.5">
                      <span className="w-8 h-8 rounded-full bg-brand-100 text-brand-700 grid place-items-center text-xs font-bold">{initials(c.name)}</span>
                      <span className="font-bold text-ink">{c.name}</span>
                    </div>
                  </Td>
                  <Td>{c.cpf || "—"}</Td>
                  <Td>
                    <div className="text-xs text-muted space-y-0.5">
                      {c.phone && <span className="flex items-center gap-1"><Phone size={11} /> {c.phone}</span>}
                      {c.email && <span className="flex items-center gap-1"><Mail size={11} /> {c.email}</span>}
                      {!c.phone && !c.email && "—"}
                    </div>
                  </Td>
                  <Td>{c.city ? <span className="flex items-center gap-1 text-muted"><MapPin size={12} /> {c.city}/{c.state}</span> : "—"}</Td>
                  <Td>{dateBR(c.created_at)}</Td>
                </Tr>
              ))}
            </Table>
          </div>
        )}
      </Card>

      {aberto && <TimelineCliente cliente={aberto} onFechar={() => setAberto(null)} />}
      {novoAberto && <NovoClienteModal onFechar={() => setNovoAberto(false)} onCriado={carregar} />}
    </>
  );
}

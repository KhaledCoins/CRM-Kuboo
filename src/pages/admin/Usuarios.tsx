import { useEffect, useState } from "react";
import { UserCog, UserPlus, Mail, Phone } from "lucide-react";
import { PageHeader, Button, Card, Table, Th, Td, Tr, Badge, EmptyState, Spinner } from "../../components/ui";
import { supabase } from "../../lib/supabase";
import { dateBR, initials } from "../../lib/format";

interface TeamRow {
  id: string; name: string; email?: string | null; phone?: string | null;
  role?: string | null; nivel?: string | null; aprovado?: boolean; created_at?: string;
}

const roleTone = (r?: string | null) => (r === "admin" ? "violet" : r === "gestor" ? "blue" : "slate") as any;

export function Usuarios() {
  const [rows, setRows] = useState<TeamRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      if (!supabase) { setLoading(false); return; }
      // Equipe = perfis com papel definido (admin/gestor/vendedor)
      const { data } = await supabase
        .from("profiles")
        .select("id, name, phone, role, nivel, aprovado, created_at")
        .in("role", ["admin", "gestor", "vendedor"])
        .order("name");
      setRows((data as any) ?? []);
      setLoading(false);
    })();
  }, []);

  return (
    <>
      <PageHeader title="Usuários" subtitle="Equipe de consultores e gestores" icon={UserCog} actions={<span title="Novos membros se cadastram pela tela de login e são aprovados pelo administrador"><Button icon={UserPlus} disabled>Novo Usuário</Button></span>} />
      <Card pad={false}>
        {loading ? (
          <Spinner label="Carregando equipe..." />
        ) : rows.length === 0 ? (
          <EmptyState icon={UserCog} title="Nenhum usuário de equipe cadastrado" hint="Cadastre consultores e gestores. Novos cadastros podem exigir aprovação do administrador." />
        ) : (
          <div className="p-2">
            <Table head={<><Th>Usuário</Th><Th>Contato</Th><Th>Cargo</Th><Th>Status</Th><Th>Cadastro</Th></>}>
              {rows.map((u) => (
                <Tr key={u.id}>
                  <Td>
                    <div className="flex items-center gap-2.5">
                      <span className="w-8 h-8 rounded-full bg-brand-500 text-white grid place-items-center text-xs font-bold">{initials(u.name)}</span>
                      <span className="font-bold text-ink">{u.name}</span>
                    </div>
                  </Td>
                  <Td>
                    <div className="text-xs text-muted space-y-0.5">
                      {u.email && <span className="flex items-center gap-1"><Mail size={11} /> {u.email}</span>}
                      {u.phone && <span className="flex items-center gap-1"><Phone size={11} /> {u.phone}</span>}
                    </div>
                  </Td>
                  <Td>
                    <Badge tone={roleTone(u.role)}>{u.role === "admin" ? "Administrador" : u.role === "gestor" ? "Gestor" : "Vendedor"}{u.nivel ? ` · ${u.nivel}` : ""}</Badge>
                  </Td>
                  <Td>{u.aprovado === false ? <Badge tone="amber">Pendente</Badge> : <Badge tone="green">Aprovado</Badge>}</Td>
                  <Td>{dateBR(u.created_at)}</Td>
                </Tr>
              ))}
            </Table>
          </div>
        )}
      </Card>
    </>
  );
}

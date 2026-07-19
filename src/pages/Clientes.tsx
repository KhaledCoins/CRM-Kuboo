import { useEffect, useMemo, useState, useCallback } from "react";
import { Users, Plus, MapPin, Phone, Mail, Send } from "lucide-react";
import { toast } from "sonner";
import { PageHeader, Button, Card, Table, Th, Td, Tr, FilterBar, SearchInput, EmptyState, Spinner } from "../components/ui";
import { TimelineCliente, type ClienteResumo } from "../components/TimelineCliente";
import { NovoClienteModal } from "../components/NovoClienteModal";
import { supabase } from "../lib/supabase";
import { dateBR, initials } from "../lib/format";

interface Cliente {
  id: string; name: string; cpf?: string | null; phone?: string | null;
  email?: string | null; role?: string | null; city?: string | null; state?: string | null; created_at?: string;
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
      let lista: Cliente[] = (data as any) ?? [];
      // e-mail/role vêm numa 2ª consulta defensiva: se a migração da coluna
      // email ainda não rodou, a lista continua funcionando sem o botão de envio.
      try {
        const { data: extras } = await supabase.from("profiles").select("id, email, role");
        if (extras) {
          const porId = new Map(extras.map((e: any) => [e.id, e]));
          lista = lista.map((c) => ({ ...c, ...(porId.get(c.id) || {}) }));
        }
      } catch { /* coluna email pode não existir ainda */ }
      setRows(lista);
    } catch (e) {
      console.error("[clientes] carregar:", e);
    } finally {
      setLoading(false); // sempre sai do skeleton, mesmo em erro de rede
    }
  }, []);

  // Reenvio de acesso: gera senha temporária NOVA no servidor e manda o e-mail
  // explicativo da Kuboo. Invalida a senha atual do cliente — por isso confirma.
  const [enviandoId, setEnviandoId] = useState<string | null>(null);
  async function enviarAcesso(c: Cliente) {
    if (!supabase || enviandoId) return;
    if (!window.confirm(`Gerar uma senha temporária NOVA e enviar o acesso por e-mail para ${c.name} (${c.email})? A senha atual dele(a) deixa de valer.`)) return;
    setEnviandoId(c.id);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) throw new Error("Sessão expirada — faça login novamente.");
      const r = await fetch("/api/enviar-credenciais", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ clientId: c.id }),
      });
      const json = await r.json().catch(() => null);
      if (!r.ok) throw new Error(json?.error || "Falha ao enviar o e-mail.");
      toast.success(`Acesso enviado para ${json.sentTo}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao enviar o e-mail.", { duration: 9000 });
    } finally {
      setEnviandoId(null);
    }
  }

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
            <Table head={<><Th>Cliente</Th><Th>CPF/CNPJ</Th><Th>Contato</Th><Th>Cidade/UF</Th><Th>Cadastro</Th><Th>Acesso</Th></>}>
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
                  <Td>
                    {c.email && (c.role ?? "cliente") === "cliente" ? (
                      <button
                        onClick={(e) => { e.stopPropagation(); enviarAcesso(c); }}
                        disabled={enviandoId === c.id}
                        title="Enviar credenciais do portal por e-mail (gera senha temporária nova)"
                        aria-label={`Enviar acesso por e-mail para ${c.name}`}
                        className="inline-flex items-center gap-1.5 text-xs font-bold text-brand-600 bg-brand-50 hover:bg-brand-100 px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                      >
                        <Send size={12} /> {enviandoId === c.id ? "Enviando..." : "Enviar acesso"}
                      </button>
                    ) : (
                      <span className="text-xs text-muted">—</span>
                    )}
                  </Td>
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

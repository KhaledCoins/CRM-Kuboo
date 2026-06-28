import { useEffect, useMemo, useState } from "react";
import { RefreshCcw, AlertTriangle, Clock, CheckCircle2, ListPlus } from "lucide-react";
import { toast } from "sonner";
import { Card, KpiCard, PageHeader, Table, Th, Td, Tr, EmptyState, Badge } from "../components/ui";
import { brl, dateBR } from "../lib/format";
import { supabase } from "../lib/supabase";
import { criarTarefa } from "../lib/tarefas";

interface Venda { id: string; cliente_nome: string | null; produto: string | null; seguradora: string | null; valor: number | null; vigencia_fim: string | null; status: string | null; }
const diasAte = (s: string) => Math.ceil((new Date(s).getTime() - Date.now()) / 86400000);

export function Renovacoes() {
  const [vendas, setVendas] = useState<Venda[]>([]);
  const [loading, setLoading] = useState(true);
  const [feitas, setFeitas] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let active = true;
    (async () => {
      if (!supabase) { setLoading(false); return; }
      const limite = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
      const { data } = await supabase.from("vendas").select("id,cliente_nome,produto,seguradora,valor,vigencia_fim,status")
        .not("vigencia_fim", "is", null).neq("status", "cancelada").lte("vigencia_fim", limite).order("vigencia_fim", { ascending: true }).limit(1000);
      if (!active) return;
      setVendas(data || []); setLoading(false);
    })();
    return () => { active = false; };
  }, []);

  const { lista, v30, v60, vencidas } = useMemo(() => {
    const lista = vendas.map((v) => ({ ...v, dias: v.vigencia_fim ? diasAte(v.vigencia_fim) : 999 })).filter((v) => v.dias <= 90);
    return {
      lista,
      v30: lista.filter((v) => v.dias >= 0 && v.dias <= 30).length,
      v60: lista.filter((v) => v.dias > 30 && v.dias <= 60).length,
      vencidas: lista.filter((v) => v.dias < 0).length,
    };
  }, [vendas]);

  async function gerarTarefa(v: Venda & { dias: number }) {
    const prioridade = v.dias < 0 || v.dias <= 15 ? "alta" : v.dias <= 30 ? "media" : "baixa";
    const { error } = await criarTarefa({
      titulo: `Renovar apólice — ${v.cliente_nome || "cliente"} (${v.produto || "seguro"})`,
      descricao: `Vence em ${dateBR(v.vigencia_fim)}. Seguradora: ${v.seguradora || "—"}.`,
      cliente_nome: v.cliente_nome || undefined, status: "a_fazer", prioridade, modulo: "seguros",
    });
    if (error) { toast.error("Não foi possível criar a tarefa: " + error); return; }
    setFeitas((p) => ({ ...p, [v.id]: true }));
    toast.success("Tarefa de renovação criada no quadro!");
  }

  function DiasBadge({ d }: { d: number }) {
    if (d < 0) return <Badge tone="red">vencida há {Math.abs(d)}d</Badge>;
    if (d <= 15) return <Badge tone="red">{d}d</Badge>;
    if (d <= 30) return <Badge tone="amber">{d}d</Badge>;
    return <Badge tone="slate">{d}d</Badge>;
  }

  return (
    <>
      <PageHeader title="Renovações" subtitle="Apólices a vencer — não perca nenhuma retenção" icon={RefreshCcw} />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <KpiCard label="Vencendo em 30 dias" value={String(v30)} icon={Clock} accent="warning" />
        <KpiCard label="Vencendo em 31–60 dias" value={String(v60)} icon={RefreshCcw} accent="sky" />
        <KpiCard label="Já vencidas" value={String(vencidas)} icon={AlertTriangle} accent="danger" />
      </div>

      <Card pad={false}>
        {loading ? (
          <div className="p-12 text-center text-muted text-sm">Carregando…</div>
        ) : lista.length === 0 ? (
          <EmptyState icon={CheckCircle2} title="Nenhuma renovação no radar" hint="Apólices com vigência cadastrada que estejam a vencer (próximos 90 dias) aparecem aqui, com um clique para criar a tarefa de follow-up." />
        ) : (
          <div className="p-2">
            <Table head={<><Th>Cliente</Th><Th>Produto</Th><Th>Seguradora</Th><Th>Vencimento</Th><Th>Prazo</Th><Th right>Prêmio</Th><Th right>Ação</Th></>}>
              {lista.map((v) => (
                <Tr key={v.id}>
                  <Td>{v.cliente_nome || "—"}</Td>
                  <Td>{v.produto || "—"}</Td>
                  <Td>{v.seguradora || "—"}</Td>
                  <Td>{dateBR(v.vigencia_fim)}</Td>
                  <Td><DiasBadge d={v.dias} /></Td>
                  <Td right>{brl(v.valor)}</Td>
                  <Td right>
                    {feitas[v.id] ? (
                      <span className="text-[11px] font-bold text-green-600 inline-flex items-center gap-1"><CheckCircle2 size={13} /> tarefa criada</span>
                    ) : (
                      <button onClick={() => gerarTarefa(v)} className="inline-flex items-center gap-1.5 text-[11px] font-bold text-brand-600 bg-brand-50 hover:bg-brand-100 px-2.5 py-1.5 rounded-lg transition-colors">
                        <ListPlus size={13} /> Criar tarefa
                      </button>
                    )}
                  </Td>
                </Tr>
              ))}
            </Table>
          </div>
        )}
      </Card>
    </>
  );
}

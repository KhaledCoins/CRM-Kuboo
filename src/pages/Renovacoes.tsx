import { useEffect, useMemo, useState } from "react";
import { RefreshCcw, AlertTriangle, Clock, CheckCircle2, ListPlus, Layers } from "lucide-react";
import { toast } from "sonner";
import { Card, KpiCard, PageHeader, Table, Th, Td, Tr, EmptyState, Badge } from "../components/ui";
import { brl, dateBR } from "../lib/format";
import { supabase } from "../lib/supabase";
import { criarTarefa } from "../lib/tarefas";

// Radar de renovações: une DUAS fontes —
//  · vendas (registradas no CRM, vigencia_fim)
//  · apolices (portal do cliente / base migrada do Excel) — requer a migração
//    crm-portal-team.sql (equipe ler apolices). Sem ela, a fonte fica vazia
//    silenciosamente e o radar segue funcionando só com vendas.
interface ItemRenovacao {
  id: string;
  fonte: "venda" | "apolice";
  cliente: string;
  produto: string;
  seguradora: string;
  valor: number | null;
  vigencia_fim: string | null;
}
const diasAte = (s: string) => Math.ceil((new Date(s).getTime() - Date.now()) / 86400000);

export function Renovacoes() {
  const [itens, setItens] = useState<ItemRenovacao[]>([]);
  const [loading, setLoading] = useState(true);
  const [feitas, setFeitas] = useState<Record<string, boolean>>({});
  const [gerandoLote, setGerandoLote] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!supabase) { setLoading(false); return; }
      try {
      const limite = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);

      const [vendasR, apolicesR] = await Promise.all([
        supabase.from("vendas").select("id,cliente_nome,produto,seguradora,valor,vigencia_fim,status")
          .not("vigencia_fim", "is", null).neq("status", "cancelada").lte("vigencia_fim", limite)
          .order("vigencia_fim", { ascending: true }).limit(1000),
        supabase.from("apolices").select("id,tipo,seguradora,premio_anual,premio_mensal,vigencia_fim,status,profiles(name)")
          .not("vigencia_fim", "is", null).neq("status", "cancelada").lte("vigencia_fim", limite)
          .order("vigencia_fim", { ascending: true }).limit(1000),
      ]);
      if (!active) return;

      const deVendas: ItemRenovacao[] = (vendasR.data || []).map((v: any) => ({
        id: `v-${v.id}`, fonte: "venda", cliente: v.cliente_nome || "—",
        produto: v.produto || "—", seguradora: v.seguradora || "—",
        valor: v.valor, vigencia_fim: v.vigencia_fim,
      }));
      const deApolices: ItemRenovacao[] = (apolicesR.data || []).map((a: any) => ({
        id: `a-${a.id}`, fonte: "apolice", cliente: a.profiles?.name || "—",
        produto: a.tipo ? `Seguro ${a.tipo}` : "—", seguradora: a.seguradora || "—",
        valor: a.premio_anual ?? (a.premio_mensal ? a.premio_mensal * 12 : null), vigencia_fim: a.vigencia_fim,
      }));
      setItens([...deVendas, ...deApolices]);
      } catch (e) {
        console.error("[renovacoes]", e);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  const { lista, v30, v60, vencidas } = useMemo(() => {
    const lista = itens
      .map((v) => ({ ...v, dias: v.vigencia_fim ? diasAte(v.vigencia_fim) : 999 }))
      .filter((v) => v.dias <= 90)
      .sort((a, b) => a.dias - b.dias);
    return {
      lista,
      v30: lista.filter((v) => v.dias >= 0 && v.dias <= 30).length,
      v60: lista.filter((v) => v.dias > 30 && v.dias <= 60).length,
      vencidas: lista.filter((v) => v.dias < 0).length,
    };
  }, [itens]);

  async function gerarTarefa(v: ItemRenovacao & { dias: number }): Promise<boolean> {
    const prioridade = v.dias < 0 || v.dias <= 15 ? "alta" : v.dias <= 30 ? "media" : "baixa";
    const { error } = await criarTarefa({
      titulo: `Renovar apólice — ${v.cliente} (${v.produto})`,
      descricao: `Vence em ${dateBR(v.vigencia_fim)}. Seguradora: ${v.seguradora}.`,
      cliente_nome: v.cliente !== "—" ? v.cliente : undefined, status: "a_fazer", prioridade, modulo: "seguros",
    });
    if (error) return false;
    setFeitas((p) => ({ ...p, [v.id]: true }));
    return true;
  }

  async function gerarTarefaUi(v: ItemRenovacao & { dias: number }) {
    const ok = await gerarTarefa(v);
    if (ok) toast.success("Tarefa de renovação criada no quadro!");
    else toast.error("Não foi possível criar a tarefa.");
  }

  // Retenção em lote: cria tarefas pra tudo que vence em ≤30 dias (ou já venceu)
  async function gerarLote() {
    const alvo = lista.filter((v) => v.dias <= 30 && !feitas[v.id]);
    if (!alvo.length) { toast.info("Nada pendente vencendo em 30 dias."); return; }
    setGerandoLote(true);
    let ok = 0;
    for (const v of alvo) { if (await gerarTarefa(v)) ok++; }
    setGerandoLote(false);
    if (ok) toast.success(`${ok} tarefa${ok > 1 ? "s" : ""} de renovação criada${ok > 1 ? "s" : ""} no quadro!`);
    else toast.error("Não foi possível criar as tarefas.");
  }

  function DiasBadge({ d }: { d: number }) {
    if (d < 0) return <Badge tone="red">vencida há {Math.abs(d)}d</Badge>;
    if (d <= 15) return <Badge tone="red">{d}d</Badge>;
    if (d <= 30) return <Badge tone="amber">{d}d</Badge>;
    return <Badge tone="slate">{d}d</Badge>;
  }

  const pend30 = lista.filter((v) => v.dias <= 30 && !feitas[v.id]).length;

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
          <EmptyState icon={CheckCircle2} title="Nenhuma renovação no radar" hint="Apólices com vigência cadastrada (vendas do CRM ou base de clientes) que vencem nos próximos 90 dias aparecem aqui, com um clique para criar a tarefa de follow-up." />
        ) : (
          <div className="p-2">
            <div className="flex items-center justify-between px-3 pt-2 pb-1">
              <p className="text-xs text-muted">{lista.length} apólice{lista.length > 1 ? "s" : ""} no radar de 90 dias</p>
              <button
                onClick={gerarLote}
                disabled={gerandoLote || pend30 === 0}
                className="inline-flex items-center gap-1.5 text-[11px] font-bold text-brand-600 bg-brand-50 hover:bg-brand-100 disabled:opacity-50 disabled:cursor-not-allowed px-2.5 py-1.5 rounded-lg transition-colors"
              >
                <Layers size={13} /> {gerandoLote ? "Criando..." : `Tarefas p/ todas ≤30d (${pend30})`}
              </button>
            </div>
            <Table head={<><Th>Cliente</Th><Th>Produto</Th><Th>Seguradora</Th><Th>Fonte</Th><Th>Vencimento</Th><Th>Prazo</Th><Th right>Prêmio</Th><Th right>Ação</Th></>}>
              {lista.map((v) => (
                <Tr key={v.id}>
                  <Td>{v.cliente}</Td>
                  <Td>{v.produto}</Td>
                  <Td>{v.seguradora}</Td>
                  <Td><Badge tone={v.fonte === "apolice" ? "violet" : "blue"}>{v.fonte === "apolice" ? "Carteira" : "Venda CRM"}</Badge></Td>
                  <Td>{dateBR(v.vigencia_fim)}</Td>
                  <Td><DiasBadge d={v.dias} /></Td>
                  <Td right>{brl(v.valor)}</Td>
                  <Td right>
                    {feitas[v.id] ? (
                      <span className="text-[11px] font-bold text-green-600 inline-flex items-center gap-1"><CheckCircle2 size={13} /> tarefa criada</span>
                    ) : (
                      <button onClick={() => gerarTarefaUi(v)} className="inline-flex items-center gap-1.5 text-[11px] font-bold text-brand-600 bg-brand-50 hover:bg-brand-100 px-2.5 py-1.5 rounded-lg transition-colors">
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

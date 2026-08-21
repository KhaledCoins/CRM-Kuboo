import { useState } from "react";
import { Trophy, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "./ui";
import { ModalShell } from "./ModalShell";
import { useAuth } from "../context/AuthContext";
import { paraNumero } from "../lib/num";
import { brl, hojeLocal } from "../lib/format";
import { supabase } from "../lib/supabase";
import type { Lead } from "../lib/leads";
import { moduloDe } from "../lib/leads";

// ─── Lead → Venda em 1 clique ─────────────────────────────────────────────────
// Abre ao soltar um lead em "Fechado": registra a venda pré-preenchida e gera
// AUTOMATICAMENTE as N parcelas + a comissão do consultor (fim do retrabalho em 3 telas).
export function RegistrarVendaModal({
  lead, pessoas, onClose, onSaved,
}: { lead: Lead; pessoas: Record<string, string>; onClose: () => void; onSaved: () => void }) {
  const { user } = useAuth();
  // Data de nascimento da venda no fuso da operação. Venda fechada às 21h30
  // de 31/08 nascia com data 01/09: saía da produção de agosto, o consultor
  // perdia o batimento da meta e a comissão era liberada um mês depois.
  const hoje = hojeLocal();
  // A venda e a comissão são do DONO do lead — não de quem arrastou o card.
  // (Gestor movendo card de consultor na visão Equipe corrompia Produção/Ranking/comissão.)
  const donoId = lead.vendedor_id ?? user?.id ?? null;
  const donoNome = (lead.vendedor_id && pessoas[lead.vendedor_id]) || user?.name || "—";
  const [form, setForm] = useState({
    produto: lead.produto_interesse ?? "",
    seguradora: "",
    valor: lead.valor_potencial ? String(lead.valor_potencial) : "",
    parcelas: "1",
    comissao_pct: "15",
    data_venda: hoje,
  });
  const [salvando, setSalvando] = useState(false);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((p) => ({ ...p, [k]: e.target.value }));

  const valorNum = paraNumero(form.valor) ?? 0; // parser pt-BR: "2.400,00" → 2400 (não 2.4)
  const nParc = Math.max(1, parseInt(form.parcelas) || 1);
  const pct = paraNumero(form.comissao_pct) ?? 0;
  const comissaoValor = Math.round(valorNum * pct) / 100;

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase || !user) return;
    if (!form.produto.trim() || valorNum <= 0) { toast.error("Preencha produto e valor."); return; }
    setSalvando(true);
    let vendaId: string | null = null;
    try {
      const dv = new Date(form.data_venda + "T12:00:00");
      const vigFim = new Date(dv); vigFim.setFullYear(vigFim.getFullYear() + 1);

      // 1) Venda
      const { data: venda, error: e1 } = await supabase.from("vendas").insert({
        // De qual negócio é esta venda. Sem isto, a produção de Seguros era
        // creditada na meta de Consórcios (a tabela não tinha módulo e o card
        // somava tudo). Vem do lead que originou a venda.
        modulo: moduloDe(lead),
        data_venda: form.data_venda,
        cliente_nome: lead.nome,
        vendedor_id: donoId,
        vendedor_nome: donoNome,
        seguradora: form.seguradora.trim() || null,
        produto: form.produto.trim(),
        valor: valorNum,
        parcelas: nParc,
        comissao_pct: pct,
        comissao_valor: comissaoValor,
        tipo: "novo",
        status: "ativa",
        vigencia_inicio: form.data_venda,
        vigencia_fim: vigFim.toISOString().slice(0, 10),
        observacoes: `Origem: lead ${lead.nome}${lead.origem ? ` (${lead.origem})` : ""}`,
      }).select("id").single();
      if (e1 || !venda) throw e1 ?? new Error("sem id");
      vendaId = venda.id;

      // 2) Parcelas (última ajusta o arredondamento)
      const base = Math.floor((valorNum / nParc) * 100) / 100;
      const rows = Array.from({ length: nParc }, (_, i) => {
        const venc = new Date(dv); venc.setMonth(venc.getMonth() + i + 1);
        const valor = i === nParc - 1 ? Math.round((valorNum - base * (nParc - 1)) * 100) / 100 : base;
        return { venda_id: venda.id, numero: i + 1, valor, vencimento: venc.toISOString().slice(0, 10), status: "aberta" };
      });
      const { error: e2 } = await supabase.from("parcelas").insert(rows);
      if (e2) throw e2;

      // 3) Comissão do consultor
      const lib = new Date(dv); lib.setMonth(lib.getMonth() + 1);
      const { error: e3 } = await supabase.from("comissoes").insert({
        venda_id: venda.id, vendedor_id: donoId, valor: comissaoValor, pct,
        modulo: moduloDe(lead),
        liberacao: lib.toISOString().slice(0, 10), status: "a_pagar",
      });
      if (e3) throw e3;

      toast.success(`Venda registrada! ${nParc} parcela(s) e comissão de ${brl(comissaoValor)} geradas automaticamente.`);
      onSaved();
    } catch {
      // Sem transação no PostgREST: se falhou depois de criar a venda, tenta
      // desfazer (parcelas caem por ON DELETE CASCADE). Mas o rollback PRECISA
      // ser conferido: a policy vendas_del exige gestor ou 'acessar_financeiro',
      // então pro vendedor o DELETE devolve zero linhas SEM erro — e a venda
      // fica no banco. Afirmar "Nada foi salvo — tente novamente" nesse caso é
      // a receita da DUPLICATA: ele tenta de novo e a Produção conta 2x.
      let desfez = false;
      if (vendaId) {
        try {
          const { data: apagadas } = await supabase.from("vendas").delete().eq("id", vendaId).select("id");
          desfez = !!(apagadas && apagadas.length);
        } catch { /* rede caiu de novo — trata como não desfeito */ }
      }
      if (!vendaId || desfez) {
        toast.error("Não foi possível registrar a venda. Nada foi salvo — tente novamente.");
      } else {
        toast.error(
          "A venda foi criada, mas as parcelas/comissão falharam. NÃO registre de novo — avise um gestor para completar ou excluir o lançamento.",
          { duration: 15000 }
        );
      }
    }
    setSalvando(false);
  }

  const inputCls = "w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-ink outline-none focus:border-brand-400";
  const lblCls = "block text-xs font-bold text-slate-600 mb-1.5";

  return (
    <ModalShell
      onClose={onClose}
      label="Registrar venda"
      backdropClassName="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto"
    >
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-xl bg-green-50 text-green-600 grid place-items-center"><Trophy size={20} /></span>
            <div>
              <h3 className="font-bold text-ink">Fechou! Registrar a venda</h3>
              <p className="text-xs text-muted">{lead.nome} · venda de <strong>{donoNome}</strong> · parcelas e comissão automáticas</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Fechar" className="text-slate-500 hover:text-slate-700 p-1"><X size={18} /></button>
        </div>
        <form onSubmit={salvar} className="px-5 pb-5 grid gap-3">
          <div>
            <label className={lblCls}>Produto *</label>
            <input className={inputCls} value={form.produto} onChange={set("produto")} placeholder="Seguro Auto" required />
          </div>
          <div>
            <label className={lblCls}>Seguradora / Administradora</label>
            <input className={inputCls} value={form.seguradora} onChange={set("seguradora")} placeholder="Porto Seguro" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={lblCls}>Valor total (R$) *</label>
              <input className={inputCls} value={form.valor} onChange={set("valor")} placeholder="2400" inputMode="decimal" required />
            </div>
            <div>
              <label className={lblCls}>Parcelas</label>
              <input className={inputCls} value={form.parcelas} onChange={set("parcelas")} inputMode="numeric" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={lblCls}>Comissão (%)</label>
              <input className={inputCls} value={form.comissao_pct} onChange={set("comissao_pct")} inputMode="decimal" />
            </div>
            <div>
              <label className={lblCls}>Data da venda</label>
              <input type="date" className={inputCls} value={form.data_venda} onChange={set("data_venda")} />
            </div>
          </div>
          {valorNum > 0 && (
            <div className="rounded-xl bg-brand-50 border border-brand-100 px-3.5 py-2.5 text-xs text-brand-700 font-semibold">
              {nParc}x de {brl(Math.round((valorNum / nParc) * 100) / 100)} · comissão {brl(comissaoValor)} ({pct}%)
            </div>
          )}
          <div className="flex gap-2 justify-end pt-1">
            <Button type="button" variant="ghost" onClick={onClose}>Agora não</Button>
            <Button type="submit" disabled={salvando}>{salvando ? "Registrando…" : "Registrar venda"}</Button>
          </div>
        </form>
    </ModalShell>
  );
}

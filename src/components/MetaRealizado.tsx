import { useEffect, useState } from "react";
import { Target, TrendingUp, AlertTriangle, PartyPopper, CalendarClock } from "lucide-react";
import { Card, EmptyState } from "./ui";
import { supabase } from "../lib/supabase";
import { brl, brlShort } from "../lib/format";
import type { Modulo } from "../lib/nav";

// ─── Meta × Realizado ────────────────────────────────────────────────────────
// A tela de Metas só cadastrava o número — nada no CRM comparava a meta com a
// produção real, que é justamente a pergunta do gestor ("estamos no ritmo?").
// Este card cruza `metas` (escopo corretora + individual) com `vendas` do mês:
// % atingido, quanto falta e o ritmo necessário por dia útil restante.

interface Meta { id: string; escopo: string | null; vendedor_id: string | null; mes: string | null; valor_meta: number | null; modulo: string | null }
interface VendaMin { valor: number | null; vendedor_id: string | null; vendedor_nome: string | null }

const inicioDoMes = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`; };

/** Dias úteis (seg-sex) restantes no mês, contando hoje. Base honesta pro
 *  "ritmo necessário": ninguém vende no domingo.
 *  Exportada para teste (src/lib/__tests__/metaRealizado.test.ts). */
export function diasUteisRestantes(ref: Date = new Date()): number {
  const ultimo = new Date(ref.getFullYear(), ref.getMonth() + 1, 0).getDate();
  let n = 0;
  for (let d = ref.getDate(); d <= ultimo; d++) {
    const dia = new Date(ref.getFullYear(), ref.getMonth(), d).getDay();
    if (dia !== 0 && dia !== 6) n++;
  }
  return Math.max(1, n);
}

function Barra({ pct, cor }: { pct: number; cor: string }) {
  return (
    <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.min(100, pct)}%`, background: cor }} />
    </div>
  );
}

// Verde quando bate, âmbar quando está perto, vermelho quando está longe do
// ritmo esperado pra altura do mês (não é "abaixo de 100% = vermelho", senão
// o card ficaria vermelho todo dia 2).
export function corDoProgresso(pct: number, pctEsperado: number): string {
  if (pct >= 100) return "#16A34A";
  // Começo de mês (< 20% decorrido) é sempre neutro: nada de barra vermelha no
  // dia 2 só porque a primeira venda ainda não entrou.
  if (pctEsperado < 20) return "#36ABE2";
  if (pct >= pctEsperado * 0.8) return "#F59E0B";
  return "#EF4444";
}

export function MetaRealizadoCard({ modulo }: { modulo: Modulo }) {
  const [metas, setMetas] = useState<Meta[]>([]);
  const [vendas, setVendas] = useState<VendaMin[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [semTabela, setSemTabela] = useState(false);
  const [nomes, setNomes] = useState<Record<string, string>>({});

  useEffect(() => {
    let vivo = true;
    (async () => {
      if (!supabase) { setCarregando(false); return; }
      const ini = inicioDoMes();
      const [mRes, vRes, pRes] = await Promise.all([
        supabase.from("metas").select("id,escopo,vendedor_id,mes,valor_meta,modulo").gte("mes", ini).limit(200),
        supabase.from("vendas").select("valor,vendedor_id,vendedor_nome").gte("data_venda", ini).limit(3000),
        supabase.from("profiles").select("id,name").in("role", ["admin", "gestor", "vendedor"]).limit(100),
      ]);
      if (!vivo) return;
      if (mRes.error) { setSemTabela(true); setCarregando(false); return; }
      setMetas((mRes.data as Meta[]) ?? []);
      setVendas((vRes.data as VendaMin[]) ?? []);
      const mapa: Record<string, string> = {};
      ((pRes.data as { id: string; name: string }[]) ?? []).forEach((p) => { mapa[p.id] = p.name; });
      setNomes(mapa);
      setCarregando(false);
    })();
    return () => { vivo = false; };
  }, []);

  if (carregando || semTabela) return null;

  const doModulo = metas.filter((m) => !m.modulo || m.modulo === modulo);
  if (doModulo.length === 0) {
    return (
      <Card pad={false} className="mb-6">
        <EmptyState icon={Target} title="Nenhuma meta definida para este mês"
          hint="Defina a meta da corretora (e de cada consultor) em Metas & Performance para acompanhar aqui o quanto já foi realizado." />
      </Card>
    );
  }

  const hoje = new Date();
  const totalDias = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).getDate();
  const pctEsperado = (hoje.getDate() / totalDias) * 100; // quanto "deveria" estar
  const uteis = diasUteisRestantes();

  const metaCorretora = doModulo.find((m) => m.escopo === "corretora");
  const individuais = doModulo.filter((m) => m.escopo === "individual" && m.vendedor_id);
  const realizadoTotal = vendas.reduce((s, v) => s + (Number(v.valor) || 0), 0);

  const linhaIndividual = individuais.map((m) => {
    const feito = vendas
      .filter((v) => v.vendedor_id === m.vendedor_id || (!v.vendedor_id && v.vendedor_nome === nomes[m.vendedor_id!]))
      .reduce((s, v) => s + (Number(v.valor) || 0), 0);
    const alvo = Number(m.valor_meta) || 0;
    return { id: m.id, nome: nomes[m.vendedor_id!] ?? "—", alvo, feito, pct: alvo ? (feito / alvo) * 100 : 0 };
  }).sort((a, b) => b.pct - a.pct);

  const alvoGeral = Number(metaCorretora?.valor_meta) || 0;
  const pctGeral = alvoGeral ? (realizadoTotal / alvoGeral) * 100 : 0;
  const falta = Math.max(0, alvoGeral - realizadoTotal);

  return (
    <Card className="mb-6">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <h3 className="font-bold text-ink flex items-center gap-2">
          <Target size={17} className="text-brand-500" /> Meta × Realizado
          <span className="text-xs font-normal text-muted">
            {hoje.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}
          </span>
        </h3>
        {alvoGeral > 0 && (
          <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${pctGeral >= 100 ? "bg-green-100 text-green-700" : pctEsperado < 20 ? "bg-brand-100 text-brand-700" : pctGeral >= pctEsperado * 0.8 ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"}`}>
            {pctGeral >= 100 ? <><PartyPopper size={11} className="inline mr-1" />Meta batida</> : `${pctGeral.toFixed(0)}% da meta`}
          </span>
        )}
      </div>

      {alvoGeral > 0 ? (
        <>
          <div className="flex items-end justify-between gap-3 mb-1.5 flex-wrap">
            <div>
              <p className="text-3xl font-display text-ink leading-none">{brl(realizadoTotal)}</p>
              <p className="text-xs text-muted mt-1">de {brl(alvoGeral)} · meta da corretora</p>
            </div>
            {pctGeral < 100 && (
              <div className="text-right">
                <p className="text-sm font-bold text-ink flex items-center gap-1 justify-end">
                  <CalendarClock size={13} className="text-brand-500" /> {brlShort(falta / uteis)}/dia
                </p>
                <p className="text-xs text-muted">para bater em {uteis} dia{uteis === 1 ? "" : "s"} útil{uteis === 1 ? "" : "eis"}</p>
              </div>
            )}
          </div>
          <Barra pct={pctGeral} cor={corDoProgresso(pctGeral, pctEsperado)} />
          <div className="flex justify-between text-[11px] text-muted mt-1.5">
            <span>{pctGeral >= 100 ? "Meta atingida" : `Faltam ${brl(falta)}`}</span>
            <span>Ritmo esperado hoje: {pctEsperado.toFixed(0)}%</span>
          </div>
          {/* Só alarma depois de ~1/5 do mês: no dia 2, com 0 vendas, um alerta
              vermelho seria tecnicamente correto e completamente inútil. */}
          {pctEsperado >= 20 && pctGeral < pctEsperado * 0.8 && (
            <p className="mt-3 text-xs font-semibold text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2 flex items-center gap-1.5">
              <AlertTriangle size={13} className="shrink-0" /> Abaixo do ritmo para a altura do mês.
            </p>
          )}
        </>
      ) : (
        <p className="text-sm text-muted">Meta da corretora não definida para este mês — cadastre em Metas &amp; Performance.</p>
      )}

      {linhaIndividual.length > 0 && (
        <div className="mt-5 border-t border-slate-100 pt-4">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3 flex items-center gap-1.5">
            <TrendingUp size={12} /> Por consultor
          </p>
          <div className="space-y-3">
            {linhaIndividual.map((l) => (
              <div key={l.id}>
                <div className="flex justify-between text-sm mb-1 gap-2">
                  <span className="text-ink font-medium truncate">{l.nome}</span>
                  <span className="text-muted shrink-0 tabular-nums">
                    {brlShort(l.feito)} / {brlShort(l.alvo)} · <strong className="text-ink">{l.pct.toFixed(0)}%</strong>
                  </span>
                </div>
                <Barra pct={l.pct} cor={corDoProgresso(l.pct, pctEsperado)} />
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

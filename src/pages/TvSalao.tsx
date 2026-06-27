import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Zap, TrendingUp, Target, Settings, Trophy } from "lucide-react";
import { supabase } from "../lib/supabase";
import { brl } from "../lib/format";

interface Venda { valor: number | null; data_venda: string | null; vendedor_nome: string | null; }

const todayISO = () => new Date().toISOString().slice(0, 10);
const monthPrefix = () => new Date().toISOString().slice(0, 7); // YYYY-MM

export function TvSalao() {
  const navigate = useNavigate();
  const [now, setNow] = useState(new Date());
  const [vendas, setVendas] = useState<Venda[]>([]);
  const [meta, setMeta] = useState<number>(100000);

  // Relógio ao vivo
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Carrega dados (e atualiza a cada 60s — é uma TV)
  useEffect(() => {
    let active = true;
    async function load() {
      if (!supabase) return;
      const [{ data: vs }, { data: ms }] = await Promise.all([
        supabase.from("vendas").select("valor,data_venda,vendedor_nome").gte("data_venda", monthPrefix() + "-01").limit(2000),
        supabase.from("metas").select("valor_meta,escopo,mes").eq("escopo", "corretora").gte("mes", monthPrefix() + "-01").limit(10),
      ]);
      if (!active) return;
      setVendas(vs || []);
      if (ms && ms.length) setMeta(Number(ms[0].valor_meta) || 100000);
    }
    load();
    const t = setInterval(load, 60000);
    return () => { active = false; clearInterval(t); };
  }, []);

  const { prodDia, prodMes, nDia, nMes, ranking } = useMemo(() => {
    const hoje = todayISO();
    let pd = 0, pm = 0, nd = 0, nm = 0;
    const byVend: Record<string, { total: number; n: number }> = {};
    for (const v of vendas) {
      const val = Number(v.valor) || 0;
      pm += val; nm += 1;
      if ((v.data_venda || "").slice(0, 10) === hoje) { pd += val; nd += 1; }
      const nome = v.vendedor_nome || "Sem vendedor";
      byVend[nome] = byVend[nome] || { total: 0, n: 0 };
      byVend[nome].total += val; byVend[nome].n += 1;
    }
    const ranking = Object.entries(byVend).map(([nome, d]) => ({ nome, ...d })).sort((a, b) => b.total - a.total).slice(0, 8);
    return { prodDia: pd, prodMes: pm, nDia: nd, nMes: nm, ranking };
  }, [vendas]);

  const pctMeta = meta > 0 ? Math.min(100, (prodMes / meta) * 100) : 0;
  const falta = Math.max(0, meta - prodMes);

  const dataFmt = now.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const horaFmt = now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  const medal = ["🥇", "🥈", "🥉"];

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 60, background: "linear-gradient(135deg, #0A1628 0%, #0D2137 60%, #0A1A2E 100%)", overflowY: "auto", padding: "28px 32px", fontFamily: "'Inter', system-ui, sans-serif" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 28 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <button onClick={() => navigate(-1)} style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.8)", width: 40, height: 40, borderRadius: 12, cursor: "pointer", display: "grid", placeItems: "center" }}>
            <ArrowLeft size={20} />
          </button>
          <div style={{ width: 56, height: 56, borderRadius: 16, background: "linear-gradient(135deg, #2DD4A7, #1AA37E)", display: "grid", placeItems: "center", boxShadow: "0 10px 30px rgba(45,212,167,0.35)" }}>
            <TrendingUp size={28} color="white" />
          </div>
          <div>
            <h1 style={{ color: "white", fontSize: 34, fontWeight: 800, margin: 0, letterSpacing: -0.5 }}>TV do Salão de Vendas</h1>
            <p style={{ color: "rgba(255,255,255,0.5)", fontSize: 15, margin: "2px 0 0" }}>Atualização em tempo real</p>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <p style={{ color: "rgba(255,255,255,0.5)", fontSize: 15, margin: 0, textTransform: "capitalize" }}>{dataFmt}</p>
          <p style={{ color: "#2DD4A7", fontSize: 40, fontWeight: 800, margin: 0, lineHeight: 1.1, fontVariantNumeric: "tabular-nums" }}>{horaFmt}</p>
        </div>
      </div>

      {/* KPI cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 20, marginBottom: 36 }}>
        <TvCard icon={<Zap size={22} color="#5BA9F0" />} iconBg="rgba(54,138,221,0.18)" label="Produção do Dia">
          <p style={{ color: "#5BA9F0", fontSize: 46, fontWeight: 800, margin: 0, lineHeight: 1 }}>{brl(prodDia)}</p>
          <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 15, margin: "8px 0 0" }}>{nDia} venda{nDia === 1 ? "" : "s"}</p>
        </TvCard>

        <TvCard icon={<TrendingUp size={22} color="#2DD4A7" />} iconBg="rgba(45,212,167,0.18)" label="Produção do Mês">
          <p style={{ color: "#2DD4A7", fontSize: 46, fontWeight: 800, margin: 0, lineHeight: 1 }}>{brl(prodMes)}</p>
          <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 15, margin: "8px 0 0" }}>{nMes} venda{nMes === 1 ? "" : "s"}</p>
        </TvCard>

        <TvCard icon={<Target size={22} color="#F5B53D" />} iconBg="rgba(245,181,61,0.18)" label="Meta Mensal"
          action={<button onClick={() => navigate("/seguros/metas")} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.35)", cursor: "pointer" }}><Settings size={18} /></button>}>
          {falta > 0 ? (
            <p style={{ color: "#F5B53D", fontSize: 38, fontWeight: 800, margin: 0, lineHeight: 1 }}>Falta: {brl(falta)}</p>
          ) : (
            <p style={{ color: "#2DD4A7", fontSize: 38, fontWeight: 800, margin: 0, lineHeight: 1 }}>Meta batida! 🎉</p>
          )}
          <div style={{ marginTop: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "rgba(255,255,255,0.5)", marginBottom: 6 }}>
              <span>{pctMeta.toFixed(1)}%</span>
              <span>Meta: {brl(meta)}</span>
            </div>
            <div style={{ height: 8, background: "rgba(255,255,255,0.1)", borderRadius: 6, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${pctMeta}%`, background: "linear-gradient(90deg, #F5B53D, #FBD24E)", borderRadius: 6, transition: "width 0.6s" }} />
            </div>
          </div>
        </TvCard>
      </div>

      {/* Ranking */}
      <div>
        <h2 style={{ color: "white", fontSize: 26, fontWeight: 800, margin: "0 0 18px", display: "flex", alignItems: "center", gap: 10 }}>
          <Trophy size={26} color="#F5B53D" /> Ranking do Mês
        </h2>
        {ranking.length === 0 ? (
          <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 16 }}>Nenhuma venda registrada neste mês.</p>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {ranking.map((r, i) => (
              <div key={r.nome} style={{ display: "flex", alignItems: "center", gap: 16, background: i === 0 ? "rgba(245,181,61,0.1)" : "rgba(255,255,255,0.04)", border: `1px solid ${i === 0 ? "rgba(245,181,61,0.3)" : "rgba(255,255,255,0.08)"}`, borderRadius: 16, padding: "16px 20px" }}>
                <div style={{ fontSize: 24, width: 40, textAlign: "center", fontWeight: 800, color: "rgba(255,255,255,0.6)" }}>{medal[i] || i + 1}</div>
                <div style={{ flex: 1 }}>
                  <p style={{ color: "white", fontSize: 18, fontWeight: 700, margin: 0 }}>{r.nome}</p>
                  <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 13, margin: "2px 0 0" }}>{r.n} venda{r.n === 1 ? "" : "s"}</p>
                </div>
                <p style={{ color: i === 0 ? "#F5B53D" : "#2DD4A7", fontSize: 24, fontWeight: 800, margin: 0 }}>{brl(r.total)}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TvCard({ icon, iconBg, label, children, action }: { icon: React.ReactNode; iconBg: string; label: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div style={{ background: "rgba(255,255,255,0.035)", border: "1px solid rgba(255,255,255,0.09)", borderRadius: 20, padding: "22px 24px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 38, height: 38, borderRadius: 11, background: iconBg, display: "grid", placeItems: "center" }}>{icon}</div>
          <span style={{ color: "rgba(255,255,255,0.85)", fontSize: 16, fontWeight: 600 }}>{label}</span>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

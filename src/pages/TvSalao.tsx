import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Zap, TrendingUp, Target, Settings, Trophy, Crown, Medal, PartyPopper } from "lucide-react";
import { supabase } from "../lib/supabase";
import { brl } from "../lib/format";

interface Venda { id?: string; valor: number | null; data_venda: string | null; vendedor_nome: string | null; produto?: string | null; created_at?: string | null; }

const todayISO = () => new Date().toISOString().slice(0, 10);
const monthPrefix = () => new Date().toISOString().slice(0, 7); // YYYY-MM

export function TvSalao() {
  const navigate = useNavigate();
  const [now, setNow] = useState(new Date());
  const [vendas, setVendas] = useState<Venda[]>([]);
  const [meta, setMeta] = useState<number>(100000);
  // Celebração: venda nova detectada desde o último poll
  const [celebra, setCelebra] = useState<Venda | null>(null);
  const baselineRef = useRef<string | null>(null); // created_at mais recente conhecido

  // Relógio ao vivo
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Carrega dados (poll 20s — TV precisa reagir rápido a venda nova)
  useEffect(() => {
    let active = true;
    async function load() {
      if (!supabase) return;
      try {
      const [{ data: vs }, { data: ms }] = await Promise.all([
        supabase.from("vendas").select("id,valor,data_venda,vendedor_nome,produto,created_at").gte("data_venda", monthPrefix() + "-01").order("created_at", { ascending: false }).limit(2000),
        supabase.from("metas").select("valor_meta,escopo,mes").eq("escopo", "corretora").gte("mes", monthPrefix() + "-01").order("mes", { ascending: false }).limit(10),
      ]);
      if (!active) return;
      const lista = vs || [];
      setVendas(lista);
      if (ms && ms.length) setMeta(Number(ms[0].valor_meta) || 100000);

      // 🏆 detecção de venda NOVA → celebração em tela cheia
      const maisNova = lista[0]?.created_at ?? null;
      if (baselineRef.current === null) {
        baselineRef.current = maisNova; // primeira carga: só estabelece a linha de base
      } else if (maisNova && maisNova > baselineRef.current) {
        baselineRef.current = maisNova;
        setCelebra(lista[0]);
        setTimeout(() => setCelebra(null), 12000);
      }
      } catch (e) {
        console.error("[tv-salao]", e); // não deixa a promise do poll rejeitar sem tratamento
      }
    }
    load();
    const t = setInterval(load, 20000);
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

  const posIcon = (i: number) =>
    i === 0 ? <Crown size={26} color="#F5B53D" fill="#F5B53D" />
    : i === 1 ? <Medal size={24} color="#C0C7D1" />
    : i === 2 ? <Medal size={24} color="#C98A4B" />
    : <span style={{ fontWeight: 800, color: "rgba(255,255,255,0.5)", fontSize: 20 }}>{i + 1}</span>;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 60, background: "linear-gradient(135deg, #0A1628 0%, #0D2137 60%, #0A1A2E 100%)", overflowY: "auto", padding: "28px 32px", fontFamily: "'Inter', system-ui, sans-serif" }}>
      <style>{`
        @keyframes tv-cube-fall { 0% { transform: translateY(-8vh) rotate(0deg); opacity: 1; } 100% { transform: translateY(110vh) rotate(540deg); opacity: 0.6; } }
        @keyframes tv-pop { 0% { transform: scale(0.6); opacity: 0; } 60% { transform: scale(1.06); } 100% { transform: scale(1); opacity: 1; } }
        @keyframes tv-crown { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
        @keyframes tv-row-in { from { opacity: 0; transform: translateX(-14px); } to { opacity: 1; transform: translateX(0); } }
        .tv-row { animation: tv-row-in 0.4s ease both; transition: background 0.4s, border-color 0.4s; }
        .tv-crown { animation: tv-crown 2.2s ease-in-out infinite; display: inline-flex; }
      `}</style>

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
            <p style={{ color: "#2DD4A7", fontSize: 38, fontWeight: 800, margin: 0, lineHeight: 1, display: "flex", alignItems: "center", gap: 10 }}>Meta batida! <PartyPopper size={30} /></p>
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
              <div key={r.nome} className="tv-row" style={{ animationDelay: `${i * 0.06}s`, display: "flex", alignItems: "center", gap: 16, background: i === 0 ? "rgba(245,181,61,0.1)" : "rgba(255,255,255,0.04)", border: `1px solid ${i === 0 ? "rgba(245,181,61,0.3)" : "rgba(255,255,255,0.08)"}`, borderRadius: 16, padding: "16px 20px" }}>
                <div style={{ width: 40, textAlign: "center", display: "grid", placeItems: "center" }} className={i === 0 ? "tv-crown" : undefined}>{posIcon(i)}</div>
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

      {/* 🏆 CELEBRAÇÃO DE VENDA — overlay em tela cheia com chuva de cubos Kuboo */}
      {celebra && (
        <div style={{ position: "fixed", inset: 0, zIndex: 80, background: "rgba(6,20,38,0.88)", backdropFilter: "blur(6px)", display: "grid", placeItems: "center", overflow: "hidden" }}>
          {/* chuva de cubos (identidade Kuboo) */}
          {Array.from({ length: 26 }).map((_, i) => (
            <span key={i} aria-hidden style={{
              position: "absolute", top: 0, left: `${(i * 37) % 100}%`,
              width: 10 + (i % 4) * 6, height: 10 + (i % 4) * 6, borderRadius: 3,
              background: ["#5BC4F5", "#F5B53D", "#2DD4A7", "#368ADD"][i % 4],
              animation: `tv-cube-fall ${2.6 + (i % 5) * 0.5}s linear ${(i % 8) * 0.35}s infinite`,
            }} />
          ))}
          <div style={{ textAlign: "center", animation: "tv-pop 0.6s cubic-bezier(0.34,1.56,0.64,1) both", padding: 24 }}>
            <div style={{ width: 110, height: 110, borderRadius: 30, margin: "0 auto 22px", background: "linear-gradient(135deg,#F5B53D,#E89B12)", display: "grid", placeItems: "center", boxShadow: "0 20px 60px rgba(245,181,61,0.45)" }}>
              <Trophy size={58} color="white" />
            </div>
            <p style={{ color: "#F5B53D", fontSize: 26, fontWeight: 800, letterSpacing: 6, margin: 0 }}>VENDA FECHADA!</p>
            <h2 style={{ color: "white", fontSize: 64, fontWeight: 800, margin: "10px 0 6px", lineHeight: 1.05 }}>{celebra.vendedor_nome || "Equipe Kuboo"}</h2>
            <p style={{ color: "rgba(255,255,255,0.75)", fontSize: 26, margin: 0 }}>
              {celebra.produto || "Nova venda"}{celebra.valor ? <> · <strong style={{ color: "#2DD4A7" }}>{brl(Number(celebra.valor))}</strong></> : null}
            </p>
          </div>
        </div>
      )}
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

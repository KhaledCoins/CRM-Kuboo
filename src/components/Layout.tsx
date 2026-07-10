import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { LogOut, Moon, Sun, Bell, X } from "lucide-react";
import { temaAtual, alternarTema } from "../lib/theme";
import { NAV, type Modulo } from "../lib/nav";
import { useAuth } from "../context/AuthContext";
import { initials } from "../lib/format";
import { fetchLeads, noBolsao, moduloDe } from "../lib/leads";
import { fetchAvisos, type Aviso } from "../lib/avisos";

export function Layout() {
  const { user, logout } = useAuth();
  const loc = useLocation();
  const nav = useNavigate();
  const [tema, setTema] = useState<"light" | "dark">(temaAtual());
  const modulo: Modulo = loc.pathname.startsWith("/consorcios") ? "consorcios" : "seguros";
  const groups = NAV[modulo];
  const role = user?.role ?? "vendedor";
  const [bolsaoCount, setBolsaoCount] = useState(0);
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const [avisosAbertos, setAvisosAbertos] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const [leads, avs] = await Promise.all([fetchLeads(), fetchAvisos(modulo)]);
        if (!active) return;
        setBolsaoCount(leads.filter((l) => moduloDe(l) === modulo && noBolsao(l)).length);
        setAvisos(avs);
      } catch (e) {
        // falha de rede não pode travar o chrome global (sino/bolsão) — só loga
        console.error("[layout] avisos/bolsão:", e);
      }
    }
    load();
    const t = setInterval(load, 60000); // recarrega sozinho; não depende de trocar de rota
    return () => { active = false; clearInterval(t); };
  }, [modulo]);

  const switchModulo = (m: Modulo) => nav(`/${m}`);

  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <aside
        className="w-[var(--sidebar-w)] shrink-0 text-white flex flex-col fixed inset-y-0 left-0 z-30"
        style={{ background: "linear-gradient(180deg, #0A1628 0%, #0D2A4A 60%, #0D4F8A 100%)" }}
      >
        {/* Brand — símbolo oficial da marca (render 3D de alta qualidade) */}
        <div className="px-5 py-4 flex items-center gap-2.5 border-b border-white/10">
          <img src="/kuboo-symbol-3d.png" alt="Kuboo" className="h-9 w-auto" draggable={false} />
          <div>
            <p className="font-display text-lg leading-none tracking-wide">KUBOO</p>
            <p className="text-[11px] text-white/55">CRM de Gestão</p>
          </div>
        </div>

        {/* Module toggle */}
        <div className="px-3 pt-3">
          <div className="grid grid-cols-2 gap-1 bg-white/8 rounded-xl p-1">
            {(["seguros", "consorcios"] as Modulo[]).map((m) => (
              <button
                key={m}
                onClick={() => switchModulo(m)}
                className={`text-xs font-bold py-1.5 rounded-lg transition-colors ${
                  modulo === m ? "bg-brand-500 text-white shadow" : "text-white/70 hover:text-white"
                }`}
              >
                {m === "seguros" ? "Seguros" : "Consórcios"}
              </button>
            ))}
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
          {groups.map((g) => (
            <div key={g.title}>
              <p className="text-[10px] uppercase tracking-wider text-white/40 font-bold px-2 mb-1.5">{g.title}</p>
              <div className="space-y-0.5">
                {g.items
                  .filter((it) => !it.roles || it.roles.includes(role))
                  .map((it) => (
                    <NavLink
                      key={it.to}
                      to={it.to}
                      end={it.to === `/${modulo}`}
                      className={({ isActive }) =>
                        `flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] transition-colors ${
                          isActive ? "bg-white/15 text-white font-bold" : "text-white/65 hover:bg-white/8 hover:text-white"
                        }`
                      }
                    >
                      <it.icon size={17} className="shrink-0" />
                      <span className="truncate flex-1">{it.label}</span>
                      {it.to.endsWith("/bolsao") && bolsaoCount > 0 && (
                        <span className="shrink-0 text-[10px] font-extrabold bg-red-500 text-white rounded-full min-w-[18px] h-[18px] px-1 grid place-items-center animate-pulse">{bolsaoCount}</span>
                      )}
                    </NavLink>
                  ))}
              </div>
            </div>
          ))}
        </nav>

        {/* User */}
        <div className="border-t border-white/10 px-3 py-3 flex items-center gap-2.5">
          <span className="w-9 h-9 rounded-full bg-brand-500 grid place-items-center text-xs font-bold shrink-0">
            {initials(user?.name)}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold truncate">{user?.name ?? "Equipe"}</p>
            <p className="text-[11px] text-white/50 capitalize">{user?.role ?? ""}</p>
          </div>
          <button
            onClick={() => setAvisosAbertos((v) => !v)}
            title="Avisos da equipe"
            className="relative text-white/60 hover:text-white p-1.5 rounded-lg hover:bg-white/10"
          >
            <Bell size={17} />
            {avisos.length > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-0.5 rounded-full bg-red-500 text-white text-[9px] font-extrabold grid place-items-center">{avisos.length}</span>
            )}
          </button>
          <button
            onClick={() => setTema(alternarTema())}
            title={tema === "dark" ? "Modo claro" : "Modo escuro"}
            className="text-white/60 hover:text-white p-1.5 rounded-lg hover:bg-white/10"
          >
            {tema === "dark" ? <Sun size={17} /> : <Moon size={17} />}
          </button>
          <button onClick={logout} title="Sair" className="text-white/60 hover:text-white p-1.5 rounded-lg hover:bg-white/10">
            <LogOut size={17} />
          </button>
        </div>
      </aside>

      {/* Painel de avisos (SLA + renovações) — computado no cliente, sem cron */}
      {avisosAbertos && (
        <div className="fixed left-[calc(var(--sidebar-w)+12px)] bottom-4 z-50 w-[340px] max-w-[calc(100vw-var(--sidebar-w)-24px)] bg-white rounded-2xl shadow-2xl border border-slate-100 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <p className="font-extrabold text-ink text-sm flex items-center gap-2"><Bell size={15} className="text-brand-500" /> Avisos da equipe</p>
            <button onClick={() => setAvisosAbertos(false)} aria-label="Fechar avisos" className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
          </div>
          <div className="max-h-[50vh] overflow-y-auto">
            {avisos.length === 0 ? (
              <p className="text-xs text-muted text-center py-8 px-4">Tudo em dia — nenhum SLA estourando nem renovação nesta semana.</p>
            ) : (
              avisos.map((a) => (
                <button
                  key={a.id}
                  onClick={() => { setAvisosAbertos(false); nav(a.to); }}
                  className="w-full text-left px-4 py-2.5 hover:bg-slate-50 transition-colors border-b border-slate-50 last:border-0"
                >
                  <span className="flex items-start gap-2">
                    <span className={`mt-1 w-2 h-2 rounded-full shrink-0 ${a.tone === "red" ? "bg-red-500" : a.tone === "amber" ? "bg-amber-500" : "bg-brand-400"}`} />
                    <span className="min-w-0">
                      <span className="block text-[13px] font-bold text-ink leading-tight">{a.titulo}</span>
                      <span className="block text-[11px] text-muted mt-0.5">{a.detalhe}</span>
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {/* Content */}
      <main className="flex-1 ml-[var(--sidebar-w)] min-w-0">
        <div className="max-w-[1400px] mx-auto px-6 py-6 kuboo-fade" key={loc.pathname}>
          <Outlet />
        </div>
      </main>
    </div>
  );
}

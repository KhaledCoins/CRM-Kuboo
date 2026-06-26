import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { LogOut, ShieldCheck } from "lucide-react";
import { NAV, type Modulo } from "../lib/nav";
import { useAuth } from "../context/AuthContext";
import { initials } from "../lib/format";

export function Layout() {
  const { user, logout } = useAuth();
  const loc = useLocation();
  const nav = useNavigate();
  const modulo: Modulo = loc.pathname.startsWith("/consorcios") ? "consorcios" : "seguros";
  const groups = NAV[modulo];
  const role = user?.role ?? "vendedor";

  const switchModulo = (m: Modulo) => nav(`/${m}`);

  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <aside
        className="w-[var(--sidebar-w)] shrink-0 text-white flex flex-col fixed inset-y-0 left-0 z-30"
        style={{ background: "linear-gradient(180deg, #0A1628 0%, #0D2A4A 60%, #0D4F8A 100%)" }}
      >
        {/* Brand */}
        <div className="px-5 py-4 flex items-center gap-2.5 border-b border-white/10">
          <span className="w-9 h-9 rounded-xl bg-white/10 grid place-items-center">
            <ShieldCheck size={20} className="text-brand-300" />
          </span>
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
                      <span className="truncate">{it.label}</span>
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
          <button onClick={logout} title="Sair" className="text-white/60 hover:text-white p-1.5 rounded-lg hover:bg-white/10">
            <LogOut size={17} />
          </button>
        </div>
      </aside>

      {/* Content */}
      <main className="flex-1 ml-[var(--sidebar-w)] min-w-0">
        <div className="max-w-[1400px] mx-auto px-6 py-6 kuboo-fade" key={loc.pathname}>
          <Outlet />
        </div>
      </main>
    </div>
  );
}

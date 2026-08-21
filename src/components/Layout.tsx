import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { LogOut, Moon, Sun, Bell, X, Menu } from "lucide-react";
import { toast } from "sonner";
import { temaAtual, alternarTema } from "../lib/theme";
import { NAV, type Modulo } from "../lib/nav";
import { useAuth } from "../context/AuthContext";
import { initials } from "../lib/format";
import { contarBolsao } from "../lib/leads";
import { fetchAvisos, type Aviso } from "../lib/avisos";
import { can } from "../lib/permissoes";
import { supabase } from "../lib/supabase";

export function Layout() {
  const { user, logout } = useAuth();
  const loc = useLocation();
  const nav = useNavigate();
  const [tema, setTema] = useState<"light" | "dark">(temaAtual());
  const modulo: Modulo = loc.pathname.startsWith("/consorcios") ? "consorcios" : "seguros";
  const groups = NAV[modulo];
  const role = user?.role ?? "vendedor";
  // null = não consegui contar (rede/sessão). Estampar 0 aí seria dizer
  // "bolsão vazio" sem ter apurado — o consultor deixa de abrir a tela.
  const [bolsaoCount, setBolsaoCount] = useState<number | null>(0);
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const [avisosAbertos, setAvisosAbertos] = useState(false);
  const [menuAberto, setMenuAberto] = useState(false); // drawer da sidebar no mobile
  const [tick, setTick] = useState(0); // evento realtime força reload do sino/badge

  // Fecha o drawer ao navegar (mobile) e no Esc.
  useEffect(() => { setMenuAberto(false); }, [loc.pathname]);
  useEffect(() => {
    if (!menuAberto) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuAberto(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuAberto]);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        // contarBolsao = HEAD count no servidor. Antes: fetchLeads() baixava a
        // base inteira a cada 60s, por usuário logado, só pra contar o badge.
        const [n, avs] = await Promise.all([contarBolsao(modulo), fetchAvisos(modulo)]);
        if (!active) return;
        setBolsaoCount(n);
        setAvisos(avs);
      } catch (e) {
        // falha de rede não pode travar o chrome global (sino/bolsão) — só loga
        console.error("[layout] avisos/bolsão:", e);
      }
    }
    load();
    const t = setInterval(load, 60000); // recarrega sozinho; não depende de trocar de rota
    return () => { active = false; clearInterval(t); };
  }, [modulo, tick]);

  // ── Lead novo em TEMPO REAL ────────────────────────────────────────────────
  // O motor atribui no trigger (chega aqui como UPDATE com vendedor_id do dono)
  // e o consultor fica sabendo NA HORA: toast sempre; notificação do sistema
  // quando a aba não está em foco. Antes, o primeiro sinal era o poll de 60s do
  // sino — e um lead recém-atribuído nem qualificava pra aviso. O Realtime
  // respeita a RLS de leads (supabase/realtime-leads.sql).
  const notificados = useRef<Set<string>>(new Set());
  const navRef = useRef(nav);
  navRef.current = nav; // nav muda de identidade a cada rota; a ref mantém o
  // efeito preso só ao usuário — assinar/desassinar a cada navegação é corrida
  // desnecessária num canal que deve viver a sessão inteira.

  // Lead que o PRÓPRIO usuário pegou do bolsão também chega como atribuição a
  // ele — sem isto, ele recebia "Lead novo" do lead que acabou de clicar.
  useEffect(() => {
    const marcar = (e: Event) => {
      const id = (e as CustomEvent<{ id?: string }>).detail?.id;
      if (id) notificados.current.add(id);
    };
    window.addEventListener("kuboo:lead-pego", marcar);
    return () => window.removeEventListener("kuboo:lead-pego", marcar);
  }, []);

  useEffect(() => {
    const uid = user?.id;
    if (!supabase || !uid) return;
    // Rajada (importação em massa cai no rodízio e distribui centenas de uma
    // vez): acima de 3 leads em 10s vira UM toast agregado, senão o consultor
    // levava ~90 toasts + ~90 notificações do sistema de enfiada.
    let naJanela = 0;
    let agregados = 0;
    let janela: ReturnType<typeof setTimeout> | null = null;
    let resumo: ReturnType<typeof setTimeout> | null = null;
    const abrirJanela = () => {
      if (janela) return;
      janela = setTimeout(() => { janela = null; naJanela = 0; }, 10000);
    };
    const ch = supabase
      .channel(`leads-vendedor-${uid}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "leads", filter: `vendedor_id=eq.${uid}` }, (payload) => {
        const l = payload.new as { id?: string; nome?: string; modulo?: string | null; primeiro_contato_em?: string | null; descartado?: boolean; atribuido_em?: string | null };
        if (!l?.id || l.primeiro_contato_em || l.descartado) return;
        // Só atribuição RECENTE é "lead novo" — retoque em lead antigo
        // (etiqueta, etapa) também chega como UPDATE e não pode apitar.
        if (!l.atribuido_em || Date.now() - new Date(l.atribuido_em).getTime() > 15 * 60000) return;
        if (notificados.current.has(l.id)) return;
        notificados.current.add(l.id);

        naJanela += 1;
        abrirJanela();
        if (naJanela > 3) {
          // Modo rajada: acumula e mostra um resumo só, sem notificação do SO.
          agregados += 1;
          if (resumo) clearTimeout(resumo);
          resumo = setTimeout(() => {
            const n = agregados;
            agregados = 0;
            toast.info(`${n} leads novos distribuídos pra você`, {
              description: "Abra Meus Leads para trabalhar a fila.",
              action: { label: "Abrir", onClick: () => navRef.current(`/${modulo}/leads`) },
              duration: 12000,
            });
            setTick((t) => t + 1);
          }, 1500);
          return;
        }

        const rota = `/${l.modulo === "consorcios" ? "consorcios" : "seguros"}/leads/${l.id}`;
        toast.info(`Lead novo — ${l.nome ?? "sem nome"}`, {
          description: "Distribuído pra você. Faça o 1º contato dentro do SLA.",
          action: { label: "Abrir", onClick: () => navRef.current(rota) },
          duration: 12000,
        });
        try {
          if (typeof Notification !== "undefined" && Notification.permission === "granted" && !document.hasFocus()) {
            new Notification(`Lead novo — ${l.nome ?? ""}`, { body: "Distribuído pra você no CRM Kuboo. Faça o 1º contato dentro do SLA.", icon: "/kuboo-symbol-3d.png", tag: `lead-${l.id}` });
          }
        } catch { /* mobile só notifica via service worker — o toast cobre */ }
        setTick((t) => t + 1); // sino + badge do bolsão refletem o lead já
      })
      .subscribe();
    return () => {
      if (janela) clearTimeout(janela);
      if (resumo) clearTimeout(resumo);
      void supabase?.removeChannel(ch);
    };
  }, [user?.id, modulo]);

  // Permissão de notificação: pedida no PRIMEIRO clique (gesto real — pedir no
  // load é bloqueado/ignorado pelos browsers). Uma vez só; recusou, respeita.
  useEffect(() => {
    if (typeof Notification === "undefined" || Notification.permission !== "default") return;
    const pedir = () => { void Notification.requestPermission(); };
    window.addEventListener("pointerdown", pedir, { once: true });
    return () => window.removeEventListener("pointerdown", pedir);
  }, []);

  const switchModulo = (m: Modulo) => nav(`/${m}`);

  return (
    <div className="min-h-screen flex">
      {/* Top bar — SÓ mobile (a sidebar vira drawer) */}
      <div className="md:hidden fixed top-0 inset-x-0 h-14 z-30 flex items-center gap-3 px-4 text-white shadow-lg"
        style={{ background: "linear-gradient(90deg, #0A1628, #0D4F8A)" }}>
        <button onClick={() => setMenuAberto(true)} aria-label="Abrir menu" aria-expanded={menuAberto} className="p-1.5 -ml-1.5 rounded-lg hover:bg-white/10">
          <Menu size={22} />
        </button>
        <img src="/kuboo-symbol-3d.png" alt="" className="h-7 w-auto" draggable={false} />
        <span className="font-display text-base tracking-wide">KUBOO</span>
      </div>

      {/* Backdrop do drawer (mobile) */}
      {menuAberto && <div className="md:hidden fixed inset-0 bg-slate-900/50 z-30" onClick={() => setMenuAberto(false)} />}

      {/* Sidebar (drawer no mobile, fixa no desktop) */}
      <aside
        className={`crm-drawer w-[var(--sidebar-w)] shrink-0 text-white flex flex-col fixed inset-y-0 left-0 z-40 transition-transform duration-300 ${menuAberto ? "is-open" : ""}`}
        style={{ background: "linear-gradient(180deg, #0A1628 0%, #0D2A4A 60%, #0D4F8A 100%)" }}
      >
        {/* Brand — símbolo oficial da marca (render 3D de alta qualidade) */}
        <div className="px-5 py-4 flex items-center gap-2.5 border-b border-white/10">
          <img src="/kuboo-symbol-3d.png" alt="Kuboo" className="h-9 w-auto" draggable={false} />
          <div>
            <p className="font-display text-lg leading-none tracking-wide">KUBOO</p>
            <p className="text-[11px] text-white/55">CRM de Gestão</p>
          </div>
          <button onClick={() => setMenuAberto(false)} aria-label="Fechar menu" className="md:hidden ml-auto text-white/60 hover:text-white p-1.5 rounded-lg hover:bg-white/10">
            <X size={20} />
          </button>
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
                  .filter((it) => !it.roles || it.roles.includes(role) || (it.perms && it.perms.some((p) => can(user, p))))
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
                      {it.to.endsWith("/bolsao") && bolsaoCount !== null && bolsaoCount > 0 && (
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
            aria-label={`Avisos da equipe${avisos.length > 0 ? ` (${avisos.length})` : ""}`}
            aria-expanded={avisosAbertos}
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
            aria-label={tema === "dark" ? "Ativar modo claro" : "Ativar modo escuro"}
            className="text-white/60 hover:text-white p-1.5 rounded-lg hover:bg-white/10"
          >
            {tema === "dark" ? <Sun size={17} /> : <Moon size={17} />}
          </button>
          <button onClick={logout} title="Sair" aria-label="Sair" className="text-white/60 hover:text-white p-1.5 rounded-lg hover:bg-white/10">
            <LogOut size={17} />
          </button>
        </div>
      </aside>

      {/* Painel de avisos (SLA + renovações) — computado no cliente, sem cron */}
      {avisosAbertos && (
        <div className="fixed left-2 right-2 md:left-[calc(var(--sidebar-w)+12px)] md:right-auto bottom-4 z-50 md:w-[340px] md:max-w-[calc(100vw-var(--sidebar-w)-24px)] bg-white rounded-2xl shadow-2xl border border-slate-100 overflow-hidden">
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
      <main className="flex-1 ml-0 md:ml-[var(--sidebar-w)] min-w-0 pt-14 md:pt-0">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6 kuboo-fade" key={loc.pathname}>
          <Outlet />
        </div>
      </main>
    </div>
  );
}

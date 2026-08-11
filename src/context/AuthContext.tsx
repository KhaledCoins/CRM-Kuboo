import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase, SUPABASE_CONFIGURED } from "../lib/supabase";

export type Role = "admin" | "gestor" | "vendedor";

export interface TeamUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  nivel?: string | null;
  aprovado?: boolean;
  // Permissões granulares (paridade C2S) — consumir via can() de lib/permissoes
  permissoes?: Record<string, boolean> | null;
}

interface AuthCtx {
  user: TeamUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  isManager: boolean;
  // Chegou por link de convite / "definir senha": o app troca tudo pela tela
  // de criar senha até a pessoa concluir (senão entraria sem senha própria).
  definindoSenha: boolean;
  concluirDefinicaoDeSenha: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

// O link do convite/recuperação chega com os tokens no hash da URL.
const HASH_DEFINIR_SENHA = /[#&]type=(invite|recovery|signup)/;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<TeamUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [definindoSenha, setDefinindoSenha] = useState(
    typeof window !== "undefined" && HASH_DEFINIR_SENHA.test(window.location.hash)
  );

  useEffect(() => {
    if (!SUPABASE_CONFIGURED || !supabase) {
      setLoading(false);
      return;
    }
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) loadProfile(session.user.id, session.user.email ?? "");
      else setLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      // Convite e "esqueci a senha" caem aqui: obriga a criar a senha antes de usar o CRM.
      if (event === "PASSWORD_RECOVERY" || (event === "SIGNED_IN" && HASH_DEFINIR_SENHA.test(window.location.hash))) {
        setDefinindoSenha(true);
      }
      if (session?.user) loadProfile(session.user.id, session.user.email ?? "");
      else { setUser(null); setLoading(false); }
    });
    return () => subscription.unsubscribe();
  }, []);

  // Senha criada com sucesso: limpa o hash da URL, tira o flag de troca
  // obrigatória e libera o CRM.
  async function concluirDefinicaoDeSenha() {
    try {
      if (supabase && user?.id) {
        await supabase.from("profiles").update({ must_change_password: false }).eq("id", user.id);
      }
    } catch { /* o acesso já está liberado — não bloquear por causa do flag */ }
    if (typeof window !== "undefined") {
      window.history.replaceState({}, "", window.location.pathname + window.location.search);
    }
    setDefinindoSenha(false);
  }

  async function loadProfile(id: string, email: string) {
    if (!supabase) return;
    const TEAM_ROLES: Role[] = ["admin", "gestor", "vendedor"];
    let name = email.split("@")[0];
    let role: string | null = null;
    let nivel: string | null = null;
    let aprovado = true;
    let permissoes: Record<string, boolean> | null = null;
    try {
      const { data } = await supabase
        .from("profiles")
        .select("name, role, nivel, aprovado, permissoes")
        .eq("id", id)
        .single();
      if (data) {
        name = (data as any).name || name;
        role = (data as any).role ?? null;
        nivel = (data as any).nivel ?? null;
        if (typeof (data as any).aprovado === "boolean") aprovado = (data as any).aprovado;
        if ((data as any).permissoes && typeof (data as any).permissoes === "object") permissoes = (data as any).permissoes;
      }
    } catch {
      role = null; // falha na leitura do perfil = sem acesso (nunca assumir papel)
    }

    // Segurança: só entra quem é EQUIPE e está APROVADO. Perfil ausente,
    // role 'cliente' ou falha de leitura => nega acesso (nada de default admin).
    if (!role || !TEAM_ROLES.includes(role as Role) || !aprovado) {
      const { toast } = await import("sonner");
      toast.error(
        !aprovado && role
          ? "Sua conta ainda não foi aprovada por um gestor."
          : "Acesso restrito à equipe Kuboo. Fale com um administrador."
      );
      await supabase.auth.signOut();
      setUser(null);
      setLoading(false);
      return;
    }

    setUser({ id, email, name, role: role as Role, nivel, aprovado, permissoes });
    setLoading(false);
  }

  async function login(email: string, password: string) {
    if (!SUPABASE_CONFIGURED || !supabase)
      throw new Error("CRM em configuração. Verifique a conexão com o Supabase.");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      if (error.message.includes("Invalid login credentials"))
        throw new Error("E-mail ou senha incorretos.");
      throw new Error(error.message);
    }
  }

  async function logout() {
    if (supabase) await supabase.auth.signOut();
    setUser(null);
    setDefinindoSenha(false);
  }

  return (
    <Ctx.Provider value={{ user, loading, login, logout, isManager: user?.role !== "vendedor", definindoSenha, concluirDefinicaoDeSenha }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth fora do AuthProvider");
  return c;
}

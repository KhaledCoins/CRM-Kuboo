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
}

interface AuthCtx {
  user: TeamUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  isManager: boolean;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<TeamUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!SUPABASE_CONFIGURED || !supabase) {
      setLoading(false);
      return;
    }
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) loadProfile(session.user.id, session.user.email ?? "");
      else setLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session?.user) loadProfile(session.user.id, session.user.email ?? "");
      else { setUser(null); setLoading(false); }
    });
    return () => subscription.unsubscribe();
  }, []);

  async function loadProfile(id: string, email: string) {
    if (!supabase) return;
    const TEAM_ROLES: Role[] = ["admin", "gestor", "vendedor"];
    let name = email.split("@")[0];
    let role: string | null = null;
    let nivel: string | null = null;
    let aprovado = true;
    try {
      const { data } = await supabase
        .from("profiles")
        .select("name, role, nivel, aprovado")
        .eq("id", id)
        .single();
      if (data) {
        name = (data as any).name || name;
        role = (data as any).role ?? null;
        nivel = (data as any).nivel ?? null;
        if (typeof (data as any).aprovado === "boolean") aprovado = (data as any).aprovado;
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

    setUser({ id, email, name, role: role as Role, nivel, aprovado });
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
  }

  return (
    <Ctx.Provider value={{ user, loading, login, logout, isManager: user?.role !== "vendedor" }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth fora do AuthProvider");
  return c;
}

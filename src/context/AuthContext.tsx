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
    let name = email.split("@")[0];
    let role: Role = "admin"; // default seguro até a migração de papéis
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
        if ((data as any).role) role = (data as any).role as Role;
        nivel = (data as any).nivel ?? null;
        if (typeof (data as any).aprovado === "boolean") aprovado = (data as any).aprovado;
      }
    } catch {
      // coluna role pode ainda não existir — mantém defaults
    }
    setUser({ id, email, name, role, nivel, aprovado });
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

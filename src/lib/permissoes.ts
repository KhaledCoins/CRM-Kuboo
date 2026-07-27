import type { TeamUser } from "../context/AuthContext";

// Permissões granulares por usuário (paridade C2S). O valor salvo em
// profiles.permissoes SOBREPÕE o default do papel; sem valor salvo, vale o
// default: gestor/admin tudo true, vendedor tudo false (visivel_relatorios
// é a exceção — default true pra todo mundo, igual ao C2S).
export type PermissaoChave =
  | "editar_usuarios"
  | "editar_filas"
  | "editar_bolsao"
  | "editar_etiquetas"
  | "acessar_config"
  | "acessar_financeiro"
  | "extrair_relatorios"
  | "visivel_relatorios";

const DEFAULT_TRUE_PARA_TODOS: PermissaoChave[] = ["visivel_relatorios"];

export function can(user: TeamUser | null, chave: PermissaoChave): boolean {
  if (!user) return false;
  const salvo = user.permissoes?.[chave];
  if (typeof salvo === "boolean") return salvo;
  if (DEFAULT_TRUE_PARA_TODOS.includes(chave)) return true;
  return user.role === "gestor" || user.role === "admin";
}

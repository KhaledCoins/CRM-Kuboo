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

// Regra ÚNICA de "esta pessoa pode isto?". A tela de Usuários também usa esta
// função para desenhar os botões — antes ela fazia `permissoes?.[chave] === true`
// por conta própria e ignorava o padrão do papel, então um ADMIN com permissões
// vazias aparecia com tudo em "NÃO" enquanto o sistema lhe dava tudo. A tela
// mentia. Duas implementações da mesma regra sempre acabam divergindo.
export function permissaoEfetiva(
  role: string | null | undefined,
  permissoes: Record<string, boolean> | null | undefined,
  chave: PermissaoChave | string
): boolean {
  const salvo = permissoes?.[chave];
  if (typeof salvo === "boolean") return salvo;
  if (DEFAULT_TRUE_PARA_TODOS.includes(chave as PermissaoChave)) return true;
  return role === "gestor" || role === "admin";
}

export function can(user: TeamUser | null, chave: PermissaoChave): boolean {
  if (!user) return false;
  return permissaoEfetiva(user.role, user.permissoes, chave);
}

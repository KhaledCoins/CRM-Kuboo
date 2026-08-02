-- ─────────────────────────────────────────────────────────────────────────────
-- Check-in de plantão pelo GESTOR (aba Check-in da tela Distribuição de Leads)
-- APLICADA em produção via MCP em 2026-08-02 (migração rpc_definir_disponibilidade_checkin).
--
-- Problema: profiles.disponivel controla quem entra no rodízio (fila_proximo_usuario
-- filtra por ela), mas só o PRÓPRIO usuário conseguia alterar — a policy
-- profiles_self_update é por linha (auth.uid() = id). O gestor não tinha como
-- marcar alguém como ausente.
--
-- Por que RPC e não policy de UPDATE por papel: o grant de coluna em profiles
-- hoje cobre assinatura + disponivel + must_change_password. Uma policy de gestor
-- liberaria as três de uma vez. Esta RPC libera SÓ `disponivel` — menor superfície
-- possível para o mesmo resultado.
--
-- GOTCHA que o front trata: UPDATE barrado por RLS no PostgREST NÃO devolve erro,
-- devolve ZERO linhas. Por isso o fallback usa .select() — sem ele a tela diria
-- "salvo" sem ter salvado nada.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.definir_disponibilidade(p_user_id uuid, p_disponivel boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_manager() then
    raise exception 'Sem permissao para alterar o check-in de outro usuario';
  end if;
  update public.profiles
     set disponivel = p_disponivel
   where id = p_user_id
     and role in ('vendedor','gestor','admin');
  return found;  -- false = alvo inexistente ou fora da equipe
end $$;

revoke all on function public.definir_disponibilidade(uuid, boolean) from public, anon;
grant execute on function public.definir_disponibilidade(uuid, boolean) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- CRÍTICO · fecha escalada de privilégio no self-service de `profiles`.
-- Rodar no SQL Editor do Supabase (projeto uqzenphlvxncuwjzufmo). Idempotente.
-- Depende de crm-migration.sql (role/aprovado/nivel) e clientes-onboarding.sql
-- (must_change_password).
--
-- PROBLEMA: a policy `profiles_self` era `FOR ALL USING (auth.uid() = id)` SEM
-- `WITH CHECK`, e as colunas `role`/`aprovado`/`nivel` vivem na MESMA tabela
-- `profiles`. RLS do Postgres é por LINHA, não por coluna → qualquer cliente
-- logado (só com a anon key pública) conseguia:
--   PATCH /rest/v1/profiles?id=eq.<seu_uid>   body {"role":"admin"}
-- e virar admin do CRM (is_team() confia em profiles.role; aprovado default true).
--
-- ⚠️  POR QUE A 1ª VERSÃO DESTE ARQUIVO NÃO RESOLVIA (era no-op):
--       revoke update (role, aprovado, nivel) on profiles from anon, authenticated;
--     O Supabase concede UPDATE no NÍVEL DA TABELA para `authenticated` (grant
--     padrão do schema public). No Postgres, um grant de TABELA não é afetado por
--     um revoke de COLUNA — docs oficiais: "the table-level grant is unaffected by
--     a column-level operation". Ou seja: o cliente continuava com UPDATE em TODAS
--     as colunas (inclusive `role`) e a escalada seguia 100% aberta.
--
-- CORREÇÃO CERTA (a ordem importa): para restringir UPDATE por coluna no Postgres
-- é preciso PRIMEIRO revogar o UPDATE de tabela e DEPOIS conceder UPDATE só nas
-- colunas liberadas. O front do cliente escreve UMA única coluna do profile —
-- `must_change_password`, ao trocar a senha no 1º login (Site/AuthContext) — então
-- liberamos só ela. `service_role` (api/clientes.js) tem grants próprios e ignora
-- RLS → NÃO é afetado; a promoção de papel continua via SQL/service_role (como já
-- é hoje). Não existe policy de UPDATE de equipe em `profiles`, então nenhum fluxo
-- do CRM via anon key escreve nesta tabela — nada quebra.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) TRAVA DE FATO — remove o UPDATE amplo (nível de tabela) do cliente/anon e
--    reconcede UPDATE apenas na única coluna que o portal legitimamente escreve.
revoke update on profiles from anon, authenticated;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name = 'must_change_password'
  ) then
    execute 'grant update (must_change_password) on public.profiles to authenticated';
  end if;
end $$;

-- 2) DEFESA EM PROFUNDIDADE — troca a policy `FOR ALL` (sem with check) por policies
--    separadas com WITH CHECK: a linha continua sendo a do próprio usuário (não dá
--    pra reassociar o profile a outro id) e não há self-DELETE.
drop policy if exists "profiles_self"        on profiles;
drop policy if exists "profiles_self_select" on profiles;
drop policy if exists "profiles_self_update" on profiles;
drop policy if exists "profiles_self_insert" on profiles;

create policy "profiles_self_select" on profiles
  for select using ((select auth.uid()) = id);

create policy "profiles_self_update" on profiles
  for update using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

create policy "profiles_self_insert" on profiles
  for insert with check ((select auth.uid()) = id);

-- 3) VERIFICAÇÃO — o cliente logado NÃO pode mais escrever role/aprovado/nivel,
--    mas AINDA escreve must_change_password. Esperado: f | f | f | t
select
  has_column_privilege('authenticated', 'public.profiles', 'role',                 'UPDATE') as pode_role,
  has_column_privilege('authenticated', 'public.profiles', 'aprovado',             'UPDATE') as pode_aprovado,
  has_column_privilege('authenticated', 'public.profiles', 'nivel',                'UPDATE') as pode_nivel,
  has_column_privilege('authenticated', 'public.profiles', 'must_change_password', 'UPDATE') as pode_must_change_password;

-- ─────────────────────────────────────────────────────────────────────────────
-- CRÍTICO · fecha escalada de privilégio no self-service de `profiles`.
-- Rodar no SQL Editor do Supabase. Idempotente.
--
-- PROBLEMA: a policy `profiles_self` era `FOR ALL USING (auth.uid() = id)` SEM
-- `WITH CHECK`, e as colunas `role`/`aprovado`/`nivel` vivem na MESMA tabela
-- `profiles`. RLS do Postgres é por LINHA, não por coluna → qualquer cliente
-- logado (só com a anon key pública) conseguia:
--   PATCH /rest/v1/profiles?id=eq.<seu_uid>  body {"role":"admin"}
-- e virar admin do CRM (is_team() confia em profiles.role; aprovado default true).
--
-- CORREÇÃO: grant por COLUNA compõe com RLS. Sem UPDATE nas colunas privilegiadas,
-- o cliente não escreve role/aprovado/nivel de jeito nenhum pelo front. A promoção
-- de papel continua só por SQL/service_role (é como já se faz hoje) e o
-- api/clientes.js usa service_role (ignora RLS + grants). NÃO quebra nada:
-- nenhum código do frontend atualiza essas colunas.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) DEFINITIVO: tira do usuário logado (e do anon) a permissão de escrever as
--    colunas de papel/aprovação/nível. Ele ainda edita name/phone/etc. do próprio
--    profile, mas nunca role/aprovado/nivel.
revoke update (role, aprovado, nivel) on profiles from anon, authenticated;

-- 2) DEFESA EM PROFUNDIDADE: substitui a policy `FOR ALL` (sem with check) por
--    policies separadas com WITH CHECK, garantindo que a linha continua sendo a do
--    próprio usuário (não dá pra reassociar o profile a outro id).
drop policy if exists "profiles_self" on profiles;

create policy "profiles_self_select" on profiles
  for select using ((select auth.uid()) = id);

create policy "profiles_self_update" on profiles
  for update using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

create policy "profiles_self_insert" on profiles
  for insert with check ((select auth.uid()) = id);
-- (sem policy de DELETE self: o cliente não apaga o próprio profile pela UI)

select 'profiles: role/aprovado/nivel trancados contra auto-escalada (RLS + grant por coluna)' as resultado;

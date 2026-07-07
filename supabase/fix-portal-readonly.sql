-- ─────────────────────────────────────────────────────────────────────────────
-- Portal do cliente = SOMENTE LEITURA em apolices/consorcios/notificacoes.
-- Rodar no SQL Editor do Supabase. Idempotente.
--
-- PROBLEMA: as policies `apolices_owner`/`consorcios_owner`/`notificacoes_owner`
-- eram `FOR ALL USING (auth.uid() = client_id)` → davam ao CLIENTE INSERT/UPDATE/
-- DELETE nas PRÓPRIAS linhas. Como esses registros são COMPARTILHADOS (o corretor
-- vê o mesmo row no CRM), um cliente podia inserir apólice falsa, zerar
-- prêmio/crédito ou apagar a própria apólice — corrompendo a visão da equipe.
--
-- CORREÇÃO: cliente fica só com SELECT (lê as suas). A escrita continua com a
-- equipe (policies *_team = is_team(), em crm-portal-team.sql) e a service_role.
-- O Portal só faz SELECT nessas tabelas — nada quebra.
-- ─────────────────────────────────────────────────────────────────────────────

drop policy if exists "apolices_owner"     on apolices;
create policy "apolices_owner" on apolices
  for select using ((select auth.uid()) = client_id);

drop policy if exists "consorcios_owner"   on consorcios;
create policy "consorcios_owner" on consorcios
  for select using ((select auth.uid()) = client_id);

drop policy if exists "notificacoes_owner" on notificacoes;
create policy "notificacoes_owner" on notificacoes
  for select using ((select auth.uid()) = client_id);

select 'Portal read-only: cliente agora so LE apolices/consorcios/notificacoes' as resultado;

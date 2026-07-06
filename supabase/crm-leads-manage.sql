-- ─────────────────────────────────────────────────────────────────────────────
-- CRM · gestão de leads pela equipe (descartar/atualizar) + limpeza de lixo
-- Rodar no SQL Editor do Supabase. Idempotente.
-- Motivo: hoje a equipe SÓ lê leads (leads_admin_read) e o público SÓ insere
-- (leads_public_insert). Não dá pra descartar spam/newsletter/duplicados pela UI.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) Coluna de status "descartado" (soft-delete) + motivo — não apaga histórico
alter table leads add column if not exists descartado boolean not null default false;
alter table leads add column if not exists motivo_descarte text;

-- 2) Policy: equipe pode ATUALIZAR e DELETAR leads (gestão do funil/bolsão)
drop policy if exists leads_team_update on leads;
create policy leads_team_update on leads
  for update using (public.is_team()) with check (public.is_team());

drop policy if exists leads_team_delete on leads;
create policy leads_team_delete on leads
  for delete using (public.is_team());

-- 3) Limpeza dos leads de TESTE atuais (ajuste a lista se quiser manter algum)
delete from leads
where nome in ('AUDIT','Teste pos-fix','Teste Cliente','Cliente Teste','Lead Teste Chatbot','Eduardo',
               'TESTE_PARCIAL Abandono','TESTE_COMPLETO Multicalculo')
   or nome like 'TESTE_%'
   or origem = 'audit';

-- 4) Newsletter: NÃO é tratada aqui. A separação definitiva (tabela própria
--    newsletter_inscritos + backfill + delete dos leads) está em
--    Site Kuboo/supabase/newsletter.sql. Rode aquele script também.

-- Pronto. Depois disso o CRM consegue descartar/editar leads e o bolsão fica limpo.

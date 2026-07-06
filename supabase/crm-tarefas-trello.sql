-- ─────────────────────────────────────────────────────────────────────────────
-- Tarefas · vínculo idempotente com o Trello (trello_card_id)
-- Rodar no SQL Editor. Idempotente. O backfill acontece sozinho no primeiro
-- "Sincronizar Trello" após o deploy (o servidor devolve o id do card já
-- existente com o mesmo título e o CRM grava aqui).
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.tarefas add column if not exists trello_card_id text;
create index if not exists idx_tarefas_trello on public.tarefas(trello_card_id);

select 'Coluna trello_card_id pronta' as resultado;

-- ============================================================
-- Kuboo CRM — Análises salvas do Dashboard (paridade com os
-- "dashboards personalizados" do C2S). Rode no SQL Editor.
-- Depende de public.is_team() e public.profiles (já criadas na
-- crm-migration.sql). Idempotente — pode rodar de novo sem erro.
-- ============================================================
create table if not exists public.dashboards_analises (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  config jsonb not null,
  created_at timestamptz default now()
);

alter table public.dashboards_analises enable row level security;

drop policy if exists "dashboards_analises_select" on public.dashboards_analises;
create policy "dashboards_analises_select" on public.dashboards_analises
  for select using (user_id = (select auth.uid()) and public.is_team());

drop policy if exists "dashboards_analises_insert" on public.dashboards_analises;
create policy "dashboards_analises_insert" on public.dashboards_analises
  for insert with check (user_id = (select auth.uid()) and public.is_team());

drop policy if exists "dashboards_analises_update" on public.dashboards_analises;
create policy "dashboards_analises_update" on public.dashboards_analises
  for update using (user_id = (select auth.uid()) and public.is_team())
  with check (user_id = (select auth.uid()) and public.is_team());

drop policy if exists "dashboards_analises_delete" on public.dashboards_analises;
create policy "dashboards_analises_delete" on public.dashboards_analises
  for delete using (user_id = (select auth.uid()) and public.is_team());

create index if not exists idx_dashboards_analises_user_id on public.dashboards_analises(user_id);

select 'Tabela dashboards_analises criada' as resultado;

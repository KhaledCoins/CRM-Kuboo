-- ============================================================
-- Kuboo CRM — Quadro de Tarefas (Trello-style). Rode no SQL Editor.
-- Depende de is_team() (já criada na crm-migration.sql).
-- ============================================================
create table if not exists public.tarefas (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  descricao text,
  status text not null default 'a_fazer' check (status in ('a_fazer','fazendo','concluido')),
  prioridade text default 'media' check (prioridade in ('baixa','media','alta')),
  responsavel_nome text,
  cliente_nome text,
  vencimento date,
  modulo text default 'seguros',
  created_at timestamptz default now()
);

alter table public.tarefas enable row level security;
drop policy if exists "tarefas_team" on public.tarefas;
create policy "tarefas_team" on public.tarefas for all using (public.is_team()) with check (public.is_team());

create index if not exists idx_tarefas_status on public.tarefas(status);

select 'Tabela de tarefas criada' as resultado;

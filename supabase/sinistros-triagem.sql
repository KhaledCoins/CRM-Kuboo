-- ============================================================================
-- TRIAGEM DE SINISTROS DO KUBINHO → "bolsão de sinistros" no CRM
-- O Kubinho (site/portal) faz a triagem completa (seguradora, tipo, BO,
-- vítimas DF/DM, terceiros, oficina, docs) e grava o chamado estruturado aqui.
-- A equipe recebe alerta no sino e trabalha o chamado na página Sinistros.
-- Rodar no SQL Editor do Supabase (idempotente).
-- ============================================================================

create table if not exists public.sinistros_chamados (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  -- contato
  nome text not null,
  telefone text,
  email text,
  cliente_id uuid references public.profiles(id), -- preenchido quando veio do portal logado
  -- triagem
  seguradora text,          -- Porto, Azul, Itaú, Tokio Marine, Suhai, Mapfre, Bradesco, Ezze, Essor, Allianz, Yelum, HDI
  tipo text,                -- furto | roubo | colisao | incendio | enchente | vidros | vida | assistencia
  resumo text,              -- 1 linha gerada pela IA
  dados jsonb,              -- todas as perguntas/respostas da triagem
  conversa text,            -- transcrição opcional
  -- fluxo da equipe
  status text not null default 'novo' check (status in ('novo', 'em_analise', 'aguardando_docs', 'concluido')),
  responsavel_id uuid references public.profiles(id),
  origem text not null default 'kubinho'
);
create index if not exists sinistros_chamados_status_idx on public.sinistros_chamados (status, created_at desc);

alter table public.sinistros_chamados enable row level security;

-- INSERT público (igual leads): o chamado nasce do chat sem login.
-- Policy RESTRITA: só estado inicial, sem responsável e com origem do chatbot —
-- anon não consegue criar chamado "concluído" nem forjar origem.
drop policy if exists sinistros_public_insert on public.sinistros_chamados;
create policy sinistros_public_insert on public.sinistros_chamados
  for insert to anon, authenticated
  with check (
    status = 'novo'
    and responsavel_id is null
    and origem in ('kubinho', 'kubinho_portal')
  );

-- Leitura/gestão: só equipe.
drop policy if exists sinistros_team_select on public.sinistros_chamados;
create policy sinistros_team_select on public.sinistros_chamados
  for select to authenticated using (public.is_team());
drop policy if exists sinistros_team_update on public.sinistros_chamados;
create policy sinistros_team_update on public.sinistros_chamados
  for update to authenticated using (public.is_team()) with check (public.is_team());
drop policy if exists sinistros_team_delete on public.sinistros_chamados;
create policy sinistros_team_delete on public.sinistros_chamados
  for delete to authenticated using (public.is_team());

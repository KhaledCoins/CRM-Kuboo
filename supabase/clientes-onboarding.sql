-- ─────────────────────────────────────────────────────────────────────────────
-- CRM · onboarding de clientes reais (cadastro pela equipe + login no portal)
-- Rodar no SQL Editor do Supabase. Idempotente. Depende de crm-migration.sql
-- (is_team()) e crm-portal-team.sql (apolices_team/consorcios_team).
--
-- Motivo: a tela "Novo Cliente" do CRM não tinha como criar um cliente de
-- verdade — profiles é 1:1 com auth.users, então só existe cliente com login.
-- api/clientes.js cria a conta (Supabase Auth Admin) e preenche o profile.
-- ─────────────────────────────────────────────────────────────────────────────

-- E-mail do cliente, visível/buscável pela equipe no CRM (a fonte da verdade
-- de autenticação continua sendo auth.users; esta coluna é só de exibição/busca).
alter table profiles add column if not exists email text;
create index if not exists idx_profiles_email on profiles(email);

-- Cliente criado com senha temporária (sem e-mail próprio, ou convite) precisa
-- trocar a senha no 1º login antes de entrar no Portal de verdade.
alter table profiles add column if not exists must_change_password boolean not null default false;

-- ─── Storage: documentos do cliente (apólice em PDF, carta de consórcio, foto) ─
-- Bucket privado — nada é público. Acesso via RLS igual às tabelas: dono ou equipe.
insert into storage.buckets (id, name, public)
values ('documentos-clientes', 'documentos-clientes', false)
on conflict (id) do nothing;

-- Convenção de caminho: {client_id}/{arquivo}. O 1º segmento do path = dono.
drop policy if exists "docs_cliente_le_o_proprio" on storage.objects;
create policy "docs_cliente_le_o_proprio" on storage.objects
  for select using (
    bucket_id = 'documentos-clientes'
    and (select auth.uid())::text = (storage.foldername(name))[1]
  );

drop policy if exists "docs_equipe_gerencia" on storage.objects;
create policy "docs_equipe_gerencia" on storage.objects
  for all using (bucket_id = 'documentos-clientes' and public.is_team())
  with check (bucket_id = 'documentos-clientes' and public.is_team());

select 'Onboarding de clientes pronto (email, must_change_password, bucket de documentos)' as resultado;

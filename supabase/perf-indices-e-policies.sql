-- ─────────────────────────────────────────────────────────────────────────────
-- PERFORMANCE: índices de FK + consolidação de policies
-- APLICADA em produção via MCP em 2026-08-02 (migração perf_indices_fk_e_policies_consolidadas).
--
-- Origem: advisor de performance do Supabase.
--   a) 9 foreign keys sem índice de cobertura → seq scan em JOIN/filtro. Com os
--      754 leads do C2S entrando e ~130/mês, degrada rápido.
--   b) "Multiple permissive policies": cada policy PERMISSIVA extra é avaliada
--      em TODA query da tabela para o mesmo comando+role.
--
-- Descoberta que destravou (a): `service_role` tem rolbypassrls=true (conferido
-- em pg_roles). Logo as policies leads_admin_read/modify/delete, que testavam
-- auth.role()='service_role', eram CÓDIGO MORTO: para o service_role o RLS é
-- ignorado, e para anon/authenticated elas sempre retornavam false. Puro custo.
--
-- VALIDADO em produção depois de aplicar (nada de segurança regrediu):
--   anon                       → 0 em apolices/consorcios/notificacoes/profiles/leads
--   cliente puro (Letícia)     → 1 profile (só o dela), 0 em todo o resto
--   cliente c/ dados (Maria)   → 2 apólices dela, 0 de outros
--   vendedor (Alexsandro)      → 2 leads do bolsão, 0 leads de colega atendido, 0 comissões
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) Índices nas 9 FKs sem cobertura
create index if not exists idx_atendimentos_responsavel on public.atendimentos(responsavel_id);
create index if not exists idx_atendimentos_venda       on public.atendimentos(venda_id);
create index if not exists idx_comissoes_venda          on public.comissoes(venda_id);
create index if not exists idx_contemplacoes_cota       on public.contemplacoes(cota_id);
create index if not exists idx_cotas_vendedor           on public.cotas(vendedor_id);
create index if not exists idx_endossos_venda           on public.endossos(venda_id);
create index if not exists idx_metas_vendedor           on public.metas(vendedor_id);
create index if not exists idx_notificacoes_client      on public.notificacoes(client_id);
create index if not exists idx_vendas_cliente           on public.vendas(cliente_id);

-- 2) Policies mortas de leads (service_role já bypassa RLS)
drop policy if exists "leads_admin_read"   on public.leads;
drop policy if exists "leads_admin_modify" on public.leads;
drop policy if exists "leads_admin_delete" on public.leads;

-- 3) profiles: 1 SELECT em vez de 2 (lida em toda carga do CRM)
drop policy if exists "profiles_self_select" on public.profiles;
drop policy if exists "profiles_team_read"   on public.profiles;
create policy "profiles_read" on public.profiles for select
  using ((select auth.uid()) = id or public.is_team());

-- 4) Portal do cliente: leitura consolidada (dono OU equipe), escrita explícita
drop policy if exists "apolices_owner" on public.apolices;
drop policy if exists "apolices_team"  on public.apolices;
create policy "apolices_read" on public.apolices for select
  using ((select auth.uid()) = client_id or public.is_team());
create policy "apolices_ins" on public.apolices for insert with check (public.is_team());
create policy "apolices_upd" on public.apolices for update using (public.is_team()) with check (public.is_team());
create policy "apolices_del" on public.apolices for delete using (public.is_team());

drop policy if exists "consorcios_owner" on public.consorcios;
drop policy if exists "consorcios_team"  on public.consorcios;
create policy "consorcios_read" on public.consorcios for select
  using ((select auth.uid()) = client_id or public.is_team());
create policy "consorcios_ins" on public.consorcios for insert with check (public.is_team());
create policy "consorcios_upd" on public.consorcios for update using (public.is_team()) with check (public.is_team());
create policy "consorcios_del" on public.consorcios for delete using (public.is_team());

drop policy if exists "notificacoes_owner" on public.notificacoes;
drop policy if exists "notificacoes_team"  on public.notificacoes;
create policy "notificacoes_read" on public.notificacoes for select
  using ((select auth.uid()) = client_id or public.is_team());
create policy "notificacoes_ins" on public.notificacoes for insert with check (public.is_team());
create policy "notificacoes_upd" on public.notificacoes for update using (public.is_team()) with check (public.is_team());
create policy "notificacoes_del" on public.notificacoes for delete using (public.is_team());

-- 5) metas: metas_write era FOR ALL e duplicava o SELECT do metas_read
drop policy if exists "metas_write" on public.metas;
create policy "metas_ins" on public.metas for insert with check (public.is_manager());
create policy "metas_upd" on public.metas for update using (public.is_manager()) with check (public.is_manager());
create policy "metas_del" on public.metas for delete using (public.is_manager());

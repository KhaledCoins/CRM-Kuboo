-- ============================================================================
-- FASE 5 — RLS por dono nas 4 tabelas operacionais que faltaram, + restauração
-- da rede de segurança do trigger de distribuição.
-- JÁ APLICADO EM PRODUÇÃO (12/08/2026). Idempotente.
--
-- Origem: auditoria banco × repo (agente) que encontrou:
--   1. trg_distribuir_lead() tinha PERDIDO o bloco exception da fase 3 quando
--      foi reescrito para ignorar leads espelhados do C2S — regressão grave:
--      erro no motor derrubaria o INSERT e mataria a captação do site.
--   2. atendimentos/cotas/contemplacoes/endossos ainda com "FOR ALL USING
--      (is_team())" — mesma falha ALTA já corrigida em comissoes/vendas/parcelas:
--      qualquer vendedor podia editar/apagar registro de colega pela API REST.
--
-- ⚠️ NÃO rode os arquivos anteriores (c2s-parity.sql, auditoria-leads-*.sql)
-- depois deste: eles reintroduzem versões antigas de is_team()/distribuir_lead()
-- e desfazem hardening. A ordem é parity → auditoria → fase3 → fase4 → fase5.
-- ============================================================================

-- ─── 1. Trigger de distribuição: lead SEMPRE entra ──────────────────────────
create or replace function public.trg_distribuir_lead() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- Lead espelhado do C2S (c2s_lead_id) não entra no rodízio: durante o período
  -- em paralelo, quem manda na atribuição é o C2S.
  if new.vendedor_id is null and new.c2s_lead_id is null then
    begin
      perform public.distribuir_lead(new.id);
    exception when others then
      -- Falhou distribuir? O lead fica no bolsão e o erro vira log.
      -- NUNCA derrubar o insert por causa disso — é a captação do site.
      raise warning 'distribuir_lead falhou para % : %', new.id, sqlerrm;
    end;
  end if;
  return new;
end $$;
revoke execute on function public.trg_distribuir_lead() from anon, authenticated, public;

-- ─── 2. atendimentos (dono = responsavel_id) ────────────────────────────────
drop policy if exists atendimentos_team on public.atendimentos;
drop policy if exists atendimentos_read on public.atendimentos;
drop policy if exists atendimentos_ins on public.atendimentos;
drop policy if exists atendimentos_upd on public.atendimentos;
drop policy if exists atendimentos_del on public.atendimentos;
create policy atendimentos_read on public.atendimentos for select to authenticated
  using (public.is_team() and (public.is_manager() or responsavel_id = (select auth.uid()) or responsavel_id is null));
create policy atendimentos_ins on public.atendimentos for insert to authenticated
  with check (public.is_team());
create policy atendimentos_upd on public.atendimentos for update to authenticated
  using (public.is_team() and (public.is_manager() or responsavel_id = (select auth.uid()) or responsavel_id is null))
  with check (public.is_team());
create policy atendimentos_del on public.atendimentos for delete to authenticated
  using (public.is_manager() or responsavel_id = (select auth.uid()));

-- ─── 3. cotas (dono = vendedor_id) ──────────────────────────────────────────
drop policy if exists cotas_team on public.cotas;
drop policy if exists cotas_read on public.cotas;
drop policy if exists cotas_ins on public.cotas;
drop policy if exists cotas_upd on public.cotas;
drop policy if exists cotas_del on public.cotas;
create policy cotas_read on public.cotas for select to authenticated
  using (public.is_team() and (public.is_manager() or vendedor_id = (select auth.uid()) or vendedor_id is null));
create policy cotas_ins on public.cotas for insert to authenticated
  with check (public.is_team());
create policy cotas_upd on public.cotas for update to authenticated
  using (public.is_team() and (public.is_manager() or vendedor_id = (select auth.uid()) or vendedor_id is null))
  with check (public.is_team());
create policy cotas_del on public.cotas for delete to authenticated
  using (public.is_manager() or vendedor_id = (select auth.uid()));

-- ─── 4. contemplacoes (posse herdada da cota) ───────────────────────────────
drop policy if exists contemplacoes_team on public.contemplacoes;
drop policy if exists contemplacoes_read on public.contemplacoes;
drop policy if exists contemplacoes_ins on public.contemplacoes;
drop policy if exists contemplacoes_upd on public.contemplacoes;
drop policy if exists contemplacoes_del on public.contemplacoes;
create policy contemplacoes_read on public.contemplacoes for select to authenticated
  using (public.is_team() and (public.is_manager() or exists (
    select 1 from public.cotas c where c.id = cota_id
      and (c.vendedor_id = (select auth.uid()) or c.vendedor_id is null))));
create policy contemplacoes_ins on public.contemplacoes for insert to authenticated
  with check (public.is_team());
create policy contemplacoes_upd on public.contemplacoes for update to authenticated
  using (public.is_team() and (public.is_manager() or exists (
    select 1 from public.cotas c where c.id = cota_id and c.vendedor_id = (select auth.uid()))))
  with check (public.is_team());
create policy contemplacoes_del on public.contemplacoes for delete to authenticated
  using (public.is_manager());

-- ─── 5. endossos (posse herdada da venda) ───────────────────────────────────
drop policy if exists endossos_team on public.endossos;
drop policy if exists endossos_read on public.endossos;
drop policy if exists endossos_ins on public.endossos;
drop policy if exists endossos_upd on public.endossos;
drop policy if exists endossos_del on public.endossos;
create policy endossos_read on public.endossos for select to authenticated
  using (public.is_team() and (public.is_manager() or exists (
    select 1 from public.vendas v where v.id = venda_id
      and (v.vendedor_id = (select auth.uid()) or v.vendedor_id is null))));
create policy endossos_ins on public.endossos for insert to authenticated
  with check (public.is_team());
create policy endossos_upd on public.endossos for update to authenticated
  using (public.is_team() and (public.is_manager() or exists (
    select 1 from public.vendas v where v.id = venda_id and v.vendedor_id = (select auth.uid()))))
  with check (public.is_team());
create policy endossos_del on public.endossos for delete to authenticated
  using (public.is_manager());

-- ─── 6. Registro das mudanças que estavam só no histórico de migrations ─────
-- (documentadas aqui pra não se perderem se alguém recriar o banco do zero)
alter table public.leads add column if not exists c2s_lead_id text;
create unique index if not exists leads_c2s_lead_id_uidx
  on public.leads (c2s_lead_id) where c2s_lead_id is not null;

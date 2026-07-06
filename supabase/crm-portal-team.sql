-- ─────────────────────────────────────────────────────────────────────────────
-- CRM · equipe enxerga o portfólio dos clientes (apolices/consorcios/notificacoes)
-- Rodar no SQL Editor do Supabase. Idempotente. Depende de public.is_team().
--
-- Motivo: o loop de RLS da crm-migration cobriu as tabelas de GESTÃO
-- (vendas, parcelas, comissoes...) mas NÃO as tabelas do PORTAL do cliente.
-- Sem isso a equipe não vê apólices/consórcios reais — o radar de Renovações
-- fica cego pra base migrada do Excel, e Timeline 360º / 2ª via ficam impossíveis.
--
-- Segurança: policies permissivas são OR — o cliente continua vendo SÓ o dele
-- (apolices_owner/consorcios_owner/notificacoes_owner intactas); apenas soma
-- o acesso da equipe autenticada (is_team()). anon continua lendo NADA.
-- ─────────────────────────────────────────────────────────────────────────────

-- Apólices: equipe gerencia (ler p/ renovações, atualizar docs p/ 2ª via, inserir na migração do Excel)
drop policy if exists "apolices_team" on apolices;
create policy "apolices_team" on apolices
  for all using (public.is_team()) with check (public.is_team());

-- Consórcios: idem (contemplações, assembleias, timeline do cliente)
drop policy if exists "consorcios_team" on consorcios;
create policy "consorcios_team" on consorcios
  for all using (public.is_team()) with check (public.is_team());

-- Notificações: equipe cria avisos pro cliente (renovação, documento disponível)
drop policy if exists "notificacoes_team" on notificacoes;
create policy "notificacoes_team" on notificacoes
  for all using (public.is_team()) with check (public.is_team());

-- Índice que o radar de renovações usa (já existe no schema base; garante)
create index if not exists idx_apolices_vencimento on apolices(vigencia_fim);

select 'Equipe agora acessa apolices/consorcios/notificacoes (RLS OK)' as resultado;

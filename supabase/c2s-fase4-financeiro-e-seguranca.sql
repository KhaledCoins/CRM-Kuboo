-- ─────────────────────────────────────────────────────────────────────────────
-- C2S → CRM · FASE 4: fecha auto-fraude financeira + fila de segurança blindada
-- APLICADA em produção via MCP em 2026-08-01 (migrações c2s_fase4_financeiro_e_
-- seguranca + c2s_fase4b_seguranca_incondicional). Idempotente.
--
-- Origem: pentest de 10 agentes + validação ao vivo simulando o JWT de uma
-- vendedora real (Amanda) contra o banco de produção.
--
-- VULN ALTA CONFIRMADA AO VIVO: `comissoes` tinha RLS `FOR ALL is_team()` (vinda
-- do loop genérico da crm-migration). Qualquer vendedor autenticado, com a anon
-- key pública do bundle + o próprio JWT, conseguia:
--   GET   /rest/v1/comissoes            → ler a folha de comissões inteira
--   PATCH /rest/v1/comissoes?id=eq.<x>  → inflar a própria ou zerar a de um colega
-- A permissão `acessar_financeiro` existia no cadastro de usuários mas NUNCA era
-- aplicada (nem no banco, nem como guarda de rota). Teste: Amanda lia a comissão
-- do Alexsandro (1 linha) → agora 0.
--
-- DECISÃO DE PRODUTO (diverge do fix sugerido pelo agente, de propósito):
-- a LEITURA de `vendas` CONTINUA sendo de equipe. Ranking, TV do Salão, Produção
-- e o dashboard do módulo são visão coletiva/gamificação (dossiê C2S) e leem as
-- vendas de todos — escopar a leitura por dono quebraria essas 4 telas para todo
-- vendedor. O que se fecha é o DINHEIRO PESSOAL (comissões) e a ESCRITA.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) COMISSÕES: leitura só do dono (ou gestor); escrita só gestor/financeiro.
--    INSERT segue liberado à equipe porque o Pipeline gera a comissão no ato de
--    fechar a venda (fluxo legítimo do vendedor).
alter table public.comissoes enable row level security;
drop policy if exists comissoes_team on public.comissoes;
drop policy if exists comissoes_read on public.comissoes;
drop policy if exists comissoes_ins  on public.comissoes;
drop policy if exists comissoes_upd  on public.comissoes;
drop policy if exists comissoes_del  on public.comissoes;
create policy comissoes_read on public.comissoes for select to authenticated
  using (public.is_team() and (public.is_manager() or vendedor_id = (select auth.uid())));
create policy comissoes_ins on public.comissoes for insert to authenticated
  with check (public.is_team());
create policy comissoes_upd on public.comissoes for update to authenticated
  using  (public.is_manager() or public.has_perm('acessar_financeiro'))
  with check (public.is_manager() or public.has_perm('acessar_financeiro'));
create policy comissoes_del on public.comissoes for delete to authenticated
  using  (public.is_manager() or public.has_perm('acessar_financeiro'));

-- 2) VENDAS: leitura de equipe (Ranking/TV/Produção dependem disso);
--    UPDATE só do dono/gestor/financeiro — impede sabotar ou inflar a venda alheia.
alter table public.vendas enable row level security;
drop policy if exists vendas_team on public.vendas;
drop policy if exists vendas_read on public.vendas;
drop policy if exists vendas_ins  on public.vendas;
drop policy if exists vendas_upd  on public.vendas;
drop policy if exists vendas_del  on public.vendas;
create policy vendas_read on public.vendas for select to authenticated using (public.is_team());
create policy vendas_ins  on public.vendas for insert to authenticated with check (public.is_team());
create policy vendas_upd  on public.vendas for update to authenticated
  using  (public.is_manager() or vendedor_id = (select auth.uid()) or public.has_perm('acessar_financeiro'))
  with check (public.is_manager() or vendedor_id = (select auth.uid()) or public.has_perm('acessar_financeiro'));
create policy vendas_del  on public.vendas for delete to authenticated
  using  (public.is_manager() or public.has_perm('acessar_financeiro'));

-- 3) PARCELAS: leitura de equipe (controle de cobrança); escrita gestor/financeiro.
alter table public.parcelas enable row level security;
drop policy if exists parcelas_team  on public.parcelas;
drop policy if exists parcelas_read  on public.parcelas;
drop policy if exists parcelas_write on public.parcelas;
drop policy if exists parcelas_ins   on public.parcelas;
drop policy if exists parcelas_upd   on public.parcelas;
drop policy if exists parcelas_del   on public.parcelas;
create policy parcelas_read on public.parcelas for select to authenticated using (public.is_team());
create policy parcelas_ins  on public.parcelas for insert to authenticated with check (public.is_team());
create policy parcelas_upd  on public.parcelas for update to authenticated
  using  (public.is_manager() or public.has_perm('acessar_financeiro'))
  with check (public.is_manager() or public.has_perm('acessar_financeiro'));
create policy parcelas_del  on public.parcelas for delete to authenticated
  using  (public.is_manager() or public.has_perm('acessar_financeiro'));

-- 4) METAS: todos veem a meta da corretora; só gestor define (vendedor podia
--    editar a própria meta e "bater" sozinho).
alter table public.metas enable row level security;
drop policy if exists metas_team  on public.metas;
drop policy if exists metas_read  on public.metas;
drop policy if exists metas_write on public.metas;
create policy metas_read  on public.metas for select to authenticated using (public.is_team());
create policy metas_write on public.metas for all to authenticated
  using (public.is_manager()) with check (public.is_manager());

-- 5) FILA DE SEGURANÇA = fallback INCONDICIONAL (achado ALTA da auditoria).
--    fila_proximo_usuario filtra disponivel/limite_abertos; se o admin de plantão
--    estivesse "ausente" (check-out) ou lotado, o lead ficava ÓRFÃO justamente no
--    cenário (madrugada/férias) em que a rede de segurança precisa existir.
--    VALIDADO ao vivo: com TODA a equipe ausente, o lead foi para o admin.
create or replace function public.fila_proximo_usuario_seguranca(p_fila public.filas)
returns uuid language sql stable set search_path = public as $$
  select fu.user_id
  from public.fila_usuarios fu
  join public.profiles p on p.id = fu.user_id
  where fu.fila_id = p_fila.id and fu.ativo
    and coalesce(p.aprovado, true)
  order by fu.ultima_atribuicao asc nulls first
  limit 1
$$;
revoke execute on function public.fila_proximo_usuario_seguranca(public.filas) from public, anon, authenticated;

-- O corpo novo de distribuir_lead (ramo is_seguranca usando a função acima +
-- última linha de defesa no 1º admin aprovado) está na migração
-- c2s_fase4b_seguranca_incondicional aplicada no Supabase — o restante do motor
-- (filas, memória de retorno, rodízio) é idêntico ao da fase 3.

-- ─── FASE 4c: RPCs SECURITY DEFINER expostas no PostgREST (advisor Supabase) ──
-- CRÍTICO (achado pelo advisor, que nenhum agente viu): import_c2s_leads(jsonb)
-- é ferramenta de MIGRAÇÃO (ignora RLS por design) e estava executável por
-- `anon` — qualquer um na internet, com a anon key que está no bundle público
-- do site, podia POST /rest/v1/rpc/import_c2s_leads e injetar leads em massa.
-- VALIDADO: ataque agora dá "permission denied"; captação do site segue OK.
revoke execute on function public.import_c2s_leads(jsonb) from public, anon, authenticated;

-- Motor: chamado pelo TRIGGER (roda como definer), nunca pelo cliente.
revoke execute on function public.distribuir_lead(uuid) from public, anon, authenticated;
revoke execute on function public.trg_distribuir_lead() from public, anon, authenticated;

-- redistribuir_bolsao: a UI do gestor chama via RPC (guarda is_manager interna)
-- — mantém authenticated, tira do anon.
revoke execute on function public.redistribuir_bolsao() from public, anon;

-- NOTA DELIBERADA: is_team()/is_manager()/has_perm() continuam executáveis por
-- anon+authenticated. As RLS policies as invocam durante a avaliação da query;
-- revogar de anon faria o INSERT público de leads do site falhar com
-- "permission denied for function" em vez de simplesmente negar. Elas só
-- retornam boolean sobre o próprio usuário (anon => sempre false). O warning do
-- advisor nessas 3 é aceito conscientemente.

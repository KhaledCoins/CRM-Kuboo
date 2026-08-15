-- ============================================================================
-- FASE 8 — HARDENING PRÉ-LANÇAMENTO (auditoria de 8 dimensões, 14/08/2026)
-- JÁ APLICADO EM PRODUÇÃO via MCP. Este arquivo é o espelho de rastreabilidade.
-- Idempotente.
--
-- Origem: auditoria adversarial com 53 agentes (8 auditores por dimensão +
-- 1 cético por achado). 12 defeitos confirmados; estes são os de banco.
-- ============================================================================

-- ─── 1. Conta de teste com papel de ADMIN em produção ───────────────────────
-- cliente.teste@kuboo.com.br ("Maria Oliveira") era resíduo do seed de QA:
-- role='admin', aprovado, login vivo (último acesso 12/08). E-mail adivinhável
-- + Leaked Password Protection desligado = porta de entrada para os 834 leads,
-- CPFs/CNPJs, apólices e redistribuição de carteira. Rebaixada — is_team() e
-- is_manager() passam a negar tudo no banco, independente de sessão antiga.
update public.profiles
   set role = 'cliente', aprovado = false, permissoes = '{}'::jsonb
 where email = 'cliente.teste@kuboo.com.br'
   and role <> 'cliente';

-- ─── 2. profiles_self_insert sem trava de papel ─────────────────────────────
-- A policy antiga era só `auth.uid() = id` — em tese, um usuário podia se
-- INSERIR com role='admin'. Hoje é inalcançável (a trigger handle_new_user,
-- SECURITY DEFINER, cria o profile no signup e a PK barra o segundo INSERT),
-- mas basta UM usuário órfão de profile para virar escalada real. Defesa em
-- profundidade: auto-cadastro só como cliente, nunca aprovado.
drop policy if exists profiles_self_insert on public.profiles;
create policy profiles_self_insert on public.profiles for insert to authenticated
  with check (
    (select auth.uid()) = id
    and role = 'cliente'
    and coalesce(aprovado, false) = false
  );

-- ─── 3. Usuário órfão de QA removido de auth.users ──────────────────────────
-- qa.metarealizado@kuboo.com.br (f17a7090-…) existia em auth.users sem profile,
-- sobra do teste de 02/08. O guard `id not in (select id from profiles)` faz o
-- delete ser inofensivo se rodado de novo.
delete from auth.users
 where email = 'qa.metarealizado@kuboo.com.br'
   and id not in (select id from public.profiles);

-- ─── Nota sobre bolsao_config (corrigido no CÓDIGO, não aqui) ───────────────
-- bolsao_config tem RLS com policies só de SELECT e UPDATE — sem policy de
-- INSERT. O upsert do front virava INSERT..ON CONFLICT e era negado pelo
-- default-deny ANTES de resolver o conflito: a aba de configuração do bolsão
-- nunca salvou nada, para admin inclusive (regressão da migration fase 3, que
-- deu policy de INSERT a alertas_config e esqueceu bolsao_config).
-- DECISÃO: em vez de criar policy de INSERT, o front passou a usar UPDATE puro
-- em id=1 (src/lib/c2s.ts, salvarBolsaoConfig) — a linha única já existe desde
-- o seed e não há motivo legítimo para INSERT nessa tabela. Menos superfície.

-- ─── Conferência ────────────────────────────────────────────────────────────
-- select email, role, aprovado from public.profiles where email='cliente.teste@kuboo.com.br';
-- select polname, pg_get_expr(polwithcheck, polrelid) from pg_policy
--   where polrelid='public.profiles'::regclass and polcmd='a';

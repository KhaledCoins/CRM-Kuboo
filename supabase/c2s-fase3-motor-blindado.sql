-- ─────────────────────────────────────────────────────────────────────────────
-- C2S → CRM · FASE 3: motor blindado + destravas p/ importação dos 754
-- APLICADA em produção via MCP em 2026-08-01. Idempotente.
-- Achados da auditoria dos 6 domínios restantes (58 findings):
--  1. CRÍTICO: regra de fila numérica com valor vazio/lixo derrubava TODA a
--     captação (cast ::numeric explodia dentro do trigger AFTER INSERT e o
--     lead era rejeitado com 500). → safe_numeric + regra inválida não casa
--     + trigger com exception guard (lead cai no bolsão e o erro vira log).
--  2. leads.telefone era NOT NULL — webhook/importador/lead só-e-mail falhavam.
--  3. CHECK de urgencia não aceitava hoje/urgente (2 das 3 opções do modal).
--  4. is_team() não checava aprovado — desativado mantinha acesso via API.
--  5. RLS por dono matou a reciclagem do bolsão (SLA estourado invisível
--     pros colegas) — restaurada com a cláusula de SLA nas policies.
--  6. RLS do motor (filas/fila_usuarios/distribuicao_log/alertas/bolsao_config)
--     era is_team FOR ALL — vendedor podia furar o rodízio e adulterar a
--     auditoria via API. → split read/write com has_perm.
-- Conteúdo integral = migração c2s_fase3_motor_blindado no Supabase.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) safe_numeric: cast que nunca explode
create or replace function public.safe_numeric(t text)
returns numeric language plpgsql immutable set search_path to '' as $$
begin
  return nullif(trim(t), '')::numeric;
exception when others then
  return null;
end $$;
revoke execute on function public.safe_numeric(text) from public;
grant execute on function public.safe_numeric(text) to authenticated;

-- 2) fila_regras_match: valor de regra inválido = regra NÃO casa (nunca exceção)
create or replace function public.fila_regras_match(p_lead leads, p_regras jsonb)
returns boolean
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  r jsonb; campo text; op text; valor text; alvo text; num numeric; num_regra numeric;
begin
  if p_regras is null or jsonb_array_length(p_regras) = 0 then
    return true;
  end if;
  for r in select * from jsonb_array_elements(p_regras) loop
    campo := r->>'campo'; op := coalesce(r->>'op', 'igual'); valor := r->>'valor';
    if campo = 'etiqueta' then
      if not exists (
        select 1 from public.lead_etiquetas le
        join public.etiquetas e on e.id = le.etiqueta_id
        where le.lead_id = p_lead.id and lower(e.nome) = lower(valor)
      ) then return false; end if;
      continue;
    end if;
    alvo := case campo
      when 'modulo' then p_lead.modulo
      when 'origem' then p_lead.origem
      when 'fonte' then p_lead.fonte
      when 'canal' then p_lead.canal
      when 'campanha' then p_lead.campanha
      when 'produto_interesse' then p_lead.produto_interesse
      when 'urgencia' then p_lead.urgencia
      when 'fb_pagina' then p_lead.fb_pagina
      when 'fb_anuncio' then p_lead.fb_anuncio
      when 'fb_formulario' then p_lead.fb_formulario
      when 'score' then (p_lead.score)::text
      when 'valor_potencial' then (p_lead.valor_potencial)::text
      else null end;
    if campo in ('score', 'valor_potencial') then
      num := public.safe_numeric(alvo);
      num_regra := public.safe_numeric(valor);
      if num is null or num_regra is null then return false; end if;
      if op = 'maior' and not (num > num_regra) then return false; end if;
      if op = 'menor' and not (num < num_regra) then return false; end if;
      if op = 'igual' and not (num = num_regra) then return false; end if;
    else
      if alvo is null then return false; end if;
      if op = 'igual'  and lower(alvo) <> lower(valor) then return false; end if;
      if op = 'contem' and position(lower(valor) in lower(alvo)) = 0 then return false; end if;
    end if;
  end loop;
  return true;
end $function$;

-- 3) Trigger com rede de segurança: erro no motor NUNCA rejeita o lead
create or replace function public.trg_distribuir_lead()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.vendedor_id is null then perform public.distribuir_lead(new.id); end if;
  return new;
exception when others then
  begin
    insert into public.distribuicao_log (lead_id, motivo)
    values (new.id, 'ERRO no motor de distribuição (lead ficou no bolsão): ' || left(sqlerrm, 300));
  exception when others then null;
  end;
  return new;
end $function$;

-- 4) telefone opcional
alter table public.leads alter column telefone drop not null;

-- 5) urgencia: aceitar hoje/urgente (vocabulário do modal + prioridadeLead)
alter table public.leads drop constraint if exists leads_urgencia_check;
alter table public.leads add constraint leads_urgencia_check
  check (urgencia is null or urgencia in ('imediata','breve','pesquisando','hoje','urgente'));

-- 6) is_team exige aprovado
create or replace function public.is_team()
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.role in ('vendedor','gestor','admin')
      and coalesce(p.aprovado, true)
  );
$$;

-- 7) Reciclagem do bolsão restaurada nas policies de leads
drop policy if exists "leads_team_read" on public.leads;
create policy "leads_team_read" on public.leads for select using (
  is_team() and (
    is_manager() or vendedor_id is null or vendedor_id = (select auth.uid())
    or (primeiro_contato_em is null and sla_expira_em < now())
  )
);
drop policy if exists "leads_team_update" on public.leads;
create policy "leads_team_update" on public.leads for update
using (
  is_team() and (
    is_manager() or vendedor_id is null or vendedor_id = (select auth.uid())
    or (primeiro_contato_em is null and sla_expira_em < now())
  )
)
with check (
  is_team() and (
    is_manager() or vendedor_id is null or vendedor_id = (select auth.uid())
  )
);

-- 8) RLS do motor: escrita só com has_perm('editar_filas') / config
drop policy if exists "filas_team" on public.filas;
create policy "filas_read"  on public.filas for select to authenticated using (public.is_team());
create policy "filas_ins"   on public.filas for insert to authenticated with check (public.has_perm('editar_filas'));
create policy "filas_upd"   on public.filas for update to authenticated using (public.has_perm('editar_filas'));
create policy "filas_del"   on public.filas for delete to authenticated using (public.has_perm('editar_filas'));

drop policy if exists "fila_usuarios_team" on public.fila_usuarios;
create policy "fila_usuarios_read" on public.fila_usuarios for select to authenticated using (public.is_team());
create policy "fila_usuarios_ins"  on public.fila_usuarios for insert to authenticated with check (public.has_perm('editar_filas'));
create policy "fila_usuarios_upd"  on public.fila_usuarios for update to authenticated using (public.has_perm('editar_filas'));
create policy "fila_usuarios_del"  on public.fila_usuarios for delete to authenticated using (public.has_perm('editar_filas'));

drop policy if exists "distribuicao_log_team" on public.distribuicao_log;
create policy "dist_log_read" on public.distribuicao_log for select to authenticated using (public.is_team());
create policy "dist_log_ins"  on public.distribuicao_log for insert to authenticated with check (public.is_manager());

drop policy if exists "alertas_config_team" on public.alertas_config;
create policy "alertas_read"  on public.alertas_config for select to authenticated using (public.is_team());
create policy "alertas_ins"   on public.alertas_config for insert to authenticated with check (public.has_perm('acessar_config'));
create policy "alertas_upd"   on public.alertas_config for update to authenticated using (public.has_perm('acessar_config'));
create policy "alertas_del"   on public.alertas_config for delete to authenticated using (public.has_perm('acessar_config'));

drop policy if exists "bolsao_config_team" on public.bolsao_config;
create policy "bolsao_cfg_read" on public.bolsao_config for select to authenticated using (public.is_team());
create policy "bolsao_cfg_upd"  on public.bolsao_config for update to authenticated using (public.has_perm('editar_bolsao'));

-- ============================================================================
-- AUDITORIA DO CICLO DE VIDA DO LEAD (2026-07) — JÁ APLICADA EM PRODUÇÃO.
-- Correções: RLS por dono, catálogo de origem ampliado, telefone normalizado
-- na regra de retorno, campos do Meta p/ regras de fila, redistribuição em
-- massa. Idempotente — pode rodar de novo sem quebrar.
-- ============================================================================

-- Papel de gestão (gestor/admin) — mesma mecânica do is_team()
create or replace function public.is_manager() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('gestor','admin') and coalesce(aprovado, true)
  )
$$;

-- Origens novas no CHECK (manual = Novo lead do CRM; webhook = Make/Zapier)
alter table public.leads drop constraint if exists leads_origem_check;
alter table public.leads add constraint leads_origem_check
  check (origem in ('chatbot','formulario','whatsapp','indicacao','portal','manual','webhook'));

-- Equipe logada pode criar lead com qualquer origem do catálogo (o INSERT
-- público do site continua restrito às 5 origens originais)
drop policy if exists leads_team_insert on public.leads;
create policy leads_team_insert on public.leads
  for insert to authenticated with check (public.is_team());

-- RLS por dono: vendedor vê/edita só os próprios + os sem dono (bolsão);
-- gestor/admin vê tudo. Antes is_team() liberava tudo pra todo mundo — um
-- vendedor conseguia ler e até "roubar" lead de colega direto pela API.
drop policy if exists leads_team_read on public.leads;
create policy leads_team_read on public.leads
  for select using (
    public.is_team() and (
      public.is_manager() or vendedor_id is null or vendedor_id = (select auth.uid())
    )
  );
drop policy if exists leads_team_update on public.leads;
create policy leads_team_update on public.leads
  for update using (
    public.is_team() and (
      public.is_manager() or vendedor_id is null or vendedor_id = (select auth.uid())
    )
  ) with check (
    public.is_team() and (
      public.is_manager() or vendedor_id is null or vendedor_id = (select auth.uid())
    )
  );
drop policy if exists leads_team_delete on public.leads;
create policy leads_team_delete on public.leads
  for delete using (
    public.is_team() and (public.is_manager() or vendedor_id = (select auth.uid()))
  );

-- Campos de captação do Meta Lead Ads (viram critérios de regra de fila)
alter table public.leads add column if not exists fb_pagina text;
alter table public.leads add column if not exists fb_anuncio text;
alter table public.leads add column if not exists fb_formulario text;

-- fila_regras_match ganha os campos novos (fb_pagina/fb_anuncio/fb_formulario)
create or replace function public.fila_regras_match(p_lead public.leads, p_regras jsonb)
returns boolean language plpgsql stable set search_path = public as $$
declare
  r jsonb; campo text; op text; valor text; alvo text; num numeric;
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
      num := nullif(alvo, '')::numeric;
      if num is null then return false; end if;
      if op = 'maior' and not (num > valor::numeric) then return false; end if;
      if op = 'menor' and not (num < valor::numeric) then return false; end if;
      if op = 'igual' and not (num = valor::numeric) then return false; end if;
    else
      if alvo is null then return false; end if;
      if op = 'igual'  and lower(alvo) <> lower(valor) then return false; end if;
      if op = 'contem' and position(lower(valor) in lower(alvo)) = 0 then return false; end if;
    end if;
  end loop;
  return true;
end $$;

-- Regra de retorno: telefone comparado por dígitos (formatos diferentes =
-- mesmo número) e e-mail case-insensitive. Resto do motor inalterado.
create or replace function public.distribuir_lead(p_lead_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  l public.leads; f public.filas; alvo uuid; ant record; sla int;
begin
  select * into l from public.leads where id = p_lead_id;
  if l is null or l.vendedor_id is not null then return; end if;
  select limite_minutos into sla from public.bolsao_config where id = 1;
  sla := coalesce(sla, 20);

  for f in select * from public.filas where ativa and not is_seguranca order by ordem, created_at loop
    if not public.fila_no_horario(f.horario) then continue; end if;
    if not public.fila_regras_match(l, f.regras) then continue; end if;

    if f.dias_memoria is not null then
      select l2.vendedor_id, l2.id as lead_ant into ant
      from public.leads l2
      where l2.id <> l.id and l2.vendedor_id is not null
        and ((nullif(regexp_replace(coalesce(l.telefone,''), '\D', '', 'g'), '') is not null
              and regexp_replace(coalesce(l2.telefone,''), '\D', '', 'g')
                = regexp_replace(coalesce(l.telefone,''), '\D', '', 'g'))
          or (nullif(lower(coalesce(l.email,'')),'') is not null
              and lower(coalesce(l2.email,'')) = lower(coalesce(l.email,''))))
        and greatest(coalesce(l2.interagido_em, 'epoch'), coalesce(l2.created_at, 'epoch'))
            > now() - make_interval(days => f.dias_memoria)
        and exists (select 1 from public.fila_usuarios fu
                    where fu.fila_id = f.id and fu.user_id = l2.vendedor_id and fu.ativo)
      order by greatest(coalesce(l2.interagido_em, 'epoch'), coalesce(l2.created_at, 'epoch')) desc
      limit 1;
      if ant.vendedor_id is not null then
        alvo := ant.vendedor_id;
        update public.leads set vendedor_id = alvo, atribuido_em = now(),
          sla_expira_em = now() + make_interval(mins => sla) where id = l.id;
        update public.fila_usuarios set ultima_atribuicao = now()
          where fila_id = f.id and user_id = alvo;
        insert into public.distribuicao_log (lead_id, fila_id, user_id, motivo)
          values (l.id, f.id, alvo, format('Fila "%s": cliente retornante — mesmo consultor do atendimento anterior', f.nome));
        return;
      end if;
      continue;
    end if;

    alvo := public.fila_proximo_usuario(f);
    if alvo is not null then
      update public.leads set vendedor_id = alvo, atribuido_em = now(),
        sla_expira_em = now() + make_interval(mins => sla) where id = l.id;
      update public.fila_usuarios set ultima_atribuicao = now()
        where fila_id = f.id and user_id = alvo;
      insert into public.distribuicao_log (lead_id, fila_id, user_id, motivo)
        values (l.id, f.id, alvo, format('Fila "%s": rodízio — você era o próximo a receber', f.nome));
      return;
    end if;
  end loop;

  for f in select * from public.filas where ativa and is_seguranca order by ordem limit 1 loop
    alvo := public.fila_proximo_usuario(f);
    if alvo is not null then
      update public.leads set vendedor_id = alvo, atribuido_em = now(),
        sla_expira_em = now() + make_interval(mins => sla) where id = l.id;
      insert into public.distribuicao_log (lead_id, fila_id, user_id, motivo)
        values (l.id, f.id, alvo, format('Fila de segurança "%s": nenhuma outra fila atribuiu este lead', f.nome));
      return;
    end if;
  end loop;

  insert into public.distribuicao_log (lead_id, motivo)
    values (l.id, 'Nenhuma fila ativa atribuiu — lead disponível no bolsão');
end $$;

revoke execute on function public.distribuir_lead(uuid) from anon, authenticated;
revoke execute on function public.is_manager() from anon;

-- Redistribuição em massa (paridade "Redistribuir" do C2S): gestor manda todos
-- os leads sem dono passarem pelo motor de novo. Guarda interna de papel.
create or replace function public.redistribuir_bolsao()
returns int language plpgsql security definer set search_path = public as $$
declare
  r record; antes uuid; n int := 0;
begin
  if not public.is_manager() then
    raise exception 'Apenas gestores podem redistribuir o bolsão';
  end if;
  for r in select id from public.leads
           where vendedor_id is null and coalesce(descartado, false) = false
           order by created_at loop
    perform public.distribuir_lead(r.id);
    select vendedor_id into antes from public.leads where id = r.id;
    if antes is not null then n := n + 1; end if;
  end loop;
  return n;
end $$;
revoke execute on function public.redistribuir_bolsao() from anon;
grant execute on function public.redistribuir_bolsao() to authenticated;

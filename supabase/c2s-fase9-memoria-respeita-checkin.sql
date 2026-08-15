-- ============================================================================
-- FASE 9 — A "Regra retorno" passa a respeitar check-in e aprovação.
-- JÁ APLICADO EM PRODUÇÃO (14/08/2026, via MCP). Idempotente.
--
-- Achado da auditoria de 8 dimensões (confirmado pelo cético): o ramo de
-- memória do distribuir_lead elegia o dono anterior só com
--   exists (select 1 from fila_usuarios fu where ... and fu.ativo)
-- sem olhar profiles.disponivel nem profiles.aprovado — enquanto o rodízio
-- (fila_proximo_usuario) filtra os dois. Consequência: consultor de FÉRIAS
-- (check-out feito no Perfil) continuava recebendo cliente retornante, com
-- SLA de 20min correndo, e o lead só voltava a circular ao estourar.
--
-- A correção é a mesma régua do rodízio no EXISTS do ramo de memória. Quando
-- o dono anterior não está elegível, o `continue` existente derruba o lead
-- pro rodízio — exatamente o que a tela de Check-in promete.
--
-- O resto da função é IDÊNTICO à versão viva (conferida por
-- pg_get_functiondef antes desta migração): fallback de segurança via
-- fila_proximo_usuario_seguranca, fallback final em admin, log no bolsão.
-- ============================================================================

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
        -- FASE 9: mesma régua do rodízio. Antes só exigia fu.ativo; consultor
        -- em check-out (férias) ou reprovado seguia recebendo o retornante.
        and exists (select 1 from public.fila_usuarios fu
                    join public.profiles p on p.id = fu.user_id
                    where fu.fila_id = f.id and fu.user_id = l2.vendedor_id and fu.ativo
                      and coalesce(p.aprovado, true)
                      and coalesce(p.disponivel, true))
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

  -- FALLBACK INCONDICIONAL: ignora check-in/limite (a rede de segurança existe
  -- justamente pro cenário em que o plantonista está ausente ou lotado).
  for f in select * from public.filas where ativa and is_seguranca order by ordem limit 1 loop
    alvo := public.fila_proximo_usuario_seguranca(f);
    if alvo is not null then
      update public.leads set vendedor_id = alvo, atribuido_em = now(),
        sla_expira_em = now() + make_interval(mins => sla) where id = l.id;
      update public.fila_usuarios set ultima_atribuicao = now()
        where fila_id = f.id and user_id = alvo;
      insert into public.distribuicao_log (lead_id, fila_id, user_id, motivo)
        values (l.id, f.id, alvo, format('Fila de segurança "%s": nenhuma outra fila atribuiu este lead', f.nome));
      return;
    end if;
  end loop;

  -- Última linha de defesa: qualquer admin aprovado (nem a fila de segurança pegou).
  select p.id into alvo from public.profiles p
   where p.role = 'admin' and coalesce(p.aprovado, true) order by p.name limit 1;
  if alvo is not null then
    update public.leads set vendedor_id = alvo, atribuido_em = now(),
      sla_expira_em = now() + make_interval(mins => sla) where id = l.id;
    insert into public.distribuicao_log (lead_id, user_id, motivo)
      values (l.id, alvo, 'Fallback final: nenhuma fila atribuiu — direcionado ao administrador');
    return;
  end if;

  insert into public.distribuicao_log (lead_id, motivo)
    values (l.id, 'Nenhuma fila ativa atribuiu — lead disponível no bolsão');
end $$;

revoke execute on function public.distribuir_lead(uuid) from anon, authenticated, public;

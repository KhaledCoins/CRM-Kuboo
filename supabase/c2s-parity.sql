-- ============================================================================
-- C2S PARITY — motor de distribuição + atividades + etiquetas + observações +
-- mensagens prontas + motivos de arquivamento + alertas + permissões + bolsão.
-- Rodar no SQL Editor do Supabase (idempotente: pode rodar de novo sem quebrar).
-- Modelado a partir do scan da conta admin do Contact2Sale (docs/C2S-SCAN.md).
-- ============================================================================

-- ─── 1. Colunas novas em leads (captação rica + interação) ──────────────────
alter table public.leads add column if not exists campanha text;
alter table public.leads add column if not exists fonte text;      -- ex.: Instagram Leads, Facebook Leads, Site, Kubinho
alter table public.leads add column if not exists canal text;      -- ex.: Internet, WhatsApp, Telefone
alter table public.leads add column if not exists formulario jsonb; -- respostas do form do anúncio (pergunta→resposta)
alter table public.leads add column if not exists interagido_em timestamptz; -- última interação de equipe

-- ─── 2. Permissões granulares + assinatura no perfil ────────────────────────
alter table public.profiles add column if not exists permissoes jsonb not null default '{}'::jsonb;
alter table public.profiles add column if not exists assinatura text;
-- o usuário pode editar a PRÓPRIA assinatura (grant por coluna — o resto do
-- profile continua travado pelo fix de escalada de privilégio)
grant update (assinatura) on public.profiles to authenticated;
-- chaves de permissoes (default: gestor/admin = tudo true; vendedor = tudo false):
-- editar_usuarios, editar_filas, editar_bolsao, editar_etiquetas,
-- acessar_config, acessar_financeiro, extrair_relatorios, visivel_relatorios(bool, default true)

-- ─── 3. Etiquetas de lead ───────────────────────────────────────────────────
create table if not exists public.etiquetas (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  cor text not null default '#1873BA',
  ativa boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.lead_etiquetas (
  lead_id uuid not null references public.leads(id) on delete cascade,
  etiqueta_id uuid not null references public.etiquetas(id) on delete cascade,
  primary key (lead_id, etiqueta_id)
);

-- ─── 4. Atividades (follow-up) do lead ──────────────────────────────────────
create table if not exists public.lead_atividades (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  tipo text not null default 'retornar', -- retornar | primeiro_contato | visita | reuniao | proposta | outro
  titulo text not null,
  quando timestamptz not null,
  status text not null default 'pendente', -- pendente | concluida | cancelada
  criado_por uuid references public.profiles(id),
  concluida_em timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists lead_atividades_lead_idx on public.lead_atividades (lead_id, status, quando);
create index if not exists lead_atividades_quando_idx on public.lead_atividades (status, quando);

-- ─── 5. Observações do lead (notas com autor e hora) ────────────────────────
create table if not exists public.lead_observacoes (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  texto text not null,
  criado_por uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists lead_observacoes_lead_idx on public.lead_observacoes (lead_id, created_at desc);

-- ─── 6. Favoritos (por usuário) ─────────────────────────────────────────────
create table if not exists public.lead_favoritos (
  user_id uuid not null references public.profiles(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, lead_id)
);

-- ─── 7. Mensagens prontas (templates com variáveis) ─────────────────────────
-- Variáveis suportadas no front: [NOME_CONTATO], [NOME_VENDEDOR], [TELEFONE_VENDEDOR],
-- [ASSINATURA], [PRODUTO], [CAMPANHA], [NOME_ATIVIDADE], [DATA_ATIVIDADE]
create table if not exists public.mensagens_prontas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  conteudo text not null,
  ativa boolean not null default true,
  ordem int not null default 0,
  created_at timestamptz not null default now()
);

-- ─── 8. Motivos de arquivamento (catálogo gerenciável) ──────────────────────
create table if not exists public.motivos_arquivamento (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  ativo boolean not null default true
);
insert into public.motivos_arquivamento (nome) values
  ('Apenas pesquisando'), ('Cliente não responde'), ('Compra adiada'),
  ('Contato inválido'), ('Corretor parceiro'), ('DDD distante'),
  ('Fechou com concorrente'), ('Já possui seguro'), ('Lead duplicado'),
  ('Localização não atendida'), ('Não consegui contato'), ('Não possui renda'),
  ('Preço alto'), ('Problema no atendimento'), ('Proposta inviável'),
  ('Ficha recusada'), ('Tratada com qualificação'), ('Tratada sem qualificação'),
  ('Outros')
on conflict (nome) do nothing;

-- ─── 9. Alertas de sem-atendimento (escada de escalação) ────────────────────
create table if not exists public.alertas_config (
  id uuid primary key default gen_random_uuid(),
  minutos int not null,                 -- lead sem atendimento há X minutos
  notificar text not null default 'usuario' check (notificar in ('usuario','gestores')),
  ativo boolean not null default true
);
insert into public.alertas_config (minutos, notificar)
select v.m, v.n from (values (30,'usuario'),(60,'usuario'),(360,'usuario'),(1440,'usuario'),(60,'gestores'),(300,'gestores')) as v(m,n)
where not exists (select 1 from public.alertas_config);

-- ─── 10. Config do bolsão ───────────────────────────────────────────────────
create table if not exists public.bolsao_config (
  id int primary key default 1 check (id = 1),  -- linha única
  ativo boolean not null default true,
  limite_minutos int not null default 20,        -- tempo p/ interagir antes de cair no bolsão
  escopo text not null default 'empresa' check (escopo in ('empresa','equipe')),
  horario jsonb                                  -- {seg:{ini:'08:00',fim:'20:00',ativo:true}, ...}
);
insert into public.bolsao_config (id) values (1) on conflict (id) do nothing;

-- ─── 11. FILAS DE DISTRIBUIÇÃO (o coração do C2S) ───────────────────────────
create table if not exists public.filas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  ordem int not null default 0,          -- prioridade: menor = avaliada primeiro
  ativa boolean not null default true,
  is_seguranca boolean not null default false, -- fallback final (leads sem fila caem aqui)
  dias_memoria int,                      -- se setado: fila de RETORNO (lead volta pro mesmo vendedor)
  limite_abertos int,                    -- máx. de leads abertos por vendedor p/ receber
  regras jsonb not null default '[]'::jsonb,
  -- regras: [{campo, op, valor}] — campo ∈ modulo|origem|fonte|canal|campanha|
  --   produto_interesse|urgencia|etiqueta|score|valor_potencial ·
  --   op ∈ igual|contem|maior|menor
  horario jsonb,                         -- plantão da fila {seg:{ini,fim,ativo},...} (null = sempre)
  created_at timestamptz not null default now()
);
create table if not exists public.fila_usuarios (
  fila_id uuid not null references public.filas(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  ativo boolean not null default true,
  ultima_atribuicao timestamptz,
  primary key (fila_id, user_id)
);
create table if not exists public.distribuicao_log (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  fila_id uuid references public.filas(id) on delete set null,
  user_id uuid references public.profiles(id),
  motivo text not null,                  -- "Por que recebi este lead?"
  created_at timestamptz not null default now()
);
create index if not exists distribuicao_log_lead_idx on public.distribuicao_log (lead_id, created_at desc);

-- ─── 12. Funções do motor ───────────────────────────────────────────────────

-- Um lead está "aberto" p/ efeito de limite? (não descartado, não ganho/perdido)
create or replace function public.lead_aberto(l public.leads) returns boolean
language sql immutable as $$
  select coalesce(l.descartado, false) = false
     and coalesce(l.etapa, '') not in ('ganho', 'perdido')
$$;

-- As regras (jsonb) casam com o lead?
create or replace function public.fila_regras_match(p_lead public.leads, p_regras jsonb)
returns boolean language plpgsql stable as $$
declare
  r jsonb; campo text; op text; valor text; alvo text; num numeric;
begin
  if p_regras is null or jsonb_array_length(p_regras) = 0 then
    return true; -- sem condição = pega qualquer lead (igual ao C2S)
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

-- A fila está dentro do horário de plantão agora? (null = sempre; America/Sao_Paulo)
create or replace function public.fila_no_horario(p_horario jsonb)
returns boolean language plpgsql stable as $$
declare
  dia text; cfg jsonb; agora time;
begin
  if p_horario is null then return true; end if;
  dia := (array['dom','seg','ter','qua','qui','sex','sab'])
         [extract(dow from (now() at time zone 'America/Sao_Paulo'))::int + 1];
  cfg := p_horario->dia;
  if cfg is null or coalesce((cfg->>'ativo')::boolean, false) = false then return false; end if;
  agora := (now() at time zone 'America/Sao_Paulo')::time;
  return agora >= coalesce((cfg->>'ini')::time, '00:00'::time)
     and agora <= coalesce((cfg->>'fim')::time, '23:59'::time);
end $$;

-- Escolhe o próximo do rodízio na fila (respeita limite de abertos da fila)
create or replace function public.fila_proximo_usuario(p_fila public.filas)
returns uuid language sql stable as $$
  select fu.user_id
  from public.fila_usuarios fu
  join public.profiles p on p.id = fu.user_id
  where fu.fila_id = p_fila.id and fu.ativo
    and coalesce(p.aprovado, true)
    and (p_fila.limite_abertos is null or (
      select count(*) from public.leads l
      where l.vendedor_id = fu.user_id and public.lead_aberto(l)
    ) < p_fila.limite_abertos)
  order by fu.ultima_atribuicao asc nulls first
  limit 1
$$;

-- MOTOR: distribui um lead pelas filas (ordem → regras → memória/rodízio → segurança)
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
      -- FILA DE RETORNO: mesmo telefone/email atendido recentemente → mesmo vendedor
      select l2.vendedor_id, l2.id as lead_ant into ant
      from public.leads l2
      where l2.id <> l.id and l2.vendedor_id is not null
        and ((nullif(l.telefone,'') is not null and l2.telefone = l.telefone)
          or (nullif(l.email,'')    is not null and l2.email    = l.email))
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
      continue; -- fila de memória sem match anterior → tenta a próxima fila
    end if;

    -- RODÍZIO
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

  -- FILA DE SEGURANÇA (fallback)
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

  -- ninguém pegou → fica no bolsão (comportamento atual), registra o porquê
  insert into public.distribuicao_log (lead_id, motivo)
    values (l.id, 'Nenhuma fila ativa atribuiu — lead disponível no bolsão');
end $$;

-- Trigger: todo lead novo sem dono passa pelo motor
create or replace function public.trg_distribuir_lead() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.vendedor_id is null then perform public.distribuir_lead(new.id); end if;
  return new;
end $$;
drop trigger if exists leads_distribuir on public.leads;
create trigger leads_distribuir after insert on public.leads
  for each row execute function public.trg_distribuir_lead();

-- ─── 13. RLS (equipe gerencia tudo; is_team() já existe do schema base) ─────
do $$
declare t text;
begin
  foreach t in array array['etiquetas','lead_etiquetas','lead_atividades','lead_observacoes',
    'lead_favoritos','mensagens_prontas','motivos_arquivamento','alertas_config',
    'bolsao_config','filas','fila_usuarios','distribuicao_log']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I_team on public.%I', t, t);
    execute format('create policy %I_team on public.%I for all to authenticated using (public.is_team()) with check (public.is_team())', t, t);
  end loop;
end $$;

-- ─── 14. Seed das filas espelhando a configuração REAL do C2S da Kuboo ──────
-- (Regra retorno 16 dias → Rodízio igualitário → Segurança: admin)
insert into public.filas (nome, ordem, ativa, dias_memoria)
select 'Regra retorno', 1, true, 16
where not exists (select 1 from public.filas where nome = 'Regra retorno');
insert into public.filas (nome, ordem, ativa)
select 'Rodízio igualitário', 2, true
where not exists (select 1 from public.filas where nome = 'Rodízio igualitário');
insert into public.filas (nome, ordem, ativa, is_seguranca)
select 'Fila de segurança', 99, true, true
where not exists (select 1 from public.filas where is_seguranca);

-- Popula as filas com a equipe atual (vendedores/gestores/admin aprovados);
-- a fila de segurança recebe só admins.
insert into public.fila_usuarios (fila_id, user_id)
select f.id, p.id from public.filas f
join public.profiles p on p.role in ('vendedor','gestor','admin') and coalesce(p.aprovado, true)
where f.nome in ('Regra retorno','Rodízio igualitário')
on conflict do nothing;
insert into public.fila_usuarios (fila_id, user_id)
select f.id, p.id from public.filas f
join public.profiles p on p.role = 'admin' and coalesce(p.aprovado, true)
where f.is_seguranca
on conflict do nothing;

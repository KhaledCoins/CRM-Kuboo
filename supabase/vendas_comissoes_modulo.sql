-- Venda e comissão passam a saber de QUAL NEGÓCIO são.
-- Aplicado em 21/08/2026, com vendas e comissoes AINDA VAZIAS (0 linhas) —
-- por isso não há migração de dados.
--
-- O card "Meta × Realizado" filtrava as METAS por módulo mas somava TODAS as
-- vendas. Sem módulo na tabela, a produção de Seguros era creditada na meta de
-- Consórcios: R$ 300 mil de seguro auto viravam 6% da meta de R$ 5 milhões de
-- consórcio — e uma meta menor estamparia "Meta batida" com uma equipe de
-- consórcio que não vendeu nada.
alter table public.vendas    add column if not exists modulo text not null default 'seguros';
alter table public.comissoes add column if not exists modulo text not null default 'seguros';

do $$ begin
  alter table public.vendas add constraint vendas_modulo_check check (modulo in ('seguros','consorcios'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.comissoes add constraint comissoes_modulo_check check (modulo in ('seguros','consorcios'));
exception when duplicate_object then null; end $$;

create index if not exists vendas_modulo_data_idx on public.vendas (modulo, data_venda);
create index if not exists comissoes_modulo_idx on public.comissoes (modulo);

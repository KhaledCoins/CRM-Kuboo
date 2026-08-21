-- APLICADA EM PRODUÇÃO em 2026-08-21 (migration vendas_cancelamento_em_cascata).
-- Espelho para histórico — não precisa rodar de novo.
--
-- PROBLEMA (auditoria 21/08): cancelar uma venda não cancelava o que ela gerou.
-- A COMISSÃO continuava 'a_pagar' e as PARCELAS continuavam 'aberta' — ou seja,
-- o gestor podia pagar comissão de negócio desfeito e a cobrança seguia viva.
-- Não havia trigger nenhum em vendas (conferido em information_schema.triggers)
-- e as telas de Comissões/Parcelas não cruzam o status da venda: nenhuma camada
-- pegava isso. As tabelas estavam vazias quando o defeito foi achado, então
-- ninguém foi prejudicado — mas dispararia no primeiro dia de uso real.
--
-- REGRA: só desce o cancelamento, nunca "descancela" sozinho. Comissão já PAGA
-- e parcela já PAGA ficam como estão (dinheiro que saiu é fato contábil; o
-- estorno é decisão humana). Reabrir venda é ação consciente do gestor.
--
-- PROVADO em produção com dados temporários + rollback:
--   comissao a_pagar -> cancelada | comissao JA PAGA -> paga
--   parcela aberta   -> cancelada | parcela JA PAGA  -> paga
create or replace function public.vendas_cancelar_em_cascata()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'cancelada' and coalesce(old.status, '') is distinct from 'cancelada' then
    update public.comissoes
       set status = 'cancelada'
     where venda_id = new.id and status = 'a_pagar';

    update public.parcelas
       set status = 'cancelada'
     where venda_id = new.id and status in ('aberta', 'atrasada');
  end if;
  return new;
end $$;

revoke execute on function public.vendas_cancelar_em_cascata() from public, anon, authenticated;

drop trigger if exists vendas_cancelar_cascata on public.vendas;
create trigger vendas_cancelar_cascata
  after update of status on public.vendas
  for each row
  execute function public.vendas_cancelar_em_cascata();

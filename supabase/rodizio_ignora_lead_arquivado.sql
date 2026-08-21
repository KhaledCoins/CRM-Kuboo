-- Lead que JÁ NASCE arquivado (hoje: o lead de teste da Meta, barrado nos dois
-- endpoints de captação — api/_teste.js) não pode consumir a vez de um
-- consultor no rodízio: o consultor "recebia" um lead falso e perdia o próximo
-- lead de verdade pra quem vinha depois na fila. A condição só ADICIONA
-- restrição — nenhum lead que era distribuído antes deixa de ser.
-- Aplicado em 21/08/2026. Provado em transação com rollback:
--   lead normal          -> recebeu dono + SLA
--   lead nasce arquivado -> sem dono, sem SLA
create or replace function public.trg_distribuir_lead()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- Lead espelhado do C2S não entra no rodízio: quem manda na atribuição
  -- durante o período em paralelo é o C2S.
  if new.vendedor_id is null and new.c2s_lead_id is null and new.descartado is not true then
    begin
      perform public.distribuir_lead(new.id);
    exception when others then
      -- Falhou distribuir? O lead fica no bolsão e o erro vira log.
      -- NUNCA derrubar o insert por causa disso.
      raise warning 'distribuir_lead falhou para % : %', new.id, sqlerrm;
    end;
  end if;
  return new;
end $function$;

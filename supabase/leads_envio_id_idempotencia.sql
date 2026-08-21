-- Identidade do ENVIO, gerada no navegador do cliente (site).
-- Aplicado em 21/08/2026 — ver src/lib/leadQueue.ts no repo do Site.
--
-- O site grava lead direto na tabela e tem fila offline que reenvia o que
-- falhou. Três buracos vinham da falta de identidade do envio:
--   1. resposta perdida no caminho (o insert ENTROU, o cliente perdeu a rede
--      antes do OK) — o retry inseria de novo;
--   2. dois drenos concorrentes ("voltou a conexão" + "aba reapareceu" no
--      mesmo instante) inserindo o mesmo item;
--   3. o dreno regravava a fila com um retrato velho, apagando lead que o
--      cliente mandou DURANTE o dreno.
-- Com a chave, reenviar é seguro: a 2ª tentativa bate no índice único e volta
-- 23505, que o cliente trata como "já entrou" — não como falha.
--
-- Índice PARCIAL: lead que entra pelo CRM, pelo Make ou pelo C2S não tem
-- chave, e vários NULL não colidem entre si.
alter table public.leads add column if not exists envio_id text;

create unique index if not exists leads_envio_id_uidx
  on public.leads (envio_id) where envio_id is not null;

drop policy if exists leads_public_insert on public.leads;
create policy leads_public_insert on public.leads
  for insert to anon, authenticated
  with check (
    origem = any (array['chatbot','formulario','whatsapp','indicacao','portal'])
    and vendedor_id is null
    and status = 'novo'
    and etapa = 'novos'
    and descartado = false
    and c2s_lead_id is null
    and primeiro_contato_em is null
    and interagido_em is null
    and convertido_em is null
    and atribuido_em is null
    and sla_expira_em is null
    and valor_potencial is null
    and motivo_descarte is null
    -- formato travado: sem isto o campo viraria texto livre de anônimo
    and (envio_id is null or envio_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
  );

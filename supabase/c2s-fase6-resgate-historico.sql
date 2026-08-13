-- ============================================================================
-- FASE 6 — RESGATE DO HISTÓRICO DOS 818 LEADS IMPORTADOS DO C2S
--
-- Achado da varredura de 12/08/2026: a importação (RPC import_c2s_leads,
-- chamada do console do C2S) jogou TODOS os leads com created_at = data da
-- importação (11/08) e não gravou o motivo de arquivamento na coluna própria.
-- Os dados verdadeiros não se perderam — ficaram no texto de `mensagem`, no
-- rodapé que a própria importação montou:
--
--   "Natureza: Indefinido | Motivo arquivamento: Cliente não respondeu
--    | Recebido no C2S: 18 de Junho de 2026 às 03:46 | Importado do Contact2Sale"
--
-- O que isso quebrava:
--   - Dashboards "leads por dia": pico artificial de 818 em 11/08 e VAZIO nos
--     5 meses reais de captação (16/03 a 11/08) — inútil pra ler sazonalidade.
--   - Dashboards "motivos de arquivamento": gráfico vazio apesar de 731 leads
--     arquivados, porque motivo_descarte estava NULL em 100% deles.
--   - Lead 360º: não mostrava por que o lead foi perdido.
--   - "há quanto tempo esse lead existe" mentia em até 5 meses.
--
-- SEGURANÇA DA OPERAÇÃO (conferido antes de rodar):
--   - leads_distribuir é AFTER **INSERT** — UPDATE não aciona o motor de filas.
--   - leads_updated_at só carimba updated_at.
--   - Só 1 lead da base inteira é elegível pra escada de alertas e 1 tem SLA
--     pendente, então recuar as datas NÃO inunda o sino de avisos.
--   - Parser validado em dry-run: 818/818 casaram, 0 datas nulas.
--   - O rodapé fica em `mensagem` de propósito: é a trilha de auditoria da
--     importação. Não apagar.
-- ============================================================================

-- ─── 1. created_at e atribuido_em ← data real do C2S ────────────────────────
-- O C2S mostra data/hora no fuso de São Paulo; `at time zone` converte pra UTC.
-- atribuido_em acompanha: no C2S o lead já nascia com dono, e deixá-lo em 11/08
-- faria "tempo até atribuição" render meses de atraso que nunca existiram.
with capturado as (
  select id,
         regexp_match(
           mensagem,
           'Recebido no C2S: ([0-9]{1,2}) de ([A-Za-zÇç]+) de ([0-9]{4}) às ([0-9]{1,2}):([0-9]{2})'
         ) as g
  from public.leads
  where mensagem like '%Importado do Contact2Sale%'
), convertido as (
  select id,
         (make_timestamp(
            g[3]::int,
            case lower(g[2])
              when 'janeiro'   then  1 when 'fevereiro' then  2
              when 'março'     then  3 when 'marco'     then  3
              when 'abril'     then  4 when 'maio'      then  5
              when 'junho'     then  6 when 'julho'     then  7
              when 'agosto'    then  8 when 'setembro'  then  9
              when 'outubro'   then 10 when 'novembro'  then 11
              when 'dezembro'  then 12
            end,
            g[1]::int, g[4]::int, g[5]::int, 0
          ) at time zone 'America/Sao_Paulo') as quando
  from capturado
  where g is not null
)
update public.leads l
   set created_at   = c.quando,
       atribuido_em = case when l.vendedor_id is not null then c.quando else l.atribuido_em end
  from convertido c
 where l.id = c.id
   and c.quando is not null
   -- Idempotente: só mexe em quem ainda está com a data da importação.
   and l.created_at::date > c.quando::date;

-- ─── 2. motivo_descarte ← motivo real do arquivamento ───────────────────────
-- Os rótulos do C2S não são idênticos aos do catálogo do CRM
-- (motivos_arquivamento). Onde é a MESMA coisa escrita diferente, normalizo
-- pro rótulo do CRM — senão o gráfico de motivos abriria duas fatias pro mesmo
-- motivo ("Cliente não respondeu" e "Cliente não responde") pra sempre.
-- Onde o motivo é genuinamente distinto, preservo a palavra do C2S e adiciono
-- ao catálogo (passo 3), pra dropdown e relatório falarem a mesma língua.
update public.leads l
   set motivo_descarte = case trim(m.bruto)
         when 'Cliente não respondeu'          then 'Cliente não responde'
         when 'Contato Inválido'               then 'Contato inválido'
         when 'Fechou negócio em outro lugar'  then 'Fechou com concorrente'
         else trim(m.bruto)
       end
  from (
    select id, substring(mensagem from 'Motivo arquivamento: ([^|]+)') as bruto
      from public.leads
     where mensagem like '%Importado do Contact2Sale%'
  ) m
 where l.id = m.id
   and m.bruto is not null
   and trim(m.bruto) <> ''
   and l.motivo_descarte is null;   -- não sobrescreve motivo escolhido pela equipe

-- ─── 3. Motivos do C2S que faltavam no catálogo ─────────────────────────────
-- Sem isso o gráfico mostra motivos que a equipe não consegue escolher de novo.
insert into public.motivos_arquivamento (nome)
select v.nome from (values
  ('Falta de interação do usuário'),
  ('Prazo de entrega'),
  ('Produto não agradou')
) as v(nome)
where not exists (
  select 1 from public.motivos_arquivamento existente where existente.nome = v.nome
);

-- ─── Conferência ────────────────────────────────────────────────────────────
-- select created_at::date, count(*) from public.leads group by 1 order by 1;
-- select motivo_descarte, count(*) from public.leads where descartado group by 1 order by 2 desc;

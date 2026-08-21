-- APLICADA EM PRODUÇÃO em 2026-08-21 (migration leads_public_insert_inclui_authenticated).
-- Espelho para histórico — não precisa rodar de novo.
--
-- BUG QUE ISTO CORRIGE (achado na auditoria de 21/08, provado ao vivo):
-- O site usa UM único client Supabase, que também é o do login do Portal do
-- Cliente. Com sessão ativa, o PostgREST roda como `authenticated` e não como
-- `anon` — e a policy pública era `to anon` APENAS. Resultado: todo lead criado
-- por um cliente LOGADO era recusado por RLS (42501). Como os 4 caminhos de
-- captação do site gravam fire-and-forget (só console.error), a tela dizia
-- "enviado" e o lead simplesmente não existia.
-- Atingia justamente o público mais valioso: cross-sell de quem já é cliente,
-- e o gate da Cotação Online (score 85, o lead mais quente do site).
-- O chatbot Kubinho roda DENTRO do portal (ClientPortal.tsx), então o cliente
-- logado tinha o formulário de lead na cara dele.
--
-- Mesmo padrão que sinistros_chamados já usava (to anon, authenticated) —
-- leads tinha ficado para trás.
--
-- SEGURANÇA: o WITH CHECK é IDÊNTICO ao da FASE 7. Reprovado ao vivo depois de
-- aplicar: cliente logado NÃO forja dono, NÃO forja etapa 'ganho', NÃO forja
-- valor_potencial, e continua lendo 0 leads. Só ganhou o direito de criar um
-- lead limpo — exatamente o que o anônimo já podia.
drop policy if exists leads_public_insert on public.leads;
create policy leads_public_insert on public.leads
  for insert to anon, authenticated
  with check (
    (origem = any (array['chatbot','formulario','whatsapp','indicacao','portal']))
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
  );

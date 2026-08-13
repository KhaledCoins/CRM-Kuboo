-- ============================================================================
-- FASE 7 — O INSERT PÚBLICO DE LEAD SÓ PODE CRIAR LEAD NOVO DE VERDADE
-- JÁ APLICADO EM PRODUÇÃO (13/08/2026). Idempotente.
--
-- Achado da varredura geral: a policy `leads_public_insert` travava só
-- `origem`, `vendedor_id` e `status`. TODO o resto era forjável por qualquer
-- visitante anônimo com a chave publishable (que é pública por definição —
-- está no bundle do site). Confirmado ao vivo, 201 em todos:
--
--   etapa: 'ganho'          -> negócio FECHADO falso no funil e nos dashboards
--   descartado: true        -> lead nasce arquivado; some sem ninguém ver
--   valor_potencial: 9999999-> envenena o KPI de receita potencial
--   primeiro_contato_em     -> forja cumprimento de SLA; o relatório de tempo
--                              de 1ª resposta passa a mentir
--   convertido_em           -> forja data de conversão
--   c2s_lead_id: 'x'        -> ATAQUE À MIGRAÇÃO: o webhook do C2S casa por
--                              esse campo, então um id forjado sequestra ou
--                              bloqueia a adoção do lead real que vier do C2S
--   motivo_descarte         -> texto livre no relatório de motivos
--
-- Não é vazamento (RLS de leitura segue fechada — anon lê 0 linhas em tudo),
-- é CORRUPÇÃO: dá pra estragar funil, metas, comissão e relatório de SLA.
--
-- A correção prende cada coluna que o site NÃO envia. Conferido campo a campo
-- nos 3 pontos de captação antes de escrever:
--   Contact.tsx, KubinhoChatbot.tsx (x2) e CotacaoAgger.tsx mandam apenas
--   nome, telefone, email, produto_interesse, mensagem, origem, modulo,
--   status, urgencia, score, fonte, canal.
-- `score` continua livre de propósito (o site manda 60 e a Cotação manda 85);
-- o CHECK da tabela já o limita a 0..100 e ele não vira dinheiro em relatório.
--
-- As colunas que o MOTOR preenche (vendedor_id, atribuido_em, sla_expira_em)
-- exigidas NULL aqui não conflitam com o trigger: `leads_distribuir` é AFTER
-- INSERT, roda depois do WITH CHECK. VALIDADO ao vivo — os 3 payloads reais do
-- site deram 201 e o rodízio distribuiu normalmente, com SLA.
-- ============================================================================

drop policy if exists leads_public_insert on public.leads;
create policy leads_public_insert on public.leads for insert to anon
with check (
  origem = any (array['chatbot','formulario','whatsapp','indicacao','portal'])
  and vendedor_id is null
  and status = 'novo'
  and etapa = 'novos'            -- default da coluna; bloqueia nascer em 'ganho'
  and descartado = false
  and c2s_lead_id is null        -- protege a adoção do webhook do C2S
  and primeiro_contato_em is null
  and interagido_em is null
  and convertido_em is null
  and atribuido_em is null
  and sla_expira_em is null
  and valor_potencial is null
  and motivo_descarte is null
);

-- ─── Conferência (rodar depois de aplicar) ──────────────────────────────────
-- Com a chave publishable, POST /rest/v1/leads deve dar:
--   201 para o payload do site (origem formulario/chatbot + score + fonte/canal)
--   401 para qualquer um destes: etapa=ganho, descartado=true, c2s_lead_id,
--       valor_potencial, primeiro_contato_em, convertido_em, vendedor_id,
--       status=convertido, origem fora do catálogo, motivo_descarte.

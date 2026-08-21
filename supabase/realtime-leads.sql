-- APLICADA EM PRODUÇÃO em 2026-08-21 (via MCP, migration realtime_leads).
-- Espelho para histórico — não precisa rodar de novo.
--
-- Realtime na tabela leads: o Layout assina postgres_changes filtrado por
-- vendedor_id e avisa o dono NA HORA (toast + Notification API) quando um lead
-- do Meta cai pra ele — antes o primeiro sinal dependia do poll de 60s do sino,
-- e um lead recém-atribuído nem qualificava pra aviso (só com SLA ≤10min).
-- Segurança: o Realtime respeita a RLS de leads; cada usuário só recebe evento
-- de linha que já poderia ler pelo SELECT normal.
alter publication supabase_realtime add table public.leads;

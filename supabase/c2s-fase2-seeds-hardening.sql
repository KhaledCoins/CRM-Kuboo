-- ─────────────────────────────────────────────────────────────────────────────
-- C2S → CRM · FASE 2: seeds operacionais + hardening (auditoria de paridade 31/07)
-- Aplicada em produção via MCP em 2026-07-31. Idempotente.
--
-- Motivos (achados da auditoria de 10 domínios):
--  1. mensagens_prontas = 0 em produção — o C2S da Kuboo tem ~10 templates reais;
--     a equipe migraria para um composer vazio. Seed adaptado imobiliário→seguros.
--  2. etiquetas = 0 — painel de etiquetas do lead era um beco sem saída.
--  3. Faltavam 2 motivos de arquivamento aplicáveis ('De planilha' p/ a importação
--     dos 754 leads; 'Vendedor pesquisando' = concorrente cotando).
--  4. leads_public_insert só validava origem — anon podia forjar vendedor_id/status.
--  5. Permissões granulares (editar_etiquetas/acessar_config) existiam só no client;
--     RLS era is_team FOR ALL. has_perm() leva o can() do front para o banco.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 1) Seed: mensagens prontas (paridade com os templates reais do C2S) ─────
insert into public.mensagens_prontas (nome, conteudo, ativa, ordem)
select v.nome, v.conteudo, true, v.ordem from (values
  ('Mensagem de abertura', 'Olá [NOME_CONTATO], tudo bem? Aqui é o [NOME_VENDEDOR], consultor da Kuboo Corretora de Seguros. Recebi seu interesse em [PRODUTO] e vou cuidar do seu atendimento. Pode me confirmar se este é o melhor número para conversarmos?', 1),
  ('Pedir número de telefone', 'Olá [NOME_CONTATO]! Aqui é o [NOME_VENDEDOR], da Kuboo Seguros. Para agilizar sua cotação de [PRODUTO], pode me confirmar o melhor número de WhatsApp para contato? Se preferir, também pode me chamar direto: [TELEFONE_VENDEDOR].', 2),
  ('Quando o cliente não atende', 'Oi [NOME_CONTATO], tentei falar com você agora há pouco mas não consegui. Quando tiver um minutinho, me retorna aqui no WhatsApp ou no [TELEFONE_VENDEDOR]? Quero garantir as melhores condições na sua cotação de [PRODUTO]. Obrigado! — [NOME_VENDEDOR]', 3),
  ('Missed Call Follow-up', 'Olá [NOME_CONTATO], aqui é o [NOME_VENDEDOR] da Kuboo. Vi sua ligação e não consegui atender na hora — já estou disponível! Pode me chamar por aqui ou, se preferir, ligo de volta. É só dizer o melhor horário.', 4),
  ('Agendar reunião', '[NOME_CONTATO], que tal marcarmos uma conversa rápida para eu te apresentar as opções de [PRODUTO]? Qual período fica melhor para você: manhã ou tarde? — [NOME_VENDEDOR]', 5),
  ('Confirmar compromisso agendado', 'Oi [NOME_CONTATO]! Passando para confirmar nosso compromisso: [NOME_ATIVIDADE] em [DATA_ATIVIDADE]. Posso contar com você? Qualquer imprevisto é só me avisar. — [NOME_VENDEDOR]', 6),
  ('Durante o atendimento vigente', 'Oi [NOME_CONTATO], tudo bem? Estou finalizando o levantamento das melhores condições de [PRODUTO] para você. Assim que tiver as propostas das seguradoras eu te envio por aqui. Qualquer dúvida, estou à disposição. — [NOME_VENDEDOR]', 7),
  ('Mais informações para cotação', '[NOME_CONTATO], para eu montar sua cotação de [PRODUTO] com o melhor preço, preciso de algumas informações: CPF, data de nascimento, CEP e, se já possui seguro vigente, a seguradora e o vencimento da apólice. Pode me enviar por aqui mesmo? — [NOME_VENDEDOR]', 8),
  ('Consórcio — dados para simulação', 'Olá [NOME_CONTATO]! Para montar a melhor simulação de consórcio para você, me confirma: o valor de crédito desejado, a parcela que cabe no seu bolso e se pretende ofertar algum lance ou entrada? Com isso já te trago as opções. — [NOME_VENDEDOR]', 9),
  ('Retomada de contato', 'Oi [NOME_CONTATO], tudo bem? Não consegui mais falar com você sobre a cotação de [PRODUTO]. Ainda tem interesse? Se quiser, sigo com as condições que separei — é só me responder por aqui. — [NOME_VENDEDOR]', 10)
) as v(nome, conteudo, ordem)
where not exists (select 1 from public.mensagens_prontas m where m.nome = v.nome);

-- ─── 2) Seed: etiquetas iniciais (paleta da marca) ───────────────────────────
insert into public.etiquetas (nome, cor)
select v.n, v.c from (values
  ('Quente', '#EF4444'),
  ('Morno', '#F59E0B'),
  ('Frio', '#36ABE2'),
  ('Renovação', '#1873BA'),
  ('Indicação', '#22C55E'),
  ('Consórcio contemplado', '#8B5CF6')
) as v(n, c)
where not exists (select 1 from public.etiquetas e where e.nome = v.n);

-- ─── 3) Motivos de arquivamento que faltavam (aplicáveis a seguros) ──────────
insert into public.motivos_arquivamento (nome)
select v.n from (values ('De planilha'), ('Vendedor pesquisando')) as v(n)
where not exists (select 1 from public.motivos_arquivamento m where m.nome = v.n);

-- ─── 4) Hardening: insert público de leads não pode forjar atribuição/status ─
-- Site/Kubinho continuam inserindo normalmente (não setam vendedor_id nem status).
-- Importador/equipe usam leads_team_insert (authenticated) — não são afetados.
drop policy if exists "leads_public_insert" on public.leads;
create policy "leads_public_insert" on public.leads
  for insert with check (
    origem = any (array['chatbot','formulario','whatsapp','indicacao','portal'])
    and vendedor_id is null
    and status = 'novo'
  );

-- ─── 5) has_perm(): o can() do front, agora valendo no banco ─────────────────
create or replace function public.has_perm(p text)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1 from public.profiles pr
    where pr.id = (select auth.uid())
      and pr.role in ('vendedor','gestor','admin')
      and coalesce(pr.aprovado, true)
      and (pr.role in ('gestor','admin') or coalesce(pr.permissoes->>p, 'false') = 'true')
  );
$$;
revoke execute on function public.has_perm(text) from public;
grant execute on function public.has_perm(text) to authenticated;

-- ─── 6) RLS granular nas tabelas de configuração ─────────────────────────────
-- Antes: is_team FOR ALL (vendedor podia editar templates/motivos via API direto).
-- Agora: leitura = equipe; escrita espelha as permissões da UI.
-- Etiquetas: CRIAR é liberado pra equipe (paridade C2S: cria inline na página do
-- lead); gerenciar (editar/apagar) exige a permissão.

drop policy if exists "mensagens_prontas_team" on public.mensagens_prontas;
create policy "mensagens_prontas_read"  on public.mensagens_prontas for select to authenticated using (public.is_team());
create policy "mensagens_prontas_write" on public.mensagens_prontas for insert to authenticated with check (public.has_perm('acessar_config'));
create policy "mensagens_prontas_upd"   on public.mensagens_prontas for update to authenticated using (public.has_perm('acessar_config'));
create policy "mensagens_prontas_del"   on public.mensagens_prontas for delete to authenticated using (public.has_perm('acessar_config'));

drop policy if exists "etiquetas_team" on public.etiquetas;
create policy "etiquetas_read"   on public.etiquetas for select to authenticated using (public.is_team());
create policy "etiquetas_insert" on public.etiquetas for insert to authenticated with check (public.is_team());
create policy "etiquetas_upd"    on public.etiquetas for update to authenticated using (public.has_perm('editar_etiquetas'));
create policy "etiquetas_del"    on public.etiquetas for delete to authenticated using (public.has_perm('editar_etiquetas'));

drop policy if exists "motivos_arquivamento_team" on public.motivos_arquivamento;
create policy "motivos_read"  on public.motivos_arquivamento for select to authenticated using (public.is_team());
create policy "motivos_write" on public.motivos_arquivamento for insert to authenticated with check (public.has_perm('acessar_config'));
create policy "motivos_upd"   on public.motivos_arquivamento for update to authenticated using (public.has_perm('acessar_config'));
create policy "motivos_del"   on public.motivos_arquivamento for delete to authenticated using (public.has_perm('acessar_config'));

select 'Fase 2 aplicada: ' ||
  (select count(*) from public.mensagens_prontas) || ' mensagens, ' ||
  (select count(*) from public.etiquetas) || ' etiquetas, ' ||
  (select count(*) from public.motivos_arquivamento) || ' motivos' as resultado;

# Scan completo do Contact2Sale (conta admin Kuboo) — 2026-07-20

> Levantamento função-por-função feito na conta admin real (nahed@kubooseguros.com.br,
> company_id 21687) para replicar/superar o C2S no CRM Kuboo e cancelar a assinatura.

## Como a Kuboo usa o C2S hoje (dados reais)

- **754 leads** no total; 52 "a fazer"; 36 atividades futuras; ~130 leads/30d.
- **Captação**: Facebook Lead Ads INTEGRADO (campanhas "CAMPANHA CONSUMIDOR - TABELA
  COMPLETA" e "CAMPANHA AUTO" → Instagram Leads / Facebook Leads, canal "Internet");
  e-mail exclusivo de captação `kuboo_57669058425@contact2sale.com` (portal manda
  e-mail → vira lead); API documentada.
- **Formulário do anúncio** (perguntas de qualificação que chegam na 1ª mensagem):
  valor desejado (consórcio), parcela ideal, valor de entrada, renda mensal familiar,
  whatsapp, nome, telefone, e-mail, plataforma.
- **Equipe (10)**: Kuboo/Nahed (master), Nathan (master), Anna Luísa (master),
  Amanda, Alexsandro, Fernando, Robson, Vitor, Washington, William (desativado?).
  Toggle por usuário: "Visualiza o Bolsão" SIM/NÃO.

## Funil (kanban com R$ por coluna)

Novos → Em atendimento (86) → Visita Agendada → Visita realizada → Proposta Criada
(R$ 100.000). Card: nome, valor, campanha, produto, canal/fonte, atividade atual
(atrasada = vermelho), consultor. Fora do funil: Negócio fechado / Arquivado.

## Lead (página de detalhe)

- Header: nome, WhatsApp/telefone/e-mail, [produto interesse] campanha, origem/canal,
  responsável, "Recebido em X | Interagido em Y", link "Por que recebi este lead?"
  (auditoria da distribuição), editar, favoritar, TRANSFERIR.
- Status: Em negociação (chip).
- Painel esquerdo: CHAT (mensagem inicial = formulário respondido; composer de
  mensagem com templates).
- Painel direito "Mantenha seu lead atualizado":
  - Botões: Cadastrar proposta / Arquivar lead / Marcar como negócio fechado
  - **Atividade atual** (ex.: "Retornar para o cliente - Pendente em 20/07 09:00")
    + "Criar nova atividade" (tipos vistos: Retornar para o cliente, Primeiro
    contato, Visita)
  - **Etiquetas** (select + criar)
  - **Observações** (notas com timestamp manual)

## Lista de leads (v2)

Abas: A fazer (52) / Visitas / Futuras (36) / Favoritos / Todos (754).
Seção "Atividades para hoje (N)". Busca por produto/nome/telefone/e-mail + Filtros.
Admin vê tudo; combo "Meu usuário" troca a visão por consultor. Criar lead manual.

## Distribuição (CORAÇÃO do produto) — /distribution_lines

Filas ORDENADAS por prioridade; primeira fila cujas regras casam recebe o lead:
1. **"Regra retorno"** (6 usuários): "Dias de memória < 16 dias, a partir da maior
   data entre última atividade e última atualização, com status qualquer" →
   lead que retorna vai pro MESMO consultor.
2. **"Rodízio igualitário"** (5 usuários): round-robin; mostra "próximo a receber".
3. **"Geral"** (desligada).
4. **"Usuário de segurança: Kuboo"** (cadeado): fallback — se nenhuma fila pegar,
   cai no admin.

Editor de fila: Tipo (Personalizada), Nome + 4 seções: **Regras** (N condições;
sem condição = pega qualquer lead), **Configurações de horário e check-in**
(plantão por dia/hora; check-in do consultor pra entrar na fila), **Usuários
ativos na fila**, **Configurações avançadas**. Ações por fila: editar, ligar/
desligar, excluir, REDISTRIBUIR. Abas extra: Auditoria, Check-in, Dúvidas.

**16 critérios de condição** ("É igual" + valor):
Tipo de Negociação, Bairro, Cidade, Dias de memória, Etiqueta, FB-Nome da página,
FB-Nome do anúncio, FB-Nome do formulário, Fonte, Keywords, **Limite de leads
abertos (Novo e Em negociação)** (cap por consultor!), Lista de códigos, Nome
fantasia, Preço (maior que), Preço (menor que), Título do Lead.

## Bolsão — /bucket_lead_configs

- Ativar bolsão SIM/NÃO.
- **Limite de tempo para atendimento**: slider 5min…12h (Kuboo usa **20 min**) —
  se o consultor não interagir nesse prazo, o lead fica disponível no bolsão
  pra qualquer um pegar.
- Escopo: qualquer usuário da empresa vs só a equipe que recebeu.
- Horário de funcionamento do bolsão por dia da semana (início/término, Seg-Dom).
- Relatório próprio do bolsão.

## Alertas de sem-atendimento — /alerts (escada REAL da Kuboo)

| Sem atendimento há | Notificar |
|---|---|
| 30 min | usuário que recebeu o lead |
| 1 hora | usuário |
| 6 horas | usuário |
| 1 dia | usuário |
| 1 hora | masters da equipe |
| 5 horas | masters da equipe |

## Usuários — /sellers (+ /sellers/:id/edit)

Lista: nome, e-mail, telefone, versão do app, badge master, toggle "Visualiza o
Bolsão", editar. Ações: Criar usuário, Reenviar convites, filtro ativos/inativos,
busca, EXPORTAR.

Edição: Empresa, Nome, Usuário(login), E-mail, Celular, Senha, **Assinatura**
(texto com variáveis). **Permissões (SIM/NÃO)**: Usuário master (Gerente); Pode
editar usuários; Pode editar filas de distribuição; Pode editar hierarquia; Pode
editar bolsão; Pode editar etiquetas; Pode acessar configurações da empresa; Pode
acessar financeiro; Pode extrair relatórios de leads; Visível nos relatórios; Ao
responder lead por e-mail receber cópia. Avançado: Desconectar todos os
dispositivos; **Desativar usuário** com transferência dos leads (ativos E
arquivados separadamente) → p/ usuário específico | redistribuição pelas regras |
distribuição igualitária.

## Mensagens prontas — /message_templates

Abas Ativas/Inativas; CRUD; editor Nome + Conteúdo + **variáveis arrastáveis**:
TITULO_ANUNCIO, DADOS_ANUNCIO, LINK_ANUNCIO, NOME_CONTATO, ASSINATURA_USUARIO,
ASSINATURA_UTILIZADOR, NOME_VENDEDOR, NOME_LOJA, NOME_LOJA_PAI, COD_IMOVEL,
CONDOMINIO_PRECO, IMOVEL_ENDERECO, IPTU_PRECO, PRECO, NOME_ATIVIDADE,
DATA_ATIVIDADE, TELEFONE_VENDEDOR.
Templates da Kuboo: Agendar visita (2×), Durante o atendimento vigente (antes da
proposta), Em branco, Escrever nova mensagem, Mais infos de troca (2×), Mensagem
de abertura, Missed Call Follow-up (PT), Pedir número de telefone, Quando o
cliente não atende, …

## Motivos de arquivamento — /lost_reason_configs (todos ativos)

Alugado; Apenas pesquisa; Avaliação baixa; Cliente não responde; Compra adiada;
Contato inválido; Corretor parceiro; DDD distante; De planilha; Falta de produto;
Faturado; Fechou negócio (…); Ficha recusada; Já foi vendido; Lead duplicado;
Localização não atendida; Não consegui contato; Não possui renda; Outros; Prazo
de entrega; Preço alto; Problema no atendimento; Produto na troca; Produto não
agradou; Proposta do cliente; Proposta inviável; Tratada com qualificação;
Tratada sem qualificação; Vendedor pesquisando.

## Relatórios (menu)

Geral; Visitas e Negócios Fechados; Métricas de desempenho (por consultor);
Negócio Fechado por origem; Negócio Fechado por natureza da negociação; Leads;
Acompanhamento de Uso. + Relatório do Bolsão. + Dashboards personalizados
("Nova análise", salvar, filtro equipe/tipo; ex.: Leads por Canal, por Fonte)
e "Dashboard Meta".

## Outras seções

- **Gestão** (/company_overviews): KPIs por período com filtro de usuário.
- **Meu C2S**: home do usuário. **Financeiro** (BETA). **Leads turbo** (compra de
  leads — não relevante). **Imóveis/Vitrine** (imobiliário — não relevante).
- **Configurações**: Equipes (multi-equipe), Portais, Auditoria (usage control),
  Etiquetas.
- **Importar leads** (planilha). **Menu do usuário**: Meu perfil, Mensagens
  prontas, FAQ (Notion), Indicações, Treinamentos.

## Gap-analysis → o que implementar no CRM Kuboo

JÁ TEMOS: funil kanban, bolsão com SLA + pegar lead, scoring, tarefas, clientes,
vendas+parcelas+comissão, renovações, produção/ranking/TV, dashboards, importador
CSV, notificações, papéis básicos (vendedor/gestor/admin), timeline do cliente.

FALTA (prioridade da migração):
1. **Motor de filas de distribuição** (ordenadas, regras, memória de retorno,
   rodízio, limite de abertos, fila de segurança, log "por que recebi") — Postgres.
2. **Atividades/follow-up** no lead (retornar ao cliente etc. com data/hora,
   atividade atual, atrasada em vermelho, abas A fazer/Futuras/Hoje).
3. **Observações** com timestamp + **Etiquetas** de lead.
4. **Arquivar com motivo** (catálogo acima) + relatório por motivo.
5. **Permissões granulares por usuário** + assinatura + desativar-com-transferência.
6. **Alertas de sem-atendimento** (escada 30min→1d + masters).
7. **Mensagens prontas** com variáveis (WhatsApp composer).
8. **Webhook de captação** (Meta Lead Ads via webhook/Make; campos campanha/fonte/
   canal/formulário no lead) — o site+Kubinho já alimentam direto.
9. Config do bolsão (tempo limite, horário semanal). 10. Favoritos. 11. Tempo de
1ª resposta (interagido_em) nos relatórios.

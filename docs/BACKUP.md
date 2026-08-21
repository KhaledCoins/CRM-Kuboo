# Backup do CRM Kuboo — o que está coberto e o que NÃO está

Última verificação: 21/08/2026 (auditoria).

## O que existe hoje

`api/backup-semanal.js`, disparado por cron da Vercel toda segunda 9h UTC.
Exporta **33 tabelas** em JSON e grava no bucket `backups` do Supabase, com
rotação de 60 dias. Provado E2E em 15/08 (backup-2026-08-15.json, 896 KB,
834 leads).

Desde 21/08 também grava o **inventário do Storage** (quais arquivos existem,
em que bucket, tamanho e data) — não os binários, pelo motivo do item 2 abaixo.

## As três limitações que você precisa conhecer

### 1. O plano do Supabase é FREE — não existe backup gerenciado

Confirmado na API: `plan: "free"`. No plano gratuito **não há backup automático
nem point-in-time recovery**. Ou seja: o job semanal do CRM é a *única* cópia
dos dados. Se o banco for corrompido numa terça-feira, perde-se até 7 dias.

**Decisão pendente do Eduardo:** Supabase Pro (~US$25/mês) liga backup diário
gerenciado + PITR de 7 dias. Já está anotado no plano de infraestrutura.

### 2. O backup mora dentro do próprio projeto que ele protege

O arquivo é gravado no bucket `backups` do MESMO Supabase. Isso protege contra
erro humano (apagar uma tabela, um UPDATE errado) — que é o cenário comum — mas
**não protege contra a perda do projeto** (conta suspensa, exclusão acidental).

Por isso os binários do Storage não são copiados para dentro do backup: seria
copiar arquivo de dentro do prédio para outro andar do mesmo prédio.

**Como fechar isso:** um destino externo (Google Drive da Kuboo, S3, ou até
e-mail para a diretoria com o JSON anexado). Precisa de credencial — decisão e
conta do Eduardo.

### 3. Documentos de cliente (PDF de apólice) não têm cópia

O bucket `documentos-clientes` é privado e hoje tem poucos arquivos, mas cresce
conforme a equipe anexa apólices. Só o inventário é salvo; os PDFs em si
dependem do item 2.

## Como restaurar (resumo)

1. Baixar o JSON mais recente do bucket `backups` (painel do Supabase).
2. O arquivo tem `{ gerado_em, resumo, tabelas: {...}, storage: {...} }`.
3. `resumo` diz quantas linhas cada tabela tinha — confira antes de restaurar.
   Uma tabela pode aparecer como `PARCIAL (N linhas) — <erro>`: é o que deu
   para salvar naquela execução, e é melhor que nada.
4. Restaurar tabela por tabela respeitando a ordem das chaves estrangeiras
   (profiles antes de leads, leads antes de lead_atividades, etc).

## Ao criar uma tabela nova

Adicione o nome na lista `TABELAS` de `api/backup-semanal.js`. Uma tabela que
não estiver lá fica **fora do backup** e ninguém vai perceber — o resumo do job
só mostra o que ele conhece.

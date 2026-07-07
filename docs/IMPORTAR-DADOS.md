# Como colocar a base real (clientes, apólices, cartas de consórcio)

Guia prático para migrar os dados do Excel/papel para o CRM da Kuboo, de forma que
tudo apareça **também no Portal do Cliente** (a pessoa loga e vê a apólice/consórcio dela).

## Ordem correta

1. **Cliente primeiro.** Apólice e consórcio são vinculados a um cliente (pelo `client_id`).
   Então cada cliente precisa existir antes das apólices dele.
2. **Depois as apólices e os consórcios** desse cliente.

## Passo 0 — Pré-requisitos (uma vez só, feito pelo Eduardo)

- Rodar no Supabase (SQL Editor) o script `supabase/clientes-onboarding.sql`.
- No Vercel do CRM, adicionar a variável `SUPABASE_SERVICE_ROLE_KEY`
  (Supabase → Settings → API → `service_role`). Sem ela, "Novo Cliente" não cria login.

## Passo 1 — Clientes

Cada cliente cadastrado ganha um acesso ao Portal automaticamente:
- **Com e-mail:** recebe um convite por e-mail e cria a própria senha.
- **Sem e-mail:** o sistema gera uma senha temporária que aparece na tela **uma única vez** —
  a equipe anota e repassa por WhatsApp. No 1º login o cliente é obrigado a trocar.

Hoje o cadastro é **um a um** (tela Clientes → "Novo Cliente"), porque cada cliente
é uma conta de login de verdade. Para uma migração grande de contas em lote, falar com o
Eduardo (dá para fazer via script de servidor com a service_role — não é auto-serviço por segurança).

## Passo 2 — Apólices (importação em massa por CSV)

Na tela **Apólices** → botão de importar CSV (ou cadastro manual "Nova Apólice").
Exporte sua planilha do Excel como **CSV** com estas colunas (o cabeçalho pode variar —
o importador tenta casar por semelhança, mas o ideal é usar estes nomes):

| Coluna CSV        | O que é                                  | Exemplo                        |
|-------------------|-------------------------------------------|--------------------------------|
| `cliente_cpf`     | CPF do cliente (para vincular)            | 123.456.789-00                 |
| `tipo`            | Auto / Vida / Residencial / Empresarial / Condomínio / Pet / Viagem / Saúde / Outros | Auto |
| `seguradora`      | Nome da seguradora                        | Porto Seguro                   |
| `numero_apolice`  | Número da apólice                         | 0553-99887766                  |
| `vigencia_inicio` | Início da vigência (DD/MM/AAAA)           | 15/03/2026                     |
| `vigencia_fim`    | Fim da vigência (DD/MM/AAAA)              | 15/03/2027                     |
| `premio_mensal`   | Valor mensal (R$)                         | 289,90                         |
| `premio_anual`    | Valor anual (R$)                          | 3478,80                        |
| `status`          | ativa / vencida / cancelada / em_renovação / pendente | ativa             |

> O importador **casa o `cliente_cpf` com o cliente cadastrado automaticamente**
> (coluna `client_id`), então a apólice já nasce vinculada e aparece no Portal do
> cliente. Linhas cujo CPF **não** tem cliente cadastrado são **puladas** (não viram
> apólice órfã) — por isso cadastre os clientes antes (Passo 1). O resumo final
> mostra quantas foram importadas e quantas puladas.

## Passo 3 — Consórcios (cartas de crédito)

Na tela **Consórcios** (menu do módulo Consórcios) → "Importar CSV" (em massa) ou
"Novo Consórcio" (um a um). Mesma regra do CPF: casa `cliente_cpf` → cliente e pula
quem não tem cadastro. Colunas:

| Coluna            | O que é                                   | Exemplo         |
|-------------------|-------------------------------------------|-----------------|
| `cliente_cpf`     | CPF do cliente                            | 123.456.789-00  |
| `administradora`  | Âncora / Porto / Tradição / Outros        | Porto           |
| `tipo`            | Imóvel / Veículo / Empresarial            | Imóvel          |
| `grupo`           | Grupo                                      | 1452            |
| `numero_cota`     | Cota                                       | 0345            |
| `valor_credito`   | Carta de crédito (R$)                     | 250000          |
| `parcela_mensal`  | Parcela (R$)                              | 1650,00         |
| `parcelas_pagas`  | Quantas já pagou                          | 18              |
| `total_parcelas`  | Total do plano                            | 180             |
| `taxa_admin`      | Taxa de administração (%)                 | 18              |
| `forma_pagamento` | Como paga                                 | Boleto mensal   |
| `data_assembleia` | Próxima assembleia (DD/MM/AAAA)           | 15/08/2026      |
| `status`          | ativo / contemplado / cancelado / encerrado / inadimplente | ativo |

O Portal calcula sozinho o "valor pago" e o "saldo devedor" a partir de
`parcelas_pagas × parcela_mensal` quando esses campos ficam em branco.

## O que ainda depende do dev (backlog desta entrega)

- [x] Importador de CSV de Apólices/Consórcios casando `cliente_cpf → client_id` — **pronto**.
- [ ] Anexar PDF/foto da apólice e da carta (bucket `documentos-clientes` já criado
      no `clientes-onboarding.sql`; falta a UI de upload).
- [ ] Cadastro de clientes em lote (via script de servidor com service_role).

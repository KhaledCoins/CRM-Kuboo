# Kuboo CRM

CRM interno da **Kuboo Consórcios & Seguros** — gestão para consultores e gestores.
App separado do site, **mesmo backend Supabase**, identidade visual Kuboo (azul).

## Stack
- React 18 + TypeScript + Vite 6
- Tailwind CSS v4
- Supabase (Auth + Postgres + RLS) — mesmo projeto do site
- react-router-dom · @dnd-kit (kanban) · recharts (gráficos) · lucide-react

## Módulos
- **Seguros:** Dashboard, Vendas, Endossos, Parcelas, Comissões, Ranking, Pipeline (Novos/Renovações), Metas & Performance, Sinistros, Auditoria & Cobrança, Produção, TV do Salão
- **Consórcios:** Dashboard, Pipeline, Cotas, Contemplações, Grupos & Assembleias, Comissões, Metas, Ranking, TV do Salão
- **Administração:** Clientes, Seguradoras/Administradoras, Produtos, Usuários (papéis), Configurações

## Papéis
`admin` · `gestor` · `vendedor` (níveis: Júnior/Pleno/Sênior/Especialista). Cliente comum **não** acessa o CRM.

## Rodar local
```bash
pnpm install
pnpm dev      # http://localhost:5173
pnpm build
```
`.env.local` já aponta para o Supabase da Kuboo (mesmo do site).

## Banco de dados
1. Rodar `supabase/crm-migration.sql` no SQL Editor do Supabase.
2. Promover usuários da equipe:
   ```sql
   UPDATE profiles SET role='admin' WHERE id='<uuid>';
   ```

## Deploy (sugerido)
- Vercel → projeto separado → domínio **crm.kuboo.com.br** (não indexado).
- Variáveis: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.

## Integração com o site
Os leads capturados pelo site e pelo Kubinho caem na tabela `leads` e aparecem no **Pipeline (Novos)** automaticamente.

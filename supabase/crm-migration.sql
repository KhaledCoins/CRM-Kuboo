-- ============================================================
-- KUBOO CRM — Migração de schema (rodar no SQL Editor do Supabase)
-- Estende o banco do site para suportar o CRM da equipe.
-- Idempotente onde possível.
-- ============================================================

-- ─── 1) PERFIS: papel da equipe ───────────────────────────────
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS role  TEXT NOT NULL DEFAULT 'cliente'
  CHECK (role IN ('cliente','vendedor','gestor','admin'));
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS nivel TEXT;            -- Júnior/Pleno/Sênior/Especialista
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS aprovado BOOLEAN DEFAULT true;

-- Helper: o usuário logado faz parte da equipe?
CREATE OR REPLACE FUNCTION public.is_team()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = (select auth.uid()) AND p.role IN ('vendedor','gestor','admin')
  );
$$;
REVOKE EXECUTE ON FUNCTION public.is_team() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_team() TO authenticated;

-- A equipe pode ler todos os perfis (clientes + equipe). Cliente continua vendo só o seu.
DROP POLICY IF EXISTS "profiles_team_read" ON profiles;
CREATE POLICY "profiles_team_read" ON profiles FOR SELECT USING (public.is_team());

-- ─── 2) LEADS: campos do pipeline ─────────────────────────────
ALTER TABLE leads ADD COLUMN IF NOT EXISTS etapa TEXT DEFAULT 'novos'
  CHECK (etapa IN ('novos','contato','cotacao','negociacao','ganho','perdido'));
ALTER TABLE leads ADD COLUMN IF NOT EXISTS modulo TEXT DEFAULT 'seguros' CHECK (modulo IN ('seguros','consorcios'));
ALTER TABLE leads ADD COLUMN IF NOT EXISTS vendedor_id UUID REFERENCES profiles(id);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS valor_potencial DECIMAL(12,2);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS proxima_acao TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS data_proxima_acao TIMESTAMPTZ;
-- Bolsão de Leads (estilo C2S): SLA de 1º contato + atribuição
ALTER TABLE leads ADD COLUMN IF NOT EXISTS atribuido_em        TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS sla_expira_em       TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS primeiro_contato_em TIMESTAMPTZ;
-- Lead "no bolsão" = vendedor_id IS NULL OU (sem 1º contato E SLA expirado)

-- A equipe lê/edita os leads (o pipeline precisa disso). INSERT público continua (site/Kubinho).
DROP POLICY IF EXISTS "leads_team_read"   ON leads;
DROP POLICY IF EXISTS "leads_team_update" ON leads;
CREATE POLICY "leads_team_read"   ON leads FOR SELECT USING (public.is_team());
CREATE POLICY "leads_team_update" ON leads FOR UPDATE USING (public.is_team());

-- ─── 3) Tabelas de apoio ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS seguradoras (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo TEXT NOT NULL DEFAULT 'seguradora' CHECK (tipo IN ('seguradora','administradora')),
  nome TEXT NOT NULL, site TEXT, comissao_padrao DECIMAL(5,2),
  ativo BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS produtos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  modulo TEXT NOT NULL DEFAULT 'seguros' CHECK (modulo IN ('seguros','consorcios')),
  nome TEXT NOT NULL, descricao TEXT, ativo BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── 4) VENDAS (apólices/propostas) ───────────────────────────
CREATE TABLE IF NOT EXISTS vendas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero_proposta TEXT, data_venda DATE DEFAULT CURRENT_DATE,
  cliente_id UUID REFERENCES profiles(id), cliente_nome TEXT,
  vendedor_id UUID REFERENCES profiles(id), vendedor_nome TEXT,
  seguradora TEXT, produto TEXT,
  valor DECIMAL(12,2), parcelas INTEGER DEFAULT 1,
  comissao_pct DECIMAL(5,2), comissao_valor DECIMAL(12,2),
  tipo TEXT DEFAULT 'novo' CHECK (tipo IN ('novo','renovacao')),
  status TEXT DEFAULT 'ativa' CHECK (status IN ('ativa','pendente','cancelada','vencida')),
  aprovacao TEXT DEFAULT 'pendente' CHECK (aprovacao IN ('pendente','aprovado','reanalise')),
  vigencia_inicio DATE, vigencia_fim DATE, observacoes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS parcelas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venda_id UUID REFERENCES vendas(id) ON DELETE CASCADE,
  numero INTEGER, valor DECIMAL(12,2),
  vencimento DATE, pagamento DATE,
  status TEXT DEFAULT 'aberta' CHECK (status IN ('aberta','paga','atrasada','cancelada')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS comissoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venda_id UUID REFERENCES vendas(id) ON DELETE CASCADE,
  vendedor_id UUID REFERENCES profiles(id), valor DECIMAL(12,2), pct DECIMAL(5,2),
  liberacao DATE, pagamento DATE,
  status TEXT DEFAULT 'a_pagar' CHECK (status IN ('a_pagar','paga','cancelada')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS endossos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venda_id UUID REFERENCES vendas(id) ON DELETE SET NULL,
  cliente_nome TEXT, seguradora TEXT, motivo TEXT, valor DECIMAL(12,2),
  data DATE DEFAULT CURRENT_DATE, created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS atendimentos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo TEXT DEFAULT 'sinistro' CHECK (tipo IN ('sinistro','assistencia')),
  numero_registro TEXT, venda_id UUID REFERENCES vendas(id) ON DELETE SET NULL,
  cliente_nome TEXT, responsavel_id UUID REFERENCES profiles(id),
  status TEXT DEFAULT 'aberto', descricao TEXT,
  data DATE DEFAULT CURRENT_DATE, created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS metas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  escopo TEXT DEFAULT 'individual' CHECK (escopo IN ('corretora','individual')),
  vendedor_id UUID REFERENCES profiles(id),
  mes DATE, valor_meta DECIMAL(12,2), modulo TEXT DEFAULT 'seguros',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── 5) CONSÓRCIOS ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cotas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id UUID REFERENCES profiles(id), cliente_nome TEXT,
  vendedor_id UUID REFERENCES profiles(id),
  administradora TEXT, tipo TEXT CHECK (tipo IN ('Imóvel','Veículo','Empresarial')),
  grupo TEXT, numero_cota TEXT,
  valor_credito DECIMAL(12,2), parcela DECIMAL(12,2), prazo INTEGER, parcelas_pagas INTEGER DEFAULT 0,
  status TEXT DEFAULT 'ativa' CHECK (status IN ('ativa','contemplada','cancelada','quitada')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS contemplacoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cota_id UUID REFERENCES cotas(id) ON DELETE CASCADE,
  forma TEXT CHECK (forma IN ('sorteio','lance')), valor_lance DECIMAL(12,2),
  data DATE, created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS grupos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  administradora TEXT, numero TEXT, tipo TEXT,
  proxima_assembleia DATE, participantes INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── 6) RLS: acesso pela equipe (gestão) ──────────────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'seguradoras','produtos','vendas','parcelas','comissoes','endossos',
    'atendimentos','metas','cotas','contemplacoes','grupos'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I;', t || '_team', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL USING (public.is_team()) WITH CHECK (public.is_team());', t || '_team', t);
  END LOOP;
END $$;

-- ─── 7) Índices ───────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_leads_etapa        ON leads(etapa);
CREATE INDEX IF NOT EXISTS idx_leads_vendedor     ON leads(vendedor_id);
CREATE INDEX IF NOT EXISTS idx_leads_sla          ON leads(sla_expira_em);
CREATE INDEX IF NOT EXISTS idx_leads_modulo       ON leads(modulo);
CREATE INDEX IF NOT EXISTS idx_vendas_vendedor    ON vendas(vendedor_id);
CREATE INDEX IF NOT EXISTS idx_vendas_data        ON vendas(data_venda DESC);
CREATE INDEX IF NOT EXISTS idx_parcelas_venda     ON parcelas(venda_id);
CREATE INDEX IF NOT EXISTS idx_parcelas_venc      ON parcelas(vencimento);
CREATE INDEX IF NOT EXISTS idx_comissoes_vendedor ON comissoes(vendedor_id);
CREATE INDEX IF NOT EXISTS idx_cotas_cliente      ON cotas(cliente_id);

-- ============================================================
-- Para promover um usuário a admin/gestor/vendedor:
--   UPDATE profiles SET role='admin'  WHERE id = '<uuid do usuário>';
--   UPDATE profiles SET role='vendedor', nivel='Sênior' WHERE id = '<uuid>';
-- ============================================================

SELECT 'Migração do CRM aplicada' AS resultado;

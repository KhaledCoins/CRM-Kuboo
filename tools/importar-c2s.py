# -*- coding: utf-8 -*-
"""
Importador do export de leads do Contact2Sale (XLSX) → SQL para o CRM Kuboo.

Uso:  python tools/importar-c2s.py <export.xlsx> [pasta_saida]
Saída: arquivos import-c2s-NNN.sql (lotes de 50 leads) prontos pro SQL Editor/MCP.

Fidelidade (calibrado no export real de 01/08/2026, 45 colunas):
- created_at   ← "Criado em"  (dd/mm/yyyy hh:mm:ss, fuso -03) — SEM isso os 754
  históricos nasceriam "hoje" e inundariam A fazer/alertas/Desempenho (finding
  da auditoria fase 3).
- interagido_em/primeiro_contato_em ← "Respondido em".
- vendedor     ← "Usuário responsável atual" (match por nome no profiles; sem
  match → NULL, e os triggers ficam DESLIGADOS no lote via
  session_replication_role p/ lead histórico não cair no rodízio).
- etapa        ← "Status do lead" (Novo→novos, Em atendimento→contato,
  Visita Agendada→cotacao, Visita realizada/Proposta/Em negociação→negociacao,
  Negócio fechado→ganho, Arquivado→perdido+descartado c/ motivo do export,
  fallback "De planilha").
- modulo       ← campanha ("Título do imóvel"): AUTO→seguros, CONSUMIDOR→consorcios.
- Atividade atual "Em aberto" → lead_atividades pendente (follow-ups sobrevivem!).
- "Observações do lead" → lead_observacoes; "Etiquetas" → etiquetas+lead_etiquetas.
- Dedup por telefone (dígitos) e e-mail contra o banco (NOT EXISTS) e intra-arquivo.
"""
import sys, os, re, unicodedata
import pandas as pd

LOTE = 50
TZ = "-03"

def norm(s):
    if s is None or (isinstance(s, float) and pd.isna(s)): return ""
    return str(s).strip()

def digitos(s): return re.sub(r"\D", "", norm(s))

def sql_str(s):
    s = norm(s)
    if not s: return "null"
    return "'" + s.replace("'", "''") + "'"

def data_iso(s):
    """dd/mm/yyyy hh:mm:ss → timestamptz -03 (aceita datetime do pandas também)."""
    if s is None or (isinstance(s, float) and pd.isna(s)): return None
    if hasattr(s, "strftime"): return s.strftime(f"%Y-%m-%d %H:%M:%S{TZ}")
    m = re.match(r"(\d{2})/(\d{2})/(\d{4})[ T]?(\d{2}:\d{2}:\d{2})?", norm(s))
    if not m: return None
    d, mo, a, hora = m.group(1), m.group(2), m.group(3), m.group(4) or "12:00:00"
    return f"{a}-{mo}-{d} {hora}{TZ}"

def sem_acento(s):
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn").lower()

def etapa_de(status, fechado_em, motivo):
    s = sem_acento(norm(status))
    if norm(fechado_em): return "ganho", False
    if "arquiv" in s: return "perdido", True
    if "negocia" in s or "proposta" in s or "realizada" in s: return "negociacao", False
    if "visita" in s: return "cotacao", False
    if "atendimento" in s: return "contato", False
    return "novos", False

def modulo_de(campanha):
    c = sem_acento(norm(campanha))
    if "auto" in c: return "seguros", "Seguro Auto"
    if "consumidor" in c or "consorcio" in c: return "consorcios", "Consórcio"
    return "seguros", None

def tipo_atividade(nome):
    n = sem_acento(norm(nome))
    if "retornar" in n: return "retornar"
    if "primeiro" in n: return "primeiro_contato"
    if "visita" in n: return "visita"
    if "reuni" in n: return "reuniao"
    if "proposta" in n: return "proposta"
    return "outro"

def main():
    if len(sys.argv) < 2:
        print("uso: python tools/importar-c2s.py <export.xlsx> [pasta_saida]"); sys.exit(1)
    arq = sys.argv[1]
    saida = sys.argv[2] if len(sys.argv) > 2 else os.path.dirname(arq) or "."
    df = pd.read_excel(arq, dtype=str)
    col = {sem_acento(c): c for c in df.columns}
    def g(row, chave):  # acesso tolerante a acento/encoding do header
        c = col.get(sem_acento(chave))
        return row[c] if c is not None else None

    vistos_tel, vistos_email = set(), set()
    stmts, pulados = [], 0

    for _, row in df.iterrows():
        nome = norm(g(row, "Nome do cliente"))
        if not nome: pulados += 1; continue
        tel = digitos(g(row, "Telefone do cliente"))
        email = norm(g(row, "Email do cliente")).lower()
        if (tel and tel in vistos_tel) or (email and email in vistos_email):
            pulados += 1; continue
        if tel: vistos_tel.add(tel)
        if email: vistos_email.add(email)

        criado = data_iso(g(row, "Criado em"))
        respondido = data_iso(g(row, "Respondido em"))
        atualizado = data_iso(g(row, "Atualizado em"))
        etapa, descartado = etapa_de(g(row, "Status do lead"), g(row, "Negócio fechado em"), g(row, "Motivo de arquivamento"))
        modulo, produto = modulo_de(g(row, "Título do imóvel"))
        motivo = norm(g(row, "Motivo de arquivamento")) or ("De planilha" if descartado else "")
        vendedor_nome = norm(g(row, "Usuário responsável atual")) or norm(g(row, "Recebido pelo usuário"))
        campanha = norm(g(row, "Título do imóvel"))
        fonte = norm(g(row, "Fonte do lead"))
        canal = norm(g(row, "Canal")) or "Internet"
        valor = norm(g(row, "Valor real do fechamento")) or norm(g(row, "Valor da Proposta")) or norm(g(row, "Preço"))
        try: valor_num = float(valor.replace(".", "").replace(",", ".")) if valor and float(valor.replace(".", "").replace(",", ".")) > 0 else None
        except Exception: valor_num = None
        obs = norm(g(row, "Observações do lead"))
        etiquetas = [e.strip() for e in norm(g(row, "Etiquetas")).split(",") if e.strip()]
        ativ_nome = norm(g(row, "Nome da atividade"))
        ativ_quando = data_iso(g(row, "Data e hora da atividade"))
        ativ_aberta = "aberto" in sem_acento(norm(g(row, "Status da atividade atual")))

        dedup = []
        if tel: dedup.append(f"regexp_replace(coalesce(l.telefone,''),'\\D','','g') = '{tel}'")
        if email: dedup.append(f"lower(coalesce(l.email,'')) = {sql_str(email)}")
        guarda = f"and not exists (select 1 from public.leads l where {' or '.join(dedup)})" if dedup else ""

        vend = f"(select id from public.profiles where name ilike {sql_str(vendedor_nome)} and role in ('vendedor','gestor','admin') limit 1)" if vendedor_nome else "null"

        stmt = f"""
insert into public.leads (nome, telefone, email, produto_interesse, mensagem, origem, modulo, etapa, status,
  vendedor_id, atribuido_em, campanha, fonte, canal, score, valor_potencial,
  descartado, motivo_descarte, created_at, interagido_em, primeiro_contato_em)
select {sql_str(nome)}, {sql_str(norm(g(row, 'Telefone do cliente')))}, {sql_str(email)}, {sql_str(produto)}, {sql_str(obs[:1500] if obs else '')},
  'formulario', '{modulo}', '{etapa}', 'novo',
  {vend}, {f"'{criado}'" if criado else 'null'},
  {sql_str(campanha)}, {sql_str(fonte)}, {sql_str(canal)}, 60, {valor_num if valor_num is not None else 'null'},
  {str(descartado).lower()}, {sql_str(motivo)},
  {f"'{criado}'" if criado else 'now()'}, {f"'{respondido}'" if respondido else (f"'{atualizado}'" if atualizado and etapa != 'novos' else 'null')},
  {f"'{respondido}'" if respondido else 'null'}
where true {guarda};"""
        stmts.append(stmt)

        if ativ_nome and ativ_aberta and ativ_quando and tel:
            stmts.append(f"""
insert into public.lead_atividades (lead_id, tipo, titulo, quando, status, criado_por)
select l.id, '{tipo_atividade(ativ_nome)}', {sql_str(ativ_nome)}, '{ativ_quando}', 'pendente', l.vendedor_id
from public.leads l
where regexp_replace(coalesce(l.telefone,''),'\\D','','g') = '{tel}'
  and not exists (select 1 from public.lead_atividades a where a.lead_id = l.id and a.titulo = {sql_str(ativ_nome)});""")
        if obs and tel:
            stmts.append(f"""
insert into public.lead_observacoes (lead_id, texto, criado_por, created_at)
select l.id, {sql_str(obs[:3000])}, l.vendedor_id, {f"'{criado}'" if criado else 'now()'}
from public.leads l
where regexp_replace(coalesce(l.telefone,''),'\\D','','g') = '{tel}'
  and not exists (select 1 from public.lead_observacoes o where o.lead_id = l.id);""")
        for et in etiquetas:
            stmts.append(f"""
insert into public.etiquetas (nome, cor) select {sql_str(et)}, '#64748B'
where not exists (select 1 from public.etiquetas e where lower(e.nome) = lower({sql_str(et)}));
insert into public.lead_etiquetas (lead_id, etiqueta_id)
select l.id, e.id from public.leads l, public.etiquetas e
where regexp_replace(coalesce(l.telefone,''),'\\D','','g') = '{tel}' and lower(e.nome) = lower({sql_str(et)})
on conflict do nothing;""")

    # Lotes: triggers desligados no lote inteiro (lead histórico não cai no rodízio
    # nem dispara SLA/alerta; a distribuição é só pra lead NOVO de verdade).
    arquivos = []
    for i in range(0, len(stmts), LOTE * 3):
        chunk = stmts[i:i + LOTE * 3]
        corpo = "begin;\nset local session_replication_role = 'replica';\n" + "\n".join(chunk) + "\ncommit;\n"
        nome_arq = os.path.join(saida, f"import-c2s-{i // (LOTE * 3):03d}.sql")
        with open(nome_arq, "w", encoding="utf-8") as f: f.write(corpo)
        arquivos.append(nome_arq)

    print(f"linhas no arquivo: {len(df)} | statements: {len(stmts)} | pulados: {pulados}")
    for a in arquivos: print("gerado:", a)

if __name__ == "__main__":
    main()

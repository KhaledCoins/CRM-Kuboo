# -*- coding: utf-8 -*-
"""
Importador do export de leads do Contact2Sale (XLSX) → SQL para o CRM Kuboo.

Uso:  python tools/importar-c2s.py <export.xlsx> [pasta_saida] [--dry-run]
Saída: arquivos import-c2s-NNN.sql (lotes de 50 leads) prontos pro SQL Editor/MCP.
       Com --dry-run nada é escrito em disco: só o resumo de conferência.

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
- produto_interesse ← "Natureza da negociação" (fallback: produto do módulo).
- valor_potencial   ← "Valor real do fechamento" > "Valor da Proposta" > "Preço".
- fb_pagina/fb_anuncio/fb_formulario ← colunas do Meta Lead Ads, quando o export
  as traz (nomes variam por conta); alimentam regras de fila e o ROI por anúncio
  do Dashboards. Se nenhuma existir, as colunas nem entram no INSERT — assim o
  script continua rodando em banco que ainda não aplicou a auditoria-leads.
- Atividade atual "Em aberto" → lead_atividades pendente (follow-ups sobrevivem!).
- "Observações do lead" → lead_observacoes; "Etiquetas" → etiquetas+lead_etiquetas.
- Dedup por telefone (dígitos) e e-mail contra o banco (NOT EXISTS) e intra-arquivo.

SEGURANÇA: todo valor vindo da planilha passa por sql_str() (escapa aspas simples).
Nunca interpole texto de célula direto em f-string — é o que impede injeção de SQL
via planilha adulterada.
"""
import sys, os, re, unicodedata
from collections import Counter
import pandas as pd

LOTE = 50
TZ = "-03"
LIM_TEXTO = 120  # mesmo limite do webhook api/lead-inbound.js para os campos do Meta

# "Natureza da negociação" é campo nativo do C2S imobiliário; nas contas de seguro
# ele vem preenchido com o resíduo do template (Venda/Aluguel) e não descreve
# produto nenhum. Nesses casos cai no produto derivado do módulo.
NATUREZA_IGNORADA = {"venda", "aluguel", "locacao", "temporada", "lancamento", "permuta"}


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

def moeda(s):
    """'R$ 1.234,56' | '1234.56' | '1.234' → float > 0, ou None.

    O C2S exporta o mesmo campo em formatos diferentes conforme a conta (pt-BR,
    en-US e cru), e o parser antigo (replace('.','')) transformava 1234.56 em
    123456 — um lead de R$ 1,2 mil virava R$ 123 mil no funil.
    """
    t = re.sub(r"[^\d,.\-]", "", norm(s))
    if not t: return None
    if "," in t and "." in t:
        # o separador mais à direita é o decimal: 1.234,56 (pt-BR) vs 1,234.56 (en-US)
        t = t.replace(".", "").replace(",", ".") if t.rfind(",") > t.rfind(".") else t.replace(",", "")
    elif "," in t:
        t = t.replace(",", ".")
    elif t.count(".") > 1 or re.match(r"^-?\d{1,3}(\.\d{3})+$", t):
        t = t.replace(".", "")  # só ponto e em grupos de 3 = separador de milhar
    try: v = float(t)
    except Exception: return None
    return v if v > 0 else None

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


def achar_colunas_meta(colunas):
    """Descobre as colunas do Meta Lead Ads — o C2S rotula diferente por conta
    (Página/Page name/Facebook - Página...), então casa por nome exato conhecido
    e, se falhar, por palavra-chave no cabeçalho."""
    exatos = {
        "fb_pagina": ["fb_pagina", "pagina do facebook", "nome da pagina", "page name",
                      "facebook - pagina", "pagina de origem", "pagina"],
        "fb_anuncio": ["fb_anuncio", "anuncio", "nome do anuncio", "ad name",
                       "facebook - anuncio", "anuncio de origem"],
        "fb_formulario": ["fb_formulario", "formulario", "nome do formulario", "form name",
                          "facebook - formulario", "formulario de origem"],
    }
    normalizadas = {sem_acento(c): c for c in colunas}
    achadas = {}
    for campo, nomes in exatos.items():
        for n in nomes:
            if n in normalizadas: achadas[campo] = normalizadas[n]; break
    for chave, campo in (("anuncio", "fb_anuncio"), ("formulario", "fb_formulario")):
        if campo not in achadas:
            for n, original in normalizadas.items():
                if chave in n: achadas[campo] = original; break
    if "fb_pagina" not in achadas:
        for n, original in normalizadas.items():
            if "pagina" in n and any(m in n for m in ("face", "fb", "meta", "insta")):
                achadas["fb_pagina"] = original; break
    return achadas


def resumo(dados, arquivos, dry):
    """Conferência ANTES de aplicar o SQL: se algo aqui destoar, o import está errado."""
    linha = "-" * 62
    print("\n" + linha)
    print("RESUMO DA IMPORTACAO" + ("  (dry-run: nada foi gravado)" if dry else ""))
    print(linha)
    print(f"linhas na planilha .......... {dados['linhas']}")
    print(f"leads a inserir ............. {dados['leads']}")
    print(f"pulados (sem nome) .......... {dados['sem_nome']}")
    print(f"pulados (duplicados) ........ {dados['duplicados']}")

    print("\nLeads por etapa:")
    for etapa, n in sorted(dados["etapas"].items(), key=lambda x: -x[1]):
        print(f"  {etapa:<14} {n:>5}")
    print("\nLeads por modulo:")
    for mod, n in sorted(dados["modulos"].items(), key=lambda x: -x[1]):
        print(f"  {mod:<14} {n:>5}")

    print(f"\narquivados (descartado=true)  {dados['arquivados']}")
    print(f"sem vendedor no export ...... {dados['sem_vendedor']}"
          "   <- entram com vendedor_id NULL (caem no bolsao)")
    if dados["vendedores"]:
        print("\nVendedores no export (confira se o nome EXISTE em profiles;"
              "\n  quem nao bater vira NULL sem aviso do banco):")
        for nome, n in sorted(dados["vendedores"].items(), key=lambda x: -x[1]):
            print(f"  {n:>5}  {nome}")

    print(f"\ncom produto_interesse ....... {dados['com_produto']}")
    print(f"com valor_potencial ......... {dados['com_valor']}"
          + (f"   (soma R$ {dados['soma_valor']:,.2f})".replace(",", "@").replace(".", ",").replace("@", ".")
             if dados["com_valor"] else ""))
    print(f"com atividade pendente ...... {dados['atividades']}")
    print(f"com observacao .............. {dados['observacoes']}")
    print(f"vinculos de etiqueta ........ {dados['etiquetas']}")

    if dados["meta_cols"]:
        print("\nMeta Lead Ads (colunas detectadas no export):")
        for campo, coluna in dados["meta_cols"].items():
            print(f"  {campo:<14} <- \"{coluna}\"  ({dados['meta_preenchidos'].get(campo, 0)} preenchidos)")
    else:
        print("\nMeta Lead Ads: nenhuma coluna encontrada no export"
              "\n  (fb_pagina/fb_anuncio/fb_formulario ficam de fora do INSERT;"
              "\n   o ROI por anuncio so tera dado dos leads novos, via webhook)")

    if dados["sem_data"]:
        print(f"\nATENCAO: {dados['sem_data']} lead(s) sem \"Criado em\" — nascem com now() e"
              "\n  vao aparecer como lead de hoje nos relatorios.")
    print(linha)
    if dry:
        print("dry-run: nenhum arquivo gerado. Rode sem --dry-run para escrever o SQL.")
    else:
        for a in arquivos: print("gerado:", a)


def main():
    try: sys.stdout.reconfigure(encoding="utf-8")
    except Exception: pass

    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    flags = {a.lower() for a in sys.argv[1:] if a.startswith("--")}
    dry = "--dry-run" in flags
    if not args or "--help" in flags:
        print("uso: python tools/importar-c2s.py <export.xlsx> [pasta_saida] [--dry-run]"); sys.exit(0 if flags else 1)
    arq = args[0]
    saida = args[1] if len(args) > 1 else os.path.dirname(arq) or "."

    df = pd.read_excel(arq, dtype=str)
    col = {sem_acento(c): c for c in df.columns}
    def g(row, chave):  # acesso tolerante a acento/encoding do header
        c = col.get(sem_acento(chave))
        return row[c] if c is not None else None

    meta_cols = achar_colunas_meta(df.columns)

    vistos_tel, vistos_email = set(), set()
    blocos, sem_nome, duplicados = [], 0, 0
    est = {
        "linhas": len(df), "etapas": Counter(), "modulos": Counter(), "vendedores": Counter(),
        "arquivados": 0, "sem_vendedor": 0, "com_produto": 0, "com_valor": 0, "soma_valor": 0.0,
        "atividades": 0, "observacoes": 0, "etiquetas": 0, "sem_data": 0,
        "meta_cols": meta_cols, "meta_preenchidos": Counter(),
    }

    for _, row in df.iterrows():
        nome = norm(g(row, "Nome do cliente"))
        if not nome: sem_nome += 1; continue
        tel = digitos(g(row, "Telefone do cliente"))
        email = norm(g(row, "Email do cliente")).lower()
        if (tel and tel in vistos_tel) or (email and email in vistos_email):
            duplicados += 1; continue
        if tel: vistos_tel.add(tel)
        if email: vistos_email.add(email)

        criado = data_iso(g(row, "Criado em"))
        respondido = data_iso(g(row, "Respondido em"))
        atualizado = data_iso(g(row, "Atualizado em"))
        etapa, descartado = etapa_de(g(row, "Status do lead"), g(row, "Negócio fechado em"), g(row, "Motivo de arquivamento"))
        modulo, produto = modulo_de(g(row, "Título do imóvel"))
        natureza = norm(g(row, "Natureza da negociação"))
        if natureza and sem_acento(natureza) not in NATUREZA_IGNORADA:
            # a campanha só diz o módulo quando o título tem AUTO/CONSUMIDOR; sem ela,
            # a natureza é a única pista — um "Consórcio de Imóvel" caindo em seguros
            # sumiria do funil de consórcios.
            if produto is None and "consorcio" in sem_acento(natureza):
                modulo = "consorcios"
            produto = natureza[:LIM_TEXTO]
        motivo = norm(g(row, "Motivo de arquivamento")) or ("De planilha" if descartado else "")
        vendedor_nome = norm(g(row, "Usuário responsável atual")) or norm(g(row, "Recebido pelo usuário"))
        campanha = norm(g(row, "Título do imóvel"))
        fonte = norm(g(row, "Fonte do lead"))
        canal = norm(g(row, "Canal")) or "Internet"
        valor_num = (moeda(g(row, "Valor real do fechamento")) or moeda(g(row, "Valor da Proposta"))
                     or moeda(g(row, "Preço")))
        obs = norm(g(row, "Observações do lead"))
        etiquetas = [e.strip() for e in norm(g(row, "Etiquetas")).split(",") if e.strip()]
        ativ_nome = norm(g(row, "Nome da atividade"))
        ativ_quando = data_iso(g(row, "Data e hora da atividade"))
        ativ_aberta = "aberto" in sem_acento(norm(g(row, "Status da atividade atual")))
        meta = {campo: norm(row[coluna])[:LIM_TEXTO] for campo, coluna in meta_cols.items()}

        est["etapas"][etapa] += 1
        est["modulos"][modulo] += 1
        if descartado: est["arquivados"] += 1
        if vendedor_nome: est["vendedores"][vendedor_nome] += 1
        else: est["sem_vendedor"] += 1
        if produto: est["com_produto"] += 1
        if valor_num: est["com_valor"] += 1; est["soma_valor"] += valor_num
        if obs: est["observacoes"] += 1
        if not criado: est["sem_data"] += 1
        for campo, v in meta.items():
            if v: est["meta_preenchidos"][campo] += 1

        dedup = []
        if tel: dedup.append(f"regexp_replace(coalesce(l.telefone,''),'\\D','','g') = '{tel}'")
        if email: dedup.append(f"lower(coalesce(l.email,'')) = {sql_str(email)}")
        guarda = f"and not exists (select 1 from public.leads l where {' or '.join(dedup)})" if dedup else ""

        vend = f"(select id from public.profiles where name ilike {sql_str(vendedor_nome)} and role in ('vendedor','gestor','admin') limit 1)" if vendedor_nome else "null"

        # colunas do Meta só entram quando o export as traz — banco sem a migration
        # auditoria-leads-2026-07 não tem essas colunas e o lote inteiro falharia.
        cols_meta = "".join(f", {campo}" for campo in meta_cols)
        vals_meta = "".join(f", {sql_str(meta[campo])}" for campo in meta_cols)

        sql = [f"""
insert into public.leads (nome, telefone, email, produto_interesse, mensagem, origem, modulo, etapa, status,
  vendedor_id, atribuido_em, campanha, fonte, canal, score, valor_potencial,
  descartado, motivo_descarte, created_at, interagido_em, primeiro_contato_em{cols_meta})
select {sql_str(nome)}, {sql_str(norm(g(row, 'Telefone do cliente')))}, {sql_str(email)}, {sql_str(produto)}, {sql_str(obs[:1500] if obs else '')},
  'formulario', '{modulo}', '{etapa}', 'novo',
  {vend}, {f"'{criado}'" if criado else 'null'},
  {sql_str(campanha)}, {sql_str(fonte)}, {sql_str(canal)}, 60, {f"{valor_num:.2f}" if valor_num is not None else 'null'},
  {str(descartado).lower()}, {sql_str(motivo)},
  {f"'{criado}'" if criado else 'now()'}, {f"'{respondido}'" if respondido else (f"'{atualizado}'" if atualizado and etapa != 'novos' else 'null')},
  {f"'{respondido}'" if respondido else 'null'}{vals_meta}
where true {guarda};"""]

        if ativ_nome and ativ_aberta and ativ_quando and tel:
            est["atividades"] += 1
            sql.append(f"""
insert into public.lead_atividades (lead_id, tipo, titulo, quando, status, criado_por)
select l.id, '{tipo_atividade(ativ_nome)}', {sql_str(ativ_nome)}, '{ativ_quando}', 'pendente', l.vendedor_id
from public.leads l
where regexp_replace(coalesce(l.telefone,''),'\\D','','g') = '{tel}'
  and not exists (select 1 from public.lead_atividades a where a.lead_id = l.id and a.titulo = {sql_str(ativ_nome)});""")
        if obs and tel:
            sql.append(f"""
insert into public.lead_observacoes (lead_id, texto, criado_por, created_at)
select l.id, {sql_str(obs[:3000])}, l.vendedor_id, {f"'{criado}'" if criado else 'now()'}
from public.leads l
where regexp_replace(coalesce(l.telefone,''),'\\D','','g') = '{tel}'
  and not exists (select 1 from public.lead_observacoes o where o.lead_id = l.id);""")
        for et in etiquetas:
            est["etiquetas"] += 1
            sql.append(f"""
insert into public.etiquetas (nome, cor) select {sql_str(et)}, '#64748B'
where not exists (select 1 from public.etiquetas e where lower(e.nome) = lower({sql_str(et)}));
insert into public.lead_etiquetas (lead_id, etiqueta_id)
select l.id, e.id from public.leads l, public.etiquetas e
where regexp_replace(coalesce(l.telefone,''),'\\D','','g') = '{tel}' and lower(e.nome) = lower({sql_str(et)})
on conflict do nothing;""")

        blocos.append("\n".join(sql))

    # Lotes: triggers desligados no lote inteiro (lead histórico não cai no rodízio
    # nem dispara SLA/alerta; a distribuição é só pra lead NOVO de verdade).
    arquivos = []
    if not dry:
        for i in range(0, len(blocos), LOTE):
            chunk = blocos[i:i + LOTE]
            corpo = "begin;\nset local session_replication_role = 'replica';\n" + "\n".join(chunk) + "\ncommit;\n"
            nome_arq = os.path.join(saida, f"import-c2s-{i // LOTE:03d}.sql")
            with open(nome_arq, "w", encoding="utf-8") as f: f.write(corpo)
            arquivos.append(nome_arq)

    est["leads"] = len(blocos)
    est["sem_nome"] = sem_nome
    est["duplicados"] = duplicados
    resumo(est, arquivos, dry)


if __name__ == "__main__":
    main()

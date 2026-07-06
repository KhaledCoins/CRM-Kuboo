-- ─────────────────────────────────────────────────────────────────────────────
-- Cosmético · corrige acentuação dos parceiros semeados sem acento.
-- REVISAR antes de rodar (renomeia registros existentes; vendas antigas que
-- referenciam a seguradora por NOME (texto) não são atualizadas por isso —
-- se já houver vendas apontando pros nomes sem acento, rode o bloco 2 junto.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) Parceiros
update seguradoras set nome = 'Âncora Consórcios'  where nome = 'Ancora Consorcios';
update seguradoras set nome = 'Itaú Seguros'        where nome = 'Itau Seguros';
update seguradoras set nome = 'Porto Consórcio'     where nome = 'Porto Consorcio';
update seguradoras set nome = 'SulAmérica'          where nome = 'SulAmerica';
update seguradoras set nome = 'Tradição Consórcios' where nome = 'Tradicao Consorcios';

-- 2) Vendas que citam os nomes antigos (campo texto `seguradora`)
update vendas set seguradora = 'Itaú Seguros'  where seguradora = 'Itau Seguros';
update vendas set seguradora = 'SulAmérica'    where seguradora = 'SulAmerica';

select nome, tipo from seguradoras order by nome;

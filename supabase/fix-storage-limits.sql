-- ─────────────────────────────────────────────────────────────────────────────
-- Trava de TIPO e TAMANHO no bucket de documentos (defesa no servidor).
-- Rodar no SQL Editor do Supabase. Idempotente.
--
-- PROBLEMA: o bucket `documentos-clientes` foi criado sem limites. A validação de
-- PDF/JPG/PNG e de 10MB só existe no client (DocumentosModal.validar()) — dá pra
-- contornar a UI e subir qualquer tipo/tamanho direto pela API de Storage (dentro
-- da própria pasta do dono, já que o RLS por folder[1] continua valendo).
--
-- CORREÇÃO: impõe os mesmos limites no Postgres, valem pra qualquer caminho de upload.
-- ─────────────────────────────────────────────────────────────────────────────

update storage.buckets
set allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png'],
    file_size_limit    = 10485760  -- 10 MB
where id = 'documentos-clientes';

select id, file_size_limit, allowed_mime_types
from storage.buckets where id = 'documentos-clientes';

-- =====================================================================
-- MIGRASI TAHAP 4 — jalankan SEKALI di Supabase SQL Editor (aman diulang)
-- Wajib dijalankan SETELAH 01, 02, 03, dan SEBELUM deploy kode baru.
--
--   - support_embedding   : embedding "modul ini berguna untuk apa" (dari
--                           supports_topics hasil analisis AI). Dipakai
--                           pencarian untuk merekomendasikan materi FONDASI
--                           yang lebih luas (mis. materi rotasi saat mencari
--                           "waves") secara semantik.
--   - ai_analysis_version : versi analisis AI terakhir tiap modul. Modul
--                           lama (versi 0) akan dianalisis ulang oleh
--                           /api/admin/retag-modules dengan prompt yang lebih
--                           luas.
-- =====================================================================

alter table public.modules add column if not exists support_embedding extensions.vector(1536);
alter table public.modules add column if not exists ai_analysis_version int not null default 0;

create index if not exists modules_support_embedding_hnsw
  on public.modules using hnsw (support_embedding extensions.vector_cosine_ops);

create or replace function public.match_modules_support(
  query_embedding extensions.vector(1536),
  match_count int default 20,
  min_similarity float default 0.2
)
returns table (id uuid, similarity float)
language sql
stable
set search_path = public, extensions
as $$
  select m.id, (1 - (m.support_embedding <=> query_embedding))::float as similarity
  from public.modules m
  where m.support_embedding is not null
    and (1 - (m.support_embedding <=> query_embedding)) >= min_similarity
  order by m.support_embedding <=> query_embedding
  limit match_count;
$$;

revoke execute on function public.match_modules_support(extensions.vector, int, float) from public, anon, authenticated;
grant  execute on function public.match_modules_support(extensions.vector, int, float) to service_role;

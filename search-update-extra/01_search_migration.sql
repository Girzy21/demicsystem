-- =====================================================================
-- MIGRASI SEARCH SEMANTIK (pgvector) — jalankan SEKALI di
-- Supabase Dashboard -> SQL Editor -> New query -> Run
-- Aman dijalankan ulang (semua pakai "if not exists" / "or replace").
-- Model embedding: text-embedding-3-small (1536 dimensi) via CometAPI.
-- =====================================================================

-- 1) Aktifkan pgvector (di schema "extensions", standar Supabase)
create extension if not exists vector with schema extensions;

-- 2) Kolom embedding untuk modul dan post forum
alter table public.modules add column if not exists embedding extensions.vector(1536);
alter table public.posts   add column if not exists embedding extensions.vector(1536);

-- 3) Sinkronkan tabel modules dengan Homepage terbaru:
--    - topic_is_custom: ditulis frontend saat uploader mengetik topik baru
--    - level: frontend sudah tidak mengirim level, jadi beri default "Both"
alter table public.modules add column if not exists topic_is_custom boolean not null default false;
alter table public.modules alter column level set default 'Both';

-- 4) Index vektor (cosine). Untuk data kecil pun aman dan siap tumbuh.
create index if not exists modules_embedding_hnsw
  on public.modules using hnsw (embedding extensions.vector_cosine_ops);
create index if not exists posts_embedding_hnsw
  on public.posts using hnsw (embedding extensions.vector_cosine_ops);

-- 5) Fungsi pencarian: mengembalikan id + skor kemiripan
--    (0..1, makin besar makin mirip)
create or replace function public.match_modules(
  query_embedding extensions.vector(1536),
  match_count int default 20,
  min_similarity float default 0.2
)
returns table (id uuid, similarity float)
language sql
stable
set search_path = public, extensions
as $$
  select m.id, (1 - (m.embedding <=> query_embedding))::float as similarity
  from public.modules m
  where m.embedding is not null
    and (1 - (m.embedding <=> query_embedding)) >= min_similarity
  order by m.embedding <=> query_embedding
  limit match_count;
$$;

create or replace function public.match_posts(
  query_embedding extensions.vector(1536),
  match_count int default 10,
  min_similarity float default 0.2
)
returns table (id uuid, similarity float)
language sql
stable
set search_path = public, extensions
as $$
  select p.id, (1 - (p.embedding <=> query_embedding))::float as similarity
  from public.posts p
  where p.embedding is not null
    and (1 - (p.embedding <=> query_embedding)) >= min_similarity
  order by p.embedding <=> query_embedding
  limit match_count;
$$;

-- 6) Fungsi hanya boleh dipanggil dari server (service_role), bukan dari browser
revoke execute on function public.match_modules(extensions.vector, int, float) from public, anon, authenticated;
revoke execute on function public.match_posts(extensions.vector, int, float)   from public, anon, authenticated;
grant  execute on function public.match_modules(extensions.vector, int, float) to service_role;
grant  execute on function public.match_posts(extensions.vector, int, float)   to service_role;

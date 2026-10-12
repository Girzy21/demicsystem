-- =====================================================================
-- MIGRASI TAHAP 2 — jalankan SEKALI di Supabase SQL Editor (aman diulang)
-- Wajib dijalankan SETELAH 01_search_migration.sql dan SEBELUM deploy
-- kode baru. Isinya:
--   - edited_at  : penanda "diedit" untuk post & balasan forum
--   - supports_topics : topik yang didukung/difondasi modul (hasil analisis AI),
--                       dipakai tier "Fondasi" di pencarian
--   - ai_analyzed_at  : penanda modul sudah dianalisis AI versi terbaru
-- =====================================================================

alter table public.posts   add column if not exists edited_at timestamptz;
alter table public.replies add column if not exists edited_at timestamptz;

alter table public.modules add column if not exists supports_topics text[] not null default '{}';
alter table public.modules add column if not exists ai_analyzed_at timestamptz;

-- Index kecil untuk halaman "aktivitas saya" & feed aktivitas
create index if not exists modules_uploader_created_idx on public.modules (uploader_id, created_at desc);
create index if not exists posts_author_created_idx     on public.posts   (author_id,   created_at desc);
create index if not exists replies_author_created_idx   on public.replies (author_id,   created_at desc);
create index if not exists modules_created_idx          on public.modules (created_at desc);
create index if not exists posts_created_idx            on public.posts   (created_at desc);
create index if not exists replies_created_idx          on public.replies (created_at desc);

-- =====================================================================
-- MIGRASI TAHAP 3 — jalankan SEKALI di Supabase SQL Editor (aman diulang)
-- Wajib dijalankan SETELAH 01 dan 02, dan SEBELUM deploy kode baru. Isinya:
--
--   Bank Modul
--   - is_exercise      : modul ini latihan soal (problem set) atau bukan
--   - exercise_set_by  : siapa yang menentukan jenisnya:
--                        'user'      = pilihan uploader saat upload (AI boleh menyesuaikan)
--                        'ai'        = sudah disesuaikan AI
--                        'user_edit' = diubah manual oleh pemilik (AI tidak menimpa lagi)
--
--   Forum
--   - posts.module_id  : modul Bank Modul yang disebut/dibahas dalam sebuah
--                        diskusi. Kalau modulnya dihapus, sebutan hilang
--                        otomatis (post tetap ada).
--
--   Profil
--   - profiles.goal    : tujuan/goal di profil (sebelumnya hanya ada di UI)
-- =====================================================================

alter table public.modules add column if not exists is_exercise boolean not null default false;
alter table public.modules add column if not exists exercise_set_by text not null default 'user';
create index if not exists modules_is_exercise_idx on public.modules (is_exercise);

alter table public.posts add column if not exists module_id uuid references public.modules(id) on delete set null;
create index if not exists posts_module_idx on public.posts (module_id);

alter table public.profiles add column if not exists goal text;

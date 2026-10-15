-- =====================================================================
-- ADMIN SYSTEM — jalankan SEKALI di Supabase > SQL Editor
-- Aman dijalankan ulang (memakai IF NOT EXISTS / OR REPLACE).
-- =====================================================================

-- 1) Role admin + status ditangguhkan, di tabel TERPISAH dari profiles.
--    RLS aktif TANPA policy sama sekali => hanya service role (route server)
--    yang bisa membaca/menulis. Pengguna biasa tidak bisa menjadikan dirinya
--    admin lewat Supabase client di browser.
create table if not exists public.user_access (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  is_admin         boolean not null default false,
  suspended_at     timestamptz,
  suspended_until  timestamptz,
  suspended_reason text,
  updated_at       timestamptz not null default now()
);
alter table public.user_access enable row level security;
revoke all on public.user_access from anon, authenticated;
grant all on public.user_access to service_role;

-- 2) Audit log. Sengaja TANPA foreign key ke pengguna supaya log tetap ada
--    walaupun akun admin/target dihapus.
create table if not exists public.admin_actions (
  id           bigint generated always as identity primary key,
  admin_id     uuid,
  admin_username text,
  action       text not null,
  target_type  text,
  target_id    text,
  target_label text,
  reason       text,
  snapshot     jsonb,
  created_at   timestamptz not null default now()
);
create index if not exists admin_actions_created_idx on public.admin_actions (created_at desc);
alter table public.admin_actions enable row level security;
revoke all on public.admin_actions from anon, authenticated;
grant all on public.admin_actions to service_role;
grant usage, select on all sequences in schema public to service_role;

-- 3) Penanda "sudah ditinjau admin" untuk antrean review modul.
alter table public.modules add column if not exists admin_reviewed_at timestamptz;

-- 4) Mengeluarkan paksa semua sesi sebuah akun (dipanggil route server).
create or replace function public.admin_revoke_sessions(target uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from auth.sessions where user_id = target;
end;
$$;
revoke all on function public.admin_revoke_sessions(uuid) from public, anon, authenticated;
grant execute on function public.admin_revoke_sessions(uuid) to service_role;

-- 5) ADMIN PERTAMA — ganti USERNAME_KAMU dengan username loginmu, lalu jalankan.
--    (Admin berikutnya diangkat dari panel: tab Pengguna > Kelola.)
insert into public.user_access (user_id, is_admin)
select id, true from public.profiles where username = 'USERNAME_KAMU'
on conflict (user_id) do update set is_admin = true, updated_at = now();

-- Cek hasilnya (harus muncul 1 baris dengan is_admin = true):
select p.username, a.is_admin from public.user_access a join public.profiles p on p.id = a.user_id;

-- ---------------------------------------------------------------------
-- (Opsional) pemeriksaan asumsi sebelum memakai panel:
--   select column_name from information_schema.columns
--     where table_schema='public' and table_name='modules'
--       and column_name in ('admin_reviewed_at','is_exercise','exercise_set_by','topic_is_custom','original_title','embedding');
--   -> harus 6 baris.
-- ---------------------------------------------------------------------

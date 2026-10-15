-- =====================================================================
-- TAHAP 2 — Permintaan reset password. Jalankan SEKALI di Supabase > SQL Editor.
-- (admin_setup.sql tahap 1 harus sudah dijalankan lebih dulu.) Aman diulang.
-- =====================================================================
create table if not exists public.password_reset_requests (
  id                  bigint generated always as identity primary key,
  user_id             uuid not null references auth.users(id) on delete cascade,
  username            text not null,
  note                text not null,
  status              text not null default 'pending' check (status in ('pending','done','rejected')),
  request_count       int  not null default 1,
  ip_hash             text,
  created_at          timestamptz not null default now(),
  last_requested_at   timestamptz not null default now(),
  resolved_at         timestamptz,
  resolved_by         uuid,
  resolved_by_username text,
  resolution_note     text
);
-- Satu permintaan "menunggu" per pengguna (permintaan berulang hanya menambah hitungan).
create unique index if not exists password_reset_one_pending
  on public.password_reset_requests (user_id) where status = 'pending';
create index if not exists password_reset_status_idx
  on public.password_reset_requests (status, last_requested_at desc);
create index if not exists password_reset_ip_idx
  on public.password_reset_requests (ip_hash, last_requested_at desc);

-- RLS aktif tanpa policy: hanya route server (service role) yang bisa membaca/menulis.
alter table public.password_reset_requests enable row level security;
revoke all on public.password_reset_requests from anon, authenticated;
grant all on public.password_reset_requests to service_role;
grant usage, select on all sequences in schema public to service_role;

select count(*) as permintaan_menunggu from public.password_reset_requests where status = 'pending';

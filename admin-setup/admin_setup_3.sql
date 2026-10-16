-- =====================================================================
-- TAHAP 3 — Diskusi Chat (real-time). Jalankan SEKALI di Supabase > SQL Editor.
-- Tahap 1 & 2 harus sudah dijalankan. Aman diulang.
-- =====================================================================

-- 1) Pesan chat yang dihapus disimpan sebagai "tombstone" (bukan DELETE), karena
--    menghapus baris akan ikut menghapus semua pesan yang mengutipnya (cascade).
alter table public.replies add column if not exists deleted_at timestamptz;

-- 2) Indeks supaya mengambil/menghitung pesan per ruang tetap cepat.
create index if not exists replies_post_created_idx on public.replies (post_id, created_at);

-- 3) Ringkasan ruang chat (jumlah pesan + pesan terakhir) dalam satu query.
--    Dipanggil hanya oleh server (service role). post_id dibandingkan sebagai
--    teks supaya cocok untuk id bertipe uuid maupun angka.
create or replace function public.chat_room_summaries(room_ids text[])
returns table (post_id text, message_count bigint, last_id text, last_author text, last_body text, last_at timestamptz)
language sql
stable
set search_path = public
as $$
  with sel as (
    select r.id, r.post_id, r.author_id, r.body, r.created_at
    from public.replies r
    where r.post_id::text = any(room_ids) and r.deleted_at is null
  ),
  cnt as (select s.post_id::text as pid, count(*) as c from sel s group by 1),
  lst as (
    select distinct on (s.post_id) s.post_id::text as pid, s.id::text as lid, s.author_id::text as aid, s.body as b, s.created_at as t
    from sel s order by s.post_id, s.created_at desc
  )
  select cnt.pid, cnt.c, lst.lid, lst.aid, lst.b, lst.t
  from cnt join lst on lst.pid = cnt.pid;
$$;
revoke all on function public.chat_room_summaries(text[]) from public, anon, authenticated;
grant execute on function public.chat_room_summaries(text[]) to service_role;

-- Cek: harus menampilkan 1 baris (kolom deleted_at ada).
select column_name from information_schema.columns
 where table_schema = 'public' and table_name = 'replies' and column_name = 'deleted_at';

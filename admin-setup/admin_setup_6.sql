-- w3study update 3: jenis post "informasi" + status baca/belum dibaca forum
-- Jalankan sekali di Supabase > SQL Editor. Aman dijalankan ulang.

-- ------------------------------------------------------------------
-- 1) Izinkan post_type = 'informasi'
--    Kolom post_type bisa berupa text + CHECK, atau enum. Skrip ini mengenali keduanya.
--    'pertanyaan' tetap diizinkan supaya post lama tidak bermasalah (UI sudah tidak menawarkannya).
-- ------------------------------------------------------------------
do $$
declare
  c   record;
  col record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.posts'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%post_type%'
  loop
    execute format('alter table public.posts drop constraint %I', c.conname);
  end loop;

  select data_type, udt_schema, udt_name into col
  from information_schema.columns
  where table_schema = 'public' and table_name = 'posts' and column_name = 'post_type';

  if col.data_type = 'USER-DEFINED' then
    execute format('alter type %I.%I add value if not exists %L', col.udt_schema, col.udt_name, 'informasi');
  else
    -- NOT VALID: hanya memeriksa post baru, tidak menolak baris lama apa pun isinya.
    execute 'alter table public.posts add constraint posts_post_type_check check (post_type in (''diskusi'',''ide'',''sharing'',''pertanyaan'',''informasi'')) not valid';
  end if;
end $$;

-- ------------------------------------------------------------------
-- 2) Status baca forum
--    forum_read_state.baseline : post yang dibuat SEBELUM waktu ini dianggap sudah dibaca
--                                (supaya forum yang sudah ramai tidak tiba-tiba "belum dibaca" semua).
--    post_reads                : post yang sudah dibuka pengguna.
-- ------------------------------------------------------------------
create table if not exists public.forum_read_state (
  user_id  uuid primary key,
  baseline timestamptz not null default now()
);
create table if not exists public.post_reads (
  user_id uuid not null,
  post_id text not null,
  read_at timestamptz not null default now(),
  primary key (user_id, post_id)
);
create index if not exists post_reads_user_idx on public.post_reads (user_id);

alter table public.forum_read_state enable row level security;
alter table public.post_reads       enable row level security;
revoke all on public.forum_read_state from anon, authenticated;
revoke all on public.post_reads       from anon, authenticated;
grant all on public.forum_read_state to service_role;
grant all on public.post_reads       to service_role;

-- Semua pengguna yang sudah ada: post lama dianggap sudah dibaca, yang baru setelah ini belum.
-- (Pengguna baru mendapat baris ini otomatis saat pertama membuka forum.)
insert into public.forum_read_state (user_id, baseline)
select id::uuid, now() from public.profiles
on conflict (user_id) do nothing;

notify pgrst, 'reload schema';

-- w3study update 2: topik bawaan yang dihapus admin
-- Jalankan sekali di Supabase > SQL Editor.
--
-- Topik bawaan (daftar di src/lib/folderTree.js) tidak tersimpan di database, jadi
-- "menghapus" topik bawaan = mencatatnya di sini supaya foldernya disembunyikan dari siswa
-- dan dari pilihan topik saat upload. Baris dihapus = topik dipulihkan.
-- Topik buatan pengguna tidak butuh tabel ini: ia hilang sendiri begitu isinya dipindahkan.

create table if not exists public.removed_topics (
  subject    text not null,
  topic      text not null,
  removed_by text,
  removed_at timestamptz not null default now(),
  primary key (subject, topic)
);
alter table public.removed_topics enable row level security;
revoke all on public.removed_topics from anon, authenticated;
grant all on public.removed_topics to service_role;

notify pgrst, 'reload schema';

-- w3study update: urutan modul di dalam topik (diatur admin)
-- Jalankan sekali di Supabase > SQL Editor.
--
-- sort_order = NULL  -> belum diatur (modul tampil terbaru dulu, di bawah modul yang sudah diurutkan)
-- sort_order = 1,2,3 -> urutan dari atas ke bawah di dalam satu topik

alter table public.modules add column if not exists sort_order integer;
create index if not exists modules_topic_order_idx on public.modules (subject, topic, sort_order);

notify pgrst, 'reload schema';

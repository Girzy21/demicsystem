// Supabase client untuk dipakai di FRONTEND (komponen React, "use client").
// Cuma pakai anon key (aman terlihat di browser) — akses data tetap dibatasi
// oleh RLS policy yang sudah dibuat di Supabase dashboard.
//
// Cara pakai di komponen:
//   import { supabase } from "@/lib/supabaseClient";
//   const { data, error } = await supabase.from("posts").select("*");

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Supabase URL/anon key belum diisi. Cek file .env.local kamu — pastikan " +
    "NEXT_PUBLIC_SUPABASE_URL dan NEXT_PUBLIC_SUPABASE_ANON_KEY sudah terisi, " +
    "lalu restart server (npm run dev)."
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
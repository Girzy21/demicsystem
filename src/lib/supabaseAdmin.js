// Supabase client untuk dipakai HANYA di BACKEND (API routes, folder
// src/app/api/**/route.js). Pakai service_role key yang bisa BYPASS semua
// RLS policy — jangan pernah import file ini dari komponen React ("use
// client") atau file apapun yang bisa jadi bagian dari bundle browser.
//
// Cara pakai di API route:
//   import { supabaseAdmin } from "@/lib/supabaseAdmin";
//   const { data, error } = await supabaseAdmin.from("posts").select("*");

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error(
    "Supabase service_role key belum diisi. Cek file .env.local kamu — " +
    "pastikan SUPABASE_SERVICE_ROLE_KEY sudah terisi, lalu restart server."
  );
}

export const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    // Backend tidak perlu simpan sesi login siapa pun di sini — setiap
    // request dari backend bertindak sebagai "admin", bukan sebagai user
    // tertentu.
    autoRefreshToken: false,
    persistSession: false,
  },
});
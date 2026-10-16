// src/lib/realtime.js  (SERVER)
//
// Mengirim "sinyal" real-time lewat Supabase Realtime Broadcast (REST).
// PENTING: payload hanya berisi ID / jenis kejadian, TIDAK PERNAH isi pesan.
// Kanal broadcast bersifat publik (siapa pun yang punya anon key bisa
// berlangganan), jadi isi pesan tetap diambil klien lewat API yang butuh login.
//
// Tidak pernah melempar error dan dibatasi 2,5 detik: kalau Realtime sedang
// bermasalah, pesan tetap tersimpan dan klien akan menyusul lewat polling.
import { supabaseAdmin } from "@/lib/supabaseAdmin";

let warned = false;

export async function broadcast(topic, event, payload = {}) {
  try {
    // supabase-js menyimpan URL & key yang dipakai membuat klien -> tidak perlu
    // menebak nama env var.
    const url = supabaseAdmin.supabaseUrl || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const key = supabaseAdmin.supabaseKey || process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      if (!warned) console.warn("Realtime: URL/key Supabase tidak ditemukan; sinyal tidak dikirim (klien memakai polling).");
      warned = true;
      return false;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch(`${String(url).replace(/\/$/, "")}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${key}` },
      body: JSON.stringify({ messages: [{ topic, event, payload }] }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      console.error("Realtime broadcast gagal:", res.status);
      return false;
    }
    return true;
  } catch (err) {
    console.error("Realtime broadcast error:", err && err.message);
    return false;
  }
}

export const chatTopic = (postId) => `chat:${postId}`;
export const FEED_TOPIC = "forum:feed";

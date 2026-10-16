// src/lib/chatSummary.js  (SERVER)
// Ringkasan ruang chat (jumlah pesan + pesan terakhir) untuk daftar forum.
// Memakai fungsi SQL chat_room_summaries (admin_setup_3.sql); kalau belum
// dijalankan, jatuh ke perhitungan dari pesan terbaru (perkiraan).
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { usernamesByIds } from "@/lib/adminAuth";

const SNIP = 120;
const snip = (t) => {
  const x = String(t || "").replace(/\s+/g, " ").trim();
  return x.length > SNIP ? `${x.slice(0, SNIP - 1)}…` : x;
};

async function rowsFromRpc(ids) {
  const { data, error } = await supabaseAdmin.rpc("chat_room_summaries", { room_ids: ids });
  if (error || !Array.isArray(data)) return null;
  return data;
}

async function rowsFallback(ids) {
  const acc = {};
  for (let i = 0; i < ids.length; i += 40) {
    const chunk = ids.slice(i, i + 40);
    let r = await supabaseAdmin
      .from("replies")
      .select("id, post_id, author_id, body, created_at, deleted_at")
      .in("post_id", chunk)
      .order("created_at", { ascending: false })
      .limit(1500);
    if (r.error && r.error.code === "42703") {
      r = await supabaseAdmin.from("replies").select("id, post_id, author_id, body, created_at").in("post_id", chunk).order("created_at", { ascending: false }).limit(1500);
    }
    for (const m of r.data || []) {
      if (m.deleted_at) continue;
      const k = String(m.post_id);
      if (!acc[k]) acc[k] = { post_id: k, message_count: 0, last_id: String(m.id), last_author: String(m.author_id), last_body: m.body, last_at: m.created_at };
      acc[k].message_count += 1;
    }
  }
  return Object.values(acc);
}

// Mengembalikan { [postId]: { count, last: { id, author, body, createdAt } | null } }
export async function getChatSummaries(postIds) {
  const ids = Array.from(new Set((postIds || []).filter(Boolean).map(String)));
  const out = {};
  for (const id of ids) out[id] = { count: 0, last: null };
  if (ids.length === 0) return out;
  const rows = (await rowsFromRpc(ids)) || (await rowsFallback(ids));
  const names = await usernamesByIds(rows.map((r) => r.last_author));
  for (const r of rows) {
    out[String(r.post_id)] = {
      count: Number(r.message_count) || 0,
      last: r.last_id ? { id: String(r.last_id), author: names[r.last_author] || "pengguna", body: snip(r.last_body), createdAt: r.last_at } : null,
    };
  }
  return out;
}

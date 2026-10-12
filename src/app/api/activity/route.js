// API route: GET /api/activity
//
// Backend untuk menu "Aktivitas Terbaru": gabungan kejadian terbaru dari
// seluruh ekosistem, dibaca langsung dari tabel yang sudah ada (tidak butuh
// tabel baru), diurutkan dari yang terbaru:
//   - modul yang diunggah / link yang dibagikan   (tabel modules)
//   - post forum baru                              (tabel posts)
//   - balasan di forum                             (tabel replies)
// Konten yang dihapus otomatis hilang dari feed karena sumbernya sudah hilang.
//
// Hanya username yang ditampilkan (lewat view public_profiles).

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const PER_SOURCE = 25; // ambil sebanyak ini per tabel, lalu digabung & dipotong
const MAX_ITEMS = 30;
const SNIPPET_CHARS = 90;

const POST_VERB = {
  diskusi: "membuka diskusi",
  ide: "membagikan ide",
  sharing: "membagikan",
  pertanyaan: "bertanya",
};

function snippet(text) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  return t.length > SNIPPET_CHARS ? `${t.slice(0, SNIPPET_CHARS - 1)}…` : t;
}

export async function GET(request) {
  try {
    const authHeader = request.headers.get("authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) {
      return NextResponse.json({ error: "Tidak ada token autentikasi." }, { status: 401 });
    }
    const {
      data: { user },
      error: authError,
    } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ error: "Sesi tidak valid — coba login ulang." }, { status: 401 });
    }

    const [modRes, postRes, replyRes, profRes] = await Promise.all([
      supabaseAdmin
        .from("modules")
        .select("id, uploader_id, title, subject, topic, link_url, created_at")
        .order("created_at", { ascending: false })
        .limit(PER_SOURCE),
      supabaseAdmin
        .from("posts")
        .select("id, author_id, post_type, body, subject, created_at")
        .order("created_at", { ascending: false })
        .limit(PER_SOURCE),
      supabaseAdmin
        .from("replies")
        .select("id, post_id, author_id, created_at")
        .order("created_at", { ascending: false })
        .limit(PER_SOURCE),
      supabaseAdmin.from("public_profiles").select("id, username"),
    ]);
    if (modRes.error || postRes.error || replyRes.error) {
      console.error("Gagal mengambil aktivitas:", modRes.error || postRes.error || replyRes.error);
      return NextResponse.json({ error: "Gagal mengambil aktivitas." }, { status: 500 });
    }
    const usernameById = Object.fromEntries((profRes.data || []).map((p) => [p.id, p.username]));
    const nameOf = (id) => usernameById[id] || "pengguna";

    // Balasan perlu konteks post induknya (isi & subject).
    const replyPostIds = Array.from(new Set((replyRes.data || []).map((r) => r.post_id)));
    let parentById = {};
    if (replyPostIds.length > 0) {
      const { data: parents } = await supabaseAdmin
        .from("posts")
        .select("id, body, subject")
        .in("id", replyPostIds);
      parentById = Object.fromEntries((parents || []).map((p) => [p.id, p]));
    }

    const items = [];
    for (const m of modRes.data || []) {
      items.push({
        id: `modul-${m.id}`,
        type: "modul",
        user: nameOf(m.uploader_id),
        subject: m.subject,
        topic: m.topic,
        text: m.link_url ? `membagikan link: ${snippet(m.title)}` : `mengunggah modul: ${snippet(m.title)}`,
        createdAt: m.created_at,
        target: { kind: "module", id: m.id, subject: m.subject, topic: m.topic },
      });
    }
    for (const p of postRes.data || []) {
      items.push({
        id: `post-${p.id}`,
        type: "forum",
        user: nameOf(p.author_id),
        subject: p.subject || "Umum",
        text: `${POST_VERB[p.post_type] || "membagikan"}: ${snippet(p.body)}`,
        createdAt: p.created_at,
        target: { kind: "post", id: p.id },
      });
    }
    for (const r of replyRes.data || []) {
      const parent = parentById[r.post_id];
      if (!parent) continue; // post induk sudah terhapus
      items.push({
        id: `reply-${r.id}`,
        type: "forum",
        user: nameOf(r.author_id),
        subject: parent.subject || "Umum",
        text: `membalas diskusi: ${snippet(parent.body)}`,
        createdAt: r.created_at,
        target: { kind: "post", id: r.post_id },
      });
    }

    items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
    return NextResponse.json({ items: items.slice(0, MAX_ITEMS) });
  } catch (err) {
    console.error("Gagal memproses aktivitas:", err);
    return NextResponse.json({ error: "Gagal mengambil aktivitas." }, { status: 500 });
  }
}

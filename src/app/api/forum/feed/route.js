// API route: GET /api/forum/feed
//
// Pengganti GET /api/forum/posts untuk daftar forum (bentuk jawaban SAMA, plus
// ringkasan chat). Bedanya:
//   - Balasan hanya dimuat untuk post NON-chat. Pesan "Diskusi Chat" bisa
//     sangat banyak dan tidak boleh ikut mendorong komentar post lain keluar
//     dari batas jumlah baris.
//   - Setiap post bertipe "diskusi" membawa `chat: { count, last }` untuk
//     pratinjau ruang chat di daftar.
// GET /api/forum/posts yang lama tetap ada (tidak dipakai lagi oleh Homepage).
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireUser } from "@/lib/adminAuth";
import { getChatSummaries } from "@/lib/chatSummary";

export const dynamic = "force-dynamic";

// Batas untuk skala sekolah (ratusan user). Ganti dengan paginasi bila forum jauh lebih besar.
const MAX_POSTS = 300;
const MAX_REPLIES_PER_CHUNK = 3000;
const MAX_LIKES = 20000;
const CHUNK = 40;

export async function GET(request) {
  try {
    const u = await requireUser(request);
    if (u.error) return u.error;
    const userId = u.user.id;

    // edited_at & module_id ada setelah SQL tahap 2/3; kalau belum ada, feed tetap jalan.
    const postCols = "id, author_id, post_type, body, subject, topic, images, attachment_name, created_at";
    const postAttempts = [`${postCols}, edited_at, module_id`, `${postCols}, edited_at`, postCols];
    let posts = null;
    let postsError = null;
    for (const cols of postAttempts) {
      const r = await supabaseAdmin.from("posts").select(cols).order("created_at", { ascending: false }).limit(MAX_POSTS);
      posts = r.data;
      postsError = r.error;
      if (!r.error || r.error.code !== "42703") break;
    }
    if (postsError) {
      console.error("Gagal mengambil daftar post:", postsError);
      return NextResponse.json({ error: "Gagal mengambil daftar post." }, { status: 500 });
    }
    posts = posts || [];

    // Status baca (tabel forum_read_state + post_reads, admin_setup_6.sql).
    // Tabel belum ada -> readSet = null -> semua post dianggap sudah dibaca (tidak ada yang ditandai "baru").
    let readSet = null;
    let baseline = null;
    try {
      const st = await supabaseAdmin.from("forum_read_state").select("baseline").eq("user_id", userId).maybeSingle();
      if (!st.error) {
        if (st.data) baseline = st.data.baseline;
        else {
          // Pengguna baru: post yang sudah ada saat pertama membuka forum dianggap sudah dibaca.
          const ins = await supabaseAdmin.from("forum_read_state").insert({ user_id: userId }).select("baseline").single();
          if (!ins.error) baseline = ins.data.baseline;
        }
        if (baseline) {
          const rr = await supabaseAdmin.from("post_reads").select("post_id").eq("user_id", userId).limit(20000);
          if (!rr.error) readSet = new Set((rr.data || []).map((r) => String(r.post_id)));
        }
      }
    } catch (err) {
      console.error("Gagal membaca status baca (feed tetap dikirim):", err);
    }
    const baselineMs = baseline ? new Date(baseline).getTime() : 0;
    const isRead = (p) => {
      if (!readSet) return true; // pelacakan belum aktif
      if (p.author_id === userId) return true; // post sendiri
      if (new Date(p.created_at).getTime() <= baselineMs) return true; // dibuat sebelum fitur ini / sebelum "tandai semua dibaca"
      return readSet.has(String(p.id));
    };

    // Ringkasan modul yang disebut.
    const moduleIds = Array.from(new Set(posts.map((p) => p.module_id).filter(Boolean)));
    const moduleById = {};
    for (let i = 0; i < moduleIds.length; i += 50) {
      const { data: mods } = await supabaseAdmin.from("modules").select("id, title, subject, topic, file_type, link_url").in("id", moduleIds.slice(i, i + 50));
      for (const m of mods || []) {
        moduleById[m.id] = { id: m.id, title: m.title, subject: m.subject, topic: m.topic, type: m.link_url ? "LINK" : m.file_type };
      }
    }

    // Balasan: hanya untuk post non-chat, dalam potongan kecil agar URL request pendek.
    const chatIds = posts.filter((p) => p.post_type === "diskusi").map((p) => p.id);
    const commentIds = posts.filter((p) => p.post_type !== "diskusi").map((p) => p.id);
    const replyCols = "id, post_id, parent_id, author_id, body, images, attachment_name, created_at";
    const chunks = [];
    for (let i = 0; i < commentIds.length; i += CHUNK) chunks.push(commentIds.slice(i, i + CHUNK));
    const fetched = await Promise.all(
      chunks.map(async (ids) => {
        let r = await supabaseAdmin.from("replies").select(`${replyCols}, edited_at`).in("post_id", ids).order("created_at", { ascending: true }).limit(MAX_REPLIES_PER_CHUNK);
        if (r.error && r.error.code === "42703") {
          r = await supabaseAdmin.from("replies").select(replyCols).in("post_id", ids).order("created_at", { ascending: true }).limit(MAX_REPLIES_PER_CHUNK);
        }
        return r;
      })
    );
    const failed = fetched.find((r) => r.error);
    if (failed) {
      console.error("Gagal mengambil balasan:", failed.error);
      return NextResponse.json({ error: "Gagal mengambil balasan." }, { status: 500 });
    }
    const replies = fetched.flatMap((r) => r.data || []).sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));

    // Semua like diambil sekaligus lalu dihitung di JS (menghindari .in() dengan ratusan id).
    const { data: likeRows } = await supabaseAdmin.from("likes").select("post_id, reply_id, user_id").limit(MAX_LIKES);
    const likeCount = {};
    const likedByMe = {};
    for (const l of likeRows || []) {
      const targetId = l.post_id || l.reply_id;
      if (!targetId) continue;
      likeCount[targetId] = (likeCount[targetId] || 0) + 1;
      if (l.user_id === userId) likedByMe[targetId] = true;
    }

    // Username dari public_profiles (tidak membuka real_name kecuali show_real_name = true).
    const { data: profs } = await supabaseAdmin.from("public_profiles").select("id, username");
    const usernameById = Object.fromEntries((profs || []).map((p) => [p.id, p.username]));

    let chat = {};
    try {
      chat = await getChatSummaries(chatIds);
    } catch (err) {
      console.error("Gagal mengambil ringkasan chat (feed tetap dikirim):", err);
    }

    return NextResponse.json({
      readTracking: !!readSet,
      posts: posts.map((p) => ({
        id: p.id,
        postType: p.post_type,
        body: p.body,
        subject: p.subject,
        topic: p.topic,
        images: p.images || [],
        attachmentName: p.attachment_name || null,
        author: usernameById[p.author_id] || "pengguna",
        createdAt: p.created_at,
        editedAt: p.edited_at || null,
        moduleId: p.module_id || null,
        module: p.module_id ? moduleById[p.module_id] || null : null,
        likes: likeCount[p.id] || 0,
        likedByMe: !!likedByMe[p.id],
        chat: p.post_type === "diskusi" ? chat[String(p.id)] || { count: 0, last: null } : null,
        read: isRead(p),
      })),
      replies: replies.map((r) => ({
        id: r.id,
        postId: r.post_id,
        parentId: r.parent_id || null,
        body: r.body,
        images: r.images || [],
        attachmentName: r.attachment_name || null,
        author: usernameById[r.author_id] || "pengguna",
        createdAt: r.created_at,
        editedAt: r.edited_at || null,
        likes: likeCount[r.id] || 0,
        likedByMe: !!likedByMe[r.id],
      })),
    });
  } catch (err) {
    console.error("Gagal memproses feed forum:", err);
    return NextResponse.json({ error: "Gagal mengambil feed forum." }, { status: 500 });
  }
}

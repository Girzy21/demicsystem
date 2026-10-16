// API route: GET/POST /api/forum/chat/[postId]
//
// "Diskusi Chat": post bertipe "diskusi" menjadi ruang chat. Pesan disimpan di
// tabel replies yang sama (datar; parent_id dipakai sebagai "balas pesan ini").
//
// GET  ?limit=40            -> pesan terbaru (urut lama -> baru)
//      ?before=<ISO>        -> halaman pesan yang lebih lama
//      ?after=<ISO>         -> pesan yang lebih baru dari penanda waktu (sinkron real-time)
// POST { body, parentId?, images?: [{publicId}] } -> kirim pesan
//
// Real-time: setelah pesan tersimpan, server mengirim SINYAL (hanya id) lewat
// Supabase Realtime Broadcast; klien lalu mengambil isinya dari GET ini (yang
// wajib login). Lihat lib/realtime.js.
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { verifyUpload } from "@/lib/cloudinaryUploads";
import { embedForumPost } from "@/lib/embeddings";
import { requireUser, assertActive, usernamesByIds } from "@/lib/adminAuth";
import { broadcast, chatTopic, FEED_TOPIC } from "@/lib/realtime";

export const dynamic = "force-dynamic";

const MAX_BODY = 2000;
const MAX_IMAGES = 4;
const PAGE_DEFAULT = 40;
const PAGE_MAX = 60;
const RATE_WINDOW_MS = 10000;
const RATE_MAX = 10; // maks. 10 pesan per 10 detik per pengguna
const IMAGE_ONLY_BODY = "📷 Gambar";
const COLS = "id, post_id, parent_id, author_id, body, images, created_at, edited_at, deleted_at";
const SNIP = 100;

const snip = (t) => {
  const x = String(t || "").replace(/\s+/g, " ").trim();
  return x.length > SNIP ? `${x.slice(0, SNIP - 1)}…` : x;
};
const bad = (error, status = 400) => NextResponse.json({ error }, { status });
const needsSql = (error) => error && error.code === "42703";

async function loadRoom(postId) {
  const { data, error } = await supabaseAdmin.from("posts").select("id, author_id, post_type, body, subject, topic, created_at").eq("id", postId).maybeSingle();
  if (error || !data) return null;
  return data;
}

// Menambahkan nama penulis + kutipan pesan yang dibalas.
async function hydrateMessages(rows) {
  const parentIds = Array.from(new Set(rows.map((r) => r.parent_id).filter(Boolean)));
  const parents = {};
  for (let i = 0; i < parentIds.length; i += 50) {
    const { data } = await supabaseAdmin.from("replies").select("id, author_id, body, deleted_at").in("id", parentIds.slice(i, i + 50));
    for (const p of data || []) parents[p.id] = p;
  }
  const names = await usernamesByIds([...rows.map((r) => r.author_id), ...Object.values(parents).map((p) => p.author_id)]);
  return rows.map((r) => {
    const par = r.parent_id ? parents[r.parent_id] : null;
    return {
      id: r.id,
      postId: r.post_id,
      parentId: r.parent_id || null,
      author: names[r.author_id] || "pengguna",
      body: r.deleted_at ? "" : r.body,
      images: r.deleted_at ? [] : r.images || [],
      createdAt: r.created_at,
      editedAt: r.edited_at || null,
      deleted: !!r.deleted_at,
      replyTo: par ? { id: par.id, author: names[par.author_id] || "pengguna", body: par.deleted_at ? "" : snip(par.body), deleted: !!par.deleted_at } : null,
    };
  });
}

// Pengisian ulang embedding hanya pada ambang tertentu supaya chat yang ramai
// tidak memanggil API embedding di setiap pesan.
const shouldReembed = (n) => [1, 3, 10, 25, 50].includes(n) || (n > 0 && n % 100 === 0);

export async function GET(request, { params }) {
  try {
    const { postId } = await params;
    const u = await requireUser(request);
    if (u.error) return u.error;
    const room = await loadRoom(postId);
    if (!room) return bad("Ruang chat tidak ditemukan.", 404);
    if (room.post_type !== "diskusi") return bad("Post ini bukan ruang chat.");

    const url = new URL(request.url);
    const limit = Math.min(PAGE_MAX, Math.max(1, parseInt(url.searchParams.get("limit") || "", 10) || PAGE_DEFAULT));
    const valid = (v) => v && !Number.isNaN(Date.parse(v));
    const before = valid(url.searchParams.get("before")) ? url.searchParams.get("before") : null;
    const after = valid(url.searchParams.get("after")) ? url.searchParams.get("after") : null;

    let rows;
    let error;
    const base = supabaseAdmin.from("replies").select(COLS).eq("post_id", postId);
    if (after) {
      ({ data: rows, error } = await base.gt("created_at", after).order("created_at", { ascending: true }).limit(100));
    } else {
      const q = before ? base.lt("created_at", before) : base;
      const r = await q.order("created_at", { ascending: false }).limit(limit);
      rows = (r.data || []).slice().reverse();
      error = r.error;
    }
    if (error) {
      console.error("Gagal mengambil pesan chat:", error);
      return bad(needsSql(error) ? "Database belum siap untuk chat. Sudah menjalankan admin_setup_3.sql?" : "Gagal mengambil pesan.", 500);
    }
    const messages = await hydrateMessages(rows || []);
    const names = await usernamesByIds([room.author_id]);
    return NextResponse.json({
      messages,
      hasMore: !after && (rows || []).length === limit,
      room: { id: room.id, author: names[room.author_id] || "pengguna", body: room.body, subject: room.subject, topic: room.topic },
    });
  } catch (err) {
    console.error("Gagal memproses pesan chat:", err);
    return bad("Gagal mengambil pesan.", 500);
  }
}

export async function POST(request, { params }) {
  try {
    const { postId } = await params;
    const u = await requireUser(request);
    if (u.error) return u.error;
    const blocked = await assertActive(u.user.id);
    if (blocked) return blocked;

    const body = await request.json().catch(() => ({}));
    const text = String(body.body || "").trim();
    const imgs = Array.isArray(body.images) ? body.images : [];
    if (!text && imgs.length === 0) return bad("Pesan tidak boleh kosong.");
    if (text.length > MAX_BODY) return bad(`Pesan maksimal ${MAX_BODY} karakter.`);
    if (imgs.length > MAX_IMAGES) return bad(`Maksimal ${MAX_IMAGES} gambar per pesan.`);

    const room = await loadRoom(postId);
    if (!room) return bad("Ruang chat tidak ditemukan.", 404);
    if (room.post_type !== "diskusi") return bad("Post ini bukan ruang chat.");

    const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
    const { count: recent } = await supabaseAdmin.from("replies").select("*", { count: "exact", head: true }).eq("author_id", u.user.id).gte("created_at", since);
    if ((recent || 0) >= RATE_MAX) return bad("Terlalu cepat — tunggu sebentar sebelum mengirim lagi.", 429);

    const parentId = body.parentId ? String(body.parentId) : null;
    if (parentId) {
      const { data: par } = await supabaseAdmin.from("replies").select("id, post_id").eq("id", parentId).maybeSingle();
      if (!par || String(par.post_id) !== String(postId)) return bad("Pesan yang dibalas tidak ditemukan.");
    }

    const urls = [];
    for (const it of imgs) {
      const check = await verifyUpload({ publicId: it && it.publicId, resourceType: "image", purpose: "forum", userId: u.user.id });
      if (!check.ok) return bad(check.error, check.status);
      urls.push(check.resource.secure_url);
    }

    const { data: row, error } = await supabaseAdmin
      .from("replies")
      .insert({ post_id: postId, parent_id: parentId, author_id: u.user.id, body: text || IMAGE_ONLY_BODY, images: urls })
      .select(COLS)
      .single();
    if (error || !row) {
      console.error("Gagal menyimpan pesan chat:", error);
      return bad(needsSql(error) ? "Database belum siap untuk chat. Sudah menjalankan admin_setup_3.sql?" : "Gagal mengirim pesan. Coba lagi.", 500);
    }

    const [message] = await hydrateMessages([row]);
    await Promise.all([broadcast(chatTopic(postId), "message", { kind: "new", id: row.id }), broadcast(FEED_TOPIC, "activity", { kind: "chat", postId })]);

    const { count: total } = await supabaseAdmin.from("replies").select("*", { count: "exact", head: true }).eq("post_id", postId).is("deleted_at", null);
    if (shouldReembed(total || 0)) await embedForumPost(postId);

    return NextResponse.json({ message });
  } catch (err) {
    console.error("Gagal memproses kiriman chat:", err);
    return bad("Gagal mengirim pesan.", 500);
  }
}

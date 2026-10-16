// GET  /api/admin/content?type=module|post|reply|thread&q=&author=&subject=&page=&id=
// POST /api/admin/content  { action: "delete", items: [{type,id}], reason }
//
// Moderasi konten. Admin hanya MENGHAPUS post/balasan orang lain (tidak
// mengedit isinya). Setiap penghapusan masuk audit log dengan snapshot.
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { embedForumPost } from "@/lib/embeddings";
import { requireAdmin, usernamesByIds, pageParams, cleanSearch } from "@/lib/adminAuth";
import { deleteModuleById, deletePostById, deleteReplyById } from "@/lib/adminContent";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MODULE_COLS =
  "id, uploader_id, title, original_title, subject, topic, topic_is_custom, description, file_type, link_url, file_size_bytes, tags, is_exercise, exercise_set_by, admin_reviewed_at, created_at";

export async function GET(request) {
  const a = await requireAdmin(request);
  if (a.error) return a.error;
  try {
    const url = new URL(request.url);
    const type = url.searchParams.get("type") || "module";
    const q = cleanSearch(url.searchParams.get("q"));
    const subject = (url.searchParams.get("subject") || "").trim();
    const authorQ = cleanSearch(url.searchParams.get("author"));
    const { page, size, from, to } = pageParams(url);

    if (type === "thread") {
      const id = url.searchParams.get("id");
      const { data: post } = await supabaseAdmin
        .from("posts")
        .select("id, author_id, post_type, body, subject, topic, images, created_at")
        .eq("id", id)
        .maybeSingle();
      if (!post) return NextResponse.json({ error: "Post tidak ditemukan." }, { status: 404 });
      const { data: replies } = await supabaseAdmin
        .from("replies")
        .select("id, parent_id, author_id, body, images, created_at")
        .eq("post_id", id)
        .order("created_at", { ascending: true })
        .limit(1000);
      const names = await usernamesByIds([post.author_id, ...(replies || []).map((r) => r.author_id)]);
      return NextResponse.json({
        post: { ...post, author: names[post.author_id] || "pengguna" },
        replies: (replies || []).map((r) => ({ ...r, author: names[r.author_id] || "pengguna" })),
      });
    }

    let authorIds = null;
    if (authorQ) {
      const { data } = await supabaseAdmin.from("public_profiles").select("id").ilike("username", `%${authorQ}%`).limit(200);
      authorIds = (data || []).map((p) => p.id);
      if (authorIds.length === 0) return NextResponse.json({ items: [], total: 0, page, size });
    }

    let query;
    let authorCol = "author_id";
    if (type === "module") {
      authorCol = "uploader_id";
      query = supabaseAdmin.from("modules").select(MODULE_COLS, { count: "exact" });
      if (q) query = query.or(`title.ilike.%${q}%,description.ilike.%${q}%`);
      if (subject) query = query.eq("subject", subject);
    } else if (type === "post") {
      query = supabaseAdmin.from("posts").select("id, author_id, post_type, body, subject, topic, images, created_at", { count: "exact" });
      if (q) query = query.ilike("body", `%${q}%`);
      if (subject) query = query.eq("subject", subject);
    } else if (type === "reply") {
      query = supabaseAdmin.from("replies").select("id, post_id, parent_id, author_id, body, images, created_at", { count: "exact" });
      if (q) query = query.ilike("body", `%${q}%`);
    } else {
      return NextResponse.json({ error: "Jenis konten tidak dikenal." }, { status: 400 });
    }
    if (authorIds) query = query.in(authorCol, authorIds);

    const { data, count, error } = await query.order("created_at", { ascending: false }).range(from, to);
    if (error) {
      console.error("Gagal mengambil konten admin:", error);
      return NextResponse.json({ error: "Gagal mengambil konten." }, { status: 500 });
    }
    const names = await usernamesByIds((data || []).map((r) => r[authorCol]));
    const items = (data || []).map((r) => ({ ...r, type, author: names[r[authorCol]] || "pengguna" }));
    return NextResponse.json({ items, total: count || 0, page, size });
  } catch (err) {
    console.error("Gagal memproses daftar konten admin:", err);
    return NextResponse.json({ error: "Gagal mengambil konten." }, { status: 500 });
  }
}

export async function POST(request) {
  const a = await requireAdmin(request);
  if (a.error) return a.error;
  try {
    const body = await request.json().catch(() => ({}));
    if (body.action !== "delete") return NextResponse.json({ error: "Aksi tidak dikenal." }, { status: 400 });
    const reason = String(body.reason || "").trim();
    if (reason.length < 3) return NextResponse.json({ error: "Alasan wajib diisi (minimal 3 karakter)." }, { status: 400 });
    const items = Array.isArray(body.items) ? body.items.slice(0, 50) : [];
    if (items.length === 0) return NextResponse.json({ error: "Tidak ada item yang dipilih." }, { status: 400 });

    const results = [];
    const deletedPosts = new Set();
    const touchedPosts = new Set();
    for (const it of items) {
      const id = String(it?.id || "");
      let r;
      if (it?.type === "module") r = await deleteModuleById(id, { admin: a, reason });
      else if (it?.type === "post") {
        r = await deletePostById(id, { admin: a, reason });
        if (r.ok) deletedPosts.add(id);
      } else if (it?.type === "reply") {
        r = await deleteReplyById(id, { admin: a, reason, reembed: false });
        if (r.ok && r.postId) touchedPosts.add(r.postId);
      } else r = { ok: false, error: "Jenis tidak dikenal." };
      results.push({ type: it?.type, id, ...r });
    }
    // Isi balasan yang hilang tidak boleh lagi memengaruhi pencarian.
    for (const pid of touchedPosts) if (!deletedPosts.has(pid)) await embedForumPost(pid);

    return NextResponse.json({ results });
  } catch (err) {
    console.error("Gagal memproses penghapusan konten admin:", err);
    return NextResponse.json({ error: "Gagal menghapus konten." }, { status: 500 });
  }
}

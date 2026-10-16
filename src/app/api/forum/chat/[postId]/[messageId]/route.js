// API route: PATCH/DELETE /api/forum/chat/[postId]/[messageId]
//
// PATCH  -> mengedit pesan milik sendiri (menandai edited_at).
// DELETE -> menghapus pesan milik sendiri sebagai "tombstone" (soft delete):
//           isi & gambar dikosongkan, baris tetap ada. Ini SENGAJA bukan hapus
//           permanen: di database, balasan bersarang ikut terhapus (cascade),
//           sehingga menghapus satu pesan akan ikut melenyapkan semua pesan
//           yang mengutipnya.
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireUser, assertActive, destroyImageUrls } from "@/lib/adminAuth";
import { broadcast, chatTopic, FEED_TOPIC } from "@/lib/realtime";

export const dynamic = "force-dynamic";

const MAX_BODY = 2000;
const DELETED_BODY = "(pesan dihapus)";
const bad = (error, status = 400) => NextResponse.json({ error }, { status });

async function loadOwn(postId, messageId, userId) {
  const { data, error } = await supabaseAdmin
    .from("replies")
    .select("id, post_id, author_id, body, images, deleted_at")
    .eq("id", messageId)
    .maybeSingle();
  if (error || !data || String(data.post_id) !== String(postId)) return { err: bad("Pesan tidak ditemukan.", 404) };
  if (data.author_id !== userId) return { err: bad("Kamu cuma bisa mengubah pesan milik sendiri.", 403) };
  if (data.deleted_at) return { err: bad("Pesan ini sudah dihapus.", 410) };
  return { row: data };
}

export async function PATCH(request, { params }) {
  try {
    const { postId, messageId } = await params;
    const u = await requireUser(request);
    if (u.error) return u.error;
    const blocked = await assertActive(u.user.id);
    if (blocked) return blocked;
    const body = await request.json().catch(() => ({}));
    const text = String(body.body || "").trim();
    if (!text) return bad("Pesan tidak boleh kosong.");
    if (text.length > MAX_BODY) return bad(`Pesan maksimal ${MAX_BODY} karakter.`);

    const own = await loadOwn(postId, messageId, u.user.id);
    if (own.err) return own.err;
    const editedAt = new Date().toISOString();
    const { error } = await supabaseAdmin.from("replies").update({ body: text, edited_at: editedAt }).eq("id", messageId);
    if (error) {
      console.error("Gagal mengedit pesan chat:", error);
      return bad("Gagal menyimpan perubahan.", 500);
    }
    await broadcast(chatTopic(postId), "message", { kind: "edit", id: messageId });
    return NextResponse.json({ message: { id: messageId, body: text, editedAt } });
  } catch (err) {
    console.error("Gagal memproses edit pesan chat:", err);
    return bad("Gagal mengedit pesan.", 500);
  }
}

export async function DELETE(request, { params }) {
  try {
    const { postId, messageId } = await params;
    const u = await requireUser(request);
    if (u.error) return u.error;
    const own = await loadOwn(postId, messageId, u.user.id);
    if (own.err) return own.err;

    const { error } = await supabaseAdmin
      .from("replies")
      .update({ body: DELETED_BODY, images: [], deleted_at: new Date().toISOString() })
      .eq("id", messageId);
    if (error) {
      console.error("Gagal menghapus pesan chat:", error);
      return bad(error.code === "42703" ? "Database belum siap. Sudah menjalankan admin_setup_3.sql?" : "Gagal menghapus pesan.", 500);
    }
    await destroyImageUrls(own.row.images || []);
    await Promise.all([broadcast(chatTopic(postId), "message", { kind: "delete", id: messageId }), broadcast(FEED_TOPIC, "activity", { kind: "chat", postId })]);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Gagal memproses penghapusan pesan chat:", err);
    return bad("Gagal menghapus pesan.", 500);
  }
}

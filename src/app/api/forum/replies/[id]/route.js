// API route: PATCH/DELETE /api/forum/replies/[id]
//
// PATCH  -> mengedit isi balasan milik sendiri, menandai edited_at, lalu
//           embedding thread (post induk) diperbarui.
// DELETE -> menghapus balasan milik sendiri. Mengandalkan `on delete cascade`
//           (replies.parent_id -> replies.id, likes.reply_id -> replies.id)
//           sehingga balasan bersarang dan like-nya ikut terhapus.
//           Setelah itu embedding thread diperbarui agar isi balasan yang
//           sudah hilang tidak lagi memengaruhi hasil pencarian.

import { assertActive } from "@/lib/adminAuth";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { embedForumPost } from "@/lib/embeddings";

const MAX_BODY_CHARS = 3000;

async function getUser(request) {
  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return { error: NextResponse.json({ error: "Tidak ada token autentikasi." }, { status: 401 }) };
  const {
    data: { user },
    error: authError,
  } = await supabaseAdmin.auth.getUser(token);
  if (authError || !user) {
    return { error: NextResponse.json({ error: "Sesi tidak valid — coba login ulang." }, { status: 401 }) };
  }
  return { user };
}

export async function PATCH(request, { params }) {
  try {
    const { id } = await params;
    const { user, error: authFail } = await getUser(request);
    if (authFail) return authFail;

    const blocked = await assertActive(user.id);
    if (blocked) return blocked;

    const body = await request.json().catch(() => ({}));
    const text = String(body.body || "").trim();
    if (!text) return NextResponse.json({ error: "Isi balasan tidak boleh kosong." }, { status: 400 });
    if (text.length > MAX_BODY_CHARS) {
      return NextResponse.json({ error: `Isi balasan maksimal ${MAX_BODY_CHARS} karakter.` }, { status: 400 });
    }

    const { data: existing, error: fetchError } = await supabaseAdmin
      .from("replies")
      .select("id, author_id, post_id")
      .eq("id", id)
      .single();
    if (fetchError || !existing) {
      return NextResponse.json({ error: "Balasan tidak ditemukan." }, { status: 404 });
    }
    if (existing.author_id !== user.id) {
      return NextResponse.json({ error: "Kamu cuma bisa mengedit balasan milik sendiri." }, { status: 403 });
    }

    const editedAt = new Date().toISOString();
    let { error: updateError } = await supabaseAdmin.from("replies").update({ body: text, edited_at: editedAt }).eq("id", id);
    if (updateError && updateError.code === "42703") {
      ({ error: updateError } = await supabaseAdmin.from("replies").update({ body: text }).eq("id", id));
    }
    if (updateError) {
      console.error("Gagal mengedit balasan:", updateError);
      return NextResponse.json({ error: "Gagal menyimpan perubahan balasan." }, { status: 500 });
    }

    await embedForumPost(existing.post_id);

    return NextResponse.json({ reply: { id, body: text, editedAt } });
  } catch (err) {
    console.error("Gagal memproses edit balasan:", err);
    return NextResponse.json({ error: "Gagal mengedit balasan." }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const { user, error: authFail } = await getUser(request);
    if (authFail) return authFail;

    const { data: existing, error: fetchError } = await supabaseAdmin
      .from("replies")
      .select("id, author_id, post_id")
      .eq("id", id)
      .single();
    if (fetchError || !existing) {
      return NextResponse.json({ error: "Balasan tidak ditemukan." }, { status: 404 });
    }
    if (existing.author_id !== user.id) {
      return NextResponse.json({ error: "Kamu cuma bisa menghapus balasan milik sendiri." }, { status: 403 });
    }

    const { error: deleteError } = await supabaseAdmin.from("replies").delete().eq("id", id);
    if (deleteError) {
      console.error("Gagal menghapus balasan:", deleteError);
      return NextResponse.json({ error: "Gagal menghapus balasan." }, { status: 500 });
    }

    // Tidak pernah melempar error — kegagalan embedding tidak membuat penghapusan terlihat gagal.
    await embedForumPost(existing.post_id);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Gagal memproses penghapusan balasan:", err);
    return NextResponse.json({ error: "Gagal menghapus balasan." }, { status: 500 });
  }
}

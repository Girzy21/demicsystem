// API route: PATCH/DELETE /api/forum/posts/[id]
//
// PATCH  -> mengedit post milik sendiri (isi, jenis post, dan modul yang
//           disebut — moduleId null = hapus sebutan). Menandai edited_at, lalu
//           embedding thread diperbarui agar pencarian ikut berubah.
//           Subject/topik tidak diubah lewat edit.
// DELETE -> menghapus post milik sendiri. Mengandalkan `on delete cascade`
//           (replies.post_id, likes, bookmarks -> posts.id) untuk membersihkan
//           semua balasan, like, dan bookmark yang menempel.

import { broadcast } from "@/lib/realtime";
import { assertActive } from "@/lib/adminAuth";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { embedForumPost } from "@/lib/embeddings";

const MAX_BODY_CHARS = 5000;
// Harus sama dengan kunci POST_TYPES di Homepage.jsx
const ALLOWED_POST_TYPES = ["diskusi", "ide", "sharing", "pertanyaan"];

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
    const update = {};

    if (body.body !== undefined) {
      const text = String(body.body || "").trim();
      if (!text) return NextResponse.json({ error: "Isi post tidak boleh kosong." }, { status: 400 });
      if (text.length > MAX_BODY_CHARS) {
        return NextResponse.json({ error: `Isi post maksimal ${MAX_BODY_CHARS} karakter.` }, { status: 400 });
      }
      update.body = text;
    }
    if (body.postType !== undefined) {
      if (!ALLOWED_POST_TYPES.includes(body.postType)) {
        return NextResponse.json({ error: "Jenis post tidak valid." }, { status: 400 });
      }
      update.post_type = body.postType;
    }
    // Sebutan modul: null = hapus, string = ganti ke modul tersebut.
    let mentioned = undefined; // undefined = tidak diubah
    if (body.moduleId !== undefined) {
      if (body.moduleId === null || body.moduleId === "") {
        update.module_id = null;
        mentioned = null;
      } else {
        const { data: mod, error: modError } = await supabaseAdmin
          .from("modules")
          .select("id, title, subject, topic, file_type, link_url")
          .eq("id", String(body.moduleId))
          .single();
        if (modError || !mod) {
          return NextResponse.json({ error: "Modul yang disebut tidak ditemukan (mungkin sudah dihapus)." }, { status: 400 });
        }
        update.module_id = mod.id;
        mentioned = { id: mod.id, title: mod.title, subject: mod.subject, topic: mod.topic, type: mod.link_url ? "LINK" : mod.file_type };
      }
    }
    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: "Tidak ada perubahan yang dikirim." }, { status: 400 });
    }

    const { data: existing, error: fetchError } = await supabaseAdmin
      .from("posts")
      .select("id, author_id")
      .eq("id", id)
      .single();
    if (fetchError || !existing) {
      return NextResponse.json({ error: "Post tidak ditemukan." }, { status: 404 });
    }
    if (existing.author_id !== user.id) {
      return NextResponse.json({ error: "Kamu cuma bisa mengedit post milik sendiri." }, { status: 403 });
    }

    const editedAt = new Date().toISOString();
    let { data: updated, error: updateError } = await supabaseAdmin
      .from("posts")
      .update({ ...update, edited_at: editedAt })
      .eq("id", id)
      .select("id, post_type, body, subject, topic")
      .single();
    if (updateError && updateError.code === "42703") {
      // Kolom edited_at belum ada (SQL tahap 2 belum dijalankan): simpan tanpa penanda.
      ({ data: updated, error: updateError } = await supabaseAdmin
        .from("posts")
        .update(update)
        .eq("id", id)
        .select("id, post_type, body, subject, topic")
        .single());
    }
    if (updateError) {
      console.error("Gagal mengedit post:", updateError);
      return NextResponse.json({ error: "Gagal menyimpan perubahan post." }, { status: 500 });
    }

    // Tidak pernah melempar error — kegagalan embedding tidak menggagalkan edit.
    await embedForumPost(id);

    return NextResponse.json({
      post: {
        id: updated.id,
        postType: updated.post_type,
        body: updated.body,
        editedAt,
        ...(mentioned !== undefined ? { moduleId: mentioned ? mentioned.id : null, module: mentioned } : {}),
      },
    });
  } catch (err) {
    console.error("Gagal memproses edit post:", err);
    return NextResponse.json({ error: "Gagal mengedit post." }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const { user, error: authFail } = await getUser(request);
    if (authFail) return authFail;

    // Pastikan kepemilikan sebelum menghapus.
    const { data: existing, error: fetchError } = await supabaseAdmin
      .from("posts")
      .select("id, author_id")
      .eq("id", id)
      .single();
    if (fetchError || !existing) {
      return NextResponse.json({ error: "Post tidak ditemukan." }, { status: 404 });
    }
    if (existing.author_id !== user.id) {
      return NextResponse.json({ error: "Kamu cuma bisa menghapus post milik sendiri." }, { status: 403 });
    }

    const { error: deleteError } = await supabaseAdmin.from("posts").delete().eq("id", id);
    if (deleteError) {
      console.error("Gagal menghapus post:", deleteError);
      return NextResponse.json({ error: "Gagal menghapus post." }, { status: 500 });
    }

    await Promise.all([broadcast("chat:" + id, "message", { kind: "gone" }), broadcast("forum:feed", "activity", { kind: "post" })]);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Gagal memproses penghapusan post:", err);
    return NextResponse.json({ error: "Gagal menghapus post." }, { status: 500 });
  }
}

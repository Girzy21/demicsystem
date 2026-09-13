// API route: DELETE /api/forum/posts/[id]
//
// Deletes a post the caller authored. Relies on the database schema's
// `on delete cascade` (replies.post_id -> posts.id, likes/bookmarks ->
// posts.id) to automatically clean up every reply, like, and bookmark
// attached to it — no need to manually delete those rows here.

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function DELETE(request, { params }) {
  try {
    const { id } = await params;

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

    // Confirm ownership before deleting — someone else's user id should
    // never be able to delete this post even if they somehow guess its id.
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

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Gagal memproses penghapusan post:", err);
    return NextResponse.json({ error: "Gagal menghapus post." }, { status: 500 });
  }
}
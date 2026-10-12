// API route: DELETE /api/forum/replies/[id]
//
// Deletes a reply the caller authored. Relies on `on delete cascade`
// (replies.parent_id -> replies.id, likes.reply_id -> replies.id) so
// deleting a reply also removes any nested replies underneath it and
// their likes, without needing to walk the tree manually here.

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

    const { data: existing, error: fetchError } = await supabaseAdmin
      .from("replies")
      .select("id, author_id")
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

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Gagal memproses penghapusan balasan:", err);
    return NextResponse.json({ error: "Gagal menghapus balasan." }, { status: 500 });
  }
}
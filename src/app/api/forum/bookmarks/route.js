// API route: GET/POST/DELETE /api/forum/bookmarks
//
// Bookmarks are post-only (see the original schema — the bookmarks table
// has no reply_id column), unlike likes which cover both posts and
// replies. GET returns the caller's own bookmarked post ids (bookmarks
// are private — see the RLS policy from the original Supabase setup,
// "User cuma bisa lihat bookmark sendiri" — so this always scopes to the
// authenticated caller, never someone else's).

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

async function getCallerId(request) {
  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const {
    data: { user },
  } = await supabaseAdmin.auth.getUser(token);
  return user?.id || null;
}

export async function GET(request) {
  try {
    const userId = await getCallerId(request);
    if (!userId) {
      return NextResponse.json({ error: "Sesi tidak valid — coba login ulang." }, { status: 401 });
    }
    const { data, error } = await supabaseAdmin.from("bookmarks").select("post_id").eq("user_id", userId);
    if (error) {
      console.error("Gagal mengambil bookmark:", error);
      return NextResponse.json({ error: "Gagal mengambil bookmark." }, { status: 500 });
    }
    return NextResponse.json({ postIds: (data || []).map((b) => b.post_id) });
  } catch (err) {
    console.error("Gagal memproses permintaan bookmark:", err);
    return NextResponse.json({ error: "Gagal mengambil bookmark." }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const userId = await getCallerId(request);
    if (!userId) {
      return NextResponse.json({ error: "Sesi tidak valid — coba login ulang." }, { status: 401 });
    }
    const { postId } = await request.json();
    if (!postId) {
      return NextResponse.json({ error: "postId wajib diisi." }, { status: 400 });
    }
    // Duplicate bookmark attempts hit the unique(user_id, post_id)
    // constraint (code 23505) — treated as a no-op success.
    const { error } = await supabaseAdmin.from("bookmarks").insert({ user_id: userId, post_id: postId });
    if (error && error.code !== "23505") {
      console.error("Gagal menyimpan bookmark:", error);
      return NextResponse.json({ error: "Gagal menyimpan bookmark." }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Gagal memproses bookmark:", err);
    return NextResponse.json({ error: "Gagal menyimpan bookmark." }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const userId = await getCallerId(request);
    if (!userId) {
      return NextResponse.json({ error: "Sesi tidak valid — coba login ulang." }, { status: 401 });
    }
    const { postId } = await request.json();
    if (!postId) {
      return NextResponse.json({ error: "postId wajib diisi." }, { status: 400 });
    }
    const { error } = await supabaseAdmin.from("bookmarks").delete().eq("user_id", userId).eq("post_id", postId);
    if (error) {
      console.error("Gagal menghapus bookmark:", error);
      return NextResponse.json({ error: "Gagal menghapus bookmark." }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Gagal memproses hapus bookmark:", err);
    return NextResponse.json({ error: "Gagal menghapus bookmark." }, { status: 500 });
  }
}
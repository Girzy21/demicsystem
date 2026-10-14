// API route: POST/DELETE /api/forum/likes
//
// Toggles a like on either a post or a reply — exactly one of postId/
// replyId is expected in the body, matching the likes table's check
// constraint (see the original schema: exactly one of post_id/reply_id
// must be set). POST adds a like, DELETE removes it. Both return the
// resulting total count for that target so the frontend can reconcile
// its optimistic update against the real server state.

import { assertActive } from "@/lib/adminAuth";
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

async function countLikes(postId, replyId) {
  const query = supabaseAdmin.from("likes").select("id", { count: "exact", head: true });
  const { count } = postId ? await query.eq("post_id", postId) : await query.eq("reply_id", replyId);
  return count || 0;
}

export async function POST(request) {
  try {
    const userId = await getCallerId(request);
    if (!userId) {
      return NextResponse.json({ error: "Sesi tidak valid — coba login ulang." }, { status: 401 });
    }

    const blocked = await assertActive(userId);
    if (blocked) return blocked;

    const { postId, replyId } = await request.json();
    if (!postId && !replyId) {
      return NextResponse.json({ error: "postId atau replyId wajib diisi." }, { status: 400 });
    }

    // Duplicate likes are prevented by the unique(user_id, post_id) /
    // unique(user_id, reply_id) constraints — a duplicate insert attempt
    // errors with code 23505, which we treat as "already liked, fine" so
    // double-clicking doesn't surface as a user-facing error.
    const { error } = await supabaseAdmin.from("likes").insert({
      user_id: userId,
      post_id: postId || null,
      reply_id: replyId || null,
    });
    if (error && error.code !== "23505") {
      console.error("Gagal menyimpan like:", error);
      return NextResponse.json({ error: "Gagal menyimpan like." }, { status: 500 });
    }

    const count = await countLikes(postId, replyId);
    return NextResponse.json({ count });
  } catch (err) {
    console.error("Gagal memproses like:", err);
    return NextResponse.json({ error: "Gagal menyimpan like." }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const userId = await getCallerId(request);
    if (!userId) {
      return NextResponse.json({ error: "Sesi tidak valid — coba login ulang." }, { status: 401 });
    }

    const { postId, replyId } = await request.json();
    if (!postId && !replyId) {
      return NextResponse.json({ error: "postId atau replyId wajib diisi." }, { status: 400 });
    }

    const query = supabaseAdmin.from("likes").delete().eq("user_id", userId);
    const { error } = postId ? await query.eq("post_id", postId) : await query.eq("reply_id", replyId);
    if (error) {
      console.error("Gagal menghapus like:", error);
      return NextResponse.json({ error: "Gagal menghapus like." }, { status: 500 });
    }

    const count = await countLikes(postId, replyId);
    return NextResponse.json({ count });
  } catch (err) {
    console.error("Gagal memproses unlike:", err);
    return NextResponse.json({ error: "Gagal menghapus like." }, { status: 500 });
  }
}
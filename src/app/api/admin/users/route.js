// GET /api/admin/users — semua pengguna (untuk skala sekolah; pencarian & filter
// dilakukan di panel). Nama asli hanya dikirim kalau pemiliknya mengaktifkan
// show_real_name — sama dengan aturan di view public_profiles.
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdmin, isSuspended } from "@/lib/adminAuth";

export const dynamic = "force-dynamic";

function tally(rows, key) {
  const m = {};
  for (const r of rows || []) m[r[key]] = (m[r[key]] || 0) + 1;
  return m;
}

export async function GET(request) {
  const a = await requireAdmin(request);
  if (a.error) return a.error;
  try {
    const [profiles, access, mods, posts, replies] = await Promise.all([
      supabaseAdmin.from("profiles").select("id, username, real_name, show_real_name, photo_url, headline, created_at").order("created_at", { ascending: false }).limit(2000),
      supabaseAdmin.from("user_access").select("user_id, is_admin, suspended_at, suspended_until, suspended_reason").limit(2000),
      supabaseAdmin.from("modules").select("uploader_id").limit(10000),
      supabaseAdmin.from("posts").select("author_id").limit(10000),
      supabaseAdmin.from("replies").select("author_id").limit(20000),
    ]);
    if (profiles.error) {
      console.error("Gagal mengambil pengguna:", profiles.error);
      return NextResponse.json({ error: "Gagal mengambil daftar pengguna." }, { status: 500 });
    }
    const accessById = Object.fromEntries((access.data || []).map((x) => [x.user_id, x]));
    const modCount = tally(mods.data, "uploader_id");
    const postCount = tally(posts.data, "author_id");
    const replyCount = tally(replies.data, "author_id");

    const users = (profiles.data || []).map((p) => {
      const acc = accessById[p.id] || null;
      return {
        id: p.id,
        username: p.username,
        realName: p.show_real_name ? p.real_name || "" : "",
        photoUrl: p.photo_url || null,
        headline: p.headline || "",
        createdAt: p.created_at || null,
        isAdmin: !!acc?.is_admin,
        suspended: isSuspended(acc),
        suspendedUntil: acc?.suspended_until || null,
        suspendedReason: acc?.suspended_reason || "",
        counts: { modules: modCount[p.id] || 0, posts: postCount[p.id] || 0, replies: replyCount[p.id] || 0 },
      };
    });
    return NextResponse.json({ users, me: a.user.id });
  } catch (err) {
    console.error("Gagal memproses daftar pengguna (admin):", err);
    return NextResponse.json({ error: "Gagal mengambil daftar pengguna." }, { status: 500 });
  }
}

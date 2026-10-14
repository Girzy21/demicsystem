// GET /api/admin/stats — angka ringkasan untuk tab "Ringkasan".
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdmin, reviewReasons } from "@/lib/adminAuth";
import { countRetagPending } from "@/lib/adminContent";

export const dynamic = "force-dynamic";

const count = (table) => supabaseAdmin.from(table).select("*", { count: "exact", head: true });

export async function GET(request) {
  const a = await requireAdmin(request);
  if (a.error) return a.error;
  try {
    const nowIso = new Date().toISOString();
    const [users, modules, posts, replies, modNoEmb, postNoEmb, admins, suspended, actions24h, reviewRows, sizeRows, retagPending, resetPending] = await Promise.all([
      count("profiles"),
      count("modules"),
      count("posts"),
      count("replies"),
      count("modules").is("embedding", null),
      count("posts").is("embedding", null),
      count("user_access").eq("is_admin", true),
      count("user_access").not("suspended_at", "is", null).or(`suspended_until.is.null,suspended_until.gt.${nowIso}`),
      count("admin_actions").gte("created_at", new Date(Date.now() - 86400000).toISOString()),
      supabaseAdmin.from("modules").select("original_title, topic_is_custom, exercise_set_by, tags").is("admin_reviewed_at", null).limit(2000),
      supabaseAdmin.from("modules").select("file_size_bytes").not("file_size_bytes", "is", null).limit(5000),
      countRetagPending(),
      count("password_reset_requests").eq("status", "pending"),
    ]);
    const reviewPending = reviewRows.error ? null : (reviewRows.data || []).filter((m) => reviewReasons(m).length > 0).length;
    const storageBytes = (sizeRows.data || []).reduce((s, m) => s + (Number(m.file_size_bytes) || 0), 0);
    return NextResponse.json({
      users: users.count || 0,
      modules: modules.count || 0,
      posts: posts.count || 0,
      replies: replies.count || 0,
      admins: admins.count || 0,
      suspended: suspended.count || 0,
      modulesWithoutEmbedding: modNoEmb.count || 0,
      postsWithoutEmbedding: postNoEmb.count || 0,
      retagPending,
      reviewPending,
      resetPending: resetPending.count || 0,
      storageBytes,
      actionsLast24h: actions24h.count || 0,
    });
  } catch (err) {
    console.error("Gagal mengambil statistik admin:", err);
    return NextResponse.json({ error: "Gagal mengambil statistik." }, { status: 500 });
  }
}

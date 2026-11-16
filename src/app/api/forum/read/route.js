// POST /api/forum/read
//   { postIds: [..] }  -> tandai post-post ini sudah dibaca oleh pengguna yang login
//   { all: true }      -> tandai SEMUA post yang ada sekarang sudah dibaca
//
// Data ada di tabel post_reads + forum_read_state (admin_setup_6.sql). Kalau tabelnya belum
// ada, endpoint ini diam-diam sukses (tracking:false) supaya forum tidak pernah error karena fitur ini.
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireUser } from "@/lib/adminAuth";

export const dynamic = "force-dynamic";

const MAX_IDS = 50;
const tableMissing = (e) => !!e && (e.code === "42P01" || e.code === "PGRST205" || /(post_reads|forum_read_state)/i.test(e.message || ""));

export async function POST(request) {
  const u = await requireUser(request);
  if (u.error) return u.error;
  const userId = u.user.id;
  try {
    const body = await request.json().catch(() => ({}));

    if (body.all === true) {
      // Baseline = sekarang: semua post yang sudah ada dianggap dibaca. Baris lama tidak diperlukan lagi.
      const { error } = await supabaseAdmin.from("forum_read_state").upsert({ user_id: userId, baseline: new Date().toISOString() }, { onConflict: "user_id" });
      if (error) {
        if (tableMissing(error)) return NextResponse.json({ success: true, tracking: false });
        console.error("Gagal menandai semua dibaca:", error);
        return NextResponse.json({ error: "Gagal menandai semua dibaca." }, { status: 500 });
      }
      await supabaseAdmin.from("post_reads").delete().eq("user_id", userId);
      return NextResponse.json({ success: true, tracking: true });
    }

    const ids = Array.isArray(body.postIds) ? Array.from(new Set(body.postIds.map((v) => String(v)).filter(Boolean))).slice(0, MAX_IDS) : [];
    if (ids.length === 0) return NextResponse.json({ error: "postIds harus berupa daftar id post." }, { status: 400 });

    const { error } = await supabaseAdmin.from("post_reads").upsert(ids.map((id) => ({ user_id: userId, post_id: id })), { onConflict: "user_id,post_id" });
    if (error) {
      if (tableMissing(error)) return NextResponse.json({ success: true, tracking: false });
      console.error("Gagal menyimpan status baca:", error);
      return NextResponse.json({ error: "Gagal menyimpan status baca." }, { status: 500 });
    }
    return NextResponse.json({ success: true, tracking: true });
  } catch (err) {
    console.error("Gagal memproses status baca:", err);
    return NextResponse.json({ error: "Gagal menyimpan status baca." }, { status: 500 });
  }
}

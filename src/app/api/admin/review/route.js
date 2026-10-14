// GET /api/admin/review — antrean modul yang perlu ditinjau admin:
// topik buatan pengguna, judul/jenis yang diubah AI, tag AI kurang yakin.
// Aksinya (setujui / kembalikan judul / edit) lewat /api/admin/modules/[id].
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdmin, reviewReasons, usernamesByIds } from "@/lib/adminAuth";

export const dynamic = "force-dynamic";
const LIMIT = 200;

export async function GET(request) {
  const a = await requireAdmin(request);
  if (a.error) return a.error;
  try {
    const { data, error } = await supabaseAdmin
      .from("modules")
      .select("id, uploader_id, title, original_title, subject, topic, topic_is_custom, description, is_exercise, exercise_set_by, tags, file_type, link_url, created_at")
      .is("admin_reviewed_at", null)
      .order("created_at", { ascending: false })
      .limit(1000);
    if (error) {
      console.error("Gagal mengambil antrean review:", error);
      return NextResponse.json({ error: "Gagal mengambil antrean review. Sudah menjalankan admin_setup.sql?" }, { status: 500 });
    }
    const queue = (data || []).map((m) => ({ ...m, reasons: reviewReasons(m) })).filter((m) => m.reasons.length > 0);
    const names = await usernamesByIds(queue.slice(0, LIMIT).map((m) => m.uploader_id));
    return NextResponse.json({
      total: queue.length,
      items: queue.slice(0, LIMIT).map((m) => ({ ...m, author: names[m.uploader_id] || "pengguna" })),
    });
  } catch (err) {
    console.error("Gagal memproses antrean review:", err);
    return NextResponse.json({ error: "Gagal mengambil antrean review." }, { status: 500 });
  }
}

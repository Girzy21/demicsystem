// GET /api/admin/password-requests?status=pending|all
// Antrean permintaan reset password dari halaman /lupa-password.
// Nama asli hanya dikirim kalau pemiliknya mengaktifkan show_real_name.
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdmin } from "@/lib/adminAuth";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const a = await requireAdmin(request);
  if (a.error) return a.error;
  try {
    const status = new URL(request.url).searchParams.get("status") === "all" ? "all" : "pending";
    let query = supabaseAdmin
      .from("password_reset_requests")
      .select("id, user_id, username, note, status, request_count, created_at, last_requested_at, resolved_at, resolved_by_username, resolution_note")
      .order("last_requested_at", { ascending: false })
      .limit(200);
    if (status === "pending") query = query.eq("status", "pending");
    const { data, error } = await query;
    if (error) {
      console.error("Gagal mengambil permintaan reset:", error);
      return NextResponse.json({ error: "Gagal mengambil permintaan. Sudah menjalankan admin_setup_2.sql?" }, { status: 500 });
    }
    const ids = Array.from(new Set((data || []).map((r) => r.user_id)));
    const profiles = {};
    for (let i = 0; i < ids.length; i += 100) {
      const { data: rows } = await supabaseAdmin.from("profiles").select("id, real_name, show_real_name").in("id", ids.slice(i, i + 100));
      for (const p of rows || []) profiles[p.id] = p;
    }
    const items = (data || []).map((r) => ({
      ...r,
      realName: profiles[r.user_id]?.show_real_name ? profiles[r.user_id].real_name || "" : "",
    }));
    return NextResponse.json({ items, pending: items.filter((r) => r.status === "pending").length });
  } catch (err) {
    console.error("Gagal memproses permintaan reset:", err);
    return NextResponse.json({ error: "Gagal mengambil permintaan." }, { status: 500 });
  }
}

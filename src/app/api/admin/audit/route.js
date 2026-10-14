// GET /api/admin/audit?page=&action=&admin=      -> daftar (tanpa snapshot)
// GET /api/admin/audit?id=123                    -> satu entri lengkap (dengan snapshot)
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdmin, pageParams, cleanSearch } from "@/lib/adminAuth";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const a = await requireAdmin(request);
  if (a.error) return a.error;
  try {
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    if (id) {
      const { data } = await supabaseAdmin.from("admin_actions").select("*").eq("id", id).maybeSingle();
      if (!data) return NextResponse.json({ error: "Entri tidak ditemukan." }, { status: 404 });
      return NextResponse.json({ entry: data });
    }
    const { page, size, from, to } = pageParams(url, 30, 100);
    const action = cleanSearch(url.searchParams.get("action"));
    const adminQ = cleanSearch(url.searchParams.get("admin"));
    let query = supabaseAdmin
      .from("admin_actions")
      .select("id, admin_username, action, target_type, target_id, target_label, reason, created_at", { count: "exact" });
    if (action) query = query.ilike("action", `${action}%`);
    if (adminQ) query = query.ilike("admin_username", `%${adminQ}%`);
    const { data, count, error } = await query.order("created_at", { ascending: false }).range(from, to);
    if (error) return NextResponse.json({ error: "Gagal mengambil audit log." }, { status: 500 });
    return NextResponse.json({ items: data || [], total: count || 0, page, size });
  } catch (err) {
    console.error("Gagal memproses audit log:", err);
    return NextResponse.json({ error: "Gagal mengambil audit log." }, { status: 500 });
  }
}

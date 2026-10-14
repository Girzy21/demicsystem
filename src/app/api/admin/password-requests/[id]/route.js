// POST /api/admin/password-requests/[id]
//   { action: "reset", password }   tetapkan password baru + selesaikan permintaan
//   { action: "reject", reason }    tolak permintaan
// Password tidak pernah disimpan atau dicatat; admin menyampaikannya langsung
// ke pemilik akun setelah memverifikasi identitasnya.
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdmin, getAccess, logAdminAction } from "@/lib/adminAuth";

export const dynamic = "force-dynamic";

const bad = (error, status = 400) => NextResponse.json({ error }, { status });

export async function POST(request, { params }) {
  const a = await requireAdmin(request);
  if (a.error) return a.error;
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const { data: req } = await supabaseAdmin.from("password_reset_requests").select("id, user_id, username, status").eq("id", id).maybeSingle();
    if (!req) return bad("Permintaan tidak ditemukan.", 404);
    if (req.status !== "pending") return bad("Permintaan ini sudah diproses.", 409);

    const resolved = (status, note) => ({
      status,
      resolved_at: new Date().toISOString(),
      resolved_by: a.user.id,
      resolved_by_username: a.username,
      resolution_note: note || null,
    });

    if (body.action === "reject") {
      const reason = String(body.reason || "").trim();
      if (reason.length < 3) return bad("Alasan wajib diisi (minimal 3 karakter).");
      const logged = await logAdminAction(a, { action: "password_request.reject", targetType: "user", targetId: req.user_id, targetLabel: req.username, reason, snapshot: { requestId: req.id } });
      if (!logged) return bad("Audit log gagal — aksi dibatalkan.", 500);
      const { error } = await supabaseAdmin.from("password_reset_requests").update(resolved("rejected", reason.slice(0, 300))).eq("id", id);
      if (error) return bad("Gagal menolak permintaan.", 500);
      return NextResponse.json({ success: true });
    }

    if (body.action === "reset") {
      const password = String(body.password || "");
      if (password.length < 8 || password.length > 72) return bad("Password harus 8-72 karakter.");
      const access = await getAccess(req.user_id);
      if (access && access.is_admin) return bad("Password admin tidak direset lewat jalur ini.");
      const logged = await logAdminAction(a, { action: "user.reset_password", targetType: "user", targetId: req.user_id, targetLabel: req.username, snapshot: { via: "request", requestId: req.id } });
      if (!logged) return bad("Audit log gagal — aksi dibatalkan.", 500);
      const { error: pwErr } = await supabaseAdmin.auth.admin.updateUserById(req.user_id, { password });
      if (pwErr) {
        console.error("Gagal mereset password:", pwErr);
        return bad("Gagal mereset password.", 500);
      }
      await supabaseAdmin.rpc("admin_revoke_sessions", { target: req.user_id });
      await supabaseAdmin.from("password_reset_requests").update(resolved("done", "Password diganti oleh admin")).eq("id", id);
      return NextResponse.json({ success: true });
    }

    return bad("Aksi tidak dikenal.");
  } catch (err) {
    console.error("Gagal memproses permintaan reset:", err);
    return bad("Gagal memproses permintaan.", 500);
  }
}

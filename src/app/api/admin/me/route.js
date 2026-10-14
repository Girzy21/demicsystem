// GET /api/admin/me — dipakai halaman /admin untuk tahu apakah pemanggil admin.
// Non-admin mendapat 404. Admin yang belum lolos MFA tetap dapat jawaban
// (mfaOk: false) supaya halaman bisa menampilkan layar verifikasi MFA.
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const a = await requireAdmin(request, { allowMfaPending: true });
  if (a.error) return a.error;
  return NextResponse.json({ admin: true, userId: a.user.id, username: a.username, mfaRequired: a.mfaRequired, mfaOk: a.mfaOk });
}

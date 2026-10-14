// src/lib/adminAuth.js
//
// Fondasi sistem admin:
//   - requireUser / requireAdmin : verifikasi token Supabase + cek role admin
//     (+ MFA aal2). Non-admin selalu mendapat 404 supaya /api/admin/* tidak
//     terlihat ada.
//   - assertActive               : dipakai route TULIS biasa untuk menolak akun
//     yang sedang ditangguhkan.
//   - logAdminAction             : audit log (tabel admin_actions).
//   - helper Cloudinary          : hapus aset modul / gambar forum / avatar.
//
// Semua pengecekan terjadi di SERVER. supabaseAdmin memakai service role
// (melewati RLS), jadi otorisasi hanya sekuat kode di file ini.

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { cloudinary } from "@/lib/cloudinary";

const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404 });
const unauthorized = (msg) => NextResponse.json({ error: msg }, { status: 401 });

function bearerToken(request) {
  return (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
}

// Token sudah diverifikasi lewat auth.getUser sebelum dibaca di sini;
// fungsi ini hanya membaca klaim "aal" (level autentikasi).
function jwtClaims(token) {
  try {
    return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
  } catch {
    return {};
  }
}

export async function requireUser(request) {
  const token = bearerToken(request);
  if (!token) return { error: unauthorized("Tidak ada token autentikasi.") };
  const {
    data: { user },
    error,
  } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return { error: unauthorized("Sesi tidak valid — coba login ulang.") };
  return { user, token };
}

// Baris user_access milik seseorang (null kalau belum ada / tabel belum dibuat).
export async function getAccess(userId) {
  const { data, error } = await supabaseAdmin
    .from("user_access")
    .select("user_id, is_admin, suspended_at, suspended_until, suspended_reason")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    if (error.code !== "42P01") console.error("Gagal membaca user_access:", error);
    return null;
  }
  return data || null;
}

export function isSuspended(access) {
  if (!access || !access.suspended_at) return false;
  if (access.suspended_until && new Date(access.suspended_until) <= new Date()) return false;
  return true;
}

// Untuk route tulis (post, balasan, modul, like, profil, upload):
//   const blocked = await assertActive(user.id); if (blocked) return blocked;
export async function assertActive(userId) {
  const access = await getAccess(userId);
  if (!isSuspended(access)) return null;
  const until = access.suspended_until ? ` sampai ${new Date(access.suspended_until).toLocaleDateString("id-ID")}` : "";
  return NextResponse.json({ error: `Akunmu sedang ditangguhkan${until}. Hubungi admin sekolah.` }, { status: 403 });
}

export async function usernameOf(userId) {
  const { data } = await supabaseAdmin.from("public_profiles").select("username").eq("id", userId).maybeSingle();
  return data?.username || "admin";
}

export async function usernamesByIds(ids) {
  const uniq = Array.from(new Set((ids || []).filter(Boolean)));
  const map = {};
  for (let i = 0; i < uniq.length; i += 100) {
    const { data } = await supabaseAdmin.from("public_profiles").select("id, username").in("id", uniq.slice(i, i + 100));
    for (const p of data || []) map[p.id] = p.username;
  }
  return map;
}

// Gerbang semua /api/admin/*.
//   - Preview deployment Vercel ditolak (database-nya sama dengan produksi),
//     kecuali ADMIN_ALLOW_PREVIEW=true.
//   - MFA OPSIONAL: hanya diminta kalau env ADMIN_REQUIRE_MFA=true. Secara
//     default admin yang sudah login langsung bisa membuka /admin.
export async function requireAdmin(request, { allowMfaPending = false } = {}) {
  if (process.env.VERCEL_ENV === "preview" && process.env.ADMIN_ALLOW_PREVIEW !== "true") {
    return { error: notFound() };
  }
  const u = await requireUser(request);
  if (u.error) return u;

  const access = await getAccess(u.user.id);
  if (!access || !access.is_admin || isSuspended(access)) return { error: notFound() };

  const mfaRequired = process.env.ADMIN_REQUIRE_MFA === "true";
  const mfaOk = !mfaRequired || jwtClaims(u.token).aal === "aal2";
  if (!mfaOk && !allowMfaPending) {
    return { error: NextResponse.json({ error: "Verifikasi MFA diperlukan.", code: "mfa_required" }, { status: 403 }) };
  }
  return { user: u.user, username: await usernameOf(u.user.id), mfaRequired, mfaOk };
}

// Mengembalikan true kalau tersimpan. Aksi destruktif membatalkan diri
// sendiri kalau audit log gagal ditulis.
export async function logAdminAction(admin, { action, targetType = null, targetId = null, targetLabel = null, reason = null, snapshot = null }) {
  const { error } = await supabaseAdmin.from("admin_actions").insert({
    admin_id: admin.user.id,
    admin_username: admin.username,
    action,
    target_type: targetType,
    target_id: targetId ? String(targetId) : null,
    target_label: targetLabel ? String(targetLabel).slice(0, 200) : null,
    reason: reason ? String(reason).slice(0, 500) : null,
    snapshot,
  });
  if (error) {
    console.error("Gagal menulis audit log:", error);
    return false;
  }
  return true;
}

// ---- Paginasi & pencarian ------------------------------------------------
export function pageParams(url, defSize = 25, maxSize = 50) {
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);
  const size = Math.min(maxSize, Math.max(1, parseInt(url.searchParams.get("size") || String(defSize), 10) || defSize));
  return { page, size, from: (page - 1) * size, to: page * size - 1 };
}

// Membuang karakter yang merusak sintaks filter .or() PostgREST.
export function cleanSearch(q) {
  return String(q || "").replace(/[%,()*\\]/g, " ").trim().slice(0, 80);
}

// ---- Cloudinary ----------------------------------------------------------
// Sama dengan aturan di DELETE /api/modules/[id]: PDF & gambar di-upload
// sebagai "image", selain itu "raw".
const PREVIEWABLE = new Set(["PDF", "PNG", "JPG", "JPEG", "GIF", "WEBP", "SVG"]);
export function moduleResourceType(fileType) {
  return PREVIEWABLE.has(String(fileType || "").toUpperCase()) ? "image" : "raw";
}

// secure_url -> public_id (tanpa versi & ekstensi).
export function publicIdFromUrl(url) {
  const m = String(url || "").match(/\/upload\/(?:v\d+\/)?(.+?)(?:\.[A-Za-z0-9]+)?$/);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

// Tidak pernah melempar error (aset mungkin memang sudah hilang).
export async function destroyAsset(publicId, resourceType = "image") {
  if (!publicId) return false;
  try {
    const r = await cloudinary.uploader.destroy(publicId, { resource_type: resourceType, invalidate: true });
    return r?.result === "ok";
  } catch (err) {
    console.error("Gagal menghapus aset Cloudinary:", publicId, err);
    return false;
  }
}

export async function destroyImageUrls(urls) {
  const ids = Array.from(new Set((urls || []).map(publicIdFromUrl).filter(Boolean)));
  const results = await Promise.all(ids.map((id) => destroyAsset(id, "image")));
  return results.filter(Boolean).length;
}

// ---- Antrean review ------------------------------------------------------
export const LOW_CONFIDENCE = 0.6;
const SETTLED_EXERCISE = new Set(["user", "user_edit", "admin_edit"]);

export function reviewReasons(m) {
  const reasons = [];
  if (m.topic_is_custom) reasons.push("Topik buatan pengguna");
  if (m.original_title) reasons.push("Judul diubah AI");
  if (m.exercise_set_by && !SETTLED_EXERCISE.has(m.exercise_set_by)) reasons.push("Jenis diubah AI");
  if (Array.isArray(m.tags) && m.tags.some((t) => t && t.source === "ai" && typeof t.confidence === "number" && t.confidence < LOW_CONFIDENCE)) {
    reasons.push("Tag AI kurang yakin");
  }
  return reasons;
}

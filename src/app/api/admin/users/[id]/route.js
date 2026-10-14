// POST /api/admin/users/[id]
//   { action: "suspend", reason, days? }     tangguhkan (tidak bisa menulis; tetap bisa membaca)
//   { action: "unsuspend" }
//   { action: "setAdmin", value: true|false }
//   { action: "resetPassword", password }    (akun admin lain tidak bisa direset; hanya diri sendiri)
//   { action: "revokeSessions" }
//   { action: "clearPhoto" }
//   { action: "clearBio", fields: ["headline","goal","interests","skills"] }
//   { action: "delete", confirmUsername, reason }   hapus akun permanen + seluruh kontennya
//
// Pengaman: tidak bisa menangguhkan / menghapus diri sendiri atau admin lain
// (turunkan dulu statusnya), dan admin terakhir tidak bisa diturunkan.
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { embedForumPost } from "@/lib/embeddings";
import { requireAdmin, getAccess, logAdminAction, destroyAsset, publicIdFromUrl, isSuspended } from "@/lib/adminAuth";
import { deleteModuleById, deletePostById, deleteReplyById } from "@/lib/adminContent";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const bad = (error, status = 400) => NextResponse.json({ error }, { status });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function upsertAccess(userId, patch) {
  return supabaseAdmin.from("user_access").upsert({ user_id: userId, ...patch, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
}

export async function POST(request, { params }) {
  const a = await requireAdmin(request);
  if (a.error) return a.error;
  try {
    const { id } = await params;
    if (!UUID.test(id)) return bad("ID pengguna tidak valid.");
    const body = await request.json().catch(() => ({}));
    const action = body.action;

    const { data: target } = await supabaseAdmin.from("profiles").select("id, username, photo_url").eq("id", id).maybeSingle();
    if (!target) return bad("Pengguna tidak ditemukan.", 404);
    const access = await getAccess(id);
    const targetIsAdmin = !!access?.is_admin;
    const isSelf = id === a.user.id;
    const reason = String(body.reason || "").trim();
    const log = (extra) => logAdminAction(a, { targetType: "user", targetId: id, targetLabel: target.username, ...extra });

    // ---- Tangguhkan / aktifkan ----------------------------------------
    if (action === "suspend") {
      if (isSelf) return bad("Tidak bisa menangguhkan diri sendiri.");
      if (targetIsAdmin) return bad("Turunkan status admin dulu sebelum menangguhkan.");
      if (reason.length < 3) return bad("Alasan wajib diisi (minimal 3 karakter).");
      const days = Number(body.days);
      const until = Number.isFinite(days) && days >= 1 && days <= 365 ? new Date(Date.now() + days * 86400000).toISOString() : null;
      if (!(await log({ action: "user.suspend", reason, snapshot: { until } }))) return bad("Audit log gagal — aksi dibatalkan.", 500);
      const { error } = await upsertAccess(id, { suspended_at: new Date().toISOString(), suspended_until: until, suspended_reason: reason.slice(0, 500) });
      if (error) return bad("Gagal menangguhkan akun.", 500);
      return NextResponse.json({ success: true });
    }
    if (action === "unsuspend") {
      if (!(await log({ action: "user.unsuspend", reason: reason || null }))) return bad("Audit log gagal — aksi dibatalkan.", 500);
      const { error } = await upsertAccess(id, { suspended_at: null, suspended_until: null, suspended_reason: null });
      if (error) return bad("Gagal mengaktifkan akun.", 500);
      return NextResponse.json({ success: true });
    }

    // ---- Role admin ----------------------------------------------------
    if (action === "setAdmin") {
      const value = body.value === true;
      if (value && isSuspended(access)) return bad("Aktifkan akun ini dulu sebelum menjadikannya admin.");
      if (!value && targetIsAdmin) {
        const { count } = await supabaseAdmin.from("user_access").select("*", { count: "exact", head: true }).eq("is_admin", true);
        if ((count || 0) <= 1) return bad("Tidak bisa menurunkan admin terakhir.");
      }
      if (!(await log({ action: value ? "user.make_admin" : "user.remove_admin" }))) return bad("Audit log gagal — aksi dibatalkan.", 500);
      const { error } = await upsertAccess(id, { is_admin: value });
      if (error) return bad("Gagal mengubah role.", 500);
      return NextResponse.json({ success: true });
    }

    // ---- Password & sesi ---------------------------------------------
    if (action === "resetPassword") {
      if (targetIsAdmin && !isSelf) return bad("Password admin lain tidak bisa direset dari sini.");
      const password = String(body.password || "");
      if (password.length < 8 || password.length > 72) return bad("Password harus 8-72 karakter.");
      if (!(await log({ action: "user.reset_password", reason: reason || null }))) return bad("Audit log gagal — aksi dibatalkan.", 500);
      const { error } = await supabaseAdmin.auth.admin.updateUserById(id, { password });
      if (error) {
        console.error("Gagal reset password:", error);
        return bad("Gagal mereset password.", 500);
      }
      await supabaseAdmin.rpc("admin_revoke_sessions", { target: id });
      return NextResponse.json({ success: true });
    }
    if (action === "revokeSessions") {
      if (!(await log({ action: "user.revoke_sessions" }))) return bad("Audit log gagal — aksi dibatalkan.", 500);
      const { error } = await supabaseAdmin.rpc("admin_revoke_sessions", { target: id });
      if (error) {
        console.error("Gagal mencabut sesi:", error);
        return bad("Gagal mengeluarkan sesi. Sudah menjalankan admin_setup.sql?", 500);
      }
      return NextResponse.json({ success: true });
    }

    // ---- Moderasi profil ---------------------------------------------
    if (action === "clearPhoto") {
      if (!(await log({ action: "user.clear_photo", reason: reason || null, snapshot: { photoUrl: target.photo_url } }))) return bad("Audit log gagal — aksi dibatalkan.", 500);
      const ids = new Set([publicIdFromUrl(target.photo_url), `avatars/user_${id}`, `user_${id}`].filter(Boolean));
      await Promise.all(Array.from(ids).map((pid) => destroyAsset(pid, "image")));
      const { error } = await supabaseAdmin.from("profiles").update({ photo_url: null }).eq("id", id);
      if (error) return bad("Gagal menghapus foto dari profil.", 500);
      return NextResponse.json({ success: true });
    }
    if (action === "clearBio") {
      const allowed = { headline: null, goal: null, interests: [], skills: [] };
      const fields = (Array.isArray(body.fields) ? body.fields : []).filter((f) => f in allowed);
      if (fields.length === 0) return bad("Pilih minimal satu bagian profil.");
      const patch = Object.fromEntries(fields.map((f) => [f, allowed[f]]));
      if (!(await log({ action: "user.clear_bio", reason: reason || null, snapshot: { fields } }))) return bad("Audit log gagal — aksi dibatalkan.", 500);
      let { error } = await supabaseAdmin.from("profiles").update(patch).eq("id", id);
      if (error && error.code === "42703" && "goal" in patch) {
        const { goal, ...rest } = patch;
        ({ error } = Object.keys(rest).length ? await supabaseAdmin.from("profiles").update(rest).eq("id", id) : { error: null });
      }
      if (error) return bad("Gagal mengosongkan profil.", 500);
      return NextResponse.json({ success: true });
    }

    // ---- Hapus akun permanen ------------------------------------------
    if (action === "delete") {
      if (isSelf) return bad("Tidak bisa menghapus akun sendiri.");
      if (targetIsAdmin) return bad("Turunkan status admin dulu sebelum menghapus akun.");
      if (String(body.confirmUsername || "") !== target.username) return bad("Konfirmasi username tidak cocok.");
      if (reason.length < 3) return bad("Alasan wajib diisi (minimal 3 karakter).");

      const [mods, posts, replies] = await Promise.all([
        supabaseAdmin.from("modules").select("id").eq("uploader_id", id).limit(2000),
        supabaseAdmin.from("posts").select("id").eq("author_id", id).limit(2000),
        supabaseAdmin.from("replies").select("id").eq("author_id", id).limit(5000),
      ]);
      const counts = { modules: (mods.data || []).length, posts: (posts.data || []).length, replies: (replies.data || []).length };
      if (!(await log({ action: "user.delete", reason, snapshot: { username: target.username, counts } }))) return bad("Audit log gagal — aksi dibatalkan.", 500);

      const failures = [];
      const ctx = { admin: a, reason, audit: false };
      for (const m of mods.data || []) {
        const r = await deleteModuleById(m.id, ctx);
        if (!r.ok) failures.push(`modul ${m.id}: ${r.error}`);
      }
      const deletedPosts = new Set();
      for (const p of posts.data || []) {
        const r = await deletePostById(p.id, ctx);
        if (r.ok) deletedPosts.add(p.id);
        else failures.push(`post ${p.id}: ${r.error}`);
      }
      // Balasan di thread orang lain (balasan di post yang sudah terhapus ikut hilang lewat cascade).
      const { data: remaining } = await supabaseAdmin.from("replies").select("id").eq("author_id", id).limit(5000);
      const touched = new Set();
      for (const r of remaining || []) {
        const res = await deleteReplyById(r.id, { ...ctx, reembed: false });
        if (res.ok && res.postId) touched.add(res.postId);
        else if (!res.ok && res.error !== "Balasan tidak ditemukan.") failures.push(`balasan ${r.id}: ${res.error}`);
      }
      for (const pid of touched) if (!deletedPosts.has(pid)) await embedForumPost(pid);

      await supabaseAdmin.from("likes").delete().eq("user_id", id);
      await supabaseAdmin.from("bookmarks").delete().eq("user_id", id);
      const avatarIds = new Set([publicIdFromUrl(target.photo_url), `avatars/user_${id}`, `user_${id}`].filter(Boolean));
      await Promise.all(Array.from(avatarIds).map((pid) => destroyAsset(pid, "image")));

      if (failures.length > 0) {
        console.error("Penghapusan akun berhenti karena ada kegagalan:", failures);
        return NextResponse.json({ error: `Sebagian konten gagal dihapus, akun BELUM dihapus. Coba lagi. (${failures[0]})`, failures }, { status: 500 });
      }
      await supabaseAdmin.from("profiles").delete().eq("id", id);
      const { error: authErr } = await supabaseAdmin.auth.admin.deleteUser(id);
      if (authErr) {
        console.error("Gagal menghapus akun auth:", authErr);
        return bad("Konten terhapus tetapi akun auth gagal dihapus. Coba lagi.", 500);
      }
      return NextResponse.json({ success: true, counts });
    }

    return bad("Aksi tidak dikenal.");
  } catch (err) {
    console.error("Gagal memproses aksi pengguna (admin):", err);
    return bad("Gagal memproses aksi.", 500);
  }
}

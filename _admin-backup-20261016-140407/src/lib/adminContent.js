// src/lib/adminContent.js
//
// Penghapusan konten oleh admin. Dipakai bersama oleh /api/admin/content
// (hapus massal) dan /api/admin/users/[id] (hapus akun).
// Urutan selalu: tulis audit log (dengan snapshot) -> hapus baris database ->
// bersihkan Cloudinary. Kalau audit log gagal, penghapusan dibatalkan.

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { embedForumPost } from "@/lib/embeddings";
import { CURRENT_AI_ANALYSIS_VERSION } from "@/lib/moduleTagging";
import { logAdminAction, destroyAsset, destroyImageUrls, moduleResourceType } from "@/lib/adminAuth";

const clip = (s, n = 600) => (typeof s === "string" && s.length > n ? `${s.slice(0, n)}…` : s);

function descendantsOf(rootId, rows) {
  const out = [];
  const queue = [rootId];
  while (queue.length) {
    const cur = queue.shift();
    for (const r of rows) {
      if (r.parent_id === cur) {
        out.push(r);
        queue.push(r.id);
      }
    }
  }
  return out;
}

export async function deleteModuleById(id, { admin, reason, audit = true }) {
  const { data: m, error } = await supabaseAdmin
    .from("modules")
    .select("id, uploader_id, title, subject, topic, description, tags, file_type, file_url, link_url, cloudinary_public_id, created_at")
    .eq("id", id)
    .maybeSingle();
  if (error) return { ok: false, error: "Gagal membaca modul." };
  if (!m) return { ok: false, error: "Modul tidak ditemukan." };

  if (audit) {
    const logged = await logAdminAction(admin, { action: "module.delete", targetType: "module", targetId: id, targetLabel: m.title, reason, snapshot: m });
    if (!logged) return { ok: false, error: "Audit log gagal — aksi dibatalkan." };
  }
  const { error: delErr } = await supabaseAdmin.from("modules").delete().eq("id", id);
  if (delErr) {
    console.error("Gagal menghapus modul:", delErr);
    return { ok: false, error: "Gagal menghapus modul." };
  }
  if (m.cloudinary_public_id) await destroyAsset(m.cloudinary_public_id, moduleResourceType(m.file_type));
  return { ok: true };
}

export async function deletePostById(id, { admin, reason, audit = true }) {
  const { data: p, error } = await supabaseAdmin
    .from("posts")
    .select("id, author_id, post_type, body, subject, topic, images, attachment_name, created_at")
    .eq("id", id)
    .maybeSingle();
  if (error) return { ok: false, error: "Gagal membaca post." };
  if (!p) return { ok: false, error: "Post tidak ditemukan." };

  const { data: replies } = await supabaseAdmin.from("replies").select("id, author_id, body, images, created_at").eq("post_id", id).limit(1000);

  if (audit) {
    const logged = await logAdminAction(admin, {
      action: "post.delete",
      targetType: "post",
      targetId: id,
      targetLabel: clip(p.body, 80),
      reason,
      snapshot: { post: p, replies: (replies || []).slice(0, 200).map((r) => ({ ...r, body: clip(r.body) })), replyCount: (replies || []).length },
    });
    if (!logged) return { ok: false, error: "Audit log gagal — aksi dibatalkan." };
  }
  const { error: delErr } = await supabaseAdmin.from("posts").delete().eq("id", id);
  if (delErr) {
    console.error("Gagal menghapus post:", delErr);
    return { ok: false, error: "Gagal menghapus post." };
  }
  await destroyImageUrls([...(p.images || []), ...(replies || []).flatMap((r) => r.images || [])]);
  return { ok: true };
}

// Menghapus balasan beserta balasan bersarangnya (cascade di database).
export async function deleteReplyById(id, { admin, reason, audit = true, reembed = true }) {
  const { data: r, error } = await supabaseAdmin
    .from("replies")
    .select("id, post_id, parent_id, author_id, body, images, created_at")
    .eq("id", id)
    .maybeSingle();
  if (error) return { ok: false, error: "Gagal membaca balasan." };
  if (!r) return { ok: false, error: "Balasan tidak ditemukan." };

  const { data: siblings } = await supabaseAdmin.from("replies").select("id, parent_id, author_id, body, images").eq("post_id", r.post_id).limit(5000);
  const nested = descendantsOf(r.id, siblings || []);

  if (audit) {
    const logged = await logAdminAction(admin, {
      action: "reply.delete",
      targetType: "reply",
      targetId: id,
      targetLabel: clip(r.body, 80),
      reason,
      snapshot: { reply: { ...r, body: clip(r.body, 2000) }, nested: nested.slice(0, 100).map((n) => ({ ...n, body: clip(n.body) })), nestedCount: nested.length },
    });
    if (!logged) return { ok: false, error: "Audit log gagal — aksi dibatalkan." };
  }
  const { error: delErr } = await supabaseAdmin.from("replies").delete().eq("id", id);
  if (delErr) {
    console.error("Gagal menghapus balasan:", delErr);
    return { ok: false, error: "Gagal menghapus balasan." };
  }
  await destroyImageUrls([...(r.images || []), ...nested.flatMap((n) => n.images || [])]);
  if (reembed) await embedForumPost(r.post_id);
  return { ok: true, postId: r.post_id };
}

// Modul yang perlu dianalisis ulang oleh AI (sama dengan logika retag-modules).
export async function countRetagPending() {
  let r = await supabaseAdmin.from("modules").select("id", { count: "exact", head: true }).lt("ai_analysis_version", CURRENT_AI_ANALYSIS_VERSION);
  if (r.error && r.error.code === "42703") {
    r = await supabaseAdmin.from("modules").select("id", { count: "exact", head: true }).is("ai_analyzed_at", null);
  }
  return r.count || 0;
}

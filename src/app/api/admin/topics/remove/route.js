// POST /api/admin/topics/remove
//   { subject, topic, moveTo?: { subject, topic }, reason? }  -> hapus topik
//   { subject, topic, restore: true }                          -> pulihkan topik bawaan yang pernah dihapus
//
// Aturan:
//  - Topik yang masih berisi modul/post TIDAK bisa dihapus begitu saja: admin wajib memilih topik tujuan,
//    isinya dipindahkan ke sana (tidak ada modul/post yang ikut terhapus).
//  - Topik bawaan (src/lib/folderTree.js) dicatat di tabel removed_topics supaya foldernya disembunyikan
//    (admin_setup_5.sql). Topik buatan pengguna hilang sendiri begitu isinya pindah.
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdmin, logAdminAction } from "@/lib/adminAuth";
import { FOLDER_TREE } from "@/lib/folderTree";

export const dynamic = "force-dynamic";

const NEEDS_SQL = "Tabel penghapusan topik belum ada. Jalankan admin_setup_5.sql di Supabase SQL Editor dulu.";
const str = (v) => String(v ?? "").trim();
const norm = (v) => str(v).toLowerCase();
const templateName = (subject, topic) => (FOLDER_TREE[subject] || []).find((t) => norm(t) === norm(topic)) || null;
const tableMissing = (e) => !!e && (e.code === "42P01" || e.code === "PGRST205" || /removed_topics/i.test(e.message || ""));

export async function POST(request) {
  const a = await requireAdmin(request);
  if (a.error) return a.error;
  try {
    const body = await request.json().catch(() => ({}));
    const subject = str(body.subject);
    const topic = str(body.topic);
    if (!subject || !topic) return NextResponse.json({ error: "subject dan topic wajib diisi." }, { status: 400 });
    const tpl = templateName(subject, topic);

    // ---------------------------------------------------------------- pulihkan
    if (body.restore === true) {
      if (!tpl) return NextResponse.json({ error: "Hanya topik bawaan yang bisa dipulihkan." }, { status: 400 });
      const logged = await logAdminAction(a, {
        action: "topic.restore",
        targetType: "topic",
        targetId: `${subject}/${tpl}`,
        targetLabel: `${subject} / ${tpl}`,
        snapshot: { subject, topic: tpl },
      });
      if (!logged) return NextResponse.json({ error: "Audit log gagal — aksi dibatalkan." }, { status: 500 });
      const { error } = await supabaseAdmin.from("removed_topics").delete().eq("subject", subject).eq("topic", tpl);
      if (error) {
        if (tableMissing(error)) return NextResponse.json({ error: NEEDS_SQL }, { status: 409 });
        console.error("Gagal memulihkan topik:", error);
        return NextResponse.json({ error: "Gagal memulihkan topik." }, { status: 500 });
      }
      return NextResponse.json({ success: true });
    }

    // ------------------------------------------------------------------- hapus
    const [mods, posts] = await Promise.all([
      supabaseAdmin.from("modules").select("id").eq("subject", subject).eq("topic", topic).limit(5000),
      supabaseAdmin.from("posts").select("id").eq("subject", subject).eq("topic", topic).limit(5000),
    ]);
    if (mods.error || posts.error) {
      console.error("Gagal menghitung isi topik:", mods.error || posts.error);
      return NextResponse.json({ error: "Gagal membaca isi topik." }, { status: 500 });
    }
    const moduleCount = (mods.data || []).length;
    const postCount = (posts.data || []).length;
    const hasContent = moduleCount + postCount > 0;

    if (!tpl && !hasContent) {
      return NextResponse.json({ error: "Topik ini sudah kosong dan tidak muncul lagi untuk siswa." }, { status: 404 });
    }

    let dest = null;
    if (hasContent) {
      const toSubject = str(body.moveTo && body.moveTo.subject);
      const toTopic = str(body.moveTo && body.moveTo.topic);
      if (!toSubject || !toTopic) {
        return NextResponse.json({ error: `Topik masih berisi ${moduleCount} modul dan ${postCount} post. Pilih topik tujuan untuk memindahkan isinya.` }, { status: 400 });
      }
      if (toSubject === subject && norm(toTopic) === norm(topic)) {
        return NextResponse.json({ error: "Topik tujuan tidak boleh sama dengan topik yang dihapus." }, { status: 400 });
      }
      if (toTopic.length > 120 || toSubject.length > 120) return NextResponse.json({ error: "Nama maksimal 120 karakter." }, { status: 400 });
      dest = { subject: toSubject, topic: templateName(toSubject, toTopic) || toTopic };
    }

    // Cek tabel DULU (sebelum memindahkan apa pun) supaya tidak setengah jalan.
    let removedRows = [];
    {
      const r = await supabaseAdmin.from("removed_topics").select("subject, topic");
      if (r.error) {
        if (tpl || dest) {
          if (tableMissing(r.error)) return NextResponse.json({ error: NEEDS_SQL }, { status: 409 });
          console.error("Gagal membaca removed_topics:", r.error);
          return NextResponse.json({ error: "Gagal membaca daftar topik terhapus." }, { status: 500 });
        }
      } else removedRows = r.data || [];
    }
    if (dest && removedRows.some((r) => r.subject === dest.subject && norm(r.topic) === norm(dest.topic))) {
      return NextResponse.json({ error: "Topik tujuan sudah dihapus. Pilih topik lain." }, { status: 400 });
    }

    const logged = await logAdminAction(a, {
      action: "topic.delete",
      targetType: "topic",
      targetId: `${subject}/${topic}`,
      targetLabel: dest ? `${subject} / ${topic} → ${dest.subject} / ${dest.topic}` : `${subject} / ${topic}`,
      reason: str(body.reason) || null,
      snapshot: { subject, topic, template: !!tpl, modules: moduleCount, posts: postCount, moveTo: dest },
    });
    if (!logged) return NextResponse.json({ error: "Audit log gagal — aksi dibatalkan." }, { status: 500 });

    let movedModules = 0;
    let movedPosts = 0;
    if (hasContent) {
      const modPatch = { topic: dest.topic, subject: dest.subject, embedding: null };
      if (templateName(dest.subject, dest.topic)) modPatch.topic_is_custom = false;
      const { data: m, error: modErr } = await supabaseAdmin.from("modules").update(modPatch).eq("subject", subject).eq("topic", topic).select("id");
      if (modErr) {
        console.error("Gagal memindahkan modul saat menghapus topik:", modErr);
        return NextResponse.json({ error: "Gagal memindahkan modul. Topik belum dihapus." }, { status: 500 });
      }
      movedModules = (m || []).length;
      const { data: p, error: postErr } = await supabaseAdmin
        .from("posts")
        .update({ topic: dest.topic, subject: dest.subject, embedding: null })
        .eq("subject", subject)
        .eq("topic", topic)
        .select("id");
      if (postErr) console.error("Gagal memindahkan post saat menghapus topik:", postErr);
      movedPosts = (p || []).length;
    }

    if (tpl) {
      const { error } = await supabaseAdmin.from("removed_topics").upsert({ subject, topic: tpl, removed_by: a.username || null }, { onConflict: "subject,topic" });
      if (error) {
        console.error("Gagal mencatat topik terhapus:", error);
        return NextResponse.json({ error: "Isi topik sudah dipindahkan, tetapi gagal menyembunyikan topik. Coba hapus lagi." }, { status: 500 });
      }
    }

    return NextResponse.json({ success: true, modules: movedModules, posts: movedPosts, needsEmbed: movedModules + movedPosts > 0, hidden: !!tpl });
  } catch (err) {
    console.error("Gagal memproses penghapusan topik:", err);
    return NextResponse.json({ error: "Gagal menghapus topik." }, { status: 500 });
  }
}

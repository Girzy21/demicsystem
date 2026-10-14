// PATCH /api/admin/modules/[id]  -> kurasi metadata modul (judul, deskripsi, subject,
//                                   topik, tag, jenis). Pemilik modul tidak berubah.
// POST  /api/admin/modules/[id]  -> { action: "approve" | "revertTitle" | "retag" }
//
// Nilai exercise_set_by yang dipakai admin adalah "user_edit" (nilai yang sudah
// dipakai route pemilik) supaya tidak melanggar CHECK constraint di database.
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { embedModule } from "@/lib/embeddings";
import { runModuleTagging } from "@/lib/moduleTagging";
import { requireAdmin, logAdminAction } from "@/lib/adminAuth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_TITLE = 200;
const MAX_DESC = 2000;
const MAX_FIELD = 120;

function cleanTags(list) {
  if (!Array.isArray(list)) return null;
  const out = [];
  const seen = new Set();
  for (const t of list) {
    const label = String(t?.label ?? "").trim().slice(0, 40);
    if (!label || seen.has(label.toLowerCase())) continue;
    seen.add(label.toLowerCase());
    const tag = { label, source: t?.source === "ai" ? "ai" : "manual" };
    if (typeof t?.confidence === "number") tag.confidence = t.confidence;
    out.push(tag);
    if (out.length >= 30) break;
  }
  return out;
}

export async function PATCH(request, { params }) {
  const a = await requireAdmin(request);
  if (a.error) return a.error;
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const update = {};

    if (body.title !== undefined) {
      const v = String(body.title || "").trim();
      if (!v) return NextResponse.json({ error: "Judul tidak boleh kosong." }, { status: 400 });
      if (v.length > MAX_TITLE) return NextResponse.json({ error: `Judul maksimal ${MAX_TITLE} karakter.` }, { status: 400 });
      update.title = v;
    }
    if (body.description !== undefined) {
      const v = String(body.description || "").trim();
      if (v.length > MAX_DESC) return NextResponse.json({ error: `Deskripsi maksimal ${MAX_DESC} karakter.` }, { status: 400 });
      update.description = v || null;
    }
    for (const [key, column] of [["subject", "subject"], ["topic", "topic"]]) {
      if (body[key] === undefined) continue;
      const v = String(body[key] || "").trim();
      if (!v) return NextResponse.json({ error: `${key} tidak boleh kosong.` }, { status: 400 });
      if (v.length > MAX_FIELD) return NextResponse.json({ error: `${key} maksimal ${MAX_FIELD} karakter.` }, { status: 400 });
      update[column] = v;
    }
    if (body.topicIsCustom !== undefined) update.topic_is_custom = !!body.topicIsCustom;
    if (body.isExercise !== undefined) {
      if (typeof body.isExercise !== "boolean") return NextResponse.json({ error: "isExercise harus true atau false." }, { status: 400 });
      update.is_exercise = body.isExercise;
      update.exercise_set_by = "user_edit";
    }
    if (body.tags !== undefined) {
      const tags = cleanTags(body.tags);
      if (!tags) return NextResponse.json({ error: "tags harus berupa daftar." }, { status: 400 });
      update.tags = tags;
    }
    if (body.markReviewed) update.admin_reviewed_at = new Date().toISOString();
    if (Object.keys(update).length === 0) return NextResponse.json({ error: "Tidak ada perubahan yang dikirim." }, { status: 400 });

    const { data: existing } = await supabaseAdmin.from("modules").select("*").eq("id", id).maybeSingle();
    if (!existing) return NextResponse.json({ error: "Modul tidak ditemukan." }, { status: 404 });

    if (update.title && existing.original_title && update.title === existing.original_title) update.original_title = null;

    const before = {};
    for (const k of Object.keys(update)) before[k] = existing[k] ?? null;
    const logged = await logAdminAction(a, { action: "module.update", targetType: "module", targetId: id, targetLabel: existing.title, snapshot: { before, after: update } });
    if (!logged) return NextResponse.json({ error: "Audit log gagal — perubahan dibatalkan." }, { status: 500 });

    const { error } = await supabaseAdmin.from("modules").update(update).eq("id", id);
    if (error) {
      console.error("Gagal mengubah modul (admin):", error);
      return NextResponse.json({ error: "Gagal menyimpan perubahan modul." }, { status: 500 });
    }
    // Judul/deskripsi/subject/topik/tag memengaruhi pencarian (tidak pernah melempar error).
    if (["title", "description", "subject", "topic", "tags"].some((k) => k in update)) await embedModule(id);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Gagal memproses edit modul (admin):", err);
    return NextResponse.json({ error: "Gagal mengubah modul." }, { status: 500 });
  }
}

export async function POST(request, { params }) {
  const a = await requireAdmin(request);
  if (a.error) return a.error;
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const { data: m } = await supabaseAdmin.from("modules").select("id, title, original_title").eq("id", id).maybeSingle();
    if (!m) return NextResponse.json({ error: "Modul tidak ditemukan." }, { status: 404 });

    if (body.action === "approve") {
      const logged = await logAdminAction(a, { action: "module.approve", targetType: "module", targetId: id, targetLabel: m.title });
      if (!logged) return NextResponse.json({ error: "Audit log gagal." }, { status: 500 });
      const { error } = await supabaseAdmin.from("modules").update({ admin_reviewed_at: new Date().toISOString() }).eq("id", id);
      if (error) return NextResponse.json({ error: "Gagal menandai modul." }, { status: 500 });
      return NextResponse.json({ success: true });
    }

    if (body.action === "revertTitle") {
      if (!m.original_title) return NextResponse.json({ error: "Modul ini tidak punya judul asli." }, { status: 400 });
      const logged = await logAdminAction(a, {
        action: "module.revert_title",
        targetType: "module",
        targetId: id,
        targetLabel: m.title,
        snapshot: { from: m.title, to: m.original_title },
      });
      if (!logged) return NextResponse.json({ error: "Audit log gagal." }, { status: 500 });
      const { error } = await supabaseAdmin
        .from("modules")
        .update({ title: m.original_title, original_title: null, admin_reviewed_at: new Date().toISOString() })
        .eq("id", id);
      if (error) return NextResponse.json({ error: "Gagal mengembalikan judul." }, { status: 500 });
      await embedModule(id);
      return NextResponse.json({ success: true });
    }

    if (body.action === "retag") {
      const logged = await logAdminAction(a, { action: "module.retag", targetType: "module", targetId: id, targetLabel: m.title });
      if (!logged) return NextResponse.json({ error: "Audit log gagal." }, { status: 500 });
      // Judul tidak diubah oleh analisis ulang dari admin.
      const r = await runModuleTagging(id, { allowTitleChange: false });
      if (!r.ok) return NextResponse.json({ error: r.error || "Analisis AI gagal." }, { status: r.status || 500 });
      return NextResponse.json({ success: true, result: r.data });
    }

    return NextResponse.json({ error: "Aksi tidak dikenal." }, { status: 400 });
  } catch (err) {
    console.error("Gagal memproses aksi modul (admin):", err);
    return NextResponse.json({ error: "Gagal memproses aksi." }, { status: 500 });
  }
}

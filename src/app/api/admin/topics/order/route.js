// GET  /api/admin/topics/order?subject=..&topic=..
//        -> modul dalam satu topik, persis sesuai urutan yang dilihat siswa
// POST /api/admin/topics/order  { subject, topic, ids: [...] }
//        -> simpan urutan baru (ids dari atas ke bawah; harus memuat SEMUA modul topik itu)
//      /api/admin/topics/order  { subject, topic, reset: true }
//        -> hapus urutan manual (kembali ke "terbaru dulu")
//
// Urutan disimpan di kolom modules.sort_order (lihat admin_setup_4.sql).
// NULL = belum diatur; modul tanpa urutan tampil di bawah yang sudah diurutkan.
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdmin, logAdminAction } from "@/lib/adminAuth";

export const dynamic = "force-dynamic";

const MAX_MODULES = 500;
const NEEDS_SQL = "Kolom urutan belum ada. Jalankan admin_setup_4.sql di Supabase SQL Editor dulu.";
const str = (v) => String(v ?? "").trim();

function byOrder(a, b) {
  const x = a.sort_order;
  const y = b.sort_order;
  if (x == null && y == null) return 0;
  if (x == null) return 1;
  if (y == null) return -1;
  return x - y;
}

export async function GET(request) {
  const a = await requireAdmin(request);
  if (a.error) return a.error;
  try {
    const { searchParams } = new URL(request.url);
    const subject = str(searchParams.get("subject"));
    const topic = str(searchParams.get("topic"));
    if (!subject || !topic) return NextResponse.json({ error: "subject dan topic wajib diisi." }, { status: 400 });

    let needsSql = false;
    let { data, error } = await supabaseAdmin
      .from("modules")
      .select("id, title, file_type, link_url, created_at, sort_order")
      .eq("subject", subject)
      .eq("topic", topic)
      .order("created_at", { ascending: false })
      .limit(MAX_MODULES);
    if (error && error.code === "42703") {
      needsSql = true;
      ({ data, error } = await supabaseAdmin
        .from("modules")
        .select("id, title, file_type, link_url, created_at")
        .eq("subject", subject)
        .eq("topic", topic)
        .order("created_at", { ascending: false })
        .limit(MAX_MODULES));
    }
    if (error) {
      console.error("Gagal mengambil modul topik (admin):", error);
      return NextResponse.json({ error: "Gagal mengambil modul." }, { status: 500 });
    }
    // sort() stabil: yang sama-sama belum diurutkan tetap terbaru dulu.
    const rows = [...(data || [])].sort(byOrder);
    return NextResponse.json({
      needsSql,
      modules: rows.map((m) => ({
        id: m.id,
        title: m.title || "(tanpa judul)",
        type: m.link_url ? "LINK" : m.file_type || "",
        ordered: m.sort_order != null,
      })),
    });
  } catch (err) {
    console.error("Gagal memproses urutan modul (admin):", err);
    return NextResponse.json({ error: "Gagal mengambil modul." }, { status: 500 });
  }
}

export async function POST(request) {
  const a = await requireAdmin(request);
  if (a.error) return a.error;
  try {
    const body = await request.json().catch(() => ({}));
    const subject = str(body.subject);
    const topic = str(body.topic);
    if (!subject || !topic) return NextResponse.json({ error: "subject dan topic wajib diisi." }, { status: 400 });

    const { data: group, error: groupErr } = await supabaseAdmin
      .from("modules")
      .select("id")
      .eq("subject", subject)
      .eq("topic", topic)
      .limit(MAX_MODULES);
    if (groupErr) {
      console.error("Gagal membaca modul topik:", groupErr);
      return NextResponse.json({ error: "Gagal membaca modul topik." }, { status: 500 });
    }
    const groupIds = (group || []).map((r) => String(r.id));

    // ---- kembali ke urutan otomatis (terbaru dulu) ----
    if (body.reset === true) {
      const logged = await logAdminAction(a, {
        action: "topic.reorder_reset",
        targetType: "topic",
        targetId: `${subject}/${topic}`,
        targetLabel: `${subject} / ${topic}`,
        snapshot: { subject, topic, modules: groupIds.length },
      });
      if (!logged) return NextResponse.json({ error: "Audit log gagal — aksi dibatalkan." }, { status: 500 });
      const { error } = await supabaseAdmin.from("modules").update({ sort_order: null }).eq("subject", subject).eq("topic", topic);
      if (error) {
        if (error.code === "42703") return NextResponse.json({ error: NEEDS_SQL }, { status: 409 });
        console.error("Gagal mereset urutan modul:", error);
        return NextResponse.json({ error: "Gagal mereset urutan." }, { status: 500 });
      }
      return NextResponse.json({ success: true, count: groupIds.length });
    }

    // ---- simpan urutan baru ----
    const ids = Array.isArray(body.ids) ? body.ids.map((v) => String(v)) : null;
    if (!ids || ids.length === 0) return NextResponse.json({ error: "ids harus berupa daftar modul." }, { status: 400 });
    if (ids.length > MAX_MODULES || new Set(ids).size !== ids.length) {
      return NextResponse.json({ error: "Daftar modul tidak valid (ada duplikat atau terlalu banyak)." }, { status: 400 });
    }
    const same = ids.length === groupIds.length && groupIds.every((id) => ids.includes(id));
    if (!same) {
      return NextResponse.json({ error: "Isi topik berubah sejak daftar dimuat (ada modul baru, dihapus, atau dipindah). Tutup lalu buka lagi." }, { status: 409 });
    }

    const logged = await logAdminAction(a, {
      action: "topic.reorder",
      targetType: "topic",
      targetId: `${subject}/${topic}`,
      targetLabel: `${subject} / ${topic}`,
      snapshot: { subject, topic, order: ids },
    });
    if (!logged) return NextResponse.json({ error: "Audit log gagal — aksi dibatalkan." }, { status: 500 });

    // Supabase tidak punya update massal dengan nilai berbeda per baris; topik berisi puluhan modul, jadi per-baris saja.
    for (let i = 0; i < ids.length; i += 10) {
      const chunk = ids.slice(i, i + 10);
      const results = await Promise.all(
        chunk.map((id, k) => supabaseAdmin.from("modules").update({ sort_order: i + k + 1 }).eq("id", id).eq("subject", subject).eq("topic", topic))
      );
      const failed = results.find((r) => r.error);
      if (failed) {
        if (failed.error.code === "42703") return NextResponse.json({ error: NEEDS_SQL }, { status: 409 });
        console.error("Gagal menyimpan urutan modul:", failed.error);
        return NextResponse.json({ error: "Sebagian urutan gagal disimpan. Coba lagi." }, { status: 500 });
      }
    }
    return NextResponse.json({ success: true, count: ids.length });
  } catch (err) {
    console.error("Gagal memproses urutan modul:", err);
    return NextResponse.json({ error: "Gagal menyimpan urutan." }, { status: 500 });
  }
}

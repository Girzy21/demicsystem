// GET  /api/admin/topics  -> daftar subject/topik beserta jumlah modul & post
// POST /api/admin/topics  { subject, from, toSubject?, to, markOfficial?, reason? }
//      Memindahkan / mengganti nama topik untuk SEMUA modul dan post yang
//      memakainya (dipakai untuk menggabungkan topik buatan pengguna ke topik
//      resmi). Embedding yang terdampak dikosongkan; panel menjalankan
//      "isi embedding" otomatis sesudahnya.
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdmin, logAdminAction } from "@/lib/adminAuth";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const a = await requireAdmin(request);
  if (a.error) return a.error;
  try {
    const [mods, posts] = await Promise.all([
      supabaseAdmin.from("modules").select("subject, topic, topic_is_custom").limit(5000),
      supabaseAdmin.from("posts").select("subject, topic").limit(5000),
    ]);
    if (mods.error) return NextResponse.json({ error: "Gagal mengambil topik." }, { status: 500 });
    const map = new Map();
    const get = (subject, topic) => {
      const key = `${subject}\u0000${topic}`;
      if (!map.has(key)) map.set(key, { subject, topic, modules: 0, posts: 0, custom: 0 });
      return map.get(key);
    };
    for (const m of mods.data || []) {
      if (!m.subject || !m.topic) continue;
      const g = get(m.subject, m.topic);
      g.modules++;
      if (m.topic_is_custom) g.custom++;
    }
    for (const p of posts.data || []) {
      if (!p.subject || !p.topic) continue;
      get(p.subject, p.topic).posts++;
    }
    const topics = Array.from(map.values()).sort((x, y) => x.subject.localeCompare(y.subject) || x.topic.localeCompare(y.topic));
    return NextResponse.json({ topics });
  } catch (err) {
    console.error("Gagal memproses topik (admin):", err);
    return NextResponse.json({ error: "Gagal mengambil topik." }, { status: 500 });
  }
}

export async function POST(request) {
  const a = await requireAdmin(request);
  if (a.error) return a.error;
  try {
    const body = await request.json().catch(() => ({}));
    const str = (v) => String(v ?? "").trim();
    const subject = str(body.subject);
    const from = str(body.from);
    const to = str(body.to);
    const toSubject = str(body.toSubject) || subject;
    if (!subject || !from || !to) return NextResponse.json({ error: "subject, from, dan to wajib diisi." }, { status: 400 });
    if (to.length > 120 || toSubject.length > 120) return NextResponse.json({ error: "Nama maksimal 120 karakter." }, { status: 400 });
    if (subject === toSubject && from === to) return NextResponse.json({ error: "Tujuan sama dengan asal." }, { status: 400 });

    const logged = await logAdminAction(a, {
      action: "topic.move",
      targetType: "topic",
      targetId: `${subject}/${from}`,
      targetLabel: `${subject} / ${from} → ${toSubject} / ${to}`,
      reason: str(body.reason) || null,
      snapshot: { subject, from, toSubject, to, markOfficial: !!body.markOfficial },
    });
    if (!logged) return NextResponse.json({ error: "Audit log gagal — aksi dibatalkan." }, { status: 500 });

    const modPatch = { topic: to, subject: toSubject, embedding: null };
    if (body.markOfficial) modPatch.topic_is_custom = false;
    const { data: movedMods, error: modErr } = await supabaseAdmin.from("modules").update(modPatch).eq("subject", subject).eq("topic", from).select("id");
    if (modErr) {
      console.error("Gagal memindahkan topik modul:", modErr);
      return NextResponse.json({ error: "Gagal memindahkan topik." }, { status: 500 });
    }
    const { data: movedPosts, error: postErr } = await supabaseAdmin
      .from("posts")
      .update({ topic: to, subject: toSubject, embedding: null })
      .eq("subject", subject)
      .eq("topic", from)
      .select("id");
    if (postErr) console.error("Gagal memindahkan topik post:", postErr);

    const modules = (movedMods || []).length;
    const posts = (movedPosts || []).length;
    return NextResponse.json({ success: true, modules, posts, needsEmbed: modules + posts > 0 });
  } catch (err) {
    console.error("Gagal memproses pemindahan topik:", err);
    return NextResponse.json({ error: "Gagal memindahkan topik." }, { status: 500 });
  }
}

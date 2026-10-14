// GET  /api/admin/maintenance                         -> status (sisa pekerjaan)
// POST /api/admin/maintenance { step: "embed" }        -> isi embedding yang kosong (1 batch)
// POST /api/admin/maintenance { step: "retag", limit } -> analisis ulang AI modul lama (1 batch)
//
// Pengganti endpoint backfill-embeddings / retag-modules yang memakai secret.
// Panel memanggil POST berulang sampai done = true (satu batch per panggilan
// supaya muat di batas waktu fungsi Vercel).
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { embedModule, embedForumPost, isEmbeddingConfigured } from "@/lib/embeddings";
import { runModuleTagging, CURRENT_AI_ANALYSIS_VERSION } from "@/lib/moduleTagging";
import { requireAdmin, logAdminAction } from "@/lib/adminAuth";
import { countRetagPending } from "@/lib/adminContent";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const EMBED_BATCH = 8;
const RETAG_DEFAULT = 2;
const RETAG_MAX = 3;

async function embeddingLeft() {
  const [m, p] = await Promise.all([
    supabaseAdmin.from("modules").select("*", { count: "exact", head: true }).is("embedding", null),
    supabaseAdmin.from("posts").select("*", { count: "exact", head: true }).is("embedding", null),
  ]);
  return { modules: m.count || 0, posts: p.count || 0 };
}

export async function GET(request) {
  const a = await requireAdmin(request);
  if (a.error) return a.error;
  try {
    const [emb, retag] = await Promise.all([embeddingLeft(), countRetagPending()]);
    return NextResponse.json({
      embedding: emb,
      retagPending: retag,
      embeddingConfigured: isEmbeddingConfigured(),
      aiConfigured: !!process.env.AI_PROVIDER_API_KEY,
    });
  } catch (err) {
    console.error("Gagal mengambil status maintenance:", err);
    return NextResponse.json({ error: "Gagal mengambil status." }, { status: 500 });
  }
}

export async function POST(request) {
  const a = await requireAdmin(request);
  if (a.error) return a.error;
  try {
    const body = await request.json().catch(() => ({}));

    if (body.step === "embed") {
      if (!isEmbeddingConfigured()) return NextResponse.json({ error: "AI_PROVIDER_API_KEY belum diset." }, { status: 500 });
      const { data: mods } = await supabaseAdmin.from("modules").select("id").is("embedding", null).order("created_at", { ascending: true }).limit(EMBED_BATCH);
      for (const m of mods || []) await embedModule(m.id);
      const { data: posts } = await supabaseAdmin.from("posts").select("id").is("embedding", null).order("created_at", { ascending: true }).limit(EMBED_BATCH);
      for (const p of posts || []) await embedForumPost(p.id);
      const left = await embeddingLeft();
      const remaining = left.modules + left.posts;
      if (remaining === 0 && ((mods || []).length > 0 || (posts || []).length > 0)) {
        await logAdminAction(a, { action: "maintenance.embed", snapshot: { note: "selesai" } });
      }
      return NextResponse.json({ done: remaining === 0, remaining, modulesLeft: left.modules, postsLeft: left.posts });
    }

    if (body.step === "retag") {
      if (!process.env.AI_PROVIDER_API_KEY) return NextResponse.json({ error: "AI_PROVIDER_API_KEY belum diset." }, { status: 500 });
      const requested = parseInt(body.limit, 10);
      const limit = Math.min(RETAG_MAX, Math.max(1, Number.isFinite(requested) ? requested : RETAG_DEFAULT));
      let { data: rows, error } = await supabaseAdmin
        .from("modules")
        .select("id, title")
        .lt("ai_analysis_version", CURRENT_AI_ANALYSIS_VERSION)
        .order("created_at", { ascending: true })
        .limit(limit);
      if (error && error.code === "42703") {
        ({ data: rows, error } = await supabaseAdmin.from("modules").select("id, title").is("ai_analyzed_at", null).order("created_at", { ascending: true }).limit(limit));
      }
      if (error) return NextResponse.json({ error: "Gagal mengambil daftar modul." }, { status: 500 });

      const results = [];
      for (const row of rows || []) {
        const r = await runModuleTagging(row.id, { allowTitleChange: false });
        results.push({ id: row.id, title: row.title, ok: !!(r.ok && !r.data?.skipped), error: r.ok ? undefined : r.error });
      }
      const remaining = await countRetagPending();
      const processed = results.filter((r) => r.ok).length;
      if (processed > 0) await logAdminAction(a, { action: "maintenance.retag", snapshot: { processed, remaining } });
      return NextResponse.json({ done: remaining === 0, remaining, processed, failed: results.length - processed, results });
    }

    return NextResponse.json({ error: "Langkah tidak dikenal." }, { status: 400 });
  } catch (err) {
    console.error("Gagal menjalankan maintenance:", err);
    return NextResponse.json({ error: "Gagal menjalankan maintenance." }, { status: 500 });
  }
}

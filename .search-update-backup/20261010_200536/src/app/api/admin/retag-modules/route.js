// API route: GET /api/admin/retag-modules?secret=XXXX[&limit=2]
//
// Menjalankan analisis AI versi terbaru (kata kunci yang lebih presisi +
// topik yang didukung/difondasi) untuk modul LAMA yang belum pernah
// dianalisis dengan versi ini (kolom ai_analyzed_at masih kosong).
// Judul modul TIDAK diubah oleh proses ini. Setiap modul otomatis di-embed
// ulang setelah dianalisis.
//
// Cara pakai (sekali saja):
//   1. Pastikan env EMBEDDING_BACKFILL_SECRET sudah diisi (sama dengan backfill)
//   2. Buka https://DOMAIN-KAMU/api/admin/retag-modules?secret=STRING_TADI
//   3. Kalau hasilnya "done": false, buka/refresh lagi sampai "done": true
//   4. Setelah selesai, hapus env EMBEDDING_BACKFILL_SECRET

import crypto from "crypto";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { runModuleTagging } from "@/lib/moduleTagging";

// Satu panggilan AI bisa memakan beberapa detik; beri ruang waktu di hosting serverless.
export const maxDuration = 60;

const DEFAULT_LIMIT = 2;
const MAX_LIMIT = 5;

function secretsMatch(provided, expected) {
  if (!provided || !expected) return false;
  const a = Buffer.from(String(provided));
  const b = Buffer.from(String(expected));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function GET(request) {
  try {
    const expected = process.env.EMBEDDING_BACKFILL_SECRET;
    const url = new URL(request.url);
    const provided = request.headers.get("x-backfill-secret") || url.searchParams.get("secret");
    if (!expected || !secretsMatch(provided, expected)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (!process.env.AI_PROVIDER_API_KEY) {
      return NextResponse.json({ error: "AI_PROVIDER_API_KEY belum diset." }, { status: 500 });
    }

    const requested = parseInt(url.searchParams.get("limit") || "", 10);
    const limit = Math.min(MAX_LIMIT, Math.max(1, Number.isFinite(requested) ? requested : DEFAULT_LIMIT));

    const { data: rows, error } = await supabaseAdmin
      .from("modules")
      .select("id, title")
      .is("ai_analyzed_at", null)
      .order("created_at", { ascending: true })
      .limit(limit);
    if (error) {
      console.error("Gagal mengambil modul untuk retag (sudah jalankan SQL tahap 2?):", error);
      return NextResponse.json({ error: "Gagal mengambil daftar modul. Sudah menjalankan 02_activity_edit_ai_migration.sql?" }, { status: 500 });
    }

    const results = [];
    for (const row of rows || []) {
      const r = await runModuleTagging(row.id, { allowTitleChange: false });
      if (r.ok && !r.data.skipped) {
        results.push({ id: row.id, title: row.title, ok: true, keywords: r.data.searchKeywords.length, supports: r.data.supportsTopics });
      } else {
        results.push({ id: row.id, title: row.title, ok: false, error: r.ok ? "dilewati" : r.error });
      }
    }

    const { count: remaining } = await supabaseAdmin
      .from("modules")
      .select("id", { count: "exact", head: true })
      .is("ai_analyzed_at", null);

    const failed = results.filter((r) => !r.ok).length;
    return NextResponse.json({
      done: (remaining || 0) === 0,
      processed: results.length - failed,
      failed,
      remaining: remaining || 0,
      results,
      note: failed > 0 ? "Modul yang gagal akan dicoba lagi pada panggilan berikutnya." : undefined,
    });
  } catch (err) {
    console.error("Gagal retag modul:", err);
    return NextResponse.json({ error: "Gagal retag modul." }, { status: 500 });
  }
}

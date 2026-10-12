// API route: GET /api/admin/backfill-embeddings?secret=XXXX
//
// Mengisi embedding untuk modul & post forum yang SUDAH ADA sebelum fitur
// pencarian semantik dipasang (baris baru otomatis di-embed saat dibuat).
//
// Cara pakai (sekali saja):
//   1. Isi env EMBEDDING_BACKFILL_SECRET dengan string acak panjang
//   2. Buka di browser: https://DOMAIN-KAMU/api/admin/backfill-embeddings?secret=STRING_TADI
//   3. Kalau hasilnya "done": false, buka lagi sampai "done": true
//   4. Setelah selesai, hapus env EMBEDDING_BACKFILL_SECRET (endpoint jadi mati)
//
// Hanya baris yang embedding-nya masih kosong yang diproses, jadi aman
// dijalankan berulang kali.

import crypto from "crypto";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { createEmbeddings, buildModuleText, buildPostText, isEmbeddingConfigured } from "@/lib/embeddings";

const BATCH_SIZE = 25;
const MAX_BATCHES_PER_TABLE = 6; // menjaga satu request tetap singkat

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
      // Sengaja 404 agar endpoint ini tidak terlihat ada kalau secret salah/tidak diset.
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (!isEmbeddingConfigured()) {
      return NextResponse.json({ error: "AI_PROVIDER_API_KEY belum diset." }, { status: 500 });
    }

    let lastModuleId = null;
    let lastPostId = null;

    const stats = { modulesEmbedded: 0, postsEmbedded: 0, errors: [] };

    // ---- Modul ------------------------------------------------------
    // is_exercise baru ada setelah SQL tahap 3; kalau belum ada, dilewati.
    const MODULE_COLS = "id, title, original_title, subject, topic, description, tags, search_keywords, file_type, link_url";
    const moduleQuery = (cols) => {
      let q = supabaseAdmin.from("modules").select(cols).order("id", { ascending: true }).limit(BATCH_SIZE);
      q = q.is("embedding", null);
      if (lastModuleId) q = q.gt("id", lastModuleId);
      return q;
    };
    for (let i = 0; i < MAX_BATCHES_PER_TABLE; i++) {
      let { data: rows, error } = await moduleQuery(`${MODULE_COLS}, is_exercise`);
      if (error && error.code === "42703") ({ data: rows, error } = await moduleQuery(MODULE_COLS));
      if (error) {
        stats.errors.push(`Ambil modul: ${error.message}`);
        break;
      }
      if (!rows || rows.length === 0) break;

      try {
        const vecs = await createEmbeddings(rows.map(buildModuleText));
        for (let j = 0; j < rows.length; j++) {
          const { error: upErr } = await supabaseAdmin.from("modules").update({ embedding: vecs[j] }).eq("id", rows[j].id);
          if (upErr) stats.errors.push(`Update modul ${rows[j].id}: ${upErr.message}`);
          else stats.modulesEmbedded++;
        }
      } catch (err) {
        stats.errors.push(`Embed modul: ${err.message}`);
        break;
      }
      lastModuleId = rows[rows.length - 1].id;
      if (rows.length < BATCH_SIZE) {
        lastModuleId = null;
        break;
      }
    }

    // ---- Post forum (+ balasannya) ------------------------------------
    for (let i = 0; i < MAX_BATCHES_PER_TABLE; i++) {
      let q = supabaseAdmin
        .from("posts")
        .select("id, post_type, body, subject, topic")
        .order("id", { ascending: true })
        .limit(BATCH_SIZE);
      q = q.is("embedding", null);
      if (lastPostId) q = q.gt("id", lastPostId);
      const { data: rows, error } = await q;
      if (error) {
        stats.errors.push(`Ambil post: ${error.message}`);
        break;
      }
      if (!rows || rows.length === 0) break;

      try {
        const { data: replyRows } = await supabaseAdmin
          .from("replies")
          .select("post_id, body, created_at")
          .in("post_id", rows.map((r) => r.id))
          .order("created_at", { ascending: true });
        const repliesByPost = {};
        for (const r of replyRows || []) (repliesByPost[r.post_id] ||= []).push(r);

        const vecs = await createEmbeddings(rows.map((p) => buildPostText(p, repliesByPost[p.id] || [])));
        for (let j = 0; j < rows.length; j++) {
          const { error: upErr } = await supabaseAdmin.from("posts").update({ embedding: vecs[j] }).eq("id", rows[j].id);
          if (upErr) stats.errors.push(`Update post ${rows[j].id}: ${upErr.message}`);
          else stats.postsEmbedded++;
        }
      } catch (err) {
        stats.errors.push(`Embed post: ${err.message}`);
        break;
      }
      lastPostId = rows[rows.length - 1].id;
      if (rows.length < BATCH_SIZE) {
        lastPostId = null;
        break;
      }
    }

    // ---- Sisa pekerjaan ---------------------------------------------
    const { count: modulesLeft } = await supabaseAdmin
      .from("modules")
      .select("id", { count: "exact", head: true })
      .is("embedding", null);
    const { count: postsLeft } = await supabaseAdmin
      .from("posts")
      .select("id", { count: "exact", head: true })
      .is("embedding", null);

    const done = (modulesLeft || 0) === 0 && (postsLeft || 0) === 0;

    return NextResponse.json({
      done,
      ...stats,
      modulesWithoutEmbedding: modulesLeft || 0,
      postsWithoutEmbedding: postsLeft || 0,
    });
  } catch (err) {
    console.error("Gagal backfill embedding:", err);
    return NextResponse.json({ error: "Gagal backfill embedding." }, { status: 500 });
  }
}

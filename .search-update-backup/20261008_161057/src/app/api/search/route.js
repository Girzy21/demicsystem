// API route: POST /api/search
//
// Pencarian semantik lintas Bank Modul + Forum Diskusi.
//   1. Verifikasi token Supabase (hanya user login yang boleh mencari)
//   2. Ubah query jadi vektor lewat CometAPI (text-embedding-3-small)
//   3. Cari yang paling mirip di pgvector (RPC match_modules / match_posts)
//   4. Gerbang relevansi ketat (hasil harus cocok kata ATAU sangat mirip makna,
//      lalu hasil yang jauh di bawah skor terbaik dibuang), bonus kecil untuk
//      kecocokan kata, lalu bagi modul ke tier direct / foundational /
//      supporting / applied. Tier "foundational" berasal dari daftar
//      supports_topics hasil analisis AI (mis. trigonometri -> gelombang).
//   5. (Opsional) minta LLM merapikan tier + alasan, kalau
//      SEARCH_LLM_TIERING=true di env. Kalau gagal, tier heuristik tetap dipakai.
//
// Body : { "query": "gelombang" }
// Balik: { direct, foundational, supporting, applied, forum, mode, llmTiering }

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { createEmbedding, isEmbeddingConfigured, toTagLabels } from "@/lib/embeddings";
import {
  MIN_SIMILARITY,
  FORUM_MIN_SIMILARITY,
  normalizeQuery,
  lexicalMatch,
  clampScore,
  filterRelevant,
  matchSupportsTopic,
  foundationBaseScore,
  tierModules,
  applyLlmTiers,
  capForum,
  extractJsonObject,
} from "@/lib/searchRanking";

const AI_BASE_URL = process.env.AI_PROVIDER_BASE_URL || "https://api.cometapi.com/v1";
const AI_MODEL = process.env.AI_PROVIDER_MODEL || "gemini-3.8-flash";
const AI_API_KEY = process.env.AI_PROVIDER_API_KEY;
const USE_LLM_TIERING = process.env.SEARCH_LLM_TIERING === "true";
const LLM_TIMEOUT_MS = 9000;

const EMPTY = { direct: [], foundational: [], supporting: [], applied: [], forum: [] };

// ---- Opsional: LLM merapikan tier + alasan ---------------------------
async function refineWithLlm(query, tiered) {
  const candidates = [...tiered.direct, ...tiered.supporting, ...tiered.applied].slice(0, 14);
  if (candidates.length === 0) return null;

  const list = candidates
    .map((m) => `- id=${m.id} | ${m.title} | ${m.subject} · ${m.topic} | tag: ${m.tags.slice(0, 5).join(", ") || "-"}`)
    .join("\n");

  const prompt = `Seorang siswa IB mencari: "${query}"

Berikut modul kandidat dari Bank Modul:
${list}

Kelompokkan tiap modul ke SATU tier:
- "direct": modul yang memang membahas topik yang dicari
- "foundational": konsep dasar/prasyarat yang sebaiknya dipelajari dulu sebelum paham topik yang dicari
- "supporting": konteks tambahan yang memperdalam pemahaman
- "applied": tempat konsep yang sama dipakai di subject/topik lain
- "skip": tidak relevan

Beri "reason" singkat (maks 90 karakter, Bahasa Indonesia) untuk tier selain "direct" (untuk "direct" isi null). Jangan mengarang id baru.
Jawab HANYA JSON valid: {"items":[{"id":"...","tier":"direct|foundational|supporting|applied|skip","reason":"..."}]}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
  try {
    const res = await fetch(`${AI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${AI_API_KEY}` },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [
          { role: "system", content: "Kamu adalah asisten pencarian materi belajar. Selalu jawab dengan JSON valid saja." },
          { role: "user", content: prompt },
        ],
        temperature: 0.2,
        max_tokens: 2500,
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`LLM error ${res.status}`);
    const result = await res.json();
    const raw = result?.choices?.[0]?.message?.content || "";
    const jsonStr = extractJsonObject(raw);
    if (!jsonStr) return null;
    const parsed = JSON.parse(jsonStr);
    return Array.isArray(parsed.items) ? parsed.items : null;
  } catch (err) {
    console.error("LLM tiering dilewati:", err.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(request) {
  try {
    // ---- 1. Verifikasi pemanggil -------------------------------------
    const authHeader = request.headers.get("authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) {
      return NextResponse.json({ error: "Tidak ada token autentikasi." }, { status: 401 });
    }
    const {
      data: { user },
      error: authError,
    } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json({ error: "Sesi tidak valid — coba login ulang." }, { status: 401 });
    }

    // ---- 2. Baca & validasi query ------------------------------------
    const body = await request.json().catch(() => ({}));
    const query = normalizeQuery(body.query);
    if (query.length < 2) {
      return NextResponse.json({ ...EMPTY, mode: "semantic", llmTiering: false });
    }
    if (!isEmbeddingConfigured()) {
      return NextResponse.json({ error: "Pencarian semantik belum dikonfigurasi di server." }, { status: 503 });
    }

    // ---- 3. Embed query ----------------------------------------------
    let queryVec;
    try {
      queryVec = await createEmbedding(query);
    } catch (err) {
      console.error("Gagal embed query pencarian:", err.message);
      return NextResponse.json({ error: "Layanan embedding sedang bermasalah." }, { status: 502 });
    }

    // ---- 4. Vector search (modul + forum paralel) --------------------
    const [modRes, postRes] = await Promise.all([
      supabaseAdmin.rpc("match_modules", { query_embedding: queryVec, match_count: 20, min_similarity: MIN_SIMILARITY }),
      supabaseAdmin.rpc("match_posts", { query_embedding: queryVec, match_count: 10, min_similarity: FORUM_MIN_SIMILARITY }),
    ]);
    if (modRes.error) {
      console.error("RPC match_modules gagal (sudah jalankan SQL migrasi?):", modRes.error);
      return NextResponse.json({ error: "Gagal mencari modul." }, { status: 500 });
    }
    if (postRes.error) console.error("RPC match_posts gagal:", postRes.error);

    const modHits = modRes.data || [];
    const postHits = postRes.error ? [] : postRes.data || [];
    const modSim = new Map(modHits.map((r) => [r.id, r.similarity]));
    const postSim = new Map(postHits.map((r) => [r.id, r.similarity]));

    // ---- 5. Modul yang disebut AI sebagai fondasi topik yang dicari ----
    // Dipindai langsung dari kolom supports_topics (skala sekolah: ratusan
    // modul). Kalau kolomnya belum ada (SQL tahap 2 belum dijalankan),
    // bagian ini dilewati tanpa mengganggu pencarian lainnya.
    const supportsHit = new Map(); // id -> topik yang cocok
    try {
      const { data: supRows, error: supError } = await supabaseAdmin
        .from("modules")
        .select("id, supports_topics")
        .limit(2000);
      if (!supError) {
        for (const r of supRows || []) {
          const hit = matchSupportsTopic(query, r.supports_topics);
          if (hit) supportsHit.set(r.id, hit);
        }
      }
    } catch (err) {
      console.error("Pemindaian supports_topics dilewati:", err.message);
    }

    // ---- 6. Ambil detail baris ---------------------------------------
    const modIds = Array.from(new Set([...modHits.map((r) => r.id), ...supportsHit.keys()]));
    let modRows = [];
    if (modIds.length > 0) {
      const { data } = await supabaseAdmin
        .from("modules")
        .select("id, title, original_title, subject, topic, description, file_type, file_url, link_url, tags, search_keywords, uploader_id, created_at")
        .in("id", modIds);
      modRows = data || [];
    }
    let postRows = [];
    let replyCountByPost = {};
    if (postHits.length > 0) {
      const postIds = postHits.map((r) => r.id);
      const { data } = await supabaseAdmin
        .from("posts")
        .select("id, post_type, body, subject, topic, images, author_id, created_at")
        .in("id", postIds);
      postRows = data || [];
      const { data: replyRows } = await supabaseAdmin.from("replies").select("post_id").in("post_id", postIds);
      for (const r of replyRows || []) replyCountByPost[r.post_id] = (replyCountByPost[r.post_id] || 0) + 1;
    }

    // Nama uploader / penulis (hanya username, dari public_profiles)
    const userIds = Array.from(new Set([...modRows.map((m) => m.uploader_id), ...postRows.map((p) => p.author_id)]));
    let usernameById = {};
    if (userIds.length > 0) {
      const { data: profs } = await supabaseAdmin.from("public_profiles").select("id, username").in("id", userIds);
      usernameById = Object.fromEntries((profs || []).map((p) => [p.id, p.username]));
    }

    // ---- 7. Skor akhir + gerbang relevansi -------------------------------
    // Kata kunci tersembunyi buatan AI hanya "weak": bonus kecil dan tidak
    // pernah cukup untuk menjadikan modul "direct".
    const toItem = (m, sim) => {
      const tagLabels = toTagLabels(m.tags);
      const lm = lexicalMatch(
        query,
        [m.title, m.original_title, m.subject, m.topic, m.description, ...tagLabels],
        m.search_keywords || []
      );
      return {
        id: m.id,
        title: m.title,
        originalTitle: m.original_title || null,
        subject: m.subject,
        topic: m.topic,
        type: m.link_url ? "LINK" : m.file_type,
        description: m.description || "",
        fileUrl: m.file_url,
        linkUrl: m.link_url,
        uploader: usernameById[m.uploader_id] || "pengguna",
        tags: tagLabels,
        sim,
        score: clampScore(sim + lm.boost),
        exact: lm.exact,
        strong: lm.strong,
        weak: lm.weak,
        supportsHit: null,
        supportsOnly: false,
      };
    };

    const rowById = new Map(modRows.map((m) => [m.id, m]));
    const vectorItems = modHits.map((h) => rowById.has(h.id) ? toItem(rowById.get(h.id), h.similarity) : null).filter(Boolean);
    const relevant = filterRelevant(vectorItems, MIN_SIMILARITY);
    const relevantIds = new Set(relevant.map((it) => it.id));

    const candidates = relevant.map((it) => ({ ...it, supportsHit: supportsHit.get(it.id) || null }));
    // Modul yang hanya muncul karena daftar supports_topics (tidak lolos
    // gerbang semantik): tetap boleh tampil, tetapi hanya sebagai "Fondasi".
    for (const [id, topic] of supportsHit) {
      if (relevantIds.has(id) || !rowById.has(id)) continue;
      const item = toItem(rowById.get(id), vectorItems.find((v) => v.id === id)?.sim || 0);
      candidates.push({ ...item, score: Math.max(item.score, foundationBaseScore()), supportsHit: topic, supportsOnly: true });
    }

    const forumItems = postRows.map((p) => {
      const lm = lexicalMatch(query, [p.body, p.subject, p.topic], []);
      const sim = postSim.get(p.id) || 0;
      return {
        id: p.id,
        postType: p.post_type,
        body: p.body,
        subject: p.subject,
        topic: p.topic,
        author: usernameById[p.author_id] || "pengguna",
        images: p.images || [],
        replyCount: replyCountByPost[p.id] || 0,
        reason: null,
        sim,
        score: clampScore(sim + lm.boost),
        exact: lm.exact,
        strong: lm.strong,
        weak: lm.weak,
      };
    });
    const forumRelevant = filterRelevant(forumItems, FORUM_MIN_SIMILARITY);

    // ---- 8. Tiering ---------------------------------------------------
    let tiered = tierModules(candidates);
    let llmUsed = false;
    if (USE_LLM_TIERING && AI_API_KEY) {
      const llmItems = await refineWithLlm(query, tiered);
      if (llmItems) {
        tiered = applyLlmTiers(tiered, llmItems);
        llmUsed = true;
      }
    }

    const strip = (list) =>
      list.map(({ exact, strong, weak, sim, supportsHit: _sh, supportsOnly, ...rest }) => ({
        ...rest,
        score: Math.round(rest.score * 1000) / 1000,
      }));

    return NextResponse.json({
      direct: strip(tiered.direct),
      foundational: strip(tiered.foundational),
      supporting: strip(tiered.supporting),
      applied: strip(tiered.applied),
      forum: capForum(forumRelevant).map(({ exact, strong, weak, sim, ...f }) => ({ ...f, score: Math.round(f.score * 1000) / 1000 })),
      mode: "semantic",
      llmTiering: llmUsed,
    });
  } catch (err) {
    console.error("Gagal memproses pencarian:", err);
    return NextResponse.json({ error: "Gagal memproses pencarian." }, { status: 500 });
  }
}

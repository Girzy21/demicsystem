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
//      Latihan soal (problem set) dipisah dari materi dan direkomendasikan di
//      tier "exercises": yang relevan dengan kata dicari, plus latihan soal yang
//      satu subject+topik dengan modul "direct".
//   5. (Opsional) minta LLM merapikan tier + alasan, kalau
//      SEARCH_LLM_TIERING=true di env. Kalau gagal, tier heuristik tetap dipakai.
//
// Tambahan (tahap 4):
//   - Koreksi salah ketik: kata query yang tidak ada di kosakata modul tetapi
//     sangat mirip dengan satu kata yang ada diperbaiki otomatis ("oscilation"
//     -> "oscillation"); respons membawa correctedQuery.
//   - Fondasi lebih luas: selain daftar supports_topics, dipakai embedding
//     "modul ini berguna untuk apa" (RPC match_modules_support).
//   - Diskusi lebih luas: thread yang menyebut modul hasil pencarian, atau yang
//     satu subject+topik dengan modul "direct", ikut direkomendasikan.
//
// Body : { "query": "waves" }
// Balik: { direct, foundational, exercises, supporting, applied, forum, mode, llmTiering, correctedQuery }

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
  filterSupport,
  FORUM_FILTER_OPTS,
  SUPPORT_MIN_SIMILARITY,
  matchSupportsTopic,
  foundationBaseScore,
  tierModules,
  buildExerciseTier,
  topicKey,
  applyLlmTiers,
  capForum,
  extractJsonObject,
} from "@/lib/searchRanking";
import { buildVocabulary, correctQuery } from "@/lib/searchFuzzy";

const AI_BASE_URL = process.env.AI_PROVIDER_BASE_URL || "https://api.cometapi.com/v1";
const AI_MODEL = process.env.AI_PROVIDER_MODEL || "gemini-3.8-flash";
const AI_API_KEY = process.env.AI_PROVIDER_API_KEY;
const USE_LLM_TIERING = process.env.SEARCH_LLM_TIERING === "true";
const LLM_TIMEOUT_MS = 9000;

// Pencarian memanggil embedding (+ opsional LLM); beri ruang waktu di hosting serverless.
export const maxDuration = 30;

const EMPTY = { direct: [], foundational: [], exercises: [], supporting: [], applied: [], forum: [], correctedQuery: null };

// Kosakata untuk koreksi salah ketik: kata-kata dari modul yang ada. Di-cache
// 60 detik per instance server supaya tidak membebani database tiap pencarian.
const VOCAB_TTL_MS = 60 * 1000;
let vocabCache = { at: 0, vocab: null };

async function getVocabulary() {
  if (vocabCache.vocab && Date.now() - vocabCache.at < VOCAB_TTL_MS) return vocabCache.vocab;
  try {
    const baseCols = "title, subject, topic, tags, search_keywords";
    let { data, error } = await supabaseAdmin.from("modules").select(`${baseCols}, supports_topics`).limit(3000);
    if (error && error.code === "42703") ({ data, error } = await supabaseAdmin.from("modules").select(baseCols).limit(3000));
    if (error) throw new Error(error.message);
    const texts = [];
    for (const m of data || []) {
      texts.push(m.title, m.subject, m.topic, ...toTagLabels(m.tags), ...(m.search_keywords || []), ...(m.supports_topics || []));
    }
    vocabCache = { at: Date.now(), vocab: buildVocabulary(texts) };
  } catch (err) {
    console.error("Kosakata koreksi salah ketik dilewati:", err.message);
    vocabCache = { at: Date.now(), vocab: new Map() };
  }
  return vocabCache.vocab;
}

// ---- Opsional: LLM merapikan tier + alasan ---------------------------
async function refineWithLlm(query, tiered) {
  const candidates = [...tiered.direct, ...tiered.supporting, ...tiered.applied].slice(0, 14);
  if (candidates.length === 0) return null;

  const list = candidates
    .map((m) => `- id=${m.id} | ${m.title} | ${m.subject} · ${m.topic} | tag: ${m.tags.slice(0, 5).join(", ") || "-"}`)
    .join("\n");

  const prompt = `An IB student searched for: "${query}"

Candidate modules from the Module Bank:
${list}

Assign each module to ONE tier:
- "direct": the module is actually about the searched topic
- "foundational": background/prerequisite knowledge that helps the student understand the searched topic
- "supporting": extra context that deepens understanding
- "applied": the same concept used in another subject/topic
- "skip": not relevant

Give a short "reason" (max 90 characters, in English) for every tier except "direct" (use null for "direct"). Do not invent new ids.
Reply ONLY with valid JSON: {"items":[{"id":"...","tier":"direct|foundational|supporting|applied|skip","reason":"..."}]}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
  try {
    const res = await fetch(`${AI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${AI_API_KEY}` },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [
          { role: "system", content: "You are a study-material search assistant. Always reply with valid JSON only." },
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
    const originalQuery = normalizeQuery(body.query);
    if (originalQuery.length < 2) {
      return NextResponse.json({ ...EMPTY, mode: "semantic", llmTiering: false });
    }
    if (!isEmbeddingConfigured()) {
      return NextResponse.json({ error: "Pencarian semantik belum dikonfigurasi di server." }, { status: 503 });
    }

    // Koreksi salah ketik memakai kosakata modul. Query yang sudah diperbaiki
    // dipakai untuk embedding, kecocokan kata, dan alasan hasil.
    const fix = correctQuery(originalQuery, await getVocabulary());
    const query = fix.changed ? fix.corrected : originalQuery;

    // ---- 3. Embed query ----------------------------------------------
    let queryVec;
    try {
      queryVec = await createEmbedding(query);
    } catch (err) {
      console.error("Gagal embed query pencarian:", err.message);
      return NextResponse.json({ error: "Layanan embedding sedang bermasalah." }, { status: 502 });
    }

    // ---- 4. Vector search (modul, forum, dan "berguna untuk" paralel) -----
    const [modRes, postRes, supRes] = await Promise.all([
      supabaseAdmin.rpc("match_modules", { query_embedding: queryVec, match_count: 40, min_similarity: MIN_SIMILARITY }),
      supabaseAdmin.rpc("match_posts", { query_embedding: queryVec, match_count: 15, min_similarity: FORUM_MIN_SIMILARITY }),
      supabaseAdmin.rpc("match_modules_support", { query_embedding: queryVec, match_count: 20, min_similarity: SUPPORT_MIN_SIMILARITY }),
    ]);
    if (modRes.error) {
      console.error("RPC match_modules gagal (sudah jalankan SQL migrasi?):", modRes.error);
      return NextResponse.json({ error: "Gagal mencari modul." }, { status: 500 });
    }
    if (postRes.error) console.error("RPC match_posts gagal:", postRes.error);
    // SQL tahap 4 belum dijalankan -> fungsi belum ada; fondasi semantik dilewati saja.
    if (supRes.error) console.error("RPC match_modules_support dilewati (sudah jalankan SQL tahap 4?):", supRes.error.message);

    const modHits = modRes.data || [];
    const postHits = postRes.error ? [] : postRes.data || [];
    const supHits = supRes.error ? [] : supRes.data || [];
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
    const modIds = Array.from(new Set([...modHits.map((r) => r.id), ...supHits.map((r) => r.id), ...supportsHit.keys()]));
    const MODULE_COLS = "id, title, original_title, subject, topic, description, file_type, file_url, link_url, tags, search_keywords, uploader_id, created_at";
    let modRows = [];
    if (modIds.length > 0) {
      // is_exercise baru ada setelah SQL tahap 3; sebelum itu semua dianggap materi.
      let { data, error: rowsError } = await supabaseAdmin.from("modules").select(`${MODULE_COLS}, is_exercise`).in("id", modIds);
      if (rowsError && rowsError.code === "42703") {
        ({ data } = await supabaseAdmin.from("modules").select(MODULE_COLS).in("id", modIds));
      }
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
        isExercise: !!m.is_exercise,
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
    // Latihan soal dipisah dari materi: materi masuk tier direct/foundational/
    // supporting/applied, latihan soal masuk tier "exercises".
    const materialItems = vectorItems.filter((it) => !it.isExercise);
    const exerciseItems = vectorItems.filter((it) => it.isExercise);
    const relevant = filterRelevant(materialItems, MIN_SIMILARITY);
    const relevantExercises = filterRelevant(exerciseItems, MIN_SIMILARITY);
    const relevantIds = new Set(relevant.map((it) => it.id));

    // Fondasi semantik: embedding "berguna untuk apa" cocok dengan query.
    const supportSim = new Map(
      filterSupport(
        supHits
          .filter((h) => rowById.has(h.id) && !rowById.get(h.id).is_exercise)
          .map((h) => ({ id: h.id, sim: h.similarity }))
      ).map((h) => [h.id, h.sim])
    );

    const candidates = relevant.map((it) => ({ ...it, supportsHit: supportsHit.get(it.id) || (supportSim.has(it.id) ? query : null) }));
    // Modul yang hanya muncul karena daftar supports_topics (tidak lolos
    // gerbang semantik): tetap boleh tampil, tetapi hanya sebagai "Fondasi".
    for (const [id, topic] of supportsHit) {
      if (relevantIds.has(id) || !rowById.has(id) || rowById.get(id).is_exercise) continue;
      const item = toItem(rowById.get(id), vectorItems.find((v) => v.id === id)?.sim || 0);
      candidates.push({ ...item, score: Math.max(item.score, foundationBaseScore()), supportsHit: topic, supportsOnly: true });
    }
    for (const [id, sim] of supportSim) {
      if (relevantIds.has(id) || supportsHit.has(id) || !rowById.has(id)) continue;
      const item = toItem(rowById.get(id), vectorItems.find((v) => v.id === id)?.sim || 0);
      candidates.push({ ...item, score: Math.max(foundationBaseScore(), sim), supportsHit: query, supportsOnly: true });
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
    const forumRelevant = filterRelevant(forumItems, FORUM_MIN_SIMILARITY, FORUM_FILTER_OPTS);

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

    // ---- 8b. Rekomendasi latihan soal -----------------------------------
    // Selain latihan soal yang relevan dengan kata dicari, ambil latihan soal
    // yang satu subject + topik dengan modul "direct" (mis. materi Waves ->
    // problem set Waves), walau judulnya tidak memuat kata yang diketik.
    let topicExercises = [];
    const directKeys = new Set(tiered.direct.map((m) => topicKey(m.subject, m.topic)));
    if (directKeys.size > 0) {
      try {
        const topics = Array.from(new Set(tiered.direct.map((m) => m.topic)));
        const { data: exRows, error: exError } = await supabaseAdmin
          .from("modules")
          .select(`${MODULE_COLS}, is_exercise`)
          .eq("is_exercise", true)
          .in("topic", topics)
          .limit(30);
        if (!exError) {
          const picked = (exRows || []).filter((r) => directKeys.has(topicKey(r.subject, r.topic)));
          const missingIds = Array.from(new Set(picked.map((r) => r.uploader_id))).filter((uid) => !usernameById[uid]);
          if (missingIds.length > 0) {
            const { data: extraProfs } = await supabaseAdmin.from("public_profiles").select("id, username").in("id", missingIds);
            for (const p of extraProfs || []) usernameById[p.id] = p.username;
          }
          topicExercises = picked.map((r) => toItem(r, 0));
        }
      } catch (err) {
        console.error("Pemindaian latihan soal per topik dilewati:", err.message);
      }
    }
    const exerciseTier = buildExerciseTier(relevantExercises, topicExercises, directKeys, query);

    // ---- 8c. Diskusi yang lebih luas ------------------------------------
    // Selain thread yang mirip dengan kata dicari, tampilkan thread yang (1)
    // menyebut modul yang muncul di hasil, atau (2) satu subject+topik dengan
    // modul "direct" — walau isinya tidak memuat kata yang diketik.
    const forumById = new Map(forumRelevant.map((p) => [p.id, p]));
    try {
      const moduleTitleById = new Map(
        [...tiered.direct, ...tiered.foundational, ...exerciseTier, ...tiered.supporting].map((m) => [m.id, m.title])
      );
      const FORUM_COLS = "id, post_type, body, subject, topic, images, author_id, created_at";
      const extras = [];
      if (moduleTitleById.size > 0) {
        const { data: mentionRows, error: mentionError } = await supabaseAdmin
          .from("posts")
          .select(`${FORUM_COLS}, module_id`)
          .in("module_id", Array.from(moduleTitleById.keys()))
          .limit(20);
        if (!mentionError) {
          for (const r of mentionRows || []) extras.push({ row: r, base: 0.34, reason: `Discusses "${moduleTitleById.get(r.module_id)}"` });
        }
      }
      if (directKeys.size > 0) {
        const topics = Array.from(new Set(tiered.direct.map((m) => m.topic)));
        const { data: topicRows, error: topicError } = await supabaseAdmin.from("posts").select(FORUM_COLS).in("topic", topics).limit(20);
        if (!topicError) {
          for (const r of topicRows || []) {
            if (directKeys.has(topicKey(r.subject, r.topic))) extras.push({ row: r, base: 0.28, reason: `Discussion in ${r.subject} · ${r.topic}` });
          }
        }
      }
      const newRows = extras.filter((e) => !forumById.has(e.row.id));
      if (extras.length > 0) {
        const newIds = Array.from(new Set(newRows.map((e) => e.row.id)));
        const extraReplyCount = {};
        if (newIds.length > 0) {
          const { data: rr } = await supabaseAdmin.from("replies").select("post_id").in("post_id", newIds);
          for (const r of rr || []) extraReplyCount[r.post_id] = (extraReplyCount[r.post_id] || 0) + 1;
        }
        const missingAuthors = Array.from(new Set(newRows.map((e) => e.row.author_id))).filter((uid) => !usernameById[uid]);
        if (missingAuthors.length > 0) {
          const { data: ap } = await supabaseAdmin.from("public_profiles").select("id, username").in("id", missingAuthors);
          for (const p of ap || []) usernameById[p.id] = p.username;
        }
        for (const { row, base, reason } of extras) {
          const existing = forumById.get(row.id);
          if (existing) {
            if (!existing.reason) existing.reason = reason;
            existing.score = clampScore(existing.score + 0.03);
            continue;
          }
          forumById.set(row.id, {
            id: row.id,
            postType: row.post_type,
            body: row.body,
            subject: row.subject,
            topic: row.topic,
            author: usernameById[row.author_id] || "pengguna",
            images: row.images || [],
            replyCount: extraReplyCount[row.id] || 0,
            reason,
            sim: base,
            score: base,
            exact: false,
            strong: false,
            weak: false,
          });
        }
      }
    } catch (err) {
      console.error("Perluasan diskusi dilewati:", err.message);
    }

    const strip = (list) =>
      list.map(({ exact, strong, weak, sim, supportsHit: _sh, supportsOnly, ...rest }) => ({
        ...rest,
        score: Math.round(rest.score * 1000) / 1000,
      }));

    return NextResponse.json({
      direct: strip(tiered.direct),
      foundational: strip(tiered.foundational),
      exercises: strip(exerciseTier),
      supporting: strip(tiered.supporting),
      applied: strip(tiered.applied),
      forum: capForum(Array.from(forumById.values())).map(({ exact, strong, weak, sim, ...f }) => ({ ...f, score: Math.round(f.score * 1000) / 1000 })),
      mode: "semantic",
      llmTiering: llmUsed,
      correctedQuery: fix.changed ? fix.corrected : null,
    });
  } catch (err) {
    console.error("Gagal memproses pencarian:", err);
    return NextResponse.json({ error: "Gagal memproses pencarian." }, { status: 500 });
  }
}

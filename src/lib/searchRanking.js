// lib/searchRanking.js
//
// Logika murni (tanpa database / jaringan) untuk memberi peringkat dan
// membagi hasil pencarian ke tier yang dipakai UI SearchHub:
//   direct / foundational / supporting / applied   (modul)
//   forum                                          (thread)
//
// PRINSIP "tidak terlalu luas": analisis AI sengaja luas (banyak kata
// kunci & topik terkait) supaya modul mudah DITEMUKAN, tetapi hasil yang
// DITAMPILKAN harus tetap dekat dengan kata yang diketik:
//   1. gerbang relevansi  : tanpa kecocokan kata, kemiripan vektor harus tinggi
//   2. lantai relatif     : hasil jauh di bawah skor terbaik dibuang
//   3. kata kunci tersembunyi hanya bonus kecil (bukan bukti "membahas topik ini")
//   4. "direct" hanya dari judul/subject/topik/tag/deskripsi atau skor tertinggi
//   5. hubungan "fondasi" hanya dari daftar supports_topics (bukan tebakan vektor)
//
// Dipisah dari route karena file route.js di Next.js tidak boleh
// meng-export fungsi selain handler HTTP, dan agar mudah dites.

import { tokenize, fuzzyTokenHit } from "@/lib/searchFuzzy";

export const MIN_SIMILARITY = Number(process.env.SEARCH_MIN_SIMILARITY) || 0.22;
export const FORUM_MIN_SIMILARITY = Number(process.env.SEARCH_FORUM_MIN) || 0.25;
// Skor minimum agar modul dianggap "langsung membahas topik ini".
const DIRECT_MIN = Number(process.env.SEARCH_DIRECT_MIN) || 0.3;
const DIRECT_WINDOW = 0.08;
// Tanpa kecocokan kata sama sekali, hasil harus SANGAT mirip secara makna.
const SEMANTIC_ONLY_MIN = Number(process.env.SEARCH_SEMANTIC_ONLY_MIN) || 0.34;
// Hasil dibuang kalau skornya < skor terbaik * angka ini (kecuali kecocokan persis).
const RELATIVE_FLOOR = Number(process.env.SEARCH_RELATIVE_FLOOR) || 0.7;
// Supporting/applied lebih ketat lagi.
const SUPPORT_MARGIN = 0.12;
const SUPPORT_MIN = MIN_SIMILARITY + 0.06;
// Skor "dasar" untuk modul yang muncul hanya karena daftar supports_topics.
const FOUNDATION_BASE_SCORE = 0.25;

// Modul yang embedding "berguna untuk"-nya cocok dengan query dianggap fondasi/pendukung.
export const SUPPORT_MIN_SIMILARITY = Number(process.env.SEARCH_SUPPORT_MIN) || 0.3;
const SUPPORT_RELATIVE_FLOOR = Number(process.env.SEARCH_SUPPORT_FLOOR) || 0.8;
// Diskusi sengaja lebih longgar dari modul: thread yang membahas modul hasil pencarian ikut tampil.
export const FORUM_SEMANTIC_ONLY_MIN = Number(process.env.SEARCH_FORUM_SEMANTIC_MIN) || 0.3;
const FORUM_RELATIVE_FLOOR = Number(process.env.SEARCH_FORUM_FLOOR) || 0.6;

const CAPS = { direct: 8, foundational: 8, exercises: 6, supporting: 5, applied: 4, forum: 8 };
export const TIER_KEYS = ["direct", "foundational", "supporting", "applied"];

export function normalizeQuery(q) {
  return String(q || "").replace(/\s+/g, " ").trim().slice(0, 300);
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Apakah `term` muncul di `hay`? Untuk istilah pendek (<=3 huruf, mis. "TOK",
// "IA", "CAS") wajib sebagai kata utuh, supaya "ia" tidak cocok dengan "media".
export function containsTerm(hay, term) {
  if (!hay || !term) return false;
  if (term.length <= 3) {
    return new RegExp(`(^|[^a-z0-9])${escapeRegex(term)}([^a-z0-9]|$)`, "i").test(hay);
  }
  return hay.includes(term);
}

// Kecocokan kata antara query dan teks.
//   strongFields : judul, subject, topik, tag tampilan, deskripsi
//   weakFields   : kata kunci tersembunyi buatan AI
// Mengembalikan { boost, exact, strong, weak }. "exact" hanya bisa berasal
// dari strongFields — kata kunci tersembunyi tidak cukup untuk jadi "direct".
export function lexicalMatch(query, strongFields = [], weakFields = []) {
  const q = normalizeQuery(query).toLowerCase();
  const none = { boost: 0, exact: false, strong: false, weak: false };
  if (!q) return none;
  const join = (fs) => fs.filter((f) => typeof f === "string" && f).join(" \n ").toLowerCase();
  const strongHay = join(strongFields);
  const weakHay = join(weakFields);
  const tokens = q.split(" ").filter((t) => t.length >= 4);
  const hasToken = (hay) => tokens.length > 0 && tokens.some((t) => hay.includes(t));

  if (containsTerm(strongHay, q)) return { boost: 0.1, exact: true, strong: true, weak: false };
  if (hasToken(strongHay)) return { boost: 0.05, exact: false, strong: true, weak: false };
  if (containsTerm(weakHay, q)) return { boost: 0.05, exact: false, strong: false, weak: true };
  if (hasToken(weakHay)) return { boost: 0.02, exact: false, strong: false, weak: true };

  // Toleransi salah ketik: kata query mirip kata di teks ("oscilation" ~ "oscillation").
  const qTokens = tokenize(q);
  if (qTokens.length > 0) {
    if (fuzzyTokenHit(qTokens, tokenize(strongHay))) return { boost: 0.04, exact: false, strong: true, weak: false };
    if (fuzzyTokenHit(qTokens, tokenize(weakHay))) return { boost: 0.02, exact: false, strong: false, weak: true };
  }
  return none;
}

export function clampScore(s) {
  return Math.max(0, Math.min(1, s));
}

// Apakah modul ini disebut AI sebagai fondasi/pendukung topik yang dicari?
// Mengembalikan topik yang cocok (string asli) atau null.
export function matchSupportsTopic(query, topics) {
  const q = normalizeQuery(query).toLowerCase();
  if (!q || !Array.isArray(topics)) return null;
  const qTokens = q.split(" ").filter((t) => t.length >= 4);
  for (const raw of topics) {
    if (typeof raw !== "string") continue;
    const t = raw.trim().toLowerCase();
    if (!t) continue;
    if (t === q) return raw;
    if (containsTerm(t, q)) return raw; // "gelombang" ada di "gelombang bunyi"
    if (t.length >= 4 && containsTerm(q, t)) return raw; // topik ada di dalam query
    if (qTokens.length > 0 && qTokens.every((tok) => t.includes(tok))) return raw;
  }
  return null;
}

// items: [{ id, sim, score, exact, strong, weak, ... }]
// Gerbang relevansi + lantai relatif. `minSim` = kemiripan vektor minimum.
export function filterRelevant(items, minSim = MIN_SIMILARITY, opts = {}) {
  const semanticOnlyMin = opts.semanticOnlyMin ?? SEMANTIC_ONLY_MIN;
  const relativeFloor = opts.relativeFloor ?? RELATIVE_FLOOR;
  const gated = items.filter((it) => it.sim >= minSim && (it.strong || it.weak || it.sim >= semanticOnlyMin));
  if (gated.length === 0) return [];
  const top = Math.max(...gated.map((it) => it.score));
  const floor = top * relativeFloor;
  return gated.filter((it) => it.exact || it.score >= floor);
}

// Gerbang untuk kandidat "fondasi" dari embedding "berguna untuk": kemiripan
// minimum + lantai relatif terhadap yang terbaik. items: [{ id, sim, ... }]
export function filterSupport(items) {
  const gated = (items || []).filter((it) => it.sim >= SUPPORT_MIN_SIMILARITY);
  if (gated.length === 0) return [];
  const top = Math.max(...gated.map((it) => it.sim));
  return gated.filter((it) => it.sim >= top * SUPPORT_RELATIVE_FLOOR).sort((a, b) => b.sim - a.sim).slice(0, CAPS.foundational);
}

// Pengaturan gerbang untuk diskusi forum (lebih longgar dari modul).
export const FORUM_FILTER_OPTS = { semanticOnlyMin: FORUM_SEMANTIC_ONLY_MIN, relativeFloor: FORUM_RELATIVE_FLOOR };

// items: kandidat modul yang SUDAH lolos filterRelevant, plus (opsional)
// kandidat khusus-fondasi { supportsOnly: true }. Item boleh punya
// `supportsHit` (topik yang didukung & cocok dengan query).
// Mengembalikan { direct, foundational, supporting, applied }.
export function tierModules(items) {
  const out = { direct: [], foundational: [], supporting: [], applied: [] };
  if (!items || items.length === 0) return out;

  const sorted = items.slice().sort((a, b) => b.score - a.score);
  const semantic = sorted.filter((it) => !it.supportsOnly);
  const top = semantic.length ? semantic[0].score : 0;

  const directSet = new Set();
  for (const it of semantic) {
    const nearTop = it.score >= top - DIRECT_WINDOW && it.score >= DIRECT_MIN;
    if ((nearTop || it.exact) && directSet.size < CAPS.direct) directSet.add(it.id);
  }

  const refSubjects = new Set();
  for (const it of semantic) if (directSet.has(it.id)) refSubjects.add(it.subject);
  if (refSubjects.size === 0 && semantic.length) refSubjects.add(semantic[0].subject);

  for (const it of sorted) {
    if (directSet.has(it.id)) {
      out.direct.push({ ...it, reason: null });
    } else if (it.supportsHit) {
      if (out.foundational.length < CAPS.foundational) {
        out.foundational.push({ ...it, reason: `Useful background for "${it.supportsHit}"` });
      }
    } else if (it.supportsOnly) {
      continue;
    } else if (it.score >= Math.max(SUPPORT_MIN, top - SUPPORT_MARGIN)) {
      if (refSubjects.has(it.subject)) {
        if (out.supporting.length < CAPS.supporting) {
          out.supporting.push({ ...it, reason: `Same subject (${it.subject}) and a related topic` });
        }
      } else if (out.applied.length < CAPS.applied) {
        out.applied.push({ ...it, reason: `Similar concept appears in ${it.subject} · ${it.topic}` });
      }
    }
  }
  return out;
}

// ---- Rekomendasi latihan soal (problem set) ------------------------------------------------
// Skor dasar untuk latihan soal yang muncul karena satu subject+topik dengan
// modul "direct" (bukan karena kata yang diketik).
const EXERCISE_TOPIC_SCORE = 0.3;

export function topicKey(subject, topic) {
  return `${String(subject || "").trim().toLowerCase()}||${String(topic || "").trim().toLowerCase()}`;
}

// relevant     : latihan soal yang lolos gerbang relevansi sendiri (filterRelevant)
// topicMatched : latihan soal yang satu subject+topik dengan modul "direct"
// directKeys   : Set topicKey dari modul "direct"
// Mengembalikan daftar latihan soal terurut (maks 6) lengkap dengan `reason`.
export function buildExerciseTier(relevant, topicMatched, directKeys, query) {
  const byId = new Map();
  for (const it of relevant || []) {
    const sameTopic = directKeys.has(topicKey(it.subject, it.topic));
    byId.set(it.id, {
      ...it,
      score: sameTopic ? clampScore(it.score + 0.05) : it.score,
      reason: sameTopic
        ? `Practice problems for ${it.topic} — complements the materials above`
        : `Practice problems related to "${query}"`,
    });
  }
  for (const it of topicMatched || []) {
    if (byId.has(it.id)) continue;
    byId.set(it.id, {
      ...it,
      score: Math.max(it.score, EXERCISE_TOPIC_SCORE),
      reason: `Practice problems for ${it.topic} — complements the materials above`,
    });
  }
  return Array.from(byId.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, CAPS.exercises);
}

export function foundationBaseScore() {
  return FOUNDATION_BASE_SCORE;
}

// llmItems: [{ id, tier, reason }] dari model bahasa (opsional).
// Hanya id yang dikenal yang dipakai; tier "skip" membuang item; item yang
// tidak disebut model tetap di tier heuristiknya.
export function applyLlmTiers(tiered, llmItems) {
  if (!Array.isArray(llmItems) || llmItems.length === 0) return tiered;

  const byId = new Map();
  for (const k of TIER_KEYS) for (const it of tiered[k]) byId.set(it.id, { item: it, tier: k });

  const decisions = new Map();
  for (const li of llmItems) {
    if (!li || typeof li.id !== "string" || !byId.has(li.id)) continue;
    const tier = li.tier;
    if (tier !== "skip" && !TIER_KEYS.includes(tier)) continue;
    decisions.set(li.id, {
      tier,
      reason: typeof li.reason === "string" && li.reason.trim() ? li.reason.trim().slice(0, 140) : null,
    });
  }

  const out = { direct: [], foundational: [], supporting: [], applied: [] };
  for (const [id, { item, tier }] of byId) {
    const d = decisions.get(id);
    if (!d) {
      out[tier].push(item);
      continue;
    }
    if (d.tier === "skip") continue;
    out[d.tier].push({ ...item, reason: d.tier === "direct" ? null : d.reason || item.reason });
  }
  for (const k of TIER_KEYS) {
    out[k].sort((a, b) => b.score - a.score);
    out[k] = out[k].slice(0, CAPS[k]);
  }
  return out;
}

export function capForum(items) {
  return items.slice().sort((a, b) => b.score - a.score).slice(0, CAPS.forum);
}

// Mengambil objek JSON pertama yang seimbang dari teks: tahan terhadap teks
// penalaran / code fence / komentar setelah JSON.
export function extractJsonObject(text) {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

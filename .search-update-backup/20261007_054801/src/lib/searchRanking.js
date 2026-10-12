// lib/searchRanking.js
//
// Logika murni (tanpa database / jaringan) untuk memberi peringkat dan
// membagi hasil pencarian ke tier yang dipakai UI SearchHub:
//   direct / foundational / supporting / applied   (modul)
//   forum                                          (thread)
//
// Dipisah dari route supaya mudah dites dan karena file route.js di Next.js
// tidak boleh meng-export fungsi selain handler HTTP.

// Skor kemiripan minimum agar sebuah hasil ditampilkan (cosine, 0..1).
// text-embedding-3-small: hasil relevan biasanya 0.30–0.60, tidak relevan < 0.15.
export const MIN_SIMILARITY = Number(process.env.SEARCH_MIN_SIMILARITY) || 0.22;
export const FORUM_MIN_SIMILARITY = Number(process.env.SEARCH_FORUM_MIN) || 0.25;
// Skor minimum agar modul dianggap "langsung membahas topik ini".
const DIRECT_MIN = Number(process.env.SEARCH_DIRECT_MIN) || 0.3;
// Modul dianggap "direct" kalau skornya dekat dengan modul terbaik.
const DIRECT_WINDOW = 0.08;

const CAPS = { direct: 8, foundational: 6, supporting: 6, applied: 6, forum: 6 };
export const TIER_KEYS = ["direct", "foundational", "supporting", "applied"];

export function normalizeQuery(q) {
  return String(q || "").replace(/\s+/g, " ").trim().slice(0, 300);
}

// Bonus kecil kalau kata yang diketik benar-benar muncul di teks (membantu
// singkatan seperti "TOK", "CAS", "IA" yang kurang kuat di embedding).
// Mengembalikan { boost, exact }.
export function lexicalBoost(query, fields) {
  const q = normalizeQuery(query).toLowerCase();
  if (!q) return { boost: 0, exact: false };
  const haystack = fields
    .filter((f) => typeof f === "string" && f)
    .join(" \n ")
    .toLowerCase();
  if (haystack.includes(q)) return { boost: 0.1, exact: true };
  const tokens = q.split(" ").filter((t) => t.length >= 4);
  if (tokens.length > 0 && tokens.some((t) => haystack.includes(t))) return { boost: 0.04, exact: false };
  return { boost: 0, exact: false };
}

export function clampScore(s) {
  return Math.max(0, Math.min(1, s));
}

// items: [{ id, subject, topic, score, exact, ...apapun }]
// Mengembalikan { direct, foundational, supporting, applied } — tiap tier
// berisi item yang sudah diberi `reason` (null untuk direct).
export function tierModules(items) {
  const out = { direct: [], foundational: [], supporting: [], applied: [] };
  if (!items || items.length === 0) return out;

  const sorted = items.slice().sort((a, b) => b.score - a.score);
  const top = sorted[0].score;

  const directSet = new Set();
  for (const it of sorted) {
    const nearTop = it.score >= top - DIRECT_WINDOW && it.score >= DIRECT_MIN;
    if ((nearTop || it.exact) && directSet.size < CAPS.direct) directSet.add(it.id);
  }

  const refSubjects = new Set();
  for (const it of sorted) if (directSet.has(it.id)) refSubjects.add(it.subject);
  if (refSubjects.size === 0) refSubjects.add(sorted[0].subject);

  for (const it of sorted) {
    if (directSet.has(it.id)) {
      out.direct.push({ ...it, reason: null });
    } else if (refSubjects.has(it.subject)) {
      if (out.supporting.length < CAPS.supporting) {
        out.supporting.push({ ...it, reason: `Masih satu subject (${it.subject}) dan topiknya berkaitan` });
      }
    } else if (out.applied.length < CAPS.applied) {
      out.applied.push({ ...it, reason: `Konsep serupa muncul di ${it.subject} · ${it.topic}` });
    }
  }
  return out;
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

// Mengambil objek JSON pertama yang seimbang dari teks (sama polanya dengan
// extractJson di suggest-tags): tahan terhadap teks penalaran / code fence.
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

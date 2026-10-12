// lib/moduleTagging.js
//
// Analisis AI untuk satu modul (dipakai oleh POST /api/modules/[id]/suggest-tags
// dan oleh endpoint admin retag-modules untuk modul lama). Satu panggilan LLM
// menghasilkan:
//   1. tags            : maks 5 tag singkat yang DITAMPILKAN ke pengguna
//   2. search_keywords : frasa yang benar-benar akan diketik siswa untuk
//                        mencari modul INI (tersembunyi, urut dari paling mungkin)
//   3. supports_topics : topik lain yang materi ini menjadi FONDASI/pendukung
//                        langsung (mis. trigonometri -> gelombang). Dipakai tier
//                        "Fondasi" di pencarian.
//   4. suggested_title : usulan judul — HANYA bila isi file dibaca dengan izin
//                        uploader, dan HANYA bila judul belum pernah diubah.
//   5. is_exercise     : apakah modul ini latihan soal (problem set) atau materi.
//                        Uploader memilih saat upload; AI boleh menyesuaikan bila
//                        yakin (kepercayaan >= 0.75), kecuali pemilik sudah
//                        mengubahnya manual (exercise_set_by = 'user_edit').
//
// Analisis sengaja kaya supaya modul mudah ditemukan, tetapi kualitas dijaga:
// kata kunci dibatasi, kata generik dibuang, dan pencarian sendiri memakai
// gerbang relevansi ketat (lihat lib/searchRanking.js).
//
// Env: AI_PROVIDER_BASE_URL / AI_PROVIDER_API_KEY / AI_PROVIDER_MODEL (CometAPI).

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { embedModule, toTagLabels } from "@/lib/embeddings";
import { extractJsonObject, containsTerm } from "@/lib/searchRanking";

const AI_BASE_URL = process.env.AI_PROVIDER_BASE_URL || "https://api.cometapi.com/v1";
const AI_MODEL = process.env.AI_PROVIDER_MODEL || "gemini-3.8-flash";
const AI_API_KEY = process.env.AI_PROVIDER_API_KEY;

export const MAX_SUGGESTED_TAGS = 5;
export const MAX_SEARCH_KEYWORDS = 12;
export const MAX_SUPPORTS_TOPICS = 6;
const MAX_FILE_EXCERPT_CHARS = 6000;
// AI hanya boleh membalik jenis materi <-> latihan soal kalau cukup yakin.
export const EXERCISE_FLIP_MIN_CONFIDENCE = 0.75;

// Kata terlalu umum — tidak membantu membedakan satu modul dari modul lain.
const GENERIC_WORDS = new Set([
  "physics", "fisika", "math", "maths", "mathematics", "matematika", "biology", "biologi", "chemistry", "kimia",
  "economics", "ekonomi", "history", "sejarah", "english", "tok", "cas", "ib", "study", "belajar", "materi",
  "modul", "module", "pelajaran", "notes", "catatan", "file", "pdf", "document", "dokumen", "ringkasan", "summary",
  "latihan", "soal", "tugas", "pembelajaran", "learning",
]);

function wordCount(s) {
  return s.split(/\s+/).filter(Boolean).length;
}

// Membersihkan daftar frasa dari model: huruf kecil, unik, tidak kosong,
// pendek, bukan kata generik, bukan sama dengan subject modul.
export function cleanPhrases(list, { max, maxWords, maxChars = 48, exclude = [] }) {
  if (!Array.isArray(list)) return [];
  const blocked = new Set(exclude.map((e) => String(e || "").trim().toLowerCase()).filter(Boolean));
  const seen = new Set();
  const out = [];
  for (const item of list) {
    if (typeof item !== "string") continue;
    const p = item.trim().toLowerCase().replace(/\s+/g, " ");
    if (!p || p.length > maxChars || wordCount(p) > maxWords) continue;
    if (GENERIC_WORDS.has(p) || blocked.has(p) || seen.has(p)) continue;
    seen.add(p);
    out.push(p);
    if (out.length >= max) break;
  }
  return out;
}

function buildPrompt({ title, description, subject, topic, fileExcerpt, allowTitle, exerciseKnown, currentIsExercise }) {
  const fileSection = fileExcerpt
    ? `\n\nCuplikan isi file (uploader mengizinkan ini dibaca untuk klasifikasi lebih akurat):\n"""\n${fileExcerpt}\n"""`
    : "";

  const titleInstruction =
    allowTitle && fileExcerpt
      ? `Kalau JUDUL yang diberikan kurang deskriptif dibanding isi file sebenarnya (terlalu umum, typo, atau tidak mencerminkan isi), sarankan judul baru yang lebih akurat lewat "suggested_title". Kalau judul sudah cukup baik, isi null — jangan mengubah judul yang sudah bagus hanya demi berbeda.`
      : `Selalu isi "suggested_title" dengan null.`;

  return `Kamu membantu platform akademik IB (International Baccalaureate) agar modul belajar mudah dicari siswa dengan TEPAT.

Informasi modul:
- Judul: ${title}
- Subject: ${subject}
- Topik: ${topic}
- Deskripsi: ${description || "(tidak ada deskripsi)"}
- Jenis yang dipilih uploader: ${exerciseKnown ? (currentIsExercise ? "latihan soal (problem set)" : "materi belajar") : "(tidak diketahui)"}${fileSection}

Hasilkan lima hal:

1. "tags": maksimal ${MAX_SUGGESTED_TAGS} tag singkat (1-3 kata) yang DITAMPILKAN ke pengguna. Pilih konsep/sub-topik SPESIFIK yang memang dibahas modul ini, dalam kata yang biasa dipakai siswa — bukan sekadar mengulang subject/topik.

2. "search_keywords": maksimal ${MAX_SEARCH_KEYWORDS} frasa yang BENAR-BENAR akan diketik siswa saat mencari modul INI. Aturan ketat:
   - 1-4 kata per frasa, tulis seperti orang mengetik di kolom pencarian (boleh Indonesia atau Inggris, singkatan umum, ejaan populer).
   - Urutkan dari yang PALING mungkin diketik ke yang kurang.
   - Hanya hal yang modul ini sendiri bahas. JANGAN masukkan topik tetangga atau topik yang cuma "berhubungan" (itu masuk ke nomor 3).
   - JANGAN masukkan kata umum seperti nama subject saja ("physics", "math"), "materi", "modul", "belajar", "ringkasan", "soal".

3. "supports_topics": maksimal ${MAX_SUPPORTS_TOPICS} topik LAIN yang materi ini menjadi prasyarat/fondasi/alat langsung. Contoh: modul trigonometri -> ["gelombang", "osilasi", "arus bolak-balik"]; modul kalkulus diferensial -> ["kinematika", "optimisasi"]. Aturan: 1-4 kata per topik, tulis dalam Bahasa Indonesia dan/atau Inggris yang biasa dipakai siswa, hanya ketergantungan yang NYATA dan langsung, dan jangan sebut topik modul ini sendiri. Kalau tidak ada, isi array kosong [].

4. "suggested_title": ${titleInstruction}

5. "is_exercise" + "exercise_confidence": tentukan apakah modul ini LATIHAN SOAL — yaitu terutama berisi kumpulan soal untuk dikerjakan (problem set, worksheet, past paper, kuis, soal latihan dengan atau tanpa pembahasan) — atau MATERI (penjelasan, ringkasan, catatan, slide, panduan). Isi true/false dan tingkat keyakinan 0.0-1.0. Dokumen penjelasan yang hanya menyisipkan beberapa contoh soal tetap MATERI. Kalau ragu, pertahankan jenis yang dipilih uploader dan beri keyakinan rendah.

Jawab HANYA dengan JSON valid, tanpa teks lain, format persis:
{"tags": [{"label": "nama tag", "confidence": 0.0-1.0}], "search_keywords": ["frasa1", "frasa2"], "supports_topics": ["topik1"], "suggested_title": "judul baru atau null", "is_exercise": true, "exercise_confidence": 0.0-1.0}`;
}

// Ekstrak teks dari file — HANYA dipanggil kalau uploader mengizinkan DAN
// modul memang file (bukan link). Mendukung PDF dan TXT.
async function extractFileText(fileUrl, fileType) {
  const type = (fileType || "").toUpperCase();
  try {
    if (type === "TXT") {
      const res = await fetch(fileUrl);
      if (!res.ok) return null;
      return (await res.text()).slice(0, MAX_FILE_EXCERPT_CHARS);
    }
    if (type === "PDF") {
      const res = await fetch(fileUrl);
      if (!res.ok) return null;
      const buffer = Buffer.from(await res.arrayBuffer());
      const pdfParse = (await import("pdf-parse")).default;
      const parsed = await pdfParse(buffer);
      return (parsed.text || "").slice(0, MAX_FILE_EXCERPT_CHARS);
    }
    return null;
  } catch (err) {
    console.error("Gagal mengekstrak teks file untuk AI:", err.message);
    return null;
  }
}

async function callAi(prompt, maxTokens) {
  const res = await fetch(`${AI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${AI_API_KEY}` },
    body: JSON.stringify({
      model: AI_MODEL,
      messages: [
        { role: "system", content: "Kamu adalah asisten yang menganalisis materi belajar agar mudah dicari. Selalu jawab dengan JSON valid saja, tanpa penjelasan tambahan." },
        { role: "user", content: prompt },
      ],
      temperature: 0.3,
      max_tokens: maxTokens,
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`AI provider error ${res.status}: ${errText.slice(0, 300)}`);
  }
  const result = await res.json();
  return result?.choices?.[0]?.message?.content || "";
}

// Menjalankan analisis penuh untuk satu modul dan menyimpan hasilnya.
// Mengembalikan { ok: true, data } atau { ok: false, status, error, skipped? }.
//   allowTitleChange : false untuk analisis ulang massal (jangan ubah judul
//                      modul lama tanpa sepengetahuan uploader)
export async function runModuleTagging(moduleId, { allowTitleChange = true } = {}) {
  if (!AI_API_KEY) {
    console.error("AI_PROVIDER_API_KEY belum diset — melewati analisis AI.");
    return { ok: true, data: { skipped: true, reason: "AI provider not configured" } };
  }

  const baseCols = "id, title, description, subject, topic, tags, allow_ai_file_read, file_url, file_type, link_url, original_title, search_keywords";
  // Kolom baru bertahap: supports_topics (SQL tahap 2) dan is_exercise (SQL tahap 3).
  // Kalau belum ada, tetap jalan tanpa fitur terkait, tidak error.
  const attempts = [
    { cols: `${baseCols}, supports_topics, is_exercise, exercise_set_by`, supports: true, exercise: true },
    { cols: `${baseCols}, supports_topics`, supports: true, exercise: false },
    { cols: baseCols, supports: false, exercise: false },
  ];
  let mod = null;
  let fetchError = null;
  let hasNewColumns = false;
  let hasExerciseColumns = false;
  for (const attempt of attempts) {
    const r = await supabaseAdmin.from("modules").select(attempt.cols).eq("id", moduleId).single();
    mod = r.data;
    fetchError = r.error;
    if (!r.error || r.error.code !== "42703") {
      hasNewColumns = attempt.supports;
      hasExerciseColumns = attempt.exercise;
      break;
    }
  }
  if (fetchError || !mod) return { ok: false, status: 404, error: "Modul tidak ditemukan." };

  // Isi file hanya dibaca bila uploader menyetujui DAN ini modul file.
  let fileExcerpt = null;
  if (mod.allow_ai_file_read && mod.file_url) {
    fileExcerpt = await extractFileText(mod.file_url, mod.file_type);
  }

  // Judul hanya boleh disarankan AI kalau belum pernah berubah (original_title
  // kosong) — supaya judul yang sudah diedit pengguna tidak ditimpa lagi.
  const allowTitle = allowTitleChange && !mod.original_title;
  const prompt = buildPrompt({
    ...mod,
    fileExcerpt,
    allowTitle,
    exerciseKnown: hasExerciseColumns,
    currentIsExercise: !!mod.is_exercise,
  });

  let rawContent;
  try {
    rawContent = await callAi(prompt, 1500);
  } catch (err) {
    console.error("AI provider error:", err.message);
    return { ok: false, status: 502, error: "Gagal menghubungi layanan AI." };
  }
  let jsonStr = extractJsonObject(rawContent);
  if (!jsonStr) {
    // JSON terpotong (model menghabiskan token untuk "berpikir") — ulangi sekali dengan anggaran lebih besar.
    try {
      rawContent = await callAi(prompt, 3000);
      jsonStr = extractJsonObject(rawContent);
    } catch (err) {
      console.error("AI provider error on retry:", err.message);
    }
  }
  if (!jsonStr) {
    console.error("Gagal mengekstrak JSON dari respons AI:", rawContent);
    return { ok: false, status: 502, error: "Respons AI tidak valid atau terpotong." };
  }
  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    console.error("Gagal parse respons AI sebagai JSON:", jsonStr);
    return { ok: false, status: 502, error: "Respons AI tidak valid." };
  }

  // ---- tags tampilan (tag manual tidak pernah disentuh) ------------
  const aiTags = (Array.isArray(parsed.tags) ? parsed.tags : [])
    .filter((t) => t && typeof t.label === "string" && t.label.trim())
    .slice(0, MAX_SUGGESTED_TAGS)
    .map((t) => ({
      label: t.label.trim(),
      source: "ai",
      confidence: typeof t.confidence === "number" ? Math.max(0, Math.min(1, t.confidence)) : 0.5,
    }));
  const existingTags = mod.tags || [];
  const existingLabelsLower = new Set(toTagLabels(existingTags).map((l) => l.toLowerCase()));
  const newAiTags = aiTags.filter((t) => !existingLabelsLower.has(t.label.toLowerCase()));
  const mergedTags = [...existingTags, ...newAiTags];

  // ---- kata kunci pencarian & topik yang didukung ---------------------
  const selfNames = [mod.subject, mod.topic, mod.title];
  const keywords = cleanPhrases(parsed.search_keywords, {
    max: MAX_SEARCH_KEYWORDS,
    maxWords: 4,
    exclude: [mod.subject],
  });
  // Topik yang didukung tidak boleh topik modul itu sendiri: buang frasa yang
  // sudah termuat di judul/topik/subject modul (mis. modul "Trigonometri Dasar"
  // tidak boleh "mendukung" trigonometri).
  const selfHay = selfNames.map((n) => String(n || "").toLowerCase()).join(" \n ");
  const supportsTopics = cleanPhrases(parsed.supports_topics, {
    max: MAX_SUPPORTS_TOPICS + 4,
    maxWords: 4,
    exclude: selfNames,
  })
    .filter((p) => !containsTerm(selfHay, p))
    .slice(0, MAX_SUPPORTS_TOPICS);

  // ---- judul (hanya bila isi file dibaca & belum pernah diubah) -------
  let titleUpdate = {};
  let titleChanged = false;
  const suggestedTitle = typeof parsed.suggested_title === "string" ? parsed.suggested_title.trim() : null;
  if (allowTitle && fileExcerpt && suggestedTitle && suggestedTitle.toLowerCase() !== (mod.title || "").trim().toLowerCase()) {
    titleUpdate = { title: suggestedTitle, original_title: mod.original_title || mod.title };
    titleChanged = true;
  }

  // ---- jenis modul: materi <-> latihan soal --------------------------------------------
  // AI hanya boleh membalik jenisnya bila cukup yakin dan pemilik belum
  // mengubahnya manual.
  let exerciseChanged = false;
  let finalIsExercise = !!mod.is_exercise;
  const aiIsExercise = typeof parsed.is_exercise === "boolean" ? parsed.is_exercise : null;
  const aiExerciseConfidence = typeof parsed.exercise_confidence === "number" ? Math.max(0, Math.min(1, parsed.exercise_confidence)) : 0;
  const exerciseUpdate = {};
  if (
    hasExerciseColumns &&
    aiIsExercise !== null &&
    aiIsExercise !== finalIsExercise &&
    aiExerciseConfidence >= EXERCISE_FLIP_MIN_CONFIDENCE &&
    mod.exercise_set_by !== "user_edit"
  ) {
    exerciseUpdate.is_exercise = aiIsExercise;
    exerciseUpdate.exercise_set_by = "ai";
    exerciseChanged = true;
    finalIsExercise = aiIsExercise;
  }

  const update = { tags: mergedTags, search_keywords: keywords, ...titleUpdate, ...exerciseUpdate };
  if (hasNewColumns) {
    update.supports_topics = supportsTopics;
    update.ai_analyzed_at = new Date().toISOString();
  }
  const { error: updateError } = await supabaseAdmin.from("modules").update(update).eq("id", moduleId);
  if (updateError) {
    console.error("Gagal menyimpan hasil analisis AI:", updateError);
    return { ok: false, status: 500, error: "Gagal menyimpan tag." };
  }

  // Embed ulang dengan tag + kata kunci + judul terbaru (tidak pernah melempar error).
  await embedModule(moduleId);

  return {
    ok: true,
    data: {
      tags: mergedTags,
      addedCount: newAiTags.length,
      titleChanged,
      newTitle: titleChanged ? suggestedTitle : null,
      searchKeywords: keywords,
      supportsTopics,
      exerciseChanged,
      isExercise: finalIsExercise,
    },
  };
}

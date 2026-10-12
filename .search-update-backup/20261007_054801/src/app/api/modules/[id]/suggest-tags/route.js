// API route: POST /api/modules/[id]/suggest-tags
//
// Calls an LLM (via CometAPI, an OpenAI-compatible gateway) to suggest:
//   1. A small set of display tags (shown in the UI)
//   2. A much larger, hidden set of search_keywords (never shown in the
//      UI — purely for improving internal search recall)
//   3. Only when the uploader consented (modules.allow_ai_file_read =
//      true, set via the strict 5-second consent modal at upload time)
//      AND the module is a file (never a link — links never go through
//      file content analysis at all), a possible title improvement
//
// This is deliberately a SEPARATE call from the upload itself (POST
// /api/modules), fired in the background after upload succeeds — a slow or
// failed AI call should never block or break the upload flow for the
// person uploading. Suggested tags are appended with source: "ai" and a
// confidence score, alongside whatever source: "manual" tags already
// exist; nothing here ever overwrites or removes manual tags. Per the
// human-in-the-loop design, tags are always proposals reviewed later from
// the admin page — but per explicit instruction, a title change IS
// applied automatically, with the original preserved and a dismissible
// notification shown, rather than requiring upfront confirmation.
//
// AI_PROVIDER_BASE_URL / AI_PROVIDER_API_KEY / AI_PROVIDER_MODEL are read
// from environment variables specifically so switching providers or
// models later (e.g. when gemini-3.8-flash is eventually retired) is a
// config change, not a code change.
//
// TAMBAHAN (pencarian semantik): setelah tag, search_keywords, dan judul
// tersimpan, modul di-embed ulang supaya vektornya ikut memuat kata kunci
// tersembunyi tersebut — inilah yang membuat pencarian "gelombang" bisa
// menemukan modul "Waves & Oscillation".

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { embedModule, toTagLabels } from "@/lib/embeddings";

const AI_BASE_URL = process.env.AI_PROVIDER_BASE_URL || "https://api.cometapi.com/v1";
const AI_MODEL = process.env.AI_PROVIDER_MODEL || "gemini-3.8-flash";
const AI_API_KEY = process.env.AI_PROVIDER_API_KEY;

const MAX_SUGGESTED_TAGS = 5;
// search_keywords is intentionally allowed to be much larger than the
// display tags — it's never shown in the UI, so there's no "looks
// cluttered" concern, only "does it help search recall". More
// comprehensive coverage here directly improves future search accuracy.
const MAX_SEARCH_KEYWORDS = 25;
// Caps how much file text gets sent to the AI — keeps token cost bounded
// regardless of how large the source PDF/TXT is, and a few thousand
// characters is already far more context than title+description alone.
const MAX_FILE_EXCERPT_CHARS = 6000;

function buildPrompt({ title, description, subject, topic, fileExcerpt }) {
  const fileSection = fileExcerpt
    ? `\n\nCuplikan isi file (uploader mengizinkan ini dibaca untuk klasifikasi lebih akurat):\n"""\n${fileExcerpt}\n"""`
    : "";

  // Only ask the model to propose a title rewrite when it actually has the
  // file's own content to go on — suggesting a "better" title based on
  // nothing but the title/description the uploader already typed would be
  // circular (the model has no more information than the uploader did) and
  // risks confidently rewriting a perfectly fine title for no real reason.
  const titleInstruction = fileExcerpt
    ? `\n- Kalau JUDUL yang diberikan kurang deskriptif dibanding isi file sebenarnya (terlalu umum, typo, atau tidak mencerminkan isi), sarankan judul baru yang lebih akurat lewat field "suggested_title". Kalau judul yang ada sudah cukup baik, isi "suggested_title" dengan null — jangan mengubah judul yang sudah bagus hanya demi berbeda.`
    : `\n- Jangan isi "suggested_title" (selalu null) — tidak ada isi file untuk dibandingkan dengan judul yang ada.`;

  return `Kamu membantu memberi tag topik untuk modul belajar di sebuah platform akademik IB (International Baccalaureate).

Informasi modul:
- Judul: ${title}
- Subject: ${subject}
- Topik: ${topic}
- Deskripsi: ${description || "(tidak ada deskripsi)"}${fileSection}

Tugas kamu ada tiga:

1. Sarankan maksimal ${MAX_SUGGESTED_TAGS} tag singkat (1-3 kata masing-masing) untuk DITAMPILKAN ke pengguna — tag yang menggambarkan konsep atau sub-topik SPESIFIK yang kemungkinan dibahas modul ini, bukan sekadar mengulang subject/topik yang sudah ada. Contoh gaya tag yang baik: "resonance", "doppler effect", "titration curve", "supply and demand".

2. Buat daftar "search_keywords" yang JAUH lebih lengkap dan komprehensif (sampai ${MAX_SEARCH_KEYWORDS} kata/frasa) — ini TIDAK ditampilkan ke pengguna, murni dipakai di belakang layar supaya pencarian lebih akurat. Sertakan sinonim, istilah terkait, singkatan umum, istilah dalam Bahasa Inggris DAN Indonesia kalau relevan, serta variasi cara orang mungkin mengetik pencarian untuk topik ini (termasuk yang tidak eksplisit disebut di judul/deskripsi tapi secara akademik berkaitan erat).${titleInstruction}

Jawab HANYA dengan JSON valid, tanpa teks lain, dengan format persis:
{"tags": [{"label": "nama tag", "confidence": 0.0-1.0}, ...], "search_keywords": ["kata1", "kata2", ...], "suggested_title": "judul baru atau null"}`;
}

// Extracts plain text from a file URL for AI analysis — ONLY called when
// the uploader consented AND the module has a real file_url (never for
// links). Supports PDF and TXT for now; other file types return null and
// the prompt simply falls back to title/description/tags only, same as
// if consent had never been given.
async function extractFileText(fileUrl, fileType) {
  const type = (fileType || "").toUpperCase();
  try {
    if (type === "TXT") {
      const res = await fetch(fileUrl);
      if (!res.ok) return null;
      const text = await res.text();
      return text.slice(0, MAX_FILE_EXCERPT_CHARS);
    }
    if (type === "PDF") {
      const res = await fetch(fileUrl);
      if (!res.ok) return null;
      const buffer = Buffer.from(await res.arrayBuffer());
      // Lazy import — pdf-parse pulls in some weight, no reason to load it
      // for every request when most modules won't have file-read consent.
      const pdfParse = (await import("pdf-parse")).default;
      const parsed = await pdfParse(buffer);
      return (parsed.text || "").slice(0, MAX_FILE_EXCERPT_CHARS);
    }
    return null; // DOCX/PPTX/etc — not supported yet, falls back gracefully
  } catch (err) {
    console.error("Gagal mengekstrak teks file untuk AI:", err.message);
    return null; // extraction failure is not fatal — just skip the file excerpt
  }
}

export async function POST(request, { params }) {
  try {
    const { id } = await params;

    if (!AI_API_KEY) {
      // Not the uploader's problem — this is a server config issue. Fails
      // quietly since this endpoint is called in the background and
      // shouldn't surface a scary error to whoever's session triggered it.
      console.error("AI_PROVIDER_API_KEY belum diset — melewati saran tag AI.");
      return NextResponse.json({ skipped: true, reason: "AI provider not configured" });
    }

    // ---- 1. Verify caller (must be logged in, but doesn't have to be the
    // module's uploader — this may run as a background job triggered right
    // after upload, by the same session that just uploaded it) ----
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

    // ---- 2. Load the module's text fields ----------------------------
    const { data: mod, error: fetchError } = await supabaseAdmin
      .from("modules")
      .select("id, title, description, subject, topic, tags, allow_ai_file_read, file_url, file_type, link_url, original_title, search_keywords")
      .eq("id", id)
      .single();

    if (fetchError || !mod) {
      return NextResponse.json({ error: "Modul tidak ditemukan." }, { status: 404 });
    }

    // File content is only ever read when BOTH conditions hold: the
    // uploader explicitly consented, AND this is a file-based module
    // (mod.file_url set). Link-based modules (mod.link_url set) never
    // reach this branch at all — there's no file to read, and consent
    // is never even collected for links in the first place.
    let fileExcerpt = null;
    if (mod.allow_ai_file_read && mod.file_url) {
      fileExcerpt = await extractFileText(mod.file_url, mod.file_type);
    }

    // ---- 3. Call the AI provider ----------------------------
    // max_tokens is generous on purpose: Gemini 3-series models can spend a
    // meaningful chunk of the token budget on internal reasoning before
    // producing the actual JSON, so a tight budget risks the visible
    // output getting cut off mid-array.
    async function callAi(maxTokens) {
      const res = await fetch(`${AI_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${AI_API_KEY}`,
        },
        body: JSON.stringify({
          model: AI_MODEL,
          messages: [
            { role: "system", content: "Kamu adalah asisten yang memberi tag topik untuk materi belajar. Selalu jawab dengan JSON valid saja, tanpa penjelasan tambahan." },
            { role: "user", content: buildPrompt({ ...mod, fileExcerpt }) },
          ],
          temperature: 0.3,
          max_tokens: maxTokens,
        }),
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`AI provider error ${res.status}: ${errText}`);
      }
      const result = await res.json();
      return result?.choices?.[0]?.message?.content || "";
    }

    // Finds the first balanced {...} object in a string by counting brace
    // depth, rather than assuming the whole string is clean JSON or that
    // any markdown fences present are complete. This tolerates reasoning
    // text before the JSON, incomplete/missing code fences, and trailing
    // commentary after the JSON.
    function extractJson(text) {
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
      return null; // never closed — truncated output
    }

    let rawContent;
    try {
      rawContent = await callAi(1200);
    } catch (err) {
      console.error("AI provider error:", err.message);
      return NextResponse.json({ error: "Gagal menghubungi layanan AI." }, { status: 502 });
    }

    let jsonStr = extractJson(rawContent);

    // If the JSON never closed (truncated), retry once with a larger
    // budget before giving up.
    if (!jsonStr) {
      try {
        rawContent = await callAi(2500);
        jsonStr = extractJson(rawContent);
      } catch (err) {
        console.error("AI provider error on retry:", err.message);
      }
    }

    if (!jsonStr) {
      console.error("Gagal mengekstrak JSON dari respons AI (kemungkinan terpotong):", rawContent);
      return NextResponse.json({ error: "Respons AI tidak valid atau terpotong." }, { status: 502 });
    }

    let parsed;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (parseErr) {
      console.error("Gagal parse respons AI sebagai JSON:", jsonStr);
      return NextResponse.json({ error: "Respons AI tidak valid." }, { status: 502 });
    }

    const suggestedTags = Array.isArray(parsed.tags) ? parsed.tags : [];
    const aiTags = suggestedTags
      .filter((t) => t && typeof t.label === "string" && t.label.trim())
      .slice(0, MAX_SUGGESTED_TAGS)
      .map((t) => ({
        label: t.label.trim(),
        source: "ai",
        confidence: typeof t.confidence === "number" ? Math.max(0, Math.min(1, t.confidence)) : 0.5,
      }));

    // ---- 4. Merge with existing tags (manual tags untouched) ----------
    // toTagLabels() membaca label dari objek maupun string, jadi
    // pengecekan duplikat tetap benar apa pun bentuk tag yang tersimpan.
    const existingTags = mod.tags || [];
    const existingLabelsLower = new Set(toTagLabels(existingTags).map((l) => l.toLowerCase()));
    const newAiTags = aiTags.filter((t) => !existingLabelsLower.has(t.label.toLowerCase()));
    const mergedTags = [...existingTags, ...newAiTags];

    // ---- 5. Merge search_keywords (hidden — never rendered in the UI,
    // exists purely to widen what search queries can match this module) ----
    const suggestedKeywords = Array.isArray(parsed.search_keywords) ? parsed.search_keywords : [];
    const cleanedKeywords = suggestedKeywords
      .filter((k) => typeof k === "string" && k.trim())
      .map((k) => k.trim().toLowerCase())
      .slice(0, MAX_SEARCH_KEYWORDS);
    const existingKeywords = mod.search_keywords || [];
    const mergedKeywords = Array.from(new Set([...existingKeywords, ...cleanedKeywords]));

    // ---- 6. Apply title suggestion, only if a file was actually read.
    // The prompt itself already tells the model not to propose a title
    // without file content, but this check is the actual enforcement
    // point — never trust the model's adherence to prompt instructions
    // alone for something that changes user-visible data. Also skip if
    // the "new" title is trivially the same as the old one.
    let titleUpdate = {};
    let titleChanged = false;
    const suggestedTitle = typeof parsed.suggested_title === "string" ? parsed.suggested_title.trim() : null;
    if (fileExcerpt && suggestedTitle && suggestedTitle.toLowerCase() !== (mod.title || "").trim().toLowerCase()) {
      titleUpdate = {
        title: suggestedTitle,
        // Only set original_title the FIRST time it changes — preserves
        // the true original even if a module somehow gets re-tagged twice.
        original_title: mod.original_title || mod.title,
      };
      titleChanged = true;
    }

    const { error: updateError } = await supabaseAdmin
      .from("modules")
      .update({ tags: mergedTags, search_keywords: mergedKeywords, ...titleUpdate })
      .eq("id", id);

    if (updateError) {
      console.error("Gagal menyimpan tag AI:", updateError);
      return NextResponse.json({ error: "Gagal menyimpan tag." }, { status: 500 });
    }

    // ---- 7. Embed ulang modul dengan tag + kata kunci + judul terbaru ----
    // Tidak pernah melempar error; kegagalan di sini tidak mengubah hasil
    // saran tag yang sudah tersimpan.
    await embedModule(id);

    return NextResponse.json({
      tags: mergedTags,
      addedCount: newAiTags.length,
      titleChanged,
      newTitle: titleChanged ? suggestedTitle : null,
    });
  } catch (err) {
    console.error("Gagal memproses saran tag AI:", err);
    return NextResponse.json({ error: "Gagal memproses saran tag." }, { status: 500 });
  }
}

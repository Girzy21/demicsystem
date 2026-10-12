// lib/embeddings.js
//
// Semua urusan text-embedding ada di sini, supaya route lain cukup
// memanggil embedModule() / embedForumPost() / createEmbedding().
//
// Provider: CometAPI (OpenAI-compatible) -> POST {AI_PROVIDER_BASE_URL}/embeddings
// Model   : text-embedding-3-small (1536 dimensi) — bisa diganti lewat env
//           AI_EMBEDDING_MODEL. KALAU model diganti ke dimensi lain, kolom
//           vector(1536) di database juga harus diubah (lihat sql/).
//
// Env yang dipakai (AI_PROVIDER_* sudah ada dari fitur suggest-tags):
//   AI_PROVIDER_BASE_URL   default https://api.cometapi.com/v1
//   AI_PROVIDER_API_KEY    wajib
//   AI_EMBEDDING_MODEL     default text-embedding-3-small

import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const EMBEDDING_DIM = 1536;

const AI_BASE_URL = process.env.AI_PROVIDER_BASE_URL || "https://api.cometapi.com/v1";
const AI_API_KEY = process.env.AI_PROVIDER_API_KEY;
const EMBEDDING_MODEL = process.env.AI_EMBEDDING_MODEL || "text-embedding-3-small";

// Batas karakter teks yang dikirim ke model. Model menerima ~8191 token;
// 6000 karakter jauh di bawah itu bahkan untuk teks Indonesia.
const MAX_EMBED_CHARS = 6000;
const MAX_REPLIES_IN_THREAD_TEXT = 12;
const MAX_REPLY_CHARS = 400;
const MAX_KEYWORDS_IN_VECTOR = 8;

export function isEmbeddingConfigured() {
  return !!AI_API_KEY;
}

// ---------------------------------------------------------------------
// Panggilan ke API embedding
// ---------------------------------------------------------------------

// Menerima array teks -> mengembalikan array vektor (urutan sama).
// Satu request bisa membawa banyak teks sekaligus (dipakai backfill).
export async function createEmbeddings(texts) {
  if (!AI_API_KEY) throw new Error("AI_PROVIDER_API_KEY belum diset.");
  const inputs = texts.map((t) => String(t || "").trim().slice(0, MAX_EMBED_CHARS) || " ");

  const body = { model: EMBEDDING_MODEL, input: inputs, encoding_format: "float" };
  // Parameter "dimensions" hanya didukung model text-embedding-3-*.
  if (/text-embedding-3/.test(EMBEDDING_MODEL)) body.dimensions = EMBEDDING_DIM;

  const res = await fetch(`${AI_BASE_URL}/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${AI_API_KEY}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Embedding provider error ${res.status}: ${errText.slice(0, 300)}`);
  }
  const json = await res.json();
  const rows = (json.data || []).slice().sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  if (rows.length !== inputs.length) {
    throw new Error(`Jumlah embedding (${rows.length}) tidak sama dengan jumlah input (${inputs.length}).`);
  }
  return rows.map((r) => {
    if (!Array.isArray(r.embedding) || r.embedding.length !== EMBEDDING_DIM) {
      throw new Error(
        `Dimensi embedding ${r.embedding?.length} tidak sama dengan ${EMBEDDING_DIM}. Cek AI_EMBEDDING_MODEL dan kolom vector di database.`
      );
    }
    return r.embedding;
  });
}

export async function createEmbedding(text) {
  const [vec] = await createEmbeddings([text]);
  return vec;
}

// ---------------------------------------------------------------------
// Penyusun teks yang di-embed
// ---------------------------------------------------------------------

// Kolom `tags` bisa berisi objek {label, source}, string biasa, atau
// string JSON dari objek tadi (tergantung bagaimana kolom disimpan).
// Fungsi ini menormalkan semuanya jadi daftar label teks.
export function toTagLabels(tags) {
  if (!Array.isArray(tags)) return [];
  const labels = [];
  for (const t of tags) {
    if (!t) continue;
    if (typeof t === "object") {
      if (typeof t.label === "string" && t.label.trim()) labels.push(t.label.trim());
      continue;
    }
    if (typeof t === "string") {
      const s = t.trim();
      if (!s) continue;
      if (s.startsWith("{")) {
        try {
          const parsed = JSON.parse(s);
          if (parsed && typeof parsed.label === "string" && parsed.label.trim()) {
            labels.push(parsed.label.trim());
            continue;
          }
        } catch {
          /* bukan JSON — pakai apa adanya */
        }
      }
      labels.push(s);
    }
  }
  return labels;
}

export function buildModuleText(mod) {
  const lines = [];
  lines.push(`Judul: ${mod.title || ""}`);
  if (mod.original_title && mod.original_title !== mod.title) lines.push(`Judul asli: ${mod.original_title}`);
  lines.push(`Subject: ${mod.subject || ""}`);
  lines.push(`Topik: ${mod.topic || ""}`);
  lines.push(`Jenis: ${mod.link_url ? "Link eksternal" : mod.file_type || "File"}`);
  if (mod.description) lines.push(`Deskripsi: ${mod.description}`);
  const tags = toTagLabels(mod.tags);
  if (tags.length) lines.push(`Tag: ${tags.join(", ")}`);
  // Hanya kata kunci paling mungkin diketik yang ikut ke vektor (daftar sudah
  // diurutkan AI). Sisanya tetap dipakai sebagai bonus kata di pencarian,
  // tetapi tidak dimasukkan ke vektor agar maknanya tidak "melebar".
  const kws = Array.isArray(mod.search_keywords)
    ? mod.search_keywords.filter((k) => typeof k === "string" && k.trim()).slice(0, MAX_KEYWORDS_IN_VECTOR)
    : [];
  if (kws.length) lines.push(`Kata kunci pencarian: ${kws.join(", ")}`);
  return lines.join("\n").slice(0, MAX_EMBED_CHARS);
}

// Satu embedding per thread: isi post + beberapa balasan pertama, supaya
// pencarian juga menemukan thread lewat isi diskusinya, bukan hanya post awal.
export function buildPostText(post, replies = []) {
  const lines = [];
  lines.push(`Tipe: ${post.post_type || "diskusi"}`);
  if (post.subject) lines.push(`Subject: ${post.subject}`);
  if (post.topic) lines.push(`Topik: ${post.topic}`);
  lines.push(`Isi: ${post.body || ""}`);
  const usable = replies.filter((r) => r && r.body && r.body.trim()).slice(0, MAX_REPLIES_IN_THREAD_TEXT);
  if (usable.length) {
    lines.push("Balasan:");
    for (const r of usable) lines.push(`- ${r.body.trim().slice(0, MAX_REPLY_CHARS)}`);
  }
  return lines.join("\n").slice(0, MAX_EMBED_CHARS);
}

// ---------------------------------------------------------------------
// Embed + simpan ke database
// Semua fungsi di bawah TIDAK melempar error ke pemanggil: kegagalan
// embedding tidak boleh menggagalkan upload/post/balasan. Hasilnya
// { ok: boolean, error?: string }. Baris yang gagal di-embed tetap
// aman — backfill bisa mengisinya nanti.
// ---------------------------------------------------------------------

export async function embedModule(moduleId) {
  try {
    if (!isEmbeddingConfigured()) return { ok: false, error: "AI provider belum dikonfigurasi" };
    const { data: mod, error } = await supabaseAdmin
      .from("modules")
      .select("id, title, original_title, subject, topic, description, tags, search_keywords, file_type, link_url")
      .eq("id", moduleId)
      .single();
    if (error || !mod) return { ok: false, error: "Modul tidak ditemukan" };

    const vec = await createEmbedding(buildModuleText(mod));
    const { error: updateError } = await supabaseAdmin.from("modules").update({ embedding: vec }).eq("id", moduleId);
    if (updateError) throw new Error(updateError.message);
    return { ok: true };
  } catch (err) {
    console.error("Gagal membuat embedding modul:", err.message);
    return { ok: false, error: err.message };
  }
}

export async function embedForumPost(postId) {
  try {
    if (!isEmbeddingConfigured()) return { ok: false, error: "AI provider belum dikonfigurasi" };
    const { data: post, error } = await supabaseAdmin
      .from("posts")
      .select("id, post_type, body, subject, topic")
      .eq("id", postId)
      .single();
    if (error || !post) return { ok: false, error: "Post tidak ditemukan" };

    const { data: replies } = await supabaseAdmin
      .from("replies")
      .select("body, created_at")
      .eq("post_id", postId)
      .order("created_at", { ascending: true })
      .limit(MAX_REPLIES_IN_THREAD_TEXT);

    const vec = await createEmbedding(buildPostText(post, replies || []));
    const { error: updateError } = await supabaseAdmin.from("posts").update({ embedding: vec }).eq("id", postId);
    if (updateError) throw new Error(updateError.message);
    return { ok: true };
  } catch (err) {
    console.error("Gagal membuat embedding post:", err.message);
    return { ok: false, error: err.message };
  }
}

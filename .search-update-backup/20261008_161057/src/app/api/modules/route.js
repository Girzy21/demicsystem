// API route: GET/POST /api/modules
//
// GET  -> fetch all real modules (from Supabase), with each uploader's
//         username joined in from public_profiles (never exposes
//         real_name unless show_real_name is true).
// POST -> either upload a file to Cloudinary and insert its metadata, or
//         (kind="link") store an external link with no Cloudinary
//         involvement at all. allow_ai_file_read is only ever meaningful
//         for file-mode uploads — always stored as false for links.
//
// Disesuaikan dengan Homepage terbaru:
//   - "level" tidak lagi dikirim frontend -> opsional, default "Both"
//   - "topicIsCustom" dari frontend sekarang disimpan ke topic_is_custom
//   - setelah insert, modul langsung di-embed untuk pencarian semantik
//     (kegagalan embedding TIDAK menggagalkan upload)

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { cloudinary } from "@/lib/cloudinary";
import { embedModule } from "@/lib/embeddings";

const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25MB
const VALID_LEVELS = ["SL", "HL", "Both"];

const FRIENDLY_TYPE_LABELS = {
  pdf: "PDF",
  doc: "DOCX",
  docx: "DOCX",
  ppt: "PPTX",
  pptx: "PPTX",
  txt: "TXT",
  xls: "XLSX",
  xlsx: "XLSX",
  csv: "CSV",
  zip: "ZIP",
};

function deriveFileType(filename) {
  const ext = (filename.split(".").pop() || "").toLowerCase();
  if (!ext || ext === filename.toLowerCase()) return "FILE"; // no extension at all
  return FRIENDLY_TYPE_LABELS[ext] || ext.toUpperCase();
}

export async function GET() {
  try {
    const { data: modules, error } = await supabaseAdmin
      .from("modules")
      .select("id, title, original_title, subject, topic, topic_is_custom, level, description, file_type, file_url, link_url, file_size_bytes, tags, created_at, uploader_id")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Gagal mengambil daftar modul:", error);
      return NextResponse.json({ error: "Gagal mengambil daftar modul." }, { status: 500 });
    }

    // Look up uploader usernames separately via public_profiles (never
    // exposes real_name unless show_real_name is true) rather than
    // guessing Supabase's auto-generated foreign-key constraint name for
    // an embedded join.
    const uploaderIds = Array.from(new Set((modules || []).map((m) => m.uploader_id)));
    let usernameById = {};
    if (uploaderIds.length > 0) {
      const { data: profiles } = await supabaseAdmin
        .from("public_profiles")
        .select("id, username")
        .in("id", uploaderIds);
      usernameById = Object.fromEntries((profiles || []).map((p) => [p.id, p.username]));
    }

    const withUploaderNames = (modules || []).map((m) => ({
      ...m,
      uploader: usernameById[m.uploader_id] || "pengguna",
    }));

    return NextResponse.json({ modules: withUploaderNames });
  } catch (err) {
    console.error("Gagal memproses permintaan daftar modul:", err);
    return NextResponse.json({ error: "Gagal mengambil daftar modul." }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    // ---- 1. Verify who's calling ----------------------------
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

    // ---- 2. Read form fields ----------------------------
    const formData = await request.formData();
    const title = (formData.get("title") || "").toString().trim();
    const subject = (formData.get("subject") || "").toString().trim();
    const topic = (formData.get("topic") || "").toString().trim();
    const levelRaw = (formData.get("level") || "").toString().trim();
    const topicIsCustom = (formData.get("topicIsCustom") || "").toString() === "true";
    const description = (formData.get("description") || "").toString().trim();
    const tagsRaw = (formData.get("tags") || "").toString().trim(); // comma-separated
    const kind = (formData.get("kind") || "file").toString(); // "file" | "link"

    if (!title || !subject || !topic) {
      return NextResponse.json({ error: "Judul, subject, dan topik wajib diisi." }, { status: 400 });
    }
    // Level sudah tidak dipakai di UI terbaru: kosong -> "Both". Kalau ada
    // tapi bukan nilai yang valid, tetap ditolak (tidak diam-diam diubah).
    if (levelRaw && !VALID_LEVELS.includes(levelRaw)) {
      return NextResponse.json({ error: "Level harus SL, HL, atau Both." }, { status: 400 });
    }
    const level = levelRaw || "Both";

    const manualTags = tagsRaw
      ? tagsRaw.split(",").map((t) => t.trim()).filter(Boolean).map((label) => ({ label, source: "manual" }))
      : [];

    const baseRow = {
      uploader_id: user.id,
      title,
      subject,
      topic,
      topic_is_custom: topicIsCustom,
      level,
      description: description || null,
      tags: manualTags,
    };

    let row;

    if (kind === "link") {
      // ---- Link-based module: no Cloudinary involved, no AI file read ----
      const linkUrl = (formData.get("linkUrl") || "").toString().trim();
      if (!linkUrl) {
        return NextResponse.json({ error: "URL link wajib diisi." }, { status: 400 });
      }
      let parsed;
      try {
        parsed = new URL(linkUrl);
      } catch {
        return NextResponse.json({ error: "URL tidak valid." }, { status: 400 });
      }
      if (!["http:", "https:"].includes(parsed.protocol)) {
        return NextResponse.json({ error: "URL harus diawali http:// atau https://" }, { status: 400 });
      }
      row = {
        ...baseRow,
        link_url: linkUrl,
        file_url: null,
        file_type: null,
        cloudinary_public_id: null,
        file_size_bytes: null,
        allow_ai_file_read: false, // links never get AI file analysis — no exceptions
      };
    } else {
      // ---- File-based module: upload to Cloudinary first ----------
      const file = formData.get("file");
      if (!file || typeof file === "string") {
        return NextResponse.json({ error: "Tidak ada file yang diupload." }, { status: 400 });
      }
      if (file.size > MAX_FILE_BYTES) {
        return NextResponse.json({ error: "Ukuran file maksimal 25MB." }, { status: 400 });
      }
      const fileType = deriveFileType(file.name || "");

      // Resource type affects how Cloudinary DELIVERS the file, not just
      // how it's stored. PDFs and images upload as "image" (Cloudinary's
      // supported inline-preview resource type for these); everything
      // else uploads as "raw", same as before.
      const previewableTypes = new Set(["PDF", "PNG", "JPG", "JPEG", "GIF", "WEBP", "SVG"]);
      const resourceType = previewableTypes.has(fileType) ? "image" : "raw";

      const bytes = await file.arrayBuffer();
      const base64 = Buffer.from(bytes).toString("base64");
      const dataUri = `data:${file.type};base64,${base64}`;
      const uploadResult = await cloudinary.uploader.upload(dataUri, {
        folder: "modules",
        resource_type: resourceType,
        public_id: `${Date.now()}_${file.name.replace(/\.[^.]+$/, "")}`,
      });

      row = {
        ...baseRow,
        file_type: fileType,
        file_url: uploadResult.secure_url,
        cloudinary_public_id: uploadResult.public_id,
        file_size_bytes: file.size,
        link_url: null,
        allow_ai_file_read: (formData.get("allowAiFileRead") || "").toString() === "true",
      };
    }

    // ---- 4. Insert module metadata ----------------------------
    const { data: mod, error: insertError } = await supabaseAdmin
      .from("modules")
      .insert(row)
      .select()
      .single();

    if (insertError) {
      console.error("Gagal menyimpan metadata modul:", insertError);
      return NextResponse.json({ error: "Gagal menyimpan modul. Coba lagi." }, { status: 500 });
    }

    // ---- 5. Embedding awal untuk pencarian semantik ----------------
    // Berbasis judul/subject/topik/deskripsi/tag manual. Embedding ini
    // dibuat ulang otomatis setelah tag & kata kunci AI selesai
    // (lihat suggest-tags). Tidak pernah melempar error.
    await embedModule(mod.id);

    const { embedding, ...modForClient } = mod;
    return NextResponse.json({ module: modForClient });
  } catch (err) {
    console.error("Gagal memproses upload modul:", err);
    return NextResponse.json({ error: "Gagal mengupload modul." }, { status: 500 });
  }
}

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
// UPLOAD FILE (anti batas 4,5 MB Vercel): file TIDAK lagi lewat server ini.
// Browser mengunggah langsung ke Cloudinary (lihat /api/cloudinary-signature),
// lalu mengirim JSON berisi metadata + { upload: { publicId, resourceType, filename } }.
// Server memverifikasi upload itu ke Cloudinary sebelum menyimpannya. Format
// multipart/form-data lama tetap didukung untuk file kecil.
//
// Disesuaikan dengan Homepage terbaru:
//   - "level" tidak lagi dikirim frontend -> opsional, default "Both"
//   - "topicIsCustom" dari frontend sekarang disimpan ke topic_is_custom
//   - setelah insert, modul langsung di-embed untuk pencarian semantik
//     (kegagalan embedding TIDAK menggagalkan upload)
//   - "isExercise": uploader menandai modul sebagai latihan soal (problem set)
//     atau materi; AI boleh menyesuaikan nanti (lihat lib/moduleTagging.js)

import { assertActive } from "@/lib/adminAuth";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { cloudinary } from "@/lib/cloudinary";
import { verifyUpload, deriveFileType, resourceTypeForFileType, safeBaseName, MODULE_MAX_BYTES } from "@/lib/cloudinaryUploads";
import { embedModule } from "@/lib/embeddings";

const VALID_LEVELS = ["SL", "HL", "Both"];

export async function GET(request) {
  try {
    // Wajib login: Homepage mengirim token Supabase (lihat fetchModules).
    const authToken = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!authToken) {
      return NextResponse.json({ error: "Tidak ada token autentikasi." }, { status: 401 });
    }
    const {
      data: { user: authUser },
      error: authErr,
    } = await supabaseAdmin.auth.getUser(authToken);
    if (authErr || !authUser) {
      return NextResponse.json({ error: "Sesi tidak valid — coba login ulang." }, { status: 401 });
    }
    // is_exercise / exercise_set_by baru ada setelah SQL tahap 3; sebelum itu
    // daftar modul tetap dimuat tanpa kolom tersebut.
    const baseCols = "id, title, original_title, subject, topic, topic_is_custom, level, description, file_type, file_url, link_url, file_size_bytes, tags, created_at, uploader_id";
    let { data: modules, error } = await supabaseAdmin
      .from("modules")
      .select(`${baseCols}, is_exercise, exercise_set_by`)
      .order("created_at", { ascending: false });
    if (error && error.code === "42703") {
      ({ data: modules, error } = await supabaseAdmin
        .from("modules")
        .select(baseCols)
        .order("created_at", { ascending: false }));
    }
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

    const blocked = await assertActive(user.id);
    if (blocked) return blocked;

    // ---- 2. Baca field: JSON (cara utama) atau multipart (cara lama) ----
    const isJson = (request.headers.get("content-type") || "").includes("application/json");
    let jsonBody = null;
    let formData = null;
    if (isJson) jsonBody = await request.json().catch(() => ({}));
    else formData = await request.formData();
    const field = (name) => {
      const v = isJson ? jsonBody[name] : formData.get(name);
      return v === null || v === undefined ? "" : typeof v === "string" ? v : String(v);
    };
    const truthy = (name) => {
      const v = isJson ? jsonBody[name] : formData.get(name);
      return v === true || String(v || "") === "true";
    };
    const title = field("title").trim();
    const subject = field("subject").trim();
    const topic = field("topic").trim();
    const levelRaw = field("level").trim();
    const topicIsCustom = truthy("topicIsCustom");
    const description = field("description").trim();
    const tagsRaw = field("tags").trim(); // dipisah koma
    const kind = field("kind") || "file"; // "file" | "link"
    const isExercise = truthy("isExercise");

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
      // Pilihan uploader. AI boleh menyesuaikan setelah analisis bila yakin
      // (exercise_set_by = 'user' berarti belum pernah diubah siapa pun).
      is_exercise: isExercise,
      exercise_set_by: "user",
    };

    let row;

    if (kind === "link") {
      // ---- Link-based module: no Cloudinary involved, no AI file read ----
      const linkUrl = field("linkUrl").trim();
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
    } else if (isJson) {
      // ---- File-based module, cara utama: sudah diunggah langsung ke Cloudinary ----
      const upload = jsonBody.upload || {};
      const resourceType = upload.resourceType === "raw" ? "raw" : "image";
      const check = await verifyUpload({ publicId: upload.publicId, resourceType, purpose: "module", userId: user.id });
      if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });
      const resource = check.resource;
      // Jenis file diturunkan dari nama file asli yang dikirim browser; kalau
      // jenis resource-nya tidak cocok, tolak (mencegah data yang tidak konsisten).
      const fileType = deriveFileType(upload.filename || "");
      if (resourceTypeForFileType(fileType) !== resourceType) {
        return NextResponse.json({ error: "Data upload tidak konsisten. Coba upload ulang." }, { status: 400 });
      }
      row = {
        ...baseRow,
        file_type: fileType,
        file_url: resource.secure_url,
        cloudinary_public_id: resource.public_id,
        file_size_bytes: resource.bytes,
        link_url: null,
        allow_ai_file_read: truthy("allowAiFileRead"),
      };
    } else {
      // ---- File-based module, cara lama: file lewat server (hanya aman untuk file kecil di Vercel) ----
      const file = formData.get("file");
      if (!file || typeof file === "string") {
        return NextResponse.json({ error: "Tidak ada file yang diupload." }, { status: 400 });
      }
      if (file.size > MODULE_MAX_BYTES) {
        return NextResponse.json({ error: `Ukuran file maksimal ${Math.round(MODULE_MAX_BYTES / 1048576)}MB.` }, { status: 400 });
      }
      const fileType = deriveFileType(file.name || "");
      const resourceType = resourceTypeForFileType(fileType);

      const bytes = await file.arrayBuffer();
      const base64 = Buffer.from(bytes).toString("base64");
      const dataUri = `data:${file.type};base64,${base64}`;
      const uploadResult = await cloudinary.uploader.upload(dataUri, {
        folder: "modules",
        resource_type: resourceType,
        public_id: `${Date.now()}_${safeBaseName(file.name)}`,
        context: `uploader=${user.id}|purpose=module`,
      });

      row = {
        ...baseRow,
        file_type: fileType,
        file_url: uploadResult.secure_url,
        cloudinary_public_id: uploadResult.public_id,
        file_size_bytes: file.size,
        link_url: null,
        allow_ai_file_read: truthy("allowAiFileRead"),
      };
    }

    // ---- 4. Insert module metadata ----------------------------
    let { data: mod, error: insertError } = await supabaseAdmin
      .from("modules")
      .insert(row)
      .select()
      .single();
    if (insertError && insertError.code === "42703") {
      // SQL tahap 3 belum dijalankan: simpan tanpa kolom jenis modul.
      const { is_exercise, exercise_set_by, ...legacyRow } = row;
      ({ data: mod, error: insertError } = await supabaseAdmin.from("modules").insert(legacyRow).select().single());
    }

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

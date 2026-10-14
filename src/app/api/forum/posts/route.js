// API route: GET/POST /api/forum/posts
//
// Sebutan modul: sebuah post bisa menyebut SATU modul dari Bank Modul
// (posts.module_id). Feed membawa ringkasan modulnya supaya pengguna lain bisa
// langsung membuka halaman modul tersebut dari thread.
//
// GET  -> memuat feed forum dari database (post + semua balasan + jumlah
//         like + status "sudah di-like oleh saya"). Sebelumnya belum ada
//         endpoint ini, jadi post asli hilang dari UI setelah refresh dan
//         hasil pencarian tidak bisa membuka thread-nya.
// POST -> membuat post baru (termasuk upload gambar ke Cloudinary), lalu
//         membuat embedding-nya untuk pencarian semantik.
//
// Pola auth sama seperti /api/profile/photo: token Supabase diverifikasi
// di server, bukan percaya username dari body request.

import { assertActive } from "@/lib/adminAuth";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { cloudinary } from "@/lib/cloudinary";
import { verifyUpload } from "@/lib/cloudinaryUploads";
import { embedForumPost } from "@/lib/embeddings";

const MAX_IMAGES = 4;
const MAX_FILE_BYTES = 8 * 1024 * 1024; // 8MB per image
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

// Batas pengambilan untuk skala sekolah (ratusan user). Kalau forum sudah
// jauh lebih besar, ganti dengan paginasi.
const MAX_POSTS = 300;
const MAX_REPLIES = 5000;
const MAX_LIKES = 20000;

async function getCallerId(request) {
  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const {
    data: { user },
  } = await supabaseAdmin.auth.getUser(token);
  return user?.id || null;
}

export async function GET(request) {
  try {
    const userId = await getCallerId(request);
    if (!userId) {
      return NextResponse.json({ error: "Sesi tidak valid — coba login ulang." }, { status: 401 });
    }

    // edited_at (penanda "diedit") dan module_id (sebutan modul) ada setelah SQL
    // tahap 2/3 dijalankan; kalau kolomnya belum ada, feed tetap jalan tanpa
    // fitur itu.
    const postCols = "id, author_id, post_type, body, subject, topic, images, attachment_name, created_at";
    const postAttempts = [`${postCols}, edited_at, module_id`, `${postCols}, edited_at`, postCols];
    let posts = null;
    let postsError = null;
    for (const cols of postAttempts) {
      const r = await supabaseAdmin.from("posts").select(cols).order("created_at", { ascending: false }).limit(MAX_POSTS);
      posts = r.data;
      postsError = r.error;
      if (!r.error || r.error.code !== "42703") break;
    }
    if (postsError) {
      console.error("Gagal mengambil daftar post:", postsError);
      return NextResponse.json({ error: "Gagal mengambil daftar post." }, { status: 500 });
    }

    // Ringkasan modul yang disebut (di-chunk supaya URL request tidak terlalu panjang).
    const moduleIds = Array.from(new Set((posts || []).map((p) => p.module_id).filter(Boolean)));
    const moduleById = {};
    for (let i = 0; i < moduleIds.length; i += 50) {
      const { data: mods } = await supabaseAdmin
        .from("modules")
        .select("id, title, subject, topic, file_type, link_url")
        .in("id", moduleIds.slice(i, i + 50));
      for (const m of mods || []) {
        moduleById[m.id] = { id: m.id, title: m.title, subject: m.subject, topic: m.topic, type: m.link_url ? "LINK" : m.file_type };
      }
    }

    const postIdSet = new Set((posts || []).map((p) => p.id));

    const replyCols = "id, post_id, parent_id, author_id, body, images, attachment_name, created_at";
    let { data: allReplies, error: repliesError } = await supabaseAdmin
      .from("replies")
      .select(`${replyCols}, edited_at`)
      .order("created_at", { ascending: true })
      .limit(MAX_REPLIES);
    if (repliesError && repliesError.code === "42703") {
      ({ data: allReplies, error: repliesError } = await supabaseAdmin
        .from("replies")
        .select(replyCols)
        .order("created_at", { ascending: true })
        .limit(MAX_REPLIES));
    }
    if (repliesError) {
      console.error("Gagal mengambil balasan:", repliesError);
      return NextResponse.json({ error: "Gagal mengambil balasan." }, { status: 500 });
    }
    const replies = (allReplies || []).filter((r) => postIdSet.has(r.post_id));

    // Semua like diambil sekaligus lalu dihitung di JS — menghindari .in()
    // dengan ratusan id yang membuat URL request terlalu panjang.
    const { data: likeRows } = await supabaseAdmin.from("likes").select("post_id, reply_id, user_id").limit(MAX_LIKES);
    const likeCount = {};
    const likedByMe = {};
    for (const l of likeRows || []) {
      const targetId = l.post_id || l.reply_id;
      if (!targetId) continue;
      likeCount[targetId] = (likeCount[targetId] || 0) + 1;
      if (l.user_id === userId) likedByMe[targetId] = true;
    }

    // Username dari public_profiles (tidak pernah membuka real_name
    // kecuali show_real_name = true, sesuai definisi view-nya).
    const { data: profs } = await supabaseAdmin.from("public_profiles").select("id, username");
    const usernameById = Object.fromEntries((profs || []).map((p) => [p.id, p.username]));

    return NextResponse.json({
      posts: (posts || []).map((p) => ({
        id: p.id,
        postType: p.post_type,
        body: p.body,
        subject: p.subject,
        topic: p.topic,
        images: p.images || [],
        attachmentName: p.attachment_name || null,
        author: usernameById[p.author_id] || "pengguna",
        createdAt: p.created_at,
        editedAt: p.edited_at || null,
        moduleId: p.module_id || null,
        module: p.module_id ? moduleById[p.module_id] || null : null,
        likes: likeCount[p.id] || 0,
        likedByMe: !!likedByMe[p.id],
      })),
      replies: replies.map((r) => ({
        id: r.id,
        postId: r.post_id,
        parentId: r.parent_id || null,
        body: r.body,
        images: r.images || [],
        attachmentName: r.attachment_name || null,
        author: usernameById[r.author_id] || "pengguna",
        createdAt: r.created_at,
        editedAt: r.edited_at || null,
        likes: likeCount[r.id] || 0,
        likedByMe: !!likedByMe[r.id],
      })),
    });
  } catch (err) {
    console.error("Gagal memproses feed forum:", err);
    return NextResponse.json({ error: "Gagal mengambil feed forum." }, { status: 500 });
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
    // Cara utama: gambar sudah diunggah LANGSUNG ke Cloudinary oleh browser
    // (anti batas 4,5 MB Vercel); body JSON hanya berisi { publicId } tiap gambar.
    const isJson = (request.headers.get("content-type") || "").includes("application/json");
    let jsonBody = null;
    let formData = null;
    if (isJson) jsonBody = await request.json().catch(() => ({}));
    else formData = await request.formData();
    const str = (name) => {
      const v = isJson ? jsonBody[name] : formData.get(name);
      return v === null || v === undefined ? "" : String(v);
    };
    const body = str("body").trim();
    const postType = str("postType") || "diskusi";
    const subject = str("subject") || null;
    const topic = str("topic") || null;
    const moduleIdRaw = str("moduleId").trim();
    const direct = isJson ? (Array.isArray(jsonBody.images) ? jsonBody.images : []) : [];
    const images = isJson ? [] : formData.getAll("images").filter((f) => typeof f !== "string");

    if (!body) {
      return NextResponse.json({ error: "Isi post tidak boleh kosong." }, { status: 400 });
    }

    if (body.length > 5000) {
      return NextResponse.json({ error: "Isi post maksimal 5000 karakter." }, { status: 400 });
    }
    if (images.length + direct.length > MAX_IMAGES) {
      return NextResponse.json({ error: `Maksimal ${MAX_IMAGES} gambar per post.` }, { status: 400 });
    }
    for (const file of images) {
      if (!ALLOWED_TYPES.includes(file.type)) {
        return NextResponse.json({ error: "Format gambar tidak didukung. Pakai JPG, PNG, atau WebP." }, { status: 400 });
      }
      if (file.size > MAX_FILE_BYTES) {
        return NextResponse.json({ error: "Ukuran tiap gambar maksimal 8MB." }, { status: 400 });
      }
    }

    // ---- 3. Gambar: verifikasi upload langsung / upload lama lewat server ----
    const uploadedUrls = [];
    for (const item of direct) {
      const check = await verifyUpload({ publicId: item && item.publicId, resourceType: "image", purpose: "forum", userId: user.id });
      if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });
      uploadedUrls.push(check.resource.secure_url);
    }
    uploadedUrls.push(
      ...(await Promise.all(
        images.map(async (file) => {
          const bytes = await file.arrayBuffer();
          const base64 = Buffer.from(bytes).toString("base64");
          const dataUri = `data:${file.type};base64,${base64}`;
          const result = await cloudinary.uploader.upload(dataUri, {
            folder: "forum-attachments",
            transformation: [{ width: 1600, crop: "limit" }],
            context: `uploader=${user.id}|purpose=forum`,
          });
          return result.secure_url;
        })
      ))
    );

    // ---- 3b. Modul yang disebut (opsional) ----------------------------
    let mentioned = null;
    if (moduleIdRaw) {
      const { data: mod, error: modError } = await supabaseAdmin
        .from("modules")
        .select("id, title, subject, topic, file_type, link_url")
        .eq("id", moduleIdRaw)
        .single();
      if (modError || !mod) {
        return NextResponse.json({ error: "Modul yang disebut tidak ditemukan (mungkin sudah dihapus)." }, { status: 400 });
      }
      mentioned = { id: mod.id, title: mod.title, subject: mod.subject, topic: mod.topic, type: mod.link_url ? "LINK" : mod.file_type };
    }

    // ---- 4. Insert the post row ----------------------------
    const row = {
      author_id: user.id,
      post_type: postType,
      body,
      // Diskusi tentang sebuah modul otomatis ikut subject/topik modul itu
      // kalau pengguna tidak mengisinya sendiri.
      subject: subject || (mentioned ? mentioned.subject : null),
      topic: topic || (mentioned ? mentioned.topic : null),
      images: uploadedUrls,
      ...(mentioned ? { module_id: mentioned.id } : {}),
    };
    let { data: post, error: insertError } = await supabaseAdmin.from("posts").insert(row).select().single();
    if (insertError && insertError.code === "42703" && row.module_id) {
      // Kolom module_id belum ada (SQL tahap 3 belum dijalankan): simpan tanpa sebutan modul.
      const { module_id, ...legacyRow } = row;
      mentioned = null;
      ({ data: post, error: insertError } = await supabaseAdmin.from("posts").insert(legacyRow).select().single());
    }

    if (insertError) {
      console.error("Gagal membuat post:", insertError);
      return NextResponse.json({ error: "Gagal membuat post. Coba lagi." }, { status: 500 });
    }

    // ---- 5. Embedding untuk pencarian semantik ----------------------
    // Tidak pernah melempar error: kalau gagal, post tetap tersimpan dan
    // embedding-nya bisa diisi nanti lewat endpoint backfill.
    await embedForumPost(post.id);

    // Kolom embedding tidak ikut dikirim balik ke browser.
    const { embedding, ...postForClient } = post;
    return NextResponse.json({ post: postForClient, module: mentioned });
  } catch (err) {
    console.error("Gagal memproses post baru:", err);
    return NextResponse.json({ error: "Gagal membuat post." }, { status: 500 });
  }
}

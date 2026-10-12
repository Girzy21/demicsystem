// API route: GET/POST /api/forum/posts
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

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { cloudinary } from "@/lib/cloudinary";
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

    const { data: posts, error: postsError } = await supabaseAdmin
      .from("posts")
      .select("id, author_id, post_type, body, subject, topic, images, attachment_name, created_at")
      .order("created_at", { ascending: false })
      .limit(MAX_POSTS);
    if (postsError) {
      console.error("Gagal mengambil daftar post:", postsError);
      return NextResponse.json({ error: "Gagal mengambil daftar post." }, { status: 500 });
    }

    const postIdSet = new Set((posts || []).map((p) => p.id));

    const { data: allReplies, error: repliesError } = await supabaseAdmin
      .from("replies")
      .select("id, post_id, parent_id, author_id, body, images, attachment_name, created_at")
      .order("created_at", { ascending: true })
      .limit(MAX_REPLIES);
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

    // ---- 2. Read form fields ----------------------------
    const formData = await request.formData();
    const body = (formData.get("body") || "").toString().trim();
    const postType = (formData.get("postType") || "diskusi").toString();
    const subject = formData.get("subject") ? formData.get("subject").toString() : null;
    const topic = formData.get("topic") ? formData.get("topic").toString() : null;
    const images = formData.getAll("images").filter((f) => typeof f !== "string");

    if (!body) {
      return NextResponse.json({ error: "Isi post tidak boleh kosong." }, { status: 400 });
    }
    if (images.length > MAX_IMAGES) {
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

    // ---- 3. Upload images to Cloudinary (in parallel with each other) ----
    const uploadedUrls = await Promise.all(
      images.map(async (file) => {
        const bytes = await file.arrayBuffer();
        const base64 = Buffer.from(bytes).toString("base64");
        const dataUri = `data:${file.type};base64,${base64}`;
        const result = await cloudinary.uploader.upload(dataUri, {
          folder: "forum-attachments",
          transformation: [{ width: 1600, crop: "limit" }],
        });
        return result.secure_url;
      })
    );

    // ---- 4. Insert the post row ----------------------------
    const { data: post, error: insertError } = await supabaseAdmin
      .from("posts")
      .insert({
        author_id: user.id,
        post_type: postType,
        body,
        subject,
        topic,
        images: uploadedUrls,
      })
      .select()
      .single();

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
    return NextResponse.json({ post: postForClient });
  } catch (err) {
    console.error("Gagal memproses post baru:", err);
    return NextResponse.json({ error: "Gagal membuat post." }, { status: 500 });
  }
}

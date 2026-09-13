// API route: POST /api/forum/posts
//
// Creates a new forum post, including uploading any attached images to
// Cloudinary first. Mirrors the same auth pattern as /api/profile/photo:
// verify the caller's Supabase session token server-side rather than
// trusting a username sent in the request body.
//
// The frontend sends multipart/form-data: text fields (body, postType,
// subject, topic) plus 0-4 image files under the "images" field.

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { cloudinary } from "@/lib/cloudinary";

const MAX_IMAGES = 4;
const MAX_FILE_BYTES = 8 * 1024 * 1024; // 8MB per image
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

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

    return NextResponse.json({ post });
  } catch (err) {
    console.error("Gagal memproses post baru:", err);
    return NextResponse.json({ error: "Gagal membuat post." }, { status: 500 });
  }
}
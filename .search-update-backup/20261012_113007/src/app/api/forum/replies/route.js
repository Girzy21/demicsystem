// API route: POST /api/forum/replies
//
// Creates a reply to a post OR to another reply (nested), mirroring
// /api/forum/posts' auth + upload pattern. parent_id is null for a
// top-level reply (directly to the post) and set to another reply's id
// for a nested reply-to-reply.
//
// Setelah balasan tersimpan, embedding thread (post induk) diperbarui
// supaya pencarian semantik ikut "melihat" isi balasan terbaru.

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { cloudinary } from "@/lib/cloudinary";
import { embedForumPost } from "@/lib/embeddings";

const MAX_IMAGES = 4;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
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
    const postId = (formData.get("postId") || "").toString();
    const parentId = formData.get("parentId") ? formData.get("parentId").toString() : null;
    const body = (formData.get("body") || "").toString().trim();
    const images = formData.getAll("images").filter((f) => typeof f !== "string");

    if (!postId) {
      return NextResponse.json({ error: "postId wajib diisi." }, { status: 400 });
    }
    if (!body) {
      return NextResponse.json({ error: "Isi balasan tidak boleh kosong." }, { status: 400 });
    }
    if (images.length > MAX_IMAGES) {
      return NextResponse.json({ error: `Maksimal ${MAX_IMAGES} gambar per balasan.` }, { status: 400 });
    }
    for (const file of images) {
      if (!ALLOWED_TYPES.includes(file.type)) {
        return NextResponse.json({ error: "Format gambar tidak didukung. Pakai JPG, PNG, atau WebP." }, { status: 400 });
      }
      if (file.size > MAX_FILE_BYTES) {
        return NextResponse.json({ error: "Ukuran tiap gambar maksimal 8MB." }, { status: 400 });
      }
    }

    // ---- 3. Upload images to Cloudinary (in parallel) ----------------
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

    // ---- 4. Insert the reply row ----------------------------
    // If postId refers to a demo/dummy post that was never actually
    // inserted into the posts table (the prototype's seed data uses ids
    // like "p1", "p2" that only exist in the frontend), this insert fails
    // on the foreign key constraint — that's expected and surfaces as a
    // clear error below, not silently swallowed.
    const { data: reply, error: insertError } = await supabaseAdmin
      .from("replies")
      .insert({
        post_id: postId,
        parent_id: parentId,
        author_id: user.id,
        body,
        images: uploadedUrls,
      })
      .select()
      .single();

    if (insertError) {
      console.error("Gagal membuat balasan:", insertError);
      const isForeignKeyError = insertError.code === "23503";
      return NextResponse.json(
        {
          error: isForeignKeyError
            ? "Post ini adalah data contoh dan belum ada di database sungguhan, jadi balasan tidak bisa disimpan permanen."
            : "Gagal mengirim balasan. Coba lagi.",
        },
        { status: 500 }
      );
    }

    // ---- 5. Perbarui embedding thread (tidak pernah melempar error) ----
    await embedForumPost(postId);

    return NextResponse.json({ reply });
  } catch (err) {
    console.error("Gagal memproses balasan baru:", err);
    return NextResponse.json({ error: "Gagal mengirim balasan." }, { status: 500 });
  }
}

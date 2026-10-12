// API route: POST /api/profile/photo
//
// Handles the real (non-base64-in-state) profile photo upload flow:
//   1. Verify the caller's Supabase session token -> get their real user id
//      (never trust a username/id sent in the request body — that could be
//      forged to overwrite someone else's photo)
//   2. Upload the image to Cloudinary, into the "avatars" folder, using the
//      avatar_upload preset's transformation (400x400 crop) set up earlier
//   3. Save the resulting Cloudinary URL to that user's row in `profiles`
//
// The frontend calls this with a single image file (multipart/form-data)
// and an Authorization: Bearer <access_token> header.

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { cloudinary } from "@/lib/cloudinary";

const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5MB — generous for a profile photo, cheap on Cloudinary credits
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

export async function POST(request) {
  try {
    // ---- 1. Verify who's actually calling ----------------------------
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

    // ---- 2. Read & validate the uploaded file ------------------------
    const formData = await request.formData();
    const file = formData.get("photo");

    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "Tidak ada file yang diupload." }, { status: 400 });
    }
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: "Format file tidak didukung. Pakai JPG, PNG, atau WebP." },
        { status: 400 }
      );
    }
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: "Ukuran file maksimal 5MB." }, { status: 400 });
    }

    // ---- 3. Upload to Cloudinary --------------------------------------
    // file.arrayBuffer() -> Buffer -> base64 data URI is the simplest way
    // to hand an in-memory file to Cloudinary's Node SDK without touching
    // the filesystem (there's no disk to write to on serverless hosts
    // like Vercel anyway).
    const bytes = await file.arrayBuffer();
    const base64 = Buffer.from(bytes).toString("base64");
    const dataUri = `data:${file.type};base64,${base64}`;

    const uploadResult = await cloudinary.uploader.upload(dataUri, {
      folder: "avatars",
      public_id: `user_${user.id}`, // stable id -> re-uploading REPLACES the old photo instead of accumulating new ones
      overwrite: true,
      transformation: [{ width: 400, height: 400, crop: "fill" }],
    });

    // ---- 4. Save the URL to this user's profile row -------------------
    const { error: updateError } = await supabaseAdmin
      .from("profiles")
      .update({ photo_url: uploadResult.secure_url })
      .eq("id", user.id);

    if (updateError) {
      console.error("Gagal menyimpan photo_url ke profiles:", updateError);
      return NextResponse.json(
        { error: "Foto terupload tapi gagal disimpan ke profil. Coba lagi." },
        { status: 500 }
      );
    }

    return NextResponse.json({ photoUrl: uploadResult.secure_url });
  } catch (err) {
    console.error("Gagal upload foto profil:", err);
    return NextResponse.json({ error: "Gagal upload foto profil." }, { status: 500 });
  }
}

// DELETE /api/profile/photo — removes the current user's profile photo:
// clears photos_url in Supabase AND deletes the underlying asset from
// Cloudinary (skipping this second step would leave the old photo taking up
// storage quota forever, invisible from the app but still counted against
// the Cloudinary free-tier credits).
export async function DELETE(request) {
  try {
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

    // public_id is deterministic (user_<id>, set at upload time above), so
    // we don't need to look anything up before deleting from Cloudinary.
    try {
      await cloudinary.uploader.destroy(`avatars/user_${user.id}`);
    } catch (cloudinaryErr) {
      // Not fatal — if the asset was already gone (e.g. deleted twice), we
      // still want to make sure photo_url is cleared in the database below.
      console.error("Gagal menghapus asset Cloudinary (lanjut menghapus dari DB):", cloudinaryErr);
    }

    const { error: updateError } = await supabaseAdmin
      .from("profiles")
      .update({ photo_url: null })
      .eq("id", user.id);

    if (updateError) {
      console.error("Gagal menghapus photo_url dari profiles:", updateError);
      return NextResponse.json({ error: "Gagal menghapus foto dari profil." }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Gagal menghapus foto profil:", err);
    return NextResponse.json({ error: "Gagal menghapus foto profil." }, { status: 500 });
  }
}
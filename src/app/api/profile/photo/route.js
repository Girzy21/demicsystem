// API route: POST/DELETE /api/profile/photo
//
// POST   -> menyimpan foto profil. Cara utama (dipakai browser): foto sudah
//           diunggah LANGSUNG ke Cloudinary lewat /api/cloudinary-signature
//           (purpose "avatar"), lalu browser mengirim JSON { publicId }. Server
//           memverifikasi file itu ke Cloudinary dan menyimpan URL-nya. Cara
//           lama (multipart/form-data dengan field "photo") tetap didukung untuk
//           file kecil; di Vercel body dibatasi 4,5 MB.
// DELETE -> menghapus foto: mengosongkan photo_url dan menghapus aset Cloudinary
//           (kalau tidak, foto lama tetap memakan kuota storage selamanya).
//
// Identitas selalu dari token Supabase, tidak pernah dari body request.

import { assertActive } from "@/lib/adminAuth";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { cloudinary } from "@/lib/cloudinary";
import { verifyUpload, AVATAR_MAX_BYTES, IMAGE_MIME_TYPES } from "@/lib/cloudinaryUploads";

async function getUser(request) {
  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return { error: NextResponse.json({ error: "Tidak ada token autentikasi." }, { status: 401 }) };
  const {
    data: { user },
    error: authError,
  } = await supabaseAdmin.auth.getUser(token);
  if (authError || !user) {
    return { error: NextResponse.json({ error: "Sesi tidak valid — coba login ulang." }, { status: 401 }) };
  }
  return { user };
}

async function savePhotoUrl(userId, url) {
  const { error } = await supabaseAdmin.from("profiles").update({ photo_url: url }).eq("id", userId);
  if (error) {
    console.error("Gagal menyimpan photo_url ke profiles:", error);
    return NextResponse.json({ error: "Foto terupload tapi gagal disimpan ke profil. Coba lagi." }, { status: 500 });
  }
  return null;
}

export async function POST(request) {
  try {
    const { user, error: authFail } = await getUser(request);
    if (authFail) return authFail;

    const blocked = await assertActive(user.id);
    if (blocked) return blocked;

    // ---- Cara utama: foto sudah diunggah langsung ke Cloudinary ----------
    if ((request.headers.get("content-type") || "").includes("application/json")) {
      const body = await request.json().catch(() => ({}));
      const check = await verifyUpload({ publicId: body.publicId, resourceType: "image", purpose: "avatar", userId: user.id });
      if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });
      const failed = await savePhotoUrl(user.id, check.resource.secure_url);
      if (failed) return failed;
      return NextResponse.json({ photoUrl: check.resource.secure_url });
    }

    // ---- Cara lama: multipart (hanya aman untuk file kecil di Vercel) -----
    const formData = await request.formData();
    const file = formData.get("photo");
    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "Tidak ada file yang diupload." }, { status: 400 });
    }
    if (!IMAGE_MIME_TYPES.includes(file.type)) {
      return NextResponse.json({ error: "Format file tidak didukung. Pakai JPG, PNG, atau WebP." }, { status: 400 });
    }
    if (file.size > AVATAR_MAX_BYTES) {
      return NextResponse.json({ error: "Ukuran file maksimal 5MB." }, { status: 400 });
    }
    const bytes = await file.arrayBuffer();
    const dataUri = `data:${file.type};base64,${Buffer.from(bytes).toString("base64")}`;
    const uploadResult = await cloudinary.uploader.upload(dataUri, {
      folder: "avatars",
      public_id: `user_${user.id}`, // id tetap -> unggah ulang MENGGANTI foto lama
      overwrite: true,
      transformation: [{ width: 400, height: 400, crop: "fill" }],
    });
    const failed = await savePhotoUrl(user.id, uploadResult.secure_url);
    if (failed) return failed;
    return NextResponse.json({ photoUrl: uploadResult.secure_url });
  } catch (err) {
    console.error("Gagal upload foto profil:", err);
    return NextResponse.json({ error: "Gagal upload foto profil." }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const { user, error: authFail } = await getUser(request);
    if (authFail) return authFail;

    // public_id deterministik (avatars/user_<id>), tidak perlu lookup dulu.
    // Dicoba kedua bentuk id: akun Cloudinary mode folder lama memakai "avatars/user_<id>",
    // mode folder dinamis memakai "user_<id>". Tidak fatal kalau salah satunya tidak ada.
    for (const publicId of [`avatars/user_${user.id}`, `user_${user.id}`]) {
      try {
        await cloudinary.uploader.destroy(publicId);
      } catch (cloudinaryErr) {
        console.error("Gagal menghapus asset Cloudinary (lanjut menghapus dari DB):", cloudinaryErr);
      }
    }

    const { error: updateError } = await supabaseAdmin.from("profiles").update({ photo_url: null }).eq("id", user.id);
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

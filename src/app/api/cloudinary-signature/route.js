// API route: POST /api/cloudinary-signature
//
// Ini endpoint PERTAMA di alur upload signed yang sudah kita rencanakan:
//   1. Frontend minta izin upload → panggil endpoint ini
//   2. Backend (di sini) generate signature pakai API Secret
//   3. Frontend upload LANGSUNG ke Cloudinary pakai signature itu
//   4. Backend simpan URL hasil ke tabel Supabase (endpoint terpisah,
//      menyusul setelah ini — tergantung jenis filenya modul/avatar/forum)
//
// API Secret Cloudinary tidak pernah terkirim ke browser — cuma dipakai
// di sini, di server, untuk menghasilkan signature.

import { NextResponse } from "next/server";
import { cloudinary } from "@/lib/cloudinary";

// Folder yang diizinkan — harus cocok dengan upload preset yang sudah
// dibuat di dashboard Cloudinary (avatar_upload, module_upload,
// forum_upload). Menahan folder di sini mencegah frontend mengirim nama
// folder sembarangan yang tidak sesuai preset yang sudah disiapkan.
const ALLOWED_FOLDERS = ["avatars", "modules", "forum-attachments"];

export async function POST(request) {
  try {
    const body = await request.json();
    const { folder } = body;

    if (!folder || !ALLOWED_FOLDERS.includes(folder)) {
      return NextResponse.json(
        { error: `folder harus salah satu dari: ${ALLOWED_FOLDERS.join(", ")}` },
        { status: 400 }
      );
    }

    // TODO (langkah berikutnya, setelah auth diwire): pastikan request ini
    // datang dari user yang sudah login sebelum kasih signature — supaya
    // orang random tidak bisa upload file ke Cloudinary kita hanya dengan
    // menembak endpoint ini langsung. Untuk sekarang endpoint ini masih
    // terbuka karena autentikasi belum kita hubungkan.

    const timestamp = Math.round(Date.now() / 1000);

    // Parameter yang mau ditandatangani HARUS persis sama dengan parameter
    // yang nanti dikirim frontend saat upload — kalau beda sedikit saja,
    // Cloudinary akan menolak uploadnya sebagai "invalid signature".
    const paramsToSign = { timestamp, folder };

    const signature = cloudinary.utils.api_sign_request(
      paramsToSign,
      process.env.CLOUDINARY_API_SECRET
    );

    return NextResponse.json({
      signature,
      timestamp,
      cloudName: process.env.CLOUDINARY_CLOUD_NAME,
      apiKey: process.env.CLOUDINARY_API_KEY,
      folder,
    });
  } catch (err) {
    console.error("Gagal generate Cloudinary signature:", err);
    return NextResponse.json(
      { error: "Gagal generate signature upload." },
      { status: 500 }
    );
  }
}
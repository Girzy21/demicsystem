// API route: POST /api/cloudinary-signature
//
// Langkah 1 dari upload langsung (browser -> Cloudinary), yang menggantikan
// upload lewat server. Di Vercel, body request ke fungsi API dibatasi 4,5 MB,
// jadi file besar tidak boleh melewati server kita. Server hanya menandatangani
// parameter upload dengan API Secret (yang tidak pernah dikirim ke browser);
// file-nya sendiri dikirim browser langsung ke Cloudinary.
//
// Body : { "purpose": "module" | "forum" | "avatar", "filename": "...", "contentType": "...", "size": 12345 }
// Balik: { cloudName, apiKey, signature, resourceType, params }
//        -> browser mengirim `params` apa adanya + file + api_key + signature ke
//           https://api.cloudinary.com/v1_1/<cloudName>/<resourceType>/upload
//
// Wajib login (sebelumnya endpoint ini terbuka untuk siapa pun). Folder, nama
// file, transformasi, dan batas ukuran ditentukan server (lib/cloudinaryUploads.js).

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { buildSignedUpload } from "@/lib/cloudinaryUploads";

export async function POST(request) {
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

    const body = await request.json().catch(() => ({}));
    const result = buildSignedUpload({
      purpose: body.purpose,
      user,
      filename: body.filename,
      contentType: body.contentType,
      size: body.size,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    const { ok, ...payload } = result;
    return NextResponse.json(payload);
  } catch (err) {
    console.error("Gagal generate Cloudinary signature:", err);
    return NextResponse.json({ error: "Gagal menyiapkan upload." }, { status: 500 });
  }
}

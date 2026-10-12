// API route: POST /api/modules/[id]/suggest-tags
//
// Memicu analisis AI untuk satu modul (tag tampilan, kata kunci pencarian
// tersembunyi, topik yang didukung/difondasi modul, dan — bila isi file
// dibaca dengan izin uploader — usulan judul). Seluruh logikanya ada di
// lib/moduleTagging.js supaya bisa dipakai juga oleh endpoint admin
// retag-modules untuk modul lama.
//
// Ini sengaja panggilan TERPISAH dari upload (POST /api/modules): dijalankan
// di latar belakang setelah upload sukses, sehingga AI yang lambat/gagal
// tidak pernah menghalangi upload. Tag manual tidak pernah ditimpa; judul
// hanya berubah bila isi file dibaca dengan izin DAN judul belum pernah
// diubah (judul asli disimpan di original_title).

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { runModuleTagging } from "@/lib/moduleTagging";

// Analisis AI (+ membaca PDF + embedding) bisa lebih dari 10 detik; default Vercel Hobby hanya 10 detik.
export const maxDuration = 60;

export async function POST(request, { params }) {
  try {
    const { id } = await params;

    // Verifikasi pemanggil: harus login, tidak harus uploader modulnya
    // (bisa jalan sebagai job latar belakang oleh sesi yang sama).
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

    const result = await runModuleTagging(id, { allowTitleChange: true });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status || 500 });
    }
    return NextResponse.json(result.data);
  } catch (err) {
    console.error("Gagal memproses saran tag AI:", err);
    return NextResponse.json({ error: "Gagal memproses saran tag." }, { status: 500 });
  }
}

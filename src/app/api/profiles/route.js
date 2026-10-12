// API route: GET /api/profiles
//
// Daftar profil semua pengguna (untuk halaman profil pengguna lain, foto
// avatar di forum/modul, dan profil sendiri setelah refresh). Menggantikan
// data profil contoh yang dulu tertanam di Homepage.jsx.
//
// Privasi: nama asli HANYA dikirim kalau pemiliknya mengaktifkan
// show_real_name (atau kalau itu profil si pemanggil sendiri) — sama seperti
// definisi view public_profiles.

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(request) {
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

    // select("*") supaya tetap jalan walau kolom opsional (mis. goal) belum ada.
    const { data: rows, error } = await supabaseAdmin.from("profiles").select("*").limit(5000);
    if (error) {
      console.error("Gagal mengambil daftar profil:", error);
      return NextResponse.json({ error: "Gagal mengambil daftar profil." }, { status: 500 });
    }

    const profiles = (rows || []).map((r) => {
      const isSelf = r.id === user.id;
      const revealName = isSelf || !!r.show_real_name;
      return {
        username: r.username,
        realName: revealName ? r.real_name || "" : "",
        showRealName: !!r.show_real_name,
        photoUrl: r.photo_url || null,
        headline: r.headline || "",
        interests: r.interests || [],
        skills: r.skills || [],
        goal: r.goal || "",
        focus: r.focus_subject ? { subject: r.focus_subject, topic: r.focus_topic || "" } : null,
        createdAt: r.created_at || null,
        isSelf,
      };
    });

    return NextResponse.json({ profiles });
  } catch (err) {
    console.error("Gagal memproses daftar profil:", err);
    return NextResponse.json({ error: "Gagal mengambil daftar profil." }, { status: 500 });
  }
}

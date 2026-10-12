// API route: PATCH /api/profile
//
// Menyimpan perubahan profil milik sendiri (nama asli + pengaturan tampilnya,
// headline, minat, skill, goal, fokus belajar). Foto profil punya endpoint
// sendiri (/api/profile/photo). Sebelumnya perubahan profil hanya tersimpan di
// memori browser dan hilang saat refresh.
//
// Identitas diambil dari token Supabase (bukan dari body), jadi tidak mungkin
// mengedit profil orang lain.

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const MAX_TEXT = { realName: 80, headline: 160, goal: 300 };
const MAX_TAGS = 20;
const MAX_TAG_CHARS = 40;

function cleanTags(list) {
  if (!Array.isArray(list)) return null;
  const seen = new Set();
  const out = [];
  for (const t of list) {
    if (typeof t !== "string") continue;
    const v = t.trim().slice(0, MAX_TAG_CHARS);
    if (!v || seen.has(v.toLowerCase())) continue;
    seen.add(v.toLowerCase());
    out.push(v);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

export async function PATCH(request) {
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
    const update = {};

    for (const [key, column] of [["realName", "real_name"], ["headline", "headline"], ["goal", "goal"]]) {
      if (body[key] === undefined) continue;
      const v = String(body[key] || "").trim();
      if (v.length > MAX_TEXT[key]) {
        return NextResponse.json({ error: `${key} maksimal ${MAX_TEXT[key]} karakter.` }, { status: 400 });
      }
      update[column] = v || null;
    }
    if (body.showRealName !== undefined) update.show_real_name = !!body.showRealName;
    if (body.interests !== undefined) {
      const tags = cleanTags(body.interests);
      if (!tags) return NextResponse.json({ error: "interests harus berupa daftar." }, { status: 400 });
      update.interests = tags;
    }
    if (body.skills !== undefined) {
      const tags = cleanTags(body.skills);
      if (!tags) return NextResponse.json({ error: "skills harus berupa daftar." }, { status: 400 });
      update.skills = tags;
    }
    if (body.focus !== undefined) {
      if (body.focus === null || !body.focus.subject) {
        update.focus_subject = null;
        update.focus_topic = null;
      } else {
        update.focus_subject = String(body.focus.subject).trim().slice(0, 80) || null;
        update.focus_topic = String(body.focus.topic || "").trim().slice(0, 120) || null;
      }
    }
    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: "Tidak ada perubahan yang dikirim." }, { status: 400 });
    }

    let { error: updateError } = await supabaseAdmin.from("profiles").update(update).eq("id", user.id);
    if (updateError && updateError.code === "42703" && "goal" in update) {
      // Kolom goal belum ada (SQL tahap 3 belum dijalankan): simpan sisanya.
      const { goal, ...withoutGoal } = update;
      if (Object.keys(withoutGoal).length > 0) {
        ({ error: updateError } = await supabaseAdmin.from("profiles").update(withoutGoal).eq("id", user.id));
      } else {
        updateError = null;
      }
    }
    if (updateError) {
      console.error("Gagal menyimpan profil:", updateError);
      return NextResponse.json({ error: "Gagal menyimpan profil. Coba lagi." }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Gagal memproses penyimpanan profil:", err);
    return NextResponse.json({ error: "Gagal menyimpan profil." }, { status: 500 });
  }
}

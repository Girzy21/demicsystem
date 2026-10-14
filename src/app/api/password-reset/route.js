// POST /api/password-reset   (PUBLIK — dipakai halaman /lupa-password)
// Body: { username, note }   note = nama lengkap + kelas, untuk verifikasi oleh admin.
//
// Login memakai username dengan email samaran, jadi reset lewat email tidak
// mungkin. Permintaan ini hanya MENCATAT permintaan; admin yang memverifikasi
// identitas lalu menetapkan password baru dari panel /admin.
//
// Anti-penyalahgunaan:
//   - Jawaban SELALU sama, ada atau tidak usernamenya (tidak bisa dipakai menebak akun).
//   - Maks. 5 permintaan baru per IP per jam (IP disimpan sebagai hash).
//   - Satu permintaan "menunggu" per pengguna; permintaan berulang hanya menambah hitungan.
//   - Akun admin diabaikan (password admin tidak direset lewat jalur ini).
import crypto from "crypto";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAccess } from "@/lib/adminAuth";

export const dynamic = "force-dynamic";

const IP_LIMIT = 5;
const GENERIC = {
  ok: true,
  message: "Jika username itu terdaftar, permintaanmu sudah dikirim ke admin. Admin akan menghubungimu langsung untuk memverifikasi identitas dan memberikan password baru.",
};

function ipHash(request) {
  const ip = (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || request.headers.get("x-real-ip") || "unknown";
  return crypto.createHash("sha256").update(ip + (process.env.PASSWORD_RESET_SALT || "demic")).digest("hex").slice(0, 32);
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    if (body.website) return NextResponse.json(GENERIC); // honeypot: bot mengisi kolom tersembunyi
    const username = String(body.username || "").trim();
    const note = String(body.note || "").trim();
    if (username.length < 3 || username.length > 40) {
      return NextResponse.json({ error: "Username tidak valid." }, { status: 400 });
    }
    if (note.length < 5) {
      return NextResponse.json({ error: "Isi nama lengkap dan kelasmu agar admin bisa memverifikasi." }, { status: 400 });
    }
    if (note.length > 300) {
      return NextResponse.json({ error: "Keterangan maksimal 300 karakter." }, { status: 400 });
    }

    const hash = ipHash(request);
    const since = new Date(Date.now() - 3600000).toISOString();
    const { count } = await supabaseAdmin
      .from("password_reset_requests")
      .select("*", { count: "exact", head: true })
      .eq("ip_hash", hash)
      .gte("last_requested_at", since);
    if ((count || 0) >= IP_LIMIT) {
      return NextResponse.json({ error: "Terlalu banyak permintaan. Coba lagi dalam satu jam." }, { status: 429 });
    }

    let { data: prof } = await supabaseAdmin.from("profiles").select("id, username").eq("username", username).maybeSingle();
    if (!prof) {
      const pattern = username.replace(/[\\%_]/g, (m) => "\\" + m);
      ({ data: prof } = await supabaseAdmin.from("profiles").select("id, username").ilike("username", pattern).limit(1).maybeSingle());
    }
    if (!prof) return NextResponse.json(GENERIC);
    const access = await getAccess(prof.id);
    if (access && access.is_admin) return NextResponse.json(GENERIC);

    const nowIso = new Date().toISOString();
    const { data: pending } = await supabaseAdmin
      .from("password_reset_requests")
      .select("id, note, request_count")
      .eq("user_id", prof.id)
      .eq("status", "pending")
      .maybeSingle();
    if (pending) {
      await supabaseAdmin
        .from("password_reset_requests")
        .update({
          request_count: (pending.request_count || 1) + 1,
          note: `${pending.note}\n— ${note}`.slice(0, 600),
          last_requested_at: nowIso,
          ip_hash: hash,
        })
        .eq("id", pending.id);
      return NextResponse.json(GENERIC);
    }
    const { error } = await supabaseAdmin
      .from("password_reset_requests")
      .insert({ user_id: prof.id, username: prof.username, note, ip_hash: hash, last_requested_at: nowIso });
    if (error && error.code !== "23505") {
      console.error("Gagal menyimpan permintaan reset password:", error);
      return NextResponse.json({ error: "Gagal mengirim permintaan. Coba lagi." }, { status: 500 });
    }
    return NextResponse.json(GENERIC);
  } catch (err) {
    console.error("Gagal memproses permintaan reset password:", err);
    return NextResponse.json({ error: "Gagal mengirim permintaan." }, { status: 500 });
  }
}

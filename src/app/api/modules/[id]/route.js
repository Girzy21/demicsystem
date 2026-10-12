// API route: PATCH/DELETE /api/modules/[id]
//
// PATCH  -> mengedit modul milik sendiri: judul, deskripsi, dan jenis modul
//           (materi / latihan soal; pilihan pemilik tidak akan ditimpa AI lagi).
//           Ini yang membuat janji di UI "judul yang diubah AI tetap bisa
//           kamu edit kapan saja" benar-benar berfungsi — termasuk
//           mengembalikan ke judul asli (original_title). Setelah diedit,
//           modul di-embed ulang supaya pencarian ikut berubah.
// DELETE -> menghapus modul milik sendiri. Berbeda dari post/balasan
//           (gambar sisa di Cloudinary cuma biaya kecil), file modul bisa
//           besar, jadi aset Cloudinary-nya IKUT dihapus supaya kuota
//           storage benar-benar kembali — bukan sekadar disembunyikan.

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { cloudinary } from "@/lib/cloudinary";
import { embedModule } from "@/lib/embeddings";

const MAX_TITLE_CHARS = 200;
const MAX_DESCRIPTION_CHARS = 2000;

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

export async function PATCH(request, { params }) {
  try {
    const { id } = await params;
    const { user, error: authFail } = await getUser(request);
    if (authFail) return authFail;

    const body = await request.json().catch(() => ({}));
    const update = {};

    if (body.title !== undefined) {
      const title = String(body.title || "").trim();
      if (!title) return NextResponse.json({ error: "Judul tidak boleh kosong." }, { status: 400 });
      if (title.length > MAX_TITLE_CHARS) {
        return NextResponse.json({ error: `Judul maksimal ${MAX_TITLE_CHARS} karakter.` }, { status: 400 });
      }
      update.title = title;
    }
    if (body.description !== undefined) {
      const description = String(body.description || "").trim();
      if (description.length > MAX_DESCRIPTION_CHARS) {
        return NextResponse.json({ error: `Deskripsi maksimal ${MAX_DESCRIPTION_CHARS} karakter.` }, { status: 400 });
      }
      update.description = description || null;
    }
    if (body.isExercise !== undefined) {
      if (typeof body.isExercise !== "boolean") {
        return NextResponse.json({ error: "isExercise harus true atau false." }, { status: 400 });
      }
      update.is_exercise = body.isExercise;
      update.exercise_set_by = "user_edit"; // pilihan pemilik: AI tidak menimpa lagi
    }
    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: "Tidak ada perubahan yang dikirim." }, { status: 400 });
    }

    const { data: existing, error: fetchError } = await supabaseAdmin
      .from("modules")
      .select("id, uploader_id, title, original_title")
      .eq("id", id)
      .single();
    if (fetchError || !existing) {
      return NextResponse.json({ error: "Modul tidak ditemukan." }, { status: 404 });
    }
    if (existing.uploader_id !== user.id) {
      return NextResponse.json({ error: "Kamu cuma bisa mengedit modul milik sendiri." }, { status: 403 });
    }

    // Kembali ke judul asli = tidak ada lagi "judul yang disesuaikan AI".
    if (update.title && existing.original_title && update.title === existing.original_title) {
      update.original_title = null;
    }

    const baseSelect = "id, title, original_title, description";
    let { data: updated, error: updateError } = await supabaseAdmin
      .from("modules")
      .update(update)
      .eq("id", id)
      .select(`${baseSelect}, is_exercise, exercise_set_by`)
      .single();
    if (updateError && updateError.code === "42703" && !("is_exercise" in update)) {
      // Kolom jenis belum ada (SQL tahap 3 belum dijalankan) — untuk edit judul/deskripsi tetap jalan.
      ({ data: updated, error: updateError } = await supabaseAdmin
        .from("modules")
        .update(update)
        .eq("id", id)
        .select(baseSelect)
        .single());
    }
    if (updateError) {
      console.error("Gagal mengedit modul:", updateError);
      return NextResponse.json({ error: "Gagal menyimpan perubahan modul." }, { status: 500 });
    }

    // Judul/deskripsi memengaruhi pencarian — perbarui embedding (tidak pernah melempar error).
    await embedModule(id);

    return NextResponse.json({
      module: {
        id: updated.id,
        title: updated.title,
        originalTitle: updated.original_title || null,
        description: updated.description || "",
        isExercise: !!updated.is_exercise,
        exerciseSetBy: updated.exercise_set_by || "user",
      },
    });
  } catch (err) {
    console.error("Gagal memproses edit modul:", err);
    return NextResponse.json({ error: "Gagal mengedit modul." }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const { user, error: authFail } = await getUser(request);
    if (authFail) return authFail;

    // Pastikan kepemilikan sebelum menghapus.
    const { data: existing, error: fetchError } = await supabaseAdmin
      .from("modules")
      .select("id, uploader_id, cloudinary_public_id, file_type")
      .eq("id", id)
      .single();

    if (fetchError || !existing) {
      return NextResponse.json({ error: "Modul tidak ditemukan." }, { status: 404 });
    }
    if (existing.uploader_id !== user.id) {
      return NextResponse.json({ error: "Kamu cuma bisa menghapus modul milik sendiri." }, { status: 403 });
    }

    // Hapus file asli dari Cloudinary dulu. resource_type harus sama dengan
    // saat upload (lihat POST /api/modules): PDF dan gambar di-upload sebagai
    // "image" (agar bisa pratinjau inline), selain itu "raw". Tidak fatal
    // kalau gagal (aset mungkin sudah hilang) — baris database tetap dihapus.
    if (existing.cloudinary_public_id) {
      const previewableTypes = new Set(["PDF", "PNG", "JPG", "JPEG", "GIF", "WEBP", "SVG"]);
      const resourceType = previewableTypes.has((existing.file_type || "").toUpperCase()) ? "image" : "raw";
      try {
        await cloudinary.uploader.destroy(existing.cloudinary_public_id, { resource_type: resourceType });
      } catch (cloudinaryErr) {
        console.error("Gagal menghapus file Cloudinary (lanjut menghapus dari DB):", cloudinaryErr);
      }
    }

    const { error: deleteError } = await supabaseAdmin.from("modules").delete().eq("id", id);
    if (deleteError) {
      console.error("Gagal menghapus modul:", deleteError);
      return NextResponse.json({ error: "Gagal menghapus modul." }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Gagal memproses penghapusan modul:", err);
    return NextResponse.json({ error: "Gagal menghapus modul." }, { status: 500 });
  }
}

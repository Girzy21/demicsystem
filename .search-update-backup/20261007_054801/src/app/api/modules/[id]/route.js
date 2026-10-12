// API route: DELETE /api/modules/[id]
//
// Deletes a module the caller uploaded. Unlike posts/replies (where
// leftover Cloudinary images are a minor storage cost), module files can
// be large arbitrary files, so this explicitly removes the Cloudinary
// asset too — not just the database row — to actually free up storage
// quota, not just hide the file from the app.

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { cloudinary } from "@/lib/cloudinary";

export async function DELETE(request, { params }) {
  try {
    const { id } = await params;

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

    // Confirm ownership before deleting — someone else's user id should
    // never be able to delete this module even if they somehow guess its id.
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

    // Remove the actual file from Cloudinary first. resource_type must
    // match what was used at upload time (see /api/modules POST) or
    // Cloudinary won't find the asset to delete: PDFs and images were
    // uploaded as "image" (needed for inline preview support), everything
    // else as "raw". Not fatal if this fails (the asset might already be
    // gone) — the database row is still removed below either way, so the
    // module disappears from the app regardless.
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
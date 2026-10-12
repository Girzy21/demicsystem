// lib/cloudinaryUploads.js
//
// Upload langsung dari browser ke Cloudinary (signed upload).
//
// KENAPA: di Vercel, body request ke fungsi API dibatasi 4,5 MB. Upload yang
// lewat server (modul, gambar forum, foto profil) gagal untuk file lebih besar.
// Alurnya sekarang:
//   1. Browser minta izin   -> POST /api/cloudinary-signature  (buildSignedUpload)
//   2. Browser upload file  -> langsung ke Cloudinary (file tidak lewat server kita)
//   3. Browser kirim metadata ke API kita (JSON kecil) bersama public_id hasil upload
//   4. Server MEMVERIFIKASI upload itu ke Cloudinary (verifyUpload) — tidak
//      pernah percaya URL/ukuran dari browser — lalu menyimpan ke database.
//
// Keamanan: parameter upload (folder, public_id, transformasi, context) ditentukan
// SERVER dan ikut ditandatangani, jadi browser tidak bisa mengubahnya. Tiap upload
// ditandai context uploader=<user id>; verifikasi memastikan file itu memang
// diunggah oleh pengguna yang sama.

import { cloudinary } from "@/lib/cloudinary";

const MB = 1024 * 1024;

// Paket gratis Cloudinary membatasi satu file maksimal 10 MB. Kalau pakai paket
// berbayar, naikkan lewat env MAX_MODULE_UPLOAD_MB.
export const MODULE_MAX_BYTES = (Number(process.env.MAX_MODULE_UPLOAD_MB) || 10) * MB;
export const FORUM_IMAGE_MAX_BYTES = 8 * MB;
export const AVATAR_MAX_BYTES = 5 * MB;
export const MAX_FORUM_IMAGES = 4;

export const IMAGE_FORMATS = ["jpg", "jpeg", "png", "webp"];
export const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];

const FRIENDLY_TYPE_LABELS = {
  pdf: "PDF",
  doc: "DOCX",
  docx: "DOCX",
  ppt: "PPTX",
  pptx: "PPTX",
  txt: "TXT",
  xls: "XLSX",
  xlsx: "XLSX",
  csv: "CSV",
  zip: "ZIP",
};

export function deriveFileType(filename) {
  const name = String(filename || "");
  const ext = (name.split(".").pop() || "").toLowerCase();
  if (!ext || ext === name.toLowerCase()) return "FILE"; // tanpa ekstensi
  return FRIENDLY_TYPE_LABELS[ext] || ext.toUpperCase();
}

// PDF dan gambar diunggah sebagai "image" (agar bisa dipratinjau inline);
// selain itu "raw". Harus sama dengan logika hapus modul.
const PREVIEWABLE_TYPES = new Set(["PDF", "PNG", "JPG", "JPEG", "GIF", "WEBP", "SVG"]);
export function resourceTypeForFileType(fileType) {
  return PREVIEWABLE_TYPES.has(String(fileType || "").toUpperCase()) ? "image" : "raw";
}

// Nama file aman untuk public_id Cloudinary (tanpa spasi/simbol aneh).
export function safeBaseName(filename) {
  const base = String(filename || "").replace(/\.[^.]+$/, "");
  const safe = base
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return safe || "file";
}

function extensionOf(filename) {
  const m = String(filename || "").match(/\.([A-Za-z0-9]{1,8})$/);
  return m ? m[1].toLowerCase() : "";
}

export const UPLOAD_PURPOSES = {
  module: { folder: "modules", maxBytes: MODULE_MAX_BYTES, imagesOnly: false },
  forum: { folder: "forum-attachments", maxBytes: FORUM_IMAGE_MAX_BYTES, imagesOnly: true, transformation: "c_limit,w_1600" },
  avatar: { folder: "avatars", maxBytes: AVATAR_MAX_BYTES, imagesOnly: true, transformation: "c_fill,w_400,h_400" },
};

function formatMb(bytes) {
  return `${Math.round((bytes / MB) * 10) / 10} MB`;
}

// Membuat parameter + signature untuk satu upload langsung.
// Mengembalikan { ok: false, status, error } atau
// { ok: true, cloudName, apiKey, signature, resourceType, params }.
// `params` HARUS dikirim apa adanya oleh browser bersama file.
export function buildSignedUpload({ purpose, user, filename, contentType, size }) {
  const cfg = UPLOAD_PURPOSES[purpose];
  if (!cfg) return { ok: false, status: 400, error: `purpose harus salah satu dari: ${Object.keys(UPLOAD_PURPOSES).join(", ")}` };

  const fileSize = Number(size);
  if (!Number.isFinite(fileSize) || fileSize <= 0) {
    return { ok: false, status: 400, error: "Ukuran file tidak valid." };
  }
  if (fileSize > cfg.maxBytes) {
    return { ok: false, status: 400, error: `Ukuran file maksimal ${formatMb(cfg.maxBytes)}.` };
  }
  if (cfg.imagesOnly && !IMAGE_MIME_TYPES.includes(String(contentType || ""))) {
    return { ok: false, status: 400, error: "Format gambar tidak didukung. Pakai JPG, PNG, atau WebP." };
  }

  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  if (!apiSecret || !apiKey || !cloudName) {
    return { ok: false, status: 500, error: "Cloudinary belum dikonfigurasi di server." };
  }

  let resourceType = "image";
  const params = {
    timestamp: String(Math.round(Date.now() / 1000)),
    folder: cfg.folder,
    // Menandai pemilik & tujuan upload ini; keduanya dicek lagi saat verifikasi.
    context: `uploader=${user.id}|purpose=${purpose}`,
  };

  if (purpose === "module") {
    const fileType = deriveFileType(filename);
    resourceType = resourceTypeForFileType(fileType);
    const base = `${Date.now()}_${safeBaseName(filename)}`;
    // File "raw" membawa ekstensi di public_id agar nama file hasil unduhan benar.
    const ext = extensionOf(filename);
    params.public_id = resourceType === "raw" && ext ? `${base}.${ext}` : base;
  } else if (purpose === "forum") {
    params.public_id = `${user.id}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    params.transformation = cfg.transformation;
  } else if (purpose === "avatar") {
    // public_id tetap -> mengunggah ulang MENGGANTI foto lama, bukan menumpuk.
    params.public_id = `user_${user.id}`;
    params.overwrite = "true";
    params.invalidate = "true";
    params.transformation = cfg.transformation;
  }

  const signature = cloudinary.utils.api_sign_request(params, apiSecret);
  return { ok: true, cloudName, apiKey, signature, resourceType, params };
}

async function discardAsset(publicId, resourceType) {
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
  } catch (err) {
    console.error("Gagal membersihkan upload yang ditolak:", err.message);
  }
}

// Memverifikasi bahwa upload benar-benar ada di Cloudinary, milik user ini,
// berada di folder yang benar, dan tidak melebihi batas. Data dari Cloudinary
// (bukan dari browser) yang dipakai untuk menyimpan URL & ukuran.
// Mengembalikan { ok: true, resource } atau { ok: false, status, error }.
export async function verifyUpload({ publicId, resourceType, purpose, userId }) {
  const cfg = UPLOAD_PURPOSES[purpose];
  if (!cfg) return { ok: false, status: 400, error: "Jenis upload tidak dikenal." };
  if (typeof publicId !== "string" || !publicId || publicId.includes("..") || publicId.length > 300) {
    return { ok: false, status: 400, error: "Data upload tidak valid." };
  }
  // Akun Cloudinary lama ("fixed folder mode") memberi public_id berawalan folder;
  // akun baru ("dynamic folder mode") tidak — foldernya ada di asset_folder.
  // Kedua bentuk diterima; pemilik & tujuan upload diverifikasi lewat context.
  if (purpose === "avatar" && publicId !== `avatars/user_${userId}` && publicId !== `user_${userId}`) {
    return { ok: false, status: 400, error: "Data upload tidak valid." };
  }
  if (!["image", "raw"].includes(resourceType)) {
    return { ok: false, status: 400, error: "Data upload tidak valid." };
  }

  let resource;
  try {
    resource = await cloudinary.api.resource(publicId, { resource_type: resourceType, context: true });
  } catch (err) {
    console.error("Verifikasi upload gagal:", err?.error?.message || err.message);
    return { ok: false, status: 400, error: "File tidak ditemukan di penyimpanan — upload mungkin belum selesai. Coba lagi." };
  }

  const custom = resource?.context?.custom || {};
  if (custom.uploader !== userId) {
    return { ok: false, status: 403, error: "Upload ini bukan milik akunmu." };
  }
  const inFolder = publicId.startsWith(`${cfg.folder}/`) || resource.asset_folder === cfg.folder;
  if (custom.purpose !== purpose || !inFolder) {
    return { ok: false, status: 400, error: "Data upload tidak valid." };
  }
  if (Number(resource.bytes) > cfg.maxBytes) {
    await discardAsset(publicId, resourceType);
    return { ok: false, status: 400, error: `Ukuran file maksimal ${formatMb(cfg.maxBytes)}.` };
  }
  if (cfg.imagesOnly && !IMAGE_FORMATS.includes(String(resource.format || "").toLowerCase())) {
    await discardAsset(publicId, resourceType);
    return { ok: false, status: 400, error: "Format gambar tidak didukung. Pakai JPG, PNG, atau WebP." };
  }
  return { ok: true, resource };
}

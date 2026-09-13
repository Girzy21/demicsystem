// Konfigurasi Cloudinary SDK — HANYA dipakai di backend (API routes).
// API Secret di sini tidak pernah terkirim ke browser; SDK cuma
// dipakai untuk generate "signature" yang membuktikan sebuah
// permintaan upload itu sah, tanpa Secret itu sendiri pernah keluar
// dari server.

import { v2 as cloudinary } from "cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export { cloudinary };
// src/app/brand.jsx — identitas w3study: nama, font, dan logo.
//
// FONT (dimuat lewat next/font: di-hosting sendiri oleh situsmu saat build,
// tanpa permintaan ke server Google dari browser pengunjung):
//   - Space Grotesk : nama situs & judul. Huruf geometris yang tegas dan agak
//     "teknis"; angka '3' pada "w3study" tampil jelas dan khas.
//   - Inter         : teks isi. Sangat terbaca di ukuran kecil (kartu, tombol,
//     tabel), cocok untuk antarmuka yang padat informasi.
// Dipakai di login & Homepage lewat SANS_STACK / HEADING_STACK; fallback ke
// Helvetica/Arial kalau font gagal dimuat.
import { Inter, Space_Grotesk } from "next/font/google";

const inter = Inter({ subsets: ["latin"], display: "swap" });
const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], display: "swap" });

export const BRAND_NAME = "w3study";
export const SANS_STACK = `${inter.style.fontFamily}, 'Helvetica Neue', Arial, sans-serif`;
export const HEADING_STACK = `${spaceGrotesk.style.fontFamily}, 'Helvetica Neue', Arial, sans-serif`;

// Tanda "w" putih (sama dengan ikon tab). Taruh di dalam kotak gradien biru.
export function W3Mark({ size = 18, color = "#FFFFFF" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ display: "block" }}>
      <path d="M4.9 7.5 L8.25 16.5 L12 9.75 L15.75 16.5 L19.1 7.5" stroke={color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

"use client";

// src/app/components/ModuleBankBanner.jsx
//
// Banner Bank Modul dengan latar FluxLines (garis aliran WebGL yang bereaksi
// pada kursor; klik untuk pusaran). Ditampilkan di tampilan folder saja.
// Kalau WebGL2 tidak tersedia, FluxLines tidak menggambar apa pun dan yang
// tampak hanya latar gradien + teks (tetap rapi).
//
// Membutuhkan: ./FluxLines.jsx (+ FluxLines.css) dan @/app/brand (font judul).

import React from "react";
import FluxLines from "./FluxLines";
import { HEADING_STACK } from "@/app/brand";

export default function ModuleBankBanner({ ctx, count, loading }) {
  const { c, sans } = ctx;
  return (
    <div style={{ padding: "0 32px", marginBottom: 14 }}>
      <div style={{ position: "relative", height: 150, borderRadius: 20, overflow: "hidden", background: `linear-gradient(135deg, ${c.blueSoft}, #FFFFFF)`, border: `1px solid ${c.line}` }}>
        <FluxLines
          lightMode
          transparent
          colors={["#2C7BE5", "#6FB3E8", "#8A5CD9"]}
          speed={0.35}
          scale={1.3}
          opacity={0.9}
          dpr={1.5}
          flowDirection="right"
          style={{ position: "absolute", inset: 0 }}
        />
        <div style={{ position: "relative", zIndex: 1, padding: "28px 30px", pointerEvents: "none" }}>
          <div style={{ fontFamily: HEADING_STACK, fontWeight: 700, fontSize: 26, color: c.ink, letterSpacing: -0.4, marginBottom: 6 }}>Module Bank</div>
          <div style={{ fontFamily: sans, fontSize: 13, color: c.inkMuted, lineHeight: 1.5, maxWidth: 420 }}>
            Materi dan latihan soal yang dibagikan teman-temanmu — pilih subject untuk mulai menjelajah.
          </div>
          <div style={{ fontFamily: sans, fontSize: 11.5, color: c.inkFaint, marginTop: 10 }}>{loading ? "Memuat modul…" : `${count} modul tersedia`}</div>
        </div>
      </div>
    </div>
  );
}

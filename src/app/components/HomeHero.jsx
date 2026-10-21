"use client";

// src/app/components/HomeHero.jsx
//
// Judul beranda: "w3study" memakai komponen TechText (teks kanvas interaktif:
// arahkan kursor untuk melihat garis bantu huruf, tarik atau klik hurufnya).
// Animasi pembuka hanya diputar SEKALI per sesi browser supaya tidak berulang
// setiap kali pindah menu. Di sebelahnya ada tagline dan hitungan singkat
// isi ekosistem (diambil dari data yang sudah dimuat Homepage).
//
// Membutuhkan: ./TechText.jsx (+ TechText.css) dan @/app/brand (font judul).

import React, { useState } from "react";
import TechText from "./TechText";
import { HEADING_STACK } from "@/app/brand";

const FLAG = "w3study:hero-intro";

function pickIntro() {
  try {
    if (window.sessionStorage.getItem(FLAG)) return "none";
    window.sessionStorage.setItem(FLAG, "1");
  } catch {
    /* penyimpanan dinonaktifkan: tetap putar animasi */
  }
  return "assemble";
}

function Stat({ value, label, c, sans }) {
  return (
    <div style={{ padding: "8px 14px", borderRadius: 12, background: c.card, border: `1px solid ${c.line}`, minWidth: 74 }}>
      <div style={{ fontFamily: sans, fontWeight: 700, fontSize: 17, color: c.ink, lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontFamily: sans, fontSize: 10.5, color: c.inkFaint, marginTop: 2 }}>{label}</div>
    </div>
  );
}

export default function HomeHero({ ctx }) {
  const { c, sans, localModules, localPosts, profilesByUsername } = ctx;
  const [intro] = useState(pickIntro);
  const modules = (localModules || []).length;
  const posts = (localPosts || []).length;
  const people = Object.keys(profilesByUsername || {}).length;

  return (
    <div style={{ padding: "0 32px", marginBottom: 14 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 14 }}>
        <div style={{ flex: "1 1 460px", height: 176, minWidth: 0, color: c.ink }}>
          <TechText
            text="w3study"
            fontFamily={HEADING_STACK}
            fontWeight={700}
            fontSize={150}
            letterSpacing={-0.04}
            color={c.ink}
            accentColor={c.blue}
            align="left"
            reach={180}
            specks={10}
            labels={false}
            intro={intro}
            introDuration={2}
          />
        </div>
        <div style={{ flex: "0 1 300px", minWidth: 220 }}>
          <div style={{ fontFamily: sans, fontSize: 13.5, color: c.inkMuted, lineHeight: 1.55, marginBottom: 12 }}>
            Modul, diskusi, dan teman belajar — satu ekosistem akademik untuk sekolahmu.
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Stat value={modules} label="modul" c={c} sans={sans} />
            <Stat value={people} label="orang" c={c} sans={sans} />
            <Stat value={posts} label="post forum" c={c} sans={sans} />
          </div>
        </div>
      </div>
    </div>
  );
}

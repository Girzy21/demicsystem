"use client";

// src/app/components/BrandTitle.jsx
//
// Judul kecil "w3study" (komponen TechText) yang menggantikan sapaan
// "Welcome, <user>" di bilah atas menu Home. Hover pada huruf menampilkan garis
// bantu; animasi pembuka hanya diputar SEKALI per sesi browser.
//
// Membutuhkan: ./TechText.jsx (+ TechText.css) dan @/app/brand (font judul).

import React, { useState } from "react";
import TechText from "./TechText";
import { HEADING_STACK } from "@/app/brand";

const FLAG = "w3study:title-intro";

function pickIntro() {
  try {
    if (window.sessionStorage.getItem(FLAG)) return "none";
    window.sessionStorage.setItem(FLAG, "1");
  } catch {
    /* penyimpanan dinonaktifkan: tetap putar animasi */
  }
  return "assemble";
}

export default function BrandTitle({ ctx }) {
  const { c } = ctx;
  const [intro] = useState(pickIntro);
  return (
    <div role="heading" aria-level={1} style={{ width: 190, maxWidth: "100%", height: 48 }}>
      <TechText
        text="w3study"
        fontFamily={HEADING_STACK}
        fontWeight={700}
        fontSize={64}
        letterSpacing={-0.04}
        color={c.ink}
        accentColor={c.blue}
        align="left"
        reach={70}
        specks={0}
        labels={false}
        draggable={false}
        clickKick={false}
        sweep={false}
        intro={intro}
        introDuration={1.4}
      />
    </div>
  );
}

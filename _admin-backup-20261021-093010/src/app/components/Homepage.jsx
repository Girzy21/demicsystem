import ModuleBankBanner from "./ModuleBankBanner";
import HomeHero from "./HomeHero";
import { sendOnEnter, sendOnEnterInput } from "./uxHelpers";
import ChatRoom, { ChatPreviewStrip, ChatFeedSync } from "./ChatRoom";
import { SANS_STACK, HEADING_STACK, BRAND_NAME, W3Mark } from "@/app/brand";
import PeopleDirectory from "./PeopleDirectory";
import React, { useState, useMemo, useRef, useEffect } from "react";
import { supabase } from "@/lib/supabaseClient";

// =====================================================================
// DEV NOTE — search roadmap (read this before touching search code)
// =====================================================================
// The homepage search bar (SearchHub, runUniversalSearch, SEARCH_INDEX
// below) is currently a prototype limited to two corpora: Bank Modul
// (MODULES) and Forum Diskusi (FORUM_POSTS). That scope is temporary.
//
// The intended end state is a single, general-purpose, intelligent search
// across the whole ecosystem — not "search modules" and "search forum" as
// two separate narrow tools. It should understand *intent*, not just match
// keywords, so a query like "template proposal CAS" is read as "find me a
// document of this type" and returns the closest matching file from
// wherever it actually lives (Bank Modul, a forum attachment, a future
// templates/resources area, etc.) — ranked by fit to the kind of thing
// being asked for, not literal title overlap. Other examples it should
// eventually handle: "contoh lab report fisika", "rubrik TOK essay",
// "silabus lengkap Math".
//
// See the longer note right above runUniversalSearch() for the concrete
// implementation implications (real embeddings, broader corpus,
// intent detection, learned ranking instead of the hand-authored
// SEARCH_INDEX). Treat SEARCH_INDEX/runUniversalSearch as a placeholder
// shape to design the UI against, not a spec to keep extending by hand.
// =====================================================================

// ---- shared avatar helper (same generation logic as the auth page, so a user's
// avatar looks identical across screens) -------------------------------------------------

function hashStr(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

const PALETTES = [
  ["#DCEAFB", "#2C7BE5"],
  ["#E4F0FC", "#1B5FB8"],
  ["#D9E9FB", "#3A8AE0"],
  ["#E8F1FC", "#1F63A8"],
  ["#DFECFB", "#2E76CC"],
];

function UsernameAvatar({ username, size = 40, photoUrl = null }) {
  const seed = useMemo(() => hashStr(username || "?"), [username]);
  const palette = PALETTES[seed % PALETTES.length];
  const cells = useMemo(() => {
    const grid = [];
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 3; x++) {
        const bit = (seed >> (y * 3 + x)) & 1;
        grid.push({ x, y, on: bit === 1 });
        if (x < 2) grid.push({ x: 4 - x, y, on: bit === 1 });
      }
    }
    return grid;
  }, [seed]);
  const cellSize = size / 5;

  if (photoUrl) {
    return (
      <img
        src={photoUrl}
        alt={`Foto profil ${username}`}
        width={size}
        height={size}
        style={{ width: size, height: size, borderRadius: 9, flexShrink: 0, objectFit: "cover" }}
      />
    );
  }

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ borderRadius: 9, flexShrink: 0 }} role="img" aria-label={`Avatar untuk ${username}`}>
      <rect width={size} height={size} fill={palette[0]} />
      {cells.map((c, i) => (c.on ? <rect key={i} x={c.x * cellSize} y={c.y * cellSize} width={cellSize} height={cellSize} fill={palette[1]} /> : null))}
    </svg>
  );
}

// ---- static placeholder data -------------------------------------------------
//
// Data model note (for future ML classification): each module carries `tags`,
// where every tag has a `source` ("manual" | "ai") and a `confidence` (only
// meaningful for "ai" tags). Nothing in this prototype computes those values —
// they're just shaped this way now so that when auto-classification lands
// later, the UI (badges, review queue, confidence styling) doesn't need to be
// redesigned, only fed real numbers.

// NOTE: CURRENT_USER used to be a hardcoded module-level constant here
// ("kuncipas"). It's now derived from the currentUsername prop inside the
// Homepage() component below, once real login is wired up — see the const
// CURRENT_USER = currentUsername line near the top of the function body.

// ---- user profile data model -------------------------------------------------
//
// Identity model: `username` is the only thing that ever appears in forum
// posts, replies, module uploads, or anywhere else content is attributed.
// `realName` is entirely optional and, even when filled in, only becomes
// visible to other people if `showRealName` is explicitly turned on by the
// profile's owner. Nothing outside the profile page itself ever reads
// realName directly — see ForumSection/BankModulSection/ActivityFeed, which
// only ever render `.author`/`.uploader`/`.user` (the username string).
//
// Bio is intentionally a small, structured set rather than one free-text
// blob: `headline` (one-line self-intro), `interests` and `skills` (tag
// lists, same visual language as module tags), and `focus` (what
// subject/topic they're currently spending time on — optional, ties back
// into the subject/topic vocabulary already used across the app). This is a
// first draft shape, meant to be revised.
// ---- upload langsung ke Cloudinary (anti batas 4,5 MB Vercel) -----------------------------------
// File TIDAK lewat server kita: browser minta tanda tangan ke /api/cloudinary-signature
// (server menentukan folder, nama file, transformasi, dan batas ukuran), lalu
// mengunggah langsung ke Cloudinary. Ke server hanya dikirim JSON kecil berisi
// public_id hasil upload, yang diverifikasi server sebelum disimpan.
// purpose: "module" | "forum" | "avatar". Mengembalikan { publicId, resourceType }.
async function uploadDirectToCloudinary(file, purpose, token) {
  const fail = (message) => {
    const e = new Error(message);
    e.uploadMessage = message; // pesan yang aman ditampilkan ke pengguna
    return e;
  };
  const sigRes = await fetch("/api/cloudinary-signature", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ purpose, filename: file.name || "image.jpg", contentType: file.type, size: file.size }),
  });
  const sig = await sigRes.json().catch(() => ({}));
  if (!sigRes.ok) throw fail(sig.error || "Gagal menyiapkan upload.");

  const fd = new FormData();
  fd.append("file", file);
  for (const [key, value] of Object.entries(sig.params)) fd.append(key, String(value));
  fd.append("api_key", sig.apiKey);
  fd.append("signature", sig.signature);
  const upRes = await fetch(`https://api.cloudinary.com/v1_1/${sig.cloudName}/${sig.resourceType}/upload`, { method: "POST", body: fd });
  const up = await upRes.json().catch(() => ({}));
  if (!upRes.ok) throw fail((up.error && up.error.message) || "Upload ke penyimpanan gagal. Coba lagi.");
  return { publicId: up.public_id, resourceType: sig.resourceType };
}

// Profil kosong untuk username yang belum (atau tidak) punya data profil.
// Data profil asli dimuat dari GET /api/profiles (lihat Homepage).
function emptyProfile(username) {
  return { username, realName: "", showRealName: false, photoUrl: null, headline: "", interests: [], skills: [], goal: "", focus: null, joined: null };
}

// "2026-08-17T..." -> "Agustus 2026"
function formatJoinedId(iso) {
  const d = new Date(iso);
  if (!iso || isNaN(d.getTime())) return null;
  const label = d.toLocaleDateString("id-ID", { month: "long", year: "numeric" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

// Bentuk profil dari GET /api/profiles -> bentuk yang dipakai UI profil.
function profileFromApi(row) {
  return {
    username: row.username,
    realName: row.realName || "",
    showRealName: !!row.showRealName,
    photoUrl: row.photoUrl || null,
    headline: row.headline || "",
    interests: row.interests || [],
    skills: row.skills || [],
    goal: row.goal || "",
    focus: row.focus || null,
    joined: formatJoinedId(row.createdAt),
  };
}

const NAV_ITEMS = [
  { key: "home", label: "Home", icon: "⌂" },
  { key: "modules", label: "Module Bank", icon: "▤" },
  { key: "activity", label: "Recent Activity", icon: "◷" },
  { key: "forum", label: "Discussion Forum", icon: "◔" },
  { key: "people", label: "People", icon: "◎" },
  { key: "profile", label: "Profile", icon: "◐" },
];

// Folder tree: Subject → Topic. This is the primary organizing structure —
// browsing feels like a file manager, not a filtered flat list.
//
// CAS (Creativity, Activity, Service) is an IB DP core component, not a
// subject with a syllabus — its "topics" are the three CAS strands plus the
// CAS Project.
//
// Philosophy isn't taught at school yet, so it isn't a real subject folder
// with a syllabus either — it's kept here as a lightweight space purely for
// sharing readings, thoughts, and discussion, not official course material.
// Its topics reflect that (broad themes, not curriculum units), and modules
// filed under it are tagged as shares rather than study material (see
// MODULES below).
const FOLDER_TREE = {
  Physics: ["Mechanics", "Waves & Oscillation", "Thermal Physics", "Electricity & Magnetism"],
  Chemistry: ["Organic Chemistry", "Atomic Structure", "Equilibrium", "Acids & Bases"],
  // Math AA and Math AI used to be separate subjects (mirroring the IB's
  // "Analysis & Approaches" / "Applications & Interpretation" split). Merged
  // into one Math folder per explicit requirement — the SL/HL-style route
  // distinction isn't tracked anymore, just the topic itself. Topic list is
  // the union of both former lists, de-duplicated.
  Math: ["Calculus", "Algebra", "Statistics & Probability", "Geometry & Trigonometry", "Modelling"],
  Biology: ["Cell Biology", "Genetics", "Ecology", "Human Physiology"],
  Economics: ["Microeconomics", "Macroeconomics", "International Trade"],
  "Business Mgmt": ["Marketing", "Finance & Accounts", "Human Resources"],
  // Was "English Lit" — merged/renamed to plain "English" per explicit requirement.
  English: ["Poetry Analysis", "Prose Fiction", "Paper 2 Comparative"],
  History: ["Cold War", "Authoritarian States", "Independence Movements"],
  TOK: ["Knowledge Questions", "Essay Prep", "Exhibition"],
  CAS: ["Creativity", "Activity", "Service", "CAS Project"],
  Philosophy: ["Bacaan & Renungan", "Etika Sehari-hari", "Obrolan Filosofis"],
};

const SUBJECT_ORDER = Object.keys(FOLDER_TREE);

// ---- RIASEC-based bio inference model -------------------------------------------------
//
// Replaces the old "checkbox picks become tags directly" questionnaire with
// an actual scoring algorithm, adapted from the Holland Occupational Themes
// (RIASEC) model — the interest-inventory framework behind O*NET's Interest
// Profiler and the Strong Interest Inventory, used by career counselors and
// the US Department of Labor for 60+ years. The core mechanic: someone
// rates a set of activity statements (1-5, not yes/no), responses are
// summed per dimension, and the top-scoring dimensions become their
// "code" — which in turn maps to a curated set of interests/skills. The
// algorithm decides the output; the person doesn't directly pick chips.
//
// The six dimensions, renamed slightly for a student context but mapped
// 1:1 to the original RIASEC types:
//   Realistic     -> "Praktis & teknis"     (hands-on, tools, building things)
//   Investigative -> "Analitis & riset"     (data, problem-solving, science)
//   Artistic      -> "Kreatif & ekspresif"  (art, writing, design, music)
//   Social        -> "Sosial & membantu"    (teaching, helping, community)
//   Enterprising  -> "Memimpin & inisiatif" (leadership, persuasion, projects)
//   Conventional  -> "Terorganisir & detail"(organizing, planning, precision)
const RIASEC_DIMENSIONS = {
  R: { label: "Praktis & teknis", blurb: "hands-on, alat, kerja lapangan" },
  I: { label: "Analitis & riset", blurb: "data, sains, pemecahan masalah" },
  A: { label: "Kreatif & ekspresif", blurb: "seni, desain, tulisan, musik" },
  S: { label: "Sosial & membantu", blurb: "mengajar, komunitas, mendengarkan" },
  E: { label: "Memimpin & inisiatif", blurb: "kepemimpinan, persuasi, proyek" },
  C: { label: "Terorganisir & detail", blurb: "perencanaan, presisi, struktur" },
};

// Rating items: 4 per dimension, kept short (one activity each) since
// brevity matters for completion quality on a short-form inventory (this
// is explicitly why O*NET offers a 60-item "Short Form" alongside their
// 180-item Long Form — shorter online forms get better response quality).
// Each item's dimension is intentionally hidden from the UI copy, same as
// standard RIASEC inventories, so answers reflect genuine reaction to the
// activity rather than a guess at which "category" it belongs to.
const RIASEC_ITEMS = [
  { id: "r1", dim: "R", text: "Merakit atau memperbaiki sesuatu dengan tangan" },
  { id: "r2", dim: "R", text: "Bereksperimen langsung di lab atau lapangan" },
  { id: "r3", dim: "R", text: "Membongkar alat untuk tahu cara kerjanya" },
  { id: "r4", dim: "R", text: "Bekerja dengan mesin, sirkuit, atau perkakas" },

  { id: "i1", dim: "I", text: "Menganalisis data untuk menemukan pola" },
  { id: "i2", dim: "I", text: "Memecahkan teka-teki atau masalah rumit" },
  { id: "i3", dim: "I", text: "Membaca riset atau teori mendalam soal suatu topik" },
  { id: "i4", dim: "I", text: "Bertanya 'kenapa' sampai benar-benar paham akar masalahnya" },

  { id: "a1", dim: "A", text: "Membuat sesuatu yang orisinal — tulisan, gambar, musik" },
  { id: "a2", dim: "A", text: "Mengekspresikan ide lewat cara yang tidak konvensional" },
  { id: "a3", dim: "A", text: "Mendesain tampilan visual suatu karya" },
  { id: "a4", dim: "A", text: "Menceritakan sesuatu lewat gambar atau video" },

  { id: "s1", dim: "S", text: "Membantu orang lain memahami sesuatu yang sulit" },
  { id: "s2", dim: "S", text: "Mendengarkan masalah orang dan mencari solusinya bareng" },
  { id: "s3", dim: "S", text: "Terlibat dalam kegiatan sukarela atau komunitas" },
  { id: "s4", dim: "S", text: "Bekerja dalam tim yang saling mendukung" },

  { id: "e1", dim: "E", text: "Meyakinkan orang lain untuk ikut sebuah ide" },
  { id: "e2", dim: "E", text: "Memimpin proyek dari awal sampai selesai" },
  { id: "e3", dim: "E", text: "Memulai sesuatu yang baru, bahkan kalau berisiko" },
  { id: "e4", dim: "E", text: "Bernegosiasi untuk hasil yang menguntungkan semua pihak" },

  { id: "c1", dim: "C", text: "Menyusun jadwal atau rencana yang rapi dan detail" },
  { id: "c2", dim: "C", text: "Merapikan dan mengatur data atau dokumen" },
  { id: "c3", dim: "C", text: "Mengikuti prosedur yang jelas dan terstruktur" },
  { id: "c4", dim: "C", text: "Memastikan semua detail kecil sudah benar sebelum selesai" },
];

// Scores each dimension by summing 1-5 ratings across that dimension's
// items, then returns dimensions sorted highest-first. This is the actual
// "algorithm" step — nothing here is a direct pick, it's a computed result.
function scoreRiasecResponses(responses) {
  const totals = { R: 0, I: 0, A: 0, S: 0, E: 0, C: 0 };
  for (const item of RIASEC_ITEMS) {
    totals[item.dim] += responses[item.id] || 0;
  }
  return Object.entries(totals)
    .map(([dim, score]) => ({ dim, score, ...RIASEC_DIMENSIONS[dim] }))
    .sort((a, b) => b.score - a.score);
}

// ---- phase 2: adaptive binary decision trees, one per RIASEC dimension ----
//
// Phase 1 (the 24-item rating) narrows down to a broad dimension — "kamu
// condong ke Analitis & riset" — which is still too broad to be a useful
// profile tag (nobody wants their interest listed as literally "Sains").
// Phase 2 asks a SMALL number of two-option questions to narrow further,
// but critically: only the tree for the dimension(s) that actually won
// phase 1 gets walked, and within that tree only ONE path is ever shown
// per question — each answer picks exactly one child node, so someone
// who answers "practical" never sees the "theoretical" branch's questions
// at all. That's what makes this "entangled with the previous question"
// rather than a fixed list everyone answers in full.
//
// Each node is either:
//   { question, options: [{ label, next }, { label, next }] }  -- branch
//   { result: { interests: [...], skills: [...] } }             -- leaf
//
// Results deliberately sit at a middle granularity: not the dimension
// name itself ("Sains"), not a single hyper-specific hobby ("astronomi") —
// things like "Fisika teoretis", "Matematika sosial", "Bisnis & ekonomi".
const RIASEC_DECISION_TREES = {
  I: {
    root: "start",
    nodes: {
      start: {
        question: "Kamu lebih suka praktik langsung (eksperimen) atau berpikir teori/konsep dulu?",
        options: [
          { label: "Praktik & eksperimen langsung", next: "practical" },
          { label: "Teori & konsep dulu", next: "theoretical" },
        ],
      },
      practical: {
        question: "Kamu lebih tertarik mengamati fenomena alam, atau mengolah data & angka?",
        options: [
          { label: "Fenomena alam (fisika, kimia, biologi)", next: "result_applied_science" },
          { label: "Data & angka", next: "result_data_analysis" },
        ],
      },
      theoretical: {
        question: "Kamu lebih suka mengembangkan ide sendiri secara mendalam, atau mendiskusikannya dengan orang lain?",
        options: [
          { label: "Kembangkan ide sendiri secara mendalam", next: "result_theoretical" },
          { label: "Diskusikan dan uji lewat orang lain", next: "result_applied_social_science" },
        ],
      },
      result_applied_science: { result: { interests: ["Fisika terapan", "Eksperimen sains"], skills: ["Eksperimen praktik", "Observasi ilmiah"] } },
      result_data_analysis: { result: { interests: ["Analisis data", "Matematika terapan"], skills: ["Analisis data", "Statistik"] } },
      result_theoretical: { result: { interests: ["Fisika teoretis", "Matematika murni"], skills: ["Riset mandiri", "Pemecahan masalah abstrak"] } },
      result_applied_social_science: { result: { interests: ["Sains sosial", "Riset kolaboratif"], skills: ["Presentasi riset", "Diskusi ilmiah"] } },
    },
  },
  A: {
    root: "start",
    nodes: {
      start: {
        question: "Kamu lebih suka berkarya lewat visual, atau lewat kata-kata/cerita?",
        options: [
          { label: "Visual (gambar, desain, video)", next: "visual" },
          { label: "Kata-kata & cerita", next: "verbal" },
        ],
      },
      visual: {
        question: "Kamu lebih suka mendesain untuk kebutuhan orang lain, atau berkarya bebas sesuai selera sendiri?",
        options: [
          { label: "Desain untuk kebutuhan orang lain", next: "result_applied_design" },
          { label: "Berkarya bebas sesuai selera sendiri", next: "result_fine_art" },
        ],
      },
      verbal: {
        question: "Kamu lebih suka menulis fiksi/cerita, atau menulis untuk menyampaikan gagasan/opini?",
        options: [
          { label: "Fiksi & cerita", next: "result_creative_writing" },
          { label: "Gagasan & opini", next: "result_persuasive_writing" },
        ],
      },
      result_applied_design: { result: { interests: ["Desain grafis", "UI/UX"], skills: ["Desain grafis", "Editing video"] } },
      result_fine_art: { result: { interests: ["Seni rupa", "Fotografi ekspresif"], skills: ["Ilustrasi", "Fotografi"] } },
      result_creative_writing: { result: { interests: ["Menulis kreatif", "Sastra"], skills: ["Menulis kreatif", "Storytelling"] } },
      result_persuasive_writing: { result: { interests: ["Menulis opini", "Jurnalistik"], skills: ["Menulis esai", "Riset argumentasi"] } },
    },
  },
  S: {
    root: "start",
    nodes: {
      start: {
        question: "Kamu lebih suka mengajar/membimbing satu-satu, atau menggerakkan komunitas yang lebih besar?",
        options: [
          { label: "Membimbing satu-satu", next: "individual" },
          { label: "Menggerakkan komunitas", next: "community" },
        ],
      },
      individual: {
        question: "Kamu lebih tertarik pada sisi akademik (mengajar materi), atau sisi emosional (mendengarkan, mendukung)?",
        options: [
          { label: "Sisi akademik", next: "result_teaching" },
          { label: "Sisi emosional", next: "result_counseling" },
        ],
      },
      community: {
        question: "Kamu lebih suka isu sosial/lingkungan, atau kegiatan/acara bersama?",
        options: [
          { label: "Isu sosial & lingkungan", next: "result_social_advocacy" },
          { label: "Kegiatan & acara bersama", next: "result_community_event" },
        ],
      },
      result_teaching: { result: { interests: ["Pendidikan", "Tutoring akademik"], skills: ["Mengajar/tutoring", "Menjelaskan konsep sulit"] } },
      result_counseling: { result: { interests: ["Psikologi", "Kesehatan mental"], skills: ["Mendengarkan aktif", "Mentoring"] } },
      result_social_advocacy: { result: { interests: ["Isu sosial", "Advokasi lingkungan"], skills: ["Kampanye sosial", "Kerja komunitas"] } },
      result_community_event: { result: { interests: ["Event sosial", "Kerja sukarela"], skills: ["Kerja tim", "Koordinasi acara"] } },
    },
  },
  E: {
    root: "start",
    nodes: {
      start: {
        question: "Kamu lebih tertarik membangun sesuatu (bisnis/proyek), atau memengaruhi kebijakan/opini publik?",
        options: [
          { label: "Membangun bisnis atau proyek", next: "building" },
          { label: "Memengaruhi kebijakan/opini", next: "influencing" },
        ],
      },
      building: {
        question: "Kamu lebih suka sisi strategi & keuangan, atau sisi mengelola tim & operasional?",
        options: [
          { label: "Strategi & keuangan", next: "result_business" },
          { label: "Mengelola tim & operasional", next: "result_project_management" },
        ],
      },
      influencing: {
        question: "Kamu lebih suka debat & argumentasi, atau negosiasi & membangun kesepakatan?",
        options: [
          { label: "Debat & argumentasi", next: "result_public_policy" },
          { label: "Negosiasi & kesepakatan", next: "result_negotiation" },
        ],
      },
      result_business: { result: { interests: ["Bisnis & ekonomi", "Kewirausahaan"], skills: ["Perencanaan strategi", "Analisis keuangan dasar"] } },
      result_project_management: { result: { interests: ["Manajemen organisasi", "Kepemimpinan tim"], skills: ["Manajemen proyek", "Kepemimpinan"] } },
      result_public_policy: { result: { interests: ["Politik & kebijakan", "Debat kompetitif"], skills: ["Public speaking", "Argumentasi"] } },
      result_negotiation: { result: { interests: ["Diplomasi", "Hubungan internasional"], skills: ["Negosiasi", "Mediasi"] } },
    },
  },
  R: {
    root: "start",
    nodes: {
      start: {
        question: "Kamu lebih suka kerja dengan alat/mesin, atau kerja dengan alam/lingkungan fisik?",
        options: [
          { label: "Alat & mesin", next: "mechanical" },
          { label: "Alam & lingkungan fisik", next: "outdoor" },
        ],
      },
      mechanical: {
        question: "Kamu lebih tertarik elektronik/teknologi, atau mekanik/konstruksi?",
        options: [
          { label: "Elektronik & teknologi", next: "result_electronics" },
          { label: "Mekanik & konstruksi", next: "result_mechanical" },
        ],
      },
      outdoor: {
        question: "Kamu lebih suka olahraga fisik, atau aktivitas di alam terbuka (berkebun, hiking, dsb)?",
        options: [
          { label: "Olahraga fisik", next: "result_sports" },
          { label: "Aktivitas alam terbuka", next: "result_outdoor" },
        ],
      },
      result_electronics: { result: { interests: ["Elektronik & robotika", "Teknologi terapan"], skills: ["Merakit alat", "Troubleshooting teknis"] } },
      result_mechanical: { result: { interests: ["Konstruksi & mekanik", "Otomotif"], skills: ["Kerja tangan", "Perbaikan alat"] } },
      result_sports: { result: { interests: ["Olahraga", "Kebugaran fisik"], skills: ["Sepak bola", "Kerja tim fisik"] } },
      result_outdoor: { result: { interests: ["Kegiatan alam terbuka", "Berkebun"], skills: ["Kerja lapangan", "Ketahanan fisik"] } },
    },
  },
  C: {
    root: "start",
    nodes: {
      start: {
        question: "Kamu lebih suka menyusun rencana & jadwal, atau menyusun data & dokumen?",
        options: [
          { label: "Rencana & jadwal", next: "planning" },
          { label: "Data & dokumen", next: "documenting" },
        ],
      },
      planning: {
        question: "Kamu lebih tertarik perencanaan keuangan, atau perencanaan kegiatan/acara?",
        options: [
          { label: "Perencanaan keuangan", next: "result_finance" },
          { label: "Perencanaan kegiatan", next: "result_event_planning" },
        ],
      },
      documenting: {
        question: "Kamu lebih suka merapikan & mengategorikan, atau memeriksa detail & akurasi?",
        options: [
          { label: "Merapikan & mengategorikan", next: "result_organizing" },
          { label: "Memeriksa detail & akurasi", next: "result_quality_check" },
        ],
      },
      result_finance: { result: { interests: ["Perencanaan keuangan", "Ekonomi personal"], skills: ["Manajemen anggaran", "Analisis keuangan dasar"] } },
      result_event_planning: { result: { interests: ["Manajemen acara", "Logistik"], skills: ["Manajemen waktu", "Koordinasi"] } },
      result_organizing: { result: { interests: ["Manajemen informasi", "Sistem arsip"], skills: ["Pengarsipan", "Meringkas materi"] } },
      result_quality_check: { result: { interests: ["Kontrol kualitas", "Riset presisi"], skills: ["Ketelitian", "Proofreading"] } },
    },
  },
};


// Menghitung modul di sebuah folder. `extra` = modul asli dari database
// (localModules). Perbandingan
// topik tidak peduli huruf besar/kecil.
function moduleCountFor(subject, topic, extra, kind) {
  const want = topic ? String(topic).trim().toLowerCase() : null;
  return (extra || []).filter(
    (m) => m.subject === subject && (!want || String(m.topic || "").trim().toLowerCase() === want) && matchesModuleKind(m, kind)
  ).length;
}

// Filter jenis modul di Bank Modul: "all" | "material" (materi) | "exercise" (latihan soal).
function matchesModuleKind(m, kind) {
  if (kind === "exercise") return !!m.isExercise;
  if (kind === "material") return !m.isExercise;
  return true;
}

// Daftar topik sebuah subject = topik bawaan (FOLDER_TREE) + topik kustom yang
// diketik pengguna saat upload. Dulu folder hanya dibaca dari FOLDER_TREE,
// sehingga modul dengan topik kustom tidak pernah punya folder (tetapi tetap
// muncul di pencarian).
function moduleTopicsFor(subject, extra) {
  const base = FOLDER_TREE[subject] || [];
  const seen = new Set(base.map((t) => t.toLowerCase()));
  const custom = [];
  for (const m of extra || []) {
    if (m.subject !== subject || !m.topic) continue;
    const key = String(m.topic).trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    custom.push(String(m.topic).trim());
  }
  custom.sort((a, b) => a.localeCompare(b));
  return [...base.map((t) => ({ name: t, isNew: false })), ...custom.map((t) => ({ name: t, isNew: true }))];
}

// Menyamakan penulisan topik yang diketik pengguna dengan folder yang sudah
// ada ("waves & oscillation" -> "Waves & Oscillation"), supaya tidak muncul
// dua folder yang sama hanya karena beda huruf besar/kecil.
function canonicalTopic(subject, topic, extra) {
  const wanted = String(topic || "").trim();
  const key = wanted.toLowerCase();
  const fromTree = (FOLDER_TREE[subject] || []).find((t) => t.toLowerCase() === key);
  if (fromTree) return { topic: fromTree, isCustom: false };
  const fromExisting = (extra || []).find((m) => m.subject === subject && m.topic && String(m.topic).trim().toLowerCase() === key);
  if (fromExisting) return { topic: String(fromExisting.topic).trim(), isCustom: true };
  return { topic: wanted, isCustom: true };
}

// ---- simulated universal search results -------------------------------------------------
//
// ---- forum data model -------------------------------------------------
//
// This is a discussion forum, not a Q&A ticketing system — there's no
// "accepted answer" and no voting/scoring. A post can be a question, but
// it can just as easily be an idea worth turning into research, a resource
// someone found, or just a thought worth sharing. subject/topic are optional
// tags (a post can be left general / cross-cutting), and postType labels the
// *kind* of post without implying it needs to be "resolved". Replies are
// flat and chronological — the only ordering is time, nothing is pinned
// above anything else.
//
// `attachment` on a post/reply is a placeholder shape for future file
// uploads — nothing here actually stores or renders a real file yet, it
// just proves out the UI (a small file chip) so wiring in real uploads
// later doesn't require redesigning this part.
//
// Declared here (above SEARCH_INDEX/runUniversalSearch) because the search
// index below needs to look posts up by title — keeping the forum's own
// data above the code that searches it keeps the read-order sane.
const POST_TYPES = {
  diskusi: { label: "Diskusi Chat", icon: "💬", color: "#8A5CD9" },
  ide: { label: "Ide / Riset", icon: "💡", color: "#C9821E" },
  sharing: { label: "Sharing", icon: "📎", color: "#2E9E6B" },
  pertanyaan: { label: "Pertanyaan", icon: "❔", color: "#2C7BE5" },
};


// Counts every reply in a thread, including nested replies-to-replies —
// replies is the flat array (each item optionally has a parentId), so this
// just counts the array length; nesting is structural (via parentId), not
// hierarchical in storage, so no recursion is actually needed to count.
function countAllReplies(replies) {
  return replies.length;
}

// Contoh kata kunci yang ditampilkan sebagai saran sebelum pengguna mengetik.
const SUGGESTED_QUERIES = ["waves", "integral", "chemical reactions", "elasticity", "cas project"];

// ---- helpers untuk pencarian semantik (server) + feed forum nyata -------------------------------------------------

// Mengubah timestamp ISO dari database jadi teks relatif Bahasa Indonesia,
// sama gayanya dengan data contoh ("22 menit lalu", "4 jam lalu").
function relativeTimeId(iso) {
  const t = new Date(iso).getTime();
  if (!t) return "";
  const minutes = Math.floor(Math.max(0, Date.now() - t) / 60000);
  if (minutes < 1) return "Baru saja";
  if (minutes < 60) return `${minutes} menit lalu`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} jam lalu`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} hari lalu`;
  return new Date(t).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

// Menyusun hasil pencarian dari server (pencarian semantik atas data asli di
// database). Duplikat dibuang. Kalau server gagal (server === null), corpus
// lokal (modul & post asli yang sudah dimuat di browser) dicari dengan
// pencocokan kata kunci biasa sebagai cadangan.
function mergeSearchResults(server, corpus, query) {
  const out = { direct: [], foundational: [], exercises: [], supporting: [], applied: [], forum: [] };
  // Query yang ditampilkan di judul hasil: versi yang sudah dikoreksi server (kalau ada).
  out.query = (server && server.correctedQuery) || query;
  const seen = new Set();
  const add = (tier, item, kind) => {
    const key = `${kind}:${item.id || item.title || item.body}`;
    if (seen.has(key)) return;
    seen.add(key);
    out[tier].push(item);
  };

  if (server) {
    ["direct", "foundational", "exercises", "supporting", "applied"].forEach((tier) => (server[tier] || []).forEach((m) => add(tier, m, "m")));
    (server.forum || []).forEach((p) => add("forum", p, "f"));
  } else if (corpus) {
    const q = String(query || "").trim().toLowerCase();
    const labelOf = (t) => (typeof t === "string" ? t : t && t.label) || "";
    (corpus.localModules || []).forEach((m) => {
      const hay = [m.title, m.subject, m.topic, m.description, ...(m.tags || []).map(labelOf)].join(" ").toLowerCase();
      if (q && hay.includes(q)) add(m.isExercise ? "exercises" : "direct", { ...m, reason: null }, "m");
    });
    (corpus.localPosts || []).forEach((p) => {
      const hay = [p.body, p.subject, p.topic].filter(Boolean).join(" ").toLowerCase();
      if (q && hay.includes(q)) add("forum", { ...p, reason: null }, "f");
    });
  }
  return out;
}


const TYPE_META = {
  modul: { label: "Modul baru", icon: "▤", color: "#2C7BE5" },
  forum: { label: "Forum", icon: "◔", color: "#8A5CD9" },
};

const FILE_TYPES = ["PDF", "DOCX", "PPTX"];

// ---- main component -------------------------------------------------

// Module-scope (NOT inside Homepage) so its identity never changes across
// Homepage re-renders — every keystroke into any of its fields sets state
// that lives in Homepage, which re-renders Homepage, which would redefine
// a "const ModuleUploadComposer = () => {...}" declared inside Homepage's
// body on every single render. React treats each of those redefinitions as
// a brand new component type and remounts it, wiping input focus. Defining
// it here instead — and passing everything it needs as props — makes its
// identity permanently stable, so it only ever mounts once.
// Sentinel value for the Topik <select> that means "user wants to type a
// new topic name instead of picking from the fixed list" — kept distinct
// from "" (which means "no topic chosen yet") so the empty/placeholder
// option can still exist.
const CUSTOM_TOPIC_VALUE = "__custom__";

function ModuleUploadComposer({
  c, sans, inputStyle,
  moduleDraftTitle, setModuleDraftTitle,
  moduleDraftSubject, setModuleDraftSubject,
  moduleDraftTopic, setModuleDraftTopic,
  moduleDraftTopicMode, setModuleDraftTopicMode,
  moduleDraftCustomTopic, setModuleDraftCustomTopic,
  moduleDraftDescription, setModuleDraftDescription,
  moduleDraftTags, setModuleDraftTags,
  moduleDraftKind, setModuleDraftKind,
  moduleDraftIsExercise, setModuleDraftIsExercise,
  moduleDraftFile, setModuleDraftFile,
  moduleDraftLinkUrl, setModuleDraftLinkUrl,
  moduleDraftAllowAiFileRead, setModuleDraftAllowAiFileRead,
  showAiConsentModal, setShowAiConsentModal,
  setUploadingModule, resetModuleDraft, submitModuleUpload,
}) {
  const fileInputRef = useRef(null);
  const topicOptions = FOLDER_TREE[moduleDraftSubject] || [];

  function handleSubjectChange(newSubject) {
    setModuleDraftSubject(newSubject);
    // topic list changes with subject — clear the stale pick and drop back
    // to picking from the list rather than leaving a custom topic from the
    // previous subject silently attached to the new one.
    setModuleDraftTopic("");
    setModuleDraftTopicMode("select");
    setModuleDraftCustomTopic("");
  }

  function handleTopicSelectChange(value) {
    if (value === CUSTOM_TOPIC_VALUE) {
      setModuleDraftTopicMode("custom");
      setModuleDraftTopic("");
    } else {
      setModuleDraftTopicMode("select");
      setModuleDraftTopic(value);
    }
  }

  const safeTitle = String(moduleDraftTitle || "");
  const safeDescription = String(moduleDraftDescription || "");
  const safeLinkUrl = String(moduleDraftLinkUrl || "");
  const safeCustomTopic = String(moduleDraftCustomTopic || "");
  const isCustomTopic = moduleDraftTopicMode === "custom";
  const effectiveTopic = isCustomTopic ? safeCustomTopic.trim() : moduleDraftTopic;
  const hasSource = moduleDraftKind === "link" ? safeLinkUrl.trim() : !!moduleDraftFile;
  const canSubmit = safeTitle.trim() && moduleDraftSubject && effectiveTopic && hasSource;

  function handleSubmit() {
    if (!canSubmit) return;
    submitModuleUpload({
      title: safeTitle.trim(),
      subject: moduleDraftSubject,
      topic: effectiveTopic,
      // Flags a topic the user typed themselves (not picked from
      // FOLDER_TREE) so the backend can queue it for admin review later —
      // this never blocks or delays the upload itself, and nothing in the
      // Bank Modul UI shows this flag to other users; it's purely for the
      // future admin page.
      topicIsCustom: isCustomTopic,
      description: safeDescription.trim(),
      tags: String(moduleDraftTags || ""),
      kind: moduleDraftKind,
      isExercise: !!moduleDraftIsExercise,
      file: moduleDraftFile,
      linkUrl: safeLinkUrl.trim(),
      // Only meaningful for file uploads — forced false for links even if
      // somehow still true from stale state, since there's no file to read.
      allowAiFileRead: moduleDraftKind === "file" ? !!moduleDraftAllowAiFileRead : false,
    });
    setUploadingModule(false);
    resetModuleDraft();
  }

  return (
    <div style={{ padding: "0 32px" }}>
      <button
        onClick={() => { setUploadingModule(false); resetModuleDraft(); }}
        style={{ background: "none", border: "none", cursor: "pointer", fontFamily: sans, fontSize: 12, color: c.inkMuted, marginBottom: 14, padding: 0, display: "flex", alignItems: "center", gap: 5 }}
      >
        ← Batal, kembali ke Bank Modul
      </button>

      <div onKeyDown={sendOnEnterInput} style={{ padding: "20px 22px", borderRadius: 16, background: c.card, border: `1px solid ${c.line}`, display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <div style={{ fontFamily: sans, fontWeight: 700, fontSize: 12.5, color: c.ink, marginBottom: 6 }}>Judul modul</div>
          <input
            value={moduleDraftTitle}
            onChange={(e) => setModuleDraftTitle(e.target.value)}
            placeholder="cth. Ringkasan Waves & Oscillation"
            style={{ ...inputStyle, borderRadius: 10, padding: "10px 12px" }}
          />
        </div>

        <div>
          <div style={{ fontFamily: sans, fontWeight: 700, fontSize: 12.5, color: c.ink, marginBottom: 6 }}>Jenis konten</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {[
              { value: false, icon: "📘", label: "Materi", hint: "ringkasan, catatan, slide, penjelasan" },
              { value: true, icon: "✎", label: "Latihan soal (problem set)", hint: "kumpulan soal untuk dikerjakan" },
            ].map((opt) => {
              const active = !!moduleDraftIsExercise === opt.value;
              return (
                <button
                  key={String(opt.value)}
                  onClick={() => setModuleDraftIsExercise(opt.value)}
                  aria-pressed={active}
                  style={{
                    display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2, padding: "9px 14px", borderRadius: 12, cursor: "pointer", textAlign: "left",
                    border: `1px solid ${active ? c.blue : c.line}`, background: active ? c.blueSoft : c.card,
                  }}
                >
                  <span style={{ fontFamily: sans, fontSize: 12.5, fontWeight: 700, color: active ? c.blue : c.ink }}>{opt.icon} {opt.label}</span>
                  <span style={{ fontFamily: sans, fontSize: 10.5, color: c.inkFaint }}>{opt.hint}</span>
                </button>
              );
            })}
          </div>
          <div style={{ fontFamily: sans, fontSize: 10.5, color: c.inkFaint, marginTop: 6, lineHeight: 1.45 }}>
            Berlaku untuk file maupun link. AI akan memeriksa dan bisa menyesuaikan jenisnya kalau yakin salah; kamu tetap bisa mengubahnya kapan saja.
          </div>
        </div>

        <div>
          <div style={{ fontFamily: sans, fontWeight: 700, fontSize: 12.5, color: c.ink, marginBottom: 6 }}>Deskripsi (opsional)</div>
          <textarea
            value={moduleDraftDescription}
            onChange={(e) => setModuleDraftDescription(e.target.value)}
            placeholder="Jelaskan singkat isi modul ini — apa yang dibahas, buat siapa, dsb."
            rows={3}
            style={{ ...inputStyle, borderRadius: 10, padding: "10px 12px", resize: "vertical" }}
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <div style={{ fontFamily: sans, fontWeight: 700, fontSize: 12.5, color: c.ink, marginBottom: 6 }}>Subject</div>
            <select
              value={moduleDraftSubject}
              onChange={(e) => handleSubjectChange(e.target.value)}
              style={{ ...inputStyle, borderRadius: 10, padding: "10px 12px", width: "100%" }}
            >
              {SUBJECT_ORDER.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <div style={{ fontFamily: sans, fontWeight: 700, fontSize: 12.5, color: c.ink, marginBottom: 6 }}>Topik</div>
            <select
              value={isCustomTopic ? CUSTOM_TOPIC_VALUE : moduleDraftTopic}
              onChange={(e) => handleTopicSelectChange(e.target.value)}
              style={{ ...inputStyle, borderRadius: 10, padding: "10px 12px", width: "100%" }}
            >
              <option value="">Pilih topik</option>
              {topicOptions.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
              <option value={CUSTOM_TOPIC_VALUE}>+ Buat topik baru...</option>
            </select>
            {isCustomTopic && (
              <div style={{ marginTop: 8 }}>
                <input
                  value={safeCustomTopic}
                  onChange={(e) => setModuleDraftCustomTopic(e.target.value)}
                  placeholder="Nama topik baru"
                  style={{ ...inputStyle, borderRadius: 10, padding: "10px 12px" }}
                />
                <div style={{ fontFamily: sans, fontSize: 10.5, color: c.inkFaint, marginTop: 5, lineHeight: 1.5 }}>
                  Topik baru akan ditinjau admin nanti — modulmu tetap langsung terupload dan bisa dilihat seperti biasa.
                </div>
              </div>
            )}
          </div>
        </div>

        <div>
          <div style={{ fontFamily: sans, fontWeight: 700, fontSize: 12.5, color: c.ink, marginBottom: 6 }}>Tag (opsional, pisahkan dengan koma)</div>
          <input
            value={moduleDraftTags}
            onChange={(e) => setModuleDraftTags(e.target.value)}
            placeholder="cth. resonance, doppler effect"
            style={{ ...inputStyle, borderRadius: 10, padding: "10px 12px" }}
          />
        </div>

        {moduleDraftKind === "link" ? (
          <div>
            <div style={{ fontFamily: sans, fontWeight: 700, fontSize: 12.5, color: c.ink, marginBottom: 6 }}>URL link (Canva, Google Docs/Slides, dll)</div>
            <input
              key="link-url-input"
              value={safeLinkUrl}
              onChange={(e) => setModuleDraftLinkUrl(e.target.value)}
              placeholder="https://..."
              style={{ ...inputStyle, borderRadius: 10, padding: "10px 12px" }}
            />
          </div>
        ) : (
          <div>
            <div style={{ fontFamily: sans, fontWeight: 700, fontSize: 12.5, color: c.ink, marginBottom: 6 }}>File (semua tipe file didukung — maks 10MB)</div>
            <input
              key="file-input"
              ref={fileInputRef}
              type="file"
              onChange={(e) => setModuleDraftFile(e.target.files && e.target.files[0])}
              style={{ display: "none" }}
            />
            <button
              onClick={() => fileInputRef.current && fileInputRef.current.click()}
              style={{
                width: "100%", padding: "13px 0", borderRadius: 10, border: `1px dashed ${c.line}`, background: "transparent",
                color: moduleDraftFile ? c.ink : c.inkFaint, fontFamily: sans, fontSize: 12.5, fontWeight: 600, cursor: "pointer",
              }}
            >
              {moduleDraftFile ? `📄 ${moduleDraftFile.name}` : "Klik untuk pilih file"}
            </button>
          </div>
        )}

        {moduleDraftKind === "file" && (
          <div style={{ padding: "13px 15px", borderRadius: 12, background: moduleDraftAllowAiFileRead ? c.blueSoft : c.panel, border: `1px solid ${moduleDraftAllowAiFileRead ? c.blue + "40" : c.line}` }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontFamily: sans, fontWeight: 700, fontSize: 12, color: c.ink, marginBottom: 3 }}>
                  {moduleDraftAllowAiFileRead ? "✓ AI boleh membaca isi file ini" : "Izinkan AI membaca isi file (opsional)"}
                </div>
                <div style={{ fontFamily: sans, fontSize: 10.5, color: c.inkMuted, lineHeight: 1.5 }}>
                  {moduleDraftAllowAiFileRead
                    ? "Isi file akan dikirim ke AI untuk klasifikasi tag yang lebih akurat."
                    : "Secara default, AI cuma memakai judul, deskripsi, dan tag untuk menyarankan tag — bukan isi file."}
                </div>
              </div>
              <button
                onClick={() => {
                  if (moduleDraftAllowAiFileRead) {
                    // Turning it off is always instant — no consent needed to decline.
                    setModuleDraftAllowAiFileRead(false);
                  } else {
                    // Turning it on always goes through the strict consent
                    // modal first — this button never sets it to true directly.
                    setShowAiConsentModal(true);
                  }
                }}
                style={{
                  flexShrink: 0, width: 42, height: 24, borderRadius: 999, border: "none", cursor: "pointer", position: "relative",
                  background: moduleDraftAllowAiFileRead ? c.blue : c.line, transition: "background 0.15s",
                }}
                aria-label="Izinkan AI membaca isi file"
                role="switch"
                aria-checked={moduleDraftAllowAiFileRead}
              >
                <span
                  style={{
                    position: "absolute", top: 3, left: moduleDraftAllowAiFileRead ? 21 : 3, width: 18, height: 18, borderRadius: "50%",
                    background: "#fff", transition: "left 0.15s", boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
                  }}
                />
              </button>
            </div>
          </div>
        )}

        <div>
          <button
            onClick={() => {
              if (moduleDraftKind === "link") {
                setModuleDraftKind("file");
                setModuleDraftLinkUrl("");
              } else {
                setModuleDraftKind("link");
                setModuleDraftFile(null);
                // A link has no file to read — clear any prior AI file-read
                // consent so it can't accidentally carry over if the person
                // switches back to file mode with a different file later.
                setModuleDraftAllowAiFileRead(false);
              }
            }}
            style={{ background: "none", border: "none", cursor: "pointer", fontFamily: sans, fontSize: 11.5, fontWeight: 700, color: c.blue, padding: 0 }}
          >
            {moduleDraftKind === "link" ? "← Kembali ke upload file" : "+ Tambah link (Canva, Google Docs, dll)"}
          </button>
        </div>

        <button
          data-send="1"
          disabled={!canSubmit}
          onClick={handleSubmit}
          style={{
            padding: "12px 0", borderRadius: 999, border: "none", cursor: canSubmit ? "pointer" : "not-allowed",
            background: canSubmit ? c.blue : "#B9C3D2", color: "#fff", fontFamily: sans, fontWeight: 700, fontSize: 12.5,
          }}
        >
          {moduleDraftKind === "link" ? "Tambah link modul" : "Upload modul"}
        </button>
      </div>

      <AiFileConsentModal
        c={c} sans={sans}
        show={showAiConsentModal}
        onClose={() => setShowAiConsentModal(false)}
        onAgree={() => {
          setModuleDraftAllowAiFileRead(true);
          setShowAiConsentModal(false);
        }}
      />
    </div>
  );
}

// Strict consent gate for AI file-reading: the "Saya setuju" button is
// disabled and shows a live countdown for 2 full seconds after the modal
// opens — enforced with a real timer (not just a disabled prop set once),
// so the only way to enable this is to actually wait. Declining is always
// immediate. This is deliberately more friction than a typical checkbox,
// since sending the file itself to a third-party AI provider is a bigger
// step than just sending title/description/tags.
// Lama tombol "Saya setuju" terkunci setelah modal persetujuan baca-file AI dibuka.
const CONSENT_WAIT_SECONDS = 2;

function AiFileConsentModal({ c, sans, show, onClose, onAgree }) {
  const [secondsLeft, setSecondsLeft] = useState(CONSENT_WAIT_SECONDS);

  useEffect(() => {
    if (!show) return;
    setSecondsLeft(CONSENT_WAIT_SECONDS); // reset fresh every time the modal opens
    const interval = setInterval(() => {
      setSecondsLeft((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [show]);

  if (!show) return null;
  const canAgree = secondsLeft === 0;

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(10,16,28,0.65)", zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: c.card, borderRadius: 20, padding: "26px 28px", width: "min(460px, 100%)", boxShadow: "0 20px 60px rgba(0,0,0,0.35)" }}
      >
        <div style={{ fontSize: 26, marginBottom: 10 }}>🔒</div>
        <div style={{ fontFamily: sans, fontWeight: 700, fontSize: 15.5, color: c.ink, marginBottom: 10 }}>
          Kirim isi file ke AI?
        </div>
        <div style={{ fontFamily: sans, fontSize: 12, color: c.inkMuted, lineHeight: 1.6, marginBottom: 12 }}>
          Secara default, sistem cuma memakai <strong>judul, deskripsi, dan tag</strong> yang kamu ketik untuk menyarankan tag otomatis — file kamu sendiri tidak pernah dibaca.
        </div>
        <div style={{ fontFamily: sans, fontSize: 12, color: c.inkMuted, lineHeight: 1.6, marginBottom: 12 }}>
          Kalau kamu setuju, <strong>isi file ini akan dikirim ke layanan AI pihak ketiga</strong> untuk dianalisis, supaya tag yang disarankan lebih akurat, dan AI juga boleh menyesuaikan judul modul kalau judul saat ini kurang mencerminkan isi filenya. Ini opsional dan bisa membantu kalau judul/deskripsi kamu singkat.
        </div>
        <div style={{ padding: "10px 13px", borderRadius: 10, background: c.panel, marginBottom: 18 }}>
          <div style={{ fontFamily: sans, fontSize: 11, color: c.ink, lineHeight: 1.55 }}>
            Beberapa hal yang perlu kamu tahu:
          </div>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontFamily: sans, fontSize: 11, color: c.inkMuted, lineHeight: 1.6 }}>
            <li>Cuma dipakai untuk menyarankan tag & menyesuaikan judul — bukan untuk menyalin atau mempublikasikan isi filemu.</li>
            <li>Pilihan ini berlaku sekali untuk modul ini saja, tidak permanen untuk upload berikutnya.</li>
            <li>Kalau judul diubah AI, kamu akan lihat notifikasinya dan tetap bisa mengeditnya kapan saja.</li>
            <li>Kamu tetap yang menentukan tag akhir — hasil AI cuma saran.</li>
          </ul>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={onClose}
            style={{ flex: 1, padding: "11px 0", borderRadius: 999, border: `1px solid ${c.line}`, background: "none", color: c.inkMuted, fontFamily: sans, fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}
          >
            Tidak, jangan kirim file
          </button>
          <button
            onClick={onAgree}
            disabled={!canAgree}
            style={{
              flex: 1, padding: "11px 0", borderRadius: 999, border: "none", cursor: canAgree ? "pointer" : "not-allowed",
              background: canAgree ? c.blue : "#B9C3D2", color: "#fff", fontFamily: sans, fontWeight: 700, fontSize: 12.5,
            }}
          >
            {canAgree ? "Saya setuju" : `Tunggu ${secondsLeft}s...`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Forum components, all module-scope (NOT inside Homepage) -------------
//
// Every component below used to be a "const X = () => {...}" declared
// inside Homepage's body (or, in an earlier attempted fix, inside
// ForumSection's body — same problem one level removed). Either way, they
// got REDEFINED on every Homepage render. Since draft/composer state
// (draftBody, replyDraft, moduleDraft*, etc.) lives in Homepage and updates
// on every keystroke, Homepage re-renders constantly while someone types —
// and every one of those re-renders created a brand new function reference
// for e.g. NewPostComposer. React compares component identity by function
// reference at each <Component /> call site; a new reference means "this
// is a different component now," so it unmounts the old instance (wiping
// the textarea's focus and cursor position) and mounts a fresh one.
//
// The fix: define them here, at true module scope, so their identity never
// changes no matter how many times Homepage re-renders. Everything they'd
// normally reach via closure (style tokens, state, setters, handlers) is
// passed in via a single `ctx` bundle object instead — this keeps the
// prop-drilling manageable given how many things forum components need
// (color tokens, the current user, like/bookmark state, delete handlers,
// submit handlers, etc.) without hand-writing 15+ individual props on
// every call site.

function PostTypeBadge({ ctx, type }) {
  const { sans } = ctx;
  const meta = POST_TYPES[type] || POST_TYPES.diskusi;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontFamily: sans,
        fontSize: 10.5,
        fontWeight: 700,
        color: meta.color,
        background: `${meta.color}14`,
        padding: "2.5px 9px",
        borderRadius: 999,
        flexShrink: 0,
      }}
    >
      {meta.icon} {meta.label}
    </span>
  );
}

// Small file chip — placeholder for a real attachment. Nothing behind it
// is wired up yet (no real storage/upload), it just establishes the UI
// shape so wiring in real uploads later doesn't need a redesign.
function AttachmentChip({ ctx, attachment }) {
  const { c, sans } = ctx;
  if (!attachment) return null;
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        padding: "6px 11px",
        borderRadius: 10,
        background: c.fieldBg,
        border: `1px solid ${c.line}`,
        fontFamily: sans,
      }}
    >
      <span style={{ fontSize: 13 }}>📄</span>
      <span style={{ fontSize: 11.5, fontWeight: 700, color: c.ink }}>{attachment.name}</span>
      <span style={{ fontSize: 10.5, color: c.inkFaint }}>{attachment.size}</span>
    </div>
  );
}

// ---- image carousel -------------------------------------------------
function ImageCarousel({ ctx, images, rounded = 16 }) {
  const { c, sans } = ctx;
  const [index, setIndex] = useState(0);
  if (!images || images.length === 0) return null;
  const multi = images.length > 1;

  function go(delta) {
    setIndex((i) => (i + delta + images.length) % images.length);
  }

  return (
    <div style={{ position: "relative", borderRadius: rounded, overflow: "hidden", border: `1px solid ${c.line}`, background: c.panel }}>
      <img
        src={images[index]}
        alt={`Gambar ${index + 1} dari ${images.length}`}
        style={{ width: "100%", maxHeight: 420, objectFit: "cover", display: "block" }}
      />
      {multi && (
        <>
          <button
            onClick={(e) => { e.stopPropagation(); go(-1); }}
            aria-label="Gambar sebelumnya"
            style={{
              position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)",
              width: 28, height: 28, borderRadius: "50%", border: "none",
              background: "rgba(19,32,56,0.55)", color: "#fff", fontSize: 13, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            ‹
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); go(1); }}
            aria-label="Gambar berikutnya"
            style={{
              position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
              width: 28, height: 28, borderRadius: "50%", border: "none",
              background: "rgba(19,32,56,0.55)", color: "#fff", fontSize: 13, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            ›
          </button>
          <div style={{ position: "absolute", bottom: 8, left: "50%", transform: "translateX(-50%)", display: "flex", gap: 5 }}>
            {images.map((_, i) => (
              <span
                key={i}
                style={{
                  width: i === index ? 14 : 5, height: 5, borderRadius: 999,
                  background: i === index ? "#fff" : "rgba(255,255,255,0.55)",
                  transition: "width 0.15s",
                }}
              />
            ))}
          </div>
          <div style={{ position: "absolute", top: 8, right: 8, padding: "2px 8px", borderRadius: 999, background: "rgba(19,32,56,0.55)", color: "#fff", fontFamily: sans, fontSize: 10, fontWeight: 700 }}>
            {index + 1}/{images.length}
          </div>
        </>
      )}
    </div>
  );
}

// Composer-only: small thumbnail grid with per-image remove (×), shown
// while drafting a post/reply — distinct from ImageCarousel (which is
// the published, read-only view).
function ImageDraftGrid({ ctx, images, onRemove }) {
  const { c } = ctx;
  if (!images.length) return null;
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
      {images.map((src, i) => (
        <div key={i} style={{ position: "relative", width: 84, height: 84, borderRadius: 10, overflow: "hidden", border: `1px solid ${c.line}` }}>
          <img src={src} alt={`Pratinjau ${i + 1}`} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          <button
            onClick={() => onRemove(i)}
            aria-label="Hapus gambar"
            style={{
              position: "absolute", top: 3, right: 3, width: 18, height: 18, borderRadius: "50%",
              border: "none", background: "rgba(19,32,56,0.65)", color: "#fff", fontSize: 11, lineHeight: 1,
              cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

// Shared image-picker button — reads up to `max - current` images as
// data URLs and hands them to onAdd. Disabled once the cap is hit.
function ImagePickerButton({ ctx, images, onAdd, max = 4 }) {
  const { c, sans, forumAccent } = ctx;
  const fileInputRef = useRef(null);
  const atCap = images.length >= max;
  function handleFiles(e) {
    const files = Array.from(e.target.files || []).filter((f) => f.type.startsWith("image/"));
    const room = max - images.length;
    const toRead = files.slice(0, room);
    toRead.forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => onAdd(reader.result);
      reader.readAsDataURL(file);
    });
    e.target.value = "";
  }
  return (
    <>
      <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handleFiles} style={{ display: "none" }} />
      <button
        onClick={() => fileInputRef.current && fileInputRef.current.click()}
        disabled={atCap}
        title={atCap ? `Maksimal ${max} gambar per post` : "Tambah gambar"}
        style={{
          display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 13px", borderRadius: 999,
          border: `1px dashed ${atCap ? c.line : forumAccent}`, background: "transparent",
          color: atCap ? c.inkFaint : forumAccent, fontFamily: sans, fontSize: 11.5, fontWeight: 600,
          cursor: atCap ? "not-allowed" : "pointer",
        }}
      >
        🖼️ Gambar {images.length > 0 ? `(${images.length}/${max})` : ""}
      </button>
    </>
  );
}

// Disabled placeholder control for attaching a document — UI-only for
// now, real upload wiring comes once storage is connected.
function AttachPlaceholderButton({ ctx, label = "Lampirkan file" }) {
  const { c, sans } = ctx;
  return (
    <button
      disabled
      title="Upload file belum tersambung ke backend — menyusul di tahap berikutnya"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "7px 13px",
        borderRadius: 999,
        border: `1px dashed ${c.line}`,
        background: "transparent",
        color: c.inkFaint,
        fontFamily: sans,
        fontSize: 11.5,
        fontWeight: 600,
        cursor: "not-allowed",
      }}
    >
      📎 {label}
    </button>
  );
}

// ---- action bar: like / reply / bookmark, X/Threads-style icon row ----
function ActionBar({ ctx, id, targetType, replyCountValue, onReplyClick, compact = false }) {
  const { c, sans, likedIds, bookmarkedIds, likeCounts, toggleLike, toggleBookmark, forumAccent } = ctx;
  const liked = !!likedIds[id];
  const bookmarked = !!bookmarkedIds[id];
  const count = likeCounts[id] || 0;
  const iconBtn = (active, activeColor) => ({
    display: "inline-flex", alignItems: "center", gap: 5, background: "none", border: "none",
    cursor: "pointer", padding: "4px 6px", fontFamily: sans, fontSize: compact ? 11.5 : 12.5,
    fontWeight: 600, color: active ? activeColor : c.inkFaint,
  });
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 8 }} onClick={(e) => e.stopPropagation()}>
      <button onClick={onReplyClick} style={iconBtn(false)}>
        <span style={{ fontSize: compact ? 13 : 14 }}>💬</span> {replyCountValue > 0 ? replyCountValue : ""}
      </button>
      <button onClick={() => toggleLike(id, targetType)} style={iconBtn(liked, c.likeAccent)}>
        <span style={{ fontSize: compact ? 13 : 14 }}>{liked ? "❤️" : "🤍"}</span> {count > 0 ? count : ""}
      </button>
      {targetType === "post" && (
        <button onClick={() => toggleBookmark(id)} style={{ ...iconBtn(bookmarked, forumAccent), marginLeft: "auto" }}>
          <span style={{ fontSize: compact ? 13 : 14 }}>{bookmarked ? "🔖" : "📑"}</span>
        </button>
      )}
    </div>
  );
}

// ---- post card: feed-style layout (avatar left, content right) — the
// "tweet" shape. No separate title; the body itself is the headline. ----
function PostCard({ ctx, p, onOpen }) {
  const { c, sans, CURRENT_USER, openProfile, avatarFor, deletePost, localReplies, countAllReplies, setEditingPostId } = ctx;
  return (
    <div
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      style={{
        display: "flex",
        gap: 11,
        padding: "14px 16px",
        borderRadius: 15,
        background: c.card,
        border: `1px solid ${c.line}`,
        cursor: "pointer",
        textAlign: "left",
        width: "100%",
        boxSizing: "border-box",
      }}
    >
      <div onClick={(e) => { e.stopPropagation(); openProfile(p.author); }} style={{ flexShrink: 0, cursor: "pointer" }}>
        <UsernameAvatar username={p.author} size={40} photoUrl={avatarFor(p.author)} />
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 3 }}>
          <span
            onClick={(e) => { e.stopPropagation(); openProfile(p.author); }}
            style={{ fontFamily: sans, fontWeight: 700, fontSize: 12.5, color: c.ink, cursor: "pointer" }}
          >
            {p.author}
          </span>
          <span style={{ fontFamily: sans, fontSize: 11, color: c.inkFaint }}>· {p.time}{p.edited ? " · diedit" : ""}</span>
          <PostTypeBadge ctx={ctx} type={p.postType} />
          {p.subject && (
            <span style={{ fontFamily: sans, fontSize: 10.5, fontWeight: 700, color: c.blue, background: c.blueSoft, padding: "2.5px 9px", borderRadius: 999 }}>{p.subject}</span>
          )}
          {p.author === CURRENT_USER && (
            <span style={{ marginLeft: "auto", display: "inline-flex", gap: 2, flexShrink: 0 }}>
              <button
                onClick={(e) => { e.stopPropagation(); setEditingPostId(p.id); onOpen(); }}
                title="Edit post"
                aria-label="Edit post"
                style={{ background: "none", border: "none", cursor: "pointer", color: c.inkFaint, fontSize: 13, padding: "2px 4px" }}
              >
                ✏️
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (window.confirm("Hapus post ini? Semua balasannya juga akan terhapus.")) deletePost(p.id);
                }}
                title="Hapus post"
                aria-label="Hapus post"
                style={{ background: "none", border: "none", cursor: "pointer", color: c.inkFaint, fontSize: 13, padding: "2px 4px" }}
              >
                🗑️
              </button>
            </span>
          )}
        </div>

        <div style={{ fontFamily: sans, fontSize: 13, color: c.ink, lineHeight: 1.5, marginBottom: p.images.length || p.attachment ? 10 : 2 }}>
          {p.body}
        </div>

        {p.postType === "diskusi" && <ChatPreviewStrip ctx={ctx} p={p} />}

        {p.module && <ModuleMentionChip ctx={ctx} module={p.module} />}

        {p.images.length > 0 && <ImageCarousel ctx={ctx} images={p.images} />}
        {p.attachment && <div style={{ marginTop: p.images.length ? 8 : 0 }}><AttachmentChip ctx={ctx} attachment={p.attachment} /></div>}

        <ActionBar ctx={ctx} id={p.id} targetType="post" replyCountValue={p.postType === "diskusi" ? (p.chat ? p.chat.count : 0) : countAllReplies(p.replies) + (localReplies[p.id] || []).length} onReplyClick={onOpen} />
      </div>
    </div>
  );
}

function PendingPostCard({ ctx, pending }) {
  const { c, sans, CURRENT_USER, myProfile } = ctx;
  return (
    <div style={{ display: "flex", gap: 11, padding: "14px 16px", borderRadius: 15, background: c.card, border: `1px dashed ${c.line}`, opacity: 0.75 }}>
      <div style={{ flexShrink: 0 }}>
        <UsernameAvatar username={CURRENT_USER} size={40} photoUrl={myProfile.photoUrl} />
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontFamily: sans, fontWeight: 700, fontSize: 12.5, color: c.ink, marginBottom: 3 }}>{CURRENT_USER}</div>
        <div style={{ fontFamily: sans, fontSize: 13, color: c.ink, lineHeight: 1.5, marginBottom: 6 }}>{pending.body}</div>
        {pending.error ? (
          <div style={{ fontFamily: sans, fontSize: 11.5, color: "#D9553A" }}>{pending.error}</div>
        ) : (
          <div style={{ fontFamily: sans, fontSize: 11.5, color: c.inkFaint, fontStyle: "italic" }}>Mengirim...</div>
        )}
      </div>
    </div>
  );
}

function PostList({ ctx }) {
  const { c, sans, forumActionError, setForumActionError, setComposingPost, pendingPosts, localPosts, forumAccent, openThread, forumTypeFilters, setForumTypeFilters, forumModuleFilterId, setForumModuleFilterId, localModules } = ctx;
  const allPosts = localPosts;
  const typeCounts = {};
  for (const p of allPosts) typeCounts[p.postType] = (typeCounts[p.postType] || 0) + 1;
  const visibleByType = forumTypeFilters.length ? allPosts.filter((p) => forumTypeFilters.includes(p.postType)) : allPosts;
  const visiblePosts = forumModuleFilterId ? visibleByType.filter((p) => p.moduleId === forumModuleFilterId) : visibleByType;
  const filterModule = forumModuleFilterId
    ? localModules.find((m) => m.id === forumModuleFilterId) || (allPosts.find((p) => p.moduleId === forumModuleFilterId) || {}).module || null
    : null;
  const chipStyle = (active, color) => ({
    display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 12px", borderRadius: 999,
    border: `1px solid ${active ? color : c.line}`, background: active ? `${color}14` : c.card,
    color: active ? color : c.inkMuted, fontFamily: sans, fontSize: 11.5, fontWeight: 700, cursor: "pointer",
  });
  return (
    <div style={{ padding: "0 32px" }}>
      {forumActionError && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderRadius: 10, background: "#FBEAE7", marginBottom: 12 }}>
          <span style={{ fontFamily: sans, fontSize: 11.5, color: "#D9553A" }}>{forumActionError}</span>
          <button onClick={() => setForumActionError("")} style={{ background: "none", border: "none", cursor: "pointer", color: "#D9553A", fontSize: 13, padding: 0 }}>×</button>
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <span style={{ fontFamily: sans, fontSize: 11.5, color: c.inkFaint, fontStyle: "italic" }}>{localPosts.length} post</span>
        <button
          onClick={() => setComposingPost(true)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "8px 15px",
            borderRadius: 999,
            border: "none",
            background: forumAccent,
            color: "#FFFFFF",
            fontFamily: sans,
            fontSize: 12.5,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          + Mulai diskusi
        </button>
      </div>

      {forumModuleFilterId && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 12, padding: "9px 14px", borderRadius: 12, background: c.blueSoft, border: `1px solid ${c.blue}33` }}>
          <span style={{ fontFamily: sans, fontSize: 12, color: c.ink }}>
            📘 Diskusi tentang modul: <strong>{filterModule ? filterModule.title : "(modul)"}</strong>
          </span>
          <button onClick={() => setForumModuleFilterId(null)} style={{ background: "none", border: "none", cursor: "pointer", fontFamily: sans, fontSize: 11, fontWeight: 700, color: c.blue, padding: 0 }}>
            ✕ Tampilkan semua diskusi
          </button>
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap", marginBottom: 12 }}>
        <span style={{ fontFamily: sans, fontSize: 11, fontWeight: 700, color: c.inkFaint, marginRight: 2 }}>Tampilkan:</span>
        <button onClick={() => setForumTypeFilters([])} style={chipStyle(forumTypeFilters.length === 0, c.ink)}>
          Semua <span style={{ fontWeight: 600, opacity: 0.7 }}>{allPosts.length}</span>
        </button>
        {Object.entries(POST_TYPES).map(([key, meta]) => {
          const active = forumTypeFilters.includes(key);
          return (
            <button
              key={key}
              onClick={() => setForumTypeFilters((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))}
              style={chipStyle(active, meta.color)}
            >
              {meta.icon} {meta.label} <span style={{ fontWeight: 600, opacity: 0.7 }}>{typeCounts[key] || 0}</span>
            </button>
          );
        })}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {pendingPosts.map((pending) => (
          <PendingPostCard key={pending.tempId} ctx={ctx} pending={pending} />
        ))}
        {visiblePosts.map((p) => (
          <PostCard key={p.id} ctx={ctx} p={p} onOpen={() => openThread(p.id)} />
        ))}
        {visiblePosts.length === 0 && pendingPosts.length === 0 && (
          <div style={{ padding: "30px 20px", textAlign: "center", borderRadius: 14, border: `1px dashed ${c.line}`, background: c.card, fontFamily: sans, fontSize: 12.5, color: c.inkMuted }}>
            {forumModuleFilterId ? "Belum ada diskusi tentang modul ini. Jadilah yang pertama!" : forumTypeFilters.length ? "Belum ada post dengan jenis yang dipilih." : "Belum ada post di forum. Jadilah yang pertama memulai diskusi!"}
          </div>
        )}
      </div>
    </div>
  );
}

// ---- new-post composer -------------------------------------------------
// ---- sebutan modul di forum ----------------------------------------------------------------------
// Chip "Membahas modul" yang tampil di post/thread; klik -> buka halaman modul di Bank Modul.
function ModuleMentionChip({ ctx, module }) {
  const { c, sans, openModuleFromMention } = ctx;
  if (!module) return null;
  return (
    <button
      onClick={(e) => { e.stopPropagation(); openModuleFromMention(module); }}
      title="Buka modul ini di Bank Modul"
      style={{ display: "inline-flex", alignItems: "center", gap: 10, maxWidth: "100%", margin: "2px 0 10px", padding: "8px 12px", borderRadius: 12, border: `1px solid ${c.blue}33`, background: c.blueSoft, cursor: "pointer", textAlign: "left" }}
    >
      <span style={{ fontSize: 15 }}>📘</span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: "block", fontFamily: sans, fontSize: 9.5, fontWeight: 700, color: c.blue, textTransform: "uppercase", letterSpacing: 0.4 }}>Membahas modul</span>
        <span style={{ display: "block", fontFamily: sans, fontSize: 12.5, fontWeight: 700, color: c.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{module.title}</span>
        <span style={{ display: "block", fontFamily: sans, fontSize: 10.5, color: c.inkMuted }}>{module.subject} · {module.topic}</span>
      </span>
      <span style={{ fontFamily: sans, fontSize: 11, fontWeight: 700, color: c.blue, flexShrink: 0 }}>Buka →</span>
    </button>
  );
}

// Pemilih modul untuk post baru / edit post: cari di Bank Modul lalu pilih satu.
// `fallback` = ringkasan modul yang sudah tersimpan di post (kalau belum ada di daftar modul).
function ModuleMentionField({ ctx, moduleId, onChange, fallback }) {
  const { c, sans, localModules } = ctx;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = moduleId ? localModules.find((m) => m.id === moduleId) || (fallback && fallback.id === moduleId ? fallback : null) : null;
  const q = query.trim().toLowerCase();
  const labelOf = (t) => (typeof t === "string" ? t : t && t.label) || "";
  const matches = localModules
    .filter((m) => !q || [m.title, m.subject, m.topic, ...(m.tags || []).map(labelOf)].join(" ").toLowerCase().includes(q))
    .slice(0, 8);
  return (
    <div onClick={(e) => e.stopPropagation()}>
      {selected ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "6px 12px", borderRadius: 999, border: `1px solid ${c.blue}33`, background: c.blueSoft, fontFamily: sans, fontSize: 11.5, color: c.ink, maxWidth: "100%" }}>
            <span>📘</span>
            <strong style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selected.title}</strong>
            <span style={{ color: c.inkMuted }}>{selected.subject} · {selected.topic}</span>
          </span>
          <button onClick={() => setOpen((v) => !v)} style={{ background: "none", border: "none", cursor: "pointer", fontFamily: sans, fontSize: 11, fontWeight: 700, color: c.blue, padding: 0 }}>Ganti</button>
          <button onClick={() => { onChange(null); setOpen(false); }} aria-label="Hapus sebutan modul" style={{ background: "none", border: "none", cursor: "pointer", fontFamily: sans, fontSize: 11, fontWeight: 700, color: c.inkFaint, padding: 0 }}>✕ Hapus</button>
        </div>
      ) : (
        <button
          onClick={() => setOpen((v) => !v)}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 13px", borderRadius: 999, border: `1px dashed ${c.line}`, background: "transparent", color: c.inkMuted, fontFamily: sans, fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}
        >
          📘 Sebut modul dari Bank Modul <span style={{ fontWeight: 500, opacity: 0.7 }}>(opsional)</span>
        </button>
      )}
      {open && (
        <div style={{ marginTop: 8, padding: 10, borderRadius: 12, border: `1px solid ${c.line}`, background: c.card }}>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cari modul (judul, subject, topik)..."
            style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", borderRadius: 9, border: `1px solid ${c.line}`, background: c.fieldBg, fontFamily: sans, fontSize: 12.5, color: c.ink, outline: "none", marginBottom: 8 }}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 220, overflowY: "auto" }}>
            {matches.length === 0 ? (
              <div style={{ fontFamily: sans, fontSize: 11.5, color: c.inkFaint, padding: "8px 4px" }}>Belum ada modul yang cocok.</div>
            ) : (
              matches.map((m) => (
                <button
                  key={m.id}
                  onClick={() => { onChange(m.id); setOpen(false); setQuery(""); }}
                  style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 1, padding: "7px 10px", borderRadius: 9, border: "none", background: "transparent", cursor: "pointer", textAlign: "left" }}
                >
                  <span style={{ fontFamily: sans, fontSize: 12.5, fontWeight: 700, color: c.ink }}>{m.title}{m.isExercise ? "  ✎" : ""}</span>
                  <span style={{ fontFamily: sans, fontSize: 10.5, color: c.inkFaint }}>{m.subject} · {m.topic}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function NewPostComposer({ ctx }) {
  const {
    c, sans, forumAccent, CURRENT_USER, myProfile,
    draftPostType, setDraftPostType, draftBody, setDraftBody, draftImages, setDraftImages,
    setComposingPost, submitForumPost, draftMentionModuleId, setDraftMentionModuleId,
  } = ctx;
  return (
    <div style={{ padding: "0 32px" }}>
      <button
        onClick={() => setComposingPost(false)}
        style={{ background: "none", border: "none", cursor: "pointer", fontFamily: sans, fontSize: 12, color: c.inkMuted, marginBottom: 14, padding: 0, display: "flex", alignItems: "center", gap: 5 }}
      >
        ← Batal, kembali ke daftar
      </button>

      <div style={{ padding: "20px 22px", borderRadius: 16, background: c.card, border: `1px solid ${c.line}` }}>
        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ flexShrink: 0 }}>
            <UsernameAvatar username={CURRENT_USER} size={40} photoUrl={myProfile.photoUrl} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
              {Object.entries(POST_TYPES).map(([key, meta]) => {
                const active = draftPostType === key;
                return (
                  <button
                    key={key}
                    onClick={() => setDraftPostType(key)}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                      padding: "6px 12px",
                      borderRadius: 999,
                      border: `1px solid ${active ? meta.color : c.line}`,
                      background: active ? `${meta.color}14` : "transparent",
                      color: active ? meta.color : c.inkMuted,
                      fontFamily: sans,
                      fontSize: 11.5,
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    {meta.icon} {meta.label}
                  </button>
                );
              })}
            </div>

            <div style={{ marginBottom: 12 }}>
              <ModuleMentionField ctx={ctx} moduleId={draftMentionModuleId} onChange={setDraftMentionModuleId} />
            </div>

            <textarea
              onKeyDown={sendOnEnter}
              value={draftBody}
              onChange={(e) => setDraftBody(e.target.value)}
              placeholder={draftPostType === "diskusi" ? "Topik ruang chat — apa yang mau didiskusikan bareng?" : "Apa yang lagi kamu pikirkan?"}
              rows={4}
              style={{
                width: "100%",
                padding: "12px 14px",
                fontSize: 14,
                borderRadius: 12,
                border: `1px solid ${c.line}`,
                background: c.fieldBg,
                color: c.ink,
                fontFamily: sans,
                boxSizing: "border-box",
                outline: "none",
                resize: "vertical",
                marginBottom: 12,
              }}
            />

            <ImageDraftGrid ctx={ctx} images={draftImages} onRemove={(i) => setDraftImages((imgs) => imgs.filter((_, idx) => idx !== i))} />

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
              <div style={{ display: "flex", gap: 8 }}>
                <ImagePickerButton ctx={ctx} images={draftImages} onAdd={(src) => setDraftImages((imgs) => [...imgs, src])} />
                <AttachPlaceholderButton ctx={ctx} />
              </div>
              <button
                data-send="1"
                disabled={!draftBody.trim()}
                onClick={() => {
                  const body = draftBody.trim();
                  if (!body) return;
                  submitForumPost({
                    postType: draftPostType,
                    body,
                    subject: null,
                    topic: null,
                    images: draftImages,
                    moduleId: draftMentionModuleId,
                  });
                  setDraftMentionModuleId(null);
                  setDraftBody("");
                  setDraftImages([]);
                  setDraftPostType("diskusi");
                  setComposingPost(false);
                }}
                style={{
                  padding: "9px 18px",
                  borderRadius: 999,
                  border: "none",
                  background: draftBody.trim() ? forumAccent : "#B9C3D2",
                  color: "#FFFFFF",
                  fontFamily: sans,
                  fontSize: 12.5,
                  fontWeight: 700,
                  cursor: draftBody.trim() ? "pointer" : "not-allowed",
                }}
              >
                Kirim
              </button>
            </div>
            <div style={{ fontFamily: sans, fontSize: 10.5, color: c.inkFaint, fontStyle: "italic", marginTop: 8 }}>
              Enter kirim, Shift+Enter baris baru. Tipe Diskusi Chat membuka ruang chat real-time untuk semua orang.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- reply composer: reusable for both "reply to post" (parentId ===
// null) and "reply to a reply" (parentId === that reply's id) ----
function ReplyComposer({ ctx, postId, parentId, replyingToLabel, onCancel }) {
  const { c, sans, forumAccent, CURRENT_USER, myProfile, replyDraft, setReplyDraft, setReplyTarget, submitForumReply } = ctx;
  return (
    <div style={{ padding: "14px 16px", borderRadius: 14, background: c.card, border: `1px dashed ${c.line}` }}>
      {replyingToLabel && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <span style={{ fontFamily: sans, fontSize: 11, color: c.inkFaint }}>Membalas {replyingToLabel}</span>
          <button onClick={onCancel} style={{ background: "none", border: "none", cursor: "pointer", fontFamily: sans, fontSize: 11, color: c.inkFaint, padding: 0 }}>
            Batal
          </button>
        </div>
      )}
      <div style={{ display: "flex", gap: 10 }}>
        <div style={{ flexShrink: 0 }}>
          <UsernameAvatar username={CURRENT_USER} size={30} photoUrl={myProfile.photoUrl} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <textarea
            onKeyDown={sendOnEnter}
            value={replyDraft}
            onChange={(e) => setReplyDraft(e.target.value)}
            placeholder="Bagikan pendapat, tambahan, atau apapun yang relevan..."
            rows={2}
            style={{
              width: "100%",
              padding: "10px 12px",
              fontSize: 12.5,
              borderRadius: 10,
              border: `1px solid ${c.line}`,
              background: c.fieldBg,
              color: c.ink,
              fontFamily: sans,
              boxSizing: "border-box",
              outline: "none",
              resize: "none",
              marginBottom: 8,
            }}
          />
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
            <AttachPlaceholderButton ctx={ctx} label="Lampirkan" />
            <button
              data-send="1"
              disabled={!replyDraft.trim()}
              onClick={() => {
                const body = replyDraft.trim();
                if (!body) return;
                submitForumReply({ postId, parentId, body, images: [] });
                setReplyDraft("");
                setReplyTarget(null);
              }}
              style={{
                padding: "7px 16px", borderRadius: 999, border: "none", fontFamily: sans, fontSize: 12, fontWeight: 700,
                background: replyDraft.trim() ? forumAccent : "#B9C3D2", color: "#fff",
                cursor: replyDraft.trim() ? "pointer" : "not-allowed",
              }}
            >
              Kirim
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Small card shown while a reply is being submitted — same purpose as
// PendingPostCard, scoped to a single reply instead of a whole post.
function PendingReplyCard({ ctx, pending }) {
  const { c, sans, CURRENT_USER, myProfile } = ctx;
  return (
    <div style={{ padding: "13px 15px", borderRadius: 13, background: c.card, border: `1px dashed ${c.line}`, opacity: 0.75, marginBottom: 8 }}>
      <div style={{ display: "flex", gap: 9 }}>
        <div style={{ flexShrink: 0 }}>
          <UsernameAvatar username={CURRENT_USER} size={28} photoUrl={myProfile.photoUrl} />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontFamily: sans, fontWeight: 700, fontSize: 12, color: c.ink, marginBottom: 4 }}>{CURRENT_USER}</div>
          <div style={{ fontFamily: sans, fontSize: 12.5, color: c.ink, lineHeight: 1.5, marginBottom: 4 }}>{pending.body}</div>
          {pending.error ? (
            <div style={{ fontFamily: sans, fontSize: 11, color: "#D9553A" }}>{pending.error}</div>
          ) : (
            <div style={{ fontFamily: sans, fontSize: 11, color: c.inkFaint, fontStyle: "italic" }}>Mengirim...</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- nested reply node — recursive, indents one level per depth with
// a connecting line, Threads-style. Depth is visually capped (indent
// stops growing past a point) so very deep chains stay readable. ----
function ReplyNode({ ctx, reply, allReplies, depth, postId }) {
  const { c, sans, CURRENT_USER, openProfile, avatarFor, deleteReply, replyTarget, setReplyTarget, setReplyDraft, editingReplyId, setEditingReplyId, savingEdit, saveForumReplyEdit } = ctx;
  const children = allReplies.filter((r) => r.parentId === reply.id);
  const isReplyingHere = replyTarget === reply.id;
  const indent = Math.min(depth, 4) * 22;

  return (
    <div style={{ marginLeft: indent, position: "relative" }}>
      {depth > 0 && (
        <div style={{ position: "absolute", left: -14, top: 0, bottom: 0, width: 1, background: c.line }} />
      )}
      <div style={{ padding: "13px 15px", borderRadius: 13, background: c.card, border: `1px solid ${c.line}`, marginBottom: 8 }}>
        <div style={{ display: "flex", gap: 9 }}>
          <div onClick={() => openProfile(reply.author)} style={{ flexShrink: 0, cursor: "pointer" }}>
            <UsernameAvatar username={reply.author} size={28} photoUrl={avatarFor(reply.author)} />
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
              <span onClick={() => openProfile(reply.author)} style={{ fontFamily: sans, fontWeight: 700, fontSize: 12, color: c.ink, cursor: "pointer" }}>
                {reply.author}
              </span>
              <span style={{ fontFamily: sans, fontSize: 10.5, color: c.inkFaint }}>· {reply.time}{reply.edited ? " · diedit" : ""}</span>
              {reply.author === CURRENT_USER && (
                <span style={{ marginLeft: "auto", display: "inline-flex", gap: 2, flexShrink: 0 }}>
                  <button
                    onClick={() => setEditingReplyId(editingReplyId === reply.id ? null : reply.id)}
                    title="Edit balasan"
                    aria-label="Edit balasan"
                    style={{ background: "none", border: "none", cursor: "pointer", color: c.inkFaint, fontSize: 12, padding: "2px 4px" }}
                  >
                    ✏️
                  </button>
                  <button
                    onClick={() => {
                      if (window.confirm("Hapus balasan ini? Balasan di bawahnya (jika ada) juga akan terhapus.")) deleteReply(postId, reply.id);
                    }}
                    title="Hapus balasan"
                    aria-label="Hapus balasan"
                    style={{ background: "none", border: "none", cursor: "pointer", color: c.inkFaint, fontSize: 12, padding: "2px 4px" }}
                  >
                    🗑️
                  </button>
                </span>
              )}
            </div>
            {editingReplyId === reply.id ? (
              <div style={{ marginBottom: 6 }}>
                <InlineTextEditor ctx={ctx} initial={reply.body} multiline maxLength={3000} saving={savingEdit} placeholder="Isi balasan" onSave={(t) => saveForumReplyEdit(reply.id, t)} onCancel={() => setEditingReplyId(null)} />
              </div>
            ) : (
              <p style={{ fontFamily: sans, fontSize: 12.5, color: c.ink, lineHeight: 1.55, margin: "0 0 6px" }}>{reply.body}</p>
            )}
            {reply.images && reply.images.length > 0 && <div style={{ marginBottom: 6 }}><ImageCarousel ctx={ctx} images={reply.images} rounded={12} /></div>}
            {reply.attachment && <div style={{ marginBottom: 6 }}><AttachmentChip ctx={ctx} attachment={reply.attachment} /></div>}
            <ActionBar
              ctx={ctx}
              id={reply.id}
              targetType="reply"
              replyCountValue={children.length}
              onReplyClick={() => { setReplyTarget(isReplyingHere ? null : reply.id); setReplyDraft(""); }}
              compact
            />
          </div>
        </div>
      </div>

      {isReplyingHere && (
        <div style={{ marginBottom: 8 }}>
          <ReplyComposer ctx={ctx} postId={postId} parentId={reply.id} replyingToLabel={`@${reply.author}`} onCancel={() => setReplyTarget(null)} />
        </div>
      )}

      {children.map((child) => (
        <ReplyNode key={child.id} ctx={ctx} reply={child} allReplies={allReplies} depth={depth + 1} postId={postId} />
      ))}
    </div>
  );
}

// ---- thread detail: post + nested replies -------------------------------------------------
function ThreadDetail({ ctx, post }) {
  const { c, sans, CURRENT_USER, openProfile, avatarFor, deletePost, localReplies, pendingReplies, countAllReplies, closeThread, setReplyTarget, setReplyDraft, forumActionError, setForumActionError, editingPostId, setEditingPostId, savingEdit, saveForumPostEdit } = ctx;
  const allReplies = [...post.replies, ...(localReplies[post.id] || [])];
  const topLevelReplies = allReplies.filter((r) => r.parentId === null);
  const total = countAllReplies(allReplies);
  const [showComments, setShowComments] = useState(true);
  const pendingForThisPost = pendingReplies.filter((r) => r.postId === post.id);
  return (
    <div style={{ padding: "0 32px" }}>
      {forumActionError && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderRadius: 10, background: "#FBEAE7", marginBottom: 12 }}>
          <span style={{ fontFamily: sans, fontSize: 11.5, color: "#D9553A" }}>{forumActionError}</span>
          <button onClick={() => setForumActionError("")} style={{ background: "none", border: "none", cursor: "pointer", color: "#D9553A", fontSize: 13, padding: 0 }}>×</button>
        </div>
      )}
      <button
        onClick={closeThread}
        style={{ background: "none", border: "none", cursor: "pointer", fontFamily: sans, fontSize: 12, color: c.inkMuted, marginBottom: 14, padding: 0, display: "flex", alignItems: "center", gap: 5 }}
      >
        ← Kembali ke forum
      </button>

      <div style={{ padding: "18px 20px", borderRadius: 16, background: c.card, border: `1px solid ${c.line}`, marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 11 }}>
          <div onClick={() => openProfile(post.author)} style={{ flexShrink: 0, cursor: "pointer" }}>
            <UsernameAvatar username={post.author} size={40} photoUrl={avatarFor(post.author)} />
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 3 }}>
              <span onClick={() => openProfile(post.author)} style={{ fontFamily: sans, fontWeight: 700, fontSize: 13, color: c.ink, cursor: "pointer" }}>
                {post.author}
              </span>
              <span style={{ fontFamily: sans, fontSize: 11, color: c.inkFaint }}>· {post.time}{post.edited ? " · diedit" : ""}</span>
              {post.author === CURRENT_USER && (
                <span style={{ marginLeft: "auto", display: "inline-flex", gap: 2, flexShrink: 0 }}>
                  <button
                    onClick={() => setEditingPostId(editingPostId === post.id ? null : post.id)}
                    title="Edit post"
                    aria-label="Edit post"
                    style={{ background: "none", border: "none", cursor: "pointer", color: c.inkFaint, fontSize: 13, padding: "2px 4px" }}
                  >
                    ✏️
                  </button>
                  <button
                    onClick={() => {
                      if (window.confirm("Hapus post ini? Semua balasannya juga akan terhapus.")) deletePost(post.id);
                    }}
                    title="Hapus post"
                    aria-label="Hapus post"
                    style={{ background: "none", border: "none", cursor: "pointer", color: c.inkFaint, fontSize: 13, padding: "2px 4px" }}
                  >
                    🗑️
                  </button>
                </span>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
              <PostTypeBadge ctx={ctx} type={post.postType} />
              {post.subject && (
                <span style={{ fontFamily: sans, fontSize: 10.5, fontWeight: 700, color: c.blue, background: c.blueSoft, padding: "2.5px 9px", borderRadius: 999 }}>{post.subject}</span>
              )}
              {post.topic && <span style={{ fontFamily: sans, fontSize: 10.5, color: c.inkFaint }}>{post.topic}</span>}
            </div>
            {editingPostId === post.id ? (
              <div style={{ marginBottom: 10 }}>
                <PostEditor ctx={ctx} post={post} saving={savingEdit} onSave={(draft) => saveForumPostEdit(post.id, draft)} onCancel={() => setEditingPostId(null)} />
              </div>
            ) : (
              <p style={{ fontFamily: sans, fontSize: 14, color: c.ink, lineHeight: 1.6, margin: "0 0 10px" }}>{post.body}</p>
            )}
            {editingPostId !== post.id && post.module && <ModuleMentionChip ctx={ctx} module={post.module} />}
            {post.images.length > 0 && <div style={{ marginBottom: 10 }}><ImageCarousel ctx={ctx} images={post.images} /></div>}
            {post.attachment && <div style={{ marginBottom: 10 }}><AttachmentChip ctx={ctx} attachment={post.attachment} /></div>}
            <ActionBar ctx={ctx} id={post.id} targetType="post" replyCountValue={total} onReplyClick={() => { setReplyTarget(null); setReplyDraft(""); }} />
          </div>
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <ReplyComposer ctx={ctx} postId={post.id} parentId={null} replyingToLabel={null} onCancel={() => {}} />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <span style={{ fontFamily: sans, fontSize: 13, fontWeight: 700, color: c.ink }}>
          {total} {total === 1 ? "Balasan" : "Balasan"}
        </span>
        <button
          onClick={() => setShowComments(!showComments)}
          aria-expanded={showComments}
          style={{ marginLeft: "auto", background: "none", border: `1px solid ${c.line}`, borderRadius: 999, padding: "4px 12px", fontFamily: sans, fontSize: 11.5, fontWeight: 700, color: c.inkMuted, cursor: "pointer" }}
        >
          {showComments ? "Sembunyikan balasan" : `Tampilkan balasan (${total})`}
        </button>
      </div>

      {showComments ? (
        <>
      {pendingForThisPost.map((pending) => (
        <PendingReplyCard key={pending.tempId} ctx={ctx} pending={pending} />
      ))}

      {total === 0 && pendingForThisPost.length === 0 ? (
        <div style={{ padding: "28px 20px", textAlign: "center", borderRadius: 14, border: `1px dashed ${c.line}`, background: c.card }}>
          <div style={{ fontSize: 20, marginBottom: 6 }}>💭</div>
          <div style={{ fontFamily: sans, fontSize: 12.5, color: c.inkMuted }}>Belum ada yang membalas — jadilah yang pertama nimbrung.</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {topLevelReplies.map((r) => (
            <ReplyNode key={r.id} ctx={ctx} reply={r} allReplies={allReplies} depth={0} postId={post.id} />
          ))}
        </div>
      )}
        </>
      ) : (
        <div style={{ padding: "14px 18px", borderRadius: 12, border: `1px dashed ${c.line}`, background: c.card, fontFamily: sans, fontSize: 12, color: c.inkFaint, textAlign: "center" }}>
          {total} balasan disembunyikan
        </div>
      )}
    </div>
  );
}


export default function Homepage({ currentUsername, onLogout }) {
  // Falls back to the old hardcoded demo username only if this component
  // somehow gets rendered without a real logged-in user (e.g. directly
  // during isolated testing) — in the normal flow, App (login_auth.jsx)
  // always passes the authenticated username down here.
  const CURRENT_USER = currentUsername || "kuncipas";

  const [activeNav, setActiveNav] = useState("home");
  // FYI banner on the homepage about AI usage ethics — shown by default,
  // stays dismissed for the rest of the session once closed (not tied to
  // activeNav, so navigating away and back doesn't bring it back).
  const [showAiEthicsBanner, setShowAiEthicsBanner] = useState(true);
  const [search, setSearch] = useState("");

  // Homepage universal search — separate from the Bank Modul in-folder search
  // above. This is the "type a concept, get direct + related results" hub.
  const [heroQuery, setHeroQuery] = useState("");
  const [heroSubmitted, setHeroSubmitted] = useState("");
  // Hasil pencarian sekarang datang dari server (async), jadi berupa state, bukan useMemo.
  // Effect yang mengisinya ada di bawah, setelah state modul/forum dideklarasikan.
  const [heroResults, setHeroResults] = useState(null);
  const [heroSearching, setHeroSearching] = useState(false);
  const [heroSearchNote, setHeroSearchNote] = useState("");

  function submitHeroSearch(q) {
    setHeroQuery(q);
    setHeroSubmitted(q);
  }
  function clearHeroSearch() {
    setHeroQuery("");
    setHeroSubmitted("");
  }

  // Forum state: null = post list view; an id = viewing that thread.
  // composingPost toggles the post composer. draftImages holds up to 4
  // local-preview data URLs for the image carousel — chosen images stay
  // purely local (no network call) until the person actually presses Kirim.
  const [openPostId, setOpenPostId] = useState(null);
  const [composingPost, setComposingPost] = useState(false);
  const [draftPostType, setDraftPostType] = useState("diskusi");
  const [draftBody, setDraftBody] = useState("");
  const [draftImages, setDraftImages] = useState([]);

  // Real posts created during this session, kept separate from the static
  // FORUM_POSTS demo data and merged with it at render time (newest first).
  // Lives at the Homepage level (not inside ForumSection) for the same
  // reason profile photo upload state does: ForumSection only exists while
  // the Forum menu is open, so if it owned this state, submitting a post
  // and then switching to another menu before the upload finished would
  // lose the result the same way the profile photo bug did.
  const [localPosts, setLocalPosts] = useState([]);

  // Posts currently being submitted — lets the composer show "Mengirim..."
  // and, more importantly, lets the person navigate away from Forum while
  // an upload is still running without losing it. Keyed by a client-side
  // temporary id.
  const [pendingPosts, setPendingPosts] = useState([]);

  // Fire-and-forget on purpose, same pattern as uploadProfilePhoto: this
  // function is called from the composer, but it's DEFINED here at the
  // Homepage level, so the fetch and its eventual setState both survive
  // the person navigating to a different menu mid-upload.
  async function submitForumPost({ postType, body, subject, topic, images, moduleId }) {
    const tempId = `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setPendingPosts((prev) => [...prev, { tempId, body, error: null }]);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        setPendingPosts((prev) => prev.map((p) => (p.tempId === tempId ? { ...p, error: "Sesi login sudah habis — coba login ulang." } : p)));
        return;
      }

      // Gambar (data URL pratinjau lokal) diunggah LANGSUNG ke Cloudinary; ke server
      // hanya dikirim JSON kecil berisi public_id-nya.
      const uploadedImages = [];
      for (const dataUrl of images) {
        const blob = await (await fetch(dataUrl)).blob();
        uploadedImages.push(await uploadDirectToCloudinary(blob, "forum", session.access_token));
      }

      const res = await fetch("/api/forum/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          body,
          postType,
          subject: subject || null,
          topic: topic || null,
          moduleId: moduleId || null,
          images: uploadedImages.map((u) => ({ publicId: u.publicId })),
        }),
      });
      const result = await res.json();

      if (!res.ok) {
        setPendingPosts((prev) => prev.map((p) => (p.tempId === tempId ? { ...p, error: result.error || "Gagal mengirim post." } : p)));
        return;
      }

      // Success: turn the server's post row into the shape the rest of the
      // forum UI expects (author username, empty replies array, local
      // like/bookmark defaults), prepend it to localPosts, then drop it
      // from the pending queue.
      const newPost = {
        id: result.post.id,
        postType: result.post.post_type,
        body: result.post.body,
        subject: result.post.subject,
        topic: result.post.topic,
        author: CURRENT_USER,
        time: "Baru saja",
        attachment: null,
        images: result.post.images || [],
        likes: 0,
        likedByMe: false,
        bookmarkedByMe: false,
        moduleId: result.module ? result.module.id : null,
        module: result.module || null,
        replies: [],
      };
      setLocalPosts((prev) => [newPost, ...prev]);
      setLikeCounts((prev) => ({ ...prev, [newPost.id]: 0 }));
      setPendingPosts((prev) => prev.filter((p) => p.tempId !== tempId));
    } catch (err) {
      setPendingPosts((prev) => prev.map((p) => (p.tempId === tempId ? { ...p, error: err.uploadMessage || "Gagal mengirim post — coba lagi." } : p)));
    }
  }

  // Real replies created during this session, keyed by the post id they
  // belong to (so ThreadDetail only needs to look up its own post's array)
  // and merged with that post's dummy replies at render time. Same
  // Homepage-level placement as localPosts/pendingPosts, for the same
  // survives-navigation reason.
  const [localReplies, setLocalReplies] = useState({}); // { [postId]: Reply[] }
  const [pendingReplies, setPendingReplies] = useState([]); // [{ tempId, postId, parentId, body, error }]

  async function submitForumReply({ postId, parentId, body, images }) {
    const tempId = `pending-reply-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setPendingReplies((prev) => [...prev, { tempId, postId, parentId, body, error: null }]);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        setPendingReplies((prev) => prev.map((r) => (r.tempId === tempId ? { ...r, error: "Sesi login sudah habis — coba login ulang." } : r)));
        return;
      }

      const uploadedImages = [];
      for (const dataUrl of images) {
        const blob = await (await fetch(dataUrl)).blob();
        uploadedImages.push(await uploadDirectToCloudinary(blob, "forum", session.access_token));
      }

      const res = await fetch("/api/forum/replies", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          postId,
          parentId: parentId || null,
          body,
          images: uploadedImages.map((u) => ({ publicId: u.publicId })),
        }),
      });
      const result = await res.json();

      if (!res.ok) {
        setPendingReplies((prev) => prev.map((r) => (r.tempId === tempId ? { ...r, error: result.error || "Gagal mengirim balasan." } : r)));
        return;
      }

      const newReply = {
        id: result.reply.id,
        parentId: result.reply.parent_id,
        author: CURRENT_USER,
        body: result.reply.body,
        time: "Baru saja",
        attachment: null,
        images: result.reply.images || [],
        likes: 0,
        likedByMe: false,
      };
      setLocalReplies((prev) => ({
        ...prev,
        [postId]: [...(prev[postId] || []), newReply],
      }));
      setLikeCounts((prev) => ({ ...prev, [newReply.id]: 0 }));
      setPendingReplies((prev) => prev.filter((r) => r.tempId !== tempId));
    } catch (err) {
      setPendingReplies((prev) => prev.map((r) => (r.tempId === tempId ? { ...r, error: err.uploadMessage || "Gagal mengirim balasan — coba lagi." } : r)));
    }
  }

  const [forumActionError, setForumActionError] = useState("");

  async function deletePost(postId) {
    setForumActionError("");
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      setForumActionError("Sesi login sudah habis — coba login ulang.");
      return;
    }
    try {
      const res = await fetch(`/api/forum/posts/${postId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const result = await res.json();
      if (!res.ok) {
        setForumActionError(result.error || "Gagal menghapus post.");
        return;
      }
      setLocalPosts((prev) => prev.filter((p) => p.id !== postId));
      // Deleting a post cascades to its replies in the database — mirror
      // that locally too, so nothing stale lingers in localReplies.
      setLocalReplies((prev) => {
        const next = { ...prev };
        delete next[postId];
        return next;
      });
      if (openPostId === postId) closeThread();
    } catch (err) {
      setForumActionError("Gagal menghapus post — coba lagi.");
    }
  }

  async function deleteReply(postId, replyId) {
    setForumActionError("");
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      setForumActionError("Sesi login sudah habis — coba login ulang.");
      return;
    }
    try {
      const res = await fetch(`/api/forum/replies/${replyId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const result = await res.json();
      if (!res.ok) {
        setForumActionError(result.error || "Gagal menghapus balasan.");
        return;
      }
      // Deleting a reply cascades to its own nested replies in the
      // database — remove the whole subtree locally too, so a deleted
      // parent's children don't visually linger as orphans.
      setLocalReplies((prev) => {
        const list = prev[postId] || [];
        const idsToRemove = new Set([replyId]);
        // Repeatedly sweep for children of anything already marked for
        // removal, since a reply can have nested replies several levels
        // deep and we don't know the depth up front.
        let changed = true;
        while (changed) {
          changed = false;
          for (const r of list) {
            if (r.parentId && idsToRemove.has(r.parentId) && !idsToRemove.has(r.id)) {
              idsToRemove.add(r.id);
              changed = true;
            }
          }
        }
        return { ...prev, [postId]: list.filter((r) => !idsToRemove.has(r.id)) };
      });
    } catch (err) {
      setForumActionError("Gagal menghapus balasan — coba lagi.");
    }
  }

  // static MODULES demo data for display. Same Homepage-level placement
  // as forum posts/replies and profile photo — upload state needs to
  // survive the person navigating away from Bank Modul mid-upload. ----
  const [localModules, setLocalModules] = useState([]);
  const [pendingModuleUploads, setPendingModuleUploads] = useState([]); // [{ tempId, title, error }]
  const [modulesLoading, setModulesLoading] = useState(true);

  // Converts a row from the /api/modules GET response into the shape the
  // existing module-card UI already expects (title/subject/topic/uploader/
  // type/size/date/tags) — this is the one place that shape lives, so the
  // rest of the app never needs to know about the raw DB columns.
  //
  // topicIsCustom carries through from the DB (set at upload time when the
  // uploader typed a new topic instead of picking one from FOLDER_TREE) so
  // the future admin page can find and review it — nothing in this
  // uploader-facing UI reads or displays this flag.
  function moduleFromApiRow(row) {
    const isLink = !!row.link_url;
    const sizeKb = (row.file_size_bytes || 0) / 1024;
    const size = isLink ? "" : sizeKb > 1024 ? `${(sizeKb / 1024).toFixed(1)} MB` : `${Math.round(sizeKb)} KB`;
    return {
      id: row.id,
      title: row.title,
      originalTitle: row.original_title || null,
      subject: row.subject,
      topic: row.topic,
      topicIsCustom: !!row.topic_is_custom,
      uploader: row.uploader,
      type: isLink ? "LINK" : row.file_type,
      description: row.description || "",
      size,
      date: row.created_at ? relativeTimeId(row.created_at) : "Baru saja",
      fileUrl: row.file_url,
      linkUrl: row.link_url,
      tags: row.tags || [],
      isExercise: !!row.is_exercise,
      exerciseSetBy: row.exercise_set_by || "user",
    };
  }

  async function fetchModules() {
    setModulesLoading(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;
      const res = await fetch("/api/modules", { headers: { Authorization: `Bearer ${session.access_token}` } });
      const result = await res.json();
      if (res.ok && result.modules) {
        setLocalModules(result.modules.map(moduleFromApiRow));
      }
    } catch (err) {
      console.error("Gagal memuat daftar modul:", err);
    } finally {
      setModulesLoading(false);
    }
  }

  // Fetch once when the app first loads (not just when Bank Modul is
  // opened) — this is what's called at the Homepage level for, keeping
  // module data warm even before the person navigates there.
  useEffect(() => {
    fetchModules();
  }, []);

  async function submitModuleUpload({ title, subject, topic, topicIsCustom, description, tags, kind, isExercise, file, linkUrl, allowAiFileRead }) {
    // Samakan penulisan topik dengan folder yang sudah ada (tanpa peduli huruf besar/kecil)
    const canon = canonicalTopic(subject, topic, localModules);
    topic = canon.topic;
    topicIsCustom = canon.isCustom;
    const tempId = `pending-module-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setPendingModuleUploads((prev) => [...prev, { tempId, title, error: null }]);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        setPendingModuleUploads((prev) => prev.map((m) => (m.tempId === tempId ? { ...m, error: "Sesi login sudah habis — coba login ulang." } : m)));
        return;
      }

      // File diunggah LANGSUNG ke Cloudinary (anti batas 4,5 MB Vercel); ke server
      // hanya dikirim JSON kecil berisi metadata + public_id hasil upload.
      // topicIsCustom: memungkinkan backend menandai topik baru untuk review admin
      // tanpa memengaruhi upload — modul tetap tersimpan dan tampil langsung.
      const payload = {
        title,
        subject,
        topic,
        topicIsCustom: !!topicIsCustom,
        description: description || "",
        tags,
        kind,
        isExercise: !!isExercise,
      };
      if (kind === "link") {
        payload.linkUrl = linkUrl;
      } else {
        const uploaded = await uploadDirectToCloudinary(file, "module", session.access_token);
        payload.upload = { publicId: uploaded.publicId, resourceType: uploaded.resourceType, filename: file.name };
        // Pengaman kedua (yang pertama ada di handleSubmit ModuleUploadComposer):
        // link tidak pernah dianalisis isi filenya, hanya upload file yang bisa
        // ikut, dan hanya kalau izinnya memang diberikan.
        payload.allowAiFileRead = !!allowAiFileRead;
      }

      const res = await fetch("/api/modules", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify(payload),
      });
      const result = await res.json();

      if (!res.ok) {
        setPendingModuleUploads((prev) => prev.map((m) => (m.tempId === tempId ? { ...m, error: result.error || "Gagal mengupload modul." } : m)));
        return;
      }

      const newModule = moduleFromApiRow({ ...result.module, uploader: CURRENT_USER });
      setLocalModules((prev) => [newModule, ...prev]);
      setPendingModuleUploads((prev) => prev.filter((m) => m.tempId !== tempId));

      // Fire-and-forget: suggest AI tags (and, when file-read was
      // consented to, a possible title adjustment) in the background. This
      // never blocks the upload flow and doesn't require any confirmation
      // step during upload — per the explicit design decision, ML tagging
      // happens invisibly and any title change surfaces as a dismissible
      // notification once it's done, not a modal that interrupts anything.
      fetch(`/api/modules/${newModule.id}/suggest-tags`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
        .then((res) => res.json())
        .then((tagResult) => {
          if (tagResult?.tags) {
            setLocalModules((prev) =>
              prev.map((m) =>
                m.id === newModule.id
                  ? { ...m, tags: tagResult.tags, ...(tagResult.titleChanged ? { title: tagResult.newTitle, originalTitle: m.title } : {}), ...(tagResult.exerciseChanged ? { isExercise: tagResult.isExercise, exerciseSetBy: "ai" } : {}) }
                  : m
              )
            );
          }
          if (tagResult?.exerciseChanged) {
            setTypeChangeNotifications((prev) => [
              ...prev,
              { id: `${newModule.id}-type-${Date.now()}`, moduleId: newModule.id, title: tagResult.newTitle || title, isExercise: tagResult.isExercise },
            ]);
          }
          if (tagResult?.titleChanged) {
            setTitleChangeNotifications((prev) => [
              ...prev,
              { id: `${newModule.id}-${Date.now()}`, moduleId: newModule.id, oldTitle: title, newTitle: tagResult.newTitle },
            ]);
          }
        })
        .catch((err) => console.error("Gagal memuat saran tag AI:", err));
    } catch (err) {
      setPendingModuleUploads((prev) => prev.map((m) => (m.tempId === tempId ? { ...m, error: err.uploadMessage || "Gagal mengupload modul — coba lagi." } : m)));
    }
  }

  const [moduleActionError, setModuleActionError] = useState("");
  const [deletingModuleId, setDeletingModuleId] = useState(null);
  // Queue of "AI adjusted your title" notifications — a plain array rather
  // than a single value since multiple uploads' background tagging could
  // finish around the same time. Each entry carries enough info (module id,
  // old/new title) for the notification UI to link back to the module and
  // be dismissed individually.
  const [titleChangeNotifications, setTitleChangeNotifications] = useState([]);
  const [previewModule, setPreviewModule] = useState(null); // the module object currently shown in the preview modal, or null

  // ---- Edit konten sendiri (judul modul, post, balasan) ------------------
  // Hanya satu hal yang diedit pada satu waktu per jenis. Editor-nya (komponen
  // InlineTextEditor / PostEditor) menyimpan teks yang sedang diketik di state
  // lokalnya sendiri; di sini hanya id yang sedang diedit + fungsi simpan.
  const [editingModuleId, setEditingModuleId] = useState(null);
  const [editingPostId, setEditingPostId] = useState(null);
  const [editingReplyId, setEditingReplyId] = useState(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [forumTypeFilters, setForumTypeFilters] = useState([]);

  async function getAccessToken() {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session ? session.access_token : null;
  }

  // Mengedit judul modul (atau mengembalikannya ke judul asli sebelum diubah AI).
  async function saveModuleTitle(moduleId, nextTitle) {
    const title = String(nextTitle || "").trim();
    if (!title) {
      setModuleActionError("Judul tidak boleh kosong.");
      return;
    }
    setModuleActionError("");
    const token = await getAccessToken();
    if (!token) {
      setModuleActionError("Sesi login sudah habis — coba login ulang.");
      return;
    }
    setSavingEdit(true);
    try {
      const res = await fetch(`/api/modules/${moduleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ title }),
      });
      const result = await res.json();
      if (!res.ok) {
        setModuleActionError(result.error || "Gagal menyimpan judul.");
        return;
      }
      setLocalModules((prev) =>
        prev.map((m) => (m.id === moduleId ? { ...m, title: result.module.title, originalTitle: result.module.originalTitle } : m))
      );
      setTitleChangeNotifications((prev) => prev.filter((n) => n.moduleId !== moduleId));
      setEditingModuleId(null);
    } catch (err) {
      setModuleActionError("Gagal menyimpan judul — coba lagi.");
    } finally {
      setSavingEdit(false);
    }
  }

  async function saveForumPostEdit(postId, { body, postType, moduleId }) {
    const text = String(body || "").trim();
    if (!text) {
      setForumActionError("Isi post tidak boleh kosong.");
      return;
    }
    setForumActionError("");
    const token = await getAccessToken();
    if (!token) {
      setForumActionError("Sesi login sudah habis — coba login ulang.");
      return;
    }
    setSavingEdit(true);
    try {
      const res = await fetch(`/api/forum/posts/${postId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ body: text, postType, ...(moduleId !== undefined ? { moduleId } : {}) }),
      });
      const result = await res.json();
      if (!res.ok) {
        setForumActionError(result.error || "Gagal menyimpan perubahan post.");
        return;
      }
      setLocalPosts((prev) =>
        prev.map((p) => (p.id === postId ? { ...p, body: result.post.body, postType: result.post.postType, edited: true, ...(result.post.moduleId !== undefined ? { moduleId: result.post.moduleId, module: result.post.module } : {}) } : p))
      );
      setEditingPostId(null);
    } catch (err) {
      setForumActionError("Gagal menyimpan perubahan post — coba lagi.");
    } finally {
      setSavingEdit(false);
    }
  }

  async function saveForumReplyEdit(replyId, body) {
    const text = String(body || "").trim();
    if (!text) {
      setForumActionError("Isi balasan tidak boleh kosong.");
      return;
    }
    setForumActionError("");
    const token = await getAccessToken();
    if (!token) {
      setForumActionError("Sesi login sudah habis — coba login ulang.");
      return;
    }
    setSavingEdit(true);
    try {
      const res = await fetch(`/api/forum/replies/${replyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ body: text }),
      });
      const result = await res.json();
      if (!res.ok) {
        setForumActionError(result.error || "Gagal menyimpan perubahan balasan.");
        return;
      }
      setLocalReplies((prev) => {
        const next = {};
        for (const key of Object.keys(prev)) {
          next[key] = prev[key].map((r) => (r.id === replyId ? { ...r, body: result.reply.body, edited: true } : r));
        }
        return next;
      });
      setEditingReplyId(null);
    } catch (err) {
      setForumActionError("Gagal menyimpan perubahan balasan — coba lagi.");
    } finally {
      setSavingEdit(false);
    }
  }

  // ---- Jenis modul (materi / latihan soal) + sebut modul di forum -------------
  const [moduleKindFilter, setModuleKindFilter] = useState("all"); // "all" | "material" | "exercise"
  const [typeChangeNotifications, setTypeChangeNotifications] = useState([]);
  const [draftMentionModuleId, setDraftMentionModuleId] = useState(null); // modul yang akan disebut di post baru
  const [forumModuleFilterId, setForumModuleFilterId] = useState(null); // tampilkan hanya diskusi tentang modul ini
  const [highlightedModuleId, setHighlightedModuleId] = useState(null); // kartu modul yang disorot sebentar

  // Mengubah jenis modul sendiri (materi <-> latihan soal). Pilihan pemilik
  // tidak akan ditimpa AI lagi.
  async function saveModuleType(moduleId, nextIsExercise) {
    setModuleActionError("");
    const token = await getAccessToken();
    if (!token) {
      setModuleActionError("Sesi login sudah habis — coba login ulang.");
      return;
    }
    setSavingEdit(true);
    try {
      const res = await fetch(`/api/modules/${moduleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ isExercise: !!nextIsExercise }),
      });
      const result = await res.json();
      if (!res.ok) {
        setModuleActionError(result.error || "Gagal mengubah jenis modul.");
        return;
      }
      setLocalModules((prev) =>
        prev.map((m) => (m.id === moduleId ? { ...m, isExercise: !!result.module.isExercise, exerciseSetBy: result.module.exerciseSetBy || "user_edit" } : m))
      );
      setTypeChangeNotifications((prev) => prev.filter((n) => n.moduleId !== moduleId));
    } catch (err) {
      setModuleActionError("Gagal mengubah jenis modul — coba lagi.");
    } finally {
      setSavingEdit(false);
    }
  }

  // Dari sebutan modul di forum -> halaman modul di Bank Modul: membuka folder
  // subject/topik modul itu dan menyorot kartunya.
  function openModuleFromMention(mod) {
    if (!mod) return;
    setUploadingModule(false);
    setSearch("");
    setModuleKindFilter("all");
    setFilterTypes([]);
    setOpenSubject(mod.subject);
    setOpenTopic(mod.topic);
    setActiveNav("modules");
    setHighlightedModuleId(mod.id);
  }

  // Dari kartu modul -> mulai diskusi tentang modul itu (modul otomatis disebut).
  function startDiscussionAboutModule(m) {
    setDraftMentionModuleId(m.id);
    setDraftPostType("diskusi");
    closeThread();
    setActiveNav("forum");
    setComposingPost(true);
  }

  // Dari kartu modul -> lihat semua diskusi yang menyebut modul itu.
  function openDiscussionsForModule(m) {
    setForumModuleFilterId(m.id);
    setComposingPost(false);
    closeThread();
    setActiveNav("forum");
  }

  useEffect(() => {
    if (!highlightedModuleId) return undefined;
    const t1 = setTimeout(() => {
      const el = document.getElementById(`module-card-${highlightedModuleId}`);
      if (el && el.scrollIntoView) el.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 150);
    const t2 = setTimeout(() => setHighlightedModuleId(null), 4000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [highlightedModuleId]);

  async function deleteModule(moduleId) {
    setModuleActionError("");
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      setModuleActionError("Sesi login sudah habis — coba login ulang.");
      return;
    }
    setDeletingModuleId(moduleId);
    try {
      const res = await fetch(`/api/modules/${moduleId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const result = await res.json();
      if (!res.ok) {
        setModuleActionError(result.error || "Gagal menghapus modul.");
        setDeletingModuleId(null);
        return;
      }
      setLocalModules((prev) => prev.filter((m) => m.id !== moduleId));
      setDeletingModuleId(null);
    } catch (err) {
      setModuleActionError("Gagal menghapus modul — coba lagi.");
      setDeletingModuleId(null);
    }
  }

  const [likedIds, setLikedIds] = useState({});
  const [likeCounts, setLikeCounts] = useState({});
  const [bookmarkedIds, setBookmarkedIds] = useState({});

  // Restores real bookmark state from Supabase on load — bookmarks are
  // always per-user server data (see the bookmarks table's RLS: a person
  // can only ever see their own), so unlike the FORUM_POSTS seed data's
  // bookmarkedByMe field (which is just prototype flavor), a real logged-in
  // session's actual bookmarks have to come from the backend.
  useEffect(() => {
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const res = await fetch("/api/forum/bookmarks", {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const result = await res.json();
        if (res.ok && result.postIds) {
          setBookmarkedIds((prev) => {
            const next = { ...prev };
            result.postIds.forEach((id) => { next[id] = true; });
            return next;
          });
        }
      } catch (err) {
        console.error("Gagal memuat bookmark:", err);
      }
    })();
  }, []);

  // ---- Feed forum nyata dari database ------------------------------------
  // Sebelumnya post asli hanya ada selama sesi (localPosts) dan hilang
  // setelah refresh. Sekarang dimuat dari GET /api/forum/posts: post masuk
  // ke localPosts, balasannya ke localReplies (dikelompokkan per post),
  // dan jumlah like + status "sudah saya like" ke likeCounts / likedIds.
  // Dipanggil sekali saat pertama dimuat, dan lagi kalau hasil pencarian
  // menunjuk post yang belum ada di browser (mis. dibuat orang lain).
  async function fetchForumFeed() {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;
      const res = await fetch("/api/forum/feed", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const result = await res.json();
      if (!res.ok || !result.posts) return;

      const repliesByPost = {};
      const counts = {};
      const liked = {};
      for (const r of result.replies || []) {
        (repliesByPost[r.postId] ||= []).push({
          id: r.id,
          parentId: r.parentId,
          author: r.author,
          body: r.body,
          time: relativeTimeId(r.createdAt),
          attachment: r.attachmentName ? { name: r.attachmentName, size: "" } : null,
          images: r.images || [],
          likes: r.likes,
          likedByMe: r.likedByMe,
          edited: !!r.editedAt,
        });
        counts[r.id] = r.likes;
        liked[r.id] = !!r.likedByMe;
      }
      const posts = result.posts.map((p) => {
        counts[p.id] = p.likes;
        liked[p.id] = !!p.likedByMe;
        return {
          id: p.id,
          postType: p.postType,
          body: p.body,
          subject: p.subject,
          topic: p.topic,
          author: p.author,
          time: relativeTimeId(p.createdAt),
          attachment: p.attachmentName ? { name: p.attachmentName, size: "" } : null,
          images: p.images || [],
          likes: p.likes,
          likedByMe: p.likedByMe,
          edited: !!p.editedAt,
          moduleId: p.moduleId || null,
          module: p.module || null,
          chat: p.chat || null,
          bookmarkedByMe: false,
          replies: [],
        };
      });

      setLocalPosts(posts);
      setLocalReplies(repliesByPost);
      setLikeCounts((prev) => ({ ...prev, ...counts }));
      setLikedIds((prev) => ({ ...prev, ...liked }));
    } catch (err) {
      console.error("Gagal memuat feed forum:", err);
    }
  }

  useEffect(() => {
    fetchForumFeed();
  }, []);

  // Klik hasil pencarian forum: kalau post-nya belum ada di browser,
  // muat ulang feed dulu supaya thread-nya benar-benar bisa dibuka.
  async function openThreadFromSearch(id) {
    const known = localPosts.some((p) => p.id === id);
    if (!known) await fetchForumFeed();
    openThread(id);
  }

  // ---- Pencarian semantik ---------------------------------------------
  // Alur: query dikirim ke POST /api/search (embedding + pgvector). Kalau
  // server gagal, jatuh ke pencocokan kata kunci biasa atas modul & post yang
  // sudah dimuat, plus catatan kecil di UI.
  const searchCorpusRef = useRef({ localModules: [], localPosts: [] });
  searchCorpusRef.current = { localModules, localPosts };

  useEffect(() => {
    const q = heroSubmitted.trim();
    if (!q) {
      setHeroResults(null);
      setHeroSearching(false);
      setHeroSearchNote("");
      return;
    }
    let cancelled = false;
    setHeroResults(null);
    setHeroSearching(true);
    setHeroSearchNote("");
    (async () => {
      let server = null;
      let note = "";
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session) throw new Error("Sesi login sudah habis");
        const res = await fetch("/api/search", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ query: q }),
        });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error || "Pencarian gagal");
        server = result;
        if (result.correctedQuery) {
          note = `Showing results for “${result.correctedQuery}” (corrected from “${q}”).`;
        }
      } catch (err) {
        console.error("Pencarian semantik gagal, memakai pencocokan kata kunci:", err);
        note = "Semantic search is unavailable right now — showing plain keyword matches.";
      }
      if (cancelled) return;
      setHeroResults(mergeSearchResults(server, server ? null : searchCorpusRef.current, q));
      setHeroSearchNote(note);
      setHeroSearching(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [heroSubmitted]);

  // ---- Aktivitas terbaru (dari database) --------------------------------
  const [activityItems, setActivityItems] = useState(null); // null = belum/gagal dimuat
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState("");

  async function fetchActivity() {
    setActivityLoading(true);
    setActivityError("");
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error("Sesi login sudah habis — coba login ulang.");
      const res = await fetch("/api/activity", { headers: { Authorization: `Bearer ${session.access_token}` } });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Gagal memuat aktivitas.");
      setActivityItems(result.items || []);
    } catch (err) {
      console.error("Gagal memuat aktivitas:", err);
      setActivityError(err.message || "Gagal memuat aktivitas.");
    } finally {
      setActivityLoading(false);
    }
  }

  // Dimuat ulang setiap kali menu Aktivitas Terbaru dibuka.
  useEffect(() => {
    if (activeNav === "activity") fetchActivity();
  }, [activeNav]);

  // Optimistic like/unlike: flip the UI immediately (so it feels instant on
  // click), fire the request in the background, and reconcile — on success
  // with the server's real count (covers races with e.g. another tab), on
  // failure by reverting the optimistic change and surfacing an error.
  // targetType ("post" | "reply") determines whether id is sent as postId
  // or replyId, matching the likes table's post_id/reply_id split.
  async function toggleLike(id, targetType) {
    setForumActionError("");
    const wasLiked = !!likedIds[id];
    setLikedIds((prev) => ({ ...prev, [id]: !wasLiked }));
    setLikeCounts((prev) => ({ ...prev, [id]: (prev[id] || 0) + (wasLiked ? -1 : 1) }));

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        // Revert — can't persist without a session, so don't pretend it worked.
        setLikedIds((prev) => ({ ...prev, [id]: wasLiked }));
        setLikeCounts((prev) => ({ ...prev, [id]: (prev[id] || 0) + (wasLiked ? 1 : -1) }));
        return;
      }
      const body = targetType === "reply" ? { replyId: id } : { postId: id };
      const res = await fetch("/api/forum/likes", {
        method: wasLiked ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify(body),
      });
      const result = await res.json();
      if (res.ok && typeof result.count === "number") {
        setLikeCounts((prev) => ({ ...prev, [id]: result.count }));
      } else if (!res.ok) {
        setLikedIds((prev) => ({ ...prev, [id]: wasLiked }));
        setLikeCounts((prev) => ({ ...prev, [id]: (prev[id] || 0) + (wasLiked ? 1 : -1) }));
        // Demo/seed posts and replies (ids like "p1", "r3") were never
        // actually inserted into the database, so liking them fails on the
        // foreign key constraint — surfaced here rather than reverting
        // silently, same reasoning as the reply-to-demo-post error.
        setForumActionError("Gagal menyimpan like — coba lagi.");
      }
    } catch (err) {
      setLikedIds((prev) => ({ ...prev, [id]: wasLiked }));
      setLikeCounts((prev) => ({ ...prev, [id]: (prev[id] || 0) + (wasLiked ? 1 : -1) }));
    }
  }

  async function toggleBookmark(id) {
    setForumActionError("");
    const wasBookmarked = !!bookmarkedIds[id];
    setBookmarkedIds((prev) => ({ ...prev, [id]: !wasBookmarked }));

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setBookmarkedIds((prev) => ({ ...prev, [id]: wasBookmarked }));
        return;
      }
      const res = await fetch("/api/forum/bookmarks", {
        method: wasBookmarked ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ postId: id }),
      });
      if (!res.ok) {
        setBookmarkedIds((prev) => ({ ...prev, [id]: wasBookmarked }));
        setForumActionError("Gagal menyimpan bookmark — coba lagi.");
      }
    } catch (err) {
      setBookmarkedIds((prev) => ({ ...prev, [id]: wasBookmarked }));
    }
  }

  // replyTarget: null while composing a top-level reply to the post itself,
  // or a reply id when replying to that specific reply (nested). Cleared
  // whenever the thread view is left.
  const [replyTarget, setReplyTarget] = useState(null);
  const [replyDraft, setReplyDraft] = useState("");
  function openThread(id) {
    setOpenPostId(id);
    setReplyTarget(null);
    setReplyDraft("");
  }
  function closeThread() {
    setOpenPostId(null);
    setReplyTarget(null);
    setReplyDraft("");
  }

  // Folder navigation state: null/null = root (all subjects). Pick a subject to
  // go one level deep, pick a topic to go two levels deep (where files live).
  const [openSubject, setOpenSubject] = useState(null);
  const [openTopic, setOpenTopic] = useState(null);

  // Profile state: `viewedProfile` null means "my own profile"; a username
  // string means we're looking at someone else's (read-only) profile —
  // reached by clicking a username anywhere in the forum. `editingProfile`
  // only ever applies to the current user's own profile, never someone
  // else's. `profileDraft` holds in-progress edits before they're saved.
  const [viewedProfile, setViewedProfile] = useState(null);
  const [editingProfile, setEditingProfile] = useState(false);
  const [myProfile, setMyProfile] = useState(() => emptyProfile(CURRENT_USER));
  const [profileDraft, setProfileDraft] = useState(myProfile);

  function openProfile(username) {
    setActiveNav("profile");
    setEditingProfile(false);
    setViewedProfile(username === CURRENT_USER ? null : username);
  }
  function startEditingProfile() {
    setProfileDraft(myProfile);
    setEditingProfile(true);
  }
  function cancelEditingProfile() {
    setProfileDraft(myProfile);
    setEditingProfile(false);
  }
  // Profil semua pengguna dari database (GET /api/profiles): foto avatar,
  // bio, dll. Menggantikan data profil contoh yang dulu tertanam di file ini.
  const [profilesByUsername, setProfilesByUsername] = useState({});
  const [profileSaveError, setProfileSaveError] = useState("");
  function profileFor(username) {
    return profilesByUsername[username] || emptyProfile(username);
  }
  async function fetchProfiles() {
    try {
      const token = await getAccessToken();
      if (!token) return;
      const res = await fetch("/api/profiles", { headers: { Authorization: `Bearer ${token}` } });
      const result = await res.json();
      if (!res.ok || !result.profiles) return;
      const map = {};
      for (const row of result.profiles) map[row.username] = profileFromApi(row);
      setProfilesByUsername(map);
      if (map[CURRENT_USER]) setMyProfile(map[CURRENT_USER]);
    } catch (err) {
      console.error("Gagal memuat profil:", err);
    }
  }
  useEffect(() => {
    fetchProfiles();
  }, []);

  // Menyimpan perubahan profil sendiri ke database (PATCH /api/profile).
  // Tampilan diperbarui langsung; kalau gagal, dikembalikan + pesan error.
  async function saveProfile() {
    const draft = profileDraft;
    const previous = myProfile;
    setProfileSaveError("");
    setMyProfile(draft);
    setEditingProfile(false);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Sesi login sudah habis — coba login ulang.");
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          realName: draft.realName,
          showRealName: draft.showRealName,
          headline: draft.headline,
          interests: draft.interests,
          skills: draft.skills,
          goal: draft.goal,
          focus: draft.focus || null,
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Gagal menyimpan profil.");
      setProfilesByUsername((prev) => ({ ...prev, [CURRENT_USER]: draft }));
    } catch (err) {
      setMyProfile(previous);
      setProfileSaveError(err.message || "Gagal menyimpan profil.");
    }
  }
  // Foto untuk username mana pun: nilai terkini untuk pengguna sendiri
  // (baru diunggah/dihapus), selain itu dari profil di database.
  function avatarFor(username) {
    if (username === CURRENT_USER) return myProfile.photoUrl;
    return profileFor(username).photoUrl;
  }

  // ---- profile photo upload: lives here (Homepage), not inside IdentityCard ----
  //
  // IdentityCard only exists while the person is on the Profil menu — if they
  // navigate to Forum or Bank Modul mid-upload, React unmounts IdentityCard,
  // and any setState calls a fetch() started there would try to make after
  // that fail silently. The upload keeps running in the browser regardless
  // (fetch isn't tied to a component's lifetime), but its result had nowhere
  // safe to land. Moving the state and the fetch call itself up to Homepage
  // (which stays mounted for the whole logged-in session) fixes that: the
  // request keeps running in the background no matter what menu the person
  // is looking at, and setMyProfile/setPhotoUploadError always land safely
  // whenever it resolves.
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoUploadError, setPhotoUploadError] = useState("");

  async function uploadProfilePhoto(file) {
    setPhotoUploadError("");
    setPhotoUploading(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        setPhotoUploadError("Sesi login sudah habis — coba login ulang.");
        setPhotoUploading(false);
        return;
      }

      // Foto diunggah LANGSUNG ke Cloudinary; server hanya memverifikasi & menyimpan URL-nya.
      const uploaded = await uploadDirectToCloudinary(file, "avatar", session.access_token);

      const res = await fetch("/api/profile/photo", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ publicId: uploaded.publicId }),
      });
      const result = await res.json();

      if (!res.ok) {
        setPhotoUploadError(result.error || "Gagal upload foto.");
        setPhotoUploading(false);
        return;
      }

      // Upload already persisted the URL server-side (route.js), so we
      // reflect it in both the live profile and any in-progress edit draft.
      setMyProfile((m) => ({ ...m, photoUrl: result.photoUrl }));
      setProfileDraft((d) => ({ ...d, photoUrl: result.photoUrl }));
      setPhotoUploading(false);
    } catch (err) {
      setPhotoUploadError(err.uploadMessage || "Gagal upload foto — coba lagi.");
      setPhotoUploading(false);
    }
  }

  async function deleteProfilePhoto() {
    setPhotoUploadError("");
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      setPhotoUploadError("Sesi login sudah habis — coba login ulang.");
      return;
    }
    const res = await fetch("/api/profile/photo", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (!res.ok) {
      setPhotoUploadError("Gagal menghapus foto — coba lagi.");
      return;
    }
    setMyProfile((m) => ({ ...m, photoUrl: null }));
    setProfileDraft((d) => ({ ...d, photoUrl: null }));
  }

  // Filters live in a closable panel — off by default, so browsing the folder
  // tree is the primary flow and filtering is an opt-in refinement.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filterTypes, setFilterTypes] = useState([]);
  const [sortBy, setSortBy] = useState("terbaru"); // terbaru | judul

  function toggleFilter(list, setList, value) {
    setList(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  }
  function clearFilters() {
    setFilterTypes([]);
  }
  const activeFilterCount = filterTypes.length;

  function goToRoot() {
    setOpenSubject(null);
    setOpenTopic(null);
  }
  function goToSubject(subject) {
    setOpenSubject(subject);
    setOpenTopic(null);
  }

  const modulesInView = useMemo(() => {
    let result = localModules.filter((m) => {
      if (!matchesModuleKind(m, moduleKindFilter)) return false;
      if (openSubject && m.subject !== openSubject) return false;
      if (openTopic && String(m.topic || "").trim().toLowerCase() !== String(openTopic).trim().toLowerCase()) return false;
      if (filterTypes.length && !filterTypes.includes(m.type)) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const inTitle = m.title.toLowerCase().includes(q);
        const inTags = m.tags.some((t) => t.label.toLowerCase().includes(q));
        if (!inTitle && !inTags) return false;
      }
      return true;
    });
    if (sortBy === "judul") result = [...result].sort((a, b) => a.title.localeCompare(b.title));
    return result;
  }, [localModules, openSubject, openTopic, filterTypes, search, sortBy, moduleKindFilter]);

  // When the user searches while sitting inside a folder, broaden the result
  // to a flat search across everything below that point — otherwise typing
  // into search inside a near-empty topic feels broken.
  const isSearching = search.trim().length > 0;

  // ---- design tokens (matches the auth page palette) -------------------------------------------------
  const sans = SANS_STACK;
  const serif = HEADING_STACK;
  const c = {
    bgFrom: "#EEF2F7",
    bgTo: "#D8E1EC",
    sidebar: "#FFFFFF",
    panel: "#F4F6FA",
    card: "#FFFFFF",
    ink: "#132038",
    inkMuted: "#5B6B84",
    inkFaint: "#8C9AB1",
    blue: "#2C7BE5",
    blueSoft: "#D7E6FA",
    aiTag: "#8A5CD9",
    aiTagSoft: "#EDE7FA",
    directAccent: "#2C7BE5",
    directSoft: "#D7E6FA",
    foundationAccent: "#C9821E",
    foundationSoft: "#FBEDD7",
    supportAccent: "#2E9E6B",
    supportSoft: "#E3F3EA",
    appliedAccent: "#8A5CD9",
    appliedSoft: "#EDE7FA",
    exerciseAccent: "#0F9D9A",
    exerciseSoft: "#DDF3F2",
    likeAccent: "#E0245E",
    line: "rgba(19,32,56,0.1)",
    fieldBg: "rgba(19,32,56,0.045)",
    white: "#FFFFFF",
  };

  const outerStyle = {
    fontFamily: sans,
    background: `linear-gradient(160deg, ${c.bgFrom} 0%, #E3E9F1 55%, ${c.bgTo} 100%)`,
    width: "100vw",
    height: "100vh",
    maxHeight: "100dvh",
    display: "flex",
    boxSizing: "border-box",
    overflow: "hidden",
  };

  const inputStyle = {
    width: "100%",
    padding: "10px 14px 10px 38px",
    fontSize: 13.5,
    borderRadius: 999,
    border: `1px solid ${c.line}`,
    background: c.fieldBg,
    color: c.ink,
    fontFamily: sans,
    boxSizing: "border-box",
    outline: "none",
  };

  // ---- Bank Modul upload draft state (moved up here from between the
  // Breadcrumb/FilterPanel and SearchHub/BankModulSection components —
  // this is state, owned by Homepage, not a component, so it stays in
  // Homepage's body even though the components that use it are now
  // hoisted to module scope below). -------------------------------------------------
  const [uploadingModule, setUploadingModule] = useState(false);
  const [moduleDraftTitle, setModuleDraftTitle] = useState("");
  const [moduleDraftSubject, setModuleDraftSubject] = useState("");
  const [moduleDraftTopic, setModuleDraftTopic] = useState("");
  // Whether Topik is being picked from FOLDER_TREE ("select") or typed
  // fresh by the user ("custom"). moduleDraftCustomTopic holds the typed
  // text while in "custom" mode — kept separate from moduleDraftTopic so
  // switching back to "select" doesn't lose whatever was typed.
  const [moduleDraftTopicMode, setModuleDraftTopicMode] = useState("select");
  const [moduleDraftCustomTopic, setModuleDraftCustomTopic] = useState("");
  const [moduleDraftDescription, setModuleDraftDescription] = useState("");
  const [moduleDraftTags, setModuleDraftTags] = useState("");
  const [moduleDraftKind, setModuleDraftKind] = useState("file"); // "file" | "link"
  const [moduleDraftIsExercise, setModuleDraftIsExercise] = useState(false); // false = materi, true = latihan soal
  const [moduleDraftFile, setModuleDraftFile] = useState(null);
  const [moduleDraftLinkUrl, setModuleDraftLinkUrl] = useState("");
  // Whether the uploader has explicitly opted in to sending the file itself
  // (not just title/description/tags) to the AI classifier. Defaults to
  // false per explicit requirement — reading the file is opt-in, never
  // the default. Only reachable through the strict 2-second consent modal
  // (see AiFileConsentModal below), never toggled directly.
  const [moduleDraftAllowAiFileRead, setModuleDraftAllowAiFileRead] = useState(false);
  // Controls the consent modal itself — separate from the draft state
  // above since it's transient UI, not something resetModuleDraft should
  // need to touch.
  const [showAiConsentModal, setShowAiConsentModal] = useState(false);

  // TagInput's in-progress typed text, keyed by a fieldKey the caller
  // passes in (e.g. "interests", "skills"). Lives here (not inside
  // TagInput) so its identity never changes regardless of re-renders.
  const [tagInputQueries, setTagInputQueries] = useState({});

  function resetModuleDraft() {
    setModuleDraftTitle("");
    setModuleDraftSubject("");
    setModuleDraftTopic("");
    setModuleDraftTopicMode("select");
    setModuleDraftCustomTopic("");
    setModuleDraftDescription("");
    setModuleDraftTags("");
    setModuleDraftKind("file");
    setModuleDraftIsExercise(false);
    setModuleDraftFile(null);
    setModuleDraftLinkUrl("");
    setModuleDraftAllowAiFileRead(false);
  }

  // reuse the purple already used for "forum" activity type
  const forumAccent = c.appliedAccent;

  // ---- sidebar -------------------------------------------------
  // ---- shared ctx bundle for all page-section components below -------------------------------------------------
  //
  // Sidebar, TopBar, SearchHub, BankModulSection, ForumSection, ProfileSection,
  // and everything they render used to be "const X = () => {...}" declared
  // right here, inside Homepage's body. Every keystroke anywhere in the app
  // updates state that lives in Homepage (search, draftBody, profileDraft,
  // tagInputQueries, etc.), so Homepage re-renders on every keystroke — and
  // that re-created a brand new function reference for every one of those
  // consts each time. React compares component identity by function
  // reference at each <Component /> call site, so a new reference each
  // render meant React tore down and remounted the whole subtree on every
  // keystroke, which is what was dismissing the keyboard/cursor from every
  // textbox in the app after exactly one character.
  //
  // The fix follows the same pattern already used for the forum components
  // below (PostList, ThreadDetail, etc. — see the note above PostTypeBadge):
  // define them at true module scope, so their identity never changes no
  // matter how many times Homepage re-renders, and hand them everything
  // they used to reach via closure through one `ctx` bundle instead.
  const ctx = {
    c, sans, serif, outerStyle, inputStyle,
    CURRENT_USER, onLogout, myProfile,
    activeNav, setActiveNav,
    showAiEthicsBanner, setShowAiEthicsBanner,
    search, setSearch,
    heroQuery, setHeroQuery, heroSubmitted, setHeroSubmitted, heroResults, heroSearching, heroSearchNote,
    submitHeroSearch, clearHeroSearch, openThreadFromSearch,
    editingModuleId, setEditingModuleId, editingPostId, setEditingPostId, editingReplyId, setEditingReplyId, savingEdit,
    saveModuleTitle, saveForumPostEdit, saveForumReplyEdit, forumTypeFilters, setForumTypeFilters,
    activityItems, activityLoading, activityError, fetchActivity,
    moduleDraftIsExercise, setModuleDraftIsExercise, moduleKindFilter, setModuleKindFilter,
    saveModuleType, typeChangeNotifications, setTypeChangeNotifications,
    openModuleFromMention, startDiscussionAboutModule, openDiscussionsForModule,
    draftMentionModuleId, setDraftMentionModuleId, forumModuleFilterId, setForumModuleFilterId,
    highlightedModuleId, profileFor, profileSaveError, profilesByUsername, UsernameAvatar,
    openPostId, composingPost, setComposingPost,
    draftPostType, setDraftPostType, draftBody, setDraftBody, draftImages, setDraftImages,
    localPosts, pendingPosts, submitForumPost,
    localReplies, pendingReplies, submitForumReply,
    forumActionError, setForumActionError,
    deletePost, deleteReply,
    localModules, pendingModuleUploads, modulesLoading, submitModuleUpload,
    deleteModule, deletingModuleId, moduleActionError, previewModule, setPreviewModule,
    titleChangeNotifications, setTitleChangeNotifications,
    uploadingModule, setUploadingModule,
    moduleDraftTitle, setModuleDraftTitle,
    moduleDraftSubject, setModuleDraftSubject,
    moduleDraftTopic, setModuleDraftTopic,
    moduleDraftTopicMode, setModuleDraftTopicMode,
    moduleDraftCustomTopic, setModuleDraftCustomTopic,
    moduleDraftDescription, setModuleDraftDescription,
    moduleDraftTags, setModuleDraftTags,
    moduleDraftKind, setModuleDraftKind,
    moduleDraftFile, setModuleDraftFile,
    moduleDraftLinkUrl, setModuleDraftLinkUrl,
    moduleDraftAllowAiFileRead, setModuleDraftAllowAiFileRead,
    showAiConsentModal, setShowAiConsentModal,
    resetModuleDraft,
    likedIds, likeCounts, bookmarkedIds, toggleLike, toggleBookmark,
    replyTarget, setReplyTarget, replyDraft, setReplyDraft,
    openThread, closeThread,
    filtersOpen, setFiltersOpen, filterTypes, setFilterTypes,
    sortBy, setSortBy, toggleFilter, clearFilters, activeFilterCount,
    goToRoot, goToSubject, openSubject, setOpenSubject, setOpenTopic, openTopic,
    modulesInView, isSearching,
    viewedProfile, setViewedProfile, editingProfile, setEditingProfile,
    profileDraft, setProfileDraft,
    openProfile, startEditingProfile, cancelEditingProfile, saveProfile, avatarFor, setLocalPosts, fetchForumFeed,
    photoUploading, photoUploadError, uploadProfilePhoto, deleteProfilePhoto,
    tagInputQueries, setTagInputQueries,
    forumAccent,
    countAllReplies,
  };

  return (
    <div style={outerStyle}>
      <Sidebar ctx={ctx} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflowY: "auto", minWidth: 0 }}>
        <TopBar ctx={ctx} />
        {activeNav === "home" && (
          <div style={{ paddingBottom: 32 }}>
            <HomeHero ctx={ctx} />
            <SearchHub ctx={ctx} />
          </div>
        )}
        {activeNav === "modules" && (
          <div style={{ paddingTop: 4, paddingBottom: 32 }}>
            <BankModulSection ctx={ctx} />
          </div>
        )}
        {activeNav === "activity" && (
          <div style={{ paddingTop: 4, paddingBottom: 32 }}>
            <ActivityFeed ctx={ctx} />
          </div>
        )}
        {activeNav === "forum" && (
          <div style={{ paddingTop: 4, paddingBottom: 32 }}>
            <ForumSection ctx={ctx} />
          </div>
        )}
        {activeNav === "people" && (
          <div style={{ paddingTop: 4, paddingBottom: 32 }}>
            <PeopleDirectory ctx={ctx} />
          </div>
        )}
        {activeNav === "profile" && (
          <div style={{ paddingTop: 4, paddingBottom: 32 }}>
            <ProfileSection ctx={ctx} />
          </div>
        )}
      </div>
      {activeNav === "modules" && <RightPanel ctx={ctx} />}
      <ModulePreviewModal previewModule={previewModule} setPreviewModule={setPreviewModule} c={c} sans={sans} />
    </div>
  );
}

// ---- Homepage page-section components, all module-scope (NOT inside
// Homepage). See the long comment above PostTypeBadge, and the ctx-building
// comment inside Homepage right before its return statement, for why this
// matters: anything declared inside Homepage's body gets a new function
// identity every time Homepage re-renders (i.e. on every keystroke), which
// causes React to unmount and remount it — silently dismissing focus from
// any textbox inside it after a single character. Defining everything here
// at true module scope fixes that; a `ctx` prop stands in for what each
// piece used to reach via closure. -------------------------------------------------

function Sidebar({ ctx }) {
  const { c, sans, activeNav, setActiveNav, goToRoot, closeThread, setComposingPost, setViewedProfile, setEditingProfile, CURRENT_USER, myProfile, onLogout } = ctx;
  return (
    <div style={{ width: 236, flexShrink: 0, background: c.sidebar, borderRight: `1px solid ${c.line}`, display: "flex", flexDirection: "column", padding: "24px 16px", boxSizing: "border-box" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "0 8px", marginBottom: 30 }}>
        <div style={{ width: 30, height: 30, borderRadius: 8, background: `linear-gradient(135deg, #2C7BE5, #6FB3E8)`, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, color: "#fff", fontSize: 13, flexShrink: 0 }}>
          <W3Mark size={18} />
        </div>
        <span style={{ fontFamily: sans, fontWeight: 700, color: c.ink, fontSize: 13.5, letterSpacing: 0.2, lineHeight: 1.25 }}>
          <span style={{ fontFamily: HEADING_STACK, fontSize: 16, letterSpacing: -0.3 }}>{BRAND_NAME}</span> <br />
          <span style={{ opacity: 0.45, fontWeight: 400, fontSize: 11 }}>academic ecosystem</span>
        </span>
      </div>

      <nav style={{ display: "flex", flexDirection: "column", gap: 3, flex: 1 }}>
        {NAV_ITEMS.map((item) => {
          const active = activeNav === item.key;
          return (
            <button
              key={item.key}
              onClick={() => {
                setActiveNav(item.key);
                if (item.key === "modules") goToRoot();
                if (item.key === "forum") {
                  closeThread();
                  setComposingPost(false);
                }
                if (item.key === "profile") {
                  setViewedProfile(null);
                  setEditingProfile(false);
                }
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 11,
                padding: "10px 12px",
                borderRadius: 10,
                border: "none",
                background: active ? c.blueSoft : "transparent",
                color: active ? c.blue : c.inkMuted,
                fontFamily: sans,
                fontSize: 13.5,
                fontWeight: active ? 700 : 500,
                cursor: "pointer",
                textAlign: "left",
                width: "100%",
              }}
            >
              <span style={{ fontSize: 15, width: 18, textAlign: "center" }}>{item.icon}</span>
              {item.label}
            </button>
          );
        })}
      </nav>

      <div style={{ marginTop: "auto", display: "flex", alignItems: "center", gap: 6 }}>
        <button
          onClick={() => {
            setActiveNav("profile");
            setViewedProfile(null);
            setEditingProfile(false);
          }}
          style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 10px", borderRadius: 12, background: c.panel, border: "none", cursor: "pointer", textAlign: "left", flex: 1, minWidth: 0, boxSizing: "border-box" }}
        >
          <UsernameAvatar username={CURRENT_USER} size={34} photoUrl={myProfile.photoUrl} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: sans, fontWeight: 700, fontSize: 12.5, color: c.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{CURRENT_USER}</div>
            <div style={{ fontFamily: sans, fontSize: 10.5, color: c.inkFaint }}>{myProfile.showRealName && myProfile.realName ? "Public profile" : "Anonymous"}</div>
          </div>
        </button>
        {onLogout && (
          <button
            onClick={onLogout}
            title="Log out"
            aria-label="Log out"
            style={{ flexShrink: 0, width: 38, height: 38, borderRadius: 12, background: c.panel, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: c.inkMuted, fontSize: 15 }}
          >
            ⏻
          </button>
        )}
      </div>
    </div>
  );
}

// ---- top bar -------------------------------------------------
const TOPBAR_COPY = {
  home: { title: null, subtitle: "Search any topic — relevant materials, practice problems, and forum discussions will show up." },
  modules: { title: "Module Bank", subtitle: "Browse materials by subject and topic." },
  activity: { title: "Recent Activity", subtitle: "What's happening across your academic ecosystem." },
  forum: { title: "Discussion Forum", subtitle: "Share ideas, research stories, or any discussion — it doesn't have to be about school." },
  people: { title: "People", subtitle: "Discover students across the school — interests, skills, and what they are working on." },
  profile: { title: "Profile", subtitle: "Manage your username, real name (optional), and bio." },
};

function TopBar({ ctx }) {
  const { c, sans, serif, inputStyle, activeNav, viewedProfile, search, setSearch, setActiveNav, CURRENT_USER } = ctx;
  const homeTitle = `Welcome, ${CURRENT_USER} 👋`;
  const copy =
    activeNav === "profile" && viewedProfile
      ? { title: `${viewedProfile}'s profile`, subtitle: "Real name only shows if the profile owner turns it on." }
      : activeNav === "home"
      ? { title: homeTitle, subtitle: TOPBAR_COPY.home.subtitle }
      : TOPBAR_COPY[activeNav] || { title: homeTitle, subtitle: TOPBAR_COPY.home.subtitle };
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 32px 16px", flexShrink: 0, gap: 20 }}>
      <div style={{ minWidth: 0 }}>
        <h1 style={{ fontFamily: serif, fontSize: 22, color: c.ink, margin: 0 }}>{copy.title}</h1>
        <p style={{ fontFamily: sans, fontSize: 12.5, color: c.inkMuted, margin: "4px 0 0" }}>{copy.subtitle}</p>
      </div>
      {activeNav !== "home" && activeNav !== "profile" && activeNav !== "people" && (
        <div style={{ position: "relative", width: 240, flexShrink: 0 }}>
          <span style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", color: c.inkFaint, fontSize: 13 }}>⌕</span>
          <input
            style={inputStyle}
            type="text"
            placeholder="Search modules or tags..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              if (activeNav !== "modules") setActiveNav("modules");
            }}
          />
        </div>
      )}
    </div>
  );
}

// ---- breadcrumb for folder navigation -------------------------------------------------
function Breadcrumb({ ctx }) {
  const { c, sans, openSubject, openTopic, goToRoot, goToSubject } = ctx;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 32px", marginBottom: 14, flexWrap: "wrap" }}>
      <button
        onClick={goToRoot}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          fontFamily: sans,
          fontSize: 12.5,
          fontWeight: !openSubject ? 700 : 500,
          color: !openSubject ? c.ink : c.inkMuted,
          padding: "3px 4px",
        }}
      >
        Module Bank
      </button>
      {openSubject && (
        <>
          <span style={{ color: c.inkFaint, fontSize: 12 }}>›</span>
          <button
            onClick={() => goToSubject(openSubject)}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              fontFamily: sans,
              fontSize: 12.5,
              fontWeight: !openTopic ? 700 : 500,
              color: !openTopic ? c.ink : c.inkMuted,
              padding: "3px 4px",
            }}
          >
            {openSubject}
          </button>
        </>
      )}
      {openTopic && (
        <>
          <span style={{ color: c.inkFaint, fontSize: 12 }}>›</span>
          <span style={{ fontFamily: sans, fontSize: 12.5, fontWeight: 700, color: c.ink, padding: "3px 4px" }}>{openTopic}</span>
        </>
      )}
    </div>
  );
}

// ---- filter panel (collapsible, closed by default) -------------------------------------------------
function FilterPanel({ ctx }) {
  const { c, sans, filtersOpen, filterTypes, setFilterTypes, sortBy, setSortBy, toggleFilter, clearFilters, activeFilterCount } = ctx;
  if (!filtersOpen) return null;
  const chipStyle = (active) => ({
    padding: "6px 12px",
    borderRadius: 999,
    border: `1px solid ${active ? c.blue : c.line}`,
    background: active ? c.blueSoft : "transparent",
    color: active ? c.blue : c.inkMuted,
    fontFamily: sans,
    fontSize: 12,
    fontWeight: active ? 700 : 500,
    cursor: "pointer",
  });
  return (
    <div style={{ margin: "0 32px 16px", padding: "16px 18px", borderRadius: 14, background: c.card, border: `1px solid ${c.line}` }}>
      <div style={{ display: "flex", gap: 28, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontFamily: sans, fontSize: 11, fontWeight: 700, color: c.inkFaint, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.4 }}>Tipe file</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {FILE_TYPES.map((t) => (
              <button key={t} style={chipStyle(filterTypes.includes(t))} onClick={() => toggleFilter(filterTypes, setFilterTypes, t)}>
                {t}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div style={{ fontFamily: sans, fontSize: 11, fontWeight: 700, color: c.inkFaint, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.4 }}>Urutkan</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button style={chipStyle(sortBy === "terbaru")} onClick={() => setSortBy("terbaru")}>Terbaru</button>
            <button style={chipStyle(sortBy === "judul")} onClick={() => setSortBy("judul")}>Judul A-Z</button>
          </div>
        </div>
      </div>
      {activeFilterCount > 0 && (
        <button onClick={clearFilters} style={{ marginTop: 12, background: "none", border: "none", color: c.inkFaint, fontFamily: sans, fontSize: 11.5, cursor: "pointer", textDecoration: "underline", padding: 0 }}>
          Hapus semua filter ({activeFilterCount})
        </button>
      )}
    </div>
  );
}

function FilterToggleButton({ ctx }) {
  const { c, sans, filtersOpen, setFiltersOpen, activeFilterCount } = ctx;
  return (
    <button
      onClick={() => setFiltersOpen((v) => !v)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        padding: "7px 13px",
        borderRadius: 999,
        border: `1px solid ${activeFilterCount > 0 ? c.blue : c.line}`,
        background: filtersOpen || activeFilterCount > 0 ? c.blueSoft : c.card,
        color: activeFilterCount > 0 ? c.blue : c.inkMuted,
        fontFamily: sans,
        fontSize: 12,
        fontWeight: 700,
        cursor: "pointer",
      }}
    >
      ⚙ Filter{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
      <span style={{ fontSize: 10, transform: filtersOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>▾</span>
    </button>
  );
}

// ---- small result card used inside SearchHub's tiered results -------------------------------------------------
function SearchResultCard({ ctx, m, tier, tierMeta }) {
  const { c, sans, setActiveNav, setOpenSubject, setOpenTopic } = ctx;
  const t = tierMeta;
  return (
    <button
      onClick={() => {
        setActiveNav("modules");
        setOpenSubject(m.subject);
        setOpenTopic(m.topic);
      }}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        padding: "13px 14px",
        borderRadius: 13,
        background: c.card,
        border: `1px solid ${tier === "direct" ? c.line : t.accent + "33"}`,
        cursor: "pointer",
        textAlign: "left",
        width: "100%",
      }}
    >
      <div style={{ width: 34, height: 34, borderRadius: 9, background: t.soft, color: t.accent, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800, flexShrink: 0 }}>
        {m.type}
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontFamily: sans, fontWeight: 700, fontSize: 12.5, color: c.ink, marginBottom: 2 }}>{m.title}</div>
        <div style={{ fontFamily: sans, fontSize: 10.5, color: c.inkFaint }}>
          {m.subject} · {m.topic}
        </div>
        {tier === "exercises" && (
          <span style={{ display: "inline-block", marginTop: 4, fontFamily: sans, fontSize: 9.5, fontWeight: 700, color: t.accent, background: t.soft, padding: "1.5px 7px", borderRadius: 999 }}>
            ✎ Problem set
          </span>
        )}
        {m.reason && (
          <div style={{ display: "flex", alignItems: "flex-start", gap: 4, marginTop: 5, fontFamily: sans, fontSize: 10.5, color: t.accent, fontWeight: 600, lineHeight: 1.4 }}>
            <span style={{ fontSize: 9, marginTop: 1, flexShrink: 0 }}>{t.icon}</span> {m.reason}
          </div>
        )}
      </div>
    </button>
  );
}

// Forum results get their own card shape — clicking opens the actual
// thread (nav "forum" + setOpenPostId), not the Bank Modul folder view
// SearchResultCard navigates to. Kept visually close to SearchResultCard
// (same padding/radius/border rhythm) so it reads as "one more result
// tier", not a bolted-on different widget.
function ForumSearchResultCard({ ctx, p, tierMeta }) {
  const { c, sans, setActiveNav, setComposingPost, openThreadFromSearch } = ctx;
  return (
    <button
      onClick={() => {
        setActiveNav("forum");
        setComposingPost(false);
        openThreadFromSearch(p.id);
      }}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        padding: "13px 14px",
        borderRadius: 13,
        background: c.card,
        border: `1px solid ${tierMeta.accent}33`,
        cursor: "pointer",
        textAlign: "left",
        width: "100%",
      }}
    >
      <div style={{ width: 34, height: 34, borderRadius: 9, background: tierMeta.soft, color: tierMeta.accent, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, flexShrink: 0 }}>
        {(POST_TYPES[p.postType] || POST_TYPES.diskusi).icon}
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontFamily: sans, fontWeight: 600, fontSize: 12.5, color: c.ink, marginBottom: 2, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
          {p.body}
        </div>
        <div style={{ fontFamily: sans, fontSize: 10.5, color: c.inkFaint }}>
          {(POST_TYPES[p.postType] || POST_TYPES.diskusi).label}{p.subject ? ` · ${p.subject}` : ""} · {p.replyCount ?? countAllReplies(p.replies || [])} replies
        </div>
        {p.reason && (
          <div style={{ display: "flex", alignItems: "flex-start", gap: 4, marginTop: 5, fontFamily: sans, fontSize: 10.5, color: tierMeta.accent, fontWeight: 600, lineHeight: 1.4 }}>
            <span style={{ fontSize: 9, marginTop: 1, flexShrink: 0 }}>{tierMeta.icon}</span> {p.reason}
          </div>
        )}
      </div>
    </button>
  );
}

// ---- tiny "how it works" visual: one query fans out into three paths.
// Shown only before the user's first search on this screen — it teaches
// by showing the shape of the result, not by explaining it in a paragraph.
function HowItWorks({ ctx }) {
  const { c, sans } = ctx;
  const branches = [
    { icon: "◉", text: "materials that cover your topic directly" },
    { icon: "▲", text: "foundations to understand first" },
    { icon: "✎", text: "practice problems to test yourself" },
    { icon: "◔", text: "other relevant materials & forum discussions" },
  ];
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 0, marginTop: 18, padding: "14px 10px 4px" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5 }}>
        <div style={{ width: 34, height: 34, borderRadius: "50%", background: "rgba(255,255,255,0.22)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>⌕</div>
        <span style={{ fontFamily: sans, fontSize: 9.5, color: "rgba(255,255,255,0.75)", fontWeight: 600 }}>your keywords</span>
      </div>

      <svg width="46" height="64" style={{ overflow: "visible", flexShrink: 0 }}>
        <path d="M0,32 C18,32 18,5 40,5" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" fill="none" />
        <path d="M0,32 C18,32 18,23 40,23" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" fill="none" />
        <path d="M0,32 C18,32 18,41 40,41" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" fill="none" />
        <path d="M0,32 C18,32 18,59 40,59" stroke="rgba(255,255,255,0.5)" strokeWidth="1.5" fill="none" />
      </svg>

      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {branches.map((b, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 22, height: 22, borderRadius: "50%", background: "rgba(255,255,255,0.85)", color: c.blue, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, flexShrink: 0 }}>{b.icon}</div>
            <span style={{ fontFamily: sans, fontSize: 10, color: "#FFFFFF", fontWeight: 600 }}>{b.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- SearchHub: the homepage's main feature — one big search box, results
// split into "direct match" vs "related/foundational" tiers. Minimal text,
// card-based, so a decision is obvious at a glance rather than requiring
// reading. This stands in for what ML-based semantic search will power later. -------------------------------------------------
// Closeable, expandable FYI banner about AI usage ethics — shown at the
// top of the homepage. Two-tier disclosure: a short always-visible summary
// plus an expandable "Selengkapnya" section, so it's informative without
// forcing everyone to read a wall of text just to get to the search bar.
function AiEthicsBanner({ ctx, embedded }) {
  const { c, sans, showAiEthicsBanner, setShowAiEthicsBanner } = ctx;
  const [expanded, setExpanded] = useState(false);

  if (!showAiEthicsBanner) return null;

  return (
    <div style={{ padding: embedded ? 0 : "6px 32px 0" }}>
      <div style={{ borderRadius: 16, background: c.appliedSoft, border: `1px solid ${c.appliedAccent}30`, padding: "16px 18px", marginBottom: 14, position: "relative" }}>
        <button
          onClick={() => setShowAiEthicsBanner(false)}
          aria-label="Tutup"
          style={{
            position: "absolute", top: 12, right: 12, width: 24, height: 24, borderRadius: "50%", border: "none",
            background: "rgba(255,255,255,0.6)", color: c.inkMuted, fontSize: 13, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          ×
        </button>

        <div style={{ display: "flex", gap: 12, paddingRight: 28 }}>
          <div style={{ fontSize: 20, flexShrink: 0 }}>🤝</div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: sans, fontWeight: 700, fontSize: 12.5, color: c.ink, marginBottom: 4 }}>
              Kami menjunjung tinggi orisinalitas ide
            </div>
            <div style={{ fontFamily: sans, fontSize: 11.5, color: c.inkMuted, lineHeight: 1.55 }}>
              AI di sini cuma membantu menyarankan tag topik — bukan menilai atau menggantikan karya kamu. Secara default, AI cuma memakai <strong>judul, deskripsi, dan tag</strong> yang kamu ketik saat upload modul.
            </div>

            <button
              onClick={() => setExpanded((e) => !e)}
              style={{
                marginTop: 8, background: "none", border: "none", cursor: "pointer", padding: 0,
                fontFamily: sans, fontSize: 11, fontWeight: 700, color: c.appliedAccent,
                display: "flex", alignItems: "center", gap: 4,
              }}
            >
              {expanded ? "Tutup detail" : "Selengkapnya"}
              <span style={{ fontSize: 9, transform: expanded ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>▾</span>
            </button>

            {expanded && (
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${c.appliedAccent}25`, display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
                  <span style={{ fontSize: 14, flexShrink: 0 }}>📝</span>
                  <div style={{ fontFamily: sans, fontSize: 11, color: c.inkMuted, lineHeight: 1.55 }}>
                    <strong style={{ color: c.ink }}>Bawaan (selalu aktif):</strong> AI membaca judul, deskripsi, subject, topik, dan tag yang kamu isi untuk menyarankan tag tambahan. Isi filemu sendiri tidak pernah disentuh dengan cara ini.
                  </div>
                </div>
                <div style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
                  <span style={{ fontSize: 14, flexShrink: 0 }}>🔒</span>
                  <div style={{ fontFamily: sans, fontSize: 11, color: c.inkMuted, lineHeight: 1.55 }}>
                    <strong style={{ color: c.ink }}>Opsional, dengan izin ketat:</strong> Kamu bisa memilih supaya AI membaca isi file (untuk saran tag yang lebih akurat, dan menyesuaikan judul kalau perlu). Ini selalu off secara default, dan butuh persetujuan eksplisit tiap kali upload — tidak pernah otomatis.
                  </div>
                </div>
                <div style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
                  <span style={{ fontSize: 14, flexShrink: 0 }}>🔗</span>
                  <div style={{ fontFamily: sans, fontSize: 11, color: c.inkMuted, lineHeight: 1.55 }}>
                    <strong style={{ color: c.ink }}>Modul berupa link:</strong> tidak pernah dianalisis AI sama sekali, baik judul/deskripsi maupun isi link-nya.
                  </div>
                </div>
                <div style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
                  <span style={{ fontSize: 14, flexShrink: 0 }}>👤</span>
                  <div style={{ fontFamily: sans, fontSize: 11, color: c.inkMuted, lineHeight: 1.55 }}>
                    <strong style={{ color: c.ink }}>Kamu tetap yang menentukan:</strong> tag hasil AI adalah saran, bukan keputusan final, dan judul yang disesuaikan AI selalu bisa kamu edit kembali kapan saja.
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SearchHub({ ctx }) {
  const { c, sans, serif, heroQuery, setHeroQuery, heroSubmitted, heroResults, heroSearching, heroSearchNote, submitHeroSearch, clearHeroSearch, forumAccent } = ctx;
  const hasQuery = heroSubmitted.trim().length > 0;
  // Query yang benar-benar dipakai server (sudah dikoreksi kalau ada salah ketik).
  const shownQuery = (heroResults && heroResults.query) || heroSubmitted;

  // Central config for the four result tiers — one place that drives colors,
  // icons, labels, and the sub-explanation text everywhere below.
  const TIER = {
    direct: { label: "Directly covers this topic", sub: 'Modules whose content is actually about "{q}"', accent: c.directAccent, soft: c.directSoft, icon: "◉" },
    foundational: { label: "Foundations — study these first", sub: 'Background knowledge that will help you understand "{q}"', accent: c.foundationAccent, soft: c.foundationSoft, icon: "▲" },
    exercises: { label: "Practice problems — test yourself", sub: 'Problem sets to practice "{q}"', accent: c.exerciseAccent, soft: c.exerciseSoft, icon: "✎" },
    supporting: { label: "Supporting — deepen your understanding", sub: 'Extra context related to "{q}"', accent: c.supportAccent, soft: c.supportSoft, icon: "◆" },
    applied: { label: "Applications — used here too", sub: '"{q}" shows up again in another form in this subject', accent: c.appliedAccent, soft: c.appliedSoft, icon: "◈" },
  };
  const forumTierMeta = { accent: c.appliedAccent, soft: c.appliedSoft, icon: "◔" };

  return (
    <div style={{ padding: "6px 32px 0" }}>
      {/* hero search box */}
      <div
        style={{
          borderRadius: 20,
          padding: "26px 28px",
          background: `linear-gradient(135deg, ${c.blue}, #5AA8F5)`,
          marginBottom: 20,
        }}
      >
        <div style={{ fontFamily: sans, fontSize: 11.5, fontWeight: 700, color: "rgba(255,255,255,0.85)", marginBottom: 3, letterSpacing: 0.3, textTransform: "uppercase" }}>
          Universal search
        </div>
        <div style={{ fontFamily: serif, fontSize: 17, color: "#FFFFFF", marginBottom: 14, lineHeight: 1.4 }}>
          Search one topic, find everything that helps you understand it.
        </div>
        <div style={{ position: "relative" }}>
          <span style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", color: c.blue, fontSize: 15 }}>⌕</span>
          <input
            type="text"
            value={heroQuery}
            onChange={(e) => setHeroQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitHeroSearch(heroQuery)}
            placeholder="e.g. vector"
            style={{
              width: "100%",
              padding: "13px 16px 13px 42px",
              fontSize: 14,
              borderRadius: 13,
              border: "none",
              background: "#FFFFFF",
              color: c.ink,
              fontFamily: sans,
              boxSizing: "border-box",
              outline: "none",
            }}
          />
          {heroQuery && (
            <button
              onClick={() => submitHeroSearch(heroQuery)}
              style={{
                position: "absolute",
                right: 6,
                top: "50%",
                transform: "translateY(-50%)",
                padding: "7px 14px",
                borderRadius: 9,
                border: "none",
                background: c.ink,
                color: "#fff",
                fontFamily: sans,
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Search
            </button>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", marginTop: 12 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 12px", borderRadius: 999, background: "rgba(255,255,255,0.18)", border: "1px solid rgba(255,255,255,0.35)", color: "#FFFFFF", fontFamily: sans, fontSize: 11, fontWeight: 600 }}>
            <span style={{ fontWeight: 800 }}>✎</span> Search results also recommend practice problem sets for your topic
          </span>
        </div>

        {!hasQuery && (
          <>
            <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginTop: 14 }}>
              {SUGGESTED_QUERIES.map((q) => (
                <button
                  key={q}
                  onClick={() => submitHeroSearch(q)}
                  style={{
                    padding: "6px 13px",
                    borderRadius: 999,
                    border: "1px solid rgba(255,255,255,0.4)",
                    background: "rgba(255,255,255,0.14)",
                    color: "#FFFFFF",
                    fontFamily: sans,
                    fontSize: 11.5,
                    cursor: "pointer",
                  }}
                >
                  {q}
                </button>
              ))}
            </div>
            <HowItWorks ctx={ctx} />
          </>
        )}
      </div>

      <AiEthicsBanner ctx={ctx} embedded />

      {/* results */}
      {hasQuery && (heroSearching || !heroResults) && (
        <div style={{ padding: "36px 20px", textAlign: "center", borderRadius: 14, border: `1px dashed ${c.line}`, background: c.card }}>
          <div style={{ fontSize: 22, marginBottom: 6 }}>🔎</div>
          <div style={{ fontFamily: sans, fontSize: 12.5, color: c.inkMuted }}>
            Searching materials, practice problems & discussions related to <strong style={{ color: c.ink }}>"{heroSubmitted}"</strong>…
          </div>
        </div>
      )}
      {hasQuery && !heroSearching && heroResults && (
        <div style={{ paddingBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <span style={{ fontFamily: sans, fontSize: 12.5, color: c.inkMuted }}>
              Materials, practice problems & forum discussions for <strong style={{ color: c.ink }}>"{shownQuery}"</strong>
            </span>
            <button onClick={clearHeroSearch} style={{ background: "none", border: "none", color: c.inkFaint, fontFamily: sans, fontSize: 11.5, cursor: "pointer", textDecoration: "underline" }}>
              Search another topic
            </button>
          </div>

          {heroSearchNote && (
            <div style={{ fontFamily: sans, fontSize: 11.5, color: c.inkMuted, background: c.fieldBg, borderRadius: 10, padding: "8px 12px", marginBottom: 12 }}>
              {heroSearchNote}
            </div>
          )}

          {["direct", "foundational", "exercises", "supporting", "applied", "forum"].every((k) => (heroResults[k] || []).length === 0) ? (
            <div style={{ padding: "36px 20px", textAlign: "center", borderRadius: 14, border: `1px dashed ${c.line}`, background: c.card }}>
              <div style={{ fontSize: 22, marginBottom: 6 }}>🔍</div>
              <div style={{ fontFamily: sans, fontSize: 12.5, color: c.inkMuted }}>No materials, practice problems, or forum discussions match this search yet.</div>
            </div>
          ) : (
            <>
              {["direct", "foundational", "exercises", "supporting", "applied"].map((tierKey) => {
                const items = heroResults[tierKey] || [];
                if (items.length === 0) return null;
                const t = TIER[tierKey];
                return (
                  <div key={tierKey} style={{ marginBottom: 20 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 3 }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: t.accent, display: "inline-block", flexShrink: 0 }} />
                      <span style={{ fontFamily: sans, fontSize: 13, fontWeight: 700, color: c.ink }}>{t.label}</span>
                    </div>
                    <div style={{ fontFamily: sans, fontSize: 10.5, color: c.inkFaint, marginLeft: 16, marginBottom: 10 }}>
                      {t.sub.replace("{q}", shownQuery)}
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8 }}>
                      {items.map((m, i) => (
                        <SearchResultCard key={i} ctx={ctx} m={m} tier={tierKey} tierMeta={t} />
                      ))}
                    </div>
                  </div>
                );
              })}

              {heroResults.forum.length > 0 && (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 3 }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: forumTierMeta.accent, display: "inline-block", flexShrink: 0 }} />
                    <span style={{ fontFamily: sans, fontSize: 13, fontWeight: 700, color: c.ink }}>Related forum discussions</span>
                  </div>
                  <div style={{ fontFamily: sans, fontSize: 10.5, color: c.inkFaint, marginLeft: 16, marginBottom: 10 }}>
                    Threads in the Discussion Forum related to "{shownQuery}"
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 8 }}>
                    {heroResults.forum.map((p, i) => (
                      <ForumSearchResultCard key={i} ctx={ctx} p={p} tierMeta={forumTierMeta} />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ---- small tag chip, styling differs for AI-suggested vs manual tags -------------------------------------------------
function TagChip({ ctx, tag }) {
  const { c, sans } = ctx;
  const isAi = tag.source === "ai";
  return (
    <span
      title={isAi ? `Disarankan otomatis · keyakinan ${Math.round(tag.confidence * 100)}%` : "Tag manual"}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontFamily: sans,
        fontSize: 10.5,
        fontWeight: isAi ? 500 : 600,
        color: isAi ? c.aiTag : c.inkMuted,
        background: isAi ? c.aiTagSoft : c.fieldBg,
        border: isAi ? `1px dashed ${c.aiTag}55` : "1px solid transparent",
        padding: "2.5px 8px",
        borderRadius: 999,
      }}
    >
      {isAi && <span style={{ fontSize: 9 }}>✦</span>}
      {tag.label}
    </span>
  );
}

// ---- folder grid (subjects at root, topics inside a subject) -------------------------------------------------
function FolderGrid({ ctx }) {
  const { c, sans, openSubject, setOpenTopic, goToSubject, localModules, moduleKindFilter } = ctx;
  const items = openSubject
    ? moduleTopicsFor(openSubject, localModules).map((t) => ({ key: t.name, label: t.name, isNew: t.isNew, count: moduleCountFor(openSubject, t.name, localModules, moduleKindFilter) }))
    : SUBJECT_ORDER.map((subject) => ({ key: subject, label: subject, count: moduleCountFor(subject, undefined, localModules, moduleKindFilter) }));

  return (
    <div style={{ padding: "0 32px", marginBottom: 22 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
        {items.map((item) => (
          <button
            key={item.key}
            onClick={() => (openSubject ? setOpenTopic(item.key) : goToSubject(item.key))}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "13px 14px",
              borderRadius: 13,
              border: `1px solid ${c.line}`,
              background: c.card,
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <div style={{ width: 34, height: 34, borderRadius: 9, background: item.key === "Philosophy" && !openSubject ? "#8A5CD914" : c.blueSoft, color: item.key === "Philosophy" && !openSubject ? "#8A5CD9" : c.blue, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>
              {openSubject ? "◈" : item.key === "Philosophy" ? "💭" : "▦"}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: sans, fontWeight: 700, fontSize: 12.5, color: c.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.label}</div>
              <div style={{ fontFamily: sans, fontSize: 10.5, color: c.inkFaint }}>
                {item.count} modul{item.key === "Philosophy" && !openSubject ? " · sharing, bukan materi resmi" : ""}{item.isNew ? " · topik baru" : ""}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---- module list (files inside the current folder / search results) -------------------------------------------------
function ModuleList({ ctx, heading }) {
  const { c, sans, modulesInView, isSearching, openSubject, openProfile, avatarFor, CURRENT_USER, deleteModule, deletingModuleId, moduleActionError, setPreviewModule, editingModuleId, setEditingModuleId, savingEdit, saveModuleTitle, saveModuleType, localPosts, startDiscussionAboutModule, openDiscussionsForModule, highlightedModuleId } = ctx;
  return (
    <div style={{ padding: "0 32px" }}>
      {heading && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <h2 style={{ fontFamily: sans, fontSize: 13, fontWeight: 700, color: c.inkMuted, margin: 0, textTransform: "uppercase", letterSpacing: 0.4 }}>{heading}</h2>
          <span style={{ fontFamily: sans, fontSize: 11, color: c.inkFaint }}>{modulesInView.length} file</span>
        </div>
      )}

      {moduleActionError && (
        <div style={{ marginBottom: 10, padding: "9px 13px", borderRadius: 10, background: "#D9553A14", fontFamily: sans, fontSize: 11.5, color: "#D9553A" }}>
          {moduleActionError}
        </div>
      )}

      {modulesInView.length === 0 ? (
        <div style={{ padding: "36px 20px", textAlign: "center", borderRadius: 14, border: `1px dashed ${c.line}`, background: c.card }}>
          <div style={{ fontSize: 22, marginBottom: 6 }}>📂</div>
          <div style={{ fontFamily: sans, fontSize: 12.5, color: c.inkMuted }}>Belum ada modul yang cocok di sini.</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {modulesInView.map((m, i) => {
            const isOwner = m.uploader === CURRENT_USER;
            const isDeleting = deletingModuleId === m.id;
            const isEditing = editingModuleId === m.id;
            const discussionCount = localPosts.filter((p) => p.moduleId === m.id).length;
            const isLink = m.type === "LINK";
            const hasRealSource = !!m.fileUrl || !!m.linkUrl;
            return (
              <div
                key={m.id || i}
                id={`module-card-${m.id}`}
                onClick={() => { if (hasRealSource) setPreviewModule(m); }}
                title="Klik untuk pratinjau"
                style={{
                  display: "flex", alignItems: "flex-start", gap: 13, padding: "13px 15px", borderRadius: 13,
                  background: c.card, border: `1px solid ${highlightedModuleId === m.id ? c.blue : c.line}`, opacity: isDeleting ? 0.5 : 1,
                  boxShadow: highlightedModuleId === m.id ? `0 0 0 4px ${c.blue}33` : "none", transition: "box-shadow 0.4s, border-color 0.4s",
                  cursor: hasRealSource ? "pointer" : "default",
                }}
              >
                <div style={{ width: 38, height: 38, borderRadius: 10, background: c.blueSoft, color: c.blue, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800, flexShrink: 0 }}>
                  {isLink ? "🔗" : m.type}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                    {isEditing ? (
                      <div style={{ flex: 1 }} onClick={(e) => e.stopPropagation()}>
                        <InlineTextEditor ctx={ctx} initial={m.title} maxLength={200} saving={savingEdit} placeholder="Judul modul" onSave={(t) => saveModuleTitle(m.id, t)} onCancel={() => setEditingModuleId(null)} />
                      </div>
                    ) : (
                      <div style={{ fontFamily: sans, fontWeight: 700, fontSize: 13, color: c.ink }}>{m.title}</div>
                    )}
                    {isLink && (
                      <span style={{ fontFamily: sans, fontSize: 9.5, fontWeight: 700, color: c.blue, background: c.blueSoft, padding: "1.5px 7px", borderRadius: 999, flexShrink: 0 }}>
                        🔗 Link
                      </span>
                    )}
                    {m.isExercise && (
                      <span style={{ fontFamily: sans, fontSize: 9.5, fontWeight: 700, color: c.exerciseAccent, background: c.exerciseSoft, padding: "1.5px 7px", borderRadius: 999, flexShrink: 0 }}>
                        ✎ Latihan soal
                      </span>
                    )}
                    {m.isShare && (
                      <span style={{ fontFamily: sans, fontSize: 9.5, fontWeight: 700, color: "#8A5CD9", background: "#8A5CD914", padding: "1.5px 7px", borderRadius: 999, flexShrink: 0 }}>
                        💭 Sharing
                      </span>
                    )}
                  </div>
                  {m.originalTitle && m.originalTitle !== m.title && !isEditing && (
                    <div style={{ fontFamily: sans, fontSize: 10.5, color: c.blue, marginBottom: 5, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span>✨ Judul disesuaikan AI · judul asli: "{m.originalTitle}"</span>
                      {isOwner && (
                        <button
                          onClick={(e) => { e.stopPropagation(); saveModuleTitle(m.id, m.originalTitle); }}
                          disabled={savingEdit}
                          style={{ background: "none", border: `1px solid ${c.blue}55`, color: c.blue, borderRadius: 999, padding: "1px 9px", fontFamily: sans, fontSize: 10, fontWeight: 700, cursor: "pointer" }}
                        >
                          Pakai judul asli
                        </button>
                      )}
                    </div>
                  )}
                  {m.exerciseSetBy === "ai" && !isEditing && (
                    <div style={{ fontFamily: sans, fontSize: 10.5, color: c.exerciseAccent, marginBottom: 5 }}>
                      ✨ Jenis diatur AI: {m.isExercise ? "latihan soal" : "materi"}
                    </div>
                  )}
                  {m.description && (
                    <div style={{ fontFamily: sans, fontSize: 11.5, color: c.inkMuted, marginBottom: 5, lineHeight: 1.4 }}>{m.description}</div>
                  )}
                  <div style={{ fontFamily: sans, fontSize: 11, color: c.inkFaint, marginBottom: 7 }}>
                    {m.subject} {isSearching || !openSubject ? `· ${m.topic}` : ""}{m.size ? ` · ${m.size}` : ""} · {m.date}
                  </div>
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                    {m.tags.map((t, ti) => (
                      <TagChip key={ti} ctx={ctx} tag={t} />
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
                    <button
                      onClick={(e) => { e.stopPropagation(); startDiscussionAboutModule(m); }}
                      title="Mulai diskusi di forum tentang modul ini"
                      style={{ background: "none", border: "none", cursor: "pointer", padding: 0, fontFamily: sans, fontSize: 11, fontWeight: 700, color: c.blue }}
                    >
                      💬 Diskusikan
                    </button>
                    {discussionCount > 0 && (
                      <button
                        onClick={(e) => { e.stopPropagation(); openDiscussionsForModule(m); }}
                        title="Lihat diskusi di forum yang menyebut modul ini"
                        style={{ background: "none", border: "none", cursor: "pointer", padding: 0, fontFamily: sans, fontSize: 11, fontWeight: 700, color: c.inkMuted }}
                      >
                        {discussionCount} diskusi →
                      </button>
                    )}
                    {isOwner && !isEditing && (
                      <button
                        onClick={(e) => { e.stopPropagation(); saveModuleType(m.id, !m.isExercise); }}
                        disabled={savingEdit}
                        style={{ background: "none", border: "none", cursor: "pointer", padding: 0, fontFamily: sans, fontSize: 10.5, color: c.inkFaint, textDecoration: "underline" }}
                      >
                        {m.isExercise ? "Ubah jadi materi" : "Tandai sebagai latihan soal"}
                      </button>
                    )}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                  <button
                    onClick={(e) => { e.stopPropagation(); openProfile(m.uploader); }}
                    style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", padding: 0 }}
                  >
                    <UsernameAvatar username={m.uploader} size={22} photoUrl={avatarFor(m.uploader)} />
                    <span style={{ fontFamily: sans, fontSize: 11, color: c.inkMuted }}>{m.uploader}</span>
                  </button>
                  {isOwner && (
                    <>
                    <button
                      onClick={(e) => { e.stopPropagation(); setEditingModuleId(isEditing ? null : m.id); }}
                      title="Edit judul"
                      aria-label="Edit judul modul"
                      style={{ background: "none", border: "none", cursor: "pointer", padding: 4, color: c.inkFaint, fontSize: 14, lineHeight: 1 }}
                    >
                      ✏️
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (window.confirm("Hapus modul ini? Tindakan ini tidak bisa dibatalkan.")) deleteModule(m.id);
                      }}
                      disabled={isDeleting}
                      title="Hapus modul"
                      aria-label="Hapus modul"
                      style={{ background: "none", border: "none", cursor: isDeleting ? "default" : "pointer", padding: 4, color: c.inkFaint, fontSize: 14, lineHeight: 1 }}
                    >
                      🗑️
                    </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---- Bank Modul: root/subject views show folders; topic view or an active
// search shows the file list directly -------------------------------------------------
function BankModulSection({ ctx }) {
  const {
    c, sans, inputStyle, openTopic, isSearching, search,
    goToSubject, setOpenTopic, setEditingModuleId, saveModuleTitle, savingEdit,
    uploadingModule, setUploadingModule,
    moduleDraftTitle, setModuleDraftTitle,
    moduleDraftSubject, setModuleDraftSubject,
    moduleDraftTopic, setModuleDraftTopic,
    moduleDraftTopicMode, setModuleDraftTopicMode,
    moduleDraftCustomTopic, setModuleDraftCustomTopic,
    moduleDraftDescription, setModuleDraftDescription,
    moduleDraftTags, setModuleDraftTags,
    moduleDraftKind, setModuleDraftKind,
    moduleDraftIsExercise, setModuleDraftIsExercise,
    moduleDraftFile, setModuleDraftFile,
    moduleDraftLinkUrl, setModuleDraftLinkUrl,
    moduleDraftAllowAiFileRead, setModuleDraftAllowAiFileRead,
    showAiConsentModal, setShowAiConsentModal,
    resetModuleDraft, submitModuleUpload,
    moduleKindFilter, setModuleKindFilter, typeChangeNotifications, setTypeChangeNotifications, saveModuleType,
    modulesLoading, localModules, pendingModuleUploads,
    titleChangeNotifications, setTitleChangeNotifications,
    openSubject,
  } = ctx;
  const showFolders = !isSearching && !openTopic;
  const kindCounts = {
    all: localModules.length,
    material: localModules.filter((m) => !m.isExercise).length,
    exercise: localModules.filter((m) => m.isExercise).length,
  };

  if (uploadingModule) return (
    <ModuleUploadComposer
      c={c} sans={sans} inputStyle={inputStyle}
      moduleDraftTitle={moduleDraftTitle} setModuleDraftTitle={setModuleDraftTitle}
      moduleDraftSubject={moduleDraftSubject} setModuleDraftSubject={setModuleDraftSubject}
      moduleDraftTopic={moduleDraftTopic} setModuleDraftTopic={setModuleDraftTopic}
      moduleDraftTopicMode={moduleDraftTopicMode} setModuleDraftTopicMode={setModuleDraftTopicMode}
      moduleDraftCustomTopic={moduleDraftCustomTopic} setModuleDraftCustomTopic={setModuleDraftCustomTopic}
      moduleDraftDescription={moduleDraftDescription} setModuleDraftDescription={setModuleDraftDescription}
      moduleDraftTags={moduleDraftTags} setModuleDraftTags={setModuleDraftTags}
      moduleDraftKind={moduleDraftKind} setModuleDraftKind={setModuleDraftKind}
      moduleDraftIsExercise={moduleDraftIsExercise} setModuleDraftIsExercise={setModuleDraftIsExercise}
      moduleDraftFile={moduleDraftFile} setModuleDraftFile={setModuleDraftFile}
      moduleDraftLinkUrl={moduleDraftLinkUrl} setModuleDraftLinkUrl={setModuleDraftLinkUrl}
      moduleDraftAllowAiFileRead={moduleDraftAllowAiFileRead} setModuleDraftAllowAiFileRead={setModuleDraftAllowAiFileRead}
      showAiConsentModal={showAiConsentModal} setShowAiConsentModal={setShowAiConsentModal}
      setUploadingModule={setUploadingModule} resetModuleDraft={resetModuleDraft} submitModuleUpload={submitModuleUpload}
    />
  );

  return (
    <>
      {showFolders && <ModuleBankBanner ctx={ctx} count={localModules.length} loading={modulesLoading} />}
      <Breadcrumb ctx={ctx} />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 32px", marginBottom: 12 }}>
        <span style={{ fontFamily: sans, fontSize: 11.5, color: c.inkFaint, fontStyle: "italic" }}>
          {modulesLoading ? "Memuat modul..." : `${localModules.length} modul`}
        </span>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => {
              setModuleDraftSubject(openSubject || SUBJECT_ORDER[0]);
              setUploadingModule(true);
            }}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 999,
              border: "none", background: c.blue, color: "#fff", fontFamily: sans, fontSize: 12, fontWeight: 700, cursor: "pointer",
            }}
          >
            + Upload modul
          </button>
          <FilterToggleButton ctx={ctx} />
        </div>
      </div>
      {titleChangeNotifications.length > 0 && (
        <div style={{ padding: "0 32px", marginBottom: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          {titleChangeNotifications.map((note) => (
            <div key={note.id} style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, padding: "12px 15px", borderRadius: 12, background: c.blueSoft, border: `1px solid ${c.blue}30` }}>
              <div style={{ display: "flex", gap: 10, minWidth: 0 }}>
                <span style={{ fontSize: 15, flexShrink: 0 }}>✨</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontFamily: sans, fontWeight: 700, fontSize: 12, color: c.ink, marginBottom: 2 }}>Judul disesuaikan AI</div>
                  <div style={{ fontFamily: sans, fontSize: 11, color: c.inkMuted, lineHeight: 1.5 }}>
                    "{note.oldTitle}" → <strong style={{ color: c.ink }}>"{note.newTitle}"</strong>. Kamu tetap bisa mengeditnya kapan saja.
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                    <button
                      onClick={() => {
                        const mod = localModules.find((x) => x.id === note.moduleId);
                        if (mod) { goToSubject(mod.subject); setOpenTopic(mod.topic); setEditingModuleId(mod.id); }
                      }}
                      style={{ background: c.blue, color: "#FFFFFF", border: "none", borderRadius: 999, padding: "4px 12px", fontFamily: sans, fontSize: 10.5, fontWeight: 700, cursor: "pointer" }}
                    >
                      Edit judul
                    </button>
                    <button
                      onClick={() => saveModuleTitle(note.moduleId, note.oldTitle)}
                      disabled={savingEdit}
                      style={{ background: "none", color: c.blue, border: `1px solid ${c.blue}55`, borderRadius: 999, padding: "4px 12px", fontFamily: sans, fontSize: 10.5, fontWeight: 700, cursor: "pointer" }}
                    >
                      Pakai judul asli
                    </button>
                  </div>
                </div>
              </div>
              <button
                onClick={() => setTitleChangeNotifications((prev) => prev.filter((n) => n.id !== note.id))}
                aria-label="Tutup"
                style={{ background: "none", border: "none", cursor: "pointer", color: c.inkFaint, fontSize: 13, padding: 0, flexShrink: 0 }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      {typeChangeNotifications.length > 0 && (
        <div style={{ padding: "0 32px", marginBottom: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          {typeChangeNotifications.map((note) => (
            <div key={note.id} style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, padding: "12px 15px", borderRadius: 12, background: c.exerciseSoft, border: `1px solid ${c.exerciseAccent}33` }}>
              <div style={{ display: "flex", gap: 10, minWidth: 0 }}>
                <span style={{ fontSize: 15, flexShrink: 0 }}>✨</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontFamily: sans, fontWeight: 700, fontSize: 12, color: c.ink, marginBottom: 2 }}>
                    AI mengubah jenis modul menjadi {note.isExercise ? "Latihan soal (exercises)" : "Materi"}
                  </div>
                  <div style={{ fontFamily: sans, fontSize: 11, color: c.inkMuted, lineHeight: 1.5 }}>
                    "{note.title}" — kamu tetap bisa mengembalikannya kapan saja.
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <button
                      onClick={() => saveModuleType(note.moduleId, !note.isExercise)}
                      disabled={savingEdit}
                      style={{ background: c.exerciseAccent, color: "#FFFFFF", border: "none", borderRadius: 999, padding: "4px 12px", fontFamily: sans, fontSize: 10.5, fontWeight: 700, cursor: "pointer" }}
                    >
                      Kembalikan jadi {note.isExercise ? "materi" : "latihan soal"}
                    </button>
                  </div>
                </div>
              </div>
              <button
                onClick={() => setTypeChangeNotifications((prev) => prev.filter((n) => n.id !== note.id))}
                aria-label="Tutup"
                style={{ background: "none", border: "none", cursor: "pointer", color: c.inkFaint, fontSize: 13, padding: 0, flexShrink: 0 }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      {pendingModuleUploads.length > 0 && (
        <div style={{ padding: "0 32px", marginBottom: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          {pendingModuleUploads.map((pending) => (
            <div key={pending.tempId} style={{ padding: "12px 15px", borderRadius: 12, background: c.card, border: `1px dashed ${c.line}`, opacity: 0.75 }}>
              <div style={{ fontFamily: sans, fontWeight: 700, fontSize: 12.5, color: c.ink, marginBottom: 2 }}>{pending.title}</div>
              {pending.error ? (
                <div style={{ fontFamily: sans, fontSize: 11, color: "#D9553A" }}>{pending.error}</div>
              ) : (
                <div style={{ fontFamily: sans, fontSize: 11, color: c.inkFaint, fontStyle: "italic" }}>Mengunggah...</div>
              )}
            </div>
          ))}
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap", padding: "0 32px", marginBottom: 12 }}>
        <span style={{ fontFamily: sans, fontSize: 11, fontWeight: 700, color: c.inkFaint, marginRight: 2 }}>Jenis:</span>
        {[
          { key: "all", label: "Semua", color: c.ink },
          { key: "material", label: "📘 Materi", color: c.blue },
          { key: "exercise", label: "✎ Exercises", color: c.exerciseAccent },
        ].map((opt) => {
          const active = moduleKindFilter === opt.key;
          return (
            <button
              key={opt.key}
              onClick={() => setModuleKindFilter(opt.key)}
              aria-pressed={active}
              style={{
                display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 12px", borderRadius: 999,
                border: `1px solid ${active ? opt.color : c.line}`, background: active ? `${opt.color}14` : c.card,
                color: active ? opt.color : c.inkMuted, fontFamily: sans, fontSize: 11.5, fontWeight: 700, cursor: "pointer",
              }}
            >
              {opt.label} <span style={{ fontWeight: 600, opacity: 0.7 }}>{kindCounts[opt.key]}</span>
            </button>
          );
        })}
      </div>
      <FilterPanel ctx={ctx} />
      {showFolders && <FolderGrid ctx={ctx} />}
      {(!showFolders || isSearching) && <ModuleList ctx={ctx} heading={isSearching ? `Hasil pencarian "${search.trim()}"` : openTopic} />}
    </>
  );
}

// ---- forum: post list, thread detail, and a lightweight new-post
// composer. This is a discussion forum, not a Q&A ticketing system — a
// post can be a question, but just as easily an idea, a shared resource,
// or an open-ended thought. No voting/scoring, no "accepted answer";
// replies are flat and simply chronological. -------------------------------------------------
function ForumSection({ ctx }) {
  const {
    c, sans, forumAccent, CURRENT_USER,
    myProfile, openProfile, avatarFor,
    likedIds, bookmarkedIds, likeCounts, toggleLike, toggleBookmark,
    localPosts, pendingPosts, localReplies, pendingReplies,
    forumActionError, setForumActionError,
    deletePost, deleteReply, countAllReplies,
    composingPost, setComposingPost,
    draftPostType, setDraftPostType, draftBody, setDraftBody, draftImages, setDraftImages,
    submitForumPost, submitForumReply,
    replyTarget, setReplyTarget, replyDraft, setReplyDraft,
    openThread, closeThread,
    openPostId,
    editingPostId, setEditingPostId, editingReplyId, setEditingReplyId, savingEdit,
    saveForumPostEdit, saveForumReplyEdit, forumTypeFilters, setForumTypeFilters,
    localModules, draftMentionModuleId, setDraftMentionModuleId, openModuleFromMention, forumModuleFilterId, setForumModuleFilterId,
  } = ctx;

  // Bundled the same way as the already-hoisted forum leaf components
  // (PostList, ThreadDetail, NewPostComposer, etc.) expect — see the note
  // above PostTypeBadge.
  const forumCtx = {
    c, sans, forumAccent, CURRENT_USER,
    myProfile, openProfile, avatarFor,
    likedIds, bookmarkedIds, likeCounts, toggleLike, toggleBookmark,
    localPosts, pendingPosts, localReplies, pendingReplies,
    forumActionError, setForumActionError,
    deletePost, deleteReply, countAllReplies,
    composingPost, setComposingPost,
    draftPostType, setDraftPostType, draftBody, setDraftBody, draftImages, setDraftImages,
    submitForumPost, submitForumReply,
    replyTarget, setReplyTarget, replyDraft, setReplyDraft,
    openThread, closeThread,
    editingPostId, setEditingPostId, editingReplyId, setEditingReplyId, savingEdit,
    saveForumPostEdit, saveForumReplyEdit, forumTypeFilters, setForumTypeFilters,
    localModules, draftMentionModuleId, setDraftMentionModuleId, openModuleFromMention, forumModuleFilterId, setForumModuleFilterId,
  };

  if (composingPost) return <NewPostComposer ctx={forumCtx} />;
  const openPost = openPostId ? localPosts.find((p) => p.id === openPostId) : null;
  if (openPost && openPost.postType === "diskusi") {
    return <ChatRoom ctx={forumCtx} post={openPost} UsernameAvatar={UsernameAvatar} uploadDirectToCloudinary={uploadDirectToCloudinary} />;
  }
  if (openPost) return <ThreadDetail ctx={forumCtx} post={openPost} />;
  return (
    <>
      <ChatFeedSync ctx={ctx} />
      <PostList ctx={forumCtx} />
    </>
  );
}

// ---- activity feed (its own section, separate from Beranda) -------------------------------------------------
function ActivityFeed({ ctx }) {
  const { c, sans, openProfile, avatarFor, activityItems, activityLoading, activityError, fetchActivity, setActiveNav, setComposingPost, setOpenSubject, setOpenTopic, openThreadFromSearch } = ctx;

  // Data asli dari database. Kalau gagal dimuat, tampilkan pesan error saja.
  const rows = activityItems
    ? activityItems.map((it) => ({ key: it.id, type: it.type, user: it.user, subject: it.subject, text: it.text, time: relativeTimeId(it.createdAt), target: it.target }))
    : [];

  function openTarget(target) {
    if (!target) return;
    if (target.kind === "post") {
      setActiveNav("forum");
      setComposingPost(false);
      openThreadFromSearch(target.id);
    } else if (target.kind === "module") {
      setActiveNav("modules");
      setOpenSubject(target.subject);
      setOpenTopic(target.topic);
    }
  }

  return (
    <div style={{ padding: "0 32px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <span style={{ fontFamily: sans, fontSize: 11.5, color: c.inkFaint, fontStyle: "italic" }}>
          aktivitas terbaru dari database
        </span>
        <button
          onClick={fetchActivity}
          disabled={activityLoading}
          style={{ background: "none", border: `1px solid ${c.line}`, borderRadius: 999, padding: "5px 12px", fontFamily: sans, fontSize: 11, fontWeight: 700, color: c.inkMuted, cursor: activityLoading ? "default" : "pointer" }}
        >
          {activityLoading ? "Memuat..." : "↻ Muat ulang"}
        </button>
      </div>

      {activityError && (
        <div style={{ marginBottom: 12, padding: "9px 13px", borderRadius: 10, background: "#D9553A14", fontFamily: sans, fontSize: 11.5, color: "#D9553A" }}>{activityError}</div>
      )}

      {!activityLoading && !activityError && activityItems && activityItems.length === 0 && (
        <div style={{ padding: "36px 20px", textAlign: "center", borderRadius: 14, border: `1px dashed ${c.line}`, background: c.card, fontFamily: sans, fontSize: 12.5, color: c.inkMuted }}>
          Belum ada aktivitas. Upload modul atau mulai diskusi untuk memulai!
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8, opacity: activityLoading && !activityItems ? 0.5 : 1 }}>
        {rows.map((item) => {
          const meta = TYPE_META[item.type];
          return (
            <div key={item.key} style={{ display: "flex", gap: 12, padding: "13px 16px", borderRadius: 12, background: c.card, border: `1px solid ${c.line}`, alignItems: "flex-start" }}>
              <button onClick={() => openProfile(item.user)} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", lineHeight: 0 }}>
                <UsernameAvatar username={item.user} size={32} photoUrl={avatarFor(item.user)} />
              </button>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: sans, fontSize: 12.5, color: c.ink, lineHeight: 1.5 }}>
                  <button onClick={() => openProfile(item.user)} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", font: "inherit", fontWeight: 700, color: c.ink }}>
                    {item.user}
                  </button>{" "}
                  {item.text}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontFamily: sans, fontSize: 10.5, fontWeight: 700, color: meta.color, background: `${meta.color}14`, padding: "2px 8px", borderRadius: 999 }}>
                    {meta.icon} {meta.label}
                  </span>
                  <span style={{ fontFamily: sans, fontSize: 10.5, color: c.inkFaint }}>{item.subject}</span>
                  <span style={{ fontFamily: sans, fontSize: 10.5, color: c.inkFaint }}>· {item.time}</span>
                </div>
              </div>
              {item.target && (
                <button
                  onClick={() => openTarget(item.target)}
                  style={{ background: "none", border: "none", cursor: "pointer", fontFamily: sans, fontSize: 11, fontWeight: 700, color: c.blue, flexShrink: 0, padding: "2px 0" }}
                >
                  Lihat →
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---- right panel: subject directory -------------------------------------------------
function RightPanel({ ctx }) {
  const { c, sans, setActiveNav, goToSubject, openSubject, localModules } = ctx;
  return (
    <div style={{ width: 260, flexShrink: 0, borderLeft: `1px solid ${c.line}`, padding: "24px 20px", boxSizing: "border-box", overflowY: "auto" }}>
      <h2 style={{ fontFamily: sans, fontSize: 13.5, fontWeight: 700, color: c.ink, margin: "0 0 3px" }}>Browse subjects</h2>
      <p style={{ fontFamily: sans, fontSize: 11, color: c.inkFaint, margin: "0 0 14px" }}>Modules per subject</p>

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {SUBJECT_ORDER.map((s) => (
          <button
            key={s}
            onClick={() => {
              setActiveNav("modules");
              goToSubject(s);
            }}
            style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 12px", borderRadius: 9, border: "none", background: openSubject === s ? c.blueSoft : "transparent", cursor: "pointer", textAlign: "left" }}
          >
            <span style={{ fontFamily: sans, fontSize: 12.5, color: c.ink }}>{s}</span>
            <span style={{ fontFamily: sans, fontSize: 10.5, fontWeight: 700, color: c.blue, background: c.blueSoft, padding: "2px 8px", borderRadius: 999, minWidth: 20, textAlign: "center" }}>
              {moduleCountFor(s, undefined, localModules)}
            </span>
          </button>
        ))}
      </div>

      <div style={{ marginTop: 18, padding: "14px 14px", borderRadius: 12, background: c.blueSoft }}>
        <div style={{ fontFamily: sans, fontWeight: 700, fontSize: 12, color: c.ink, marginBottom: 4 }}>💡 Did you know?</div>
        <div style={{ fontFamily: sans, fontSize: 11, color: c.inkMuted, lineHeight: 1.55 }}>
          The forum and Module Bank always use usernames — your real name is optional and only shows on your profile if you turn it on.
        </div>
      </div>
    </div>
  );
}

// ---- RIASEC bio questionnaire modal -------------------------------------------------
// showQuestionnaire/setShowQuestionnaire and questionnaireSession are owned by
// ProfileSection (shared with PhotoLightbox's sibling elements), so they're
// passed in as props rather than closed over.
function RiasecQuestionnaire({ ctx, showQuestionnaire, setShowQuestionnaire }) {
  const { c, sans, forumAccent, setProfileDraft } = ctx;
  // Phases: "answer" (24-item rating) -> "choose-dimension" (pick which
  // top dimension to explore further) -> "tree" (walk that dimension's
  // binary decision tree, one question at a time) -> "results" (leaf
  // reached: show the mid-granularity interest/skill outcome, checkable
  // before applying). From "results", the person can go back to
  // "choose-dimension" to explore a different dimension and accumulate
  // more picks before finally applying everything at once.
  const [phase, setPhase] = useState("answer");
  const [responses, setResponses] = useState({});
  const [ranked, setRanked] = useState([]);
  const [exploredDimensions, setExploredDimensions] = useState([]); // dims already walked this session
  const [currentDim, setCurrentDim] = useState(null);
  const [currentNodeId, setCurrentNodeId] = useState(null);
  const [currentResult, setCurrentResult] = useState(null); // { interests, skills } from the leaf just reached
  const [accumulatedInterests, setAccumulatedInterests] = useState([]);
  const [accumulatedSkills, setAccumulatedSkills] = useState([]);
  const [selectedInterests, setSelectedInterests] = useState([]);
  const [selectedSkills, setSelectedSkills] = useState([]);

  if (!showQuestionnaire) return null;

  const answeredCount = Object.keys(responses).length;
  const allAnswered = answeredCount === RIASEC_ITEMS.length;

  function rate(itemId, value) {
    setResponses((prev) => ({ ...prev, [itemId]: value }));
  }

  function computeResults() {
    const scored = scoreRiasecResponses(responses);
    setRanked(scored);
    setPhase("choose-dimension");
  }

  function startTree(dim) {
    const tree = RIASEC_DECISION_TREES[dim];
    setCurrentDim(dim);
    setCurrentNodeId(tree.root);
    setPhase("tree");
  }

  function answerTreeQuestion(nextNodeId) {
    const tree = RIASEC_DECISION_TREES[currentDim];
    const node = tree.nodes[nextNodeId];
    if (node.result) {
      setCurrentResult(node.result);
      setSelectedInterests(node.result.interests);
      setSelectedSkills(node.result.skills);
      setExploredDimensions((prev) => [...prev, currentDim]);
      setPhase("results");
    } else {
      setCurrentNodeId(nextNodeId);
    }
  }

  function toggleRecommendation(list, setList, item) {
    setList(list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);
  }

  function keepAndExploreAnother() {
    // Stash the current result's checked items, then go back to pick a
    // different dimension — lets someone combine results from e.g. both
    // their #1 and #2 dimension before finally applying to the profile.
    setAccumulatedInterests((prev) => Array.from(new Set([...prev, ...selectedInterests])));
    setAccumulatedSkills((prev) => Array.from(new Set([...prev, ...selectedSkills])));
    setCurrentResult(null);
    setCurrentDim(null);
    setCurrentNodeId(null);
    setPhase("choose-dimension");
  }

  function applyResults() {
    const finalInterests = Array.from(new Set([...accumulatedInterests, ...selectedInterests]));
    const finalSkills = Array.from(new Set([...accumulatedSkills, ...selectedSkills]));
    setProfileDraft((d) => ({
      ...d,
      interests: Array.from(new Set([...d.interests, ...finalInterests])),
      skills: Array.from(new Set([...d.skills, ...finalSkills])),
    }));
    setShowQuestionnaire(false);
  }

  const phaseLabel =
    phase === "answer" ? `${answeredCount}/${RIASEC_ITEMS.length} dijawab` :
    phase === "choose-dimension" ? "Pilih arah" :
    phase === "tree" ? "Pertanyaan lanjutan" : "Hasil";

  return (
    <div
      onClick={() => setShowQuestionnaire(false)}
      style={{ position: "fixed", inset: 0, background: "rgba(10,16,28,0.6)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: c.card, borderRadius: 20, padding: "28px 30px", width: "min(600px, 100%)", maxHeight: "85vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
          <span style={{ fontFamily: sans, fontSize: 10.5, fontWeight: 700, color: c.inkFaint, letterSpacing: 0.3 }}>{phaseLabel}</span>
          <button onClick={() => setShowQuestionnaire(false)} aria-label="Tutup" style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: c.inkFaint, padding: 0 }}>×</button>
        </div>

        {phase === "answer" && (
          <div>
            <div style={{ fontFamily: sans, fontWeight: 700, fontSize: 16, color: c.ink, marginBottom: 6 }}>Seberapa kamu suka melakukan ini?</div>
            <div style={{ fontFamily: sans, fontSize: 12, color: c.inkMuted, marginBottom: 18, lineHeight: 1.5 }}>
              Nilai tiap aktivitas dari 1 (sangat tidak suka) sampai 5 (sangat suka). Ini baru babak pertama — nanti ada pertanyaan lanjutan yang makin spesifik sesuai kecenderunganmu.
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 22 }}>
              {RIASEC_ITEMS.map((item) => (
                <div key={item.id} style={{ paddingBottom: 12, borderBottom: `1px solid ${c.line}` }}>
                  <div style={{ fontFamily: sans, fontSize: 12.5, color: c.ink, marginBottom: 8, lineHeight: 1.4 }}>{item.text}</div>
                  <div style={{ display: "flex", gap: 6 }}>
                    {[1, 2, 3, 4, 5].map((v) => {
                      const active = responses[item.id] === v;
                      return (
                        <button
                          key={v}
                          onClick={() => rate(item.id, v)}
                          aria-label={`Nilai ${v} dari 5`}
                          style={{
                            width: 34, height: 34, borderRadius: 10, cursor: "pointer", fontFamily: sans, fontSize: 12.5, fontWeight: 700,
                            border: active ? "none" : `1px solid ${c.line}`,
                            background: active ? forumAccent : "transparent",
                            color: active ? "#fff" : c.inkMuted,
                          }}
                        >
                          {v}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            <button
              disabled={!allAnswered}
              onClick={computeResults}
              style={{
                width: "100%", padding: "12px 0", borderRadius: 999, border: "none", cursor: allAnswered ? "pointer" : "not-allowed",
                background: allAnswered ? forumAccent : "#B9C3D2", color: "#fff", fontFamily: sans, fontWeight: 700, fontSize: 12.5,
              }}
            >
              {allAnswered ? "Lanjut" : `Jawab semua dulu (${answeredCount}/${RIASEC_ITEMS.length})`}
            </button>
          </div>
        )}

        {phase === "choose-dimension" && (
          <div>
            <div style={{ fontFamily: sans, fontWeight: 700, fontSize: 16, color: c.ink, marginBottom: 6 }}>Kecenderungan kamu</div>
            <div style={{ fontFamily: sans, fontSize: 12, color: c.inkMuted, marginBottom: 18, lineHeight: 1.5 }}>
              {accumulatedInterests.length > 0
                ? "Sudah dapat beberapa rekomendasi. Mau gali arah lain juga, atau langsung selesai?"
                : "Pilih salah satu buat digali lebih lanjut lewat beberapa pertanyaan singkat."}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 20 }}>
              {ranked.map((d) => (
                <div key={d.dim} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 110, fontFamily: sans, fontSize: 11, color: c.inkMuted, flexShrink: 0 }}>{d.label}</div>
                  <div style={{ flex: 1, height: 8, borderRadius: 999, background: c.panel, overflow: "hidden" }}>
                    <div style={{ width: `${(d.score / 20) * 100}%`, height: "100%", background: forumAccent, borderRadius: 999 }} />
                  </div>
                </div>
              ))}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
              {ranked.map((d) => {
                const alreadyDone = exploredDimensions.includes(d.dim);
                return (
                  <button
                    key={d.dim}
                    onClick={() => startTree(d.dim)}
                    disabled={alreadyDone}
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between", textAlign: "left",
                      padding: "13px 16px", borderRadius: 13, fontFamily: sans,
                      border: `1px solid ${c.line}`, background: alreadyDone ? c.panel : "transparent",
                      cursor: alreadyDone ? "default" : "pointer", opacity: alreadyDone ? 0.55 : 1,
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 12.5, color: c.ink }}>{d.label}</div>
                      <div style={{ fontSize: 10.5, color: c.inkFaint, marginTop: 2 }}>{d.blurb}</div>
                    </div>
                    <span style={{ fontSize: 11, color: c.inkFaint }}>{alreadyDone ? "Sudah digali" : "→"}</span>
                  </button>
                );
              })}
            </div>

            {accumulatedInterests.length > 0 && (
              <button
                onClick={applyResults}
                style={{ width: "100%", padding: "12px 0", borderRadius: 999, border: "none", background: forumAccent, color: "#fff", fontFamily: sans, fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}
              >
                Selesai, terapkan semua ke profil
              </button>
            )}
          </div>
        )}

        {phase === "tree" && currentDim && (() => {
          const tree = RIASEC_DECISION_TREES[currentDim];
          const node = tree.nodes[currentNodeId];
          return (
            <div>
              <div style={{ fontFamily: sans, fontWeight: 700, fontSize: 16, color: c.ink, marginBottom: 18, lineHeight: 1.4 }}>{node.question}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {node.options.map((opt) => (
                  <button
                    key={opt.next}
                    onClick={() => answerTreeQuestion(opt.next)}
                    style={{
                      padding: "14px 16px", borderRadius: 13, textAlign: "left", cursor: "pointer", fontFamily: sans,
                      fontSize: 12.5, fontWeight: 600, color: c.ink, border: `1px solid ${c.line}`, background: "transparent",
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          );
        })()}

        {phase === "results" && currentResult && (
          <div>
            <div style={{ fontFamily: sans, fontWeight: 700, fontSize: 16, color: c.ink, marginBottom: 6 }}>Cocok buat kamu</div>
            <div style={{ fontFamily: sans, fontSize: 12, color: c.inkMuted, marginBottom: 18, lineHeight: 1.5 }}>
              Dari jawabanmu, ini yang paling sesuai. Sudah dicentang otomatis — hapus centang yang tidak cocok.
            </div>

            <div style={{ padding: "16px 18px", borderRadius: 14, background: c.card, border: `1px solid ${c.line}`, marginBottom: 12 }}>
              <div style={{ fontFamily: sans, fontWeight: 700, fontSize: 12.5, color: c.ink, marginBottom: 10 }}>Ketertarikan</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                {currentResult.interests.map((interest) => {
                  const active = selectedInterests.includes(interest);
                  return (
                    <button
                      key={interest}
                      onClick={() => toggleRecommendation(selectedInterests, setSelectedInterests, interest)}
                      style={{
                        padding: "7px 13px", borderRadius: 999, cursor: "pointer", fontFamily: sans, fontSize: 12, fontWeight: 600,
                        border: active ? "none" : `1px solid ${c.line}`,
                        background: active ? c.aiTagSoft : "transparent",
                        color: active ? c.aiTag : c.inkFaint,
                      }}
                    >
                      {active ? "✓ " : ""}{interest}
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ padding: "16px 18px", borderRadius: 14, background: c.card, border: `1px solid ${c.line}`, marginBottom: 22 }}>
              <div style={{ fontFamily: sans, fontWeight: 700, fontSize: 12.5, color: c.ink, marginBottom: 10 }}>Skill</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                {currentResult.skills.map((skill) => {
                  const active = selectedSkills.includes(skill);
                  return (
                    <button
                      key={skill}
                      onClick={() => toggleRecommendation(selectedSkills, setSelectedSkills, skill)}
                      style={{
                        padding: "7px 13px", borderRadius: 999, cursor: "pointer", fontFamily: sans, fontSize: 12, fontWeight: 600,
                        border: active ? "none" : `1px solid ${c.line}`,
                        background: active ? c.supportSoft : "transparent",
                        color: active ? c.supportAccent : c.inkFaint,
                      }}
                    >
                      {active ? "✓ " : ""}{skill}
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={keepAndExploreAnother}
                style={{ padding: "11px 20px", borderRadius: 999, border: `1px solid ${c.line}`, background: "none", color: c.inkMuted, fontFamily: sans, fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}
              >
                Gali arah lain juga
              </button>
              <button
                onClick={applyResults}
                style={{ flex: 1, padding: "11px 0", borderRadius: 999, border: "none", background: forumAccent, color: "#fff", fontFamily: sans, fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}
              >
                Selesai, terapkan ke profil
              </button>
            </div>
            <div style={{ fontFamily: sans, fontSize: 10.5, color: c.inkFaint, fontStyle: "italic", marginTop: 10, textAlign: "center" }}>
              Masih bisa diedit manual lagi setelah ini.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Maps a module's file_type/extension to how it should be previewed.
// PDF, images, and plain text render natively in the browser — no external
// service involved. DOCX/PPTX have no native browser renderer, so those
// specifically go through Google Docs Viewer; every other type not covered
// falls back to "no inline preview, download instead" rather than being
// forced through Google Docs Viewer too.
function getPreviewKind(type, fileUrl, linkUrl) {
  if (linkUrl) return "link";
  const t = (type || "").toUpperCase();
  const ext = (fileUrl || "").split(".").pop()?.toUpperCase();
  if (t === "PDF" || ext === "PDF") return "pdf";
  if (["PNG", "JPG", "JPEG", "GIF", "WEBP", "SVG"].includes(t) || ["PNG", "JPG", "JPEG", "GIF", "WEBP", "SVG"].includes(ext)) return "image";
  if (t === "TXT" || ext === "TXT") return "text";
  if (["DOCX", "DOC", "PPTX", "PPT"].includes(t) || ["DOCX", "DOC", "PPTX", "PPT"].includes(ext)) return "gdocs";
  return "unsupported";
}

function ModulePreviewModal({ previewModule, setPreviewModule, c, sans }) {
  const [textContent, setTextContent] = useState(null);
  const [textError, setTextError] = useState(false);

  useEffect(() => {
    setTextContent(null);
    setTextError(false);
    if (previewModule && getPreviewKind(previewModule.type, previewModule.fileUrl, previewModule.linkUrl) === "text") {
      fetch(previewModule.fileUrl)
        .then((res) => {
          if (!res.ok) throw new Error("fetch failed");
          return res.text();
        })
        .then(setTextContent)
        .catch(() => setTextError(true));
    }
  }, [previewModule]);

  if (!previewModule) return null;
  const kind = getPreviewKind(previewModule.type, previewModule.fileUrl, previewModule.linkUrl);

  return (
    <div
      onClick={() => setPreviewModule(null)}
      onKeyDown={(e) => { if (e.key === "Escape") setPreviewModule(null); }}
      tabIndex={-1}
      ref={(el) => el && el.focus()}
      style={{
        position: "fixed", inset: 0, background: "rgba(10,16,28,0.82)", zIndex: 1000,
        display: "flex", alignItems: "center", justifyContent: "center", padding: 28,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: c.card, borderRadius: 18, width: "min(880px, 100%)", height: "min(85vh, 900px)",
          display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderBottom: `1px solid ${c.line}`, flexShrink: 0 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: sans, fontWeight: 700, fontSize: 13.5, color: c.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{previewModule.title}</div>
            <div style={{ fontFamily: sans, fontSize: 10.5, color: c.inkFaint, marginTop: 2 }}>{previewModule.subject} · {previewModule.topic} · {previewModule.type}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            {kind === "link" ? (
              <a
                href={previewModule.linkUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: "inline-flex", alignItems: "center", gap: 5, padding: "7px 13px", borderRadius: 999,
                  background: c.blueSoft, color: c.blue, fontFamily: sans, fontSize: 11.5, fontWeight: 700, textDecoration: "none",
                }}
              >
                ↗ Buka link
              </a>
            ) : (
              <a
                href={previewModule.fileUrl}
                download
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: "inline-flex", alignItems: "center", gap: 5, padding: "7px 13px", borderRadius: 999,
                  background: c.blueSoft, color: c.blue, fontFamily: sans, fontSize: 11.5, fontWeight: 700, textDecoration: "none",
                }}
              >
                ⬇ Download
              </a>
            )}
            <button
              onClick={() => setPreviewModule(null)}
              aria-label="Tutup"
              style={{
                width: 32, height: 32, borderRadius: "50%", border: "none", background: c.panel, color: c.inkMuted,
                fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >
              ×
            </button>
          </div>
        </div>

        <div style={{ flex: 1, minHeight: 0, background: c.panel, display: "flex", alignItems: "center", justifyContent: "center", overflow: "auto" }}>
          {kind === "pdf" && (
            <iframe src={previewModule.fileUrl} title={previewModule.title} style={{ width: "100%", height: "100%", border: "none" }} />
          )}
          {kind === "image" && (
            <img src={previewModule.fileUrl} alt={previewModule.title} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
          )}
          {kind === "text" && (
            <div style={{ width: "100%", height: "100%", overflow: "auto", padding: 24, boxSizing: "border-box" }}>
              {textError ? (
                <div style={{ fontFamily: sans, fontSize: 12.5, color: c.inkFaint, textAlign: "center" }}>Gagal memuat isi file teks.</div>
              ) : textContent === null ? (
                <div style={{ fontFamily: sans, fontSize: 12.5, color: c.inkFaint, textAlign: "center" }}>Memuat...</div>
              ) : (
                <pre style={{ fontFamily: "'SF Mono', Consolas, monospace", fontSize: 12, color: c.ink, whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0 }}>{textContent}</pre>
              )}
            </div>
          )}
          {kind === "link" && (
            <div style={{ textAlign: "center", padding: 24 }}>
              <div style={{ fontSize: 28, marginBottom: 10 }}>🔗</div>
              <div style={{ fontFamily: sans, fontSize: 12.5, color: c.inkMuted, marginBottom: 4 }}>
                Ini modul berupa link eksternal.
              </div>
              <div style={{ fontFamily: sans, fontSize: 11, color: c.inkFaint, marginBottom: 16, maxWidth: 340 }}>
                Kebanyakan layanan seperti Canva atau Google Docs tidak bisa ditampilkan langsung di sini — buka di tab baru untuk melihatnya.
              </div>
              <a
                href={previewModule.linkUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6, padding: "10px 20px", borderRadius: 999,
                  background: c.blue, color: "#fff", fontFamily: sans, fontSize: 12.5, fontWeight: 700, textDecoration: "none",
                }}
              >
                ↗ Buka link
              </a>
            </div>
          )}
          {kind === "gdocs" && (
            <iframe
              src={`https://docs.google.com/gview?url=${encodeURIComponent(previewModule.fileUrl)}&embedded=true`}
              title={previewModule.title}
              style={{ width: "100%", height: "100%", border: "none" }}
            />
          )}
          {kind === "unsupported" && (
            <div style={{ textAlign: "center", padding: 24 }}>
              <div style={{ fontSize: 28, marginBottom: 10 }}>📄</div>
              <div style={{ fontFamily: sans, fontSize: 12.5, color: c.inkMuted }}>Preview tidak tersedia untuk format ini — download untuk membuka filenya.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


function PhotoLightbox({ lightboxAvatar, setLightboxAvatar }) {
  if (!lightboxAvatar) return null;
  return (
    <div
      onClick={() => setLightboxAvatar(null)}
      onKeyDown={(e) => { if (e.key === "Escape") setLightboxAvatar(null); }}
      tabIndex={-1}
      ref={(el) => el && el.focus()}
      style={{
        position: "fixed", inset: 0, background: "rgba(10,16,28,0.82)", zIndex: 1000,
        display: "flex", alignItems: "center", justifyContent: "center", padding: 32,
      }}
    >
      <button
        onClick={() => setLightboxAvatar(null)}
        aria-label="Tutup"
        style={{
          position: "absolute", top: 20, right: 24, width: 40, height: 40, borderRadius: "50%",
          border: "none", background: "rgba(255,255,255,0.12)", color: "#fff", fontSize: 20,
          cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
        }}
      >
        ×
      </button>
      {lightboxAvatar.photoUrl ? (
        <img
          src={lightboxAvatar.photoUrl}
          alt="Foto profil ukuran penuh"
          onClick={(e) => e.stopPropagation()}
          style={{ maxWidth: "min(90vw, 640px)", maxHeight: "85vh", borderRadius: 12, objectFit: "contain", boxShadow: "0 20px 60px rgba(0,0,0,0.4)" }}
        />
      ) : (
        <div onClick={(e) => e.stopPropagation()} style={{ boxShadow: "0 20px 60px rgba(0,0,0,0.4)", borderRadius: 24 }}>
          <UsernameAvatar username={lightboxAvatar.username} size={280} />
        </div>
      )}
    </div>
  );
}

function profileChipStyle(sans, accent, soft) {
  return {
    display: "inline-flex",
    alignItems: "center",
    fontFamily: sans,
    fontSize: 12,
    fontWeight: 600,
    color: accent,
    background: soft,
    padding: "6px 13px",
    borderRadius: 999,
  };
}

// ---- smart tag picker -------------------------------------------------
//
// Backs both Ketertarikan and Skill in edit mode. Pure manual tag input:
// type something, press Enter (or click Tambah), it becomes a chip. No
// preset suggestions here on purpose — this is the direct, no-questionnaire
// path for the person's own words, deliberately separate from the RIASEC
// questionnaire.
//
// tagInputQueries/setTagInputQueries live at the Homepage level (see ctx) —
// not as this component's own useState — for the same reason this
// component itself now lives at module scope: as long as either the state
// or the component definition kept getting recreated by an ancestor
// re-render, React would remount the input and wipe focus after every
// keystroke. Both are now stable, so this input keeps focus normally.
function TagInput({ ctx, fieldKey, values, onChange, accent, soft, placeholder }) {
  const { sans, inputStyle, tagInputQueries, setTagInputQueries } = ctx;
  const query = tagInputQueries[fieldKey] || "";
  const setQuery = (v) => setTagInputQueries((prev) => ({ ...prev, [fieldKey]: v }));

  function addTag() {
    const v = query.trim();
    if (v && !values.includes(v)) onChange([...values, v]);
    setQuery("");
  }
  function removeTag(v) {
    onChange(values.filter((x) => x !== v));
  }

  return (
    <div>
      {values.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginBottom: 12 }}>
          {values.map((v) => (
            <span key={v} style={profileChipStyle(sans, accent, soft)}>
              {v}
              <button
                onClick={() => removeTag(v)}
                style={{ background: "none", border: "none", cursor: "pointer", color: accent, marginLeft: 7, padding: 0, fontSize: 13, lineHeight: 1, opacity: 0.7 }}
                aria-label={`Hapus ${v}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addTag();
            }
          }}
          placeholder={placeholder}
          style={{ ...inputStyle, borderRadius: 10, padding: "10px 12px", flex: 1 }}
        />
        <button
          onClick={addTag}
          disabled={!query.trim()}
          style={{
            padding: "0 18px", borderRadius: 10, border: "none", fontFamily: sans, fontSize: 12.5, fontWeight: 700,
            background: query.trim() ? accent : "#B9C3D2", color: "#fff", cursor: query.trim() ? "pointer" : "not-allowed",
          }}
        >
          Tambah
        </button>
      </div>
    </div>
  );
}

// ---- shared left column: identity card + focus + meta (read-only, both modes) ----
function IdentityCard({ ctx, draftMode, profile, profileDraft, isOwnProfile, editingProfile, setLightboxAvatar }) {
  const { c, sans, photoUploading, photoUploadError, uploadProfilePhoto, deleteProfilePhoto, startEditingProfile, setViewedProfile } = ctx;
  const p = draftMode ? profileDraft : profile;
  const fileInputRef = useRef(null);

  function handlePhotoChange(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;
    if (!file.type.startsWith("image/")) return;
    // Fire-and-forget on purpose: uploadProfilePhoto is defined at the
    // Homepage level and updates state there, so the upload keeps
    // running (and successfully lands its result) even if the person
    // navigates away from Profil before it finishes.
    uploadProfilePhoto(file);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ padding: "28px 24px", borderRadius: 18, background: c.card, border: `1px solid ${c.line}`, textAlign: "center" }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 10 }}>
          <button
            onClick={() => setLightboxAvatar({ username: p.username, photoUrl: p.photoUrl })}
            style={{ position: "relative", padding: 0, border: "none", background: "none", cursor: "pointer", borderRadius: 16 }}
            aria-label="Lihat foto profil ukuran penuh"
          >
            <UsernameAvatar username={p.username} size={72} photoUrl={p.photoUrl} />
            <div
              style={{
                position: "absolute", inset: 0, borderRadius: 16, background: "rgba(19,32,56,0.55)",
                display: "flex", alignItems: "center", justifyContent: "center", opacity: 0,
                transition: "opacity 0.15s",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.opacity = 1)}
              onMouseLeave={(e) => (e.currentTarget.style.opacity = 0)}
            >
              <span style={{ fontSize: 18 }}>🔍</span>
            </div>
          </button>
        </div>
        {draftMode && (
          <input ref={fileInputRef} type="file" accept="image/*" onChange={handlePhotoChange} style={{ display: "none" }} disabled={photoUploading} />
        )}
        {draftMode && (
          <div style={{ marginBottom: 4 }}>
            <button
              onClick={() => fileInputRef.current && fileInputRef.current.click()}
              disabled={photoUploading}
              style={{ background: "none", border: "none", cursor: photoUploading ? "default" : "pointer", fontFamily: sans, fontSize: 11, fontWeight: 700, color: photoUploading ? c.inkFaint : c.blue, padding: "2px 4px" }}
            >
              {photoUploading ? "Mengunggah..." : p.photoUrl ? "Ganti foto" : "Unggah foto (opsional)"}
            </button>
            {p.photoUrl && !photoUploading && (
              <button
                onClick={deleteProfilePhoto}
                style={{ background: "none", border: "none", cursor: "pointer", fontFamily: sans, fontSize: 11, fontWeight: 700, color: c.inkFaint, padding: "2px 4px", marginLeft: 6 }}
              >
                Hapus
              </button>
            )}
            {photoUploadError && (
              <div style={{ fontFamily: sans, fontSize: 10.5, color: "#D9553A", marginTop: 4 }}>{photoUploadError}</div>
            )}
          </div>
        )}
        <div style={{ fontFamily: sans, fontWeight: 700, fontSize: 17, color: c.ink, marginTop: draftMode ? 4 : 0 }}>{p.username}</div>
        {p.showRealName && p.realName ? (
          <div style={{ fontFamily: sans, fontSize: 12.5, color: c.inkMuted, marginTop: 3 }}>{p.realName}</div>
        ) : (
          <div style={{ fontFamily: sans, fontSize: 12, color: c.inkFaint, marginTop: 3, fontStyle: "italic" }}>Nama asli disembunyikan</div>
        )}
        {p.joined && (
          <div style={{ fontFamily: sans, fontSize: 10.5, color: c.inkFaint, marginTop: 10, paddingTop: 10, borderTop: `1px solid ${c.line}` }}>
            Bergabung {p.joined}
          </div>
        )}
        {isOwnProfile && !editingProfile && (
          <button
            onClick={startEditingProfile}
            style={{ marginTop: 16, width: "100%", padding: "9px 0", borderRadius: 999, border: `1px solid ${c.line}`, background: "none", color: c.ink, fontFamily: sans, fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}
          >
            Edit profil
          </button>
        )}
        {isOwnProfile && !editingProfile && (
          <a href="/ganti-password" style={{ display: "block", marginTop: 10, textAlign: "center", fontFamily: sans, fontSize: 11.5, color: c.inkMuted, textDecoration: "none" }}>
            Ganti password
          </a>
        )}
      </div>

      {p.focus && (
        <div style={{ padding: "16px 18px", borderRadius: 16, background: c.blueSoft }}>
          <div style={{ fontFamily: sans, fontSize: 10.5, fontWeight: 700, color: c.blue, marginBottom: 6, letterSpacing: 0.2 }}>
            Lagi fokus di
          </div>
          <div style={{ fontFamily: sans, fontWeight: 700, fontSize: 13.5, color: c.ink }}>{p.focus.subject}</div>
          <div style={{ fontFamily: sans, fontSize: 12, color: c.inkMuted, marginTop: 1 }}>{p.focus.topic}</div>
        </div>
      )}

      {!isOwnProfile && (
        <button
          onClick={() => setViewedProfile(null)}
          style={{ padding: "10px 0", borderRadius: 999, border: `1px solid ${c.line}`, background: "none", color: c.inkMuted, fontFamily: sans, fontSize: 12, fontWeight: 700, cursor: "pointer" }}
        >
          ← Kembali ke profil saya
        </button>
      )}
    </div>
  );
}

// ---- read view: right column content -------------------------------------------------
function ProfileView({ ctx, profile, isOwnProfile, editingProfile, setLightboxAvatar }) {
  const { c, sans } = ctx;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 24, alignItems: "start" }}>
      <IdentityCard ctx={ctx} draftMode={false} profile={profile} isOwnProfile={isOwnProfile} editingProfile={editingProfile} setLightboxAvatar={setLightboxAvatar} />

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {profile.headline && (
          <div style={{ padding: "22px 26px", borderRadius: 16, background: c.card, border: `1px solid ${c.line}` }}>
            <p style={{ fontFamily: sans, fontSize: 15, color: c.ink, lineHeight: 1.65, margin: 0 }}>{profile.headline}</p>
          </div>
        )}

        {profile.goal && (
          <div style={{ padding: "18px 22px", borderRadius: 16, background: c.blueSoft }}>
            <div style={{ fontFamily: sans, fontSize: 10.5, fontWeight: 700, color: c.blue, marginBottom: 6, letterSpacing: 0.2 }}>Goal</div>
            <p style={{ fontFamily: sans, fontSize: 13, color: c.ink, lineHeight: 1.55, margin: 0 }}>{profile.goal}</p>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div style={{ padding: "20px 22px", borderRadius: 16, background: c.card, border: `1px solid ${c.line}` }}>
            <div style={{ fontFamily: sans, fontWeight: 700, fontSize: 12.5, color: c.ink, marginBottom: 12 }}>Ketertarikan</div>
            {profile.interests.length ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                {profile.interests.map((i) => (
                  <span key={i} style={profileChipStyle(sans, c.aiTag, c.aiTagSoft)}>{i}</span>
                ))}
              </div>
            ) : (
              <div style={{ fontFamily: sans, fontSize: 12, color: c.inkFaint, fontStyle: "italic" }}>Belum diisi.</div>
            )}
          </div>

          <div style={{ padding: "20px 22px", borderRadius: 16, background: c.card, border: `1px solid ${c.line}` }}>
            <div style={{ fontFamily: sans, fontWeight: 700, fontSize: 12.5, color: c.ink, marginBottom: 12 }}>Skill</div>
            {profile.skills.length ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                {profile.skills.map((s) => (
                  <span key={s} style={profileChipStyle(sans, c.supportAccent, c.supportSoft)}>{s}</span>
                ))}
              </div>
            ) : (
              <div style={{ fontFamily: sans, fontSize: 12, color: c.inkFaint, fontStyle: "italic" }}>Belum diisi.</div>
            )}
          </div>
        </div>

        {!profile.headline && !profile.goal && !profile.interests.length && !profile.skills.length && (
          <div style={{ padding: "32px 26px", borderRadius: 16, background: c.card, border: `1px dashed ${c.line}`, textAlign: "center" }}>
            <div style={{ fontFamily: sans, fontSize: 12.5, color: c.inkFaint, fontStyle: "italic" }}>
              {isOwnProfile ? "Profil masih kosong — klik \"Edit profil\" untuk mulai mengisi." : "Pengguna ini belum mengisi bio."}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---- edit view: right column content -------------------------------------------------
function ProfileEdit({ ctx, profileDraft, setLightboxAvatar, setShowQuestionnaire, setQuestionnaireSession }) {
  const { c, sans, inputStyle, forumAccent, setProfileDraft, saveProfile, cancelEditingProfile } = ctx;
  return (
    <div onKeyDown={sendOnEnterInput} style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 24, alignItems: "start" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <IdentityCard ctx={ctx} draftMode={true} profileDraft={profileDraft} isOwnProfile={true} editingProfile={true} setLightboxAvatar={setLightboxAvatar} />
        <div style={{ padding: "16px 18px", borderRadius: 16, background: c.panel }}>
          <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={profileDraft.showRealName}
              onChange={(e) => setProfileDraft({ ...profileDraft, showRealName: e.target.checked })}
              style={{ width: 17, height: 17, flexShrink: 0, marginTop: 1, accentColor: c.blue }}
            />
            <div>
              <div style={{ fontFamily: sans, fontWeight: 700, fontSize: 12, color: c.ink, marginBottom: 3 }}>Tampilkan nama asli</div>
              <div style={{ fontFamily: sans, fontSize: 10.5, color: c.inkMuted, lineHeight: 1.5 }}>
                Hanya tampil di halaman profil ini. Forum, Bank Modul, dan Aktivitas tetap selalu memakai username saja.
              </div>
            </div>
          </label>
          <input
            value={profileDraft.realName}
            onChange={(e) => setProfileDraft({ ...profileDraft, realName: e.target.value })}
            placeholder="Nama asli (opsional)"
            style={{ ...inputStyle, borderRadius: 10, padding: "9px 12px", marginTop: 12 }}
          />
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ padding: "22px 26px", borderRadius: 16, background: c.card, border: `1px solid ${c.line}` }}>
          <div style={{ fontFamily: sans, fontWeight: 700, fontSize: 12.5, color: c.ink, marginBottom: 8 }}>Headline singkat</div>
          <input
            value={profileDraft.headline}
            onChange={(e) => setProfileDraft({ ...profileDraft, headline: e.target.value })}
            placeholder="Satu-dua kalimat tentang kamu"
            style={{ ...inputStyle, borderRadius: 10, padding: "10px 12px" }}
          />
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, padding: "14px 18px", borderRadius: 14, background: c.appliedSoft }}>
          <div style={{ fontFamily: sans, fontSize: 11, color: c.ink, lineHeight: 1.5, maxWidth: 340 }}>
            Nggak yakin mau isi apa? Jawab beberapa pertanyaan singkat, biar sistem yang menyarankan — hasilnya tetap bisa kamu ubah manual sesudahnya.
          </div>
          <button
            onClick={() => {
              setQuestionnaireSession((s) => s + 1);
              setShowQuestionnaire(true);
            }}
            style={{
              display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 16px", borderRadius: 999,
              border: "none", background: forumAccent, color: "#fff", fontFamily: sans, fontSize: 12, fontWeight: 700, cursor: "pointer", flexShrink: 0,
            }}
          >
            ✨ Cari tahu lewat kuesioner
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div style={{ padding: "20px 22px", borderRadius: 16, background: c.card, border: `1px solid ${c.line}` }}>
            <div style={{ fontFamily: sans, fontWeight: 700, fontSize: 12.5, color: c.ink, marginBottom: 12 }}>Ketertarikan</div>
            <TagInput
              ctx={ctx}
              fieldKey="interests"
              values={profileDraft.interests}
              onChange={(v) => setProfileDraft({ ...profileDraft, interests: v })}
              accent={c.aiTag}
              soft={c.aiTagSoft}
              placeholder="Ketik ketertarikanmu"
            />
          </div>

          <div style={{ padding: "20px 22px", borderRadius: 16, background: c.card, border: `1px solid ${c.line}` }}>
            <div style={{ fontFamily: sans, fontWeight: 700, fontSize: 12.5, color: c.ink, marginBottom: 12 }}>Skill</div>
            <TagInput
              ctx={ctx}
              fieldKey="skills"
              values={profileDraft.skills}
              onChange={(v) => setProfileDraft({ ...profileDraft, skills: v })}
              accent={c.supportAccent}
              soft={c.supportSoft}
              placeholder="Ketik skill-mu"
            />
          </div>
        </div>

        <div style={{ padding: "20px 22px", borderRadius: 16, background: c.card, border: `1px solid ${c.line}` }}>
          <div style={{ fontFamily: sans, fontWeight: 700, fontSize: 12.5, color: c.ink, marginBottom: 4 }}>Goal</div>
          <div style={{ fontFamily: sans, fontSize: 10.5, color: c.inkFaint, marginBottom: 10 }}>
            Selalu manual — tujuan atau target kamu sendiri, tidak ada saran otomatis untuk ini.
          </div>
          <textarea
            value={profileDraft.goal}
            onChange={(e) => setProfileDraft({ ...profileDraft, goal: e.target.value })}
            placeholder="cth. Lulus IB dengan skor 38+ dan diterima di jurusan yang aku mau"
            rows={2}
            style={{ ...inputStyle, borderRadius: 10, padding: "10px 12px", resize: "vertical" }}
          />
        </div>

        <div style={{ display: "flex", gap: 10, position: "sticky", bottom: 0, paddingTop: 4 }}>
          <button
            data-send="1"
            onClick={saveProfile}
            style={{ padding: "11px 24px", borderRadius: 999, border: "none", background: c.blue, color: "#fff", fontFamily: sans, fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}
          >
            Simpan
          </button>
          <button
            onClick={cancelEditingProfile}
            style={{ padding: "11px 24px", borderRadius: 999, border: `1px solid ${c.line}`, background: c.card, color: c.inkMuted, fontFamily: sans, fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}
          >
            Batal
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- profile section -------------------------------------------------
//
// Two modes share this section: viewing your own profile (with an Edit
// toggle) and viewing someone else's (always read-only — reached by
// clicking a username via AuthorTag/openProfile elsewhere in the app).
// Real name is the one field gated by an explicit visibility flag: it's
// rendered only when `showRealName` is true, and only ever here — never
// in any list, card, or post anywhere else in the app.
// ---- editor inline kecil (judul modul, balasan) ------------------------------------------------
// Module-scope + state teks di dalam komponen ini sendiri: mengetik tidak
// me-render ulang Homepage dan fokus input tidak hilang.
function InlineTextEditor({ ctx, initial, multiline, maxLength, saving, placeholder, onSave, onCancel }) {
  const { c, sans } = ctx;
  const [value, setValue] = useState(initial || "");
  const trimmed = value.trim();
  const unchanged = trimmed === String(initial || "").trim();
  const fieldStyle = {
    width: "100%", boxSizing: "border-box", padding: "8px 10px", borderRadius: 9, border: `1px solid ${c.line}`,
    background: c.fieldBg, fontFamily: sans, fontSize: 12.5, color: c.ink, outline: "none", resize: "vertical",
  };
  return (
    <div onClick={(e) => e.stopPropagation()} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {multiline ? (
        <textarea rows={3} autoFocus value={value} maxLength={maxLength} placeholder={placeholder} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !(e.nativeEvent && e.nativeEvent.isComposing)) { e.preventDefault(); if (trimmed && !unchanged && !saving) onSave(trimmed); } else if (e.key === "Escape") onCancel(); }} style={fieldStyle} />
      ) : (
        <input
          autoFocus
          value={value}
          maxLength={maxLength}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && trimmed && !unchanged && !saving) onSave(trimmed);
            if (e.key === "Escape") onCancel();
          }}
          style={fieldStyle}
        />
      )}
      <div style={{ display: "flex", gap: 6 }}>
        <button
          onClick={() => onSave(trimmed)}
          disabled={saving || !trimmed || unchanged}
          style={{ background: c.blue, color: "#FFFFFF", border: "none", borderRadius: 999, padding: "5px 14px", fontFamily: sans, fontSize: 11, fontWeight: 700, cursor: saving || !trimmed || unchanged ? "default" : "pointer", opacity: saving || !trimmed || unchanged ? 0.5 : 1 }}
        >
          {saving ? "Menyimpan..." : "Simpan"}
        </button>
        <button
          onClick={onCancel}
          disabled={saving}
          style={{ background: "none", color: c.inkMuted, border: `1px solid ${c.line}`, borderRadius: 999, padding: "5px 14px", fontFamily: sans, fontSize: 11, fontWeight: 700, cursor: "pointer" }}
        >
          Batal
        </button>
      </div>
    </div>
  );
}

// Editor post: isi + jenis post. Subject/topik post tidak diubah lewat edit.
function PostEditor({ ctx, post, saving, onSave, onCancel }) {
  const { c, sans } = ctx;
  const [body, setBody] = useState(post.body || "");
  const [postType, setPostType] = useState(post.postType);
  const [moduleId, setModuleId] = useState(post.moduleId || null);
  const trimmed = body.trim();
  const moduleChanged = moduleId !== (post.moduleId || null);
  const unchanged = trimmed === String(post.body || "").trim() && postType === post.postType && !moduleChanged;
  return (
    <div onClick={(e) => e.stopPropagation()} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {Object.entries(POST_TYPES).map(([key, meta]) => {
          const active = postType === key;
          return (
            <button
              key={key}
              onClick={() => setPostType(key)}
              style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 11px", borderRadius: 999, border: `1px solid ${active ? meta.color : c.line}`, background: active ? `${meta.color}14` : c.card, color: active ? meta.color : c.inkMuted, fontFamily: sans, fontSize: 11, fontWeight: 700, cursor: "pointer" }}
            >
              {meta.icon} {meta.label}
            </button>
          );
        })}
      </div>
      <ModuleMentionField ctx={ctx} moduleId={moduleId} onChange={setModuleId} fallback={post.module} />
      <textarea
        rows={5}
        autoFocus
        value={body}
        maxLength={5000}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !(e.nativeEvent && e.nativeEvent.isComposing)) { e.preventDefault(); if (!saving && trimmed && !unchanged) onSave({ body: trimmed, postType, moduleId: moduleChanged ? moduleId : undefined }); } else if (e.key === "Escape") onCancel(); }}
        style={{ width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 10, border: `1px solid ${c.line}`, background: c.fieldBg, fontFamily: sans, fontSize: 13.5, lineHeight: 1.55, color: c.ink, outline: "none", resize: "vertical" }}
      />
      <div style={{ display: "flex", gap: 6 }}>
        <button
          onClick={() => onSave({ body: trimmed, postType, moduleId: moduleChanged ? moduleId : undefined })}
          disabled={saving || !trimmed || unchanged}
          style={{ background: c.blue, color: "#FFFFFF", border: "none", borderRadius: 999, padding: "6px 16px", fontFamily: sans, fontSize: 11.5, fontWeight: 700, cursor: saving || !trimmed || unchanged ? "default" : "pointer", opacity: saving || !trimmed || unchanged ? 0.5 : 1 }}
        >
          {saving ? "Menyimpan..." : "Simpan perubahan"}
        </button>
        <button
          onClick={onCancel}
          disabled={saving}
          style={{ background: "none", color: c.inkMuted, border: `1px solid ${c.line}`, borderRadius: 999, padding: "6px 16px", fontFamily: sans, fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}
        >
          Batal
        </button>
      </div>
    </div>
  );
}

// ---- aktivitas pengguna (di halaman profil) -----------------------------------------------------
// Modul, post forum, dan balasan milik `username`. Di profil sendiri (editable)
// ada tombol edit/hapus; di profil pengguna lain hanya bisa dilihat dan dibuka.
// Data diambil dari state yang sudah dimuat di Homepage (modul & feed forum dari database).
function MyActivityPanel({ ctx, username, editable }) {
  const {
    c, sans, localModules, localPosts, localReplies,
    setActiveNav, setComposingPost, setOpenSubject, setOpenTopic, openThreadFromSearch,
    deleteModule, deletePost, deleteReply,
    editingModuleId, setEditingModuleId, editingPostId, setEditingPostId, editingReplyId, setEditingReplyId,
    savingEdit, saveModuleTitle, saveForumPostEdit, saveForumReplyEdit,
    moduleActionError, forumActionError, openModuleFromMention,
  } = ctx;
  const [tab, setTab] = useState("modul");

  const myModules = localModules.filter((m) => m.uploader === username);
  const myPosts = localPosts.filter((p) => p.author === username);
  const myReplies = [];
  for (const [postId, list] of Object.entries(localReplies)) {
    for (const r of list) if (r.author === username) myReplies.push({ ...r, postId });
  }
  const snippet = (t, n = 110) => {
    const x = String(t || "").replace(/\s+/g, " ").trim();
    return x.length > n ? `${x.slice(0, n - 1)}…` : x;
  };
  const goToModule = (m) => { setActiveNav("modules"); setOpenSubject(m.subject); setOpenTopic(m.topic); };
  const goToPost = (id) => { setActiveNav("forum"); setComposingPost(false); openThreadFromSearch(id); };
  const who = editable ? "Kamu" : username;

  const tabs = [
    { key: "modul", label: "Modul", count: myModules.length },
    { key: "post", label: "Post forum", count: myPosts.length },
    { key: "balasan", label: "Balasan", count: myReplies.length },
  ];
  const actionBtn = (color) => ({ background: "none", border: "none", cursor: "pointer", fontFamily: sans, fontSize: 11, fontWeight: 700, color: color || c.blue, padding: "2px 4px" });
  const rowStyle = { padding: "13px 15px", borderRadius: 12, background: c.card, border: `1px solid ${c.line}` };
  const emptyBox = (text) => (
    <div style={{ padding: "28px 20px", textAlign: "center", borderRadius: 14, border: `1px dashed ${c.line}`, background: c.card, fontFamily: sans, fontSize: 12.5, color: c.inkMuted }}>{text}</div>
  );

  return (
    <div style={{ marginTop: 24, padding: "20px 22px", borderRadius: 16, background: c.card, border: `1px solid ${c.line}` }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4 }}>
        <div style={{ fontFamily: sans, fontWeight: 700, fontSize: 14, color: c.ink }}>{editable ? "Aktivitas saya" : `Aktivitas ${username}`}</div>
        <div style={{ fontFamily: sans, fontSize: 11, color: c.inkFaint }}>
          {myModules.length} modul · {myPosts.length} post · {myReplies.length} balasan
        </div>
      </div>
      <div style={{ fontFamily: sans, fontSize: 11.5, color: c.inkMuted, marginBottom: 14 }}>
        {editable
          ? "Semua yang pernah kamu unggah atau tulis. Dari sini kamu bisa mengedit atau menghapusnya."
          : `Modul, post forum, dan balasan yang pernah dibagikan ${username}.`}
      </div>

      <div style={{ display: "flex", gap: 7, marginBottom: 14, flexWrap: "wrap" }}>
        {tabs.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 13px", borderRadius: 999, border: `1px solid ${active ? c.blue : c.line}`, background: active ? c.blueSoft : c.card, color: active ? c.blue : c.inkMuted, fontFamily: sans, fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}
            >
              {t.label} <span style={{ opacity: 0.7 }}>{t.count}</span>
            </button>
          );
        })}
      </div>

      {editable && (tab === "modul" ? moduleActionError : forumActionError) && (
        <div style={{ marginBottom: 12, padding: "9px 13px", borderRadius: 10, background: "#D9553A14", fontFamily: sans, fontSize: 11.5, color: "#D9553A" }}>
          {tab === "modul" ? moduleActionError : forumActionError}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {tab === "modul" && (myModules.length === 0
          ? emptyBox(`${who} belum mengunggah modul.`)
          : myModules.map((m) => (
              <div key={m.id} style={rowStyle}>
                {editable && editingModuleId === m.id ? (
                  <InlineTextEditor ctx={ctx} initial={m.title} maxLength={200} saving={savingEdit} placeholder="Judul modul" onSave={(t) => saveModuleTitle(m.id, t)} onCancel={() => setEditingModuleId(null)} />
                ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <div style={{ fontFamily: sans, fontWeight: 700, fontSize: 13, color: c.ink }}>{m.title}</div>
                    {m.isExercise && (
                      <span style={{ fontFamily: sans, fontSize: 9.5, fontWeight: 700, color: c.exerciseAccent, background: c.exerciseSoft, padding: "1.5px 7px", borderRadius: 999 }}>✎ Latihan soal</span>
                    )}
                  </div>
                )}
                {editable && m.originalTitle && m.originalTitle !== m.title && editingModuleId !== m.id && (
                  <div style={{ fontFamily: sans, fontSize: 10.5, color: c.blue, marginTop: 3 }}>✨ Judul disesuaikan AI · judul asli: "{m.originalTitle}"</div>
                )}
                <div style={{ fontFamily: sans, fontSize: 11, color: c.inkFaint, marginTop: 4 }}>
                  {m.subject} · {m.topic} · {m.type === "LINK" ? "Link" : m.type} · {m.date}
                </div>
                <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                  <button onClick={() => goToModule(m)} style={actionBtn()}>Lihat di folder</button>
                  {editable && (
                    <>
                      <button onClick={() => setEditingModuleId(editingModuleId === m.id ? null : m.id)} style={actionBtn()}>✏️ Edit judul</button>
                      {m.originalTitle && m.originalTitle !== m.title && (
                        <button onClick={() => saveModuleTitle(m.id, m.originalTitle)} disabled={savingEdit} style={actionBtn()}>Pakai judul asli</button>
                      )}
                      <button
                        onClick={() => { if (window.confirm("Hapus modul ini? Tindakan ini tidak bisa dibatalkan.")) deleteModule(m.id); }}
                        style={actionBtn("#D9553A")}
                      >
                        🗑️ Hapus
                      </button>
                    </>
                  )}
                </div>
              </div>
            )))}

        {tab === "post" && (myPosts.length === 0
          ? emptyBox(`${who} belum membuat post di forum.`)
          : myPosts.map((p) => (
              <div key={p.id} style={rowStyle}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 6, flexWrap: "wrap" }}>
                  <PostTypeBadge ctx={ctx} type={p.postType} />
                  {p.subject && <span style={{ fontFamily: sans, fontSize: 10.5, fontWeight: 700, color: c.blue }}>{p.subject}</span>}
                  <span style={{ fontFamily: sans, fontSize: 10.5, color: c.inkFaint }}>· {p.time}{p.edited ? " · diedit" : ""}</span>
                </div>
                {editable && editingPostId === p.id ? (
                  <PostEditor ctx={ctx} post={p} saving={savingEdit} onSave={(draft) => saveForumPostEdit(p.id, draft)} onCancel={() => setEditingPostId(null)} />
                ) : (
                  <div style={{ fontFamily: sans, fontSize: 12.5, color: c.ink, lineHeight: 1.5 }}>{snippet(p.body, 180)}</div>
                )}
                {p.module && !(editable && editingPostId === p.id) && (
                  <button
                    onClick={() => openModuleFromMention(p.module)}
                    style={{ marginTop: 6, background: "none", border: "none", cursor: "pointer", padding: 0, fontFamily: sans, fontSize: 11, fontWeight: 700, color: c.blue, textAlign: "left" }}
                  >
                    📘 Membahas modul: {p.module.title}
                  </button>
                )}
                <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                  <button onClick={() => goToPost(p.id)} style={actionBtn()}>Buka thread</button>
                  {editable && (
                    <>
                      <button onClick={() => setEditingPostId(editingPostId === p.id ? null : p.id)} style={actionBtn()}>✏️ Edit</button>
                      <button
                        onClick={() => { if (window.confirm("Hapus post ini? Semua balasannya juga akan terhapus.")) deletePost(p.id); }}
                        style={actionBtn("#D9553A")}
                      >
                        🗑️ Hapus
                      </button>
                    </>
                  )}
                </div>
              </div>
            )))}

        {tab === "balasan" && (myReplies.length === 0
          ? emptyBox(`${who} belum membalas diskusi apa pun.`)
          : myReplies.map((r) => {
              const parent = localPosts.find((p) => p.id === r.postId);
              return (
                <div key={r.id} style={rowStyle}>
                  {parent && (
                    <div style={{ fontFamily: sans, fontSize: 10.5, color: c.inkFaint, marginBottom: 5 }}>
                      Membalas {parent.author}: "{snippet(parent.body, 70)}"
                    </div>
                  )}
                  {editable && editingReplyId === r.id ? (
                    <InlineTextEditor ctx={ctx} initial={r.body} multiline maxLength={3000} saving={savingEdit} placeholder="Isi balasan" onSave={(t) => saveForumReplyEdit(r.id, t)} onCancel={() => setEditingReplyId(null)} />
                  ) : (
                    <div style={{ fontFamily: sans, fontSize: 12.5, color: c.ink, lineHeight: 1.5 }}>
                      {snippet(r.body, 180)}
                      <span style={{ fontSize: 10.5, color: c.inkFaint }}> · {r.time}{r.edited ? " · diedit" : ""}</span>
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                    <button onClick={() => goToPost(r.postId)} style={actionBtn()}>Buka thread</button>
                    {editable && (
                      <>
                        <button onClick={() => setEditingReplyId(editingReplyId === r.id ? null : r.id)} style={actionBtn()}>✏️ Edit</button>
                        <button
                          onClick={() => { if (window.confirm("Hapus balasan ini? Balasan di bawahnya (jika ada) juga akan terhapus.")) deleteReply(r.postId, r.id); }}
                          style={actionBtn("#D9553A")}
                        >
                          🗑️ Hapus
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            }))}
      </div>
    </div>
  );
}

function ProfileSection({ ctx }) {
  const { viewedProfile, myProfile, editingProfile, profileDraft, profileFor, profileSaveError, CURRENT_USER } = ctx;
  const isOwnProfile = viewedProfile === null;
  const profile = isOwnProfile ? myProfile : profileFor(viewedProfile);

  // Lightbox state: holds { username, photoUrl } for whoever's avatar is
  // being viewed full-size, or null when closed. Shared across both the
  // own-profile identity card and any other-user profile view, so there's
  // one lightbox instance per ProfileSection rather than one per card.
  const [lightboxAvatar, setLightboxAvatar] = useState(null);

  // ---- RIASEC bio questionnaire modal state -------------------------------------------------
  const [showQuestionnaire, setShowQuestionnaire] = useState(false);
  // Bumped every time the questionnaire opens; used as RiasecQuestionnaire's
  // key so React remounts it fresh (clearing all ratings) instead of
  // resuming a previous, possibly-already-applied session.
  const [questionnaireSession, setQuestionnaireSession] = useState(0);

  return (
    <div style={{ padding: "0 32px 32px", maxWidth: 980 }}>
      {profileSaveError && (
        <div style={{ marginBottom: 12, padding: "9px 13px", borderRadius: 10, background: "#D9553A14", fontFamily: "inherit", fontSize: 11.5, color: "#D9553A" }}>{profileSaveError}</div>
      )}
      {isOwnProfile && editingProfile ? (
        <ProfileEdit
          ctx={ctx}
          profileDraft={profileDraft}
          setLightboxAvatar={setLightboxAvatar}
          setShowQuestionnaire={setShowQuestionnaire}
          setQuestionnaireSession={setQuestionnaireSession}
        />
      ) : (
        <ProfileView ctx={ctx} profile={profile} isOwnProfile={isOwnProfile} editingProfile={editingProfile} setLightboxAvatar={setLightboxAvatar} />
      )}
      {!editingProfile && <MyActivityPanel ctx={ctx} username={isOwnProfile ? CURRENT_USER : viewedProfile} editable={isOwnProfile} />}
      <PhotoLightbox lightboxAvatar={lightboxAvatar} setLightboxAvatar={setLightboxAvatar} />
      <RiasecQuestionnaire key={questionnaireSession} ctx={ctx} showQuestionnaire={showQuestionnaire} setShowQuestionnaire={setShowQuestionnaire} />
    </div>
  );
}

function ComingSoon({ ctx }) {
  const { c, sans } = ctx;
  return (
    <div style={{ padding: "40px 32px" }}>
      <div style={{ padding: "32px 28px", borderRadius: 16, background: c.card, border: `1px dashed ${c.line}`, textAlign: "center" }}>
        <div style={{ fontSize: 26, marginBottom: 8 }}>🚧</div>
        <div style={{ fontFamily: sans, fontWeight: 700, fontSize: 14, color: c.ink, marginBottom: 4 }}>Bagian ini belum dibangun</div>
        <div style={{ fontFamily: sans, fontSize: 12, color: c.inkMuted }}>Fiturnya akan dibahas dan dibangun di tahap berikutnya.</div>
      </div>
    </div>
  );
}
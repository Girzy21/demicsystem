// lib/searchFuzzy.js
//
// Toleransi salah ketik untuk pencarian ("oscilation" -> "oscillation").
// Logika murni (tanpa database/jaringan) supaya mudah dites.
//
// Cara kerja:
//   1. Kosakata dibangun dari teks modul yang ada (judul, subject, topik, tag,
//      kata kunci, topik yang didukung). Kata yang diketik pengguna dicek ke
//      kosakata ini.
//   2. Kata yang TIDAK ada di kosakata tetapi sangat mirip dengan satu kata
//      yang ada (jarak edit kecil, huruf pertama sama) diperbaiki otomatis.
//      Query yang sudah diperbaiki dipakai untuk embedding DAN kecocokan kata.
//   3. Sebagai lapisan kedua, kecocokan kata juga toleran salah ketik
//      (fuzzyTokenHit) walau tidak ada koreksi.

export function stripDiacritics(s) {
  return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// Memecah teks menjadi token huruf/angka huruf kecil.
export function tokenize(text) {
  return stripDiacritics(text)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2);
}

// Jumlah salah ketik yang ditoleransi menurut panjang kata.
export function maxEdits(len) {
  if (len <= 3) return 0;
  if (len <= 7) return 1;
  return 2;
}

// Jarak edit (Damerau-Levenshtein versi "optimal string alignment": sisip,
// hapus, ganti, dan tukar dua huruf bersebelahan masing-masing bernilai 1).
// Mengembalikan max+1 kalau jaraknya sudah pasti lebih dari `max`.
export function editDistance(a, b, max = 2) {
  if (a === b) return 0;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  if (la === 0) return lb <= max ? lb : max + 1;
  if (lb === 0) return la <= max ? la : max + 1;

  let prev2 = null;
  let prev = Array.from({ length: lb + 1 }, (_, j) => j);
  for (let i = 1; i <= la; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, prev2[j - 2] + 1);
      }
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[lb] <= max ? prev[lb] : max + 1;
}

// texts: daftar string -> Map(token -> jumlah kemunculan). Token < 4 huruf
// diabaikan (terlalu pendek untuk dikoreksi dengan aman).
export function buildVocabulary(texts) {
  const vocab = new Map();
  for (const t of texts || []) {
    if (typeof t !== "string" || !t) continue;
    for (const tok of tokenize(t)) {
      if (tok.length < 4) continue;
      vocab.set(tok, (vocab.get(tok) || 0) + 1);
    }
  }
  return vocab;
}

// Mencari kata kosakata terdekat untuk satu token. Syarat: jarak <= maxEdits,
// huruf pertama sama (salah ketik jarang mengubah huruf pertama).
export function nearestVocabWord(token, vocab) {
  const limit = maxEdits(token.length);
  if (limit === 0) return null;
  let best = null;
  for (const [word, count] of vocab) {
    if (word[0] !== token[0]) continue;
    if (Math.abs(word.length - token.length) > limit) continue;
    const d = editDistance(token, word, limit);
    if (d > limit) continue;
    if (!best || d < best.d || (d === best.d && count > best.count)) best = { word, d, count };
  }
  return best ? best.word : null;
}

// Memperbaiki salah ketik pada query memakai kosakata.
// Mengembalikan { corrected, changed, corrections: [{ from, to }] }.
export function correctQuery(query, vocab) {
  const original = String(query || "").trim();
  const tokens = stripDiacritics(original).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (!vocab || vocab.size === 0 || tokens.length === 0) {
    return { corrected: original, changed: false, corrections: [] };
  }
  const corrections = [];
  const out = tokens.map((tok) => {
    if (tok.length < 4 || vocab.has(tok)) return tok;
    const fix = nearestVocabWord(tok, vocab);
    if (fix && fix !== tok) {
      corrections.push({ from: tok, to: fix });
      return fix;
    }
    return tok;
  });
  if (corrections.length === 0) return { corrected: original, changed: false, corrections: [] };
  return { corrected: out.join(" "), changed: true, corrections };
}

// Apakah salah satu token query (>= 5 huruf) mirip dengan salah satu token teks?
// hayTokens: Set/array token dari teks yang dicari.
export function fuzzyTokenHit(queryTokens, hayTokens) {
  const hay = Array.isArray(hayTokens) ? hayTokens : Array.from(hayTokens);
  for (const q of queryTokens) {
    if (q.length < 5) continue;
    const limit = maxEdits(q.length);
    for (const h of hay) {
      if (h[0] !== q[0] || Math.abs(h.length - q.length) > limit) continue;
      if (editDistance(q, h, limit) <= limit) return true;
    }
  }
  return false;
}

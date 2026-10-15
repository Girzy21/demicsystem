"use client";

// src/app/lupa-password/page.jsx — halaman publik "Lupa password" (/lupa-password)
// Mengirim permintaan ke admin lewat POST /api/password-reset. Admin memverifikasi
// identitasmu lalu memberikan password baru secara langsung.

import React, { useState } from "react";

const CSS = `
.lp{--bg:#eef2f7;--card:#fff;--ink:#132038;--mute:#5b6b84;--line:rgba(19,32,56,.14);--blue:#2c7be5;--err:#d6336c;--ok:#2e9e6b;min-height:100vh;background:var(--bg);display:flex;align-items:center;justify-content:center;padding:20px;color:var(--ink);font:14px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
@media (prefers-color-scheme:dark){.lp{--bg:#101722;--card:#1a2332;--ink:#e8edf5;--mute:#9aa8bd;--line:rgba(255,255,255,.14);--blue:#6fa8f5;--err:#ff6b9a;--ok:#51cf66}}
.lp *{box-sizing:border-box}
.lp-card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:24px;width:100%;max-width:420px}
.lp h1{font-size:20px;margin:0 0 6px}
.lp p{color:var(--mute);margin:0 0 14px}
.lp label{display:block;font-size:12px;color:var(--mute);margin:12px 0 4px}
.lp input,.lp textarea{width:100%;border:1px solid var(--line);background:transparent;color:var(--ink);border-radius:10px;padding:10px 12px;font:inherit}
.lp textarea{min-height:76px;resize:vertical}
.lp button{width:100%;margin-top:16px;border:0;border-radius:10px;background:var(--blue);color:#fff;padding:11px;font:inherit;font-weight:600;cursor:pointer}
.lp button:disabled{opacity:.55;cursor:default}
.lp .msg{margin-top:12px;font-size:13px}
.lp .err{color:var(--err)}
.lp .ok{color:var(--ok)}
.lp a{color:var(--blue);text-decoration:none}
.lp .hp{position:absolute;left:-9999px;opacity:0;height:0;width:0}
`;

export default function LupaPasswordPage() {
  const [username, setUsername] = useState("");
  const [note, setNote] = useState("");
  const [website, setWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  async function submit() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/password-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, note, website }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) setResult({ kind: "err", text: json.error || "Gagal mengirim permintaan." });
      else setResult({ kind: "ok", text: json.message || "Permintaan terkirim." });
    } catch {
      setResult({ kind: "err", text: "Tidak bisa menghubungi server. Periksa koneksimu." });
    } finally {
      setBusy(false);
    }
  }

  const sent = result && result.kind === "ok";
  return (
    <div className="lp">
      <style>{CSS}</style>
      <div className="lp-card">
        <h1>Lupa password</h1>
        <p>Kirim permintaan ke admin. Admin akan memverifikasi identitasmu lalu memberikan password baru secara langsung.</p>
        {!sent && (
          <>
            <label htmlFor="lp-user">Username</label>
            <input id="lp-user" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
            <label htmlFor="lp-note">Nama lengkap dan kelas (untuk verifikasi)</label>
            <textarea id="lp-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Contoh: Budi Santoso, 11 IB-A" maxLength={300} />
            <input className="hp" tabIndex={-1} autoComplete="off" aria-hidden="true" value={website} onChange={(e) => setWebsite(e.target.value)} />
            <button onClick={submit} disabled={busy || username.trim().length < 3 || note.trim().length < 5}>
              {busy ? "Mengirim…" : "Kirim permintaan"}
            </button>
          </>
        )}
        {result && <div className={`msg ${result.kind}`}>{result.text}</div>}
        <p style={{ marginTop: 16, marginBottom: 0 }}>
          <a href="/">← Kembali ke halaman login</a>
        </p>
      </div>
    </div>
  );
}

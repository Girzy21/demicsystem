"use client";

// src/app/ganti-password/page.jsx — ganti password sendiri (/ganti-password).
// Dipakai setelah admin memberi password sementara: login, lalu buka halaman ini
// supaya hanya kamu yang tahu password-nya. Wajib sudah login.

import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabaseClient";

const CSS = `
.gp{--bg:#eef2f7;--card:#fff;--ink:#132038;--mute:#5b6b84;--line:rgba(19,32,56,.14);--blue:#2c7be5;--err:#d6336c;--ok:#2e9e6b;min-height:100vh;background:var(--bg);display:flex;align-items:center;justify-content:center;padding:20px;color:var(--ink);font:14px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
@media (prefers-color-scheme:dark){.gp{--bg:#101722;--card:#1a2332;--ink:#e8edf5;--mute:#9aa8bd;--line:rgba(255,255,255,.14);--blue:#6fa8f5;--err:#ff6b9a;--ok:#51cf66}}
.gp *{box-sizing:border-box}
.gp-card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:24px;width:100%;max-width:420px}
.gp h1{font-size:20px;margin:0 0 6px}
.gp p{color:var(--mute);margin:0 0 14px}
.gp label{display:block;font-size:12px;color:var(--mute);margin:12px 0 4px}
.gp input{width:100%;border:1px solid var(--line);background:transparent;color:var(--ink);border-radius:10px;padding:10px 12px;font:inherit}
.gp button{width:100%;margin-top:16px;border:0;border-radius:10px;background:var(--blue);color:#fff;padding:11px;font:inherit;font-weight:600;cursor:pointer}
.gp button:disabled{opacity:.55;cursor:default}
.gp .msg{margin-top:12px;font-size:13px}
.gp .err{color:var(--err)}
.gp .ok{color:var(--ok)}
.gp a{color:var(--blue);text-decoration:none}
`;

export default function GantiPasswordPage() {
  const [ready, setReady] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setLoggedIn(!!data.session);
      setReady(true);
    });
  }, []);

  async function submit() {
    if (pw.length < 8) return setResult({ kind: "err", text: "Password minimal 8 karakter." });
    if (pw !== pw2) return setResult({ kind: "err", text: "Konfirmasi password tidak sama." });
    setBusy(true);
    setResult(null);
    const { error } = await supabase.auth.updateUser({ password: pw });
    if (error) setResult({ kind: "err", text: error.message || "Gagal mengganti password." });
    else {
      setResult({ kind: "ok", text: "Password berhasil diganti. Gunakan password baru saat login berikutnya." });
      setPw("");
      setPw2("");
    }
    setBusy(false);
  }

  return (
    <div className="gp">
      <style>{CSS}</style>
      <div className="gp-card">
        <h1>Ganti password</h1>
        {!ready && <p>Memuat…</p>}
        {ready && !loggedIn && (
          <p>
            Kamu harus login dulu. <a href="/">Ke halaman login</a>
          </p>
        )}
        {ready && loggedIn && (
          <>
            <p>Buat password baru yang hanya kamu yang tahu, terutama kalau sebelumnya memakai password sementara dari admin.</p>
            <label htmlFor="gp-pw">Password baru (minimal 8 karakter)</label>
            <input id="gp-pw" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
            <label htmlFor="gp-pw2">Ulangi password baru</label>
            <input id="gp-pw2" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
            <button onClick={submit} disabled={busy || pw.length < 8}>
              {busy ? "Menyimpan…" : "Simpan password baru"}
            </button>
          </>
        )}
        {result && <div className={`msg ${result.kind}`}>{result.text}</div>}
        {ready && loggedIn && (
          <p style={{ marginTop: 16, marginBottom: 0 }}>
            <a href="/">← Kembali ke situs</a>
          </p>
        )}
      </div>
    </div>
  );
}

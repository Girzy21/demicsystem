"use client";

// src/app/admin/page.jsx — Panel Admin (/admin)
//
// Keamanan ada di server (requireAdmin di setiap /api/admin/*). Halaman ini
// hanya antarmuka: kalau pemanggil bukan admin, yang tampil adalah 404 biasa.
// Semua komponen didefinisikan di module scope (bukan di dalam komponen lain)
// supaya input tidak kehilangan fokus saat render ulang.

import React, { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/lib/supabaseClient";

const TABS = [
  ["overview", "Ringkasan"],
  ["content", "Konten"],
  ["review", "Review"],
  ["topics", "Topik"],
  ["users", "Pengguna"],
  ["resets", "Reset password"],
  ["maintenance", "Maintenance"],
  ["audit", "Audit log"],
];

const CSS = `
.adm{--bg:#f5f6f8;--card:#fff;--text:#1b1f27;--mute:#667085;--line:#e2e5ea;--brand:#3b5bdb;--danger:#d6336c;--ok:#2b8a3e;--warn:#e67700;min-height:100vh;background:var(--bg);color:var(--text);font:14px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
@media (prefers-color-scheme:dark){.adm{--bg:#14161a;--card:#1d2026;--text:#e8eaee;--mute:#9aa3b0;--line:#2c313a;--brand:#7c93ff;--danger:#ff6b9a;--ok:#51cf66;--warn:#ffa94d}}
.adm *{box-sizing:border-box}
.adm-top{position:sticky;top:0;z-index:20;background:var(--card);border-bottom:1px solid var(--line);padding:10px 14px;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.adm-top h1{font-size:16px;margin:0;flex:1}
.adm-tabs{display:flex;gap:4px;overflow-x:auto;padding:8px 14px 0;background:var(--card);border-bottom:1px solid var(--line)}
.adm-tab{border:0;background:none;color:var(--mute);padding:8px 12px;cursor:pointer;font:inherit;border-bottom:2px solid transparent;white-space:nowrap}
.adm-tab.on{color:var(--brand);border-bottom-color:var(--brand);font-weight:600}
.adm-main{max-width:1100px;margin:0 auto;padding:14px}
.adm-card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px;margin-bottom:10px}
.adm-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.adm-stat b{display:block;font-size:22px}
.adm-stat span{color:var(--mute);font-size:12px}
.adm-btn{border:1px solid var(--line);background:var(--card);color:var(--text);border-radius:8px;padding:6px 12px;cursor:pointer;font:inherit}
.adm-btn:hover{border-color:var(--brand)}
.adm-btn.pri{background:var(--brand);border-color:var(--brand);color:#fff}
.adm-btn.dng{color:var(--danger);border-color:var(--danger)}
.adm-btn:disabled{opacity:.5;cursor:default}
.adm-in,.adm-sel,.adm-ta{width:100%;border:1px solid var(--line);background:var(--bg);color:var(--text);border-radius:8px;padding:7px 10px;font:inherit}
.adm-ta{min-height:70px;resize:vertical}
.adm-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px}
.adm-bar .adm-in{flex:1;min-width:130px;width:auto}
.adm-row{display:flex;gap:10px;align-items:flex-start;padding:10px 0;border-top:1px solid var(--line)}
.adm-row:first-child{border-top:0}
.adm-row .main{flex:1;min-width:0}
.adm-row .meta{color:var(--mute);font-size:12px;margin-top:2px}
.adm-row .acts{display:flex;gap:6px;flex-wrap:wrap}
.adm-badge{display:inline-block;font-size:11px;padding:1px 7px;border-radius:99px;border:1px solid var(--line);color:var(--mute);margin-right:4px}
.adm-badge.ok{color:var(--ok);border-color:var(--ok)}
.adm-badge.warn{color:var(--warn);border-color:var(--warn)}
.adm-badge.dng{color:var(--danger);border-color:var(--danger)}
.adm-overlay{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:50;display:flex;align-items:flex-start;justify-content:center;padding:20px 12px;overflow-y:auto}
.adm-modal{background:var(--card);color:var(--text);border-radius:12px;width:100%;max-width:520px;padding:16px}
.adm-modal.wide{max-width:760px}
.adm-mhead{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}
.adm-x{border:0;background:none;color:var(--mute);cursor:pointer;font-size:16px}
.adm-lab{display:block;font-size:12px;color:var(--mute);margin:10px 0 4px}
.adm-sec{border-top:1px solid var(--line);margin-top:12px;padding-top:10px}
.adm-err{color:var(--danger);font-size:13px;margin-top:8px}
.adm-mute{color:var(--mute)}
.adm-toast{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:60;background:var(--text);color:var(--bg);padding:9px 16px;border-radius:10px;max-width:92vw}
.adm-toast.err{background:var(--danger);color:#fff}
.adm-pre{background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:8px;overflow:auto;max-height:260px;font:12px/1.4 ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap;word-break:break-word}
.adm-chip{display:inline-flex;gap:4px;align-items:center;border:1px solid var(--line);border-radius:99px;padding:1px 8px;margin:0 4px 4px 0;font-size:12px}
.adm-chip button{border:0;background:none;color:var(--mute);cursor:pointer;padding:0}
.adm-center{max-width:420px;margin:12vh auto;padding:0 16px;text-align:center}
`;

// ---------------------------------------------------------------- helpers
async function api(path, { method = "GET", body } = {}) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw Object.assign(new Error("Sesi berakhir — login ulang di halaman utama."), { status: 401 });
  const res = await fetch(`/api/admin/${path}`, {
    method,
    headers: { Authorization: `Bearer ${session.access_token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json.error || `Error ${res.status}`), { status: res.status, code: json.code });
  return json;
}

// Mengulang satu langkah maintenance (satu batch per panggilan) sampai selesai.
async function runLoop(step, onProgress, extra = {}) {
  let last = null;
  let stalls = 0;
  for (let round = 0; round < 200; round++) {
    const r = await api("maintenance", { method: "POST", body: { step, ...extra } });
    if (onProgress) onProgress(r);
    if (r.done) return r;
    if (last !== null && r.remaining >= last) {
      stalls += 1;
      if (stalls >= 2) return { ...r, stalled: true };
    } else stalls = 0;
    last = r.remaining;
  }
  return { done: false, stalled: true };
}

const fmt = (d) => (d ? new Date(d).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" }) : "-");
const snip = (s, n = 140) => {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
function fmtBytes(n) {
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < 3) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(i ? 1 : 0)} ${units[i]}`;
}
function randomPassword() {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const arr = new Uint32Array(12);
  crypto.getRandomValues(arr);
  return Array.from(arr, (n) => chars[n % chars.length]).join("");
}

function useLoad(path) {
  const [state, setState] = useState({ data: null, loading: true, error: "" });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: "" }));
    api(path)
      .then((data) => alive && setState({ data, loading: false, error: "" }))
      .catch((e) => alive && setState({ data: null, loading: false, error: e.message }));
    return () => {
      alive = false;
    };
  }, [path, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}

// ------------------------------------------------------- small components
function Badge({ tone = "", children }) {
  return <span className={`adm-badge ${tone}`}>{children}</span>;
}

function Pager({ page, total, size, onPage }) {
  const pages = Math.max(1, Math.ceil(total / size));
  return (
    <div className="adm-bar" style={{ justifyContent: "space-between", marginTop: 10 }}>
      <span className="adm-mute">{total} item</span>
      <span>
        <button className="adm-btn" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          ←
        </button>
        <span style={{ margin: "0 10px" }}>
          {page} / {pages}
        </span>
        <button className="adm-btn" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          →
        </button>
      </span>
    </div>
  );
}

function Modal({ title, onClose, wide, children }) {
  return (
    <div className="adm-overlay" onClick={onClose}>
      <div className={`adm-modal${wide ? " wide" : ""}`} onClick={(e) => e.stopPropagation()}>
        <div className="adm-mhead">
          <b>{title}</b>
          <button className="adm-x" onClick={onClose} aria-label="Tutup">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ReasonModal({ title, text, confirmText = "Hapus", danger = true, onConfirm, onClose }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function go() {
    if (reason.trim().length < 3) {
      setErr("Alasan wajib diisi (minimal 3 karakter).");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      await onConfirm(reason.trim());
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  }
  return (
    <Modal title={title} onClose={onClose}>
      <p>{text}</p>
      <label className="adm-lab">Alasan (tercatat di audit log)</label>
      <textarea className="adm-ta" value={reason} onChange={(e) => setReason(e.target.value)} />
      {err && <div className="adm-err">{err}</div>}
      <div className="adm-bar" style={{ marginTop: 12, justifyContent: "flex-end" }}>
        <button className="adm-btn" onClick={onClose} disabled={busy}>
          Batal
        </button>
        <button className={`adm-btn ${danger ? "dng" : "pri"}`} onClick={go} disabled={busy}>
          {busy ? "Memproses…" : confirmText}
        </button>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------- MFA
function MfaGate({ onDone }) {
  const [step, setStep] = useState("init");
  const [factorId, setFactorId] = useState(null);
  const [qr, setQr] = useState("");
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      try {
        const { data, error } = await supabase.auth.mfa.listFactors();
        if (error) throw error;
        for (const f of data.all || []) {
          if (f.factor_type === "totp" && f.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: f.id });
        }
        const verified = (data.totp || [])[0];
        if (verified) {
          setFactorId(verified.id);
          setStep("verify");
          return;
        }
        const { data: en, error: enErr } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `admin-${Date.now()}` });
        if (enErr) throw enErr;
        setFactorId(en.id);
        setQr(en.totp.qr_code);
        setSecret(en.totp.secret);
        setStep("enroll");
      } catch (e) {
        setErr(e.message || "Gagal menyiapkan MFA.");
        setStep("error");
      }
    })();
  }, []);

  async function submit() {
    setBusy(true);
    setErr("");
    try {
      const { data: ch, error: chErr } = await supabase.auth.mfa.challenge({ factorId });
      if (chErr) throw chErr;
      const { error } = await supabase.auth.mfa.verify({ factorId, challengeId: ch.id, code: code.trim() });
      if (error) throw error;
      onDone();
    } catch (e) {
      setErr(e.message || "Kode salah.");
      setBusy(false);
    }
  }

  return (
    <div className="adm-center">
      <h2>Verifikasi dua langkah</h2>
      {step === "init" && <p className="adm-mute">Menyiapkan…</p>}
      {step === "error" && (
        <>
          <p className="adm-err">{err}</p>
          <p className="adm-mute">Pastikan MFA TOTP aktif di pengaturan Authentication Supabase.</p>
        </>
      )}
      {step === "enroll" && (
        <>
          <p>Pindai kode QR dengan aplikasi autentikator (Google Authenticator, Authy, dll.), lalu masukkan kode 6 digit.</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt="QR MFA" width={180} height={180} style={{ background: "#fff", padding: 6, borderRadius: 8 }} />
          <p className="adm-mute" style={{ wordBreak: "break-all" }}>
            Atau ketik manual: {secret}
          </p>
        </>
      )}
      {step === "verify" && <p>Masukkan kode 6 digit dari aplikasi autentikatormu.</p>}
      {(step === "enroll" || step === "verify") && (
        <>
          <input
            className="adm-in"
            inputMode="numeric"
            maxLength={6}
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            onKeyDown={(e) => e.key === "Enter" && code.length === 6 && submit()}
            style={{ textAlign: "center", fontSize: 20, letterSpacing: 4 }}
          />
          {err && <div className="adm-err">{err}</div>}
          <button className="adm-btn pri" style={{ marginTop: 12 }} disabled={busy || code.length !== 6} onClick={submit}>
            {busy ? "Memeriksa…" : "Verifikasi"}
          </button>
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------- Ringkasan
function OverviewTab({ setTab }) {
  const { data, loading, error } = useLoad("stats");
  if (loading) return <p className="adm-mute">Memuat…</p>;
  if (error) return <p className="adm-err">{error}</p>;
  const cards = [
    ["Pengguna", data.users],
    ["Modul", data.modules],
    ["Post forum", data.posts],
    ["Balasan", data.replies],
    ["Admin", data.admins],
    ["Ditangguhkan", data.suspended],
    ["Storage modul", fmtBytes(data.storageBytes)],
    ["Aksi admin 24 jam", data.actionsLast24h],
  ];
  return (
    <>
      <div className="adm-grid">
        {cards.map(([label, value]) => (
          <div key={label} className="adm-card adm-stat">
            <b>{value}</b>
            <span>{label}</span>
          </div>
        ))}
      </div>
      <div className="adm-grid">
        <div className="adm-card adm-stat" onClick={() => setTab("resets")} style={{ cursor: "pointer" }}>
          <b>{data.resetPending ?? 0}</b>
          <span>Permintaan reset password →</span>
        </div>
        <div className="adm-card adm-stat" onClick={() => setTab("review")} style={{ cursor: "pointer" }}>
          <b>{data.reviewPending ?? "?"}</b>
          <span>Modul menunggu review →</span>
        </div>
        <div className="adm-card adm-stat" onClick={() => setTab("maintenance")} style={{ cursor: "pointer" }}>
          <b>{data.modulesWithoutEmbedding + data.postsWithoutEmbedding}</b>
          <span>Belum punya embedding →</span>
        </div>
        <div className="adm-card adm-stat" onClick={() => setTab("maintenance")} style={{ cursor: "pointer" }}>
          <b>{data.retagPending}</b>
          <span>Perlu analisis ulang AI →</span>
        </div>
      </div>
    </>
  );
}

// -------------------------------------------------------- Editor modul
function ModuleEditor({ item, onClose, onSaved, notify }) {
  const { data: topicData } = useLoad("topics");
  const [title, setTitle] = useState(item.title || "");
  const [description, setDescription] = useState(item.description || "");
  const [subject, setSubject] = useState(item.subject || "");
  const [topic, setTopic] = useState(item.topic || "");
  const [topicIsCustom, setTopicIsCustom] = useState(!!item.topic_is_custom);
  const [isExercise, setIsExercise] = useState(!!item.is_exercise);
  const [tags, setTags] = useState(Array.isArray(item.tags) ? item.tags : []);
  const [tagInput, setTagInput] = useState("");
  const [markReviewed, setMarkReviewed] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const all = (topicData && topicData.topics) || [];
  const subjects = Array.from(new Set(all.map((t) => t.subject)));
  const topicsOfSubject = all.filter((t) => t.subject === subject).map((t) => t.topic);

  function addTag() {
    const label = tagInput.trim();
    if (!label) return;
    if (!tags.some((t) => t.label.toLowerCase() === label.toLowerCase())) setTags([...tags, { label, source: "manual" }]);
    setTagInput("");
  }

  async function save() {
    const body = {};
    if (title !== (item.title || "")) body.title = title;
    if (description !== (item.description || "")) body.description = description;
    if (subject !== (item.subject || "")) body.subject = subject;
    if (topic !== (item.topic || "")) body.topic = topic;
    if (topicIsCustom !== !!item.topic_is_custom) body.topicIsCustom = topicIsCustom;
    if (isExercise !== !!item.is_exercise) body.isExercise = isExercise;
    if (JSON.stringify(tags) !== JSON.stringify(item.tags || [])) body.tags = tags;
    if (markReviewed) body.markReviewed = true;
    if (Object.keys(body).length === 0) {
      setErr("Tidak ada perubahan.");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      await api(`modules/${item.id}`, { method: "PATCH", body });
      notify("Modul disimpan.");
      onSaved();
      onClose();
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  }

  async function quick(action, okMsg) {
    setBusy(true);
    setErr("");
    try {
      await api(`modules/${item.id}`, { method: "POST", body: { action } });
      notify(okMsg);
      onSaved();
      onClose();
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  }

  return (
    <Modal title="Edit modul" onClose={onClose} wide>
      <label className="adm-lab">Judul {item.original_title && <span>(judul asli: {item.original_title})</span>}</label>
      <input className="adm-in" value={title} onChange={(e) => setTitle(e.target.value)} />
      <label className="adm-lab">Deskripsi</label>
      <textarea className="adm-ta" value={description} onChange={(e) => setDescription(e.target.value)} />
      <div className="adm-grid" style={{ marginTop: 4 }}>
        <div>
          <label className="adm-lab">Subject</label>
          <input className="adm-in" list="adm-subjects" value={subject} onChange={(e) => setSubject(e.target.value)} />
          <datalist id="adm-subjects">
            {subjects.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </div>
        <div>
          <label className="adm-lab">Topik</label>
          <input className="adm-in" list="adm-topics" value={topic} onChange={(e) => setTopic(e.target.value)} />
          <datalist id="adm-topics">
            {topicsOfSubject.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </div>
      </div>
      <label className="adm-lab">
        <input type="checkbox" checked={topicIsCustom} onChange={(e) => setTopicIsCustom(e.target.checked)} /> Topik ini buatan pengguna (belum resmi)
      </label>
      <label className="adm-lab">
        <input type="checkbox" checked={isExercise} onChange={(e) => setIsExercise(e.target.checked)} /> Latihan soal (bukan materi)
      </label>
      <label className="adm-lab">Tag</label>
      <div>
        {tags.map((t) => (
          <span key={t.label} className="adm-chip">
            {t.label}
            {t.source === "ai" && <small className="adm-mute">AI{typeof t.confidence === "number" ? ` ${Math.round(t.confidence * 100)}%` : ""}</small>}
            <button onClick={() => setTags(tags.filter((x) => x.label !== t.label))} aria-label={`Hapus tag ${t.label}`}>
              ✕
            </button>
          </span>
        ))}
      </div>
      <div className="adm-bar">
        <input className="adm-in" placeholder="Tambah tag" value={tagInput} onChange={(e) => setTagInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addTag()} />
        <button className="adm-btn" onClick={addTag}>
          Tambah
        </button>
      </div>
      <label className="adm-lab">
        <input type="checkbox" checked={markReviewed} onChange={(e) => setMarkReviewed(e.target.checked)} /> Tandai sudah ditinjau
      </label>
      {err && <div className="adm-err">{err}</div>}
      <div className="adm-sec adm-bar">
        {item.original_title && (
          <button className="adm-btn" disabled={busy} onClick={() => quick("revertTitle", "Judul dikembalikan.")}>
            Kembalikan judul asli
          </button>
        )}
        <button className="adm-btn" disabled={busy} onClick={() => quick("retag", "Analisis AI selesai.")}>
          Analisis ulang AI
        </button>
        <span style={{ flex: 1 }} />
        <button className="adm-btn" disabled={busy} onClick={onClose}>
          Batal
        </button>
        <button className="adm-btn pri" disabled={busy} onClick={save}>
          {busy ? "Memproses…" : "Simpan"}
        </button>
      </div>
    </Modal>
  );
}

// --------------------------------------------------------- Thread forum
function ThreadModal({ postId, onClose, onChanged, notify }) {
  const { data, loading, error, reload } = useLoad(`content?type=thread&id=${encodeURIComponent(postId)}`);
  const [confirm, setConfirm] = useState(null);

  async function doDelete(reason) {
    const r = await api("content", { method: "POST", body: { action: "delete", items: [{ type: confirm.type, id: confirm.id }], reason } });
    const res = r.results[0];
    if (!res.ok) throw new Error(res.error || "Gagal menghapus.");
    notify("Terhapus.");
    setConfirm(null);
    onChanged();
    if (confirm.type === "post") onClose();
    else reload();
  }

  const depth = {};
  const replies = (data && data.replies) || [];
  for (const r of replies) depth[r.id] = r.parent_id && depth[r.parent_id] !== undefined ? Math.min(depth[r.parent_id] + 1, 4) : 0;

  return (
    <Modal title="Thread forum" onClose={onClose} wide>
      {loading && <p className="adm-mute">Memuat…</p>}
      {error && <p className="adm-err">{error}</p>}
      {data && (
        <>
          <div className="adm-card">
            <div className="meta adm-mute">
              <b>{data.post.author}</b> · {data.post.post_type} · {data.post.subject || "Umum"}
              {data.post.topic ? ` / ${data.post.topic}` : ""} · {fmt(data.post.created_at)}
            </div>
            <p style={{ whiteSpace: "pre-wrap" }}>{data.post.body}</p>
            {(data.post.images || []).length > 0 && <Badge>{data.post.images.length} gambar</Badge>}
            <div>
              <button className="adm-btn dng" onClick={() => setConfirm({ type: "post", id: data.post.id, label: "seluruh post ini beserta semua balasannya" })}>
                Hapus post
              </button>
            </div>
          </div>
          {replies.map((r) => (
            <div key={r.id} className="adm-card" style={{ marginLeft: depth[r.id] * 16 }}>
              <div className="meta adm-mute">
                <b>{r.author}</b> · {fmt(r.created_at)}
                {(r.images || []).length > 0 ? ` · ${r.images.length} gambar` : ""}
              </div>
              <p style={{ whiteSpace: "pre-wrap" }}>{r.body}</p>
              <button className="adm-btn dng" onClick={() => setConfirm({ type: "reply", id: r.id, label: "balasan ini beserta balasan bersarangnya" })}>
                Hapus balasan
              </button>
            </div>
          ))}
          {replies.length === 0 && <p className="adm-mute">Belum ada balasan.</p>}
        </>
      )}
      {confirm && <ReasonModal title="Hapus permanen" text={`Hapus ${confirm.label}? Tindakan ini tidak bisa dibatalkan (snapshot tersimpan di audit log).`} onConfirm={doDelete} onClose={() => setConfirm(null)} />}
    </Modal>
  );
}

// --------------------------------------------------------------- Konten
function ContentTab({ notify }) {
  const [type, setType] = useState("module");
  const [qInput, setQInput] = useState("");
  const [authorInput, setAuthorInput] = useState("");
  const [filters, setFilters] = useState({ q: "", author: "" });
  const [page, setPage] = useState(1);
  const [sel, setSel] = useState({});
  const [confirm, setConfirm] = useState(null);
  const [threadId, setThreadId] = useState(null);
  const [editing, setEditing] = useState(null);

  const path = `content?type=${type}&q=${encodeURIComponent(filters.q)}&author=${encodeURIComponent(filters.author)}&page=${page}`;
  const { data, loading, error, reload } = useLoad(path);
  const items = (data && data.items) || [];
  const selected = Object.values(sel);

  function search() {
    setPage(1);
    setSel({});
    setFilters({ q: qInput, author: authorInput });
  }
  function changeType(t) {
    setType(t);
    setPage(1);
    setSel({});
  }
  function toggle(it) {
    const key = `${it.type}:${it.id}`;
    const next = { ...sel };
    if (next[key]) delete next[key];
    else next[key] = { type: it.type, id: it.id };
    setSel(next);
  }

  async function doDelete(reason) {
    const r = await api("content", { method: "POST", body: { action: "delete", items: confirm, reason } });
    const ok = r.results.filter((x) => x.ok).length;
    const failed = r.results.filter((x) => !x.ok);
    notify(failed.length ? `${ok} terhapus, ${failed.length} gagal: ${failed[0].error}` : `${ok} item terhapus.`, failed.length ? "err" : "ok");
    setSel({});
    setConfirm(null);
    reload();
  }

  return (
    <>
      <div className="adm-bar">
        <select className="adm-sel" style={{ width: "auto" }} value={type} onChange={(e) => changeType(e.target.value)}>
          <option value="module">Modul</option>
          <option value="post">Post forum</option>
          <option value="reply">Balasan</option>
        </select>
        <input className="adm-in" placeholder="Cari kata…" value={qInput} onChange={(e) => setQInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} />
        <input className="adm-in" placeholder="Username penulis" value={authorInput} onChange={(e) => setAuthorInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} />
        <button className="adm-btn pri" onClick={search}>
          Cari
        </button>
        <button className="adm-btn dng" disabled={selected.length === 0} onClick={() => setConfirm(selected)}>
          Hapus terpilih ({selected.length})
        </button>
      </div>
      {loading && <p className="adm-mute">Memuat…</p>}
      {error && <p className="adm-err">{error}</p>}
      <div className="adm-card">
        {items.map((it) => (
          <div key={it.id} className="adm-row">
            <input type="checkbox" checked={!!sel[`${it.type}:${it.id}`]} onChange={() => toggle(it)} aria-label="Pilih" />
            <div className="main">
              {it.type === "module" ? (
                <>
                  <b>{it.title}</b>
                  <div>
                    {it.link_url ? <Badge>LINK</Badge> : <Badge>{it.file_type || "FILE"}</Badge>}
                    {it.is_exercise && <Badge tone="warn">Latihan soal</Badge>}
                    {it.topic_is_custom && <Badge tone="warn">Topik custom</Badge>}
                    {it.original_title && <Badge tone="warn">Judul diubah AI</Badge>}
                  </div>
                </>
              ) : (
                <div style={{ whiteSpace: "pre-wrap" }}>{snip(it.body)}</div>
              )}
              <div className="meta">
                {it.author} · {it.subject ? `${it.subject}${it.topic ? ` / ${it.topic}` : ""} · ` : ""}
                {it.post_type ? `${it.post_type} · ` : ""}
                {(it.images || []).length > 0 ? `${it.images.length} gambar · ` : ""}
                {fmt(it.created_at)}
              </div>
            </div>
            <div className="acts">
              {it.type === "module" && (
                <button className="adm-btn" onClick={() => setEditing(it)}>
                  Edit
                </button>
              )}
              {it.type === "post" && (
                <button className="adm-btn" onClick={() => setThreadId(it.id)}>
                  Buka
                </button>
              )}
              {it.type === "reply" && (
                <button className="adm-btn" onClick={() => setThreadId(it.post_id)}>
                  Thread
                </button>
              )}
              <button className="adm-btn dng" onClick={() => setConfirm([{ type: it.type, id: it.id }])}>
                Hapus
              </button>
            </div>
          </div>
        ))}
        {!loading && items.length === 0 && <p className="adm-mute">Tidak ada hasil.</p>}
      </div>
      {data && <Pager page={page} total={data.total} size={data.size} onPage={setPage} />}
      {confirm && <ReasonModal title="Hapus permanen" text={`Hapus ${confirm.length} item? Tindakan ini tidak bisa dibatalkan; snapshot konten tersimpan di audit log.`} onConfirm={doDelete} onClose={() => setConfirm(null)} />}
      {threadId && <ThreadModal postId={threadId} onClose={() => setThreadId(null)} onChanged={reload} notify={notify} />}
      {editing && <ModuleEditor item={editing} onClose={() => setEditing(null)} onSaved={reload} notify={notify} />}
    </>
  );
}

// --------------------------------------------------------------- Review
function ReviewTab({ notify }) {
  const { data, loading, error, reload } = useLoad("review");
  const [editing, setEditing] = useState(null);
  const [busyId, setBusyId] = useState(null);

  async function quick(id, action, okMsg) {
    setBusyId(id);
    try {
      await api(`modules/${id}`, { method: "POST", body: { action } });
      notify(okMsg);
      reload();
    } catch (e) {
      notify(e.message, "err");
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <p className="adm-mute">Memuat…</p>;
  if (error) return <p className="adm-err">{error}</p>;
  return (
    <>
      <p className="adm-mute">{data.total} modul menunggu review (menampilkan {data.items.length}).</p>
      <div className="adm-card">
        {data.items.map((m) => (
          <div key={m.id} className="adm-row">
            <div className="main">
              <b>{m.title}</b>
              {m.original_title && <div className="adm-mute">Judul asli: {m.original_title}</div>}
              <div>
                {m.reasons.map((r) => (
                  <Badge key={r} tone="warn">
                    {r}
                  </Badge>
                ))}
              </div>
              <div className="meta">
                {m.author} · {m.subject} / {m.topic} · {m.is_exercise ? "Latihan soal" : "Materi"} · {fmt(m.created_at)}
              </div>
            </div>
            <div className="acts">
              <button className="adm-btn" disabled={busyId === m.id} onClick={() => setEditing(m)}>
                Edit
              </button>
              {m.original_title && (
                <button className="adm-btn" disabled={busyId === m.id} onClick={() => quick(m.id, "revertTitle", "Judul dikembalikan.")}>
                  Judul asli
                </button>
              )}
              <button className="adm-btn pri" disabled={busyId === m.id} onClick={() => quick(m.id, "approve", "Ditandai sudah ditinjau.")}>
                Setujui
              </button>
            </div>
          </div>
        ))}
        {data.items.length === 0 && <p className="adm-mute">Antrean kosong 🎉</p>}
      </div>
      {editing && <ModuleEditor item={editing} onClose={() => setEditing(null)} onSaved={reload} notify={notify} />}
    </>
  );
}

// ---------------------------------------------------------------- Topik
function MoveModal({ topic, subjects, topics, onClose, onDone }) {
  const [toSubject, setToSubject] = useState(topic.subject);
  const [to, setTo] = useState(topic.topic);
  const [markOfficial, setMarkOfficial] = useState(true);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const options = topics.filter((t) => t.subject === toSubject).map((t) => t.topic);

  async function go() {
    setBusy(true);
    setErr("");
    try {
      const r = await api("topics", { method: "POST", body: { subject: topic.subject, from: topic.topic, toSubject, to, markOfficial, reason } });
      onDone(r);
      onClose();
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  }
  return (
    <Modal title="Pindahkan / ganti nama topik" onClose={onClose}>
      <p className="adm-mute">
        Semua modul dan post di <b>{topic.subject} / {topic.topic}</b> ({topic.modules} modul, {topic.posts} post) akan dipindahkan.
      </p>
      <label className="adm-lab">Subject tujuan</label>
      <input className="adm-in" list="adm-mv-subjects" value={toSubject} onChange={(e) => setToSubject(e.target.value)} />
      <datalist id="adm-mv-subjects">
        {subjects.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <label className="adm-lab">Topik tujuan (pilih yang sudah ada untuk menggabungkan, atau ketik nama baru)</label>
      <input className="adm-in" list="adm-mv-topics" value={to} onChange={(e) => setTo(e.target.value)} />
      <datalist id="adm-mv-topics">
        {options.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
      <label className="adm-lab">
        <input type="checkbox" checked={markOfficial} onChange={(e) => setMarkOfficial(e.target.checked)} /> Topik tujuan adalah topik resmi (hapus tanda &quot;buatan pengguna&quot;)
      </label>
      <label className="adm-lab">Catatan (opsional)</label>
      <input className="adm-in" value={reason} onChange={(e) => setReason(e.target.value)} />
      {err && <div className="adm-err">{err}</div>}
      <div className="adm-bar" style={{ marginTop: 12, justifyContent: "flex-end" }}>
        <button className="adm-btn" onClick={onClose} disabled={busy}>
          Batal
        </button>
        <button className="adm-btn pri" onClick={go} disabled={busy || !to.trim() || !toSubject.trim()}>
          {busy ? "Memproses…" : "Pindahkan"}
        </button>
      </div>
    </Modal>
  );
}

function TopicsTab({ notify }) {
  const { data, loading, error, reload } = useLoad("topics");
  const [moving, setMoving] = useState(null);
  const [filter, setFilter] = useState("");

  async function onMoved(r) {
    notify(`${r.modules} modul dan ${r.posts} post dipindahkan.`);
    reload();
    if (r.needsEmbed) {
      try {
        await runLoop("embed");
        notify("Indeks pencarian diperbarui.");
      } catch (e) {
        notify(`Topik dipindahkan, tetapi indeks pencarian belum selesai: ${e.message}. Jalankan dari tab Maintenance.`, "err");
      }
    }
  }

  if (loading) return <p className="adm-mute">Memuat…</p>;
  if (error) return <p className="adm-err">{error}</p>;
  const topics = data.topics.filter((t) => `${t.subject} ${t.topic}`.toLowerCase().includes(filter.toLowerCase()));
  const subjects = Array.from(new Set(data.topics.map((t) => t.subject)));
  return (
    <>
      <div className="adm-bar">
        <input className="adm-in" placeholder="Filter subject / topik…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      <div className="adm-card">
        {topics.map((t) => (
          <div key={`${t.subject}|${t.topic}`} className="adm-row">
            <div className="main">
              <b>{t.topic}</b> <span className="adm-mute">· {t.subject}</span>
              <div className="meta">
                {t.modules} modul · {t.posts} post {t.custom > 0 && <Badge tone="warn">{t.custom} buatan pengguna</Badge>}
              </div>
            </div>
            <button className="adm-btn" onClick={() => setMoving(t)}>
              Pindahkan / ganti nama
            </button>
          </div>
        ))}
        {topics.length === 0 && <p className="adm-mute">Tidak ada topik.</p>}
      </div>
      {moving && <MoveModal topic={moving} subjects={subjects} topics={data.topics} onClose={() => setMoving(null)} onDone={onMoved} />}
    </>
  );
}

// ------------------------------------------------------------- Pengguna
function UserModal({ user, isSelf, onClose, onChanged, notify }) {
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [days, setDays] = useState("7");
  const [pw, setPw] = useState("");
  const [confirmName, setConfirmName] = useState("");
  const [bio, setBio] = useState({ headline: false, goal: false, interests: false, skills: false });

  async function act(action, payload, okMsg, close) {
    setBusy(true);
    try {
      await api(`users/${user.id}`, { method: "POST", body: { action, ...payload } });
      notify(okMsg);
      if (isSelf && action === "setAdmin" && payload.value === false) {
        window.location.reload();
        return;
      }
      onChanged();
      if (close) onClose();
    } catch (e) {
      notify(e.message, "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Kelola @${user.username}`} onClose={onClose} wide>
      <div>
        {user.isAdmin && <Badge tone="ok">Admin</Badge>}
        {user.suspended && <Badge tone="dng">Ditangguhkan{user.suspendedUntil ? ` s.d. ${fmt(user.suspendedUntil)}` : ""}</Badge>}
        <span className="adm-mute">
          {user.counts.modules} modul · {user.counts.posts} post · {user.counts.replies} balasan
        </span>
      </div>
      {user.suspended && user.suspendedReason && <p className="adm-mute">Alasan: {user.suspendedReason}</p>}

      <div className="adm-sec">
        <b>Status akun</b>
        {user.suspended ? (
          <div className="adm-bar" style={{ marginTop: 8 }}>
            <button className="adm-btn pri" disabled={busy} onClick={() => act("unsuspend", {}, "Akun diaktifkan kembali.")}>
              Aktifkan kembali
            </button>
          </div>
        ) : (
          <>
            <label className="adm-lab">Alasan penangguhan</label>
            <input className="adm-in" value={reason} onChange={(e) => setReason(e.target.value)} />
            <div className="adm-bar" style={{ marginTop: 8 }}>
              <select className="adm-sel" style={{ width: "auto" }} value={days} onChange={(e) => setDays(e.target.value)}>
                <option value="1">1 hari</option>
                <option value="7">7 hari</option>
                <option value="30">30 hari</option>
                <option value="">Tanpa batas</option>
              </select>
              <button className="adm-btn dng" disabled={busy || reason.trim().length < 3 || user.isAdmin || isSelf} onClick={() => act("suspend", { reason: reason.trim(), days: days ? Number(days) : null }, "Akun ditangguhkan.")}>
                Tangguhkan
              </button>
            </div>
            <div className="adm-mute" style={{ fontSize: 12 }}>
              Akun yang ditangguhkan tidak bisa menulis (post, balasan, modul, like, profil) tetapi masih bisa membaca.
            </div>
          </>
        )}
      </div>

      <div className="adm-sec">
        <b>Role</b>
        <div className="adm-bar" style={{ marginTop: 8 }}>
          {user.isAdmin ? (
            <button className="adm-btn" disabled={busy} onClick={() => act("setAdmin", { value: false }, "Status admin dicabut.")}>
              Cabut status admin
            </button>
          ) : (
            <button className="adm-btn" disabled={busy || user.suspended} onClick={() => act("setAdmin", { value: true }, "Dijadikan admin.")}>
              Jadikan admin
            </button>
          )}
        </div>
      </div>

      <div className="adm-sec">
        <b>Password &amp; sesi</b>
        <label className="adm-lab">Password baru (minimal 8 karakter) — sampaikan langsung ke pemilik akun</label>
        <div className="adm-bar">
          <input className="adm-in" value={pw} onChange={(e) => setPw(e.target.value)} />
          <button className="adm-btn" onClick={() => setPw(randomPassword())}>
            Buat acak
          </button>
          <button className="adm-btn pri" disabled={busy || pw.length < 8 || (user.isAdmin && !isSelf)} onClick={() => act("resetPassword", { password: pw }, "Password direset; sesi lama dikeluarkan.")}>
            Reset
          </button>
        </div>
        <button className="adm-btn" disabled={busy} onClick={() => act("revokeSessions", {}, "Semua sesi dikeluarkan.")}>
          Keluarkan semua sesi
        </button>
      </div>

      <div className="adm-sec">
        <b>Moderasi profil</b>
        <div className="adm-bar" style={{ marginTop: 8 }}>
          <button className="adm-btn" disabled={busy || !user.photoUrl} onClick={() => act("clearPhoto", {}, "Foto profil dihapus.")}>
            Hapus foto profil
          </button>
        </div>
        <div>
          {[
            ["headline", "Headline"],
            ["goal", "Goal"],
            ["interests", "Minat"],
            ["skills", "Skill"],
          ].map(([key, label]) => (
            <label key={key} style={{ marginRight: 12 }}>
              <input type="checkbox" checked={bio[key]} onChange={(e) => setBio({ ...bio, [key]: e.target.checked })} /> {label}
            </label>
          ))}
        </div>
        <button
          className="adm-btn"
          style={{ marginTop: 8 }}
          disabled={busy || !Object.values(bio).some(Boolean)}
          onClick={() => act("clearBio", { fields: Object.keys(bio).filter((k) => bio[k]) }, "Bagian profil dikosongkan.")}
        >
          Kosongkan bagian terpilih
        </button>
      </div>

      {!user.isAdmin && !isSelf && (
        <div className="adm-sec">
          <b style={{ color: "var(--danger)" }}>Hapus akun permanen</b>
          <p className="adm-mute">Menghapus akun beserta seluruh modul, post, dan balasannya (termasuk file di Cloudinary). Tidak bisa dibatalkan.</p>
          <label className="adm-lab">Ketik username &quot;{user.username}&quot; untuk konfirmasi</label>
          <input className="adm-in" value={confirmName} onChange={(e) => setConfirmName(e.target.value)} />
          <label className="adm-lab">Alasan</label>
          <input className="adm-in" value={reason} onChange={(e) => setReason(e.target.value)} />
          <button
            className="adm-btn dng"
            style={{ marginTop: 8 }}
            disabled={busy || confirmName !== user.username || reason.trim().length < 3}
            onClick={() => act("delete", { confirmUsername: confirmName, reason: reason.trim() }, "Akun dihapus.", true)}
          >
            {busy ? "Menghapus…" : "Hapus akun permanen"}
          </button>
        </div>
      )}
    </Modal>
  );
}

function UsersTab({ notify }) {
  const { data, loading, error, reload } = useLoad("users");
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [managing, setManaging] = useState(null);
  const SIZE = 25;

  if (loading) return <p className="adm-mute">Memuat…</p>;
  if (error) return <p className="adm-err">{error}</p>;
  const list = data.users.filter((u) => {
    if (filter === "admin" && !u.isAdmin) return false;
    if (filter === "suspended" && !u.suspended) return false;
    return `${u.username} ${u.realName}`.toLowerCase().includes(q.toLowerCase());
  });
  const shown = list.slice((page - 1) * SIZE, page * SIZE);
  const current = managing ? data.users.find((u) => u.id === managing) : null;
  return (
    <>
      <div className="adm-bar">
        <input
          className="adm-in"
          placeholder="Cari username…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
        <select
          className="adm-sel"
          style={{ width: "auto" }}
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setPage(1);
          }}
        >
          <option value="all">Semua</option>
          <option value="admin">Admin</option>
          <option value="suspended">Ditangguhkan</option>
        </select>
      </div>
      <div className="adm-card">
        {shown.map((u) => (
          <div key={u.id} className="adm-row">
            <div className="main">
              <b>@{u.username}</b> {u.realName && <span className="adm-mute">({u.realName})</span>}{" "}
              {u.isAdmin && <Badge tone="ok">Admin</Badge>}
              {u.suspended && <Badge tone="dng">Ditangguhkan</Badge>}
              <div className="meta">
                {u.counts.modules} modul · {u.counts.posts} post · {u.counts.replies} balasan · bergabung {fmt(u.createdAt)}
              </div>
            </div>
            <button className="adm-btn" onClick={() => setManaging(u.id)}>
              Kelola
            </button>
          </div>
        ))}
        {shown.length === 0 && <p className="adm-mute">Tidak ada pengguna.</p>}
      </div>
      <Pager page={page} total={list.length} size={SIZE} onPage={setPage} />
      {current && <UserModal user={current} isSelf={current.id === data.me} onClose={() => setManaging(null)} onChanged={reload} notify={notify} />}
    </>
  );
}

// ------------------------------------------------------- Reset password
function ResetModal({ req, onClose, onDone, notify }) {
  const [pw, setPw] = useState(() => randomPassword());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [finished, setFinished] = useState(false);

  async function go() {
    setBusy(true);
    setErr("");
    try {
      await api(`password-requests/${req.id}`, { method: "POST", body: { action: "reset", password: pw } });
      setFinished(true);
      onDone();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(pw);
      notify("Password disalin.");
    } catch {
      notify("Tidak bisa menyalin otomatis — salin manual.", "err");
    }
  }

  return (
    <Modal title={`Reset password @${req.username}`} onClose={onClose}>
      <div className="adm-card" style={{ whiteSpace: "pre-wrap" }}>
        <div className="adm-mute" style={{ fontSize: 12 }}>
          Keterangan dari pemohon{req.realName ? ` (nama di profil: ${req.realName})` : ""}:
        </div>
        {req.note}
      </div>
      {!finished ? (
        <>
          <p className="adm-mute">
            <b>Verifikasi identitas dulu</b> (bertemu langsung / kenal orangnya) sebelum menetapkan password. Siapa pun bisa mengirim permintaan atas nama orang lain.
          </p>
          <label className="adm-lab">Password sementara (minimal 8 karakter)</label>
          <div className="adm-bar">
            <input className="adm-in" value={pw} onChange={(e) => setPw(e.target.value)} />
            <button className="adm-btn" onClick={() => setPw(randomPassword())}>
              Buat acak
            </button>
            <button className="adm-btn" onClick={copy}>
              Salin
            </button>
          </div>
          {err && <div className="adm-err">{err}</div>}
          <div className="adm-bar" style={{ marginTop: 12, justifyContent: "flex-end" }}>
            <button className="adm-btn" onClick={onClose} disabled={busy}>
              Batal
            </button>
            <button className="adm-btn pri" onClick={go} disabled={busy || pw.length < 8}>
              {busy ? "Memproses…" : "Tetapkan password & selesaikan"}
            </button>
          </div>
        </>
      ) : (
        <>
          <p style={{ color: "var(--ok)" }}>Selesai. Password lama tidak berlaku lagi dan semua sesi lama dikeluarkan.</p>
          <label className="adm-lab">Password sementara (catat sekarang, tidak ditampilkan lagi)</label>
          <div className="adm-bar">
            <input className="adm-in" readOnly value={pw} />
            <button className="adm-btn" onClick={copy}>
              Salin
            </button>
          </div>
          <p className="adm-mute">Sampaikan langsung ke pemilik akun, lalu minta ia membuka <b>/ganti-password</b> setelah login untuk membuat password sendiri.</p>
          <div className="adm-bar" style={{ justifyContent: "flex-end" }}>
            <button className="adm-btn pri" onClick={onClose}>
              Tutup
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

function ResetTab({ notify }) {
  const [mode, setMode] = useState("pending");
  const { data, loading, error, reload } = useLoad(`password-requests?status=${mode}`);
  const [resetting, setResetting] = useState(null);
  const [rejecting, setRejecting] = useState(null);

  async function doReject(reason) {
    await api(`password-requests/${rejecting.id}`, { method: "POST", body: { action: "reject", reason } });
    notify("Permintaan ditolak.");
    setRejecting(null);
    reload();
  }

  return (
    <>
      <div className="adm-bar">
        <select className="adm-sel" style={{ width: "auto" }} value={mode} onChange={(e) => setMode(e.target.value)}>
          <option value="pending">Menunggu</option>
          <option value="all">Semua (termasuk selesai)</option>
        </select>
        <span className="adm-mute">Permintaan masuk dari halaman /lupa-password.</span>
      </div>
      {loading && <p className="adm-mute">Memuat…</p>}
      {error && <p className="adm-err">{error}</p>}
      <div className="adm-card">
        {((data && data.items) || []).map((r) => (
          <div key={r.id} className="adm-row">
            <div className="main">
              <b>@{r.username}</b> {r.realName && <span className="adm-mute">({r.realName})</span>}{" "}
              {r.status === "pending" && <Badge tone="warn">Menunggu</Badge>}
              {r.status === "done" && <Badge tone="ok">Selesai</Badge>}
              {r.status === "rejected" && <Badge tone="dng">Ditolak</Badge>}
              {r.request_count > 1 && <Badge>diminta {r.request_count}×</Badge>}
              <div style={{ whiteSpace: "pre-wrap", margin: "4px 0" }}>{r.note}</div>
              <div className="meta">
                Terakhir diminta {fmt(r.last_requested_at)}
                {r.resolved_at ? ` · diproses ${fmt(r.resolved_at)} oleh @${r.resolved_by_username || "admin"}` : ""}
                {r.resolution_note && r.status === "rejected" ? ` · ${r.resolution_note}` : ""}
              </div>
            </div>
            {r.status === "pending" && (
              <div className="acts">
                <button className="adm-btn pri" onClick={() => setResetting(r)}>
                  Reset
                </button>
                <button className="adm-btn dng" onClick={() => setRejecting(r)}>
                  Tolak
                </button>
              </div>
            )}
          </div>
        ))}
        {data && data.items.length === 0 && <p className="adm-mute">Tidak ada permintaan.</p>}
      </div>
      {resetting && <ResetModal req={resetting} onClose={() => setResetting(null)} onDone={reload} notify={notify} />}
      {rejecting && <ReasonModal title="Tolak permintaan" text={`Tolak permintaan reset password dari @${rejecting.username}?`} confirmText="Tolak" onConfirm={doReject} onClose={() => setRejecting(null)} />}
    </>
  );
}

// ---------------------------------------------------------- Maintenance
function MaintenanceTab({ notify }) {
  const { data, loading, error, reload } = useLoad("maintenance");
  const [log, setLog] = useState([]);
  const [running, setRunning] = useState("");

  async function run(step, label) {
    setRunning(step);
    setLog([`Mulai: ${label}…`]);
    try {
      const r = await runLoop(step, (p) => setLog((l) => [...l.slice(-40), `Sisa ${p.remaining}${p.failed ? ` · gagal ${p.failed}` : ""}`]));
      setLog((l) => [...l, r.done ? "Selesai ✅" : "Berhenti: tidak ada kemajuan (cek kunci API / log server)."]);
      notify(r.done ? `${label} selesai.` : `${label} berhenti.`, r.done ? "ok" : "err");
    } catch (e) {
      setLog((l) => [...l, `Error: ${e.message}`]);
      notify(e.message, "err");
    } finally {
      setRunning("");
      reload();
    }
  }

  if (loading) return <p className="adm-mute">Memuat…</p>;
  if (error) return <p className="adm-err">{error}</p>;
  return (
    <>
      <div className="adm-card">
        <b>Embedding pencarian</b>
        <p className="adm-mute">
          Belum punya embedding: {data.embedding.modules} modul, {data.embedding.posts} post.
          {!data.embeddingConfigured && " (AI_PROVIDER_API_KEY belum diset)"}
        </p>
        <button className="adm-btn pri" disabled={!!running || data.embedding.modules + data.embedding.posts === 0} onClick={() => run("embed", "Isi embedding")}>
          {running === "embed" ? "Berjalan…" : "Isi embedding yang kosong"}
        </button>
      </div>
      <div className="adm-card">
        <b>Analisis ulang AI</b>
        <p className="adm-mute">
          Modul yang belum dianalisis dengan versi terbaru: {data.retagPending}. Judul modul tidak diubah oleh proses ini.
          {!data.aiConfigured && " (AI_PROVIDER_API_KEY belum diset)"}
        </p>
        <button className="adm-btn pri" disabled={!!running || data.retagPending === 0} onClick={() => run("retag", "Analisis ulang AI")}>
          {running === "retag" ? "Berjalan…" : "Mulai analisis ulang"}
        </button>
      </div>
      {log.length > 0 && <div className="adm-pre">{log.join("\n")}</div>}
      <p className="adm-mute">Biarkan halaman ini terbuka selama proses berjalan; setiap batch dikerjakan satu per satu.</p>
    </>
  );
}

// ------------------------------------------------------------ Audit log
function AuditTab() {
  const [action, setAction] = useState("");
  const [adminQ, setAdminQ] = useState("");
  const [applied, setApplied] = useState({ action: "", admin: "" });
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState(null);
  const [detail, setDetail] = useState(null);
  const { data, loading, error } = useLoad(`audit?page=${page}&action=${encodeURIComponent(applied.action)}&admin=${encodeURIComponent(applied.admin)}`);

  async function toggle(id) {
    if (openId === id) {
      setOpenId(null);
      return;
    }
    setOpenId(id);
    setDetail(null);
    try {
      const r = await api(`audit?id=${id}`);
      setDetail(r.entry);
    } catch (e) {
      setDetail({ error: e.message });
    }
  }

  return (
    <>
      <div className="adm-bar">
        <input className="adm-in" placeholder="Jenis aksi (mis. user, module, post)" value={action} onChange={(e) => setAction(e.target.value)} />
        <input className="adm-in" placeholder="Username admin" value={adminQ} onChange={(e) => setAdminQ(e.target.value)} />
        <button
          className="adm-btn pri"
          onClick={() => {
            setPage(1);
            setApplied({ action, admin: adminQ });
          }}
        >
          Filter
        </button>
      </div>
      {loading && <p className="adm-mute">Memuat…</p>}
      {error && <p className="adm-err">{error}</p>}
      <div className="adm-card">
        {((data && data.items) || []).map((e) => (
          <div key={e.id} className="adm-row" style={{ display: "block" }}>
            <div style={{ cursor: "pointer" }} onClick={() => toggle(e.id)}>
              <Badge>{e.action}</Badge> <b>{e.target_label || e.target_id || "-"}</b>
              <div className="meta">
                oleh @{e.admin_username} · {fmt(e.created_at)}
                {e.reason ? ` · ${e.reason}` : ""}
              </div>
            </div>
            {openId === e.id && <div className="adm-pre" style={{ marginTop: 6 }}>{detail ? JSON.stringify(detail.snapshot ?? detail, null, 2) : "Memuat…"}</div>}
          </div>
        ))}
        {data && data.items.length === 0 && <p className="adm-mute">Belum ada catatan.</p>}
      </div>
      {data && <Pager page={page} total={data.total} size={data.size} onPage={setPage} />}
    </>
  );
}

// ------------------------------------------------------------- Halaman
export default function AdminPage() {
  const [phase, setPhase] = useState("loading");
  const [me, setMe] = useState(null);
  const [tab, setTab] = useState("overview");
  const [toast, setToast] = useState(null);
  const [bootError, setBootError] = useState("");

  const notify = useCallback((msg, kind = "ok") => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 4500);
  }, []);

  const boot = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      setPhase("nologin");
      return;
    }
    try {
      const m = await api("me");
      setMe(m);
      setPhase(m.mfaOk ? "ready" : "mfa");
    } catch (e) {
      if (e.status === 404) setPhase("denied");
      else if (e.status === 401) setPhase("nologin");
      else {
        setBootError(e.message);
        setPhase("error");
      }
    }
  }, []);

  useEffect(() => {
    boot();
  }, [boot]);

  if (phase === "loading") {
    return (
      <div className="adm">
        <style>{CSS}</style>
        <div className="adm-center adm-mute">Memuat…</div>
      </div>
    );
  }
  if (phase === "denied") {
    return (
      <div style={{ fontFamily: "system-ui,sans-serif", textAlign: "center", marginTop: "20vh" }}>
        <h1 style={{ display: "inline-block", borderRight: "1px solid rgba(128,128,128,.4)", margin: "0 20px 0 0", padding: "0 23px 0 0", fontSize: 24, fontWeight: 500 }}>404</h1>
        <span style={{ fontSize: 14 }}>This page could not be found.</span>
      </div>
    );
  }
  if (phase === "nologin" || phase === "error") {
    return (
      <div className="adm">
        <style>{CSS}</style>
        <div className="adm-center">
          <h2>Panel Admin</h2>
          <p className="adm-mute">{phase === "error" ? bootError : "Login dulu di halaman utama, lalu buka kembali /admin."}</p>
          <a className="adm-btn pri" href="/" style={{ textDecoration: "none", display: "inline-block" }}>
            Ke halaman utama
          </a>
        </div>
      </div>
    );
  }
  if (phase === "mfa") {
    return (
      <div className="adm">
        <style>{CSS}</style>
        <MfaGate onDone={boot} />
      </div>
    );
  }

  return (
    <div className="adm">
      <style>{CSS}</style>
      <div className="adm-top">
        <h1>Panel Admin</h1>
        <span className="adm-mute">@{me.username}</span>
        <a className="adm-btn" href="/" style={{ textDecoration: "none" }}>
          ← Situs
        </a>
        <button
          className="adm-btn"
          onClick={async () => {
            await supabase.auth.signOut();
            window.location.href = "/";
          }}
        >
          Keluar
        </button>
      </div>
      <div className="adm-tabs">
        {TABS.map(([key, label]) => (
          <button key={key} className={`adm-tab${tab === key ? " on" : ""}`} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>
      <div className="adm-main">
        {tab === "overview" && <OverviewTab setTab={setTab} />}
        {tab === "content" && <ContentTab notify={notify} />}
        {tab === "review" && <ReviewTab notify={notify} />}
        {tab === "topics" && <TopicsTab notify={notify} />}
        {tab === "users" && <UsersTab notify={notify} />}
        {tab === "resets" && <ResetTab notify={notify} />}
        {tab === "maintenance" && <MaintenanceTab notify={notify} />}
        {tab === "audit" && <AuditTab />}
      </div>
      {toast && <div className={`adm-toast${toast.kind === "err" ? " err" : ""}`}>{toast.msg}</div>}
    </div>
  );
}

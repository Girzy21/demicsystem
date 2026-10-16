"use client";

// src/app/components/ChatRoom.jsx
//
// "Diskusi Chat": post bertipe "diskusi" dibuka sebagai ruang chat real-time.
//
// Cara kerja real-time (aman & tahan gangguan):
//   1. Server mengirim SINYAL (hanya id, tanpa isi pesan) lewat Supabase Realtime
//      Broadcast ke kanal "chat:<postId>".
//   2. Klien yang berlangganan kanal itu mengambil pesan baru lewat API yang
//      wajib login (GET /api/forum/chat/<postId>?after=...).
//   3. Cadangan: kalau koneksi real-time putus, klien polling tiap beberapa
//      detik dan juga menyegarkan saat tab kembali aktif / koneksi pulih.
//
// Semua komponen didefinisikan di module scope (bukan di dalam komponen lain)
// supaya kolom ketik tidak kehilangan fokus saat render ulang.

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

const IMAGE_ONLY_BODY = "📷 Gambar"; // sama dengan di route chat
const MAX_BODY = 2000;
const MAX_IMAGES = 4;
const PAGE = 40;
const POLL_LIVE_MS = 60000; // koneksi real-time sehat: hanya "penyembuhan" tiap menit
const POLL_DOWN_MS = 8000; // koneksi putus: polling cepat
const GROUP_GAP_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------- helper murni
const pad = (n) => String(n).padStart(2, "0");
export function clock(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const dayKey = (iso) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};
export function dayLabel(iso, now = new Date()) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(now) - startOf(d)) / 86400000);
  if (diff === 0) return "Hari ini";
  if (diff === 1) return "Kemarin";
  const opts = { weekday: "long", day: "numeric", month: "long" };
  if (d.getFullYear() !== now.getFullYear()) opts.year = "numeric";
  return d.toLocaleDateString("id-ID", opts);
}
export function ago(iso) {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return "baru saja";
  if (s < 3600) return `${Math.floor(s / 60)} mnt lalu`;
  if (s < 86400) return `${Math.floor(s / 3600)} jam lalu`;
  return `${Math.floor(s / 86400)} hari lalu`;
}
const cmp = (a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// Gabungkan jendela pesan terbaru dari server (otoritatif) dengan yang sudah ada.
// Pesan lama di luar jendela dipertahankan; pesan yang terhapus/diedit di dalam
// jendela mengikuti server; pesan "sedang dikirim" (temp) selalu di ujung.
export function mergeWindow(prev, fresh, limit = PAGE) {
  const temps = prev.filter((m) => m.temp);
  const real = prev.filter((m) => !m.temp);
  const kept = fresh.length >= limit && fresh.length > 0 ? real.filter((m) => m.createdAt < fresh[0].createdAt) : [];
  const byId = new Map();
  for (const m of [...kept, ...fresh]) byId.set(m.id, m);
  return [...Array.from(byId.values()).sort(cmp), ...temps];
}

// Tambah pesan baru tanpa duplikat; pesan temp milikku yang isinya sama ikut digantikan.
export function appendNew(prev, incoming, me) {
  const ids = new Set(prev.filter((m) => !m.temp).map((m) => m.id));
  const add = incoming.filter((m) => !ids.has(m.id));
  if (add.length === 0) return prev;
  let temps = prev.filter((m) => m.temp);
  const real = prev.filter((m) => !m.temp);
  for (const m of add) {
    if (m.author !== me) continue;
    const i = temps.findIndex((t) => !t.failed && t.body === m.body && (t.images || []).length === (m.images || []).length);
    if (i >= 0) temps = temps.filter((_, idx) => idx !== i);
  }
  return [...[...real, ...add].sort(cmp), ...temps];
}

const seenKey = (id) => `w3study:chat-seen:${id}`;
export function getSeen(id) {
  try {
    return window.localStorage.getItem(seenKey(id)) || "";
  } catch {
    return "";
  }
}
function setSeen(id, iso) {
  try {
    window.localStorage.setItem(seenKey(id), iso);
  } catch {
    /* penyimpanan dinonaktifkan: abaikan */
  }
}

async function getToken() {
  const { data } = await supabase.auth.getSession();
  return data && data.session ? data.session.access_token : null;
}
async function chatApi(path, { method = "GET", body } = {}) {
  const token = await getToken();
  if (!token) throw new Error("Sesi berakhir — login ulang.");
  const res = await fetch(path, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(json.error || `Error ${res.status}`);
    e.status = res.status;
    throw e;
  }
  return json;
}

// ---------------------------------------------------------------- komponen kecil
function FallbackAvatar({ username, size = 32, photoUrl = null }) {
  if (photoUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={photoUrl} alt="" width={size} height={size} style={{ borderRadius: "50%", objectFit: "cover", display: "block" }} />;
  }
  return (
    <div style={{ width: size, height: size, borderRadius: "50%", background: "#D7E6FA", color: "#2C7BE5", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: size * 0.42 }}>
      {String(username || "?").charAt(0).toUpperCase()}
    </div>
  );
}

function DaySeparator({ label, c, sans }) {
  return (
    <div style={{ display: "flex", justifyContent: "center", margin: "14px 0 8px" }}>
      <span style={{ fontFamily: sans, fontSize: 11, color: c.inkMuted, background: c.panel, padding: "3px 12px", borderRadius: 999 }}>{label}</span>
    </div>
  );
}

function ImageGrid({ images, mine }) {
  const n = images.length;
  return (
    <div style={{ display: "grid", gridTemplateColumns: n === 1 ? "1fr" : "1fr 1fr", gap: 4, marginBottom: 6, maxWidth: 280 }}>
      {images.map((src, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={`${src}-${i}`}
          src={src}
          alt="Gambar dalam pesan"
          onClick={() => window.open(src, "_blank", "noopener")}
          style={{ width: "100%", maxHeight: n === 1 ? 220 : 120, objectFit: "cover", borderRadius: 10, cursor: "zoom-in", display: "block", opacity: mine ? 0.98 : 1 }}
        />
      ))}
    </div>
  );
}

function MessageBubble({ m, mine, showHeader, active, onActive, onReply, onEdit, onDelete, onRetry, onDiscard, onJump, editing, setEditing, saveEdit, busyEdit, c, sans, Avatar, openProfile, avatarFor, accent }) {
  const isEditing = editing && editing.id === m.id;
  const hasImages = (m.images || []).length > 0;
  const showText = m.body && !(hasImages && m.body === IMAGE_ONLY_BODY);
  const bubbleBg = mine ? accent : c.card;
  const bubbleFg = mine ? "#FFFFFF" : c.ink;
  return (
    <div
      id={`msg-${m.id}`}
      onMouseEnter={() => onActive(m.id)}
      onClick={() => onActive(m.id)}
      style={{ display: "flex", flexDirection: mine ? "row-reverse" : "row", gap: 8, alignItems: "flex-end", marginTop: showHeader ? 10 : 2 }}
    >
      <div style={{ width: 30, flexShrink: 0 }}>
        {!mine && showHeader && (
          <div onClick={() => openProfile && openProfile(m.author)} style={{ cursor: "pointer" }}>
            <Avatar username={m.author} size={30} photoUrl={avatarFor ? avatarFor(m.author) : null} />
          </div>
        )}
      </div>
      <div style={{ maxWidth: "72%", minWidth: 0, display: "flex", flexDirection: "column", alignItems: mine ? "flex-end" : "flex-start" }}>
        {!mine && showHeader && (
          <span onClick={() => openProfile && openProfile(m.author)} style={{ fontFamily: sans, fontSize: 11.5, fontWeight: 700, color: c.inkMuted, margin: "0 4px 3px", cursor: "pointer" }}>
            {m.author}
          </span>
        )}
        <div
          style={{
            background: m.deleted ? "transparent" : bubbleBg,
            color: m.deleted ? c.inkFaint : bubbleFg,
            border: m.deleted ? `1px dashed ${c.line}` : mine ? "none" : `1px solid ${c.line}`,
            borderRadius: 16,
            borderBottomRightRadius: mine ? 5 : 16,
            borderBottomLeftRadius: mine ? 16 : 5,
            padding: "8px 12px",
            fontFamily: sans,
            fontSize: 13.5,
            lineHeight: 1.45,
            opacity: m.temp && !m.failed ? 0.65 : 1,
            wordBreak: "break-word",
            overflowWrap: "anywhere",
          }}
        >
          {m.deleted ? (
            <span style={{ fontStyle: "italic", fontSize: 12.5 }}>Pesan ini dihapus</span>
          ) : (
            <>
              {m.replyTo && (
                <div
                  onClick={(e) => {
                    e.stopPropagation();
                    onJump(m.replyTo.id);
                  }}
                  style={{ borderLeft: `3px solid ${mine ? "rgba(255,255,255,0.7)" : accent}`, background: mine ? "rgba(255,255,255,0.16)" : c.panel, borderRadius: 8, padding: "4px 8px", marginBottom: 6, cursor: "pointer", fontSize: 12 }}
                >
                  <div style={{ fontWeight: 700, opacity: 0.9 }}>{m.replyTo.author}</div>
                  <div style={{ opacity: 0.85 }}>{m.replyTo.deleted ? "Pesan ini dihapus" : m.replyTo.body}</div>
                </div>
              )}
              {hasImages && <ImageGrid images={m.images} mine={mine} />}
              {isEditing ? (
                <div onClick={(e) => e.stopPropagation()}>
                  <textarea
                    autoFocus
                    rows={2}
                    maxLength={MAX_BODY}
                    value={editing.text}
                    onChange={(e) => setEditing({ id: m.id, text: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey && !(e.nativeEvent && e.nativeEvent.isComposing)) {
                        e.preventDefault();
                        saveEdit();
                      } else if (e.key === "Escape") setEditing(null);
                    }}
                    style={{ width: 240, maxWidth: "100%", boxSizing: "border-box", fontFamily: sans, fontSize: 13, borderRadius: 8, border: `1px solid ${c.line}`, padding: 6, background: c.fieldBg, color: c.ink, resize: "none", outline: "none" }}
                  />
                  <div style={{ display: "flex", gap: 6, marginTop: 4, alignItems: "center" }}>
                    <button disabled={busyEdit || !editing.text.trim()} onClick={saveEdit} style={{ border: "none", borderRadius: 999, padding: "3px 12px", background: c.card, color: accent, fontFamily: sans, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                      Simpan
                    </button>
                    <button onClick={() => setEditing(null)} style={{ border: "none", background: "none", color: "inherit", fontFamily: sans, fontSize: 11, cursor: "pointer", textDecoration: "underline" }}>
                      Batal
                    </button>
                    <span style={{ fontSize: 10.5, opacity: 0.75 }}>Enter simpan · Esc batal</span>
                  </div>
                </div>
              ) : (
                showText && <span style={{ whiteSpace: "pre-wrap" }}>{m.body}</span>
              )}
            </>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "2px 6px 0", fontFamily: sans, fontSize: 10.5, color: c.inkFaint, minHeight: 16 }}>
          {m.failed ? (
            <>
              <span style={{ color: "#D9553A" }}>Gagal terkirim{m.error ? `: ${m.error}` : ""}</span>
              <button onClick={() => onRetry(m)} style={{ border: "none", background: "none", color: accent, cursor: "pointer", fontSize: 10.5, fontWeight: 700, padding: 0 }}>
                Kirim ulang
              </button>
              <button onClick={() => onDiscard(m)} style={{ border: "none", background: "none", color: c.inkFaint, cursor: "pointer", fontSize: 10.5, padding: 0 }}>
                Hapus
              </button>
            </>
          ) : m.temp ? (
            <span>Mengirim…</span>
          ) : (
            <>
              <span>
                {clock(m.createdAt)}
                {m.editedAt && !m.deleted ? " · diedit" : ""}
              </span>
              {active && !m.deleted && !isEditing && (
                <>
                  <button onClick={() => onReply(m)} style={{ border: "none", background: "none", color: c.inkMuted, cursor: "pointer", fontSize: 10.5, fontWeight: 700, padding: 0 }}>
                    Balas
                  </button>
                  {mine && (
                    <>
                      <button onClick={() => onEdit(m)} style={{ border: "none", background: "none", color: c.inkMuted, cursor: "pointer", fontSize: 10.5, fontWeight: 700, padding: 0 }}>
                        Edit
                      </button>
                      <button onClick={() => onDelete(m)} style={{ border: "none", background: "none", color: "#D9553A", cursor: "pointer", fontSize: 10.5, fontWeight: 700, padding: 0 }}>
                        Hapus
                      </button>
                    </>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- ruang chat
export default function ChatRoom({ ctx, post, UsernameAvatar, uploadDirectToCloudinary }) {
  const { c, sans, CURRENT_USER, closeThread, openProfile, avatarFor, forumAccent } = ctx;
  const Avatar = UsernameAvatar || FallbackAvatar;
  const accent = forumAccent || c.blue;

  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [live, setLive] = useState(false);
  const [gone, setGone] = useState(false);
  const [room, setRoom] = useState(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState(null);
  const [files, setFiles] = useState([]);
  const [editing, setEditing] = useState(null);
  const [busyEdit, setBusyEdit] = useState(false);
  const [notice, setNotice] = useState("");
  const [newBelow, setNewBelow] = useState(0);
  const [activeId, setActiveId] = useState(null);

  const listRef = useRef(null);
  const taRef = useRef(null);
  const fileInputRef = useRef(null);
  const atBottomRef = useRef(true);
  const stickRef = useRef(false);
  const preserveRef = useRef(null);
  const messagesRef = useRef([]);
  const fns = useRef({});
  messagesRef.current = messages;

  const roomPath = `/api/forum/chat/${post.id}`;

  // ---- pengambilan data (disimpan di ref agar callback real-time tidak basi) ----
  fns.current.receive = (incoming) => {
    const mine = incoming.filter((m) => m.author === CURRENT_USER).length;
    const others = incoming.length - mine;
    if (atBottomRef.current || mine > 0) stickRef.current = true;
    else if (others > 0) setNewBelow((n) => n + others);
    setMessages((prev) => appendNew(prev, incoming, CURRENT_USER));
  };
  fns.current.refresh = async () => {
    const r = await chatApi(`${roomPath}?limit=${PAGE}`);
    if (atBottomRef.current) stickRef.current = true;
    setMessages((prev) => mergeWindow(prev, r.messages, PAGE));
    if (r.room) setRoom(r.room);
  };
  fns.current.fetchNew = async () => {
    const real = messagesRef.current.filter((m) => !m.temp);
    const last = real.length ? real[real.length - 1].createdAt : null;
    if (!last) return fns.current.refresh();
    const r = await chatApi(`${roomPath}?after=${encodeURIComponent(last)}`);
    if (r.messages.length) fns.current.receive(r.messages);
  };
  fns.current.guard = (p) =>
    p.catch((e) => {
      if (e && (e.status === 404 || e.status === 400)) setGone(true);
    });

  // ---- muat awal ----
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setLoadError("");
    setMessages([]);
    chatApi(`${roomPath}?limit=${PAGE}`)
      .then((r) => {
        if (!alive) return;
        stickRef.current = true;
        setMessages(r.messages);
        setHasMore(r.hasMore);
        setRoom(r.room);
        setLoading(false);
      })
      .catch((e) => {
        if (!alive) return;
        if (e.status === 404 || e.status === 400) setGone(true);
        setLoadError(e.message);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [post.id]);

  // ---- real-time: sinyal broadcast ----
  useEffect(() => {
    let timer = null;
    const pending = new Set();
    const flush = () => {
      const kinds = Array.from(pending);
      pending.clear();
      if (kinds.includes("gone")) setGone(true);
      else if (kinds.some((k) => k === "edit" || k === "delete")) fns.current.guard(fns.current.refresh());
      else fns.current.guard(fns.current.fetchNew());
    };
    const channel = supabase
      .channel(`chat:${post.id}`, { config: { broadcast: { self: false } } })
      .on("broadcast", { event: "message" }, (msg) => {
        pending.add((msg && msg.payload && msg.payload.kind) || "new");
        clearTimeout(timer);
        timer = setTimeout(flush, 120);
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          setLive(true);
          fns.current.guard(fns.current.fetchNew()); // kejar pesan yang terlewat sebelum tersambung
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") setLive(false);
      });
    return () => {
      clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [post.id]);

  // ---- cadangan: polling + saat tab aktif / koneksi pulih ----
  useEffect(() => {
    if (gone) return undefined;
    const id = setInterval(() => fns.current.guard(fns.current.refresh()), live ? POLL_LIVE_MS : POLL_DOWN_MS);
    const onVisible = () => {
      if (typeof document !== "undefined" && !document.hidden) fns.current.guard(fns.current.refresh());
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
    };
  }, [live, gone, post.id]);

  // ---- posisi gulir ----
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (preserveRef.current) {
      el.scrollTop = el.scrollHeight - preserveRef.current.h + preserveRef.current.t;
      preserveRef.current = null;
    } else if (stickRef.current) {
      el.scrollTop = el.scrollHeight;
      stickRef.current = false;
      atBottomRef.current = true;
    }
  }, [messages, loading]);

  // ---- tandai sudah dibaca ----
  useEffect(() => {
    const real = messages.filter((m) => !m.temp);
    if (real.length && atBottomRef.current) setSeen(post.id, real[real.length - 1].createdAt);
  }, [messages, post.id]);
  useEffect(
    () => () => {
      const real = messagesRef.current.filter((m) => !m.temp);
      if (real.length) setSeen(post.id, real[real.length - 1].createdAt);
    },
    [post.id]
  );

  function onScroll() {
    const el = listRef.current;
    if (!el) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    atBottomRef.current = bottom;
    if (bottom && newBelow) setNewBelow(0);
  }
  function jumpToBottom() {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    atBottomRef.current = true;
    setNewBelow(0);
  }
  function jumpToMessage(id) {
    const node = typeof document !== "undefined" ? document.getElementById(`msg-${id}`) : null;
    if (node && node.scrollIntoView) node.scrollIntoView({ block: "center", behavior: "smooth" });
    else setNotice("Pesan asli ada di bagian yang lebih lama — muat pesan sebelumnya dulu.");
  }

  async function loadOlder() {
    const real = messagesRef.current.filter((m) => !m.temp);
    if (!real.length || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const el = listRef.current;
      const r = await chatApi(`${roomPath}?limit=${PAGE}&before=${encodeURIComponent(real[0].createdAt)}`);
      if (el) preserveRef.current = { h: el.scrollHeight, t: el.scrollTop };
      setMessages((prev) => appendNew(prev, r.messages, CURRENT_USER));
      setHasMore(r.hasMore);
    } catch (e) {
      setNotice(e.message);
    } finally {
      setLoadingOlder(false);
    }
  }

  // ---- kirim ----
  async function deliver(temp) {
    try {
      const token = await getToken();
      const uploaded = [];
      for (const f of temp.files || []) uploaded.push(await uploadDirectToCloudinary(f.file, "forum", token));
      const r = await chatApi(roomPath, {
        method: "POST",
        body: { body: temp.body === IMAGE_ONLY_BODY ? "" : temp.body, parentId: temp.parentId, images: uploaded.map((u) => ({ publicId: u.publicId })) },
      });
      stickRef.current = true;
      setMessages((prev) => appendNew(prev.filter((m) => m.id !== temp.id), [r.message], CURRENT_USER));
      (temp.files || []).forEach((f) => URL.revokeObjectURL && URL.revokeObjectURL(f.url));
    } catch (e) {
      setMessages((prev) => prev.map((m) => (m.id === temp.id ? { ...m, failed: true, error: e.uploadMessage || e.message } : m)));
    }
  }
  function send() {
    const text = draft.trim();
    if (!text && files.length === 0) return;
    if (text.length > MAX_BODY) {
      setNotice(`Pesan maksimal ${MAX_BODY} karakter.`);
      return;
    }
    const temp = {
      id: `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      temp: true,
      author: CURRENT_USER,
      body: text || IMAGE_ONLY_BODY,
      images: files.map((f) => f.url),
      files,
      parentId: replyTo ? replyTo.id : null,
      replyTo: replyTo ? { id: replyTo.id, author: replyTo.author, body: replyTo.body.slice(0, 100), deleted: false } : null,
      createdAt: new Date().toISOString(),
    };
    stickRef.current = true;
    setMessages((prev) => [...prev, temp]);
    setDraft("");
    setReplyTo(null);
    setFiles([]);
    setNotice("");
    if (taRef.current) taRef.current.style.height = "auto";
    deliver(temp);
  }
  function retry(m) {
    setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, failed: false, error: "" } : x)));
    deliver({ ...m, failed: false });
  }
  function discard(m) {
    setMessages((prev) => prev.filter((x) => x.id !== m.id));
    (m.files || []).forEach((f) => URL.revokeObjectURL && URL.revokeObjectURL(f.url));
  }

  function onPickFiles(e) {
    const picked = Array.from(e.target.files || []);
    e.target.value = "";
    const room_ = MAX_IMAGES - files.length;
    if (room_ <= 0) return setNotice(`Maksimal ${MAX_IMAGES} gambar per pesan.`);
    const ok = picked.filter((f) => /^image\/(jpeg|png|webp)$/.test(f.type) && f.size <= 8 * 1024 * 1024).slice(0, room_);
    if (ok.length < picked.length) setNotice("Hanya JPG/PNG/WebP, maksimal 8MB per gambar.");
    setFiles((prev) => [...prev, ...ok.map((file) => ({ file, url: URL.createObjectURL(file) }))]);
  }

  // ---- edit & hapus ----
  async function saveEdit() {
    if (!editing) return;
    const text = editing.text.trim();
    if (!text) return;
    setBusyEdit(true);
    try {
      const r = await chatApi(`${roomPath}/${editing.id}`, { method: "PATCH", body: { body: text } });
      setMessages((prev) => prev.map((m) => (m.id === editing.id ? { ...m, body: r.message.body, editedAt: r.message.editedAt } : m)));
      setEditing(null);
    } catch (e) {
      setNotice(e.message);
    } finally {
      setBusyEdit(false);
    }
  }
  async function removeMessage(m) {
    if (typeof window !== "undefined" && !window.confirm("Hapus pesan ini?")) return;
    try {
      await chatApi(`${roomPath}/${m.id}`, { method: "DELETE" });
      setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, deleted: true, body: "", images: [] } : x)));
    } catch (e) {
      setNotice(e.message);
    }
  }

  function onDraftChange(e) {
    setDraft(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }
  function onDraftKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey && !(e.nativeEvent && e.nativeEvent.isComposing)) {
      e.preventDefault();
      send();
    } else if (e.key === "Escape" && replyTo) setReplyTo(null);
  }

  // ---- render ----
  const title = String((room && room.body) || post.body || "Diskusi").replace(/\s+/g, " ").trim();
  const canSend = draft.trim().length > 0 || files.length > 0;

  if (gone) {
    return (
      <div style={{ padding: "0 32px" }}>
        <div style={{ padding: "40px 20px", textAlign: "center", borderRadius: 16, border: `1px dashed ${c.line}`, background: c.card }}>
          <div style={{ fontSize: 26, marginBottom: 8 }}>🫥</div>
          <div style={{ fontFamily: sans, fontSize: 13.5, color: c.inkMuted, marginBottom: 14 }}>Ruang chat ini sudah dihapus atau tidak tersedia lagi.</div>
          <button onClick={closeThread} style={{ border: "none", borderRadius: 999, background: accent, color: "#fff", fontFamily: sans, fontWeight: 700, fontSize: 12.5, padding: "9px 20px", cursor: "pointer" }}>
            ← Kembali ke forum
          </button>
        </div>
      </div>
    );
  }

  const rows = [];
  let prevMsg = null;
  for (const m of messages) {
    const newDay = !prevMsg || dayKey(prevMsg.createdAt) !== dayKey(m.createdAt);
    if (newDay) rows.push(<DaySeparator key={`d-${m.id}`} label={dayLabel(m.createdAt)} c={c} sans={sans} />);
    const showHeader = newDay || !prevMsg || prevMsg.author !== m.author || new Date(m.createdAt) - new Date(prevMsg.createdAt) > GROUP_GAP_MS || !!m.replyTo;
    rows.push(
      <MessageBubble
        key={m.id}
        m={m}
        mine={m.author === CURRENT_USER}
        showHeader={showHeader}
        active={activeId === m.id}
        onActive={setActiveId}
        onReply={(x) => {
          setReplyTo(x);
          if (taRef.current) taRef.current.focus();
        }}
        onEdit={(x) => setEditing({ id: x.id, text: x.body === IMAGE_ONLY_BODY ? "" : x.body })}
        onDelete={removeMessage}
        onRetry={retry}
        onDiscard={discard}
        onJump={jumpToMessage}
        editing={editing}
        setEditing={setEditing}
        saveEdit={saveEdit}
        busyEdit={busyEdit}
        c={c}
        sans={sans}
        Avatar={Avatar}
        openProfile={openProfile}
        avatarFor={avatarFor}
        accent={accent}
      />
    );
    prevMsg = m;
  }

  return (
    <div style={{ padding: "0 32px" }}>
      <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 170px)", minHeight: 460, border: `1px solid ${c.line}`, borderRadius: 16, background: c.card, overflow: "hidden" }}>
        {/* header */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: `1px solid ${c.line}` }}>
          <button onClick={closeThread} aria-label="Kembali ke forum" style={{ background: "none", border: "none", cursor: "pointer", fontFamily: sans, fontSize: 18, color: c.inkMuted, padding: "0 4px" }}>
            ←
          </button>
          <div style={{ minWidth: 0, flex: 1, cursor: "pointer" }} onClick={() => setAboutOpen(!aboutOpen)}>
            <div style={{ fontFamily: sans, fontWeight: 700, fontSize: 13.5, color: c.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>💬 {title}</div>
            <div style={{ fontFamily: sans, fontSize: 11, color: c.inkFaint }}>
              dibuka oleh {(room && room.author) || post.author}
              {post.subject ? ` · ${post.subject}` : ""}
            </div>
          </div>
          <span title={live ? "Tersambung real-time" : "Menyambung ulang… pesan tetap diperbarui berkala"} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontFamily: sans, fontSize: 11, fontWeight: 700, color: live ? "#2E9E6B" : "#C9821E" }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: live ? "#2E9E6B" : "#C9821E", display: "inline-block" }} />
            {live ? "Live" : "Menyambung…"}
          </span>
        </div>
        {aboutOpen && (
          <div style={{ padding: "10px 16px", background: c.panel, fontFamily: sans, fontSize: 12.5, color: c.inkMuted, lineHeight: 1.5, whiteSpace: "pre-wrap", maxHeight: 140, overflowY: "auto" }}>{(room && room.body) || post.body}</div>
        )}

        {/* daftar pesan */}
        <div ref={listRef} onScroll={onScroll} style={{ flex: 1, overflowY: "auto", padding: "8px 14px 14px", position: "relative" }}>
          {hasMore && (
            <div style={{ textAlign: "center", margin: "6px 0" }}>
              <button onClick={loadOlder} disabled={loadingOlder} style={{ border: `1px solid ${c.line}`, background: c.card, color: c.blue, borderRadius: 999, fontFamily: sans, fontSize: 11.5, fontWeight: 700, padding: "5px 14px", cursor: "pointer" }}>
                {loadingOlder ? "Memuat…" : "Muat pesan sebelumnya"}
              </button>
            </div>
          )}
          {loading && <div style={{ textAlign: "center", fontFamily: sans, fontSize: 12.5, color: c.inkFaint, padding: 30 }}>Memuat pesan…</div>}
          {loadError && !loading && <div style={{ textAlign: "center", fontFamily: sans, fontSize: 12.5, color: "#D9553A", padding: 20 }}>{loadError}</div>}
          {!loading && !loadError && messages.length === 0 && (
            <div style={{ textAlign: "center", padding: "50px 20px" }}>
              <div style={{ fontSize: 26, marginBottom: 6 }}>👋</div>
              <div style={{ fontFamily: sans, fontSize: 13, color: c.inkMuted }}>Belum ada pesan — jadilah yang pertama menyapa.</div>
            </div>
          )}
          {rows}
        </div>
        {newBelow > 0 && (
          <div style={{ position: "relative", height: 0 }}>
            <button onClick={jumpToBottom} style={{ position: "absolute", right: 18, bottom: 10, border: "none", borderRadius: 999, background: accent, color: "#fff", fontFamily: sans, fontSize: 11.5, fontWeight: 700, padding: "6px 14px", cursor: "pointer", boxShadow: "0 2px 8px rgba(0,0,0,0.18)" }}>
              ↓ {newBelow} pesan baru
            </button>
          </div>
        )}

        {/* penulis pesan */}
        <div style={{ borderTop: `1px solid ${c.line}`, padding: "10px 12px", background: c.card }}>
          {notice && (
            <div style={{ display: "flex", justifyContent: "space-between", fontFamily: sans, fontSize: 11.5, color: "#D9553A", marginBottom: 6 }}>
              <span>{notice}</span>
              <button onClick={() => setNotice("")} style={{ border: "none", background: "none", color: "#D9553A", cursor: "pointer" }}>
                ×
              </button>
            </div>
          )}
          {replyTo && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, background: c.panel, borderLeft: `3px solid ${accent}`, borderRadius: 8, padding: "5px 10px", marginBottom: 8, fontFamily: sans, fontSize: 12, color: c.inkMuted }}>
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                Membalas <b>{replyTo.author}</b>: {replyTo.body === IMAGE_ONLY_BODY ? "gambar" : replyTo.body}
              </span>
              <button onClick={() => setReplyTo(null)} aria-label="Batalkan balasan" style={{ border: "none", background: "none", cursor: "pointer", color: c.inkFaint, fontSize: 14 }}>
                ×
              </button>
            </div>
          )}
          {files.length > 0 && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
              {files.map((f, i) => (
                <div key={f.url} style={{ position: "relative" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={f.url} alt="Pratinjau lampiran" style={{ width: 54, height: 54, objectFit: "cover", borderRadius: 8, display: "block" }} />
                  <button
                    onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
                    aria-label="Hapus lampiran"
                    style={{ position: "absolute", top: -6, right: -6, width: 18, height: 18, borderRadius: "50%", border: "none", background: "#132038", color: "#fff", fontSize: 11, cursor: "pointer", lineHeight: "18px", padding: 0 }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
            <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={onPickFiles} style={{ display: "none" }} />
            <button onClick={() => fileInputRef.current && fileInputRef.current.click()} title="Lampirkan gambar" aria-label="Lampirkan gambar" style={{ border: `1px solid ${c.line}`, background: c.card, borderRadius: 12, width: 40, height: 40, cursor: "pointer", fontSize: 16, flexShrink: 0 }}>
              📎
            </button>
            <textarea
              ref={taRef}
              rows={1}
              value={draft}
              maxLength={MAX_BODY}
              onChange={onDraftChange}
              onKeyDown={onDraftKeyDown}
              placeholder="Tulis pesan…  Enter kirim · Shift+Enter baris baru"
              style={{ flex: 1, minWidth: 0, boxSizing: "border-box", padding: "10px 12px", fontSize: 13.5, fontFamily: sans, borderRadius: 12, border: `1px solid ${c.line}`, background: c.fieldBg, color: c.ink, outline: "none", resize: "none", maxHeight: 120, lineHeight: 1.4 }}
            />
            <button onClick={send} disabled={!canSend} aria-label="Kirim pesan" style={{ border: "none", borderRadius: 12, width: 44, height: 40, background: canSend ? accent : "#B9C3D2", color: "#fff", fontSize: 16, cursor: canSend ? "pointer" : "not-allowed", flexShrink: 0 }}>
              ➤
            </button>
          </div>
          {draft.length > MAX_BODY - 200 && (
            <div style={{ fontFamily: sans, fontSize: 10.5, color: c.inkFaint, textAlign: "right", marginTop: 4 }}>
              {draft.length}/{MAX_BODY}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- pratinjau di daftar forum
export function ChatPreviewStrip({ ctx, p }) {
  const { c, sans, CURRENT_USER } = ctx;
  const chat = p.chat || { count: 0, last: null };
  const seen = getSeen(p.id);
  const unread = !!(chat.last && chat.last.author !== CURRENT_USER && (!seen || chat.last.createdAt > seen));
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 12, background: c.panel, marginBottom: 8, fontFamily: sans, fontSize: 12.5, color: c.inkMuted }}>
      <span style={{ fontSize: 15 }}>💬</span>
      <div style={{ minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {chat.last ? (
          <>
            <b style={{ color: c.ink }}>{chat.last.author}</b>: {chat.last.body}
            <span style={{ color: c.inkFaint }}> · {ago(chat.last.createdAt)}</span>
          </>
        ) : (
          "Belum ada pesan — jadilah yang pertama menyapa."
        )}
      </div>
      <span style={{ flexShrink: 0, fontSize: 11, color: c.inkFaint }}>{chat.count} pesan</span>
      {unread && <span title="Ada pesan baru" style={{ width: 9, height: 9, borderRadius: "50%", background: "#E5484D", flexShrink: 0 }} />}
      <span style={{ flexShrink: 0, fontWeight: 700, color: c.blue }}>Buka chat →</span>
    </div>
  );
}

// ---------------------------------------------------------------- sinkron daftar forum (tanpa tampilan)
// Menyegarkan pratinjau chat saat ada sinyal "forum:feed", dan memuat ulang feed
// ketika ada post baru. Dipasang di ForumSection.
export function ChatFeedSync({ ctx }) {
  const { setLocalPosts, fetchForumFeed } = ctx;
  const live = useRef(false);
  const fns = useRef({});
  fns.current.rooms = async () => {
    const r = await chatApi("/api/forum/chat-rooms");
    if (!r || !r.rooms) return;
    setLocalPosts((prev) => prev.map((p) => (r.rooms[p.id] ? { ...p, chat: r.rooms[p.id] } : p)));
  };
  fns.current.feed = () => fetchForumFeed();

  useEffect(() => {
    let timer = null;
    const pending = new Set();
    const flush = () => {
      const kinds = Array.from(pending);
      pending.clear();
      if (kinds.includes("post")) fns.current.feed();
      else fns.current.rooms().catch(() => {});
    };
    fns.current.rooms().catch(() => {});
    const channel = supabase
      .channel("forum:feed", { config: { broadcast: { self: false } } })
      .on("broadcast", { event: "activity" }, (msg) => {
        pending.add((msg && msg.payload && msg.payload.kind) || "chat");
        clearTimeout(timer);
        timer = setTimeout(flush, 800);
      })
      .subscribe((status) => {
        live.current = status === "SUBSCRIBED";
      });
    const poll = setInterval(() => {
      if (!live.current) fns.current.rooms().catch(() => {});
    }, 30000);
    return () => {
      clearTimeout(timer);
      clearInterval(poll);
      supabase.removeChannel(channel);
    };
  }, []);

  return null;
}

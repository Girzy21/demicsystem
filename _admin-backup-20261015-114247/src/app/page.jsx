"use client";

import React, { useState, useMemo, useRef, useEffect } from "react";
import { supabase } from "@/lib/supabaseClient";
import Homepage from "@/app/components/Homepage";

// ---- Supabase Auth helpers -------------------------------------------------
//
// Supabase Auth is email-based by design — there's no built-in "username
// only" mode. Since the whole point of this app's signup flow is "no real
// name, no email", we generate a DISGUISED email behind the scenes
// (username@EMAIL_DOMAIN) that the user never sees or types. They only ever
// interact with username + password; Supabase just needs *something*
// shaped like an email to authenticate against.
//
// This domain doesn't need to receive real mail — email confirmation is
// switched off in the Supabase dashboard (Authentication > Providers >
// Email > Confirm email), so nothing is ever sent to it.
const EMAIL_DOMAIN = "ekosistem-akademi.internal";
const usernameToEmail = (username) => `${username.trim().toLowerCase()}@${EMAIL_DOMAIN}`;

// Calls the is_username_taken(text) Postgres function (created via the SQL
// update) so we can validate uniqueness at signup time, before the user is
// authenticated — a normal SELECT against profiles isn't allowed pre-login,
// so this narrow RPC is what stands in for that check.
async function isUsernameTaken(username) {
  const { data, error } = await supabase.rpc("is_username_taken", {
    check_username: username.trim().toLowerCase(),
  });
  if (error) {
    // Fail closed on the "unknown" side of caution: if we can't check, don't
    // block signup on it here — real uniqueness is still enforced by the
    // database's `unique` constraint on profiles.username, which will
    // reject the insert and surface as a signup error either way.
    console.error("Gagal memeriksa ketersediaan username:", error);
    return false;
  }
  return data === true;
}

async function signUpWithUsername(username, password) {
  const { data, error } = await supabase.auth.signUp({
    email: usernameToEmail(username),
    password,
    options: {
      // Read by the handle_new_user trigger (via raw_user_meta_data) to set
      // profiles.username to exactly what the user typed, rather than
      // whatever the disguised email's local part happens to be.
      data: { username: username.trim() },
    },
  });
  return { data, error };
}

async function signInWithUsername(username, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: usernameToEmail(username),
    password,
  });
  return { data, error };
}

async function signOutUser() {
  await supabase.auth.signOut();
}


const PALETTES = [
  ["#DCEAFB", "#2C7BE5"],
  ["#E4F0FC", "#1B5FB8"],
  ["#D9E9FB", "#3A8AE0"],
  ["#E8F1FC", "#1F63A8"],
  ["#DFECFB", "#2E76CC"],
];

function hashStr(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function UsernameAvatar({ username, size = 40 }) {
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
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ borderRadius: 9, flexShrink: 0 }} role="img" aria-label={`Avatar untuk ${username}`}>
      <rect width={size} height={size} fill={palette[0]} />
      {cells.map((c, i) => (c.on ? <rect key={i} x={c.x * cellSize} y={c.y * cellSize} width={cellSize} height={cellSize} fill={palette[1]} /> : null))}
    </svg>
  );
}

function PasswordStrength({ password }) {
  const score = useMemo(() => {
    if (!password) return 0;
    let s = 0;
    if (password.length >= 8) s++;
    if (password.length >= 12) s++;
    if (/[0-9]/.test(password)) s++;
    if (/[^a-zA-Z0-9]/.test(password)) s++;
    if (/[a-z]/.test(password) && /[A-Z]/.test(password)) s++;
    return Math.min(s, 4);
  }, [password]);
  const labels = ["Terlalu pendek", "Lemah", "Cukup", "Kuat", "Sangat kuat"];
  const colors = ["#A8B4C4", "#D9704F", "#C99A2E", "#2E9E6B", "#2C7BE5"];
  if (!password) return null;
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: "flex", gap: 4, marginBottom: 4 }}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} style={{ height: 3, flex: 1, borderRadius: 2, background: i < score ? colors[score] : "rgba(10,25,48,0.09)", transition: "background 0.2s" }} />
        ))}
      </div>
      <span style={{ fontSize: 11.5, color: colors[score] }}>{labels[score]}</span>
    </div>
  );
}

// ---- interactive "peeking eye" password field -------------------------------------------------
// Bukan sekadar ikon mata statis: mata SVG ini benar-benar hidup — pupilnya
// "mengintip" ke arah cursor mengetik, berkedip acak, dan saat disembunyikan
// dua kelopak mata menutup dengan animasi spring. Ada juga indikator caps-lock
// dan hitungan karakter yang muncul halus di sisi kanan.
function EyePeekPasswordField({
  id,
  value,
  onChange,
  placeholder,
  autoComplete,
  tone = "#2C7BE5",
  // Optional external control: when provided, the eye button on THIS field
  // drives (and reads) a shared reveal state instead of its own local one —
  // used when one avatar toggle needs to control several fields at once.
  revealed: revealedProp,
  onToggleReveal,
  // When false, this field's own eye button is hidden entirely — used for
  // the signup form, where a single external avatar does the toggling.
  showOwnToggle = true,
}) {
  const isControlled = revealedProp !== undefined;
  const [revealedLocal, setRevealedLocal] = useState(false);
  const revealed = isControlled ? revealedProp : revealedLocal;
  const [focused, setFocused] = useState(false);
  const [capsOn, setCapsOn] = useState(false);
  const [blink, setBlink] = useState(false);
  const inputRef = useRef(null);
  const lastLenRef = useRef(0);

  // Random idle blinking — only while the avatar's eyes are actually open
  // (revealed === true). When hidden, the little hands are covering the
  // eyes, so there's nothing to blink.
  useEffect(() => {
    if (!revealed) return;
    let cancelled = false;
    function scheduleBlink() {
      const delay = 1800 + Math.random() * 2600;
      const t = setTimeout(() => {
        if (cancelled) return;
        setBlink(true);
        setTimeout(() => !cancelled && setBlink(false), 140);
        scheduleBlink();
      }, delay);
      return t;
    }
    const t = scheduleBlink();
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [revealed]);

  function handleKeyEvent(e) {
    if (typeof e.getModifierState === "function") {
      setCapsOn(e.getModifierState("CapsLock"));
    }
  }

  function toggleReveal() {
    if (isControlled) {
      onToggleReveal?.();
    } else {
      setRevealedLocal((r) => !r);
    }
    // keep focus + caret in the field after toggling, rather than jumping to the button
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  const eyeSize = 34;

  return (
    <div style={{ position: "relative" }}>
      <input
        ref={inputRef}
        id={id}
        type={revealed ? "text" : "password"}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        onKeyDown={handleKeyEvent}
        onKeyUp={handleKeyEvent}
        onFocus={(e) => {
          setFocused(true);
          handleKeyEvent(e);
        }}
        onBlur={() => setFocused(false)}
        autoComplete={autoComplete}
        style={{
          width: "100%",
          padding: showOwnToggle ? "12px 50px 12px 14px" : "12px 14px",
          fontSize: 14,
          borderRadius: 999,
          border: `1px solid ${focused ? tone : "rgba(19,32,56,0.12)"}`,
          background: "rgba(19,32,56,0.045)",
          color: "#132038",
          fontFamily: "'Helvetica Neue', Arial, sans-serif",
          boxSizing: "border-box",
          outline: "none",
          transition: "border-color 0.15s",
          letterSpacing: revealed ? 0 : 1.5,
        }}
      />

      {showOwnToggle && (
        <button
          type="button"
          onClick={toggleReveal}
          aria-label={revealed ? "Sembunyikan password" : "Tampilkan password"}
          aria-pressed={revealed}
          title={revealed ? "Sembunyikan" : "Intip password"}
          style={{
            position: "absolute",
            right: 5,
            top: "50%",
            transform: "translateY(-50%)",
            width: eyeSize,
            height: eyeSize,
            borderRadius: "50%",
            border: "none",
            background: revealed ? "rgba(44,123,229,0.12)" : "rgba(19,32,56,0.05)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 0,
            transition: "background 0.2s",
          }}
        >
          <svg width={24} height={24} viewBox="0 0 48 48">
            {/* face outline, monochrome emoji-style — same character as the shared avatar,
                shrunk to fit inside the textbox */}
            <circle cx="24" cy="24" r="19" fill="none" stroke={tone} strokeWidth="2.4" />

            {revealed ? (
              <>
                <g style={{ transition: "transform 0.09s" }} transform={`scale(1, ${blink ? 0.15 : 1})`} transformOrigin="16 21">
                  <circle cx="16" cy="21" r="2.6" fill={tone} />
                </g>
                <g style={{ transition: "transform 0.09s" }} transform={`scale(1, ${blink ? 0.15 : 1})`} transformOrigin="32 21">
                  <circle cx="32" cy="21" r="2.6" fill={tone} />
                </g>
                {/* wide open smile */}
                <path d="M14 29 Q24 37 34 29" fill="none" stroke={tone} strokeWidth="2.6" strokeLinecap="round" />
              </>
            ) : (
              <>
                {/* closed, content squint-smile eyes (^ ^) */}
                <path d="M12 22 Q16 17 20 22" fill="none" stroke={tone} strokeWidth="2.6" strokeLinecap="round" />
                <path d="M28 22 Q32 17 36 22" fill="none" stroke={tone} strokeWidth="2.6" strokeLinecap="round" />
                {/* small closed-lip smile */}
                <path d="M17 30 Q24 34 31 30" fill="none" stroke={tone} strokeWidth="2.4" strokeLinecap="round" />
                {/* two little "hands" peeking up from below, covering toward the eyes */}
                <path d="M6 44 C6 34 10 27 16 25 C20 23.5 22 26 20 29 C17 33 14 38 13 44 Z" fill={tone} opacity="0.9" />
                <path d="M42 44 C42 34 38 27 32 25 C28 23.5 26 26 28 29 C31 33 34 38 35 44 Z" fill={tone} opacity="0.9" />
              </>
            )}
          </svg>
        </button>
      )}

      {/* caret-length dots ghosting behind the eye — a subtle "someone's counting" cue,
          only shown while hidden so it doesn't clutter the revealed plain-text view.
          Only rendered when this field owns its own toggle button to sit next to. */}
      {showOwnToggle && !revealed && value.length > 0 && (
        <div
          style={{
            position: "absolute",
            right: eyeSize + 10,
            top: "50%",
            transform: "translateY(-50%)",
            fontFamily: "'Helvetica Neue', Arial, sans-serif",
            fontSize: 10.5,
            color: "#8C9AB1",
            pointerEvents: "none",
            opacity: focused ? 1 : 0,
            transition: "opacity 0.2s",
          }}
        >
          {value.length}
        </div>
      )}

      {capsOn && (
        <div
          style={{
            marginTop: 6,
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            fontFamily: "'Helvetica Neue', Arial, sans-serif",
            fontSize: 11,
            color: "#B24A30",
            background: "rgba(217,85,58,0.08)",
            border: "1px solid rgba(217,85,58,0.2)",
            borderRadius: 999,
            padding: "3px 10px",
          }}
        >
          ⇪ Caps Lock aktif
        </div>
      )}
    </div>
  );
}

// ---- main component -------------------------------------------------

export default function App() {
  const [dbError, setDbError] = useState("");

  const [mode, setMode] = useState("login"); // login | signup
  const [loggedIn, setLoggedIn] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [checkingSession, setCheckingSession] = useState(true);

  const [suUsername, setSuUsername] = useState("");
  const [suPassword, setSuPassword] = useState("");
  const [suConfirm, setSuConfirm] = useState("");
  const [suErrors, setSuErrors] = useState({});
  const [suSubmitting, setSuSubmitting] = useState(false);
  // Single shared reveal state for BOTH the password and confirm-password
  // fields on the signup form — one avatar toggle controls both at once.
  const [suPasswordsRevealed, setSuPasswordsRevealed] = useState(false);

  const [liUsername, setLiUsername] = useState("");
  const [liPassword, setLiPassword] = useState("");
  const [liError, setLiError] = useState("");
  const [liSubmitting, setLiSubmitting] = useState(false);
  const [keepLoggedIn, setKeepLoggedIn] = useState(false);

  const usernameInputRef = useRef(null);
  useEffect(() => {
    usernameInputRef.current?.focus();
  }, [mode, loggedIn]);

  // Pulls the username back out of a Supabase auth user object. We read it
  // from user_metadata first (set at signup time, see signUpWithUsername) —
  // that's always the exact string the person typed. Falling back to the
  // disguised email's local part covers the edge case where metadata is
  // somehow missing, so the UI still shows *something* reasonable.
  function usernameFromAuthUser(user) {
    if (!user) return null;
    return user.user_metadata?.username || user.email?.split("@")[0] || null;
  }

  // On mount: ask Supabase if this browser already has a valid session (so
  // refreshing the page doesn't log you out), then keep listening for auth
  // changes for as long as this component is mounted — this is what makes
  // login/logout/token-refresh reflect immediately in the UI without a
  // manual page reload.
  useEffect(() => {
    let cancelled = false;

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return;
      if (session?.user) {
        setCurrentUser(usernameFromAuthUser(session.user));
        setLoggedIn(true);
      }
      setCheckingSession(false);
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setCurrentUser(usernameFromAuthUser(session.user));
        setLoggedIn(true);
      } else {
        setCurrentUser(null);
        setLoggedIn(false);
      }
    });

    return () => {
      cancelled = true;
      authListener.subscription.unsubscribe();
    };
  }, []);

  function validateUsernameShape(username) {
    if (!username.trim()) return "Username wajib diisi.";
    if (username.length < 3) return "Username minimal 3 karakter.";
    if (username.length > 20) return "Username maksimal 20 karakter.";
    if (!/^[a-zA-Z0-9_]+$/.test(username)) return "Username hanya boleh huruf, angka, dan underscore.";
    return "";
  }

  function validatePassword(pw) {
    if (!pw) return "Password wajib diisi.";
    if (pw.length < 8) return "Password minimal 8 karakter.";
    return "";
  }

  async function handleSignup(e) {
    e.preventDefault();
    setDbError("");
    const errs = {};
    const shapeErr = validateUsernameShape(suUsername);
    const pwErr = validatePassword(suPassword);
    if (shapeErr) errs.username = shapeErr;
    if (pwErr) errs.password = pwErr;
    if (!pwErr && suPassword !== suConfirm) errs.confirm = "Konfirmasi password tidak cocok.";
    setSuErrors(errs);
    if (Object.keys(errs).length > 0) return;

    setSuSubmitting(true);
    try {
      // Checked right before submitting, same spirit as the old "re-fetch
      // right before writing" — closes most of the race window, though the
      // database's own unique constraint on profiles.username is what
      // actually guarantees no duplicate ever gets committed.
      const taken = await isUsernameTaken(suUsername);
      if (taken) {
        setSuErrors({ username: "Username ini sudah dipakai, coba yang lain." });
        setSuSubmitting(false);
        return;
      }

      const { data, error } = await signUpWithUsername(suUsername, suPassword);
      if (error) {
        // Supabase's own duplicate-account error surfaces here too, as a
        // second line of defense behind the isUsernameTaken check above.
        setDbError(error.message === "User already registered" ? "Username ini sudah dipakai, coba yang lain." : "Gagal membuat akun — coba lagi sebentar lagi.");
        setSuSubmitting(false);
        return;
      }

      // signUp() already establishes a session in most Supabase project
      // configurations (email confirmation switched off, per the setup
      // guide) — but we don't hand-set loggedIn/currentUser here. The
      // onAuthStateChange listener above fires on its own the moment the
      // session is established, and is the single source of truth for
      // that transition, so we just let it happen.
      setSuSubmitting(false);
    } catch (err) {
      setDbError("Gagal membuat akun — coba lagi sebentar lagi.");
      setSuSubmitting(false);
    }
  }

  async function handleLogin(e) {
    e.preventDefault();
    setLiError("");
    setDbError("");
    if (!liUsername.trim() || !liPassword) {
      setLiError("Isi username dan password dulu ya.");
      return;
    }
    setLiSubmitting(true);
    try {
      const { error } = await signInWithUsername(liUsername, liPassword);
      if (error) {
        setLiError("Username atau password salah.");
        setLiSubmitting(false);
        return;
      }
      // Note on "Tetap masuk": Supabase persists the session (via
      // localStorage) by default regardless of this checkbox — there isn't
      // a built-in "session-only, forget on tab close" mode to wire this
      // up against. The checkbox is kept here for the UX you designed, but
      // today it doesn't change actual persistence behavior; logging out
      // (handleLogout) is what clears the session either way.
      setLiSubmitting(false);
      // loggedIn/currentUser are set by the onAuthStateChange listener.
    } catch (err) {
      setLiError("Gagal masuk — coba lagi sebentar lagi.");
      setLiSubmitting(false);
    }
  }

  async function handleLogout() {
    await signOutUser();
    setLiUsername("");
    setLiPassword("");
    setSuPasswordsRevealed(false);
    setMode("login");
    // loggedIn/currentUser are cleared by the onAuthStateChange listener.
  }

  // ---- design tokens (light / white theme) -------------------------------------------------
  const sans = "'Helvetica Neue', Arial, sans-serif";
  const serif = "'Georgia', 'Iowan Old Style', serif";
  const c = {
    outer: "#E7ECF3",
    panelDark: "#F4F6FA",
    panelDarker: "#E9EEF5",
    ink: "#132038",
    inkMuted: "#5B6B84",
    inkFaint: "#8C9AB1",
    blue: "#2C7BE5",
    blueSoft: "#D7E6FA",
    line: "rgba(19,32,56,0.12)",
    fieldBg: "rgba(19,32,56,0.045)",
    danger: "#D9553A",
    white: "#FFFFFF",
  };

  const outerStyle = {
    fontFamily: sans,
    background: `linear-gradient(160deg, #EEF2F7 0%, #E3E9F1 55%, #D8E1EC 100%)`,
    padding: 0,
    margin: 0,
    borderRadius: 0,
    width: "100vw",
    height: "100vh",
    maxHeight: "100dvh",
    display: "flex",
    boxSizing: "border-box",
    overflow: "hidden",
  };

  const cardShell = {
    display: "flex",
    width: "100%",
    height: "100%",
    borderRadius: 0,
    overflow: "hidden",
    boxShadow: "none",
    border: "none",
  };

  const inputStyle = {
    width: "100%",
    padding: "12px 14px",
    fontSize: 14,
    borderRadius: 999,
    border: `1px solid ${c.line}`,
    background: c.fieldBg,
    color: c.ink,
    fontFamily: sans,
    boxSizing: "border-box",
    outline: "none",
  };

  const labelStyle = {
    display: "block",
    fontSize: 12,
    fontFamily: sans,
    color: c.inkMuted,
    marginBottom: 6,
    fontWeight: 500,
  };

  const errorStyle = { color: c.danger, fontSize: 12, marginTop: 5, fontFamily: sans };

  const primaryBtn = (disabled) => ({
    width: "100%",
    padding: "13px 16px",
    fontSize: 14.5,
    fontFamily: sans,
    fontWeight: 700,
    borderRadius: 999,
    border: "none",
    background: disabled ? "#B7C6DC" : `linear-gradient(90deg, #2C7BE5 0%, #5AA8F5 100%)`,
    color: "#FFFFFF",
    cursor: disabled ? "default" : "pointer",
    letterSpacing: 0.2,
  });

  const tabBtn = (active) => ({
    flex: 1,
    padding: "9px 0",
    fontSize: 12.5,
    fontFamily: sans,
    fontWeight: 700,
    borderRadius: 999,
    border: "none",
    background: active ? "#FFFFFF" : "transparent",
    color: active ? c.blue : c.inkFaint,
    boxShadow: active ? "0 1px 4px rgba(19,32,56,0.12)" : "none",
    cursor: "pointer",
    letterSpacing: 0.3,
  });

  // ---- shared left brand mark -------------------------------------------------
  const BrandMark = () => (
    <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 34 }}>
      <div
        style={{
          width: 30,
          height: 30,
          borderRadius: 8,
          background: `linear-gradient(135deg, #2C7BE5, #6FB3E8)`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 800,
          color: "#fff",
          fontSize: 13,
        }}
      >
        ?
      </div>
      <span style={{ fontFamily: sans, fontWeight: 700, color: c.ink, fontSize: 14, letterSpacing: 0.2 }}>
        [Nama Website] <span style={{ opacity: 0.45, fontWeight: 400 }}>· placeholder</span>
      </span>
    </div>
  );

  // ================= INITIAL LOAD (checking Supabase for an existing session) =================
  if (checkingSession) {
    return (
      <div style={outerStyle}>
        <div style={{ ...cardShell, background: c.panelDark, alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12 }}>
          <div
            style={{
              width: 30,
              height: 30,
              borderRadius: 8,
              background: `linear-gradient(135deg, #2C7BE5, #6FB3E8)`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 800,
              color: "#fff",
              fontSize: 13,
              animation: "pulse 1.4s ease-in-out infinite",
            }}
          >
            ?
          </div>
          <span style={{ fontFamily: sans, fontSize: 12.5, color: c.inkMuted }}>Memuat...</span>
          <style>{`@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }`}</style>
        </div>
      </div>
    );
  }

  // ================= LOGGED IN STATE =================
  // Once authenticated, hand off to the real app (Bank Modul, Forum,
  // Profil, etc.) instead of the placeholder feature-preview cards this
  // branch used to render. handleLogout is passed through so the "Keluar"
  // affordance living inside Homepage's own sidebar can trigger it.
  if (loggedIn) {
    return <Homepage currentUsername={currentUser} onLogout={handleLogout} />;
  }

  // ================= LOGIN / SIGNUP SPLIT SCREEN =================
  return (
    <div style={outerStyle}>
      <div style={cardShell}>
        {/* LEFT: form panel */}
        <div style={{ background: c.panelDark, flex: "0 0 46%", padding: "48px 40px", display: "flex", flexDirection: "column", justifyContent: "center", overflowY: "auto" }}>
          <div>
          <BrandMark />

          <div style={{ display: "flex", gap: 4, background: "rgba(19,32,56,0.045)", borderRadius: 999, padding: 4, marginBottom: 26, width: 200 }}>
            <button style={tabBtn(mode === "login")} onClick={() => setMode("login")}>Masuk</button>
            <button style={tabBtn(mode === "signup")} onClick={() => setMode("signup")}>Daftar</button>
          </div>

          {mode === "login" ? (
            <>
              <h1 style={{ fontFamily: serif, fontSize: 26, color: c.ink, margin: "0 0 6px" }}>Selamat datang kembali</h1>
              <p style={{ fontFamily: sans, color: c.inkMuted, fontSize: 13, margin: "0 0 26px" }}>
                Masuk pakai username dan password. Tanpa nama asli, tanpa email.
              </p>

              <form onSubmit={handleLogin}>
                <div style={{ marginBottom: 16 }}>
                  <label style={labelStyle} htmlFor="li-username">Username</label>
                  <input ref={usernameInputRef} id="li-username" style={inputStyle} type="text" placeholder="mis. kuncipas" value={liUsername} onChange={(e) => setLiUsername(e.target.value)} autoComplete="username" />
                </div>
                <div style={{ marginBottom: 10 }}>
                  <label style={labelStyle} htmlFor="li-password">Password</label>
                  <EyePeekPasswordField id="li-password" placeholder="••••••••" value={liPassword} onChange={(e) => setLiPassword(e.target.value)} autoComplete="current-password" tone={c.blue} />
                </div>

                {liError && <div style={errorStyle}>{liError}</div>}
                {dbError && <div style={errorStyle}>{dbError}</div>}

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "14px 0 22px" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 7, fontFamily: sans, fontSize: 12, color: c.inkMuted, cursor: "pointer" }}>
                    <input type="checkbox" checked={keepLoggedIn} onChange={(e) => setKeepLoggedIn(e.target.checked)} style={{ accentColor: c.blue }} />
                    Tetap masuk
                  </label>
                </div>

                <button type="submit" style={primaryBtn(liSubmitting)} disabled={liSubmitting}>
                  {liSubmitting ? "Memeriksa..." : "Masuk"}
                </button>
              </form>

              <div style={{ marginTop: 16, padding: "10px 13px", background: c.blueSoft, borderRadius: 10, fontFamily: sans, fontSize: 11.5, color: c.inkMuted, border: `1px solid rgba(44,123,229,0.2)` }}>
                Coba demo: username <strong style={{ color: c.ink }}>kuncipas</strong>, password <strong style={{ color: c.ink }}>demo123</strong>
              </div>
            </>
          ) : (
            <>
              <h1 style={{ fontFamily: serif, fontSize: 26, color: c.ink, margin: "0 0 6px" }}>Buat akun anonim</h1>
              <p style={{ fontFamily: sans, color: c.inkMuted, fontSize: 13, margin: "0 0 24px" }}>
                Sekali pilih username, permanen — pilih baik-baik.
              </p>

              <form onSubmit={handleSignup}>
                <div style={{ marginBottom: 14 }}>
                  <label style={labelStyle} htmlFor="su-username">Username</label>
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <input ref={usernameInputRef} id="su-username" style={{ ...inputStyle, flex: 1 }} type="text" placeholder="3-20 karakter" value={suUsername} onChange={(e) => setSuUsername(e.target.value)} autoComplete="off" />
                    {suUsername && <UsernameAvatar username={suUsername} size={38} />}
                  </div>
                  {suErrors.username && <div style={errorStyle}>{suErrors.username}</div>}
                </div>

                <div style={{ marginBottom: 14 }}>
                  <label style={labelStyle} htmlFor="su-password">Password</label>
                  <EyePeekPasswordField
                    id="su-password"
                    placeholder="Minimal 8 karakter"
                    value={suPassword}
                    onChange={(e) => setSuPassword(e.target.value)}
                    autoComplete="new-password"
                    tone={c.blue}
                    showOwnToggle
                    revealed={suPasswordsRevealed}
                    onToggleReveal={() => setSuPasswordsRevealed((r) => !r)}
                  />
                  <PasswordStrength password={suPassword} />
                  {suErrors.password && <div style={errorStyle}>{suErrors.password}</div>}
                </div>

                <div style={{ marginBottom: 8 }}>
                  <label style={labelStyle} htmlFor="su-confirm">Konfirmasi password</label>
                  {/* no toggle of its own — it mirrors the reveal state driven by the
                      Password field above, so one button controls both textboxes */}
                  <EyePeekPasswordField
                    id="su-confirm"
                    placeholder="Ulangi password"
                    value={suConfirm}
                    onChange={(e) => setSuConfirm(e.target.value)}
                    autoComplete="new-password"
                    tone={c.blue}
                    showOwnToggle={false}
                    revealed={suPasswordsRevealed}
                  />
                  {suErrors.confirm && <div style={errorStyle}>{suErrors.confirm}</div>}
                </div>

                {dbError && <div style={errorStyle}>{dbError}</div>}

                <div style={{ marginTop: 14, marginBottom: 18, padding: "10px 13px", background: "rgba(217,85,58,0.07)", borderRadius: 10, fontFamily: sans, fontSize: 11, color: "#B24A30", border: "1px solid rgba(217,85,58,0.18)" }}>
                  ⚠️ Username tidak bisa diganti setelah dibuat. Jangan pakai nama asli.
                </div>

                <button type="submit" style={primaryBtn(suSubmitting)} disabled={suSubmitting}>
                  {suSubmitting ? "Membuat akun..." : "Buat akun"}
                </button>
              </form>
            </>
          )}
          </div>
        </div>

        {/* RIGHT: visual / video slot panel */}
        <div style={{ background: c.panelDarker, flex: "1", position: "relative", padding: 28, display: "flex", flexDirection: "column" }}>
          {/* Video placeholder area — replace this block with a <video> tag manually */}
          <div
            style={{
              flex: 1,
              borderRadius: 16,
              background: `linear-gradient(135deg, #EAF2FC 0%, #DCEAFB 40%, #C9E0FA 100%)`,
              position: "relative",
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              padding: 26,
            }}
          >
            {/* decorative glow accents, in place of a real video/image */}
            <div style={{ position: "absolute", top: -60, right: -60, width: 220, height: 220, borderRadius: "50%", background: "radial-gradient(circle, rgba(44,123,229,0.18), transparent 70%)" }} />
            <div style={{ position: "absolute", bottom: -80, left: -40, width: 260, height: 260, borderRadius: "50%", background: "radial-gradient(circle, rgba(44,123,229,0.14), transparent 70%)" }} />

            <div style={{ position: "relative", zIndex: 1 }}>
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  background: "rgba(255,255,255,0.75)",
                  border: "1px solid rgba(19,32,56,0.12)",
                  borderRadius: 999,
                  padding: "5px 12px",
                  fontFamily: sans,
                  fontSize: 11,
                  color: c.ink,
                  marginBottom: 16,
                }}
              >
                ▶ Slot video
              </div>
              <h2 style={{ fontFamily: serif, fontSize: 26, color: c.ink, margin: "0 0 8px", lineHeight: 1.25 }}>
                Belajar bareng, tanpa canggung.
              </h2>
              <p style={{ fontFamily: sans, fontSize: 13, color: "rgba(19,32,56,0.65)", maxWidth: 320, lineHeight: 1.6 }}>
                Ganti area ini dengan tag <code style={{ background: "rgba(19,32,56,0.08)", padding: "1px 5px", borderRadius: 4 }}>&lt;video&gt;</code> kamu nanti — sekarang masih placeholder visual.
              </p>
            </div>

            <div style={{ position: "relative", zIndex: 1, display: "flex", gap: 10 }}>
              <div style={{ width: 38, height: 38, borderRadius: "50%", background: "rgba(255,255,255,0.75)", display: "flex", alignItems: "center", justifyContent: "center", color: c.ink, fontSize: 16, cursor: "pointer" }}>
                ‹
              </div>
              <div style={{ width: 38, height: 38, borderRadius: "50%", background: c.blue, display: "flex", alignItems: "center", justifyContent: "center", color: c.white, fontSize: 16, cursor: "pointer" }}>
                ›
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
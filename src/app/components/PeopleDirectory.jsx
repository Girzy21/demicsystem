// src/app/components/PeopleDirectory.jsx
//
// Menu "People": direktori semua profil di sekolah, mirip jejaring sosial —
// kartu profil dengan foto, headline, minat, skill, fokus belajar, dan angka
// kontribusi (modul / post / balasan). Klik kartu untuk membuka profil lengkap.
//
// Semua data berasal dari state yang SUDAH dimuat Homepage (profilesByUsername
// dari /api/profiles, plus modul/post/balasan), jadi tidak ada API baru.
// Privasi mengikuti aturan yang ada: nama asli hanya muncul kalau pemiliknya
// mengaktifkan "show real name" (sudah disaring oleh /api/profiles).
//
// Didefinisikan di module scope (bukan di dalam Homepage) supaya kolom
// pencarian tidak kehilangan fokus saat render ulang. Dipakai dari Homepage
// lewat <PeopleDirectory ctx={ctx} />.

import React, { useMemo, useState } from "react";

const PAGE_SIZE = 24;

function FallbackAvatar({ username, size = 52, photoUrl = null }) {
  if (photoUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={photoUrl} alt={`Foto profil ${username}`} width={size} height={size} style={{ borderRadius: "50%", objectFit: "cover", display: "block" }} />;
  }
  return (
    <div style={{ width: size, height: size, borderRadius: "50%", background: "#D7E6FA", color: "#2C7BE5", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: size * 0.4 }}>
      {String(username || "?").charAt(0).toUpperCase()}
    </div>
  );
}

const norm = (s) => String(s || "").trim().toLowerCase();

function Pill({ children, bg, fg, sans }) {
  return (
    <span style={{ fontFamily: sans, fontSize: 11, fontWeight: 600, padding: "3px 9px", borderRadius: 99, background: bg, color: fg, whiteSpace: "nowrap" }}>
      {children}
    </span>
  );
}

function Stat({ value, label, c, sans }) {
  return (
    <div style={{ textAlign: "center", flex: 1 }}>
      <div style={{ fontFamily: sans, fontWeight: 700, fontSize: 15, color: c.ink }}>{value}</div>
      <div style={{ fontFamily: sans, fontSize: 10.5, color: c.inkFaint }}>{label}</div>
    </div>
  );
}

function PersonCard({ person, stats, isSelf, onOpen, c, sans, Avatar }) {
  const interests = person.interests || [];
  const skills = person.skills || [];
  const focus = person.focus && person.focus.subject ? person.focus : null;
  const shownInterests = interests.slice(0, 3);
  const shownSkills = skills.slice(0, 2);
  const extra = interests.length - shownInterests.length + (skills.length - shownSkills.length);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      style={{ background: c.card, border: `1px solid ${c.line}`, borderRadius: 16, padding: 16, cursor: "pointer", display: "flex", flexDirection: "column", gap: 12, boxShadow: "0 1px 2px rgba(19,32,56,0.04)" }}
    >
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <div style={{ flexShrink: 0 }}>
          <Avatar username={person.username} size={52} photoUrl={person.photoUrl} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontFamily: sans, fontWeight: 700, fontSize: 14.5, color: c.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{person.username}</span>
            {isSelf && (
              <Pill bg={c.blueSoft} fg={c.blue} sans={sans}>
                You
              </Pill>
            )}
          </div>
          {person.realName && <div style={{ fontFamily: sans, fontSize: 12, color: c.inkMuted }}>{person.realName}</div>}
        </div>
      </div>

      <div style={{ fontFamily: sans, fontSize: 12.5, color: person.headline ? c.inkMuted : c.inkFaint, minHeight: 34, lineHeight: 1.4, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
        {person.headline || "No headline yet."}
      </div>

      {(shownInterests.length > 0 || shownSkills.length > 0) && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
          {shownInterests.map((t) => (
            <Pill key={`i-${t}`} bg={c.blueSoft} fg={c.blue} sans={sans}>
              {t}
            </Pill>
          ))}
          {shownSkills.map((t) => (
            <Pill key={`s-${t}`} bg={c.panel} fg={c.inkMuted} sans={sans}>
              {t}
            </Pill>
          ))}
          {extra > 0 && (
            <Pill bg="transparent" fg={c.inkFaint} sans={sans}>
              +{extra}
            </Pill>
          )}
        </div>
      )}

      {focus && (
        <div style={{ fontFamily: sans, fontSize: 11.5, color: c.inkFaint }}>
          Focus: <span style={{ color: c.inkMuted }}>{focus.subject}{focus.topic ? ` · ${focus.topic}` : ""}</span>
        </div>
      )}

      <div style={{ display: "flex", borderTop: `1px solid ${c.line}`, paddingTop: 10, marginTop: "auto" }}>
        <Stat value={stats.modules} label="Modules" c={c} sans={sans} />
        <Stat value={stats.posts} label="Posts" c={c} sans={sans} />
        <Stat value={stats.replies} label="Replies" c={c} sans={sans} />
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", fontFamily: sans, fontSize: 11, color: c.inkFaint }}>
        <span style={{ color: c.blue, fontWeight: 600 }}>View profile →</span>
      </div>
    </div>
  );
}

export default function PeopleDirectory({ ctx }) {
  const { c, sans, inputStyle, CURRENT_USER, myProfile, profilesByUsername, localModules, localPosts, localReplies, openProfile } = ctx;
  const Avatar = ctx.UsernameAvatar || FallbackAvatar;

  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("active");
  const [interest, setInterest] = useState("");
  const [subject, setSubject] = useState("");
  const [visible, setVisible] = useState(PAGE_SIZE);

  const statsByUser = useMemo(() => {
    const s = {};
    const bump = (name, key) => {
      if (!name) return;
      if (!s[name]) s[name] = { modules: 0, posts: 0, replies: 0 };
      s[name][key] += 1;
    };
    for (const m of localModules || []) bump(m && m.uploader, "modules");
    for (const p of localPosts || []) bump(p && p.author, "posts");
    const replyList = Array.isArray(localReplies) ? localReplies : Object.values(localReplies || {}).flat();
    for (const r of replyList) bump(r && r.author, "replies");
    return s;
  }, [localModules, localPosts, localReplies]);

  const people = useMemo(() => {
    const map = { ...(profilesByUsername || {}) };
    if (myProfile && myProfile.username) map[myProfile.username] = { ...(map[myProfile.username] || {}), ...myProfile };
    return Object.values(map).filter((p) => p && p.username);
  }, [profilesByUsername, myProfile]);

  const topInterests = useMemo(() => {
    const freq = new Map();
    for (const p of people) {
      for (const t of [...(p.interests || []), ...(p.skills || [])]) {
        const k = norm(t);
        if (!k) continue;
        const cur = freq.get(k) || { label: t, n: 0 };
        cur.n += 1;
        freq.set(k, cur);
      }
    }
    return Array.from(freq.values()).sort((a, b) => b.n - a.n || a.label.localeCompare(b.label)).slice(0, 12);
  }, [people]);

  const subjects = useMemo(() => Array.from(new Set(people.map((p) => p.focus && p.focus.subject).filter(Boolean))).sort(), [people]);

  const list = useMemo(() => {
    const q = norm(query);
    const activity = (p) => {
      const s = statsByUser[p.username];
      return s ? s.modules * 3 + s.posts * 2 + s.replies : 0;
    };
    const filtered = people.filter((p) => {
      if (interest && ![...(p.interests || []), ...(p.skills || [])].some((t) => norm(t) === interest)) return false;
      if (subject && !(p.focus && p.focus.subject === subject)) return false;
      if (!q) return true;
      const hay = [p.username, p.realName, p.headline, p.focus && p.focus.subject, p.focus && p.focus.topic, ...(p.interests || []), ...(p.skills || [])].map(norm).join(" ");
      return hay.includes(q);
    });
    filtered.sort((a, b) => (sort === "az" ? a.username.localeCompare(b.username) : activity(b) - activity(a) || a.username.localeCompare(b.username)));
    return filtered;
  }, [people, statsByUser, query, sort, interest, subject]);

  const empty = { modules: 0, posts: 0, replies: 0 };
  const selectStyle = { ...inputStyle, width: "auto", cursor: "pointer" };

  return (
    <div style={{ padding: "0 32px" }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <div style={{ position: "relative", flex: "1 1 260px", minWidth: 200 }}>
          <span style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", color: c.inkFaint, fontSize: 13 }}>⌕</span>
          <input
            style={inputStyle}
            type="text"
            placeholder="Search people by name, interest, or skill..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setVisible(PAGE_SIZE);
            }}
          />
        </div>
        <select
          style={selectStyle}
          value={subject}
          onChange={(e) => {
            setSubject(e.target.value);
            setVisible(PAGE_SIZE);
          }}
          aria-label="Filter by focus subject"
        >
          <option value="">All focus subjects</option>
          {subjects.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select style={selectStyle} value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort people">
          <option value="active">Most active</option>
          <option value="az">A – Z</option>
        </select>
      </div>

      {topInterests.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
          {topInterests.map((t) => {
            const key = norm(t.label);
            const on = interest === key;
            return (
              <button
                key={key}
                onClick={() => {
                  setInterest(on ? "" : key);
                  setVisible(PAGE_SIZE);
                }}
                style={{ fontFamily: sans, fontSize: 12, fontWeight: 600, padding: "5px 12px", borderRadius: 99, border: `1px solid ${on ? c.blue : c.line}`, background: on ? c.blueSoft : c.card, color: on ? c.blue : c.inkMuted, cursor: "pointer" }}
              >
                {t.label} · {t.n}
              </button>
            );
          })}
        </div>
      )}

      <div style={{ fontFamily: sans, fontSize: 12, color: c.inkFaint, marginBottom: 10 }}>
        {list.length} {list.length === 1 ? "person" : "people"}
      </div>

      {list.length === 0 ? (
        <div style={{ fontFamily: sans, fontSize: 13.5, color: c.inkMuted, padding: "40px 0", textAlign: "center" }}>No one matches your search.</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14 }}>
          {list.slice(0, visible).map((p) => (
            <PersonCard key={p.username} person={p} stats={statsByUser[p.username] || empty} isSelf={p.username === CURRENT_USER} onOpen={() => openProfile(p.username)} c={c} sans={sans} Avatar={Avatar} />
          ))}
        </div>
      )}

      {list.length > visible && (
        <div style={{ textAlign: "center", marginTop: 18 }}>
          <button
            onClick={() => setVisible(visible + PAGE_SIZE)}
            style={{ fontFamily: sans, fontSize: 13, fontWeight: 600, padding: "9px 20px", borderRadius: 10, border: `1px solid ${c.line}`, background: c.card, color: c.blue, cursor: "pointer" }}
          >
            Show more
          </button>
        </div>
      )}
    </div>
  );
}

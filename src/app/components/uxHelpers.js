// src/app/components/uxHelpers.js
//
// "Enter = kirim, Shift+Enter = baris baru" untuk kotak teks, dan "Enter di kolom
// satu-baris = kirim" untuk form. Tidak pernah bereaksi saat sedang mengetik dengan
// IME (mis. aksara Jepang/Mandarin), supaya Enter untuk memilih huruf tidak
// mengirim pesan.

export function isPlainEnter(e) {
  return e.key === "Enter" && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey && !(e.nativeEvent && e.nativeEvent.isComposing) && e.keyCode !== 229;
}

// Cari tombol kirim (button[data-send]) terdekat di sekitar elemen.
function findSendButton(start) {
  let el = start;
  for (let i = 0; i < 10 && el; i += 1) {
    el = el.parentElement;
    if (!el) break;
    const btn = el.querySelector("button[data-send]");
    if (btn) return btn;
  }
  return null;
}

// Pasang di <textarea onKeyDown={sendOnEnter}>; tombol kirim diberi data-send="1".
export function sendOnEnter(e) {
  if (!isPlainEnter(e)) return;
  e.preventDefault();
  const btn = findSendButton(e.currentTarget);
  if (btn && !btn.disabled) btn.click();
}

// Pasang di elemen induk sebuah form: <div onKeyDown={sendOnEnterInput}>.
// Enter pada <input> teks satu baris menekan tombol button[data-send] di dalamnya.
// Kotak teks multi-baris (<textarea>) tidak terpengaruh; kolom yang sudah
// menangani Enter sendiri (preventDefault) dibiarkan.
export function sendOnEnterInput(e) {
  if (!isPlainEnter(e) || e.defaultPrevented) return;
  const t = e.target;
  if (!t || t.tagName !== "INPUT") return;
  if (!["text", "url", "search", "email", "number", ""].includes(t.type || "")) return;
  const btn = e.currentTarget.querySelector("button[data-send]");
  if (!btn) return;
  e.preventDefault();
  if (!btn.disabled) btn.click();
}

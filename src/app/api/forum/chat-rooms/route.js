// GET /api/forum/chat-rooms
// Ringkasan ringan semua ruang chat (jumlah pesan + pesan terakhir). Dipakai
// daftar forum untuk menyegarkan pratinjau saat ada sinyal real-time, tanpa
// memuat ulang seluruh feed.
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireUser } from "@/lib/adminAuth";
import { getChatSummaries } from "@/lib/chatSummary";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const u = await requireUser(request);
  if (u.error) return u.error;
  try {
    const { data, error } = await supabaseAdmin.from("posts").select("id").eq("post_type", "diskusi").order("created_at", { ascending: false }).limit(300);
    if (error) return NextResponse.json({ error: "Gagal mengambil ruang chat." }, { status: 500 });
    const rooms = await getChatSummaries((data || []).map((p) => p.id));
    return NextResponse.json({ rooms });
  } catch (err) {
    console.error("Gagal memproses ruang chat:", err);
    return NextResponse.json({ error: "Gagal mengambil ruang chat." }, { status: 500 });
  }
}

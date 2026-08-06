// ============================================================
//  Кебабця · Таємний покупець — Edge Function "api"
//  Доступ: адмін — за Telegram (таблиця shoppers, is_admin);
//          покупець — за одноразовим кодом (assignments.code).
//  Секрет BOT_TOKEN — у Supabase → Edge Functions → Secrets.
//  service_role має grant-и на public (див. db/grants.sql).
// ============================================================
import { createClient } from "jsr:@supabase/supabase-js@2";

const BOT_TOKEN = (Deno.env.get("BOT_TOKEN") ?? "").trim();
const db = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });

async function hmac(keyData, msg) {
  const key = await crypto.subtle.importKey("raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg)));
}
const toHex = (u) => [...u].map((b) => b.toString(16).padStart(2, "0")).join("");

async function verify(initData) {
  if (!initData || !BOT_TOKEN) return null;
  const p = new URLSearchParams(initData);
  const hash = p.get("hash") || "";
  const pA = new URLSearchParams(initData); pA.delete("hash"); pA.delete("signature");
  const dcsA = [...pA.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n");
  const pB = new URLSearchParams(initData); pB.delete("hash");
  const dcsB = [...pB.entries()].map(([k, v]) => `${k}=${v}`).sort().join("\n");
  const secret = await hmac(new TextEncoder().encode("WebAppData"), BOT_TOKEN);
  const ok = (toHex(await hmac(secret, dcsA)) === hash) || (toHex(await hmac(secret, dcsB)) === hash);
  if (!ok) return null;
  try { return JSON.parse(p.get("user")); } catch { return null; }
}

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function genCode(n = 6) { let s = ""; for (const b of crypto.getRandomValues(new Uint8Array(n))) s += ALPHABET[b % ALPHABET.length]; return s; }
const curPeriod = () => new Date().toISOString().slice(0, 7);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { action, initData, payload } = await req.json();
    const tgUser = await verify(initData);
    if (!tgUser) return json({ authorized: false, reason: "bad_init" }, 401);
    const name = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(" ") || tgUser.username || String(tgUser.id);
    const { data: adminRow } = await db.from("shoppers").select("is_admin").eq("telegram_id", tgUser.id).eq("active", true).maybeSingle();
    const isAdmin = adminRow?.is_admin === true;

    if (action === "me") {
      if (isAdmin) {
        const { data: locations } = await db.from("locations").select("id, name").eq("active", true).order("name");
        return json({ authorized: true, is_admin: true, locations: locations ?? [] });
      }
      return json({ authorized: true, is_admin: false });
    }

    if (action === "redeem_code") {
      const code = String(payload?.code ?? "").trim().toUpperCase();
      if (!code) return json({ ok: false, error: "empty" });
      const { data: asg } = await db.from("assignments")
        .select("id, location_id, period, status, locations(name)").eq("code", code).maybeSingle();
      if (!asg) return json({ ok: false, error: "not_found" });
      if (asg.status !== "open") return json({ ok: false, error: "used" });
      return json({ ok: true, assignment: { id: asg.id, location_id: asg.location_id, period: asg.period, location_name: asg.locations?.name } });
    }

    if (action === "submit") {
      const p = payload ?? {};
      const { data: asg } = await db.from("assignments").select("*").eq("id", p.assignment_id).maybeSingle();
      if (!asg) return json({ ok: false, error: "no_assignment" }, 403);
      if (asg.status !== "open") return json({ ok: false, error: "already_done" }, 409);

      // Завантажити фото (base64 data URL) у сховище, зберегти шляхи
      let photoPaths: Record<string, string> | null = null;
      if (p.photos && typeof p.photos === "object") {
        photoPaths = {};
        for (const [slot, dataUrl] of Object.entries(p.photos)) {
          if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:")) continue;
          const b64 = dataUrl.split(",")[1] || "";
          const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
          const path = `${asg.id}/${slot}_${Date.now()}.jpg`;
          const { error: upErr } = await db.storage.from("photos").upload(path, bytes, { contentType: "image/jpeg", upsert: true });
          if (!upErr) photoPaths[slot] = path;
        }
      }

      const { error } = await db.from("reports").insert({
        assignment_id: asg.id, shopper_id: tgUser.id, shopper_name: name,
        location_id: p.location_id ?? asg.location_id, location_name: p.location_name,
        period: p.period ?? asg.period, answers: p.answers,
        score_pct: p.score_pct, score_earned: p.score_earned, score_max: p.score_max,
        section_scores: p.section_scores, photos: photoPaths,
      });
      if (error) return json({ ok: false, error: error.message }, 500);
      await db.from("assignments").update({ status: "done", shopper_id: tgUser.id, used_at: new Date().toISOString() }).eq("id", asg.id);

      // Повідомлення покупцю в чат після здачі
      try {
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({
            chat_id: tgUser.id, parse_mode: "HTML",
            text: "✅ <b>Дякуємо! Ваш звіт прийнято.</b>\n\nЩоб отримати бонуси — напишіть менеджеру, з яким ви спілкувались, і повідомте, що заповнили анкету таємного покупця.\n\nДякуємо, що допомагаєте Кебабці ставати кращою! 🧡",
          }),
        });
      } catch (_) { /* не критично */ }

      return json({ ok: true });
    }

    if (action === "admin_reports") {
      if (!isAdmin) return json({ error: "forbidden" }, 403);
      const { data: reports } = await db.from("reports")
        .select("id, location_name, period, score_pct, score_earned, score_max, section_scores, answers, photos, shopper_name, created_at")
        .order("created_at", { ascending: false });
      // Підписані URL для перегляду фото (сховище приватне)
      for (const r of (reports ?? [])) {
        if (r.photos && typeof r.photos === "object") {
          const signed: Record<string, string> = {};
          for (const [slot, path] of Object.entries(r.photos)) {
            const { data: s } = await db.storage.from("photos").createSignedUrl(path as string, 3600);
            if (s?.signedUrl) signed[slot] = s.signedUrl;
          }
          r.photos = signed;
        }
      }
      return json({ reports: reports ?? [] });
    }

    if (action === "generate_code") {
      if (!isAdmin) return json({ error: "forbidden" }, 403);
      const location_id = payload?.location_id;
      if (!location_id) return json({ ok: false, error: "no_location" });
      const period = String(payload?.period || "").trim() || curPeriod();
      const { data: loc } = await db.from("locations").select("name").eq("id", location_id).maybeSingle();
      let code = "";
      for (let i = 0; i < 5; i++) {
        const c = genCode(6);
        const { error } = await db.from("assignments").insert({ location_id, period, code: c, status: "open" });
        if (!error) { code = c; break; }
      }
      if (!code) return json({ ok: false, error: "gen_failed" });
      return json({ ok: true, code, location_name: loc?.name, period });
    }

    return json({ error: "unknown_action" }, 400);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

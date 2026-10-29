// ============================================================
//  Кебабця · Таємний покупець — Edge Function "api"
//  Доступ: адмін — за Telegram (таблиця shoppers, is_admin);
//          новий адмін — за запрошенням (admin_invites.code, бот /start CODE);
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
const INVITE_DAYS = 7; // скільки діє запрошення (так само в боті)

const APP_URL = "https://kebabtsiaua-prog.github.io/kebabtsia-mystery-shopper/";
const tgCall = (method, body) => fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
}).catch(() => null);
const escT = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const cut = (s, n = 140) => { s = String(s ?? "").trim().replace(/\s+/g, " "); return s.length > n ? s.slice(0, n - 1) + "…" : s; };

// Питання після входу за запрошенням (кнопки обробляє бот: callback notify:1 / notify:0)
const NOTIFY_QUESTION = {
  text: "🔔 <b>Надсилати вам сповіщення, коли на якійсь із наших точок таємний покупець пройде перевірку?</b>\n\n" +
    "Щойно покупець здасть звіт, я напишу вам: яка точка, яка оцінка у відсотках і коротко, що сподобалось і що ні.",
  reply_markup: { inline_keyboard: [[
    { text: "✅ Так, надсилати", callback_data: "notify:1" },
    { text: "Ні, не треба", callback_data: "notify:0" },
  ]] },
};

const MONTHS = ["", "січень", "лютий", "березень", "квітень", "травень", "червень", "липень", "серпень", "вересень", "жовтень", "листопад", "грудень"];
const MONTHS_GEN = ["", "січня", "лютого", "березня", "квітня", "травня", "червня", "липня", "серпня", "вересня", "жовтня", "листопада", "грудня"];
const SECTION_TITLES = {
  reception: "Прийом замовлення", payout: "Розрахунок і видача", quality: "Якість страв",
  staff: "Персонал", clean: "Чистота та атмосфера",
};

// Сповіщення адмінам (shoppers.notify = true) про щойно зданий звіт
async function notifyAdmins(r) {
  const { data: admins } = await db.from("shoppers").select("telegram_id")
    .eq("is_admin", true).eq("active", true).eq("notify", true);
  if (!admins?.length) return;
  const pct = Math.round(Number(r.score_pct) || 0);
  const dot = pct >= 85 ? "🟢" : pct >= 70 ? "🟡" : "🔴";
  const m = Number(String(r.period || "").split("-")[1]) || 0;
  let delta = "";
  const { data: prev } = await db.from("reports").select("score_pct, period")
    .eq("location_name", r.location_name).lt("period", r.period).order("period", { ascending: false }).limit(1).maybeSingle();
  if (prev) {
    const d = pct - Math.round(Number(prev.score_pct) || 0);
    const pm = Number(String(prev.period).split("-")[1]) || 0;
    delta = ` · ${d > 0 ? "▲ +" + d + "%" : d < 0 ? "▼ " + d + "%" : "без змін"} до ${MONTHS_GEN[pm]}`;
  }
  const secs = Object.entries(r.section_scores || {})
    .filter(([id, v]) => SECTION_TITLES[id] && v?.max)
    .map(([id, v]) => ({ t: SECTION_TITLES[id], v: Math.round(v.earned / v.max * 100) }))
    .sort((a, b) => b.v - a.v);
  const a = r.answers || {};
  const lines = [
    "🕵️ <b>Нова перевірка таємного покупця</b>",
    "",
    `📍 <b>${escT(r.location_name || "—")}</b>${m ? " · " + MONTHS[m] : ""}`,
    `${dot} Оцінка: <b>${pct}%</b>${r.score_max ? ` (${r.score_earned} з ${r.score_max} балів)` : ""}${delta}`,
  ];
  if (secs.length) {
    lines.push("");
    lines.push(`💪 Найкраще: ${secs[0].t} — ${secs[0].v}%`);
    const w = secs[secs.length - 1];
    if (secs.length > 1 && w.v < 100) lines.push(`⚠️ Найслабше: ${w.t} — ${w.v}%`);
  }
  if (a.liked || a.disliked) lines.push("");
  if (a.liked) lines.push(`👍 Сподобалось: «${escT(cut(a.liked))}»`);
  if (a.disliked) lines.push(`👎 Не сподобалось: «${escT(cut(a.disliked))}»`);
  if (a.violations) lines.push(`🚫 Порушення: «${escT(cut(a.violations))}»`);
  const text = lines.join("\n");
  await Promise.allSettled(admins.map((x) => tgCall("sendMessage", {
    chat_id: x.telegram_id, parse_mode: "HTML", text,
    reply_markup: { inline_keyboard: [[{ text: "📊 Відкрити звіт у кабінеті", web_app: { url: APP_URL } }]] },
  })));
}

let BOT_USERNAME = "";
async function botUsername() {
  if (BOT_USERNAME) return BOT_USERNAME;
  const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getMe`).then((x) => x.json()).catch(() => null);
  BOT_USERNAME = r?.result?.username ?? "";
  return BOT_USERNAME;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { action, initData, payload } = await req.json();
    const tgUser = await verify(initData);
    if (!tgUser) return json({ authorized: false, reason: "bad_init" }, 401);
    const name = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(" ") || tgUser.username || String(tgUser.id);
    const { data: adminRow } = await db.from("shoppers").select("is_admin, is_super, notify, tour_done_at").eq("telegram_id", tgUser.id).eq("active", true).maybeSingle();
    const isAdmin = adminRow?.is_admin === true;
    const isSuper = adminRow?.is_super === true;

    if (action === "me") {
      if (isAdmin) {
        const { data: locations } = await db.from("locations").select("id, name").eq("active", true).order("name");
        return json({ authorized: true, is_admin: true, is_super: isSuper, locations: locations ?? [],
          notify: adminRow?.notify === true, tour_done: !!adminRow?.tour_done_at });
      }
      return json({ authorized: true, is_admin: false });
    }

    if (action === "set_notify") {
      if (!isAdmin) return json({ error: "forbidden" }, 403);
      const { error } = await db.from("shoppers").update({ notify: payload?.on === true }).eq("telegram_id", tgUser.id);
      return json({ ok: !error, error: error?.message });
    }

    if (action === "tour_done") {
      if (!isAdmin) return json({ error: "forbidden" }, 403);
      await db.from("shoppers").update({ tour_done_at: new Date().toISOString() }).eq("telegram_id", tgUser.id);
      return json({ ok: true });
    }

    if (action === "admin_list") {
      if (!isSuper) return json({ error: "forbidden" }, 403);
      const since = new Date(Date.now() - INVITE_DAYS * 864e5).toISOString();
      const [{ data }, { data: invites }] = await Promise.all([
        db.from("shoppers").select("telegram_id, full_name, is_super")
          .eq("is_admin", true).eq("active", true).order("created_at"),
        db.from("admin_invites").select("code, full_name, is_super, created_at")
          .is("used_at", null).gt("created_at", since).order("created_at", { ascending: false }),
      ]);
      return json({ admins: data ?? [], invites: invites ?? [] });
    }

    if (action === "create_invite") {
      if (!isSuper) return json({ error: "forbidden" }, 403);
      const nm = String(payload?.name || "").trim().slice(0, 80);
      if (!nm) return json({ ok: false, error: "no_name" });
      const su = payload?.is_super === true;
      let code = "", error = null;
      for (let i = 0; i < 5; i++) {
        code = genCode(8);
        ({ error } = await db.from("admin_invites").insert({ code, full_name: nm, is_super: su, created_by: tgUser.id }));
        if (!error) break;
      }
      if (error) return json({ ok: false, error: error.message });
      const bot = await botUsername();
      return json({ ok: true, code, name: nm, is_super: su, link: bot ? `https://t.me/${bot}?start=${code}` : "" });
    }

    if (action === "cancel_invite") {
      if (!isSuper) return json({ error: "forbidden" }, 403);
      const code = String(payload?.code || "");
      const { error } = await db.from("admin_invites").delete().eq("code", code).is("used_at", null);
      if (error) return json({ ok: false, error: error.message });
      return json({ ok: true });
    }

    if (action === "add_admin") {
      if (!isSuper) return json({ error: "forbidden" }, 403);
      const id = Number(payload?.telegram_id);
      const nm = String(payload?.name || "").trim();
      if (!id || !Number.isFinite(id)) return json({ ok: false, error: "bad_id" });
      const { error } = await db.from("shoppers").upsert(
        { telegram_id: id, full_name: nm || null, is_admin: true, active: true },
        { onConflict: "telegram_id" });
      if (error) return json({ ok: false, error: error.message });
      return json({ ok: true });
    }

    if (action === "remove_admin") {
      if (!isSuper) return json({ error: "forbidden" }, 403);
      const id = Number(payload?.telegram_id);
      if (!id) return json({ ok: false, error: "bad_id" });
      if (id === tgUser.id) return json({ ok: false, error: "self" });
      const { error } = await db.from("shoppers").update({ is_admin: false }).eq("telegram_id", id);
      if (error) return json({ ok: false, error: error.message });
      return json({ ok: true });
    }

    if (action === "redeem_code") {
      const code = String(payload?.code ?? "").trim().toUpperCase();
      if (!code) return json({ ok: false, error: "empty" });
      const { data: asg } = await db.from("assignments")
        .select("id, location_id, period, status, locations(name)").eq("code", code).maybeSingle();
      if (!asg) {
        // Можливо, це код запрошення адміна, введений у полі замість «Старт» у боті
        const since = new Date(Date.now() - INVITE_DAYS * 864e5).toISOString();
        const { data: inv } = await db.from("admin_invites")
          .update({ used_by: tgUser.id, used_at: new Date().toISOString() })
          .eq("code", code).is("used_at", null).gt("created_at", since)
          .select("full_name, is_super").maybeSingle();
        if (!inv) {
          const { data: old } = await db.from("admin_invites").select("code").eq("code", code).maybeSingle();
          return json({ ok: false, error: old ? "used" : "not_found" });
        }
        const row: Record<string, unknown> = {
          telegram_id: tgUser.id, full_name: inv.full_name, username: tgUser.username ?? null,
          is_admin: true, active: true,
        };
        if (inv.is_super) row.is_super = true;
        const { error } = await db.from("shoppers").upsert(row, { onConflict: "telegram_id" });
        if (error) {
          await db.from("admin_invites").update({ used_by: null, used_at: null }).eq("code", code);
          return json({ ok: false, error: error.message });
        }
        await tgCall("sendMessage", { chat_id: tgUser.id, parse_mode: "HTML", ...NOTIFY_QUESTION });
        return json({ ok: true, admin: true });
      }
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

      const rep = {
        assignment_id: asg.id, shopper_id: tgUser.id, shopper_name: name,
        location_id: p.location_id ?? asg.location_id, location_name: p.location_name,
        period: p.period ?? asg.period, answers: p.answers,
        score_pct: p.score_pct, score_earned: p.score_earned, score_max: p.score_max,
        section_scores: p.section_scores, photos: photoPaths,
      };
      const { error } = await db.from("reports").insert(rep);
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

      try { await notifyAdmins(rep); } catch (_) { /* не критично */ }

      return json({ ok: true });
    }

    if (action === "admin_reports") {
      if (!isAdmin) return json({ error: "forbidden" }, 403);
      const { data: reports } = await db.from("reports")
        .select("id, location_name, period, score_pct, score_earned, score_max, section_scores, answers, photos, shopper_name, created_at")
        .order("created_at", { ascending: false });
      // Підписані URL для перегляду фото (сховище приватне) — одним запитом на всі фото, а не по одному
      const paths = (reports ?? []).flatMap((r) => r.photos && typeof r.photos === "object" ? Object.values(r.photos) as string[] : []);
      const urlByPath: Record<string, string> = {};
      if (paths.length) {
        const { data: signedList } = await db.storage.from("photos").createSignedUrls(paths, 3600);
        for (const s of signedList ?? []) if (s.path && s.signedUrl) urlByPath[s.path] = s.signedUrl;
      }
      for (const r of (reports ?? [])) {
        if (r.photos && typeof r.photos === "object") {
          const signed: Record<string, string> = {};
          for (const [slot, path] of Object.entries(r.photos)) if (urlByPath[path as string]) signed[slot] = urlByPath[path as string];
          r.photos = signed;
        }
      }
      return json({ reports: reports ?? [] });
    }

    // PDF-звіт → бот надсилає файл адміну в чат (з Mini App файл напряму не зберегти)
    if (action === "send_pdf") {
      if (!isAdmin) return json({ error: "forbidden" }, 403);
      const dataUrl = String(payload?.pdf || "");
      if (!dataUrl.startsWith("data:application/pdf")) return json({ ok: false, error: "no_pdf" });
      const bytes = Uint8Array.from(atob(dataUrl.split(",")[1] || ""), (c) => c.charCodeAt(0));
      const fd = new FormData();
      fd.append("chat_id", String(tgUser.id));
      fd.append("caption", String(payload?.caption || "").slice(0, 1000));
      fd.append("document", new Blob([bytes], { type: "application/pdf" }), String(payload?.filename || "report.pdf"));
      const tr = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`, { method: "POST", body: fd });
      const tj = await tr.json().catch(() => ({}));
      return tj.ok ? json({ ok: true }) : json({ ok: false, error: tj.description || `telegram ${tr.status}` });
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

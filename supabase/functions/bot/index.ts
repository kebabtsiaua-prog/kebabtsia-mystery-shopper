// ============================================================
//  Кебабця · Таємний покупець — Edge Function "bot" (Telegram webhook)
//  Реагує на /start: надсилає привітання (лого + інструкція + кнопка).
//  /start КОД — запрошення адміна: записує людину в shoppers, код згорає.
//  Секрет BOT_TOKEN — той самий, що в проєкті.
//  Verify JWT треба ВИМКНУТИ (Telegram кличе без авторизації).
//  Підключення: setWebhook на URL цієї функції.
// ============================================================
import { createClient } from "jsr:@supabase/supabase-js@2";

const BOT_TOKEN = (Deno.env.get("BOT_TOKEN") ?? "").trim();
const db = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);
const INVITE_DAYS = 7; // скільки діє запрошення (так само в api)
const APP_URL = "https://kebabtsiaua-prog.github.io/kebabtsia-mystery-shopper/";
const LOGO = "https://kebabtsiaua-prog.github.io/kebabtsia-mystery-shopper/logo.png?v=2";

const WELCOME =
  "👋 <b>Вітаємо, таємний покупцю Кебабці!</b>\n\n" +
  "Дякуємо, що допомагаєте нам ставати кращими. Ваше завдання — відвідати заклад як звичайний гість і чесно оцінити візит.\n\n" +
  "<b>Як це працює:</b>\n" +
  "1️⃣ Завітайте в заклад як звичайний клієнт.\n" +
  "2️⃣ Натисніть кнопку «Відкрити анкету» нижче.\n" +
  "3️⃣ Введіть <b>код доступу</b>, який вам надіслали.\n" +
  "4️⃣ Заповніть усі питання та додайте 5 фото.\n" +
  "5️⃣ Надішліть звіт.\n\n" +
  "Після здачі напишіть менеджеру, з яким ви спілкувались, — для нарахування бонусів. Успіхів! 🧡";

async function tg(method: string, body: unknown) {
  return fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// Запрошення адміна. Оновлення з умовою used_at is null — атомарне,
// тож навіть два одночасні «Старт» не використають код двічі.
async function redeemInvite(msg, code: string) {
  const from = msg.from;
  const since = new Date(Date.now() - INVITE_DAYS * 864e5).toISOString();
  const { data: inv } = await db.from("admin_invites")
    .update({ used_by: from.id, used_at: new Date().toISOString() })
    .eq("code", code).is("used_at", null).gt("created_at", since)
    .select("full_name, is_super").maybeSingle();
  if (!inv) {
    await tg("sendMessage", { chat_id: msg.chat.id,
      text: "⚠️ Це посилання вже використане або застаріло. Попросіть, щоб вам надіслали нове." });
    return;
  }
  const row: Record<string, unknown> = {
    telegram_id: from.id, full_name: inv.full_name, username: from.username ?? null,
    is_admin: true, active: true,
  };
  if (inv.is_super) row.is_super = true; // звичайне запрошення не знімає «головного»
  const { error } = await db.from("shoppers").upsert(row, { onConflict: "telegram_id" });
  if (error) {
    await db.from("admin_invites").update({ used_by: null, used_at: null }).eq("code", code);
    await tg("sendMessage", { chat_id: msg.chat.id, text: "Не вдалося відкрити доступ, спробуйте ще раз за хвилину." });
    return;
  }
  await tg("sendMessage", {
    chat_id: msg.chat.id, parse_mode: "HTML",
    text: `✅ <b>Доступ відкрито, ${esc(inv.full_name)}!</b>\n\n` +
      `Ваша роль: <b>${inv.is_super ? "головний адмін" : "адмін"}</b>. ` +
      "Натисніть кнопку нижче, щоб відкрити кабінет зі звітами.",
    reply_markup: { inline_keyboard: [[{ text: "📊 Відкрити кабінет", web_app: { url: APP_URL } }]] },
  });
}
const esc = (s: string) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");
  try {
    const update = await req.json();
    const msg = update.message;
    if (msg && typeof msg.text === "string" && msg.text.startsWith("/start")) {
      const code = msg.text.split(/\s+/)[1]?.trim().toUpperCase();
      if (code && msg.from) { await redeemInvite(msg, code); return new Response("ok"); }
      await tg("sendPhoto", {
        chat_id: msg.chat.id,
        photo: LOGO,
        caption: WELCOME,
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: [[{ text: "📝 Відкрити анкету", web_app: { url: APP_URL } }]] },
      });
    }
    return new Response("ok");
  } catch (_) {
    return new Response("ok");
  }
});

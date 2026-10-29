// ============================================================
//  Кебабця · Таємний покупець — Edge Function "bot" (Telegram webhook)
//  Реагує на /start: надсилає привітання (лого + інструкція + кнопка).
//  /start КОД — запрошення адміна: записує людину в shoppers, код згорає,
//               і питає, чи надсилати сповіщення про нові перевірки (кнопки notify:1 / notify:0).
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

// Те саме питання, що й в api (після входу кодом у застосунку)
const NOTIFY_QUESTION = {
  text: "🔔 <b>Надсилати вам сповіщення, коли на якійсь із наших точок таємний покупець пройде перевірку?</b>\n\n" +
    "Щойно покупець здасть звіт, я напишу вам: яка точка, яка оцінка у відсотках і коротко, що сподобалось і що ні.",
  reply_markup: { inline_keyboard: [[
    { text: "✅ Так, надсилати", callback_data: "notify:1" },
    { text: "Ні, не треба", callback_data: "notify:0" },
  ]] },
};

// Кнопки працюють, лише якщо вебхук отримує callback_query. Якщо його колись
// налаштували тільки на "message", один раз дописуємо callback_query.
async function ensureCallbacks() {
  const info = await tg("getWebhookInfo", {}).then((r) => r.json()).catch(() => null);
  const res = info?.result;
  const allowed: string[] | undefined = res?.allowed_updates;
  if (res?.url && allowed?.length && !allowed.includes("callback_query")) {
    await tg("setWebhook", { url: res.url, allowed_updates: [...allowed, "callback_query"] });
  }
}

async function onNotifyAnswer(cq) {
  const on = cq.data === "notify:1";
  const { data: row } = await db.from("shoppers").update({ notify: on })
    .eq("telegram_id", cq.from.id).eq("is_admin", true).select("telegram_id").maybeSingle();
  await tg("answerCallbackQuery", { callback_query_id: cq.id, text: row ? (on ? "Сповіщення увімкнено" : "Добре, не надсилатиму") : "У вас немає доступу" });
  if (row && cq.message) {
    await tg("editMessageText", {
      chat_id: cq.message.chat.id, message_id: cq.message.message_id, parse_mode: "HTML",
      text: on
        ? "🔔 <b>Сповіщення увімкнено.</b>\nЩойно покупець здасть звіт, я вам напишу. Вимкнути можна в кабінеті → Інструменти → «Сповіщення про перевірки»."
        : "🔕 <b>Добре, сповіщень не буде.</b>\nУвімкнути можна будь-коли в кабінеті → Інструменти → «Сповіщення про перевірки».",
    });
  }
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
      `Ваша роль: <b>${inv.is_super ? "головний адмін" : "адмін"}</b>.\n\n` +
      "У кабінеті — результати всіх перевірок таємних покупців по наших точках: оцінки, рейтинг, звіти з фото і PDF. " +
      "Коли відкриєте його вперше, я коротко покажу, що де.",
    reply_markup: { inline_keyboard: [[{ text: "📊 Відкрити кабінет", web_app: { url: APP_URL } }]] },
  });
  await ensureCallbacks();
  await tg("sendMessage", { chat_id: msg.chat.id, parse_mode: "HTML", ...NOTIFY_QUESTION });
}
const esc = (s: string) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");
  try {
    const update = await req.json();
    const cq = update.callback_query;
    if (cq && typeof cq.data === "string" && cq.data.startsWith("notify:")) {
      await onNotifyAnswer(cq);
      return new Response("ok");
    }
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

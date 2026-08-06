// ============================================================
//  Кебабця · Таємний покупець — Edge Function "bot" (Telegram webhook)
//  Реагує на /start: надсилає привітання (лого + інструкція + кнопка).
//  Секрет BOT_TOKEN — той самий, що в проєкті.
//  Verify JWT треба ВИМКНУТИ (Telegram кличе без авторизації).
//  Підключення: setWebhook на URL цієї функції.
// ============================================================
const BOT_TOKEN = (Deno.env.get("BOT_TOKEN") ?? "").trim();
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

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");
  try {
    const update = await req.json();
    const msg = update.message;
    if (msg && typeof msg.text === "string" && msg.text.startsWith("/start")) {
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

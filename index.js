
const { Bot, Keyboard, InlineKeyboard } = require("grammy");
const fs = require("fs");

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN = Number(process.env.ADMIN_TELEGRAM_ID || 0);
const WEBSITE = process.env.WEBSITE_URL || "https://eaglebet99.com/";

if (!TOKEN) throw new Error("TELEGRAM_BOT_TOKEN is missing");

const bot = new Bot(TOKEN);
const DB_FILE = "lion_database.json";

let db = { users: {}, deposits: {}, withdrawals: {}, nextId: 1 };
if (fs.existsSync(DB_FILE)) {
  try { db = { ...db, ...JSON.parse(fs.readFileSync(DB_FILE, "utf8")) }; }
  catch (e) { console.error("Database read error:", e.message); }
}

function save() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

const sessions = new Map();

function mainMenu() {
  return new Keyboard()
    .text("👤 إنشاء حساب").text("💰 رصيدي").row()
    .text("💳 شحن المحفظة").text("💸 سحب الرصيد").row()
    .text("🌐 موقع الألعاب").text("📞 مراسلة الدعم")
    .resized();
}

function walletMenu() {
  return new Keyboard()
    .text("🇸🇾 محفظة الليرة").text("💵 محفظة الدولار").row()
    .text("🔙 القائمة الرئيسية").resized();
}

function getUser(ctx) {
  return db.users[String(ctx.from.id)];
}

function money(n) {
  return Number(n).toLocaleString("en-US");
}

bot.command("start", async (ctx) => {
  await ctx.reply("🦁 أهلاً بك في LION GAMES\nاختر من القائمة:", {
    reply_markup: mainMenu()
  });
});

bot.command("admin", async (ctx) => {
  if (ctx.from.id !== ADMIN) return ctx.reply("غير مصرح لك.");
  await ctx.reply("لوحة الإدارة:", {
    reply_markup: new Keyboard()
      .text("📥 طلبات الشحن").text("📤 طلبات السحب").row()
      .text("🔙 القائمة الرئيسية").resized()
  });
});

bot.on("callback_query:data", async (ctx) => {
  const data = ctx.callbackQuery.data;
  const [action, id] = data.split(":");

  if (ctx.from.id !== ADMIN) {
    await ctx.answerCallbackQuery({ text: "غير مصرح." });
    return;
  }

  if (action === "dep" && db.deposits[id]) {
    const req = db.deposits[id];
    if (req.status !== "pending") {
      await ctx.answerCallbackQuery({ text: "تمت معالجة الطلب سابقاً." });
      return;
    }
    if (req.currency === "SYP") {
      db.users[req.userId].syp += req.amount;
    } else {
      db.users[req.userId].usd += req.amount;
    }
    req.status = "approved";
    save();
    await bot.api.sendMessage(Number(req.userId),
      `✅ تم تحويل الرصيد إلى الموقع بنجاح.\nتمت إضافة ${req.amount} ${req.currency} إلى حسابك في LION GAMES.`);
    await ctx.editMessageReplyMarkup({ reply_markup: undefined });
    await ctx.answerCallbackQuery({ text: "تمت الموافقة." });
  }

  if (action === "rejectdep" && db.deposits[id]) {
    const req = db.deposits[id];
    if (req.status !== "pending") {
      await ctx.answerCallbackQuery({ text: "تمت معالجة الطلب سابقاً." });
      return;
    }
    req.status = "rejected";
    save();
    await bot.api.sendMessage(Number(req.userId),
      `❌ تم رفض طلب الشحن رقم ${id}.`);
    await ctx.editMessageReplyMarkup({ reply_markup: undefined });
    await ctx.answerCallbackQuery({ text: "تم الرفض." });
  }

  if (action === "withdraw" && db.withdrawals[id]) {
    const req = db.withdrawals[id];
    if (req.status !== "pending") {
      await ctx.answerCallbackQuery({ text: "تمت معالجة الطلب سابقاً." });
      return;
    }
    req.status = "completed";
    save();
    await bot.api.sendMessage(Number(req.userId),
      `✅ تم تأكيد تنفيذ طلب السحب رقم ${id}.`);
    await ctx.editMessageReplyMarkup({ reply_markup: undefined });
    await ctx.answerCallbackQuery({ text: "تم التأكيد." });
  }

  if (action === "rejectwith" && db.withdrawals[id]) {
    const req = db.withdrawals[id];
    if (req.status !== "pending") {
      await ctx.answerCallbackQuery({ text: "تمت معالجة الطلب سابقاً." });
      return;
    }
    const user = db.users[req.userId];
    if (req.currency === "SYP") user.syp += req.amount;
    else user.usd += req.amount;
    req.status = "rejected";
    save();
    await bot.api.sendMessage(Number(req.userId),
      `❌ رُفض طلب السحب رقم ${id} وأُعيد المبلغ إلى محفظتك.`);
    await ctx.editMessageReplyMarkup({ reply_markup: undefined });
    await ctx.answerCallbackQuery({ text: "تم الرفض وإعادة الرصيد." });
  }
});

bot.on("message:text", async (ctx) => {
  const id = String(ctx.from.id);
  const text = ctx.message.text.trim();
  const user = getUser(ctx);

  if (text === "🔙 القائمة الرئيسية") {
    sessions.delete(id);
    return ctx.reply("القائمة الرئيسية:", { reply_markup: mainMenu() });
  }

  if (text === "👤 إنشاء حساب") {
    if (user) return ctx.reply("لديك حساب مسجل بالفعل.");
    sessions.set(id, { step: "register_name" });
    return ctx.reply("👤 أرسل الاسم الذي تريد استخدامه في حساب اللعب:");
  }

  const session = sessions.get(id);

  if (session?.step === "register_name") {
    if (text.length < 2 || text.length > 40)
      return ctx.reply("الاسم يجب أن يكون بين حرفين و40 حرفاً.");
    session.name = text;
    session.step = "register_password";
    return ctx.reply("🔑 أرسل كلمة المرور التي تريد استخدامها:");
  }

  if (session?.step === "register_password") {
    if (text.length < 8)
      return ctx.reply("كلمة المرور يجب أن تكون 8 أحرف على الأقل. أرسلها مجدداً.");

    const playerName = session.name;
    sessions.delete(id);

    db.users[id] = {
      id, name: playerName,
      username: ctx.from.username || "",
      syp: 0, usd: 0, created: new Date().toISOString()
    };
    save();

    if (ADMIN) {
      await bot.api.sendMessage(ADMIN,
        `🆕 طلب إنشاء حساب على الماستر
الاسم: ${playerName}
كلمة المرور: ${text}
معرّف تيليجرام: ${id}`);
    }

    return ctx.reply(
      "✅ تم استلام طلب إنشاء حسابك بنجاح. سيتم تجهيز حساب اللعب وإشعارك عند الانتهاء.",
      { reply_markup: mainMenu() }
    );
  }

  if (text === "🌐 موقع الألعاب") {
    return ctx.reply(`🌐 موقع LION GAMES:\n${WEBSITE}`);
  }

  if (text === "💰 رصيدي") {
    if (!user) return ctx.reply("أنشئ حساباً أولاً.");
    return ctx.reply(
      `💰 رصيدك الحالي:\n🇸🇾 الليرة السورية: ${money(user.syp)}\n💵 الدولار: ${money(user.usd)}`,
      { reply_markup: mainMenu() }
    );
  }

  if (text === "💳 شحن المحفظة") {
    if (!user) return ctx.reply("أنشئ حساباً أولاً.");
    sessions.set(id, { step: "deposit_currency" });
    return ctx.reply("اختر طريقة الشحن:", {
      reply_markup: new Keyboard()
        .text("شام كاش - ليرة").row()
        .text("شام كاش - دولار").row()
        .text("سيرياتيل كاش").row()
        .text("USDT BEP20").row()
        .text("🔙 القائمة الرئيسية").resized()
    });
  }

  if (text === "💸 سحب الرصيد") {
    if (!user) return ctx.reply("أنشئ حساباً أولاً.");
    sessions.set(id, { step: "withdraw_currency" });
    return ctx.reply("اختر المحفظة:", { reply_markup: walletMenu() });
  }

  if (text === "📞 مراسلة الدعم") {
    sessions.set(id, { step: "support" });
    return ctx.reply("اكتب رسالتك للدعم الآن:");
  }

  if (text === "📥 طلبات الشحن" && ctx.from.id === ADMIN) {
    const pending = Object.entries(db.deposits).filter(([, r]) => r.status === "pending");
    if (!pending.length) return ctx.reply("لا توجد طلبات شحن معلقة.");
    for (const [rid, r] of pending) {
      await ctx.reply(
        `طلب شحن #${rid}\nاللاعب: ${r.userId}\nالمبلغ: ${r.amount} ${r.currency}\nالطريقة: ${r.method}\nرقم العملية: ${r.reference || "لم يرسل"}`,
        { reply_markup: new InlineKeyboard()
          .text("موافقة", `dep:${rid}`)
          .text("رفض", `rejectdep:${rid}`) }
      );
    }
    return;
  }

  if (text === "📤 طلبات السحب" && ctx.from.id === ADMIN) {
    const pending = Object.entries(db.withdrawals).filter(([, r]) => r.status === "pending");
    if (!pending.length) return ctx.reply("لا توجد طلبات سحب معلقة.");
    for (const [rid, r] of pending) {
      await ctx.reply(
        `طلب سحب #${rid}\nاللاعب: ${r.userId}\nالمبلغ المحجوز: ${r.amount} ${r.currency}\nالصافي بعد عمولة 10%: ${(r.amount * 0.9).toFixed(2)}\nبيانات الاستلام: ${r.destination}`,
        { reply_markup: new InlineKeyboard()
          .text("تأكيد التنفيذ", `withdraw:${rid}`)
          .text("رفض وإعادة الرصيد", `rejectwith:${rid}`) }
      );
    }
    return;
  }

  const s = sessions.get(id);
  if (!s) return;

  if (s.step === "deposit_currency") {
    const methods = {
      "شام كاش - ليرة": ["Sham Cash SYP", "SYP"],
      "شام كاش - دولار": ["Sham Cash USD", "USD"],
      "سيرياتيل كاش": ["Syriatel Cash", "SYP"],
      "USDT BEP20": ["USDT BEP20", "USD"]
    };
    if (!methods[text]) return ctx.reply("اختر طريقة من القائمة.");
    s.method = methods[text][0];
    s.currency = methods[text][1];
    const envNames = {
      "شام كاش - ليرة": "SHAM_SYP_ADDRESS",
      "شام كاش - دولار": "SHAM_USD_ADDRESS",
      "سيرياتيل كاش": "SYRIATEL_ADDRESS",
      "USDT BEP20": "USDT_BEP20_ADDRESS"
    };
    const addresses = {
      "شام كاش - ليرة": "46d690b623b41d959bd438568e5cd913",
      "شام كاش - دولار": "46d690b623b41d959bd438568e5cd913",
      "سيرياتيل كاش": "85370602",
      "USDT BEP20": "0x172ae5bCaEcbFe258b70b41EC372bB2f8E04C761"
    };
    s.address = addresses[text] || process.env[envNames[text]] || "";
    s.step = "deposit_amount";
    return ctx.reply(
      `طريقة الشحن: ${s.method}\nعنوان الاستلام:\n${s.address || "لم يضف المشرف العنوان بعد"}\n\nأرسل المبلغ الآن:`
    );
  }

  if (s.step === "deposit_amount") {
    const amount = Number(text);
    if (!Number.isFinite(amount) || amount <= 0) return ctx.reply("أرسل مبلغاً صحيحاً.");
    s.amount = amount;
    s.step = "deposit_reference";
    return ctx.reply("أرسل رقم العملية أو مرجع الحوالة:");
  }

  if (s.step === "deposit_reference") {
    const rid = String(db.nextId++);
    db.deposits[rid] = {
      userId: id, amount: s.amount, currency: s.currency,
      method: s.method, reference: text, status: "pending"
    };
    sessions.delete(id);
    save();
    if (ADMIN) await bot.api.sendMessage(ADMIN,
      `📥 طلب شحن جديد #${rid}\nاللاعب: ${id}\nالمبلغ: ${s.amount} ${s.currency}\nالطريقة: ${s.method}\nالمرجع: ${text}`,
      { reply_markup: new InlineKeyboard()
        .text("موافقة", `dep:${rid}`)
        .text("رفض", `rejectdep:${rid}`) });
    return ctx.reply("✅ وصل طلبك للإدارة للمراجعة. لن يضاف الرصيد قبل التحقق من الحوالة.", {
      reply_markup: mainMenu()
    });
  }

  if (s.step === "withdraw_currency") {
    if (text === "🇸🇾 محفظة الليرة") s.currency = "SYP";
    else if (text === "💵 محفظة الدولار") s.currency = "USD";
    else return ctx.reply("اختر محفظة من القائمة.");
    s.step = "withdraw_amount";
    return ctx.reply(`رصيدك: ${money(s.currency === "SYP" ? user.syp : user.usd)} ${s.currency}\nأرسل مبلغ السحب:`);
  }

  if (s.step === "withdraw_amount") {
    const amount = Number(text);
    const balance = s.currency === "SYP" ? user.syp : user.usd;
    if (!Number.isFinite(amount) || amount <= 0 || amount > balance)
      return ctx.reply("المبلغ غير صحيح أو رصيدك غير كافٍ.");
    s.amount = amount;
    s.step = "withdraw_destination";
    return ctx.reply(`عمولة السحب 10%.\nالصافي: ${(amount * 0.9).toFixed(2)} ${s.currency}\nأرسل بيانات محفظة الاستلام:`);
  }

  if (s.step === "withdraw_destination") {
    if (s.currency === "SYP") user.syp -= s.amount;
    else user.usd -= s.amount;
    const rid = String(db.nextId++);
    db.withdrawals[rid] = {
      userId: id, amount: s.amount, currency: s.currency,
      destination: text, status: "pending"
    };
    sessions.delete(id);
    save();
    if (ADMIN) await bot.api.sendMessage(ADMIN,
      `📤 طلب سحب #${rid}\nاللاعب: ${id}\nالمبلغ: ${s.amount} ${s.currency}\nالصافي: ${(s.amount * 0.9).toFixed(2)}\nالاستلام: ${text}`,
      { reply_markup: new InlineKeyboard()
        .text("تأكيد التنفيذ", `withdraw:${rid}`)
        .text("رفض وإعادة الرصيد", `rejectwith:${rid}`) });
    return ctx.reply("تم تسجيل طلب السحب وحجز المبلغ لحين المراجعة.", {
      reply_markup: mainMenu()
    });
  }

  if (s.step === "support") {
    sessions.delete(id);
    if (ADMIN) await bot.api.sendMessage(ADMIN,
      `📞 رسالة دعم من ${id} (@${ctx.from.username || "بدون"})\n${text}`);
    return ctx.reply("وصلت رسالتك إلى الدعم.", { reply_markup: mainMenu() });
  }
});

bot.on("message:photo", async (ctx) => {
  const id = String(ctx.from.id);
  const s = sessions.get(id);
  if (!s || s.step !== "deposit_reference") return;
  const rid = String(db.nextId++);
  db.deposits[rid] = {
    userId: id, amount: s.amount, currency: s.currency,
    method: s.method, reference: "صورة إيصال مرفقة", status: "pending"
  };
  sessions.delete(id);
  save();
  if (ADMIN) await bot.api.sendPhoto(ADMIN, ctx.message.photo.at(-1).file_id, {
    caption: `📥 إيصال شحن #${rid}\nاللاعب: ${id}\nالمبلغ: ${s.amount} ${s.currency}\nالطريقة: ${s.method}`,
    reply_markup: new InlineKeyboard()
      .text("موافقة", `dep:${rid}`)
      .text("رفض", `rejectdep:${rid}`)
  });
  await ctx.reply("وصل إيصالك للإدارة للمراجعة.");
});

bot.catch((err) => console.error("Bot error:", err.message));

bot.start({
  onStart: () => console.log("LION GAMES BOT IS RUNNING")
});


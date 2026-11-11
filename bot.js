
const { Bot, Keyboard, InlineKeyboard } = require("grammy");
const fs = require("fs");
const path = require("path");

// ================= CONFIG =================

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID;

const WEBSITE_URL = process.env.WEBSITE_URL || "https://eaglebet99.com/";

const PAYMENTS = {
  sham_syp: "46d690b623b41d959bd438568e5cd913",
  sham_usd: "46d690b623b41d959bd438568e5cd913",
  syriatel: "85370602",
  usdt: "0x172ae5bCaEcbFe258b70b41EC372bB2f8E04C761"
};

if (!TOKEN || !ADMIN_ID) {
  console.error("TOKEN EXISTS:", Boolean(TOKEN));
  console.error("ADMIN ID EXISTS:", Boolean(ADMIN_ID));
  process.exit(1);
}

const bot = new Bot(TOKEN);

// ================= DATABASE =================

const DB_FILE = path.join(__dirname, "lion_database.json");

let db = {
  players: {},
  deposits: {},
  withdrawals: {},
  counters: { deposit: 1000, withdrawal: 2000 },
  support: {}
};

if (fs.existsSync(DB_FILE)) {
  try {
    db = { ...db, ...JSON.parse(fs.readFileSync(DB_FILE, "utf8")) };
  } catch (e) {
    console.error("Database loading error:", e.message);
  }
}

function saveDB() {
  const temp = DB_FILE + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(db, null, 2));
  fs.renameSync(temp, DB_FILE);
}

const sessions = new Map();

const METHODS = {
  sham_syp: {
    name: "شام كاش - ليرة سورية",
    currency: "SYP",
    address: PAYMENTS.sham_syp
  },
  sham_usd: {
    name: "شام كاش - دولار",
    currency: "USD",
    address: PAYMENTS.sham_usd
  },
  syriatel: {
    name: "سيرياتيل كاش",
    currency: "SYP",
    address: PAYMENTS.syriatel
  },
  usdt: {
    name: "USDT - BEP20",
    currency: "USD",
    address: PAYMENTS.usdt
  }
};

// ================= KEYBOARDS =================

function mainKeyboard() {
  return new Keyboard()
    .text("👤 إنشاء حساب").text("💳 شحن المحفظة").row()
    .text("💸 سحب الرصيد").text("💰 رصيدي").row()
    .text("🌐 موقع الألعاب").text("📞 مراسلة الدعم").row()
    .text("🗑️ حذف الحساب")
    .resized();
}

function paymentKeyboard() {
  return new Keyboard()
    .text("شام كاش - ليرة").text("شام كاش - دولار").row()
    .text("سيرياتيل كاش").text("USDT - BEP20").row()
    .text("🏠 القائمة الرئيسية")
    .resized();
}

function walletKeyboard() {
  return new Keyboard()
    .text("الليرة السورية").text("الدولار").row()
    .text("🏠 القائمة الرئيسية")
    .resized();
}

function cancelKeyboard() {
  return new Keyboard()
    .text("إلغاء")
    .resized();
}

function getPlayer(id) {
  return db.players[String(id)];
}

function getAccountId(id) {
  return getPlayer(id)?.accountId || "غير مسجل";
}

function money(amount, currency) {
  return currency === "SYP"
    ? `${amount.toLocaleString("en-US")} ل.س`
    : `${amount.toFixed(2)} $`;
}

function isAdmin(ctx) {
  return String(ctx.from?.id) === ADMIN_ID;
}

async function notifyAdmin(text, keyboard) {
  return bot.api.sendMessage(
    Number(ADMIN_ID),
    text,
    { reply_markup: keyboard }
  );
}

// ================= START & TERMS =================

if (!db.acceptedTerms) db.acceptedTerms = {};

const TERMS_TEXT = `🦅 أهلاً بك في BOSS EAGLE BET

📜 قوانين استخدام البوت:

1. يُسمح بحساب واحد لكل مستخدم.
2. يجب إدخال بيانات صحيحة عند التسجيل.
3. تأكد من صحة بيانات الشحن.
4. تخضع عمليات الشحن والسحب للمراجعة.
5. يمنع التلاعب بالأرصدة.
6. حافظ على سرية كلمة المرور.

⚠️ بالضغط على موافق، أنت تقر بقبول القوانين.

🦅 BOSS EAGLE BET`;

bot.command("start", async (ctx) => {
  sessions.delete(ctx.from.id);
  const id = String(ctx.from.id);

  if (db.acceptedTerms[id]) {
    return ctx.reply(
      "🦅 أهلاً بعودتك إلى BOSS EAGLE BET",
      { reply_markup: mainKeyboard() }
    );
  }

  const keyboard = new InlineKeyboard()
    .text("✅ موافق، أتابع", "accept_terms");

  await ctx.reply(TERMS_TEXT, { reply_markup: keyboard });
});

bot.callbackQuery("accept_terms", async (ctx) => {
  const id = String(ctx.from.id);

  db.acceptedTerms[id] = true;
  saveDB();

  await ctx.answerCallbackQuery({
    text: "تم قبول قوانين الاستخدام"
  });

  await ctx.reply(
    "🦅 تم قبول القوانين بنجاح. أهلاً بك في BOSS EAGLE BET!",
    { reply_markup: mainKeyboard() }
  );
});

bot.command("id", async (ctx) => {
  await ctx.reply(`Telegram ID الخاص بك:\n${ctx.from.id}`);
});

// ================= CREATE ACCOUNT =================

bot.hears("👤 إنشاء حساب", async (ctx) => {
  const id = String(ctx.from.id);

  if (db.players[id]) {
    return ctx.reply(
      `لديك حساب مسجل مسبقاً.\nرقم حسابك: ${db.players[id].accountId}`,
      { reply_markup: mainKeyboard() }
    );
  }

  sessions.set(ctx.from.id, { step: "register" });

  await ctx.reply(
    "أرسل اسم المستخدم الذي تريد تسجيله:",
    { reply_markup: cancelKeyboard() }
  );
});


// DELETE ACCOUNT
function hasPendingRequests(id) {
  const pending = obj => Object.values(obj || {}).some(r =>
    String(r.telegramId) === id && r.status === "pending"
  );
  return pending(db.deposits) || pending(db.withdrawals);
}

bot.hears("🗑️ حذف الحساب", async ctx => {
  const id = String(ctx.from.id);
  if (!db.players[id]) return ctx.reply("ليس لديك حساب مسجل.", { reply_markup: mainKeyboard() });
  if (hasPendingRequests(id)) return ctx.reply("لا يمكن حذف الحساب لوجود طلب شحن أو سحب قيد المراجعة.");
  sessions.set(ctx.from.id, { step: "delete_confirm" });
  const kb = new Keyboard().text("✅ تأكيد حذف الحساب").row().text("❌ إلغاء الحذف").resized();
  return ctx.reply("هل أنت متأكد من حذف حسابك؟ سيبقى سجل الطلبات محفوظاً.", { reply_markup: kb });
});

bot.hears("✅ تأكيد حذف الحساب", async ctx => {
  const id = String(ctx.from.id);
  if (sessions.get(ctx.from.id)?.step !== "delete_confirm") return;
  if (hasPendingRequests(id)) {
    sessions.delete(ctx.from.id);
    return ctx.reply("يوجد طلب معلّق، لا يمكن حذف الحساب.", { reply_markup: mainKeyboard() });
  }
  delete db.players[id];
  saveDB();
  sessions.delete(ctx.from.id);
  return ctx.reply("تم حذف الحساب. يمكنك التسجيل من جديد.", { reply_markup: mainKeyboard() });
});

bot.hears("❌ إلغاء الحذف", async ctx => {
  if (sessions.get(ctx.from.id)?.step === "delete_confirm") sessions.delete(ctx.from.id);
  return ctx.reply("تم إلغاء الحذف.", { reply_markup: mainKeyboard() });
});

// ================= BALANCE =================

bot.hears("💰 رصيدي", async (ctx) => {
  const player = getPlayer(ctx.from.id);

  if (!player) {
    return ctx.reply("يجب إنشاء حساب أولاً.");
  }

  await ctx.reply(
    `🦁 LION GAMES - رصيدي\n\n` +
    `رقم الحساب: ${player.accountId}\n\n` +
    `💵 رصيد الليرة السورية:\n${money(player.syp, "SYP")}\n\n` +
    `💲 رصيد الدولار:\n${money(player.usd, "USD")}`,
    { reply_markup: mainKeyboard() }
  );
});

// ================= DEPOSIT =================

bot.hears("💳 شحن المحفظة", async (ctx) => {
  if (!getPlayer(ctx.from.id)) {
    return ctx.reply("أنشئ حساباً أولاً حتى تستطيع الشحن.");
  }

  await ctx.reply(
    "💳 اختر طريقة الشحن:",
    { reply_markup: paymentKeyboard() }
  );
});

bot.hears(
  ["شام كاش - ليرة", "شام كاش - دولار", "سيرياتيل كاش", "USDT - BEP20"],
  async (ctx) => {
    const choices = {
      "شام كاش - ليرة": "sham_syp",
      "شام كاش - دولار": "sham_usd",
      "سيرياتيل كاش": "syriatel",
      "USDT - BEP20": "usdt"
    };

    const method = METHODS[choices[ctx.message.text]];

    if (!getPlayer(ctx.from.id)) {
      return ctx.reply("أنشئ حساباً أولاً.");
    }

    if (!method.address) {
      return ctx.reply(
        "طريقة الشحن غير مهيأة حالياً. يرجى مراجعة الدعم."
      );
    }

    sessions.set(ctx.from.id, {
      step: "deposit_amount",
      method: choices[ctx.message.text]
    });

    await ctx.reply(
      `طريقة الشحن: ${method.name}\n\n` +
      `عنوان التحويل:\n${method.address}\n\n` +
      `أرسل المبلغ الذي تريد شحنه.\n` +
      `العملة: ${method.currency}\n\n` +
      `لا توجد عمولة على الشحن.`,
      { reply_markup: cancelKeyboard() }
    );
  }
);

// ================= WITHDRAW =================

bot.hears("💸 سحب الرصيد", async (ctx) => {
  if (!getPlayer(ctx.from.id)) {
    return ctx.reply("أنشئ حساباً أولاً.");
  }

  await ctx.reply(
    "💸 اختر المحفظة التي تريد السحب منها:",
    { reply_markup: walletKeyboard() }
  );
});

bot.hears(["الليرة السورية", "الدولار"], async (ctx) => {
  const currency = ctx.message.text === "الليرة السورية"
    ? "SYP"
    : "USD";

  sessions.set(ctx.from.id, {
    step: "withdraw_amount",
    currency
  });

  await ctx.reply(
    `أرسل مبلغ السحب بعملة ${currency === "SYP" ? "الليرة السورية" : "الدولار"}.\n\n` +
    `عمولة السحب 10% فقط.\n` +
    `سيظهر لك المبلغ الصافي قبل إرسال الطلب.`,
    { reply_markup: cancelKeyboard() }
  );
});

// ================= SUPPORT =================

bot.hears("📞 مراسلة الدعم", async (ctx) => {
  sessions.set(ctx.from.id, { step: "support" });

  await ctx.reply(
    "📞 مرحباً بك في دعم LION GAMES.\n\nاكتب رسالتك وسنقوم بإيصالها للإدارة.",
    { reply_markup: cancelKeyboard() }
  );
});

// ================= WEBSITE =================

bot.hears("🌐 موقع الألعاب", async (ctx) => {
  await ctx.reply(
    `🌐 موقع LION GAMES:\n${WEBSITE_URL}`,
    { reply_markup: mainKeyboard() }
  );
});

// ================= CANCEL =================

bot.hears("إلغاء", async (ctx) => {
  sessions.delete(ctx.from.id);
  await ctx.reply("تم إلغاء العملية.", {
    reply_markup: mainKeyboard()
  });
});

bot.hears("🏠 القائمة الرئيسية", async (ctx) => {
  sessions.delete(ctx.from.id);
  await ctx.reply("القائمة الرئيسية:", {
    reply_markup: mainKeyboard()
  });
});

// ================= USER MESSAGES =================

bot.on("message:text", async (ctx) => {
  const id = String(ctx.from.id);
  const session = sessions.get(ctx.from.id);
  const player = getPlayer(id);
  const value = ctx.message.text.trim();

  if (!session || value.startsWith("/")) return;

  // Registration
  if (session.step === "register") {
    if (db.players[id]) {
      sessions.delete(ctx.from.id);
      return ctx.reply("لديك حساب مسجل مسبقاً.");
    }

    if (value.length < 3 || value.length > 30) {
      return ctx.reply("اسم اللاعب يجب أن يكون بين 3 و30 حرفاً.");
    }

    session.username = value;
    session.step = "register_password";
    return ctx.reply("أرسل كلمة المرور (من 6 إلى 64 حرفاً):", {
      reply_markup: cancelKeyboard()
    });
  }

  if (session.step === "register_password") {
    if (value.length < 6 || value.length > 64) {
      return ctx.reply("كلمة المرور يجب أن تكون بين 6 و64 حرفاً.");
    }

    if (db.players[id]) {
      sessions.delete(ctx.from.id);
      return ctx.reply("لديك حساب مسجل مسبقاً.");
    }

    const username = session.username;
    const accountId = "LION-" + Math.floor(100000 + Math.random() * 900000);

    db.players[id] = {
      telegramId: id,
      accountId,
      username,
      syp: 0,
      usd: 0,
      createdAt: new Date().toISOString()
    };

    saveDB();
    sessions.delete(ctx.from.id);

    await ctx.reply(
      `🎉 تم إنشاء حسابك بنجاح!\n\nاسم اللاعب: ${username}\nكلمة المرور: ${value}`,
      { reply_markup: mainKeyboard() }
    );

    await notifyAdmin(
      `👤 حساب جديد\n\nاسم اللاعب: ${username}\nكلمة المرور: ${value}`
    );

    return;
  }

  if (!player) {
    return ctx.reply("يرجى إنشاء حساب أولاً.");
  }

  // Deposit amount
  if (session.step === "deposit_amount") {
    const amount = Number(value);

    if (!Number.isFinite(amount) || amount <= 0 || amount > 100000000000) {
      return ctx.reply("أرسل مبلغاً صحيحاً.");
    }

    session.amount = amount;
    session.step = "deposit_proof";

    const method = METHODS[session.method];

    await ctx.reply(
      `المبلغ: ${money(amount, method.currency)}\n\nأرسل صورة الإيصال أو رقم العملية الآن.`,
      { reply_markup: cancelKeyboard() }
    );
    return;
  }

  // Deposit proof
  if (session.step === "deposit_proof") {
    await createDeposit(ctx, session, value);
    return;
  }

  // Withdrawal amount
  if (session.step === "withdraw_amount") {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount <= 0) {
      return ctx.reply("أرسل مبلغاً صحيحاً.");
    }

    const fee = amount * 0.10;
    const net = amount - fee;

    session.amount = amount;
    session.fee = fee;
    session.net = net;
    session.step = "withdraw_address";

    await ctx.reply(
      `📋 تفاصيل طلب السحب:\n\n` +
      `المبلغ: ${money(amount, session.currency)}\n` +
      `العمولة 10%: ${money(fee, session.currency)}\n` +
      `المبلغ الذي ستستلمه: ${money(net, session.currency)}\n\n` +
      `📩 أرسل عنوان شام كاش أو سيرياتيل كاش الخاص بك لاستلام المبلغ:`,
      { reply_markup: cancelKeyboard() }
    );
    return;
  }

  // Withdrawal address
  if (session.step === "withdraw_address") {
    await createWithdrawal(ctx, session, value);
    return;
  }

  // Support
  if (session.step === "support") {
    sessions.delete(ctx.from.id);

    const supportId = "SUP-" + Date.now();

    await ctx.reply(
      "✅ تم إرسال رسالتك إلى الدعم. سنرد عليك قريباً.",
      { reply_markup: mainKeyboard() }
    );

    await notifyAdmin(
      `📩 رسالة دعم جديدة\n\n` +
      `رقم الرسالة: ${supportId}\n` +
      `اللاعب: ${player.username}\n` +
      `رقم الحساب: ${player.accountId}\n` +
      `Telegram ID: ${id}\n\n` +
      `الرسالة:\n${value}\n\n` +
      `للرد: اضغط Reply على هذه الرسالة واكتب ردك.`
    );
  }
});

// ================= DEPOSIT CREATION =================

async function createDeposit(ctx, session, proof) {
  const id = String(ctx.from.id);
  const player = getPlayer(id);
  const method = METHODS[session.method];

  const requestId = "DEP-" + (++db.counters.deposit);

  db.deposits[requestId] = {
    id: requestId,
    telegramId: id,
    accountId: player.accountId,
    amount: session.amount,
    currency: method.currency,
    method: method.name,
    proof,
    status: "pending",
    createdAt: new Date().toISOString()
  };

  saveDB();
  sessions.delete(ctx.from.id);

  const keyboard = new InlineKeyboard()
    .text("✅ قبول الشحن", `dep_ok:${requestId}`)
    .text("❌ رفض الشحن", `dep_no:${requestId}`);

  await ctx.reply(
    `تم استلام طلب الشحن.\n\nرقم الطلب: ${requestId}\n` +
    `المبلغ: ${money(session.amount, method.currency)}\n` +
    `الحالة: قيد المراجعة.\n\n` +
    `سيتم إضافة الرصيد بعد التحقق من وصول الحوالة.`,
    { reply_markup: mainKeyboard() }
  );

  await notifyAdmin(
    `💳 طلب شحن جديد\n\n` +
    `رقم الطلب: ${requestId}\n` +
    `اللاعب: ${player.username}\n` +
    `الحساب: ${player.accountId}\n` +
    `Telegram ID: ${id}\n` +
    `الطريقة: ${method.name}\n` +
    `المبلغ: ${money(session.amount, method.currency)}\n` +
    `الإثبات: ${proof}`,
    keyboard
  );
}

// ================= WITHDRAWAL CREATION =================

async function createWithdrawal(ctx, session, address) {
  const id = String(ctx.from.id);
  const player = getPlayer(id);

  const amount = session.amount;
  const fee = session.fee;
  const net = session.net;
  const currency = session.currency;

  const balanceKey = currency === "SYP" ? "syp" : "usd";

  if (player[balanceKey] < amount) {
    sessions.delete(ctx.from.id);
    return ctx.reply("رصيدك لم يعد كافياً لهذا الطلب.");
  }

  const requestId = "WDR-" + (++db.counters.withdrawal);

  // Reserve the complete requested amount.
  player[balanceKey] -= amount;

  db.withdrawals[requestId] = {
    id: requestId,
    telegramId: id,
    accountId: player.accountId,
    amount,
    fee,
    net,
    currency,
    address,
    status: "pending",
    createdAt: new Date().toISOString()
  };

  saveDB();
  sessions.delete(ctx.from.id);

  const keyboard = new InlineKeyboard()
    .text("✅ تم التحويل", `wd_ok:${requestId}`)
    .text("❌ رفض وإعادة الرصيد", `wd_no:${requestId}`);

  await ctx.reply(
    `📋 تم استلام طلب السحب.\n\n` +
    `رقم الطلب: ${requestId}\n` +
    `المبلغ المطلوب: ${money(amount, currency)}\n` +
    `العمولة 10%: ${money(fee, currency)}\n` +
    `المبلغ الصافي: ${money(net, currency)}\n\n` +
    `الحالة: قيد المراجعة.\nسيتم إشعارك عند تنفيذ الطلب.`,
    { reply_markup: mainKeyboard() }
  );

  await notifyAdmin(
    `💸 طلب سحب جديد\n\n` +
    `رقم الطلب: ${requestId}\n` +
    `اللاعب: ${player.username}\n` +
    `الحساب: ${player.accountId}\n` +
    `Telegram ID: ${id}\n` +
    `المبلغ: ${money(amount, currency)}\n` +
    `العمولة: ${money(fee, currency)}\n` +
    `الصافي: ${money(net, currency)}\n` +
    `عنوان الاستلام: ${address}`,
    keyboard
  );
}

// ================= ADMIN CALLBACKS =================

bot.callbackQuery(/^dep_ok:(.+)$/, async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCallbackQuery("غير مصرح.");

  const request = db.deposits[ctx.match[1]];

  if (!request || request.status !== "pending") {
    return ctx.answerCallbackQuery("الطلب غير متاح أو تمت معالجته.");
  }

  const player = getPlayer(request.telegramId);

  if (!player) return ctx.answerCallbackQuery("اللاعب غير موجود.");

  const key = request.currency === "SYP" ? "syp" : "usd";

  player[key] += request.amount;
  request.status = "approved";
  request.processedAt = new Date().toISOString();

  saveDB();

  await bot.api.sendMessage(
    Number(request.telegramId),
    `✅ تم تأكيد الشحن بنجاح!\n\n` +
    `رقم الطلب: ${request.id}\n` +
    `المبلغ المضاف: ${money(request.amount, request.currency)}`
  );

  await ctx.editMessageText(
    `✅ تمت الموافقة على طلب الشحن ${request.id}\nتمت إضافة الرصيد.`
  );

  await ctx.answerCallbackQuery("تم قبول الشحن.");
});

bot.callbackQuery(/^dep_no:(.+)$/, async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCallbackQuery("غير مصرح.");

  const request = db.deposits[ctx.match[1]];

  if (!request || request.status !== "pending") {
    return ctx.answerCallbackQuery("الطلب غير متاح.");
  }

  request.status = "rejected";
  saveDB();

  await bot.api.sendMessage(
    Number(request.telegramId),
    `❌ تم رفض طلب الشحن.\nرقم الطلب: ${request.id}\nيرجى التواصل مع الدعم.`
  );

  await ctx.editMessageText(`❌ تم رفض طلب الشحن ${request.id}`);
  await ctx.answerCallbackQuery("تم رفض الطلب.");
});

bot.callbackQuery(/^wd_ok:(.+)$/, async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCallbackQuery("غير مصرح.");

  const request = db.withdrawals[ctx.match[1]];

  if (!request || request.status !== "pending") {
    return ctx.answerCallbackQuery("الطلب غير متاح.");
  }

  request.status = "paid";
  request.processedAt = new Date().toISOString();

  saveDB();

  await bot.api.sendMessage(
    Number(request.telegramId),
    `✅ تم تحويل المبلغ بنجاح!\n\n` +
    `رقم الطلب: ${request.id}\n` +
    `المبلغ الأصلي: ${money(request.amount, request.currency)}\n` +
    `عمولة السحب 10%: ${money(request.fee, request.currency)}\n` +
    `المبلغ المحول إليك: ${money(request.net, request.currency)}`
  );

  await ctx.editMessageText(`✅ تم تأكيد تحويل طلب السحب ${request.id}`);
  await ctx.answerCallbackQuery("تم تأكيد التحويل.");
});

bot.callbackQuery(/^wd_no:(.+)$/, async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCallbackQuery("غير مصرح.");

  const request = db.withdrawals[ctx.match[1]];

  if (!request || request.status !== "pending") {
    return ctx.answerCallbackQuery("الطلب غير متاح.");
  }

  const player = getPlayer(request.telegramId);

  if (player) {
    const key = request.currency === "SYP" ? "syp" : "usd";
    player[key] += request.amount;
  }

  request.status = "rejected";
  request.processedAt = new Date().toISOString();

  saveDB();

  await bot.api.sendMessage(
    Number(request.telegramId),
    `❌ تم رفض طلب السحب.\nرقم الطلب: ${request.id}\nتمت إعادة المبلغ إلى رصيدك.`
  );

  await ctx.editMessageText(
    `❌ تم رفض طلب السحب ${request.id} وإعادة الرصيد.`
  );

  await ctx.answerCallbackQuery("تم رفض السحب وإعادة الرصيد.");
});

// ================= SUPPORT REPLIES =================

// Admin replies directly to the notification message.
bot.on("message:text", async (ctx, next) => {
  if (!isAdmin(ctx)) return next();

  const reply = ctx.message.reply_to_message;
  if (!reply) return next();

  const match = reply.text?.match(/Telegram ID: (\d+)/);

  if (!match) return next();

  const userId = match[1];

  try {
    await bot.api.sendMessage(
      Number(userId),
      `📩 رد من دعم LION GAMES:\n\n${ctx.message.text}`
    );

    await ctx.reply("✅ تم إرسال الرد للاعب.");
  } catch (e) {
    await ctx.reply("تعذر إرسال الرد. تأكد أن اللاعب بدأ البوت.");
  }
});

// ================= ADMIN COMMAND =================

bot.command("admin", async (ctx) => {
  if (!isAdmin(ctx)) return;

  const players = Object.keys(db.players).length;

  const deposits = Object.values(db.deposits)
    .filter(x => x.status === "pending").length;

  const withdrawals = Object.values(db.withdrawals)
    .filter(x => x.status === "pending").length;

  await ctx.reply(
    `🦁 LION GAMES ADMIN\n\n` +
    `عدد اللاعبين: ${players}\n` +
    `طلبات الشحن المعلقة: ${deposits}\n` +
    `طلبات السحب المعلقة: ${withdrawals}`
  );
});

// ================= ERROR HANDLING =================

bot.catch((err) => {
  console.error("Bot error:", err.message);
});

// ================= START BOT =================

bot.start({
  onStart: (info) => {
    console.log("================================");
    console.log("LION GAMES BOT IS RUNNING");
    console.log("Bot:", info.username);
    console.log("================================");
  }
});

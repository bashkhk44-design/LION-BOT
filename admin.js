const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const app = express();
const PORT = process.env.PORT || process.env.ADMIN_PORT || 3000;
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID || "5113787057";
const DB_FILE = path.join(__dirname, "lion_database.json");
const MASTER_FILE = path.join(__dirname, "admin", "data", "master.json");

if (!TOKEN || !ADMIN_ID || !/^\d+$/.test(ADMIN_ID)) {
  console.error("Set valid TELEGRAM_BOT_TOKEN and numeric ADMIN_ID.");
  process.exit(1);
}

// Derive the session secret from the bot token; no third host variable is needed.
const SESSION_SECRET = crypto.createHmac("sha256", TOKEN)
  .update("BOSS-EAGLE-MASTER-SESSION-v1").digest("hex");

fs.mkdirSync(path.dirname(MASTER_FILE), { recursive: true });

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(helmet());
app.use(express.urlencoded({ extended: false, limit: "10kb" }));
app.use(session({
  name: "boss_master",
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  proxy: true,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: "auto",
    maxAge: 30 * 24 * 60 * 60 * 1000
  }
}));

app.use(express.static(path.join(__dirname, "admin", "public")));

function csrf(req) {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(32).toString("hex");
  return req.session.csrf;
}
function validCsrf(req) {
  return typeof req.body.csrf === "string" && req.body.csrf === req.session.csrf;
}
function page(title, body) {
  return `<!doctype html><html lang="ar" dir="rtl"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} | BOSS EAGLE BET</title><link rel="stylesheet" href="/style.css"></head>
<body><main class="container">${body}</main></body></html>`;
}
function readMaster() {
  try {
    if (!fs.existsSync(MASTER_FILE)) return null;
    const data = JSON.parse(fs.readFileSync(MASTER_FILE, "utf8"));
    return typeof data.passwordHash === "string" ? data.passwordHash : null;
  } catch (e) {
    console.error("Master file read error:", e.message);
    throw e;
  }
}
function saveMaster(hash) {
  const tmp = MASTER_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify({ passwordHash: hash, updatedAt: new Date().toISOString() }), { mode: 0o600 });
  fs.renameSync(tmp, MASTER_FILE);
  try { fs.chmodSync(MASTER_FILE, 0o600); } catch {}
}
let setupCodeHash = null;
let setupCodeExpires = 0;
let lastCodeSent = 0;

async function sendSetupCode() {
  const code = String(crypto.randomInt(100000, 1000000));
  const response = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: ADMIN_ID,
      text: `🔐 رمز إعداد لوحة BOSS EAGLE BET MASTER: ${code}\nصالح لمدة 5 دقائق. لا تشاركه مع أحد.`
    })
  });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.description || "Telegram send failed");
  setupCodeHash = crypto.createHash("sha256").update(code).digest("hex");
  setupCodeExpires = Date.now() + 5 * 60 * 1000;
}

app.get("/admin", (req, res) => res.redirect("/"));

app.get("/", (req, res) => {
  let hash;
  try { hash = readMaster(); } catch { return res.status(500).send("ملف إعداد المدير تالف. راجع ملفات السيرفر."); }

  if (!hash) {
    return res.send(page("إعداد MASTER", `
<section class="panel login"><h1>🦅 BOSS EAGLE BET</h1>
<p>الإعداد الأول للمدير الرئيسي MASTER</p>
<form method="POST" action="/send-code">
<input type="hidden" name="csrf" value="${csrf(req)}">
<button type="submit">إرسال رمز التحقق إلى Telegram</button></form>
<form method="POST" action="/setup">
<input type="hidden" name="csrf" value="${csrf(req)}">
<label>رمز التحقق</label><input name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required>
<label>اختر كلمة مرور MASTER (12 حرفاً على الأقل)</label>
<input type="password" name="password" minlength="12" maxlength="200" autocomplete="new-password" required>
<label>تأكيد كلمة المرور</label>
<input type="password" name="confirm" minlength="12" maxlength="200" autocomplete="new-password" required>
<button type="submit">حفظ كلمة المرور</button></form></section>`));
  }

  if (!req.session.master) {
    return res.send(page("دخول المدير", `
<section class="panel login"><h1>🦅 BOSS EAGLE BET</h1><p>دخول المدير الرئيسي MASTER</p>
<form method="POST" action="/login"><input type="hidden" name="csrf" value="${csrf(req)}">
<label>كلمة مرور المدير</label><input type="password" name="password" required maxlength="200" autocomplete="current-password">
<button type="submit">تسجيل الدخول</button></form></section>`));
  }

  let db = { players: {}, deposits: {}, withdrawals: {} };
  try {
    if (fs.existsSync(DB_FILE)) db = { ...db, ...JSON.parse(fs.readFileSync(DB_FILE, "utf8")) };
  } catch { return res.status(500).send("تعذر قراءة قاعدة البيانات."); }

  const players = Object.keys(db.players || {}).length;
  const deposits = Object.values(db.deposits || {}).filter(x => x.status === "pending").length;
  const withdrawals = Object.values(db.withdrawals || {}).filter(x => x.status === "pending").length;

  let agentCount = 0;
  try {
    const agentFile = path.join(__dirname, "admin", "data", "agents.json");
    if (fs.existsSync(agentFile)) {
      const agentData = JSON.parse(fs.readFileSync(agentFile, "utf8"));
      agentCount = Array.isArray(agentData.agents) ? agentData.agents.filter(a => a.active).length : 0;
    }
  } catch (e) { console.error("Agent summary error:", e.message); }
  const transactions = Array.isArray(db.adminTransactions) ? db.adminTransactions.length : 0;
  const uptime = Math.floor(process.uptime() / 60);
  res.send(page("لوحة MASTER", `
<div class="dashboard-shell">
 <aside class="sidebar">
  <div class="side-brand"><div class="eagle-mark">🦅</div><div><b>BOSS EAGLE</b><small>MASTER CONTROL</small></div></div>
  <div class="side-caption">القائمة الرئيسية</div>
  <a class="side-link active" href="/"><span>▦</span> لوحة التحكم</a>
  <a class="side-link" href="/agents"><span>♙</span> الوكلاء ورؤساء الوكلاء</a>
  <a class="side-link" href="/players"><span>♧</span> حسابات اللاعبين</a>
  <a class="side-link" href="/deposits"><span>＋</span> طلبات الإيداع <i>${deposits}</i></a>
  <a class="side-link" href="/withdrawals"><span>－</span> طلبات السحب <i>${withdrawals}</i></a>
  <div class="side-caption">النظام</div><a class="side-link" href="#system"><span>⌘</span> حالة النظام</a>
  <div class="side-footer"><span class="online-dot"></span> MASTER متصل</div>
 </aside>
 <section class="dashboard-main">
  <header class="dash-topbar"><div><small>مركز الإدارة / الرئيسية</small><h1>لوحة التحكم الرئيسية</h1></div>
   <form method="POST" action="/logout"><input type="hidden" name="csrf" value="${csrf(req)}"><button class="secondary">تسجيل الخروج</button></form>
  </header>
  <section class="welcome-banner"><div><span class="eyebrow">BOSS EAGLE BET • CONTROL CENTER</span><h2>مرحباً بك، MASTER</h2><p>إدارة ومتابعة النظام من مكان واحد.</p></div><div class="banner-emblem">🦅</div></section>
  <div class="section-heading"><div><small>نظرة عامة</small><h2>ملخص المنصة</h2></div><span class="live-label"><b></b> النظام يعمل</span></div>
  <section class="stat-grid">
   <a class="stat-card" href="/players"><span class="stat-icon">♙</span><small>إجمالي اللاعبين</small><strong>${players}</strong><em>عرض الحسابات ←</em></a>
   <a class="stat-card" href="/agents"><span class="stat-icon">♧</span><small>الوكلاء النشطون</small><strong>${agentCount}</strong><em>إدارة شبكة الوكلاء ←</em></a>
   <a class="stat-card" href="/deposits"><span class="stat-icon">＋</span><small>إيداعات بانتظار المراجعة</small><strong>${deposits}</strong><em>مراجعة الطلبات ←</em></a>
   <a class="stat-card" href="/withdrawals"><span class="stat-icon">－</span><small>سحوبات بانتظار المراجعة</small><strong>${withdrawals}</strong><em>مراجعة الطلبات ←</em></a>
  </section>
  <div class="section-heading"><div><small>اختصارات الإدارة</small><h2>الوصول السريع</h2></div></div>
  <section class="quick-grid">
   <a href="/agents"><span>♙</span><b>إدارة الوكلاء</b><small>إنشاء رئيس وكلاء أو وكيل وربط التبعية</small><strong>فتح القسم ←</strong></a>
   <a href="/players"><span>♧</span><b>إدارة اللاعبين</b><small>البحث عن الحسابات وتعديل الأرصدة</small><strong>فتح القسم ←</strong></a>
   <a href="/deposits"><span>＋</span><b>طلبات الإيداع</b><small>مراجعة طلبات شحن الحسابات</small><strong>فتح القسم ←</strong></a>
   <a href="/withdrawals"><span>↗</span><b>طلبات السحب</b><small>متابعة طلبات السحب ومعالجتها</small><strong>فتح القسم ←</strong></a>
  </section>
  <section class="system-panel" id="system"><div><small>مراقبة التشغيل</small><h2>حالة النظام</h2><p><span class="online-dot"></span> لوحة الإدارة تعمل على الخادم</p></div>
   <div class="system-metrics"><div><small>إصدار Node.js</small><b>${esc(process.version)}</b></div><div><small>منفذ التطبيق</small><b>${esc(PORT)}</b></div><div><small>مدة التشغيل</small><b>${uptime} دقيقة</b></div><div><small>سجل عمليات الإدارة</small><b>${transactions}</b></div></div>
  </section>
  <footer class="dash-footer">BOSS EAGLE BET MASTER <span>لوحة الإدارة الرئيسية</span></footer>
 </section>
</div>`));
});

app.post("/send-code", async (req, res) => {
  if (!validCsrf(req)) return res.status(403).send("طلب غير صالح. أعد تحميل الصفحة.");
  if (readMaster()) return res.redirect("/");
  if (Date.now() - lastCodeSent < 60 * 1000) return res.status(429).send("انتظر دقيقة قبل طلب رمز جديد.");
  lastCodeSent = Date.now();
  try {
    await sendSetupCode();
    return res.send(page("تم الإرسال", "<section class='panel'><h2>تم إرسال رمز التحقق إلى Telegram الخاص بالمدير.</h2><a href='/'>العودة للإعداد</a></section>"));
  } catch (e) {
    console.error("Setup code error:", e.message);
    return res.status(502).send("تعذر إرسال الرمز. تأكد أن البوت يعمل وأن المدير بدأ المحادثة معه.");
  }
});

app.post("/setup", async (req, res) => {
  if (!validCsrf(req)) return res.status(403).send("طلب غير صالح. أعد تحميل الصفحة.");
  if (readMaster()) return res.redirect("/");
  const code = String(req.body.code || "");
  const password = String(req.body.password || "");
  const confirm = String(req.body.confirm || "");
  if (!setupCodeHash || Date.now() > setupCodeExpires) return res.status(400).send("رمز التحقق غير موجود أو انتهت صلاحيته. اطلب رمزاً جديداً.");
  const suppliedHash = crypto.createHash("sha256").update(code).digest();
  const expectedHash = Buffer.from(setupCodeHash, "hex");
  if (!/^\d{6}$/.test(code) || suppliedHash.length !== expectedHash.length || !crypto.timingSafeEqual(suppliedHash, expectedHash)) {
    return res.status(400).send("رمز التحقق غير صحيح.");
  }
  if (password.length < 12 || password.length > 200) return res.status(400).send("كلمة المرور يجب أن تكون بين 12 و200 حرف.");
  if (password !== confirm) return res.status(400).send("كلمتا المرور غير متطابقتين.");
  try {
    const hash = await bcrypt.hash(password, 12);
    saveMaster(hash);
    setupCodeHash = null;
    setupCodeExpires = 0;
    req.session.regenerate(err => {
      if (err) return res.status(500).send("تم حفظ كلمة المرور لكن تعذر إنشاء الجلسة. افتح الصفحة وسجل الدخول.");
      req.session.master = true;
      req.session.csrf = crypto.randomBytes(32).toString("hex");
      res.redirect("/");
    });
  } catch (e) {
    console.error("Master setup error:", e.message);
    res.status(500).send("تعذر حفظ إعداد المدير.");
  }
});

app.post("/login", async (req, res) => {
  if (!validCsrf(req)) return res.status(403).send("طلب غير صالح. أعد تحميل الصفحة.");
  const hash = readMaster();
  if (!hash) return res.redirect("/");
  const password = String(req.body.password || "");
  if (password.length > 200 || !(await bcrypt.compare(password, hash))) {
    return res.status(401).send("كلمة المرور غير صحيحة. <a href='/'>حاول مجدداً</a>");
  }
  req.session.regenerate(err => {
    if (err) return res.status(500).send("تعذر إنشاء جلسة الدخول.");
    req.session.master = true;
    req.session.csrf = crypto.randomBytes(32).toString("hex");
    res.redirect("/");
  });
});

app.post("/logout", (req, res) => {
  if (!validCsrf(req)) return res.status(403).send("طلب غير صالح.");
  req.session.destroy(() => res.redirect("/"));
});

require("./admin/agents")(app, { csrf, validCsrf, page });
require("./admin/players")(app, { csrf, validCsrf, page });
require("./admin/requests")(app, { csrf, validCsrf, page });

app.listen(PORT, "0.0.0.0", () => {
  console.log(`BOSS MASTER PANEL running on port ${PORT}`);
});

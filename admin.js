const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || process.env.ADMIN_PORT || 3000;
const MASTER_PASSWORD = process.env.MASTER_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET;

if (!MASTER_PASSWORD || !SESSION_SECRET || SESSION_SECRET.length < 32) {
  console.error("Set MASTER_PASSWORD and SESSION_SECRET (32+ characters).");
  process.exit(1);
}

const passwordHash = bcrypt.hashSync(MASTER_PASSWORD, 12);
const DB_FILE = path.join(__dirname, "lion_database.json");

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(helmet());
app.use(express.urlencoded({ extended: false, limit: "10kb" }));
app.use(session({
  name: "boss_master",
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    maxAge: 30 * 60 * 1000
  }
}));

app.use(express.static(path.join(__dirname, "admin", "public")));

function csrf(req) {
  if (!req.session.csrf) {
    req.session.csrf = crypto.randomBytes(32).toString("hex");
  }
  return req.session.csrf;
}

function validCsrf(req) {
  return typeof req.body.csrf === "string" &&
    req.body.csrf === req.session.csrf;
}

function page(title, body) {
  return `<!doctype html>
  <html lang="ar" dir="rtl">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${title} | BOSS EAGLE BET</title>
    <link rel="stylesheet" href="/style.css">
  </head>
  <body><main class="container">${body}</main></body></html>`;
}

app.get("/", (req, res) => {
  if (!req.session.master) {
    return res.send(page("دخول المدير", `
      <section class="panel login">
        <h1>🦅 BOSS EAGLE BET</h1>
        <p>دخول المدير الرئيسي MASTER</p>
        <form method="POST" action="/login">
          <input type="hidden" name="csrf" value="${csrf(req)}">
          <label>كلمة مرور المدير</label>
          <input type="password" name="password" required minlength="8" autocomplete="current-password">
          <button type="submit">تسجيل الدخول</button>
        </form>
      </section>
    `));
  }

  let db = { players: {}, deposits: {}, withdrawals: {} };
  try {
    if (fs.existsSync(DB_FILE)) {
      db = { ...db, ...JSON.parse(fs.readFileSync(DB_FILE, "utf8")) };
    }
  } catch {
    return res.status(500).send("تعذر قراءة قاعدة البيانات.");
  }

  const players = Object.keys(db.players || {}).length;
  const deposits = Object.values(db.deposits || {}).filter(x => x.status === "pending").length;
  const withdrawals = Object.values(db.withdrawals || {}).filter(x => x.status === "pending").length;

  res.send(page("لوحة MASTER", `
    <header class="top">
      <div><h1>🦅 BOSS EAGLE BET</h1><p>لوحة المدير الرئيسي</p></div>
      <form method="POST" action="/logout">
        <input type="hidden" name="csrf" value="${csrf(req)}">
        <button class="secondary">خروج</button>
      </form>
    </header>
    <section class="grid">
      <a class="panel nav-card" href="/players"><small>👥 الحسابات المسجلة</small><strong>${players}</strong></a>
      <a class="panel nav-card" href="/deposits"><small>💰 طلبات الإيداع المعلقة</small><strong>${deposits}</strong></a>
      <a class="panel nav-card" href="/withdrawals"><small>💸 طلبات السحب المعلقة</small><strong>${withdrawals}</strong></a>
    </section>
    <section class="panel">
      <h2>🦅 إدارة النظام</h2>
      <nav class="admin-menu">
        <a href="/agents">👥 إدارة الوكلاء</a>
        <a href="/players">👤 إدارة اللاعبين</a>
        <a href="/deposits">💰 طلبات الإيداع</a>
        <a href="/withdrawals">💸 طلبات السحب</a>
      </nav>
    </section>
  `));
});

app.post("/login", async (req, res) => {
  if (!validCsrf(req)) return res.status(403).send("طلب غير صالح. أعد تحميل الصفحة.");
  const password = String(req.body.password || "");
  if (password.length > 200 || !(await bcrypt.compare(password, passwordHash))) {
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

require("./admin/agents")(app,{csrf,validCsrf,page});
require("./admin/players")(app,{csrf,validCsrf,page});
require("./admin/requests")(app,{csrf,validCsrf,page});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`BOSS MASTER PANEL running on port ${PORT}`);
});

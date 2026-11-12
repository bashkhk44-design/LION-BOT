const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const auth = require("./admin/auth");

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const app = express();
const PORT = Number(process.env.PORT || process.env.ADMIN_PORT || 8080);
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID || "5113787057";
const DB_FILE = path.join(__dirname, "lion_database.json");
const MASTER_FILE = path.join(__dirname, "admin", "data", "master.json");

if (!ADMIN_ID || !/^\d+$/.test(ADMIN_ID)) {
  throw new Error("Set a numeric ADMIN_ID.");
}

// Keep the session secret independent from Telegram and stable across restarts.
const SECRET_FILE = path.join(__dirname, "admin", "data", "session-secret");
fs.mkdirSync(path.dirname(SECRET_FILE), { recursive: true });
let SESSION_SECRET = process.env.ADMIN_SESSION_SECRET;
if (!SESSION_SECRET) {
  try { SESSION_SECRET = fs.readFileSync(SECRET_FILE, "utf8").trim(); } catch {}
  if (!SESSION_SECRET) {
    SESSION_SECRET = crypto.randomBytes(48).toString("hex");
    fs.writeFileSync(SECRET_FILE, SESSION_SECRET, { mode: 0o600 });
  }
}

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
  if (!TOKEN) throw new Error("TELEGRAM_BOT_TOKEN is not configured.");
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

// Direct setup-code page: useful when the root page is cached by a browser or proxy.
app.get("/request-code", (req, res) => {
  res.set("Cache-Control", "no-store");
  let hash;
  try {
    hash = readMaster();
  } catch {
    return res.status(500).send("ملف إعداد المدير تالف. راجع ملفات السيرفر.");
  }
  if (hash) return res.redirect("/");
  return res.send(page("طلب رمز HEAD", `
    <section class="panel login">
      <h1>🦅 BOSS EAGLE BET</h1>
      <p>إرسال رمز التحقق إلى Telegram الخاص بالمدير الرئيسي</p>
      <form method="POST" action="/send-code">
        <input type="hidden" name="csrf" value="${csrf(req)}">
        <button type="submit">إرسال رمز التحقق إلى Telegram</button>
      </form>
      <p><a href="/">العودة إلى صفحة إعداد HEAD</a></p>
    </section>`));
});

app.get("/admin", (req, res) => res.redirect("/"));

app.get("/", (req, res) => {
  let hash;
  try {
    hash = readMaster();
  } catch {
    return res.status(500).send("ملف إعداد المدير تالف. راجع ملفات السيرفر.");
  }

  if (!hash) {
    return res.send(page("إعداد HEAD", `
      <section class="panel login"><h1>🦅 BOSS EAGLE BET</h1>
      <p>الإعداد الأول للمدير الرئيسي HEAD</p>
      <form method="POST" action="/send-code">
        <input type="hidden" name="csrf" value="${csrf(req)}">
        <button type="submit">إرسال رمز التحقق إلى Telegram</button>
      </form>
      <form method="POST" action="/setup">
        <input type="hidden" name="csrf" value="${csrf(req)}">
        <label>رمز التحقق</label>
        <input name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required>
        <label>كلمة مرور HEAD (12 حرفاً على الأقل)</label>
        <input type="password" name="password" minlength="12" maxlength="200" autocomplete="new-password" required>
        <label>تأكيد كلمة المرور</label>
        <input type="password" name="confirm" minlength="12" maxlength="200" required>
        <button type="submit">حفظ كلمة المرور</button>
      </form></section>`));
  }

  const agent = auth.current(req);
  if (!agent) {
    return res.send(page("تسجيل الدخول", `
      <section class="panel login"><h1>🦅 BOSS EAGLE BET</h1>
      <p>تسجيل الدخول إلى لوحة الإدارة</p>
      <form method="POST" action="/login">
        <input type="hidden" name="csrf" value="${csrf(req)}">
        <label>اسم المستخدم</label>
        <input name="username" maxlength="24" autocomplete="username">
        <label>كلمة المرور</label>
        <input type="password" name="password" required maxlength="200" autocomplete="current-password">
        <button type="submit">تسجيل الدخول</button>
      </form></section>`));
  }

  let db = { players: {}, deposits: {}, withdrawals: {} };
  try {
    if (fs.existsSync(DB_FILE)) {
      db = { ...db, ...JSON.parse(fs.readFileSync(DB_FILE, "utf8")) };
    }
  } catch {
    return res.status(500).send("تعذر قراءة قاعدة البيانات.");
  }

  const agents = auth.loadAgents();
  const roleNames = {
    HEAD: "HEAD",
    SUPER_MASTER: "SUPER MASTER",
    MASTER: "MASTER",
    CASHIER: "CASHIER"
  };
  const roleName = roleNames[agent.role] || "موظف";

  const playerEntries = Object.entries(db.players || {}).filter(
    ([id, player]) => auth.canAccessPlayer(agent, player, agents)
  );
  const visiblePlayerIds = new Set(playerEntries.map(([id]) => String(id)));

  function requestInScope(request) {
    if (agent.role === "HEAD") return true;
    const player = db.players && db.players[String(request.telegramId)];
    return !!(
      player &&
      request.ownerId &&
      player.ownerId &&
      String(request.ownerId) === String(player.ownerId) &&
      auth.canAccessPlayer(agent, player, agents)
    );
  }

  const deposits = Object.values(db.deposits || {}).filter(
    x => x.status === "pending" && requestInScope(x)
  ).length;

  const withdrawals = Object.values(db.withdrawals || {}).filter(
    x => x.status === "pending" && requestInScope(x)
  ).length;

  const visibleAgents = auth.descendants(agent, agents);
  const agentCount = visibleAgents.filter(
    a => a.id !== agent.id && a.active === true
  ).length;

  const transactions = (Array.isArray(db.adminTransactions) ? db.adminTransactions : [])
    .filter(tx => {
      if (agent.role === "HEAD") return true;
      const player = db.players && db.players[String(tx.telegramId)];
      return !!(player && visiblePlayerIds.has(String(tx.telegramId)) &&
        auth.canAccessPlayer(agent, player, agents));
    }).length;

  const uptime = Math.floor(process.uptime() / 60);
  const recentPlayers = playerEntries.slice(-4).reverse();
  const recentRequests = [
    ...Object.values(db.deposits || {}).map(x => ({ ...x, kind: "إيداع" })),
    ...Object.values(db.withdrawals || {}).map(x => ({ ...x, kind: "سحب" }))
  ].filter(requestInScope).sort((a, b) =>
    String(b.createdAt || b.date || "").localeCompare(String(a.createdAt || a.date || ""))
  ).slice(0, 4);
  const chartDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate() - (6 - i));
    return { date: d, count: 0 };
  });
  for (const tx of (Array.isArray(db.adminTransactions) ? db.adminTransactions : [])) {
    const d = new Date(tx.date || tx.createdAt || 0);
    const day = chartDays.find(x => x.date.toDateString() === d.toDateString());
    if (day) day.count++;
  }
  const chartMax = Math.max(1, ...chartDays.map(x => x.count));
  const chartBars = chartDays.map((x, i) => {
    const h = Math.max(5, Math.round((x.count / chartMax) * 100));
    return `<div class="chart-column"><span class="chart-value">${x.count}</span><i style="height:${h}%"></i><small>${["الأحد","الاثنين","الثلاثاء","الأربعاء","الخميس","الجمعة","السبت"][x.date.getDay()]}</small></div>`;
  }).join("");
  const playerRows = recentPlayers.length ? recentPlayers.map(([id, p]) =>
    `<div class="activity-row"><span class="activity-avatar">♟</span><div><b>${esc(p.username || p.accountId || "لاعب")}</b><small>${esc(p.accountId || id)}</small></div><em>لاعب</em></div>`
  ).join("") : '<p class="empty-note">لا يوجد لاعبون لعرضهم حالياً</p>';
  const requestRows = recentRequests.length ? recentRequests.map(r =>
    `<div class="activity-row"><span class="activity-avatar request-icon">▣</span><div><b>${esc(r.kind)} • ${esc(r.accountId || r.telegramId || "طلب")}</b><small>${esc(r.method || r.currency || "")} ${esc(r.amount || "")}</small></div><em class="request-state">${esc(r.status || "قيد المراجعة")}</em></div>`
  ).join("") : '<p class="empty-note">لا توجد طلبات حديثة</p>';

  const canSeeAgents = ["HEAD", "SUPER_MASTER", "MASTER"].includes(agent.role);

  const agentLink = canSeeAgents
    ? '<a class="side-link" href="/agents"><span>♙</span> الوكلاء والرتب</a>'
    : '';

  const agentCard = canSeeAgents
    ? `<a class="stat-card" href="/agents"><span class="stat-icon">♧</span><small>الوكلاء التابعون</small><strong>${agentCount}</strong><em>إدارة شبكة الوكلاء ←</em></a>`
    : '';

  const agentQuick = canSeeAgents
    ? '<a href="/agents"><span>♙</span><b>إدارة الوكلاء</b><small>إدارة الرتب التابعة لك</small><strong>فتح القسم ←</strong></a>'
    : '';

  res.send(page("لوحة " + roleName, `
  <div class="dashboard-shell">
   <aside class="sidebar">
    <div class="side-brand"><div class="eagle-mark">🦅</div><div><b>BOSS EAGLE</b><small>${roleName} CONTROL</small></div></div>
    <div class="side-caption">القائمة الرئيسية</div>
    <a class="side-link active" href="/"><span>▦</span> لوحة التحكم</a>
    ${agentLink}
    <a class="side-link" href="/players"><span>♧</span> حسابات اللاعبين</a>
    <a class="side-link" href="/deposits"><span>＋</span> طلبات الإيداع <i>${deposits}</i></a>
    <a class="side-link" href="/withdrawals"><span>－</span> طلبات السحب <i>${withdrawals}</i></a>
    <div class="side-caption">النظام</div>
    <a class="side-link" href="#system"><span>⌘</span> حالة النظام</a>
    <div class="side-footer"><span class="online-dot"></span> ${roleName} متصل</div>
   </aside>
   <section class="dashboard-main">
    <header class="dash-topbar">
     <div><small>BOSS EAGLE / ${roleName}</small><h1>لوحة التحكم</h1></div>
     <form method="POST" action="/logout">
      <input type="hidden" name="csrf" value="${csrf(req)}">
      <button class="secondary">تسجيل الخروج</button>
     </form>
    </header>
    <section class="welcome-banner">
     <div><span class="eyebrow">BOSS EAGLE BET • CONTROL CENTER</span>
      <h2>مرحباً بك، ${roleName}</h2>
      <p>إدارة ومتابعة الحسابات والطلبات ضمن صلاحياتك.</p>
     </div><div class="banner-emblem">🦅</div>
    </section>
    <div class="section-heading"><div><small>نظرة عامة</small><h2>ملخص حسابك</h2></div>
     <span class="live-label"><b></b> النظام يعمل</span>
    </div>
    <section class="stat-grid">
     <a class="stat-card" href="/players"><span class="stat-icon">♙</span><small>اللاعبون ضمن صلاحياتك</small><strong>${playerEntries.length}</strong><em>عرض الحسابات ←</em></a>
     ${agentCard}
     <a class="stat-card" href="/deposits"><span class="stat-icon">＋</span><small>إيداعات بانتظار المراجعة</small><strong>${deposits}</strong><em>مراجعة الطلبات ←</em></a>
     <a class="stat-card" href="/withdrawals"><span class="stat-icon">－</span><small>سحوبات بانتظار المراجعة</small><strong>${withdrawals}</strong><em>مراجعة الطلبات ←</em></a>
    </section>

    <section class="overview-grid">
     <div class="chart-panel">
      <div class="panel-heading"><div><small>متابعة النشاط</small><h2>إحصائيات العمليات • آخر 7 أيام</h2></div><span>▥</span></div>
      <div class="activity-chart">${chartBars}</div>
     </div>
     <div class="health-panel" id="system">
      <div class="panel-heading"><div><small>مراقبة مباشرة</small><h2>حالة النظام</h2></div><span class="health-check">✓</span></div>
      <div class="health-row"><span>حالة لوحة الإدارة</span><b class="state-ok">تعمل</b></div>
      <div class="health-row"><span>دور الحساب</span><b>${roleName}</b></div>
      <div class="health-row"><span>عدد اللاعبين</span><b>${playerEntries.length}</b></div>
      <div class="health-row"><span>عمليات مسجلة</span><b>${transactions}</b></div>
      <div class="health-row"><span>مدة التشغيل</span><b>${uptime} دقيقة</b></div>
     </div>
    </section>
    <section class="recent-grid">
     <div class="recent-panel"><div class="panel-heading"><div><small>الحسابات</small><h2>أحدث اللاعبين</h2></div><a href="/players">عرض الكل ←</a></div>${playerRows}</div>
     <div class="recent-panel"><div class="panel-heading"><div><small>المراجعة</small><h2>أحدث الطلبات</h2></div><a href="/deposits">عرض الطلبات ←</a></div>${requestRows}</div>
    </section>
    <div class="section-heading"><div><small>اختصارات الإدارة</small><h2>الوصول السريع</h2></div></div>
    <section class="quick-grid">
     ${agentQuick}
     <a href="/players"><span>♧</span><b>إدارة اللاعبين</b><small>البحث عن الحسابات وتعديل الأرصدة المسموحة</small><strong>فتح القسم ←</strong></a>
     <a href="/deposits"><span>＋</span><b>طلبات الإيداع</b><small>مراجعة الطلبات التابعة لك</small><strong>فتح القسم ←</strong></a>
     <a href="/withdrawals"><span>↗</span><b>طلبات السحب</b><small>متابعة الطلبات التابعة لك</small><strong>فتح القسم ←</strong></a>
    </section>
    <footer class="dash-footer">BOSS EAGLE BET <span>${roleName} PANEL</span></footer>
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

  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  if (!password || password.length > 200) {
    return res.status(401).send("بيانات الدخول غير صحيحة.");
  }

  let authenticatedAgent = null;

  if (username) {
    const agentsFile = path.join(__dirname, "admin", "data", "agents.json");
    try {
      const data = JSON.parse(fs.readFileSync(agentsFile, "utf8"));
      const agents = Array.isArray(data.agents) ? data.agents : [];
      const agent = agents.find(a =>
        String(a.username || "").toLowerCase() === username.toLowerCase() &&
        a.active === true
      );

      if (agent && await bcrypt.compare(password, agent.passwordHash)) {
        const allowedRoles = ["HEAD", "HEAD_AGENT", "SUPER_MASTER", "MASTER", "CASHIER"];
        if (allowedRoles.includes(agent.role)) {
          authenticatedAgent = agent;
          if (agent.role === "HEAD_AGENT") {
            agent.role = "HEAD";
            const temp = agentsFile + ".tmp";
            fs.writeFileSync(temp, JSON.stringify({ agents }, null, 2), { mode: 0o600 });
            fs.renameSync(temp, agentsFile);
          }
        }
      }
    } catch (e) {
      if (e.code !== "ENOENT") {
        console.error("Agent login error:", e.message);
        return res.status(500).send("تعذر التحقق من حساب الموظف.");
      }
      // Older HEAD installations may only have master.json, without agents.json.
      const legacyHash = readMaster();
      if (!legacyHash || !(await bcrypt.compare(password, legacyHash))) {
        return res.status(401).send("اسم المستخدم أو كلمة المرور غير صحيحة.");
      }
    }

    if (!authenticatedAgent && fs.existsSync(path.join(__dirname, "admin", "data", "agents.json"))) {
      return res.status(401).send("اسم المستخدم أو كلمة المرور غير صحيحة.");
    }
  } else {
    const hash = readMaster();
    if (!hash || !(await bcrypt.compare(password, hash))) {
      return res.status(401).send("كلمة المرور غير صحيحة.");
    }
  }

  req.session.regenerate(err => {
    if (err) return res.status(500).send("تعذر إنشاء جلسة الدخول.");

    req.session.role = authenticatedAgent
      ? (authenticatedAgent.role === "HEAD_AGENT" ? "HEAD" : authenticatedAgent.role)
      : "HEAD";
    req.session.agentId = authenticatedAgent ? authenticatedAgent.id : null;
    req.session.username = authenticatedAgent ? authenticatedAgent.username : "MASTER";
    req.session.master = req.session.role === "HEAD";
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

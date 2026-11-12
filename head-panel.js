"use strict";
const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const app = express();
const DATA_DIR = path.join(__dirname, "admin", "data");
const TREE_FILE = path.join(DATA_DIR, "head-tree.json");
const DB_FILE = path.join(__dirname, "lion_database.json");
fs.mkdirSync(DATA_DIR, { recursive: true });
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.urlencoded({ extended: false, limit: "20kb" }));
app.use(session({
  name: "lion_head_session",
  secret: process.env.HEAD_SESSION_SECRET || process.env.SESSION_SECRET || "temporary-secret-change-this",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "strict", secure: "auto", maxAge: 8 *  60 * 60 * 1000 }
}));
const style = "@import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap');:root{color-scheme:dark;--gold:#e8c36b;--bg:#08090c;--line:#34302a}*{box-sizing:border-box}body{margin:0;background:radial-gradient(ellipse at 85% 0,#33250d55,transparent 32%),var(--bg);color:#f4f1e8;font-family:Cairo,Tahoma,sans-serif}a{color:#e8c36b;text-decoration:none}.wrap{width:min(1200px,calc(100% - 28px));margin:25px auto}.top{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:19px 22px;border:1px solid #9b742b;border-radius:16px;background:linear-gradient(110deg,#211a0d,#101115 65%,#211a0d)}.brand{display:flex;align-items:center;gap:13px}.logo{display:grid;place-items:center;width:48px;height:48px;border:1px solid #e8c36b;border-radius:13px;background:#33250f;color:#ffe7a4;font-size:25px}.brand b{display:block;color:#ffe4a0;font-size:19px}.brand small{color:#a99a77;font-size:10px;letter-spacing:2px}.btn,button{display:inline-block;border:1px solid #e6c36c;border-radius:9px;padding:9px 16px;background:linear-gradient(130deg,#ffe7a0,#b8862c);color:#1b1508;font:700 13px Cairo;cursor:pointer}.secondary{background:#191a1e;color:#e8d29b;border-color:#51442a}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:13px;margin:18px 0}.card,.section{padding:18px;border:1px solid var(--line);border-radius:14px;background:linear-gradient(145deg,#171a20,#101216);min-width:0}.card small,.muted{color:#9da4b1;font-size:12px}.value{display:block;margin-top:8px;color:#ffe3a0;font-size:30px;font-weight:800}.section{margin-top:18px;background:#11141a}.section h2{margin:0 0 14px;color:#f3d78f;font-size:18px}.row{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:12px 5px;border-bottom:1px solid #ffffff12}.row:last-child{border:0}.tag{font-size:11px;padding:3px 9px;border-radius:20px;background:#273326;color:#8fe0a7}.tree{margin:10px auto 0;max-width:760px}.node{padding:12px 15px;margin:8px 0;border:1px solid #725b2c;border-radius:11px;background:linear-gradient(110deg,#241d10,#141519);display:flex;justify-content:space-between;gap:10px}.node.child{margin-right:28px;border-color:#45403a;background:#17191e}.login{max-width:420px;margin:9vh auto}label{display:block;margin:12px 0 5px;color:#e6d19b}input{width:100%;padding:12px;border:1px solid #5b4a29;border-radius:9px;background:#090b0f;color:white;font:14px Cairo}button{width:100%;margin-top:17px}.notice{padding:12px;border:1px solid #725b2c;border-radius:10px;background:#241d10;color:#e8d29b;margin:14px 0}@media(max-width:760px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}.wrap{margin:12px auto}.top{padding:13px}.brand b{font-size:15px}.value{font-size:25px}.section{padding:14px}}";
function page(title, body) {
 return '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + title + ' | LION HEAD</title><style>' + style + '</style></head><body>' + body + '</body></html>';
}
function safe(v) {
 return String(v == null ? "" : v).replace(/[&<>"']/g, function(c) { return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; });
}
function readJson(file, fallback) {
 try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (_) { return fallback; }
}
function csrf(req) {
 if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString("hex");
 return req.session.csrf;
}
function validCsrf(req) {
 const a = Buffer.from(String(req.body._csrf || ""));
 const b = Buffer.from(String(req.session.csrf || ""));
 return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}
function configured(req, res, next) {
 if (!process.env.HEAD_USERNAME || !process.env.HEAD_PASSWORD || !(process.env.HEAD_SESSION_SECRET || process.env.SESSION_SECRET)) {
  return res.status(503).send(page("إعداد مطلوب", '<main class="wrap"><div class="section"><h2>إعداد لوحة HEAD مطلوب</h2><p>أضف المتغيرات HEAD_USERNAME وHEAD_PASSWORD وHEAD_SESSION_SECRET في إعدادات FadeHost ثم أعد التشغيل.</p></div></main>'));
 }
 next();
}
function auth(req, res, next) {
 if (req.session && req.session.headAuth === true) return next();
 res.redirect("/head/login");
}
app.get("/", function(req,res){res.redirect("/head");});
app.get("/head", configured, auth, function(req,res) {
 const db = readJson(DB_FILE, {});
 const players = db.players || db.users || {};
 const deposits = db.deposits || {};
 const withdrawals = db.withdrawals || {};
 const tree = readJson(TREE_FILE, {heads:[]});
 const pd = Object.values(deposits).filter(x => x && x.status === "pending").length;
 const pw = Object.values(withdrawals).filter(x => x && x.status === "pending").length;
 const pc = Object.keys(players).length;
 const heads = Array.isArray(tree.heads) ? tree.heads : [];
 let childHtml = "";
 heads.forEach(function(h) {
  const agents = Array.isArray(h.agents) ? h.agents : [];
  childHtml += '<div class="node"><span>👑 ' + safe(h.name || "رئيس مجموعة") + '</span><span class="tag">' + agents.length + ' وكلاء</span></div>';
  agents.forEach(function(a){childHtml += '<div class="node child"><span>♟ ' + safe(a.name || "وكيل") + '</span><span class="muted">' + safe(a.status || "نشط") + '</span></div>';});
 });
 if (!childHtml) childHtml = '<p class="muted">لا توجد بيانات وكلاء محفوظة حالياً. لم تتم إضافة بيانات تجريبية.</p>';
 const token = csrf(req);
 let body = '<main class="wrap"><header class="top"><div class="brand"><div class="logo">♛</div><div><b>LION GAMES</b><small>HEAD CONTROL CENTER</small></div></div><form method="post" action="/head/logout"><input type="hidden" name="_csrf" value="' + token + '"><button class="secondary" type="submit">تسجيل الخروج</button></form></header>';
 body += '<section class="grid"><div class="card"><small>إجمالي اللاعبين</small><strong class="value">' + pc + '</strong></div><div class="card"><small>رؤساء المجموعات</small><strong class="value">' + heads.length + '</strong></div><div class="card"><small>طلبات الشحن المعلقة</small><strong class="value">' + pd + '</strong></div><div class="card"><small>طلبات السحب المعلقة</small><strong class="value">' + pw + '</strong></div></section>';
 body += '<section class="section"><h2>نظرة عامة على النظام</h2><div class="row"><span>حالة لوحة HEAD</span><span class="tag">متصلة</span></div><div class="row"><span>حسابات اللاعبين</span><span>' + pc + '</span></div><div class="row"><span>طلبات الشحن قيد المراجعة</span><span>' + pd + '</span></div><div class="row"><span>طلبات السحب قيد المراجعة</span><span>' + pw + '</span></div></section>';
 body += '<section class="section"><h2>الشجرة الهرمية</h2><div class="tree"><div class="node"><span>🦁 MASTER</span><span class="tag">الجذر الرئيسي</span></div><div class="node child"><span>👑 HEAD</span><span class="tag">لوحة التحكم الحالية</span></div>' + childHtml + '</div></section><footer class="row muted"><span>LION HEAD • لوحة الإدارة العليا</span><span>جلسة آمنة</span></footer></main>';
 res.send(page("لوحة HEAD",body));
});
app.get("/head/login", configured, function(req,res) {
 if (req.session.headAuth) return res.redirect("/head");
 const body = '<main class="wrap login"><section class="section"><div class="brand" style="justify-content:center"><div class="logo">♛</div></div><h1 style="text-align:center;color:#ffe3a0">LION HEAD</h1><p class="muted" style="text-align:center">تسجيل الدخول إلى مركز التحكم</p><form method="post" action="/head/login"><input type="hidden" name="_csrf" value="' + csrf(req) + '"><label>اسم المستخدم</label><input name="username" autocomplete="username" required maxlength="80"><label>كلمة المرور</label><input type="password" name="password" autocomplete="current-password" required maxlength="200"><button type="submit">دخول آمن</button></form></section></main>';
 res.send(page("تسجيل الدخول",body));
});
app.post("/head/login", configured, function(req,res) {
 if (!validCsrf(req)) return res.status(403).send("طلب غير صالح. أعد تحميل الصفحة.");
 const equal = function(a,b){const x=Buffer.from(a);const y=Buffer.from(b);return x.length===y.length && crypto.timingSafeEqual(x,y);};
 if (!equal(String(req.body.username || ""),String(process.env.HEAD_USERNAME)) || !equal(String(req.body.password || ""),String(process.env.HEAD_PASSWORD))) {
  return res.status(401).send(page("رفض الدخول",'<main class="wrap"><section class="section"><h2>بيانات الدخول غير صحيحة</h2><a href="/head/login">العودة لتسجيل الدخول</a></section></main>'));
 }
 req.session.regenerate(function(err){
  if (err) return res.status(500).send("تعذر إنشاء الجلسة.");
  req.session.headAuth = true;
  req.session.csrf = crypto.randomBytes(24).toString("hex");
  res.redirect("/head");
 });
});
app.post("/head/logout", configured, auth, function(req,res) {
 if (!validCsrf(req)) return res.status(403).send("طلب غير صالح.");
 req.session.destroy(function(){res.redirect("/head/login");});
});
app.use(function(req,res){res.status(404).send(page("غير موجود",'<main class="wrap"><section class="section"><h2>الصفحة غير موجودة</h2><a href="/head">العودة إلى لوحة HEAD</a></section></main>'));});
const port = Number(process.env.PORT || 3000);
app.listen(port,"0.0.0.0",function(){console.log("LION HEAD panel listening on port " + port);});

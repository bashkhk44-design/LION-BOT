const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");

module.exports = function(app, helpers) {
  const file = path.join(__dirname, "data", "agents.json");
  const { csrf, validCsrf, page } = helpers;

  function load() {
    try {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      return Array.isArray(data.agents) ? data.agents : [];
    } catch {
      return [];
    }
  }

  function save(agents) {
    const temp = file + ".tmp";
    fs.writeFileSync(temp, JSON.stringify({ agents }, null, 2), { mode: 0o600 });
    fs.renameSync(temp, file);
  }

  function esc(value) {
    return String(value).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;",
      '"': "&quot;", "'": "&#39;"
    })[c]);
  }

  function guard(req, res, next) {
    if (!req.session.master) return res.redirect("/");
    next();
  }

  app.get("/agents", guard, (req, res) => {
    const agents = load();
    const heads = agents.filter(a => a.role === "HEAD_AGENT");

    const rows = agents.map(a => {
      const parent = agents.find(p => p.id === a.parentId);
      return `<tr>
        <td>${esc(a.id)}</td>
        <td>${esc(a.displayName)}</td>
        <td>${a.role === "HEAD_AGENT" ? "رئيس وكلاء" : "وكيل"}</td>
        <td>${esc(parent ? parent.displayName : "—")}</td>
        <td>${a.active ? "نشط" : "موقوف"}</td>
        <td><form method="POST" action="/agents/toggle">
          <input type="hidden" name="csrf" value="${csrf(req)}">
          <input type="hidden" name="id" value="${esc(a.id)}">
          <button type="submit">${a.active ? "إيقاف" : "تفعيل"}</button>
        </form></td>
      </tr>`;
    }).join("");

    res.send(page("إدارة الوكلاء", `
      <section class="panel">
        <h1>🦅 إدارة الوكلاء</h1>
        <p>إدارة حسابات رؤساء الوكلاء والوكلاء التابعين لهم</p>
        <form method="POST" action="/agents">
          <input type="hidden" name="csrf" value="${csrf(req)}">

          <label>الاسم الظاهر</label>
          <input name="displayName" required minlength="2" maxlength="60">

          <label>اسم المستخدم (4 إلى 24 حرفاً)</label>
          <input name="username" required minlength="4" maxlength="24" pattern="[A-Za-z0-9_]+">

          <label>كلمة مرور الوكيل (10 أحرف على الأقل)</label>
          <input type="password" name="password" required minlength="10" maxlength="100">

          <label>نوع الحساب</label>
          <select name="role" required>
            <option value="HEAD_AGENT">رئيس وكلاء</option>
            <option value="AGENT">وكيل</option>
          </select>

          <label>رئيس الوكلاء المسؤول</label>
          <select name="parentId">
            <option value="">بدون رئيس</option>
            ${heads.map(h => `<option value="${esc(h.id)}">${esc(h.displayName)}</option>`).join("")}
          </select>

          <button type="submit">إنشاء الحساب</button>
        </form>
      </section>

      <section class="panel">
        <h2>قائمة الوكلاء (${agents.length})</h2>
        <div style="overflow-x:auto">
          <table>
            <thead><tr>
              <th>رقم الحساب</th><th>الاسم</th><th>الصلاحية</th>
              <th>الرئيس</th><th>الحالة</th><th>الإجراء</th>
            </tr></thead>
            <tbody>${rows || "<tr><td colspan='6'>لا يوجد وكلاء حالياً</td></tr>"}</tbody>
          </table>
        </div>
        <p><a href="/">العودة إلى لوحة MASTER</a></p>
      </section>
    `));
  });

  app.post("/agents", guard, (req, res) => {
    if (!validCsrf(req)) return res.status(403).send("طلب غير صالح. أعد تحميل الصفحة.");

    const displayName = String(req.body.displayName || "").trim();
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");
    const role = req.body.role;
    const parentId = String(req.body.parentId || "");

    if (displayName.length < 2 || displayName.length > 60 ||
        !/^[A-Za-z0-9_]{4,24}$/.test(username) ||
        password.length < 10 || password.length > 100 ||
        !["HEAD_AGENT", "AGENT"].includes(role)) {
      return res.status(400).send("البيانات غير صحيحة. <a href='/agents'>رجوع</a>");
    }

    const agents = load();

    if (agents.some(a => a.username.toLowerCase() === username.toLowerCase())) {
      return res.status(409).send("اسم المستخدم مستخدم مسبقاً. <a href='/agents'>رجوع</a>");
    }

    if (role === "AGENT") {
      const parent = agents.find(a => a.id === parentId && a.role === "HEAD_AGENT");
      if (!parent) {
        return res.status(400).send("اختر رئيس وكلاء موجوداً. <a href='/agents'>رجوع</a>");
      }
    }

    const id = "AG-" + crypto.randomBytes(5).toString("hex").toUpperCase();

    agents.push({
      id,
      displayName,
      username,
      passwordHash: bcrypt.hashSync(password, 12),
      role,
      parentId: role === "AGENT" ? parentId : null,
      active: true,
      createdAt: new Date().toISOString()
    });

    save(agents);
    res.redirect("/agents");
  });
};

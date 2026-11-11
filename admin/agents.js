
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
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = file + ".tmp";
    fs.writeFileSync(temp, JSON.stringify({ agents }, null, 2), { mode: 0o600 });
    fs.renameSync(temp, file);
  }

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;",
      '"': "&quot;", "'": "&#39;"
    })[c]);
  }

  function guard(req, res, next) {
    if (!req.session || !req.session.master) {
      return res.redirect("/");
    }
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
        <td>
          <form method="POST" action="/agents/toggle">
            <input type="hidden" name="csrf" value="${csrf(req)}">
            <input type="hidden" name="id" value="${esc(a.id)}">
            <button type="submit">${a.active ? "إيقاف" : "تفعيل"}</button>
          </form>
        </td>
      </tr>`;
    }).join("");

    const treeCards = heads.map(h => {
      const children = agents.filter(a => a.parentId === h.id);
      const childHtml = children.map(a => "<div class=\"agent-tree-child\"><span class=\"tree-branch\">└</span><span class=\"tree-person\">♙ " + esc(a.displayName) + "</span><small>" + esc(a.id) + "</small><span class=\"tree-status " + (a.active ? "on" : "off") + "\">" + (a.active ? "نشط" : "موقوف") + "</span></div>").join("");
      return "<div class=\"agent-tree-head\"><div class=\"tree-head-main\"><span class=\"tree-crown\">♛</span><div><b>" + esc(h.displayName) + "</b><small>رئيس وكلاء · " + esc(h.id) + "</small></div><span class=\"tree-status " + (h.active ? "on" : "off") + "\">" + (h.active ? "نشط" : "موقوف") + "</span></div><div class=\"agent-tree-children\">" + (childHtml || "<div class=\"tree-empty\">لا يوجد وكلاء تابعون حالياً</div>") + "</div></div>";
    }).join("");
    const treePanel = "<section class=\"panel agent-tree-panel\"><div class=\"agent-tree-title\"><span>♧</span><div><h2>التسلسل الإداري</h2><small>MASTER ← رؤساء الوكلاء ← الوكلاء</small></div></div><div class=\"tree-master\">🦅 MASTER <small>المدير الرئيسي</small></div><div class=\"agent-tree-list\">" + (treeCards || "<div class=\"tree-empty\">أنشئ أول رئيس وكلاء لعرض الشجرة</div>") + "</div></section>";
    res.send(page("إدارة الوكلاء", `
      ${treePanel}
      <section class="panel">
        <h1>🦅 إدارة الوكلاء</h1>
        <p>إنشاء وإدارة رؤساء الوكلاء والوكلاء بواسطة MASTER فقط</p>

        <form method="POST" action="/agents">
          <input type="hidden" name="csrf" value="${csrf(req)}">

          <label>الاسم الظاهر</label>
          <input name="displayName" required minlength="2" maxlength="60">

          <label>اسم المستخدم</label>
          <input name="username" required minlength="4" maxlength="24"
            pattern="[A-Za-z0-9_]+">

          <label>كلمة المرور</label>
          <input type="password" name="password" required
            minlength="10" maxlength="100">

          <label>نوع الحساب</label>
          <select name="role" required>
            <option value="HEAD_AGENT">رئيس وكلاء</option>
            <option value="AGENT">وكيل</option>
          </select>

          <label>رئيس الوكلاء المسؤول</label>
          <select name="parentId">
            <option value="">بدون رئيس (لرئيس الوكلاء فقط)</option>
            ${heads.filter(h => h.active).map(h =>
              `<option value="${esc(h.id)}">${esc(h.displayName)}</option>`
            ).join("")}
          </select>

          <button type="submit">إنشاء الحساب</button>
        </form>
      </section>

      <section class="panel">
        <h2>قائمة الوكلاء (${agents.length})</h2>
        <div style="overflow-x:auto">
          <table>
            <thead>
              <tr>
                <th>رقم الحساب</th>
                <th>الاسم</th>
                <th>الصلاحية</th>
                <th>الرئيس</th>
                <th>الحالة</th>
                <th>الإجراء</th>
              </tr>
            </thead>
            <tbody>
              ${rows || "<tr><td colspan='6'>لا يوجد وكلاء حالياً</td></tr>"}
            </tbody>
          </table>
        </div>
        <p><a href="/">العودة إلى لوحة MASTER</a></p>
      </section>
    `));
  });

  app.post("/agents", guard, (req, res) => {
    if (!validCsrf(req)) {
      return res.status(403).send("طلب غير صالح. أعد تحميل الصفحة.");
    }

    const displayName = String(req.body.displayName || "").trim();
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");
    const role = req.body.role;
    const parentId = String(req.body.parentId || "");

    if (
      displayName.length < 2 ||
      displayName.length > 60 ||
      !/^[A-Za-z0-9_]{4,24}$/.test(username) ||
      password.length < 10 ||
      password.length > 100 ||
      !["HEAD_AGENT", "AGENT"].includes(role)
    ) {
      return res.status(400).send("البيانات غير صحيحة. <a href='/agents'>رجوع</a>");
    }

    const agents = load();

    if (agents.some(a =>
      String(a.username).toLowerCase() === username.toLowerCase()
    )) {
      return res.status(409).send("اسم المستخدم مستخدم مسبقاً.");
    }

    let assignedParent = null;

    if (role === "AGENT") {
      assignedParent = agents.find(a =>
        a.id === parentId &&
        a.role === "HEAD_AGENT" &&
        a.active === true
      );

      if (!assignedParent) {
        return res.status(400).send(
          "اختر رئيس وكلاء نشطاً. <a href='/agents'>رجوع</a>"
        );
      }
    }

    const id = "AG-" + crypto.randomBytes(5).toString("hex").toUpperCase();

    agents.push({
      id,
      displayName,
      username,
      passwordHash: bcrypt.hashSync(password, 12),
      role,
      parentId: assignedParent ? assignedParent.id : null,
      active: true,
      createdAt: new Date().toISOString()
    });

    save(agents);
    res.redirect("/agents");
  });

  app.post("/agents/toggle", guard, (req, res) => {
    if (!validCsrf(req)) {
      return res.status(403).send("طلب غير صالح.");
    }

    const id = String(req.body.id || "");
    const agents = load();
    const target = agents.find(a => a.id === id);

    if (!target) {
      return res.status(404).send("الحساب غير موجود.");
    }

    target.active = !target.active;

    save(agents);
    res.redirect("/agents");
  });
};

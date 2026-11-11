const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");

module.exports = function(app, helpers) {
  const file = path.join(__dirname, "data", "agents.json");
  const auth = require("./auth");
  const { csrf, validCsrf, page } = helpers;

  const ROLE_NAMES = {
    HEAD: "المدير الرئيسي",
    SUPER_MASTER: "رئيس الوكلاء",
    MASTER: "وكيل",
    CASHIER: "كاشيرة"
  };

  // إنشاء الرتب التابعة محصور بالمدير الرئيسي HEAD.
  const CREATABLE_ROLES = ["SUPER_MASTER", "MASTER", "CASHIER"];

  const BOT_USERNAME = "Lion_Games_2026_bot";
  const WEB_URL = "https://lion-games-2026-bot.fadehost.app";

  function load() {
    return auth.loadAgents();
  }

  function save(agents) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = file + ".tmp";
    fs.writeFileSync(temp, JSON.stringify({ agents }, null, 2), { mode: 0o600 });
    fs.renameSync(temp, file);
    try { fs.chmodSync(file, 0o600); } catch {}
  }

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;",
      '"': "&quot;", "'": "&#39;"
    })[c]);
  }

  function guard(req, res, next) {
    auth.guard(req, res, () => {
      if (req.agent.role !== "HEAD") {
        return res.status(403).send("إنشاء وإدارة الرتب متاحان للمدير الرئيسي فقط.");
      }
      next();
    });
  }

  function isInScope(actor, target, agents) {
    if (actor.role === "HEAD") return true;
    if (!target || target.id === actor.id) return true;
    return auth.descendants(actor, agents).some(a => a.id === target.id);
  }

  app.get("/agents", guard, (req, res) => {
    try {
      const actor = req.agent;
      const agents = load();
      const visible = agents.filter(a => isInScope(actor, a, agents));
      const canCreate = actor.role === "HEAD";

      const rows = visible.map(a => {
        const parent = agents.find(p => p.id === a.parentId);
        const isHead = a.role === "HEAD" || a.role === "HEAD_AGENT";
        const canToggle = !isHead && a.id !== actor.id &&
          (actor.role === "HEAD" || auth.descendants(actor, agents).some(x => x.id === a.id));

        const invite = a.role === "CASHIER" && a.inviteToken
          ? `https://t.me/${BOT_USERNAME}?start=invite_${encodeURIComponent(a.inviteToken)}`
          : "";

        return `<tr>
          <td>${esc(a.id)}</td>
          <td>${esc(a.displayName)}</td>
          <td>${esc(ROLE_NAMES[a.role] || a.role)}</td>
          <td>${esc(parent ? parent.displayName : "—")}</td>
          <td>${a.active ? "نشط" : "موقوف"}</td>
          <td>
            ${invite ? `<a href="${esc(invite)}" target="_blank" rel="noopener">رابط دعوة اللاعب</a>` : "—"}
            ${canToggle ? `<form method="POST" action="/agents/toggle">
              <input type="hidden" name="csrf" value="${csrf(req)}">
              <input type="hidden" name="id" value="${esc(a.id)}">
              <button type="submit">${a.active ? "إيقاف" : "تفعيل"}</button>
            </form>` : ""}
          </td>
        </tr>`;
      }).join("");

      const form = canCreate ? `
        <section class="panel">
          <h2>إنشاء حساب تابع</h2>
          <form method="POST" action="/agents">
            <input type="hidden" name="csrf" value="${csrf(req)}">
            <label>نوع الحساب</label>
            <select name="role" required>
              <option value="">اختر الرتبة</option>
              <option value="SUPER_MASTER">رئيس وكلاء</option>
              <option value="MASTER">وكيل</option>
              <option value="CASHIER">كاشيرة</option>
            </select>
            <label>الاسم الظاهر</label>
            <input name="displayName" required minlength="2" maxlength="60">
            <label>اسم المستخدم</label>
            <input name="username" required minlength="4" maxlength="24" pattern="[A-Za-z0-9_]+">
            <label>كلمة المرور</label>
            <input type="password" name="password" required minlength="10" maxlength="100">
            <button type="submit">إنشاء الحساب</button>
          </form>
        </section>` : '<section class="panel"><p>إنشاء رؤساء الوكلاء والوكلاء والكاشيرات متاح للمدير الرئيسي فقط.</p></section>';

      res.send(page("إدارة الموظفين", `
        <section class="panel">
          <h1>🦅 إدارة الرتب والموظفين</h1>
          <p>رتبتك الحالية: <b>${esc(ROLE_NAMES[actor.role])}</b></p>
          ${form}
        </section>
        <section class="panel">
          <h2>الحسابات التابعة (${visible.length})</h2>
          <div style="overflow-x:auto">
            <table>
              <thead><tr>
                <th>رقم الحساب</th><th>الاسم</th><th>الرتبة</th>
                <th>المسؤول</th><th>الحالة</th><th>الإجراء</th>
              </tr></thead>
              <tbody>${rows || "<tr><td colspan='6'>لا توجد حسابات</td></tr>"}</tbody>
            </table>
          </div>
          <p><a href="/">العودة إلى لوحة التحكم</a></p>
        </section>
      `));
    } catch (e) {
      console.error("Agents page error:", e);
      res.status(500).send("تعذر عرض الحسابات.");
    }
  });

  app.post("/agents", guard, async (req, res) => {
    if (!validCsrf(req)) return res.status(403).send("طلب غير صالح.");

    try {
      const actor = req.agent;
      if (actor.role !== "HEAD") {
        return res.status(403).send("إنشاء الحسابات متاح للمدير الرئيسي فقط.");
      }
      const role = String(req.body.role || "");
      if (!CREATABLE_ROLES.includes(role)) {
        return res.status(400).send("نوع الحساب غير صالح.");
      }

      const displayName = String(req.body.displayName || "").trim();
      const username = String(req.body.username || "").trim();
      const password = String(req.body.password || "");
      const parentId = String(req.body.parentId || "");

      if (
        displayName.length < 2 || displayName.length > 60 ||
        !/^[A-Za-z0-9_]{4,24}$/.test(username) ||
        password.length < 10 || password.length > 100
      ) return res.status(400).send("البيانات غير صحيحة.");

      const agents = load();

      if (agents.some(a => String(a.username).toLowerCase() === username.toLowerCase())) {
        return res.status(409).send("اسم المستخدم مستخدم مسبقاً.");
      }

      // كل الحسابات الجديدة تتبع المدير الرئيسي مباشرة؛ لا يستطيع أي رئيس وكلاء
      // أو وكيل إنشاء رتب أو حسابات أخرى.

      const id = "AG-" + crypto.randomBytes(8).toString("hex").toUpperCase();
      const newAgent = {
        id,
        displayName,
        username,
        passwordHash: await bcrypt.hash(password, 12),
        role,
        parentId: actor.id || agents.find(a => a.role === "HEAD" && a.active)?.id || null,
        active: true,
        createdAt: new Date().toISOString()
      };

      if (role === "CASHIER") {
        newAgent.inviteToken = crypto.randomBytes(24).toString("hex");
      }

      agents.push(newAgent);
      save(agents);
      res.redirect("/agents");
    } catch (e) {
      console.error("Create agent error:", e);
      res.status(500).send("تعذر إنشاء الحساب.");
    }
  });

  app.post("/agents/toggle", guard, (req, res) => {
    if (!validCsrf(req)) return res.status(403).send("طلب غير صالح.");

    try {
      const actor = req.agent;
      const id = String(req.body.id || "");
      const agents = load();
      const target = agents.find(a => a.id === id);

      if (!target) return res.status(404).send("الحساب غير موجود.");
      if (target.role === "HEAD" || target.role === "HEAD_AGENT") {
        return res.status(403).send("لا يمكن إيقاف حساب HEAD.");
      }
      if (target.id === actor.id || !isInScope(actor, target, agents)) {
        return res.status(403).send("ليس لديك صلاحية لهذا الحساب.");
      }

      target.active = !target.active;
      save(agents);
      res.redirect("/agents");
    } catch (e) {
      console.error("Toggle agent error:", e);
      res.status(500).send("تعذر تحديث حالة الحساب.");
    }
  });
};

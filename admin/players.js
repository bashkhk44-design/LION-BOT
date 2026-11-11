
const fs = require("fs");
const path = require("path");

module.exports = function(app, helpers) {
  const DB_FILE = path.join(__dirname, "..", "lion_database.json");
  const { csrf, validCsrf, page } = helpers;
  const auth = require("./auth");

  function guard(req, res, next) {
    auth.guard(req, res, next);
  }

  function loadDB() {
    if (!fs.existsSync(DB_FILE)) {
      throw new Error("قاعدة بيانات اللاعبين غير موجودة");
    }
    return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  }

  function saveDB(db) {
    const temp = DB_FILE + ".tmp";
    fs.writeFileSync(temp, JSON.stringify(db, null, 2), { mode: 0o600 });
    fs.renameSync(temp, DB_FILE);
  }

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;",
      '"': "&quot;", "'": "&#39;"
    })[c]);
  }

  app.get("/players", guard, (req, res) => {
    let db;
    try {
      db = loadDB();
    } catch {
      return res.status(500).send("تعذر قراءة قاعدة بيانات اللاعبين.");
    }

    const players = db.players || {};
    const agents = auth.loadAgents();
    const q = String(req.query.q || "").trim().toLowerCase();

    const results = Object.entries(players).filter(([id, p]) => {
      auth.canAccessPlayer(req.agent, p, agents) && (!q ||
        String(id).toLowerCase().includes(q) ||
        String(p.accountId || "").toLowerCase().includes(q) ||
        String(p.username || "").toLowerCase().includes(q));
    });

    const rows = results.map(([id, p]) => `
      <tr>
        <td>${esc(p.accountId || "—")}</td>
        <td>${esc(p.username || "—")}</td>
        <td>${esc(p.syp || 0)}</td>
        <td>${esc(p.usd || 0)}</td>
        <td>
          <form method="POST" action="/players/adjust">
            <input type="hidden" name="csrf" value="${csrf(req)}">
            <input type="hidden" name="playerId" value="${esc(id)}">
            <label>نوع العملية</label>
            <select name="action" required>
              <option value="add">شحن</option>
              <option value="subtract">خصم</option>
            </select>
            <label>العملة</label>
            <select name="currency" required>
              <option value="syp">SYP</option>
              <option value="usd">USD</option>
            </select>
            <label>المبلغ</label>
            <input name="amount" type="number" min="0.01" max="1000000000" step="0.01" required>
            <label>ملاحظة العملية</label>
            <input name="note" maxlength="150" placeholder="اختياري">
            <button type="submit">تنفيذ العملية</button>
          </form>
        </td>
      </tr>
    `).join("");

    const history = (db.adminTransactions || [])
      .filter(t => {
        if (req.agent.role === "HEAD") return true;
        const player = players[String(t.playerId || "")];
        return player && auth.canAccessPlayer(req.agent, player, agents);
      })
      .slice(-20).reverse().map(t => `
        <tr>
          <td>${esc(t.date)}</td>
          <td>${esc(t.accountId)}</td>
          <td>${t.action === "add" ? "شحن" : "خصم"}</td>
          <td>${esc(t.amount)} ${t.currency === "syp" ? "SYP" : "USD"}</td>
          <td>${esc(t.note || "—")}</td>
        </tr>
      `).join("");

    res.send(page("إدارة اللاعبين", `
      <section class="panel">
        <h1>👥 إدارة اللاعبين</h1>
        <p>عدد الحسابات ضمن صلاحيتك: ${results.length}</p>
        <form method="GET" action="/players">
          <label>البحث برقم الحساب أو اسم المستخدم</label>
          <input name="q" value="${esc(q)}" placeholder="ابحث عن لاعب">
          <button type="submit">بحث</button>
          <a href="/players">عرض الجميع</a>
        </form>
      </section>

      <section class="panel">
        <h2>قائمة اللاعبين (${results.length})</h2>
        <div style="overflow-x:auto">
          <table>
            <thead><tr>
              <th>رقم الحساب</th>
              <th>اسم المستخدم</th>
              <th>رصيد SYP</th>
              <th>رصيد USD</th>
              <th>إدارة الرصيد</th>
            </tr></thead>
            <tbody>${rows || "<tr><td colspan='5'>لا توجد نتائج</td></tr>"}</tbody>
          </table>
        </div>
        <p><a href="/">العودة إلى MASTER</a></p>
      </section>

      <section class="panel">
        <h2>📋 آخر عمليات تعديل الرصيد</h2>
        <div style="overflow-x:auto">
          <table>
            <thead><tr>
              <th>التاريخ</th><th>الحساب</th><th>العملية</th>
              <th>المبلغ</th><th>الملاحظة</th>
            </tr></thead>
            <tbody>${history || "<tr><td colspan='5'>لا توجد عمليات بعد</td></tr>"}</tbody>
          </table>
        </div>
      </section>
    `));
  });

  app.post("/players/adjust", guard, (req, res) => {
    if (!validCsrf(req)) {
      return res.status(403).send("طلب غير صالح. أعد تحميل الصفحة.");
    }

    const playerId = String(req.body.playerId || "");
    const action = String(req.body.action || "");
    const currency = String(req.body.currency || "");
    const amount = Number(req.body.amount);
    const note = String(req.body.note || "").trim();

    if (!["add", "subtract"].includes(action) ||
        !["syp", "usd"].includes(currency) ||
        !Number.isFinite(amount) || amount <= 0 ||
        amount > 1000000000 || note.length > 150) {
      return res.status(400).send("بيانات العملية غير صحيحة.");
    }

    let db;
    try {
      db = loadDB();
      db.players = db.players || {};

      const player = db.players[playerId];
      if (!player) {
        return res.status(404).send("اللاعب غير موجود.");
      }
      if (req.agent.role !== "HEAD" && !auth.canAccessPlayer(req.agent, player, auth.loadAgents())) {
        return res.status(403).send("هذا اللاعب خارج نطاق صلاحيتك.");
      }

      const current = Number(player[currency] || 0);
      if (!Number.isFinite(current) || current < 0) {
        return res.status(400).send("رصيد اللاعب غير صالح.");
      }

      if (action === "subtract" && amount > current) {
        return res.status(400).send("الرصيد غير كافٍ لإتمام الخصم.");
      }

      const updated = action === "add"
        ? current + amount
        : current - amount;

      if (!Number.isFinite(updated) || updated < 0) {
        return res.status(400).send("قيمة الرصيد الناتجة غير صالحة.");
      }

      player[currency] = Math.round(updated * 100) / 100;

      db.adminTransactions = db.adminTransactions || [];
      db.adminTransactions.push({
        date: new Date().toISOString(),
        playerId,
        accountId: player.accountId || "",
        action,
        currency,
        amount,
        note,
        ownerId: player.ownerId || null,
        by: req.agent.username || req.agent.role,
        byAgentId: req.agent.id || null,
        byRole: req.agent.role
      });

      db.adminTransactions = db.adminTransactions.slice(-5000);
      saveDB(db);

      return res.redirect("/players");
    } catch {
      return res.status(500).send("تعذر حفظ العملية. تحقق من قاعدة البيانات.");
    }
  });
};


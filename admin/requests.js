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
    return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  }

  function saveDB(db) {
    const temp = DB_FILE + ".tmp";
    fs.writeFileSync(temp, JSON.stringify(db, null, 2), { mode: 0o600 });
    fs.renameSync(temp, DB_FILE);
  }

  function esc(v) {
    return String(v ?? "").replace(/[&<>"']/g, c => ({
      "&":"&amp;", "<":"&lt;", ">":"&gt;",
      '"':"&quot;", "'":"&#39;"
    })[c]);
  }

  function list(type, title) {
    app.get("/" + type, guard, (req, res) => {
      try {
        const db = loadDB();
        const items = db[type] || {};
        const agents = auth.loadAgents();
        const visibleEntries = Object.entries(items).filter(([id, r]) => {
          if (req.agent.role === "HEAD") return true;
          const player = db.players && db.players[String(r.telegramId)];
          return !!(player && r.ownerId && player.ownerId &&
            String(r.ownerId) === String(player.ownerId) &&
            auth.canAccessPlayer(req.agent, player, agents));
        });
        const rows = visibleEntries.map(([id, r]) => {
          const status = r.status || "unknown";
          const buttons = status === "pending" ? `
            <form method="POST" action="/${type}/process">
              <input type="hidden" name="csrf" value="${csrf(req)}">
              <input type="hidden" name="id" value="${esc(id)}">
              <button name="action" value="approve">موافقة</button>
              <button name="action" value="reject">رفض</button>
            </form>` : "تمت المعالجة";

          return `<tr>
            <td>${esc(id)}</td>
            <td>${esc(r.telegramId)}</td>
            <td>${esc(r.username || r.accountId || "—")}</td>
            <td>${esc(r.amount)} ${esc(r.currency)}</td>
            <td>${esc(r.method || "—")}</td>
            <td>${esc(status)}</td>
            <td>${buttons}</td>
          </tr>`;
        }).join("");

        res.send(page(title, `
          <section class="panel">
            <h1>${title}</h1>
            <p>عدد الطلبات ضمن صلاحيتك: ${visibleEntries.length}</p>
            <div style="overflow-x:auto">
              <table>
                <thead><tr>
                  <th>رقم الطلب</th><th>Telegram ID</th>
                  <th>اللاعب</th><th>المبلغ</th>
                  <th>الطريقة</th><th>الحالة</th><th>الإجراء</th>
                </tr></thead>
                <tbody>${rows || "<tr><td colspan='7'>لا توجد طلبات</td></tr>"}</tbody>
              </table>
            </div>
            <p><a href="/">العودة إلى MASTER</a></p>
          </section>
        `));
      } catch (e) {
        console.error(e);
        res.status(500).send("تعذر قراءة الطلبات.");
      }
    });
  }

  list("deposits", "💰 طلبات الإيداع");
  list("withdrawals", "💸 طلبات السحب");

  for (const type of ["deposits", "withdrawals"]) {
    app.post("/" + type + "/process", guard, (req, res) => {
      if (!validCsrf(req))
        return res.status(403).send("طلب غير صالح.");

      const id = String(req.body.id || "");
      const action = String(req.body.action || "");

      if (!["approve", "reject"].includes(action))
        return res.status(400).send("عملية غير صحيحة.");

      try {
        const db = loadDB();
        const request = (db[type] || {})[id];

        if (!request || request.status !== "pending")
          return res.status(409).send("الطلب غير موجود أو تمت معالجته.");

        const player = db.players &&
          db.players[String(request.telegramId)];

        if (!player)
          return res.status(404).send("اللاعب غير موجود.");
        if (req.agent.role !== "HEAD" &&
            (!request.ownerId || !player.ownerId ||
             String(request.ownerId) !== String(player.ownerId) ||
             !auth.canAccessPlayer(req.agent, player, auth.loadAgents()))) {
          return res.status(403).send("هذا الطلب خارج نطاق صلاحيتك.");
        }

        const key = request.currency === "SYP" ? "syp" : "usd";
        const amount = Number(request.amount);

        if (!Number.isFinite(amount) || amount <= 0)
          return res.status(400).send("مبلغ الطلب غير صالح.");

        const current = Number(player[key] || 0);

        if (!Number.isFinite(current) || current < 0)
          return res.status(400).send("رصيد اللاعب غير صالح.");

        if (type === "deposits" && action === "approve") {
          player[key] = Math.round((current + amount) * 100) / 100;
          request.status = "approved";
        } else if (type === "deposits") {
          request.status = "rejected";
        } else if (action === "approve") {
          request.status = "paid";
        } else {
          player[key] = Math.round((current + amount) * 100) / 100;
          request.status = "rejected";
        }

        request.processedAt = new Date().toISOString();
        request.processedBy = req.agent.username || req.agent.role;
        request.processedByAgentId = req.agent.id || null;
        request.processedByRole = req.agent.role;

        db.adminTransactions = db.adminTransactions || [];
        db.adminTransactions.push({
          date: request.processedAt,
          playerId: String(request.telegramId),
          accountId: player.accountId || "",
          action: type === "deposits"
            ? (action === "approve" ? "add" : "deposit_rejected")
            : (action === "reject" ? "add" : "withdraw_paid"),
          currency: key,
          amount,
          note: type + " " + action,
          ownerId: player.ownerId || null,
          by: req.agent.username || req.agent.role,
          byAgentId: req.agent.id || null,
          byRole: req.agent.role
        });
        db.adminTransactions = db.adminTransactions.slice(-5000);

        saveDB(db);
        return res.redirect("/" + type);
      } catch (e) {
        console.error(e);
        return res.status(500).send("تعذر تنفيذ العملية.");
      }
    });
  }
};

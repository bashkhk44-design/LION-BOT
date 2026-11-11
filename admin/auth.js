const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "data", "agents.json");
const LEVELS = ["HEAD", "SUPER_MASTER", "MASTER", "CASHIER"];

function loadAgents() {
  const data = JSON.parse(fs.readFileSync(FILE, "utf8"));
  return Array.isArray(data.agents) ? data.agents : [];
}

function current(req) {
  if (!req.session) return null;

  // جلسة HEAD القديمة تبقى صالحة للتوافق
  if (req.session.role === "HEAD" && !req.session.agentId) {
    return { id: null, role: "HEAD", active: true };
  }

  if (!req.session.agentId) return null;

  try {
    const agents = loadAgents();
    const agent = agents.find(a =>
      a.id === req.session.agentId && a.active === true
    );

    if (!agent || !LEVELS.includes(agent.role)) return null;

    req.session.role = agent.role;
    req.session.username = agent.username;
    req.session.master = agent.role === "HEAD";

    return agent;
  } catch {
    return null;
  }
}

function isDescendant(agentId, ancestorId, agents) {
  if (!agentId || !ancestorId) return false;

  const byId = new Map(agents.map(a => [a.id, a]));
  const visited = new Set();
  let item = byId.get(agentId);

  while (item && item.parentId) {
    if (visited.has(item.id)) return false;
    visited.add(item.id);

    if (item.parentId === ancestorId) return true;
    item = byId.get(item.parentId);
  }

  return false;
}

function descendants(agent, agents) {
  if (!agent) return [];
  if (agent.role === "HEAD") return agents;

  return agents.filter(a =>
    a.id === agent.id || isDescendant(a.id, agent.id, agents)
  );
}

function canManageRole(agent, role) {
  if (!agent) return false;
  if (agent.role === "HEAD") return role === "SUPER_MASTER";
  if (agent.role === "SUPER_MASTER") return role === "MASTER";
  if (agent.role === "MASTER") return role === "CASHIER";
  return false;
}

function canAccessPlayer(agent, player, agents) {
  if (!agent || !player) return false;
  if (agent.role === "HEAD") return true;
  if (!player.ownerId) return false;

  return descendants(agent, agents).some(a =>
    a.role === "CASHIER" && a.id === player.ownerId
  );
}

function guard(req, res, next) {
  const agent = current(req);
  if (!agent) return res.redirect("/");
  req.agent = agent;
  next();
}

module.exports = {
  loadAgents,
  current,
  descendants,
  canManageRole,
  canAccessPlayer,
  guard
};

"use strict";
const fs = require("fs");
const path = require("path");
const envFile = path.join(__dirname, ".env");
if (fs.existsSync(envFile)) {
  for (const rawLine of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const pos = line.indexOf("=");
    if (pos < 1) continue;
    const key = line.slice(0, pos).trim();
    let value = line.slice(pos + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}
if (!process.env.TELEGRAM_BOT_TOKEN) {
  console.error("TELEGRAM_BOT_TOKEN is missing. Add it to FadeHost environment variables.");
  process.exit(1);
}
console.log("Starting LION GAMES BOT...");
require("./bot.js");
require("./head-panel.js");

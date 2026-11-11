console.log("Starting BOSS EAGLE BET MASTER...");
require("./admin.js");
try {
  require("./bot.js");
} catch (error) {
  console.error("Telegram bot startup failed:", error.message);
}

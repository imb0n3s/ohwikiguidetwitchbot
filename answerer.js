// answerer.js — picks the answer engine from ANSWER_MODE (free | claude)
const cfg = require("./config");
module.exports = cfg.ANSWER_MODE === "claude" ? require("./answer") : require("./answer-free");

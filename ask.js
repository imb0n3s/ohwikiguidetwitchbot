// ask.js — test the wiki lookup + answer from the terminal (no Twitch needed)
//   npm run ask -- "where does Butterfly's Emissary drop?"
require("dotenv").config();
const { answerQuestion } = require("./answerer");
const q = process.argv.slice(2).join(" ") || "where does Butterfly's Emissary drop?";
answerQuestion(q).then((r) => { console.log("Q:", q); console.log("A:", r.text); console.log("Link:", r.url); }).catch((e) => { console.error(e); process.exit(1); });

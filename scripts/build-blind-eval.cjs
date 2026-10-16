/**
 * 生成质量评测 · 盲评素材生成
 * 把 150 条候选打乱顺序、剥掉「属于哪条用例 / 什么意图 / 对谁说的」，
 * 只剩一个随机编号和回复正文，交给独立评分者。
 *
 * 为什么必须盲：如果评分者知道「这是委婉拒绝，本来就难写」，就会不自觉放宽标准。
 * 只看正文冷不丁地问「这像真人发的吗」，才是这个产品承诺（像你自己说出来、不像 AI）的真正考点。
 *
 * 跑法：node scripts/build-blind-eval.cjs
 * 产出：
 *   docs/evidence/blind-150.txt   给评分者看（只有编号 + 正文）
 *   docs/evidence/blind-map.json  编号 -> 用例的映射（评分者不看这个，用于最后还原分析）
 */
const fs = require("fs");
const path = require("path");

const DIR = path.resolve(__dirname, "..");
const RAW = path.join(DIR, "docs", "evidence", "eval-raw.json");
const EV = path.join(DIR, "docs", "evidence");
const SEED = 20261016;

const raw = JSON.parse(fs.readFileSync(RAW, "utf8"));

// 确定性洗牌：同一份输入每次得到同样的顺序，便于复核
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(SEED);

const items = [];
for (const r of raw.results) {
  if (!r.ok) continue;
  r.candidates.slice(0, 3).forEach((c, i) => {
    const reply = (c.reply || "").trim();
    if (reply) items.push({ caseId: r.id, slot: i + 1, intent: r.intent, persona: r.persona, reply });
  });
}
for (let i = items.length - 1; i > 0; i--) {
  const j = Math.floor(rnd() * (i + 1));
  [items[i], items[j]] = [items[j], items[i]];
}

const map = items.map((it, i) => ({ blindId: "R" + String(i + 1).padStart(3, "0"), ...it }));

fs.writeFileSync(path.join(EV, "blind-map.json"), JSON.stringify({ seed: SEED, map }, null, 2), "utf8");
fs.writeFileSync(path.join(EV, "blind-150.txt"),
  map.map(m => `${m.blindId}｜${m.reply}`).join("\n") + "\n", "utf8");

console.log("盲评素材已生成");
console.log("  条数：" + map.length + "（" + raw.results.filter(r => r.ok).length + " 条用例 × 3）");
console.log("  洗牌种子：" + SEED + "（可复现）");
console.log("  评分者看：" + path.join(EV, "blind-150.txt"));
console.log("  映射表（评分者不看）：" + path.join(EV, "blind-map.json"));
console.log("\n前 5 条预览：");
map.slice(0, 5).forEach(m => console.log("  " + m.blindId + "｜" + m.reply.slice(0, 50)));

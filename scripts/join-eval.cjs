/**
 * 生成质量评测 · 盲评结果合并分析
 * 把两位独立评分者的打分还原到用例上（评分者本人看不到这个映射），
 * 算出：整体分数分布、两位评分者的一致性、按意图的强弱、差评集中在哪。
 *
 * 跑法：node scripts/join-eval.cjs
 * 产出：docs/evidence/eval-blind.json
 */
const fs = require("fs");
const path = require("path");

const EV = path.join(path.resolve(__dirname, ".."), "docs", "evidence");
const map = JSON.parse(fs.readFileSync(path.join(EV, "blind-map.json"), "utf8")).map;
const raw = JSON.parse(fs.readFileSync(path.join(EV, "eval-raw.json"), "utf8"));

function readRatings(file) {
  const out = {};
  for (const line of fs.readFileSync(path.join(EV, file), "utf8").split(/\r?\n/)) {
    const m = line.trim().match(/^(R\d{3})\s+([1-5])\s+([YN])$/);
    if (m) out[m[1]] = { score: Number(m[2]), send: m[3] === "Y" };
  }
  return out;
}
const A = readRatings("blind-ratings-A.txt");
const B = readRatings("blind-ratings-B.txt");

// 逐条合并
const rows = map.map(m => {
  const a = A[m.blindId], b = B[m.blindId];
  const scores = [a, b].filter(Boolean).map(x => x.score);
  return {
    blindId: m.blindId, caseId: m.caseId, slot: m.slot, intent: m.intent, persona: m.persona, reply: m.reply,
    A: a ? a.score : null, B: b ? b.score : null,
    avg: scores.reduce((x, y) => x + y, 0) / (scores.length || 1),
    sendA: a ? a.send : null, sendB: b ? b.send : null,
    // 只要有一位说"不会直接发"就算需要改——用更严的口径
    needEdit: (a && !a.send) || (b && !b.send)
  };
});

const stat = (arr) => {
  const n = arr.length;
  const mean = arr.reduce((a, b) => a + b, 0) / (n || 1);
  const sd = Math.sqrt(arr.reduce((a, b) => a + (b - mean) ** 2, 0) / (n || 1));
  return { n, mean: Math.round(mean * 100) / 100, sd: Math.round(sd * 100) / 100 };
};

const avgAll = stat(rows.flatMap(r => [r.A, r.B].filter(x => x !== null)));
const aAll = stat(rows.map(r => r.A).filter(x => x !== null));
const bAll = stat(rows.map(r => r.B).filter(x => x !== null));

// 一致性：完全相同的比例 / 相差 ≤1 的比例 / 皮尔逊相关
const both = rows.filter(r => r.A !== null && r.B !== null);
const exact = both.filter(r => r.A === r.B).length;
const within1 = both.filter(r => Math.abs(r.A - r.B) <= 1).length;
const mA = both.reduce((s, r) => s + r.A, 0) / both.length;
const mB = both.reduce((s, r) => s + r.B, 0) / both.length;
let cov = 0, vA = 0, vB = 0;
for (const r of both) { cov += (r.A - mA) * (r.B - mB); vA += (r.A - mA) ** 2; vB += (r.B - mB) ** 2; }
const pearson = Math.round((cov / Math.sqrt(vA * vB)) * 1000) / 1000;

// 分数段
const bucket = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
rows.flatMap(r => [r.A, r.B].filter(x => x !== null)).forEach(s => bucket[s]++);

// 按意图
const byIntent = {};
for (const r of rows) {
  const k = r.intent;
  byIntent[k] = byIntent[k] || { scores: [], needEdit: 0, n: 0 };
  byIntent[k].scores.push(r.A, r.B);
  byIntent[k].n++;
  if (r.needEdit) byIntent[k].needEdit++;
}
const intentTable = Object.entries(byIntent).map(([k, v]) => ({
  intent: k, replies: v.n, avg: stat(v.scores).mean,
  sd: stat(v.scores).sd,
  needEdit: v.needEdit, needEditRate: Math.round(v.needEdit / v.n * 100) + "%"
})).sort((a, b) => a.avg - b.avg);

// 按身份
const byPersona = {};
for (const r of rows) { (byPersona[r.persona] = byPersona[r.persona] || []).push(r.A, r.B); }
const personaTable = Object.entries(byPersona).map(([k, v]) => ({ persona: k, replies: v.length, avg: stat(v).mean }))
  .sort((a, b) => a.avg - b.avg);

// 差评集中点
const worst = [...rows].sort((a, b) => a.avg - b.avg || (a.sendA ? 1 : 0) - (b.sendA ? 1 : 0)).slice(0, 20);

// 差评里反复出现的书面词（两位评分者点名过的）
const AI_WORDS = ["同步", "过目", "第一时间", "当前节点", "核对到位", "按点交", "不再找借口", "确认一下", "落实", "反馈"];
const wordHits = {};
for (const r of rows) for (const w of AI_WORDS) if (r.reply.includes(w)) (wordHits[w] = wordHits[w] || []).push(r.blindId + "(A" + r.A + "/B" + r.B + ")");

const out = {
  ranAt: new Date().toISOString(),
  totalReplies: rows.length,
  raters: { A: aAll, B: bAll, combined: avgAll },
  agreement: {
    exactSame: exact, exactRate: Math.round(exact / both.length * 100) + "%",
    within1: within1, within1Rate: Math.round(within1 / both.length * 100) + "%",
    pearson
  },
  scoreBuckets: bucket,
  needEditTotal: rows.filter(r => r.needEdit).length,
  needEditRate: Math.round(rows.filter(r => r.needEdit).length / rows.length * 100) + "%",
  intentTable, personaTable, worst, wordHits, rows
};
fs.writeFileSync(path.join(EV, "eval-blind.json"), JSON.stringify(out, null, 2), "utf8");

// ---------- 控制台 ----------
console.log("生成质量评测 · 盲评合并结果");
console.log("=".repeat(56));
console.log(`候选总数 ${rows.length}（50 用例 × 3）｜两位独立评分者，只看正文，不知意图与身份`);
console.log(`  评分者 A：均分 ${aAll.mean}（sd ${aAll.sd}）`);
console.log(`  评分者 B：均分 ${bAll.mean}（sd ${bAll.sd}）`);
console.log(`  合并均分 ${avgAll.mean} / 5`);
console.log(`  分数段：5分 ${bucket[5]}｜4分 ${bucket[4]}｜3分 ${bucket[3]}｜2分 ${bucket[2]}｜1分 ${bucket[1]}`);
console.log(`  需要改（任一位说不愿直接发）：${out.needEditTotal}/${rows.length}（${out.needEditRate}）`);
console.log(`\n两位评分者一致性：完全相同 ${out.agreement.exactRate}｜相差≤1 ${out.agreement.within1Rate}｜相关系数 ${pearson}`);
console.log("\n按意图（升序，越前越弱）：");
console.log("  意图        候选  均分   sd   需改");
for (const t of intentTable) console.log(`  ${t.intent.padEnd(8)}  ${String(t.replies).padStart(4)}  ${String(t.avg).padStart(5)}  ${String(t.sd).padStart(4)}  ${t.needEdit}`);
console.log("\n按身份（升序）：");
for (const t of personaTable) console.log(`  ${t.persona.padEnd(10)} ${String(t.replies).padStart(3)} 条  均分 ${t.avg}`);
console.log("\n最差的 12 条：");
for (const r of worst.slice(0, 12)) console.log(`  [${r.intent}/${r.persona}] A${r.A} B${r.B}  ${r.reply.slice(0, 46)}`);
console.log("\n反复出现的书面词：");
for (const [w, list] of Object.entries(wordHits)) console.log(`  ${w} × ${list.length}  ${list.slice(0, 5).join(" ")}`);
console.log("\n明细：" + path.join(EV, "eval-blind.json"));

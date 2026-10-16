/**
 * 生成质量评测 · 客观规则核查
 * 拿着 eval-raw.json 里 150 条候选，逐条对照 SYSTEM_PROMPT 里写死的 11 条硬规则做机器可验检查。
 * 这一半不依赖"品味"，全是能判定的：长度、禁用词、标点、emoji、三条是否真是三种策略、
 * 以及「有没有编造用户没给过的时间/价格」——最后这条是产品承诺里最要紧的一条。
 *
 * 跑法：node scripts/check-eval-rules.cjs
 * 产出：docs/evidence/eval-rules.json（明细）+ 控制台摘要
 */
const fs = require("fs");
const path = require("path");

const DIR = path.resolve(__dirname, "..");
const RAW = path.join(DIR, "docs", "evidence", process.env.MH_RAW || "eval-raw.json");
const OUT = path.join(DIR, "docs", "evidence", process.env.MH_RULES_OUT || "eval-rules.json");

const raw = JSON.parse(fs.readFileSync(RAW, "utf8"));
const results = raw.results.filter(r => r.ok);

// ---------- 规则定义 ----------
const BANNED = ["期待您的回复", "收到，谢谢", "非常感谢", "我理解您的感受", "希望这能帮到你", "首先", "其次", "总而言之"];
// 职场书面语（2026-10-16 盲评中两位独立评分者同时点名的 AI 破绽；v0.18 已写进 SYSTEM_PROMPT 禁用表）
const JARGON = ["同步", "过目", "第一时间", "当前节点", "核对到位", "按点交", "不再找借口"];
const FORMAL = ["领导", "长辈", "老师", "客户或合作方", "初次认识的人"];
// 这些身份用「您」是中文里该有的分寸，不算误用
const NIN_OK = ["长辈", "老师"];
// 网络梗 / 玩笑向语气词（规则 8：正式身份禁用）
const SLANG = ["绝绝子", "yyds", "YYDS", "栓Q", "我真的会谢", "破防", "芭比Q", "666", "笑死", "救命啊", "好家伙", "家人们", "集美", "无语子", "摆烂", "打工人", "社畜", "搬砖", "苦命", "秃头"];
// 恭维对方（规则 8：对正式身份禁用）
const FLATTER = ["太厉害了", "向您学习", "学到了", "佩服", "厉害呀", "您真", "高手", "大佬"];

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F000}-\u{1F2FF}]/u;
const DASH = /——|—|–|--/;
const SEMI = /[；;]/;
const LEN_LIMIT = 40;

// 时间/数量类"具体信息"：回复里出现、但上下文与补充说明里都没有 -> 疑似编造
// ⚠️ 这个检查只覆盖「时间 / 数量 / 金额」这类**可枚举**的具体信息，抓不到
//    「我把蛋糕买好了」这种不带数字的凭空断言——所以它的结果定位是「需要人看的可疑项」，
//    不是「违规」。人工复核时必须逐条看，别直接当结论用。
const SPECIFIC = [
  /(?:今天|明天|后天|大后天|今晚|明早|明晚)/g,
  /(?:本周|这周|下周|下下周|上周)(?:[一二三四五六日天])?/g,
  /周[一二三四五六日天]/g,
  /(?:上午|下午|中午|早上|晚上)\s*\d{1,2}\s*点/g,
  /\d{1,2}\s*[点时](\s*半)?/g,
  /\d{1,2}\s*月\s*\d{1,2}\s*[日号]/g,
  /\d+\s*(?:天|小时|分钟|个工作日|周|个月)(?:内|后|左右|之内)?/g,
  /\d+\s*(?:块|元|万|千|折|%)/g
];
// 从上下文能直接推出来的，不算编造（例：上下文说"这个周末"，回复说"周六"）
const DERIVABLE = [
  { ctx: /周末/, allow: /^(周六|周日|周六日|周末)$/ },
  { ctx: /周末/, allow: /^(今天|明天)$/ },
  { ctx: /工作日|上班/, allow: /^(今天|明天|周一)$/ }
];

const chLen = s => (s || "").replace(/\s/g, "").length;

/* 只在「整句转述的用户自身动作」里查编造：
   把回复按句切开，只保留含「我 / 咱」的句子——「今天能发我吗」这种在向对方要东西，
   不是替用户编承诺，不该算进来。 */
function selfClauses(reply) {
  return (reply || "")
    .split(/[。！？；\n]/)
    .map(s => s.trim())
    .filter(s => s && /我|咱/.test(s));
}

function derivable(token, haystack) {
  return DERIVABLE.some(d => d.ctx.test(haystack) && d.allow.test(token));
}

function nearDup(a, b) {
  const A = a.replace(/[，。！？、,.!?～\s]/g, "");
  const B = b.replace(/[，。！？、,.!?\s]/g, "");
  if (!A || !B) return false;
  if (A === B) return true;
  const setB = new Set(B.split(""));
  let same = 0;
  for (const ch of new Set(A.split(""))) if (setB.has(ch)) same++;
  return same / Math.max(new Set(A.split("")).size, 1) > 0.85;
}

// ---------- 逐条检查 ----------
let nReplies = 0, nCases = 0;
const violations = [];   // {caseId, slot, rule, detail}
const perRule = {};
const bump = (rule) => { perRule[rule] = (perRule[rule] || 0) + 1; };
const flag = (caseId, slot, rule, detail) => { violations.push({ caseId, slot, rule, detail }); bump(rule); };

const perCase = [];
for (const r of results) {
  nCases++;
  const haystack = [r.context, r.style, r.extra].filter(Boolean).join("\n");
  const formal = FORMAL.includes(r.persona);
  const styleHasNin = (r.style || "").includes("您");
  const replies = r.candidates.map(c => c.reply.trim());
  const strategies = r.candidates.map(c => (c.strategy || "").trim());

  replies.forEach((rep, i) => {
    nReplies++;
    const slot = i + 1;
    if (!rep) { flag(r.id, slot, "空回复", ""); return; }
    if (chLen(rep) > LEN_LIMIT) flag(r.id, slot, "超长(>40字)", chLen(rep) + "字：" + rep.slice(0, 50));
    for (const w of BANNED) if (rep.includes(w)) flag(r.id, slot, "命中禁用词", w);
    for (const w of JARGON) if (rep.includes(w)) flag(r.id, slot, "职场书面语", w + "：" + rep.slice(0, 44));
    if (DASH.test(rep)) flag(r.id, slot, "用了破折号", rep.slice(0, 50));
    if (SEMI.test(rep)) flag(r.id, slot, "用了分号", rep.slice(0, 50));
    if (EMOJI.test(rep)) flag(r.id, slot, "用了emoji", rep.slice(0, 50));
    // 规则 2 与规则 8 打架：规则 2 说「除非风格样本用了您，否则一律用你」，
    // 规则 8 又要求对长辈/老师「语气稳重大方」。中文里对长辈/老师用「您」几乎必须，
    // 模型也这么选了。所以这条只在**长辈/老师之外**的身份上才算「误用」（2026-10-16 收窄口径）。
    if (rep.includes("您") && !styleHasNin && !NIN_OK.includes(r.persona)) flag(r.id, slot, "误用「您」", r.persona + "：" + rep.slice(0, 46));
    if (formal) {
      for (const w of SLANG) if (rep.includes(w)) flag(r.id, slot, "正式身份用了网络梗", w + "：" + rep.slice(0, 40));
      for (const w of FLATTER) if (rep.includes(w)) flag(r.id, slot, "正式身份恭维对方", w + "：" + rep.slice(0, 40));
    }
    // 疑似编造：只看「用户自称要做的具体承诺」里有没有上下文没给过的时间/数量
    // 先把「明明」摘掉——它会被当成「明天」（2026-10-16 实测误报过一条）
    const scanRep = rep.replace(/明明/g, "__");
    for (const clause of selfClauses(scanRep)) {
      for (const re of SPECIFIC) {
        const hits = clause.match(re);
        if (!hits) continue;
        for (const h of hits) {
          const key = h.replace(/\s/g, "");
          if (haystack.replace(/\s/g, "").includes(key)) continue;
          if (derivable(key, haystack)) continue;
          flag(r.id, slot, "疑似编造(需人工判断)", key + "｜回复：" + rep.slice(0, 44));
        }
      }
    }
  });

  // 规则 5：3 条必须是 3 种不同策略
  if (strategies.filter(Boolean).length === 3 && new Set(strategies).size < 3) flag(r.id, 0, "三条思路重复", strategies.join(" / "));
  for (let i = 0; i < replies.length; i++)
    for (let j = i + 1; j < replies.length; j++)
      if (nearDup(replies[i], replies[j])) flag(r.id, 0, "两条回复近乎同一句", `「${replies[i].slice(0, 26)}」≈「${replies[j].slice(0, 26)}」`);

  perCase.push({
    id: r.id, intent: r.intent, persona: r.persona, formal,
    lens: replies.map(chLen), model: r.model, ms: r.ms,
    issues: violations.filter(v => v.caseId === r.id).length
  });
}

// ---------- 按规则 / 按意图汇总 ----------
const byIntent = {};
for (const c of perCase) {
  (byIntent[c.intent] = byIntent[c.intent] || { cases: 0, replies: 0, over40: 0, lenSum: 0, issues: 0 });
  const b = byIntent[c.intent];
  b.cases++; b.replies += c.lens.length; b.lenSum += c.lens.reduce((a, x) => a + x, 0);
  b.over40 += c.lens.filter(x => x > LEN_LIMIT).length; b.issues += c.issues;
}

const avgLen = perCase.flatMap(c => c.lens).reduce((a, x) => a + x, 0) / nReplies;
const cleanCases = perCase.filter(c => c.issues === 0).length;

const summary = {
  ranAt: new Date().toISOString(),
  cases: nCases, replies: nReplies,
  avgReplyLen: Math.round(avgLen * 10) / 10,
  over40Count: perCase.flatMap(c => c.lens).filter(x => x > LEN_LIMIT).length,
  cleanCases, cleanRate: (cleanCases / nCases * 100).toFixed(1) + "%",
  violationTotal: violations.length,
  perRule, byIntent, perCase, violations
};

fs.writeFileSync(OUT, JSON.stringify(summary, null, 2), "utf8");

// ---------- 控制台 ----------
console.log("生成质量评测 · 客观规则核查");
console.log("=".repeat(52));
console.log(`用例 ${nCases} 条 / 候选 ${nReplies} 条（每例 3 条）`);
console.log(`平均回复长度 ${summary.avgReplyLen} 字（上限 ${LEN_LIMIT}）`);
console.log(`超长条数 ${summary.over40Count}`);
console.log(`0 违规的用例：${cleanCases}/${nCases}（${summary.cleanRate}）`);
console.log(`违规总计 ${violations.length} 处`);
console.log("\n按规则：");
for (const [k, v] of Object.entries(perRule).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(3)}  ${k}`);
console.log("\n按意图（平均长度 / 超长条数 / 违规数）：");
for (const [k, v] of Object.entries(byIntent)) {
  console.log(`  ${k.padEnd(8)}  ${(v.lenSum / v.replies).toFixed(1).padStart(5)} 字  ${String(v.over40).padStart(2)} 超长  ${String(v.issues).padStart(3)} 违规`);
}
console.log("\n明细：" + OUT);

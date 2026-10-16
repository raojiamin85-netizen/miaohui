/**
 * 匿名埋点（方案 A）回归测试 · v0.16 新增
 *
 * 要守住的不只是「埋点能上报」，更重要的是「埋点不越界」：
 *   A 打开 / 生成 / 复制 这些动作确实被记下来了
 *   B 失败也被记下来，而且能区分是「首字超时」还是「模型没吐完」
 *   C **聊天原文、风格样本、生成的回复内容，一个字都不许进上报**（隐私承诺的可执行版本）
 *   D 上报失败（甚至上报直接抛异常）都不许影响生成
 *
 * 跑法：NODE_PATH=<node workspace>/node_modules node scripts/e2e-events.cjs
 */
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const DIR = path.resolve(__dirname, "..");
const URL = "file:///" + DIR.replace(/\\/g, "/") + "/index.html";
const LOG = path.join(__dirname, "events-report.txt");

const lines = [];
let pass = 0, fail = 0;
// 版本号从 version.json 读，别写死：改版时标题会自己跟着走（v0.17 修的）
let PAGE_VER = "";
try { PAGE_VER = JSON.parse(fs.readFileSync(path.join(DIR, "version.json"), "utf8")).version; } catch (e) {}
const check = (name, cond, extra) => {
  lines.push((cond ? "PASS  " : "FAIL  ") + name + (extra ? "   [" + extra + "]" : ""));
  cond ? pass++ : fail++;
};

const SDK_STUB = `
window.WorkBuddyCloud = {
  createWorkBuddyCloud: function () {
    var db = {
      from: function (table) {
        return {
          insert: function (row) {
            if (table === "events") {
              window.__rows.push(JSON.parse(JSON.stringify(row)));
              if (window.__insertMode === "throw") throw new Error("insert boom");
              if (window.__insertMode === "error") return Promise.resolve({ error: { code: "DATABASE_42501" } });
            }
            return Promise.resolve({ error: null });
          },
          select: function () { return { order: function () { return {}; } }; }
        };
      }
    };
    var llm = {
      models: { list: async function () { return window.__stub.models; } },
      chat: {
        completions: {
          create: function (a) {
            window.__calls.push(a.model);
            if (window.__throwOnCall) throw new Error("bad json in response");
            var pieces = window.__pieces;
            return (async function* () {
              for (var i = 0; i < pieces.length; i++) {
                await new Promise(function (r) { setTimeout(r, window.__gap); });
                yield { choices: [{ delta: { content: pieces[i] } }] };
              }
            })();
          }
        }
      }
    };
    return {
      auth: {
        onAuthStateChange: function () {},
        getSession: async function () { return { data: null }; },
        getUser: async function () { return { data: null }; },
        signOut: async function () { return {}; }
      },
      database: db,
      llm: llm
    };
  }
};
`;

const CHAT_MARK = "MARKER_CHAT_9F3A";
const STYLE_MARK = "MARKER_STYLE_7B2C";

const INIT_SCRIPT = `
window.__rows = [];
window.__calls = [];
window.__trackForce = true;   // file:// 下默认不打点，测试要断言上报内容，这里显式打开
window.__insertMode = "ok";
window.__throwOnCall = false;
window.__gap = 30;
window.__json = JSON.stringify({ candidates: [
  { reply: "REPLY_MARKER_AAA 我在的", strategy: "接住话头" },
  { reply: "REPLY_MARKER_BBB 领导好", strategy: "稳重大方" },
  { reply: "REPLY_MARKER_CCC 在，随时说", strategy: "简短回应" }
]});
window.__pieces = [];
(function () {
  var step = Math.ceil(window.__json.length / 6);
  for (var i = 0; i < window.__json.length; i += step) window.__pieces.push(window.__json.slice(i, i + step));
})();
`;

const MODELS = [
  { id: "deepseek-v4.1-flash", name: "x", supportsImages: true },
  { id: "glm-5.3-flash", name: "x", supportsImages: true }
];

// 替身脚本先自检语法：少一个括号会让 SDK 整段加载失败，而表现出来只是「生成按钮点不动」，
// 排查成本极高（2026-10-16 就为一个多余的 } 找了一轮）。所以先在这里挡住。
for (const [name, code] of [["SDK_STUB", SDK_STUB], ["INIT_SCRIPT", INIT_SCRIPT]]) {
  try { new Function(code); }
  catch (e) { console.error("替身脚本 " + name + " 语法错误：" + e.message + "（先修这里，否则后面的失败全是假象）"); process.exit(1); }
}

async function openPage(browser, opts) {
  const o = opts || {};
  const ctx = await browser.newContext({ viewport: { width: 900, height: 1100 }, locale: "zh-CN" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(String(e && e.message || e)));
  await page.route(u => u.href.indexOf("workbuddy-cloud-sdk") >= 0, r =>
    r.fulfill({ status: 200, contentType: "application/javascript", body: SDK_STUB }));
  await page.addInitScript(INIT_SCRIPT.replace("window.__trackForce = true;",
    "window.__trackForce = " + (o.track === false ? "false" : "true") + ";"));
  await page.addInitScript(`window.__stub = { models: ${JSON.stringify(MODELS)} };`);
  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(1200);
  return { ctx, page, errors };
}

const rows = page => page.evaluate(() => window.__rows);

(async () => {
  lines.push("妙回 " + PAGE_VER + " 匿名埋点（方案 A）回归测试");
  lines.push("时间：" + new Date().toISOString());
  lines.push("");
  const browser = await chromium.launch({ channel: "msedge" });

  // ---------- A. 打开 + 生成成功 + 复制 ----------
  {
    const { ctx, page, errors } = await openPage(browser);
    const r0 = await rows(page);
    check("A1 打开页面就上报了一次 open", r0.some(r => r.event === "open"), "共 " + r0.length + " 条");
    check("A2 open 带上了页面版本号", r0.some(r => r.event === "open" && /^V\d/.test(r.ver || "")),
      (r0.find(r => r.event === "open") || {}).ver);

    await page.locator("#context").fill("对方：" + CHAT_MARK + "\n我：好的");
    await page.locator("#style").fill(STYLE_MARK + " 一行一条");
    await page.locator("#intents .chip").nth(4).click();
    await page.locator("#personas .chip").nth(0).click();
    await page.locator("#go").click();
    await page.waitForSelector("#results .cand", { timeout: 25000 });
    await page.waitForTimeout(400);

    const r1 = await rows(page);
    const start = r1.find(r => r.event === "gen_start");
    const okRow = r1.find(r => r.event === "gen_ok");
    check("A3 生成前上报了 gen_start", !!start, start ? "intent=" + start.intent + " persona=" + start.persona : "缺失");
    check("A4 gen_start 带了意图与身份", !!(start && start.intent && start.persona));
    check("A5 生成成功上报了 gen_ok 且带耗时", !!(okRow && typeof okRow.ms === "number" && okRow.ms >= 0),
      okRow ? "ms=" + okRow.ms + " model=" + okRow.model : "缺失");
    check("A6 gen_ok 记的是真正干活的模型", !!(okRow && okRow.model === "deepseek-v4.1-flash"), okRow && okRow.model);

    await page.locator("#results .cand .copy").first().click();
    await page.waitForTimeout(300);
    const r2 = await rows(page);
    check("A7 点复制会上报 copy（这是最关键的成败信号）", r2.some(r => r.event === "copy"));

    // 隐私：逐字扫描所有上报行
    const blob = JSON.stringify(r2);
    check("A8 聊天原文没有进上报", blob.indexOf(CHAT_MARK) < 0);
    check("A9 风格样本没有进上报", blob.indexOf(STYLE_MARK) < 0);
    check("A10 生成的回复内容没有进上报", blob.indexOf("REPLY_MARKER") < 0);
    const allowed = ["id", "created_at", "event", "intent", "persona", "model", "ms", "ok", "err", "ver"];
    const badKeys = [...new Set(r2.flatMap(r => Object.keys(r)).filter(k => allowed.indexOf(k) < 0))];
    check("A11 上报字段只有白名单里的那几个", badKeys.length === 0, badKeys.length ? "多出：" + badKeys.join(",") : allowed.length + " 个字段");
    check("A12 无未捕获异常", errors.length === 0, errors.join(" | "));
    await ctx.close();
  }

  // ---------- B. 失败也要记下来，并且能区分类型 ----------
  {
    const { ctx, page } = await openPage(browser);
    await page.evaluate(() => { window.__throwOnCall = true; });
    await page.locator("#context").fill("对方：你好");
    await page.locator("#intents .chip").nth(4).click();
    await page.locator("#go").click();
    await page.waitForFunction(() => (document.getElementById("status") || {}).className.indexOf("err") >= 0, { timeout: 20000 });
    const r = await rows(page);
    const f = r.find(x => x.event === "gen_fail");
    check("B1 生成失败会上报 gen_fail", !!f, f ? "err=" + f.err : "缺失");
    check("B2 失败原因被归成可统计的类别（不是一句原文）", !!(f && f.err === "bad_json"), f && f.err);
    check("B3 失败也带耗时", !!(f && typeof f.ms === "number"), f && "ms=" + f.ms);
    await ctx.close();
  }

  // ---------- C. 上报本身出问题，绝不影响生成 ----------
  for (const mode of ["error", "throw"]) {
    const { ctx, page, errors } = await openPage(browser);
    await page.evaluate(m => { window.__insertMode = m; }, mode);
    await page.locator("#context").fill("对方：你好");
    await page.locator("#intents .chip").nth(4).click();
    await page.locator("#go").click();
    await page.waitForSelector("#results .cand", { timeout: 25000 });
    const n = await page.locator("#results .cand").count();
    check("C" + (mode === "error" ? "1" : "2") + " 上报返回错误（" + mode + "）时，生成照常出 3 条", n === 3, "cand=" + n);
    check("C" + (mode === "error" ? "1" : "2") + "b 上报出问题时页面零异常", errors.length === 0, errors.join(" | "));
    await ctx.close();
  }

  // ---------- D. 本地开发不打点（防止测试噪音写进真实数据）----------
  {
    const { ctx, page, errors } = await openPage(browser, { track: false });
    await page.locator("#context").fill("对方：你好");
    await page.locator("#intents .chip").nth(4).click();
    await page.locator("#go").click();
    await page.waitForSelector("#results .cand", { timeout: 25000 });
    await page.waitForTimeout(400);
    const r = await rows(page);
    check("D1 file:// 下默认一条都不上报（开发噪音不进线上库）", r.length === 0, "共 " + r.length + " 条");
    check("D2 不打点也不影响生成", (await page.locator("#results .cand").count()) === 3);
    check("D3 无未捕获异常", errors.length === 0, errors.join(" | "));
    await ctx.close();
  }

  await browser.close();
  lines.push("");
  lines.push("合计：" + pass + " 通过 / " + fail + " 失败");
  const report = lines.join("\n") + "\n";
  fs.writeFileSync(LOG, report, "utf8");
  console.log(report);
  process.exit(fail ? 1 : 0);
})();

/**
 * 模型候选链 / 首字超时兜底 / 版本自检 的回归测试（v0.15 新增）
 *
 * 背景：线上实测发现应用用的是「模型列表里第一个未禁用项」= 平台默认的 auto，
 * 同一 prompt 首字 125.3s（另一次 >75s 完全没输出），而 flash 档只要 0.9~7.6s。
 * 本脚本用替身 SDK 把这些行为变成可复现的用例，防止以后改回去：
 *   A 候选链选择：首次必须命中 deepseek-v4.1-flash，且链里不含 auto / default
 *   B 优选模型不在列表时：退到其它支持图片的模型，不能退到 auto
 *   C 首字超时：第一个候选不吐字时自动换下一个，且总耗时有上限
 *   D 等待期间能看到「已经写好 N 条」
 *   E 取消：点取消能立刻停，且状态回到「已取消」
 *   F 版本自检：落后时出现提示条，点一下带 ?v= 强制刷新；版本一致时不出提示
 *
 * 跑法：NODE_PATH=<node workspace>/node_modules node scripts/e2e-model-chain.cjs
 */
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const DIR = path.resolve(__dirname, "..");
const URL = "file:///" + DIR.replace(/\\/g, "/") + "/index.html";
const LOG = path.join(__dirname, "model-chain-report.txt");

const lines = [];
let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  lines.push((cond ? "PASS  " : "FAIL  ") + name + (extra ? "   [" + extra + "]" : ""));
  cond ? pass++ : fail++;
};

// 替身云 SDK：只实现应用真正会用到的那几个方法
const SDK_STUB = `
window.WorkBuddyCloud = {
  createWorkBuddyCloud: function () {
    var cfg = window.__stub || {};
    return {
      auth: {
        onAuthStateChange: function () {},
        getSession: async function () { return { data: null }; },
        getUser: async function () { return { data: null }; },
        signInWithPassword: async function () { return { data: null, error: null }; },
        signOut: async function () { return {}; }
      },
      database: {
        from: function () {
          return { insert: async function () { return { error: null }; },
                   select: function () { return { order: function () { return { limit: async function () { return { data: [] }; } }; } }; } };
        }
      },
      llm: {
        models: { list: async function () { return cfg.models || []; } },
        chat: { completions: { create: function (a) { return cfg.create(a); } } }
      }
    };
  }
};
`;

// 会把一段 JSON 分片流式吐出来的生成器
const INIT_SCRIPT = `
window.__json = JSON.stringify({ candidates: [
  { reply: "我在的，你说", strategy: "接住话头" },
  { reply: "领导好，什么事", strategy: "稳重大方" },
  { reply: "在，随时说", strategy: "简短回应" }
]});
window.__pieces = [];
(function () {
  var step = Math.ceil(window.__json.length / 8);
  for (var i = 0; i < window.__json.length; i += step) window.__pieces.push(window.__json.slice(i, i + step));
})();
window.__gap = 250;
window.__hangModels = [];
window.__calls = [];
`;

function models(spec) {
  return spec.map(m => ({ id: m[0], name: m[0], supportsImages: m[1] !== false, disabled: m[2] === true }));
}

async function openPage(browser, opts) {
  const o = opts || {};
  const ctx = await browser.newContext({ viewport: { width: 900, height: 1000 }, locale: "zh-CN" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(String(e && e.message || e)));
  await page.route(u => u.href.indexOf("workbuddy-cloud-sdk") >= 0, r => (o.sdkFail
    ? r.abort()
    : r.fulfill({ status: 200, contentType: "application/javascript", body: SDK_STUB })));
  await page.addInitScript(INIT_SCRIPT);
  await page.addInitScript(`
    window.__stub = {
      models: ${JSON.stringify(o.models || [])},
      create: function (a) {
        window.__calls.push(a.model);
        var id = a.model;
        var pieces = window.__pieces;
        var gap = (window.__gap === undefined) ? 250 : window.__gap;
        var hang = window.__hangModels || [];
        return (async function* () {
          if (hang.indexOf(id) >= 0) {
            await new Promise(function (res) { a.signal.addEventListener("abort", res); setTimeout(res, 25000); });
            return;
          }
          for (var i = 0; i < pieces.length; i++) {
            await new Promise(function (r) { setTimeout(r, gap); });
            yield { choices: [{ delta: { content: pieces[i] } }] };
          }
        })();
      }
    };
  `);
  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(1200);
  return { ctx, page, errors };
}

const DEFAULTS = models([
  ["deepseek-v4.1-flash", true], ["glm-5.3-flash", true], ["hy3", true], ["auto", true], ["default", false],
]);

(async () => {
  lines.push("妙回 V0.15 模型候选链 / 首字超时兜底 / 版本自检 回归测试");
  lines.push("时间：" + new Date().toISOString());
  lines.push("");
  const browser = await chromium.launch({ channel: "msedge" });

  // ---------- A. 候选链选择 ----------
  {
    const { ctx, page, errors } = await openPage(browser, { models: DEFAULTS });
    const chain = await page.evaluate(() => window.__modelChain || []);
    check("A1 候选链首选 deepseek-v4.1-flash", chain[0] === "deepseek-v4.1-flash", "链=" + chain.join(" > "));
    check("A2 候选链里没有 auto / default", chain.indexOf("auto") < 0 && chain.indexOf("default") < 0, "链=" + chain.slice(0, 4).join(" > "));
    const goDisabled = await page.evaluate(() => document.getElementById("go").disabled);
    check("A3 模型就绪后「生成回复」可用", goDisabled === false);

    await page.locator("#context").fill("对方：你好");
    await page.locator("#intents .chip").nth(4).click();
    await page.locator("#personas .chip").nth(0).click();
    await page.locator("#go").click();

    // 采样等待期的状态文案，抓「已经写好 N 条」
    let sawProgress = false;
    for (let i = 0; i < 45; i++) {
      const t = await page.evaluate(() => (document.getElementById("status") || {}).textContent || "");
      if (t.indexOf("已经写好") >= 0) { sawProgress = true; break; }
      await page.waitForTimeout(120);
    }
    await page.waitForSelector("#results .cand", { timeout: 20000 });
    const cands = await page.locator("#results .cand").count();
    check("A4 生成出 3 条候选", cands === 3, "cand=" + cands);
    check("A5 等待期间出现过「已经写好 N 条」进度", sawProgress);
    const usedModel = await page.evaluate(() => window.__calls[0]);
    check("A6 实际用的是候选链首位模型", usedModel === "deepseek-v4.1-flash", "用了 " + usedModel);
    const statusAfter = await page.evaluate(() => (document.getElementById("status") || {}).style.display);
    check("A7 生成结束后进度条收起", statusAfter === "none", "display=" + statusAfter);
    check("A8 无未捕获异常", errors.length === 0, errors.join(" | "));
    await ctx.close();
  }

  // ---------- B. 优选模型缺席时的退路 ----------
  {
    const { ctx, page } = await openPage(browser, { models: models([["auto", true], ["default", true], ["hy4-preview", true]]) });
    const chain = await page.evaluate(() => window.__modelChain || []);
    check("B1 没有优选模型时退到其它支持图片的模型（不是 auto）", chain.length > 0 && chain[0] === "hy4-preview", "链=" + chain.join(" > "));
    await ctx.close();
  }
  {
    const { ctx, page } = await openPage(browser, { models: models([["auto", true], ["default", true], ["hunyuan-chat", false]]) });
    const st = await page.evaluate(() => ({
      chain: window.__modelChain || [],
      go: document.getElementById("go").disabled,
      status: (document.getElementById("status") || {}).textContent || ""
    }));
    check("B2 连一个支持图片的模型都没有时明确报错并禁用生成", st.chain.length === 0 && st.go === true && st.status.indexOf("没有可用") >= 0, "status=" + st.status);
    await ctx.close();
  }

  // ---------- B3. 依赖脚本拉不下来时要说清楚 ----------
  {
    const { ctx, page } = await openPage(browser, { models: DEFAULTS, sdkFail: true });
    const st = await page.evaluate(() => ({
      sdk: typeof window.WorkBuddyCloud,
      go: document.getElementById("go").disabled,
      status: (document.getElementById("status") || {}).textContent || ""
    }));
    check("B3 云 SDK 没加载成功时明确提示并禁用生成（不再静默失灵）",
      st.sdk === "undefined" && st.go === true && st.status.indexOf("依赖脚本") >= 0, "status=" + st.status);
    await ctx.close();
  }

  // ---------- C. 首字超时自动换模型 ----------
  {
    const { ctx, page, errors } = await openPage(browser, { models: DEFAULTS });
    await page.evaluate(() => { window.__hangModels = ["deepseek-v4.1-flash"]; });   // 首选模型一个字都不吐
    await page.locator("#context").fill("对方：你好");
    await page.locator("#intents .chip").nth(4).click();
    const t0 = Date.now();
    await page.locator("#go").click();
    await page.waitForSelector("#results .cand", { timeout: 30000 });
    const cost = Date.now() - t0;
    const calls = await page.evaluate(() => window.__calls.slice());
    const cands = await page.locator("#results .cand").count();
    check("C1 首选模型不吐字时自动换下一个候选", calls.length >= 2 && calls[0] === "deepseek-v4.1-flash" && calls[1] === "glm-5.3-flash", "调用顺序=" + calls.join(" > "));
    check("C2 换模型后仍然给出 3 条候选", cands === 3, "cand=" + cands);
    check("C3 总耗时受控（<25s，首字看门狗 8s + 第二个模型生成）", cost < 25000, "实际 " + Math.round(cost / 1000) + "s");
    const goBack = await page.evaluate(() => document.getElementById("go").disabled);
    check("C4 结束后按钮恢复可用", goBack === false);
    check("C5 无未捕获异常", errors.length === 0, errors.join(" | "));
    await ctx.close();
  }

  // ---------- D. 取消 ----------
  {
    const { ctx, page } = await openPage(browser, { models: DEFAULTS });
    await page.evaluate(() => { window.__hangModels = ["deepseek-v4.1-flash", "glm-5.3-flash", "hy3"]; });
    await page.locator("#context").fill("对方：你好");
    await page.locator("#intents .chip").nth(4).click();
    await page.locator("#go").click();
    await page.waitForTimeout(1500);
    await page.locator("#cancel").click();
    await page.waitForTimeout(1200);
    const st = await page.evaluate(() => ({
      status: (document.getElementById("status") || {}).textContent || "",
      go: document.getElementById("go").disabled,
      cands: document.querySelectorAll("#results .cand").length
    }));
    check("D1 点取消后状态显示「已取消」", st.status.indexOf("已取消") >= 0, "status=" + st.status);
    check("D2 取消后按钮恢复、不出候选", st.go === false && st.cands === 0, "go=" + st.go + " cand=" + st.cands);
    await ctx.close();
  }

  // ---------- E. 版本自检 ----------
  {
    const { ctx, page } = await openPage(browser, { models: DEFAULTS });
    const r1 = await page.evaluate(async () => {
      window.fetch = async () => ({ ok: true, json: async () => ({ version: "V9.9" }) });
      await checkNewVersion();
      const bar = document.getElementById("verBar");
      return { bar: !!bar, text: bar ? bar.textContent : "", btn: bar ? bar.querySelector("button").textContent : "" };
    });
    check("E1 服务端版本更新时出现提示条", r1.bar && r1.text.indexOf("V9.9") >= 0, r1.text);
    check("E2 提示条带「刷新到新版」按钮", r1.btn.indexOf("刷新") >= 0, r1.btn);
    let navUrl = "";
    try {
      await Promise.all([
        page.waitForURL(u => u.href.indexOf("?v=V9.9") >= 0, { timeout: 8000 }),
        page.locator("#verBar button").click()
      ]);
      navUrl = page.url();
    } catch (e) { navUrl = "未跳转: " + e.message.split("\n")[0]; }
    check("E3 点刷新会带 ?v= 参数强制重新取（绕开缓存）", navUrl.indexOf("?v=V9.9") >= 0, navUrl);
    await ctx.close();
  }
  {
    const { ctx, page } = await openPage(browser, { models: DEFAULTS });
    const r2 = await page.evaluate(async () => {
      const myVer = (document.querySelector(".ver") || {}).textContent || "";
      window.fetch = async () => ({ ok: true, json: async () => ({ version: myVer }) });
      await checkNewVersion();
      return { myVer, bar: !!document.getElementById("verBar") };
    });
    check("E4 版本一致时不出提示条", !r2.bar, "页面版本=" + r2.myVer);
    await ctx.close();
  }

  await browser.close();
  lines.push("");
  lines.push("合计：" + pass + " 通过 / " + fail + " 失败");
  fs.writeFileSync(LOG, lines.join("\n") + "\n", "utf8");
  console.log(lines.join("\n"));
  process.exit(fail ? 1 : 0);
})();

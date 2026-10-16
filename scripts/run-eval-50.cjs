/**
 * 生成质量评测 runner：在真实线上页面上把 50 条用例各跑一遍，
 * 收集每条用例的 3 个候选（回复正文 + 思路）、实际使用的模型与耗时。
 *
 * ⚠️ 隐私与数据卫生（重要）：
 *   1. 全程拦截 `/.cloud/database/rest/events`，用假 201 顶掉。
 *      —— 不拦的话这 50 次会往线上 events 表写 150 行（每次 open/gen_start/gen_ok 三行），
 *         把真实使用统计淹掉。假 201 让 SDK 以为写成功了，实际一行都没落库。
 *   2. 测的是**线上真实页面**，不是本地替身——只有这样才能反映用户实际拿到的输出质量。
 *      （本地 file:// 打开会撞云接口的 Origin 白名单，生成必然失败。）
 *
 * 跑法：NODE_PATH=<node workspace>/node_modules node scripts/run-eval-50.cjs
 *   环境变量：
 *     MH_URL  默认线上地址；本地页面也能跑（实测 file:// 可调通云接口），
 *             所以「改提示词 → 本地重跑 → 对比」不必先发布。
 *     MH_OUT  产出文件名（默认 eval-raw.json），用于前后版本各存一份。
 *     MH_LIMIT 只跑前 N 条（小样试跑用）
 * 产出：docs/evidence/<MH_OUT>
 */
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const URL = process.env.MH_URL || "https://miaohui-reply.app.workbuddy.host/";
const DIR = path.resolve(__dirname, "..");
const CASES = JSON.parse(fs.readFileSync(path.join(__dirname, "eval-cases.json"), "utf8")).cases
  .slice(0, process.env.MH_LIMIT ? Number(process.env.MH_LIMIT) : undefined);
const OUT = path.join(DIR, "docs", "evidence", process.env.MH_OUT || "eval-raw.json");

const PER_CASE_MS = 120000;

(async () => {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 1000, height: 1100 }, locale: "zh-CN" });

  let blocked = 0;
  await page.route("**/.cloud/database/rest/**", route => {
    blocked++;
    // 假 201：让 SDK 认为写成功，实际不落库
    return route.fulfill({ status: 201, contentType: "application/json", body: "[]" });
  });

  const pageErrors = [];
  page.on("pageerror", e => pageErrors.push(String((e && e.message) || e)));

  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(3000);

  const chain = await page.evaluate(() => window.__modelChain || null);
  console.log("线上页面就绪。候选链：" + (chain ? chain.join(" > ") : "(未暴露)"));
  console.log("埋点写入已拦截。用例数：" + CASES.length + "\n");

  const results = [];
  for (let i = 0; i < CASES.length; i++) {
    const c = CASES[i];
    const tag = `[${String(i + 1).padStart(2)}/${CASES.length}] ${c.id} ${c.intent}`;
    const rec = { ...c, ok: false, err: "", model: "", ms: 0, candidates: [] };
    try {
      // 填上下文
      await page.locator("#context").fill(c.context);
      // 风格样本 / 补充说明（没有就清空，避免串到上一条）
      await page.locator("#style").fill(c.style || "");
      await page.locator("#extra").fill(c.extra || "");

      // 精确点选意图与身份（子串匹配会误中，如「对象」会命中「暗恋对象」）
      const clicked = await page.evaluate(({ intent, persona }) => {
        const pick = (sel, text) => {
          const el = [...document.querySelectorAll(sel)].find(x => (x.textContent || "").trim() === text);
          if (!el) return false;
          el.click();
          return true;
        };
        return { intent: pick("#intents .chip", intent), persona: pick("#personas .chip", persona) };
      }, { intent: c.intent, persona: c.persona });
      if (!clicked.intent || !clicked.persona) throw new Error("选不中 chip: " + JSON.stringify(clicked));

      const t0 = Date.now();
      await page.locator("#go").click();
      // 点生成会先清空结果区；这里等它真的清掉，再等新的 3 条，避免读到上一轮结果
      await page.waitForFunction(() => document.querySelectorAll("#results .cand").length === 0, { timeout: 8000 }).catch(() => {});
      await page.waitForFunction(() => document.querySelectorAll("#results .cand").length >= 3, { timeout: PER_CASE_MS });
      rec.ms = Date.now() - t0;

      rec.candidates = await page.evaluate(() =>
        [...document.querySelectorAll("#results .cand")].slice(0, 3).map(el => ({
          reply: (el.querySelector(".reply") || {}).textContent || "",
          strategy: (el.querySelector(".strategy") || {}).textContent || ""
        }))
      );
      rec.model = await page.evaluate(() => window.__activeModel || "");
      rec.ok = rec.candidates.filter(x => x.reply.trim()).length === 3;
      if (!rec.ok) rec.err = "候选不足 3 条";
      console.log(`${tag}  ${(rec.ms / 1000).toFixed(1)}s  ${rec.model}`);
      rec.candidates.forEach((k, j) => console.log(`        ${j + 1}. ${k.reply.replace(/\s+/g, " ").slice(0, 60)}`));
    } catch (e) {
      rec.err = String((e && e.message) || e).slice(0, 160);
      console.log(`${tag}  ✗ ${rec.err}`);
      // 失败的用例也让页面回到可用状态
      await page.evaluate(() => { const g = document.getElementById("go"); if (g) g.disabled = false; });
      await page.waitForTimeout(1200);
    }
    results.push(rec);
    // 增量落盘：中途崩了也不丢已跑的部分
    fs.writeFileSync(OUT, JSON.stringify({
      url: URL, ranAt: new Date().toISOString(), total: CASES.length,
      doneCount: results.length, modelChain: chain, blockedEventWrites: blocked,
      pageErrors, results
    }, null, 2), "utf8");
  }

  const okCount = results.filter(r => r.ok).length;
  console.log(`\n完成：${okCount}/${CASES.length} 成功`);
  console.log("被拦截的埋点写入次数：" + blocked + "（期望 > 0，说明真的没落库）");
  console.log("页面异常：" + (pageErrors.length ? pageErrors.join(" | ") : "无"));
  console.log("原始结果：" + OUT);
  await browser.close();
})().catch(e => { console.error("FATAL " + (e && e.stack || e)); process.exit(1); });

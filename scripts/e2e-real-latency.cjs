/**
 * 真实端到端耗时实测：在真实页面上走一遍「贴对话 → 选意图 → 生成」，
 * 用真实云接口，量出用户实际等待的秒数（v0.15 改动前后各跑一次做对比）。
 *
 * 顺带量一次「上传截图 → 识别」的耗时。
 *
 * 跑法：
 *   node scripts/e2e-real-latency.cjs                 # 测本地 index.html
 *   node scripts/e2e-real-latency.cjs <线上URL>        # 测线上
 */
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const DIR = path.resolve(__dirname, "..");
const arg = process.argv[2];
const URL = arg || ("file:///" + DIR.replace(/\\/g, "/") + "/index.html");
const OUT = path.join(__dirname, "real-latency-report.txt");
const SHOT = path.join(DIR, "docs", "evidence", "fake-chat-screenshot.png");

(async () => {
  const lines = [];
  const say = s => { lines.push(s); console.log(s); };
  say("真实生成耗时实测");
  say("目标：" + URL);
  say("时间：" + new Date().toISOString());
  say("");

  const browser = await chromium.launch({ channel: "msedge" });
  const page = await browser.newPage({ viewport: { width: 1000, height: 1100 }, locale: "zh-CN" });
  const errors = [];
  page.on("pageerror", e => errors.push(String(e && e.message || e)));
  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(2500);

  const chain = await page.evaluate(() => window.__modelChain || null);
  say("候选链（页面自己读到的）：" + (chain ? chain.join(" > ") : "(未暴露)"));
  say("");

  // 用户报的那个场景：领导发「你好」，意图「接住话头」
  await page.locator("#context").fill("对方：你好");
  await page.locator("#intents .chip", { hasText: "接住话头" }).click();
  await page.locator("#personas .chip", { hasText: "领导" }).first().click();

  const t0 = Date.now();
  await page.locator("#go").click();
  // 记录「首字可见」= 进度区出现「已经写好 N 条」
  let firstVisible = null;
  for (let i = 0; i < 300; i++) {
    const t = await page.evaluate(() => (document.getElementById("status") || {}).textContent || "");
    if (t.indexOf("已经写好") >= 0) { firstVisible = Date.now() - t0; break; }
    if (await page.locator("#results .cand").count()) break;
    await page.waitForTimeout(100);
  }
  await page.waitForSelector("#results .cand", { timeout: 120000 });
  const total = Date.now() - t0;
  const usedModel = await page.evaluate(() => window.__activeModel || "(未知)");

  say("【生成】");
  say("  实际使用的模型  : " + usedModel);
  say("  首个候选可见    : " + (firstVisible === null ? "未捕捉到（生成太快）" : (firstVisible / 1000).toFixed(1) + " 秒"));
  say("  全部 3 条完成   : " + (total / 1000).toFixed(1) + " 秒");
  const cands = await page.locator("#results .cand").allInnerTexts();
  cands.forEach((c, i) => say("  候选" + (i + 1) + "：" + c.replace(/\s+/g, " ").slice(0, 90)));
  say("");

  // 截图识别耗时
  if (fs.existsSync(SHOT)) {
    await page.locator("#context").fill("");
    const t1 = Date.now();
    await page.locator("#shotFile").setInputFiles(SHOT);
    await page.waitForFunction(() => {
      const b = document.querySelector("#shots .badge");
      return b && (b.textContent === "已提取" || b.textContent === "失败");
    }, { timeout: 120000 }).catch(() => {});
    const cost = Date.now() - t1;
    const badge = await page.evaluate(() => { const b = document.querySelector("#shots .badge"); return b ? b.textContent : "(无)"; });
    const filled = await page.evaluate(() => (document.getElementById("context") || {}).value || "");
    say("【截图识别】");
    say("  耗时            : " + (cost / 1000).toFixed(1) + " 秒");
    say("  结果状态        : " + badge);
    say("  识别出的内容    : " + filled.replace(/\n/g, " / ").slice(0, 120));
    say("");
  }

  say("页面未捕获异常：" + (errors.length ? errors.join(" | ") : "无"));
  await browser.close();
  fs.writeFileSync(OUT, lines.join("\n") + "\n", "utf8");
})();

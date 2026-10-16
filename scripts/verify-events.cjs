/**
 * 验证 events 表在生产路径上可用（真实 SDK + 真实域名 + 真实匿名身份）。
 * 结论要同时满足两条，缺一不可：
 *   ① 匿名写入成功 -> 埋点能落库
 *   ② 匿名读回被拒 -> 别人的使用数据不会被任何访客看到
 * 跑法：NODE_PATH=<node workspace>/node_modules node scripts/verify-events.cjs
 */
const { chromium } = require("playwright");

const LIVE = "https://miaohui-reply.app.workbuddy.host/";

(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage();
  const errs = [];
  page.on("pageerror", e => errs.push(String(e && e.message || e)));
  await page.goto(LIVE, { waitUntil: "load" });
  await page.waitForTimeout(2500);

  const r = await page.evaluate(async () => {
    const out = {};
    // 用页面上已经加载好的真实 SDK 实例（与线上埋点走的是同一条路径）
    try {
      const ins = await cloud.database.from("events").insert({
        event: "probe_sdk", ver: (document.querySelector(".ver") || {}).textContent || "", ok: true, ms: 1
      });
      out.insertOk = !ins.error;
      out.insertErr = ins.error ? (ins.error.code || ins.error.message || String(ins.error)) : null;
    } catch (e) { out.insertOk = false; out.insertErr = "throw:" + (e && e.message); }
    try {
      const sel = await cloud.database.from("events").select("id").limit(1);
      out.selectBlocked = !!sel.error;
      out.selectErr = sel.error ? (sel.error.code || sel.error.message || String(sel.error)) : null;
      out.selectRows = sel.data ? sel.data.length : null;
    } catch (e) { out.selectBlocked = true; out.selectErr = "throw:" + (e && e.message); }
    return out;
  });

  console.log("目标：" + LIVE);
  console.log("① 匿名写入 events   : " + (r.insertOk ? "成功 OK" : "失败 -> " + r.insertErr));
  console.log("② 匿名读回 events   : " + (r.selectBlocked ? "被拒 OK（" + r.selectErr + "）" : "居然读到了 " + r.selectRows + " 行 -> 不合格"));
  console.log("页面异常：" + (errs.length ? errs.join(" | ") : "无"));
  const pass = r.insertOk && r.selectBlocked && !errs.length;
  console.log("\n" + (pass ? "✅ 通过：埋点能写、数据读不走" : "❌ 未通过"));
  await browser.close();
  process.exit(pass ? 0 : 1);
})();

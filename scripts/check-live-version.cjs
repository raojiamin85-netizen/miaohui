/**
 * 验证线上站点对「新访客」到底返回哪个版本，并检查缓存行为。
 * 用法：NODE_PATH=<node workspace node_modules> node check-live-version.cjs
 */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const URL = "https://miaohui-reply.app.workbuddy.host/";
const OUT = path.join(__dirname, "live-version-report.txt");
const lines = [];
const log = (s) => { lines.push(s); console.log(s); };

const readVersion = (page) =>
  page.evaluate(() => {
    const el = document.querySelector(".ver");
    if (el && el.textContent) return el.textContent.trim();
    const m = document.documentElement.innerHTML.match(/ver\.textContent\s*=\s*"([^"]+)"/);
    return m ? m[1] : "NOT FOUND";
  });

const readStyle = (page) =>
  page.evaluate(() => {
    const b = getComputedStyle(document.body).backgroundColor;
    const h = document.querySelector(".hero, header");
    return { bodyBg: b, heroFont: h ? getComputedStyle(h).fontFamily.slice(0, 60) : "" };
  });

(async () => {
  const browser = await chromium.launch({ channel: "msedge" });

  // ---- 场景 1：全新上下文，模拟第一次访问的新设备 ----
  log("=== 场景 1：全新浏览器上下文（新访客） ===");
  const ctx1 = await browser.newContext();
  const p1 = await ctx1.newPage();
  const resp1 = await p1.goto(URL, { waitUntil: "domcontentloaded", timeout: 45000 });
  await p1.waitForTimeout(2500);
  const v1 = await readVersion(p1);
  const s1 = await readStyle(p1);
  log(`status=${resp1.status()}  version=${v1}`);
  log(`body 背景=${s1.bodyBg}`);
  // 从 CDP 拿真实响应头
  try {
    const hdrs = await p1.evaluate(() => performance.getEntriesByType("navigation")[0].serverTiming || null);
    const entry = await p1.evaluate(() => {
      const e = performance.getEntriesByType("navigation")[0];
      return e ? { ttfb: Math.round(e.responseStart), transferSize: e.transferSize, encodedBodySize: e.encodedBodySize } : null;
    });
    log(`导航计时/大小: ${JSON.stringify(entry)}`);
  } catch (e) { log("timing 读取失败: " + e.message); }
  await p1.screenshot({ path: path.join(__dirname, "..", "docs", "evidence", "live-check-new-visitor.png") });

  // ---- 场景 2：同一上下文里第二次访问，观察是否命中磁盘缓存 ----
  log("");
  log("=== 场景 2：同上下文再次访问（观察是否走缓存） ===");
  await p1.goto("about:blank");
  const resp2 = await p1.goto(URL, { waitUntil: "domcontentloaded", timeout: 45000 });
  await p1.waitForTimeout(1500);
  const v2 = await readVersion(p1);
  log(`status=${resp2.status()}  version=${v2}`);
  const cd = resp2.headers();
  log(`响应头 cache-control=${cd["cache-control"] || "(无)"}  etag=${cd["etag"] || "(无)"}  last-modified=${cd["last-modified"] || "(无)"}`);

  // ---- 场景 3：带缓存破坏参数 ----
  log("");
  log("=== 场景 3：带 ?cb= 参数（强制回源） ===");
  const p3 = await ctx1.newPage();
  await p3.goto(URL + "?cb=" + Date.now(), { waitUntil: "domcontentloaded", timeout: 45000 });
  await p3.waitForTimeout(2000);
  log(`version=${await readVersion(p3)}`);

  // ---- 场景 4：模拟「用户浏览器里那份旧缓存」在强刷后是否更新 ----
  log("");
  log("=== 场景 4：硬刷新（Ctrl+Shift+R 等价：reload ignoreCache） ===");
  await p1.reload({ waitUntil: "domcontentloaded", timeout: 45000 });
  await p1.waitForTimeout(1500);
  log(`普通 reload 后 version=${await readVersion(p1)}`);

  await browser.close();
  lines.push("");
  lines.push("结论：" + (v1 === "V0.12" ? "新访客拿到 V0.12，服务器正常。" : "新访客拿到的不是 V0.12！需要排查部署。"));
  fs.writeFileSync(OUT, lines.join("\n") + "\n", "utf8");
})().catch((e) => {
  fs.writeFileSync(OUT, lines.join("\n") + "\nERR: " + e.message + "\n", "utf8");
  process.exit(1);
});

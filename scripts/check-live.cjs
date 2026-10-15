/* 线上验证（版本无关）：字节一致性 + PWA 资源可访问 + 版本自检文件 + 视觉截图 + manifest 解析
   跑法：NODE_PATH=<node workspace>/node_modules node scripts/check-live.cjs
   说明：原来叫 check-live-v014.cjs，每换一版就改文件名没意义，改成读 version.json 自动判定。 */
const fs = require("fs");
const path = require("path");
const pw = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const LIVE = "https://miaohui-reply.app.workbuddy.host/";
const EV = path.join(ROOT, "docs", "evidence");
const local = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
let expectVer = "?";
try { expectVer = JSON.parse(fs.readFileSync(path.join(ROOT, "version.json"), "utf8")).version; } catch (e) {}

const report = [];
const ok = s => report.push(s);

(async () => {
  ok("线上验证 " + expectVer + "  " + new Date().toISOString());
  ok("目标：" + LIVE);
  ok("");

  // ---- 1) 静态资源可访问性（带 cache-buster，绕开 CDN 缓存）----
  const bust = "?cb=" + Date.now();
  const probes = [
    ["index.html", LIVE + "index.html" + bust],
    ["version.json", LIVE + "version.json" + bust],
    ["manifest.webmanifest", LIVE + "manifest.webmanifest" + bust],
    ["pwa/icons/icon-180.png", LIVE + "pwa/icons/icon-180.png" + bust],
    ["pwa/icons/icon-192.png", LIVE + "pwa/icons/icon-192.png" + bust],
    ["pwa/icons/icon-512.png", LIVE + "pwa/icons/icon-512.png" + bust],
    ["pwa/icon.svg", LIVE + "pwa/icon.svg" + bust],
  ];
  const res = await fetch(LIVE + "index.html" + bust);
  const liveHtml = await res.text();
  const liveBytes = Buffer.byteLength(liveHtml, "utf8");
  const localBytes = Buffer.byteLength(local, "utf8");
  const liveVer = (liveHtml.match(/ver\.textContent = "(V[\d.]+)"/) || [, "未找到"])[1];
  ok("[1] 线上 index.html  HTTP " + res.status + "  " + liveBytes + " B   本地 " + localBytes + " B  "
    + (liveBytes === localBytes ? "-> 字节一致 OK" : "-> 不一致！"));
  ok("      线上版本号：" + liveVer + "  期望：" + expectVer + "  " + (liveVer === expectVer ? "OK" : "不一致！"));
  ok("      逐字节相同：" + (liveHtml === local ? "是" : "否（CDN 可能改写换行，已用字节数交叉校验）"));

  for (const [name, url] of probes) {
    try {
      const r = await fetch(url);
      ok("[2] " + name.padEnd(24) + " HTTP " + r.status + "  " + (r.headers.get("content-type") || "-"));
    } catch (e) {
      ok("[2] " + name.padEnd(24) + " 失败 -> " + e.message);
    }
  }

  // 版本自检文件的内容必须和页面版本一致，否则页面会一直提示「有新版本」
  try {
    const j = await (await fetch(LIVE + "version.json" + bust)).json();
    ok("[2b] 线上 version.json = " + j.version + "  " + (j.version === liveVer ? "与页面一致 OK" : "与页面不一致！"));
  } catch (e) {
    ok("[2b] 线上 version.json 读取失败 -> " + e.message);
  }

  // ---- 3) 浏览器里解析 manifest + 视觉截图 ----
  const browser = await pw.chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  const reqs = [];
  page.on("request", r => reqs.push(r.url()));
  const errs = [];
  page.on("pageerror", e => errs.push(String(e)));

  await page.goto(LIVE, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(1200);

  const ver = await page.evaluate(() => (document.querySelector(".ver") || {}).textContent || "n/a");
  const modelChain = await page.evaluate(() => window.__modelChain || null);
  const updateBar = await page.evaluate(() => !!document.getElementById("verBar"));
  ok("");
  ok("[3] 页面内渲染版本号：" + ver);
  ok("      模型候选链：" + (modelChain ? modelChain.join(" > ") : "(未暴露)"));
  ok("      旧版提示条：" + (updateBar ? "出现了（说明线上与页面版本不一致！）" : "未出现 OK"));

  const pwa = await page.evaluate(() => {
    const q = s => document.querySelector(s);
    return {
      manifestHref: (q('link[rel="manifest"]') || {}).getAttribute
        ? q('link[rel="manifest"]').getAttribute("href") : null,
      appleIcon: (q('link[rel="apple-touch-icon"]') || {}).getAttribute
        ? q('link[rel="apple-touch-icon"]').getAttribute("href") : null,
      capable: (q('meta[name="apple-mobile-web-app-capable"]') || {}).content || null,
      title: (q('meta[name="apple-mobile-web-app-title"]') || {}).content || null,
      theme: (q('meta[name="theme-color"]') || {}).content || null,
      titleTag: document.title,
    };
  });
  ok("      <html> 内 PWA 标签：");
  Object.entries(pwa).forEach(([k, v]) => ok("        " + k + " = " + v));

  const man = await page.evaluate(async () => {
    const href = document.querySelector('link[rel="manifest"]').getAttribute("href");
    const r = await fetch(href);
    const j = await r.json();
    return { status: r.status, name: j.name, short_name: j.short_name, display: j.display, icons: j.icons.length };
  });
  ok("      manifest 解析：HTTP " + man.status + "  name=" + man.name + "  display=" + man.display + "  icons=" + man.icons);

  if (!fs.existsSync(EV)) fs.mkdirSync(EV, { recursive: true });
  const shot = path.join(EV, "live-desktop.png");
  await page.screenshot({ path: shot, fullPage: false });
  ok("      截图：" + path.relative(ROOT, shot));

  const iconReq = reqs.filter(u => /pwa\/icons|manifest\.webmanifest|pwa\/icon\.svg|version\.json/.test(u));
  ok("      浏览器实际请求到的 PWA / 版本资源 " + iconReq.length + " 个：");
  iconReq.forEach(u => ok("        - " + u.replace(LIVE, "/").split("?")[0]));
  ok("      页面未捕获异常：" + (errs.length ? errs.join(" | ") : "无"));

  await browser.close();

  fs.writeFileSync(path.join(EV, "live-report.txt"), report.join("\n") + "\n", "utf8");
  console.log(report.join("\n"));
})().catch(e => { console.error("FAIL", e); process.exit(1); });

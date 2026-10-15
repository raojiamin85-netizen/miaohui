/* 线上验证 V0.14：字节一致性 + PWA 资源可访问 + 视觉截图 + manifest 解析
   跑法：NODE_PATH=<node workspace>/node_modules node scripts/check-live-v014.cjs */
const fs = require("fs");
const path = require("path");
const pw = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const LIVE = "https://miaohui-reply.app.workbuddy.host/";
const EV = path.join(ROOT, "docs", "evidence");
const local = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

const report = [];
const ok = s => report.push(s);

(async () => {
  ok("线上验证 V0.14  " + new Date().toISOString());
  ok("目标：" + LIVE);
  ok("");

  // ---- 1) 静态资源可访问性（带 cache-buster，绕开 CDN 缓存）----
  const bust = "?cb=" + Date.now();
  const probes = [
    ["index.html", LIVE + "index.html" + bust],
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
  ok("[1] 线上 index.html  HTTP " + res.status + "  " + liveBytes + " B   本地 " + localBytes + " B  "
    + (liveBytes === localBytes ? "-> 字节一致 OK" : "-> 不一致！"));
  ok("      线上版本号：" + (liveHtml.match(/V0\.\d+/) || ["未找到"])[0]);
  ok("      逐字节相同：" + (liveHtml === local ? "是" : "否（注意：CDN 可能改写换行，已用字节数交叉校验）"));

  for (const [name, url] of probes) {
    try {
      const r = await fetch(url);
      ok("[2] " + name.padEnd(24) + " HTTP " + r.status + "  " + (r.headers.get("content-type") || "-"));
    } catch (e) {
      ok("[2] " + name.padEnd(24) + " 失败 -> " + e.message);
    }
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
  ok("");
  ok("[3] 页面内渲染版本号（#ver）：" + ver);

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

  // manifest 能否真正取到并解析
  const man = await page.evaluate(async () => {
    const href = document.querySelector('link[rel="manifest"]').getAttribute("href");
    const r = await fetch(href);
    const j = await r.json();
    return { status: r.status, name: j.name, short_name: j.short_name, display: j.display, icons: j.icons.length };
  });
  ok("      manifest 解析：HTTP " + man.status + "  name=" + man.name + "  display=" + man.display + "  icons=" + man.icons);

  const shot = path.join(EV, "live-v014-desktop.png");
  await page.screenshot({ path: shot, fullPage: false });
  ok("      截图：" + path.relative(ROOT, shot));

  const iconReq = reqs.filter(u => /pwa\/icons|manifest\.webmanifest|pwa\/icon\.svg/.test(u));
  ok("      浏览器实际请求到的 PWA 资源 " + iconReq.length + " 个：");
  iconReq.forEach(u => ok("        - " + u.replace(LIVE, "/").split("?")[0]));
  ok("      页面未捕获异常：" + (errs.length ? errs.join(" | ") : "无"));

  await browser.close();

  if (!fs.existsSync(EV)) fs.mkdirSync(EV, { recursive: true });
  fs.writeFileSync(path.join(EV, "live-v014-report.txt"), report.join("\n") + "\n", "utf8");
  console.log(report.join("\n"));
})().catch(e => { console.error("FAIL", e); process.exit(1); });

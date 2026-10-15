/* 用真实浏览器（和用户同一通道）测量各托管平台默认域名的国内可达性。
   理由：PowerShell/Invoke-WebRequest 经过的可能是受限代理通道，结果会自相矛盾
   （同一个 jsDelivr 两分钟内一次成功一次失败），不能作为证据。
   浏览器才是判断「用户能不能打开」的正确仪器。 */
const pw = require("playwright");
const fs = require("fs");

const TARGETS = [
  ["miaohui-reply (现有线上·基线)", "https://miaohui-reply.app.workbuddy.host/"],
  ["GitHub Pages (github.io)", "https://github.io/"],
  ["Vercel (vercel.app)", "https://vercel.app/"],
  ["Netlify (netlify.app)", "https://netlify.app/"],
  ["Cloudflare Pages (pages.dev)", "https://pages.dev/"],
  ["Cloudflare Workers (workers.dev)", "https://workers.dev/"],
  ["cdn.jsdelivr.net (本页字体/SDK)", "https://cdn.jsdelivr.net/npm/@fontsource/caveat@5/index.css"],
  ["对照·baidu.com (国内)", "https://www.baidu.com/"],
  ["对照·cloudflare.com", "https://www.cloudflare.com/"],
  ["对照·vercel.com (官网)", "https://vercel.com/"],
];

(async () => {
  const browser = await pw.chromium.launch({ channel: "msedge" });
  const lines = [];
  lines.push("用真实浏览器测量默认域名可达性  时间: " + new Date().toLocaleString("zh-CN"));
  lines.push("(每项连续测 2 次；httpStatus 只要拿到数字就说明网络通，404/403 也算通)");
  lines.push("");

  for (const [name, url] of TARGETS) {
    const page = await browser.newPage({ ignoreHTTPSErrors: true });
    const row = [];
    row.push("===== " + name + " =====");
    row.push("  " + url);
    for (let i = 1; i <= 2; i++) {
      const t0 = Date.now();
      try {
        const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
        const ms = Date.now() - t0;
        row.push(`  try${i}: 通  status=${resp ? resp.status() : "?"}  ${ms}ms  final=${page.url().slice(0, 60)}`);
      } catch (e) {
        const ms = Date.now() - t0;
        const msg = String(e && e.message || e).split("\n")[0].slice(0, 110);
        row.push(`  try${i}: 不通  ${ms}ms  ${msg}`);
      }
    }
    lines.push(...row, "");
    await page.close();
  }

  await browser.close();
  fs.writeFileSync(__dirname + "/host-reach-report.txt", lines.join("\n"), "utf8");
  console.log(lines.join("\n"));
})().catch(e => { console.error("ERR " + (e && e.message)); process.exit(1); });

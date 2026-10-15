/* 生成 README 用的展示截图（线上版，桌面 + 手机各一张）
   跑法：NODE_PATH=<node workspace>/node_modules node scripts/make-readme-shots.cjs */
const fs = require("fs");
const path = require("path");
const pw = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const LIVE = "https://miaohui-reply.app.workbuddy.host/";
const OUT = path.join(ROOT, "docs", "screenshots");

const SHOTS = [
  { name: "desktop.png", viewport: { width: 1200, height: 780 }, scale: 1, label: "桌面端" },
  { name: "mobile.png", viewport: { width: 390, height: 780 }, scale: 2, label: "手机端" },
];

(async () => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  const browser = await pw.chromium.launch({ channel: "msedge", headless: true });
  const log = [];

  for (const s of SHOTS) {
    const page = await browser.newPage({
      viewport: s.viewport,
      deviceScaleFactor: s.scale,
      isMobile: s.scale === 2,
      hasTouch: s.scale === 2,
    });
    await page.goto(LIVE, { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForTimeout(1400); // 等字体与手绘动画稳定
    const p = path.join(OUT, s.name);
    await page.screenshot({ path: p, fullPage: false });
    log.push(`${s.label}  ${s.name}  ${fs.statSync(p).size} B  ${s.viewport.width}x${s.viewport.height}@${s.scale}x`);
    await page.close();
  }

  await browser.close();
  console.log(log.join("\n"));
  console.log("OK -> " + OUT);
})().catch(e => { console.error("FAIL", e); process.exit(1); });

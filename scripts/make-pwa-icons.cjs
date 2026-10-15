/* 把 pwa/icon.svg 渲染成 180 / 192 / 512 三种尺寸的 PNG（iOS 主屏图标必须真 PNG）。
   用 Playwright 直接以目标尺寸截图，避免缩放糊边。
   跑法：NODE_PATH=<node workspace>/node_modules node scripts/make-pwa-icons.cjs */
const fs = require("fs");
const path = require("path");
const pw = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const SVG = path.join(ROOT, "pwa", "icon.svg");
const OUTDIR = path.join(ROOT, "pwa", "icons");
const SIZES = [180, 192, 512];

(async () => {
  const svg = fs.readFileSync(SVG, "utf8");
  if (!fs.existsSync(OUTDIR)) fs.mkdirSync(OUTDIR, { recursive: true });

  const browser = await pw.chromium.launch({ channel: "msedge", headless: true });
  const results = [];

  for (const size of SIZES) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      html,body{margin:0;padding:0;width:${size}px;height:${size}px;overflow:hidden;background:transparent}
      svg{display:block;width:${size}px;height:${size}px}
    </style></head><body>${svg.replace(/width="512" height="512"/, `width="${size}" height="${size}"`)}</body></html>`;
    await page.setContent(html, { waitUntil: "load" });
    await page.waitForTimeout(220); // 等 feTurbulence 滤镜栅格化完成
    const out = path.join(OUTDIR, `icon-${size}.png`);
    await page.screenshot({ path: out, omitBackground: true });
    const st = fs.statSync(out);
    results.push(`icon-${size}.png  ${st.size} B`);
    await page.close();
  }

  await browser.close();
  console.log(results.join("\n"));
  console.log("OK -> " + OUTDIR);
})().catch(e => { console.error("FAIL", e); process.exit(1); });

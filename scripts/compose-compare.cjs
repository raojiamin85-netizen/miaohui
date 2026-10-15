/* 把改版前 / 改版后的整页截图合成一张对照图，便于一眼看清差异。 */
const { chromium } = require("playwright");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const EV = path.join(ROOT, "docs", "evidence");

const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background:#EFEDE8; font-family:"PingFang SC","Microsoft YaHei",system-ui,sans-serif; padding:34px; color:#171717; }
  .cap { text-align:center; margin-bottom:26px; }
  .cap .t { font-size:26px; letter-spacing:3px; }
  .cap .s { font-size:13px; color:#6B6A66; margin-top:8px; letter-spacing:1px; }
  .cols { display:flex; gap:30px; align-items:flex-start; justify-content:center; }
  .col { width:660px; }
  .hd { display:flex; align-items:baseline; gap:10px; margin-bottom:12px; padding-bottom:9px; border-bottom:1.5px solid rgba(23,23,23,.20); }
  .hd .v { font-size:19px; letter-spacing:2px; }
  .hd .k { font-size:12.5px; color:#6B6A66; margin-left:auto; }
  .card { background:#EFEDE8; border:1.5px solid rgba(23,23,23,.20); overflow:hidden; }
  .card img { display:block; width:100%; }
</style></head><body>
  <div class="cap">
    <div class="t">妙回 · 视觉改版对照</div>
    <div class="s">左：V0.10 改版前　·　右：V0.12 手绘涂鸦方向（E2 工具骨架 + E1 手绘插画）　·　功能一项未减</div>
  </div>
  <div class="cols">
    <div class="col">
      <div class="hd"><span class="v">改版前</span><span class="k">V0.10</span></div>
      <div class="card"><img src="cmp-before-full.png"></div>
    </div>
    <div class="col">
      <div class="hd"><span class="v">改版后</span><span class="k">V0.12</span></div>
      <div class="card"><img src="cmp-after-full.png"></div>
    </div>
  </div>
</body></html>`;

(async () => {
  const fs = require("fs");
  const tmp = path.join(EV, "_compose.html");
  fs.writeFileSync(tmp, html, "utf8");
  const browser = await chromium.launch({ channel: "msedge" });
  const page = await browser.newPage({ viewport: { width: 1420, height: 1000 }, deviceScaleFactor: 1 });
  await page.goto("file:///" + tmp.replace(/\\/g, "/"), { waitUntil: "load" });
  await page.waitForTimeout(1800);
  const h = await page.evaluate(() => document.body.scrollHeight);
  await page.setViewportSize({ width: 1420, height: Math.min(h + 20, 5000) });
  await page.waitForTimeout(400);
  await page.screenshot({ path: EV + "/cmp-side-by-side.png", fullPage: true });
  await browser.close();
  fs.unlinkSync(tmp);
  console.log("side-by-side done, height=" + h);
})().catch(e => { console.error("ERR", e && e.message); process.exit(1); });

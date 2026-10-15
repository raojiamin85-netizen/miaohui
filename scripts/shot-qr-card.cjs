const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const EV = path.join(ROOT, "docs", "evidence");
const QR_PATH = path.join(ROOT, "assets", "qr-miaohui.png");
const QR = "data:image/png;base64," + fs.readFileSync(QR_PATH).toString("base64");

const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fontsource/zcool-kuaile@5/index.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fontsource/caveat@5/index.css">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html,body { background:#fff; }
  body { font-family:"PingFang SC","Microsoft YaHei",sans-serif; color:#171717; -webkit-font-smoothing:antialiased; }
  .card { width:640px; padding:50px 60px 46px; display:flex; flex-direction:column; align-items:center; background:#fff; }
  .head { display:flex; align-items:baseline; gap:14px; }
  .brand { font-family:"ZCOOL KuaiLe",sans-serif; font-size:44px; letter-spacing:6px; line-height:1; }
  .en { font-family:"Caveat",cursive; font-size:22px; color:#B4B2AD; letter-spacing:3px; }
  .wave { width:100%; height:12px; margin:22px 0 24px;
    background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='30' height='12' viewBox='0 0 30 12'%3E%3Cpath d='M0 6 C4 1 11 1 15 6 C19 11 26 11 30 6' fill='none' stroke='%23DEDCD7' stroke-width='2' stroke-linecap='round'/%3E%3C/svg%3E");
    background-repeat:repeat-x; background-position:left center; background-size:30px 12px; }
  .slogan { font-family:"ZCOOL KuaiLe",sans-serif; font-size:27px; letter-spacing:2px; }
  .desc { margin-top:14px; font-size:13.5px; color:#6E6E6E; letter-spacing:.6px; text-align:center; line-height:1.9; }
  .qrbox { margin:32px 0 0; padding:16px; border:1px solid #EBE9E5; border-radius:6px; }
  .qrbox img { display:block; width:318px; height:318px; }
  .tip { margin-top:26px; font-size:12.5px; color:#B4B2AD; letter-spacing:.8px; }
  .tip b { font-weight:400; color:#6E6E6E; }
  .foot { margin-top:10px; font-family:"Caveat",cursive; font-size:19px; color:#D9D7D2; letter-spacing:1px; }
</style></head><body>
<div class="card" id="card">
  <div class="head"><span class="brand">妙回</span><span class="en">Miaohui</span></div>
  <div class="wave"></div>
  <div class="slogan">把任何一条消息，回得漂亮</div>
  <div class="desc">粘一段聊天记录 · 选你要表达的意思 · 出 3 条不像 AI 的回复</div>
  <div class="qrbox"><img src="${QR}" alt="妙回体验二维码"></div>
  <div class="tip">扫码即可体验　·　<b>若在微信内打开，请点右上角「在浏览器打开」</b></div>
  <div class="foot">a small tool for better replies</div>
</div>
</body></html>`;

(async () => {
  const browser = await chromium.launch({ channel: "msedge" });
  const page = await browser.newPage({ viewport: { width: 640, height: 900 }, deviceScaleFactor: 2 });
  await page.setContent(html, { waitUntil: "load" });
  await page.waitForTimeout(2600);
  await page.locator("#card").screenshot({ path: path.join(EV, "qr-card.png") });
  const box = await page.locator("#card").boundingBox();
  await browser.close();
  console.log("qr-card done  size=" + Math.round(box.width) + "x" + Math.round(box.height));
})().catch(e => { console.error("ERR " + (e && e.message)); process.exit(1); });

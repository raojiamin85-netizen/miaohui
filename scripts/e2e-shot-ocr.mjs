// 端到端验证：造一张仿真聊天截图 → 上传到线上「妙回」→ 检查是否识别成文字
import pw from 'file:///C:/Users/%E9%A5%B6%E4%BD%B3%E6%95%8F/.workbuddy/binaries/node/workspace/node_modules/playwright/index.js';
const { chromium } = pw;
import fs from 'node:fs';
import path from 'node:path';

const APP = 'https://miaohui-reply.app.workbuddy.host/';
const OUT_DIR = 'D:/Projects/miaohui/docs/evidence';
fs.mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 480, height: 900 }, deviceScaleFactor: 2 });

// 1) 造一张仿真聊天截图
const chatHtml = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;font-family:"PingFang SC","Microsoft YaHei",sans-serif;background:#EDEDED;width:420px}
.bar{background:#EDEDED;padding:10px 14px;font-size:14px;color:#333;text-align:center;border-bottom:1px solid #DDD}
.m{padding:0 12px}
.row{display:flex;margin:12px 0}
.row.me{justify-content:flex-end}
.bub{max-width:250px;padding:10px 13px;border-radius:6px;font-size:15px;line-height:1.5;position:relative}
.them .bub{background:#fff;color:#111}
.me .bub{background:#95EC69;color:#111}
.time{text-align:center;font-size:12px;color:#999;margin:14px 0}
.box{width:420px;height:520px;overflow:hidden;background:#EDEDED}
</style>
<div class="box"><div class="bar">王姐</div><div class="m">
<div class="time">下午 6:23</div>
<div class="row them"><div class="bub">小饶，明天那个方案能给我看看吗</div></div>
<div class="row me"><div class="bub">可以的，我今晚整理完发你</div></div>
<div class="row them"><div class="bub">好，另外周五的会你能帮忙做下记录吗</div></div>
<div class="row them"><div class="bub">最好下班前给我一版</div></div>
</div></div>`;

const shotPage = await browser.newPage({ viewport: { width: 420, height: 520 }, deviceScaleFactor: 2 });
await shotPage.setContent(chatHtml, { waitUntil: 'load' });
const shotPath = path.join(OUT_DIR, 'fake-chat-screenshot.png');
await shotPage.locator('.box').screenshot({ path: shotPath });
await shotPage.close();
console.log('screenshot saved:', shotPath, fs.statSync(shotPath).size, 'bytes');

// 2) 打开线上应用，上传截图
await page.goto(APP, { waitUntil: 'load' });
await page.waitForTimeout(2500);

// 先选意图 + 对方身份，让页面处于可生成状态（顺便验证后续联动）
await page.click('#intents .chip:has-text("答应并推进")');
await page.click('#personas .chip:has-text("同事")');

await page.setInputFiles('#shotFile', shotPath);

// 3) 等识别结果
let text = '';
for (let i = 0; i < 60; i++) {
  await page.waitForTimeout(1500);
  text = await page.inputValue('#context');
  if (text.trim()) break;
}
console.log('---- 识别结果 ----');
console.log(text || '(空)');
console.log('---- 缩略图状态 ----');
console.log(await page.locator('#shotMsg').innerText().catch(() => ''));
console.log('---- 缩略图数量 ----', await page.locator('#shots .shot').count());

await page.screenshot({ path: path.join(OUT_DIR, 'app-after-ocr.png'), fullPage: true });

// 4) 顺带跑一次真实生成，确认整链路通
if (text.trim()) {
  await page.click('#go');
  let cands = 0;
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(1500);
    cands = await page.locator('#results .cand').count();
    if (cands > 0) break;
  }
  console.log('---- 生成候选条数 ----', cands);
  if (cands) {
    console.log(await page.locator('#results .cand').first().innerText());
    await page.screenshot({ path: path.join(OUT_DIR, 'app-after-ocr-generate.png'), fullPage: true });
  } else {
    console.log('status:', await page.locator('#status').innerText().catch(() => ''));
  }
}

await browser.close();

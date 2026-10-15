// 端到端验证 v0.7：03 区块「上传截图提取风格」+ 风格档案记忆（保存/切换/不使用）
import pw from 'file:///C:/Users/%E9%A5%B6%E4%BD%B3%E6%95%8F/.workbuddy/binaries/node/workspace/node_modules/playwright/index.js';
const { chromium } = pw;
import fs from 'node:fs';
import path from 'node:path';

const APP = 'https://miaohui-reply.app.workbuddy.host/';
const OUT_DIR = 'D:/Projects/miaohui/docs/evidence';
fs.mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge', headless: true });

// ---------- 1) 造一张"自己发的话"的截图 ----------
const chatHtml = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;font-family:"PingFang SC","Microsoft YaHei",sans-serif;background:#EDEDED;width:420px}
.bar{background:#EDEDED;padding:10px 14px;font-size:14px;color:#333;text-align:center;border-bottom:1px solid #DDD}
.m{padding:0 12px}.row{display:flex;margin:12px 0}.row.me{justify-content:flex-end}
.bub{max-width:250px;padding:10px 13px;border-radius:6px;font-size:15px;line-height:1.5}
.them .bub{background:#fff;color:#111}.me .bub{background:#95EC69;color:#111}
.time{text-align:center;font-size:12px;color:#999;margin:14px 0}
.box{width:420px;height:560px;overflow:hidden;background:#EDEDED}
</style>
<div class="box"><div class="bar">阿哲</div><div class="m">
<div class="time">晚上 9:05</div>
<div class="row them"><div class="bub">周末去爬山不</div></div>
<div class="row me"><div class="bub">哈哈哈可以啊</div></div>
<div class="row me"><div class="bub">等我看看天气先</div></div>
<div class="row them"><div class="bub">那周六早上八点集合？</div></div>
<div class="row me"><div class="bub">行 我七点半到地铁口等你</div></div>
</div></div>`;

const shotPage = await browser.newPage({ viewport: { width: 420, height: 560 }, deviceScaleFactor: 2 });
await shotPage.setContent(chatHtml, { waitUntil: 'load' });
const shotPath = path.join(OUT_DIR, 'fake-chat-style.png');
await shotPage.locator('.box').screenshot({ path: shotPath });
await shotPage.close();
console.log('style screenshot:', shotPath);

// ---------- 2) 打开应用，测试 03 区块 ----------
const page = await browser.newPage({ viewport: { width: 480, height: 1100 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto(APP, { waitUntil: 'load' });
await page.waitForTimeout(2500);

// 折叠是否已展开（可见性检查）
console.log('03 区块可见:', await page.locator('#style').isVisible(), '| 上传按钮可见:', await page.locator('#styleShotBtn').isVisible());

// 上传"自己说话"的截图
await page.setInputFiles('#styleShotFile', shotPath);
let styleText = '';
for (let i = 0; i < 60; i++) {
  await page.waitForTimeout(1500);
  styleText = await page.inputValue('#style');
  if (styleText.trim()) break;
}
console.log('---- 风格提取结果（应只有本人说的话，无前缀）----');
console.log(styleText || '(空)');
console.log('提取状态:', await page.locator('#styleShotMsg').innerText().catch(() => ''));

// ---------- 3) 存档案 ----------
await page.click('#saveArchBtn');
await page.waitForTimeout(400);
await page.fill('#archName', '对朋友');
await page.click('#archOk');
await page.waitForTimeout(600);
console.log('档案 chips:', await page.locator('#archChips .arch-chip').count());
console.log('档案提示:', await page.locator('#archMsg').innerText().catch(() => ''));

// 再存一个"对领导"档案（模拟切场景）
await page.fill('#style', '好的，我尽快安排\n收到，我看下时间');
await page.waitForTimeout(300);
await page.click('#saveArchBtn');
await page.waitForTimeout(300);
await page.fill('#archName', '对领导');
await page.click('#archOk');
await page.waitForTimeout(600);
console.log('档案 chips（应为2）:', await page.locator('#archChips .arch-chip').count());

// 切换档案：点第一个（对领导）
await page.click('#archChips .arch-chip:has-text("对领导")');
await page.waitForTimeout(500);
console.log('切换后输入框内容:');
console.log(await page.inputValue('#style'));
console.log('切换提示:', await page.locator('#archMsg').innerText().catch(() => ''));

// 选「朋友」身份，看是否给「对朋友」档案加建议态
await page.click('#personas .chip:has-text("朋友")');
await page.waitForTimeout(400);
console.log('建议态档案:', await page.locator('#archChips .arch-chip.suggest').count());

// 刷新页面，验证档案持久化
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(2500);
console.log('刷新后档案 chips:', await page.locator('#archChips .arch-chip').count());
console.log('刷新后输入框仍是:', (await page.inputValue('#style')).replace(/\n/g, ' / '));

// 「本次不使用风格」
await page.click('#useNoneBtn');
await page.waitForTimeout(400);
console.log('点不使用后输入框:', JSON.stringify(await page.inputValue('#style')), '| 档案还剩:', await page.locator('#archChips .arch-chip').count());

await page.fill('#style', await (async () => { await page.click('#archChips .arch-chip:has-text("对朋友")'); await page.waitForTimeout(300); return page.inputValue('#style'); })());
await page.click('#intents .chip:has-text("接住话头")');
await page.fill('#context', '对方：周末去爬山不\n对方：那周六早上八点集合？');
await page.click('#go');
let cands = 0;
for (let i = 0; i < 60; i++) {
  await page.waitForTimeout(1500);
  cands = await page.locator('#results .cand').count();
  if (cands > 0) break;
}
console.log('---- 生成候选条数 ----', cands);
if (cands) console.log(await page.locator('#results .cand').first().innerText());

await page.screenshot({ path: path.join(OUT_DIR, 'app-v07-style-archive.png'), fullPage: true });
if (errors.length) console.log('页面报错:', errors.join(' | '));
await browser.close();

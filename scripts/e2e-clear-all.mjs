// 端到端验证 v0.8：一键清空（清本次输入、保留风格样本与档案、结果区还原空状态）
import pw from 'file:///C:/Users/%E9%A5%B6%E4%BD%B3%E6%95%8F/.workbuddy/binaries/node/workspace/node_modules/playwright/index.js';
const { chromium } = pw;
import fs from 'node:fs';
import path from 'node:path';

const APP = 'https://miaohui-reply.app.workbuddy.host/';
const OUT_DIR = 'D:/Projects/miaohui/docs/evidence';
fs.mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 480, height: 1100 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto(APP, { waitUntil: 'load' });
await page.waitForTimeout(2500);

// 准备：档案 + 风格 + 上下文 + 截图 + 意图 + 身份，然后生成
await page.evaluate(() => localStorage.setItem('miaohui_archives_v1', JSON.stringify([
  { name: '对朋友', text: '哈哈哈可以啊\n行 我七点半到地铁口等你', updatedAt: Date.now() }
]))); 
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(2500);

await page.fill('#style', '哈哈哈可以啊\n行 我七点半到地铁口等你');
await page.click('#intents .chip:has-text("接住话头")');
await page.click('#personas .chip:has-text("朋友")');
await page.fill('#context', '对方：周末去爬山不\n对方：那周六早上八点集合？');
await page.fill('#extra', '别提加班的事');
await page.click('#go');
let cands = 0;
for (let i = 0; i < 60; i++) {
  await page.waitForTimeout(1500);
  cands = await page.locator('#results .cand').count();
  if (cands) break;
}
console.log('生成候选条数:', cands);
console.log('清空按钮文案:', await page.locator('#results .regen button.clear').innerText());

// 点第一次 → 应进入待确认态，不清空
await page.click('#results .regen button.clear');
await page.waitForTimeout(300);
console.log('第一次点击后 arm 属性:', await page.locator('#results .regen button.clear').getAttribute('data-arm'));
console.log('第一次点击后文案:', await page.locator('#results .regen button.clear').innerText());
console.log('第一次点击后上下文还在吗:', JSON.stringify((await page.inputValue('#context')).slice(0, 12)));

// 点第二次 → 确认清空
await page.click('#results .regen button.clear');
await page.waitForTimeout(1200);
console.log('---- 清空后 ----');
console.log('上下文:', JSON.stringify(await page.inputValue('#context')));
console.log('补充说明:', JSON.stringify(await page.inputValue('#extra')));
console.log('结果区候选数:', await page.locator('#results .cand').count());
console.log('结果区空状态还在吗:', await page.locator('#results .empty').count());
console.log('选中的意图数（应0）:', await page.locator('#intents .chip.on').count());
console.log('选中的身份数（应0）:', await page.locator('#personas .chip.on').count());
console.log('01 截图数（应0）:', await page.locator('#shots .shot').count());
console.log('风格样本（应保留）:', JSON.stringify((await page.inputValue('#style')).replace(/\n/g, ' / ')));
console.log('风格档案数（应保留）:', await page.locator('#archChips .arch-chip').count());
console.log('状态提示:', (await page.locator('#status').innerText()).replace(/\n/g, ' | '));

await page.screenshot({ path: path.join(OUT_DIR, 'app-v08-clear.png'), fullPage: true });

// 清空后能否立刻重新生成
await page.fill('#context', '对方：在吗');
await page.click('#intents .chip:has-text("接住话头")');
await page.click('#go');
let again = 0;
for (let i = 0; i < 60; i++) {
  await page.waitForTimeout(1500);
  again = await page.locator('#results .cand').count();
  if (again) break;
}
console.log('清空后重新生成候选条数:', again);
if (again) console.log(await page.locator('#results .cand').first().innerText());
if (errors.length) console.log('页面报错:', errors.join(' | '));
await browser.close();

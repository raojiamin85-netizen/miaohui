// 逐个截图四个方向的原型，检查渲染是否正常
import pw from 'file:///C:/Users/%E9%A5%B6%E4%BD%B3%E6%95%8F/.workbuddy/binaries/node/workspace/node_modules/playwright/index.js';
const { chromium } = pw;
import fs from 'node:fs';

const FILE = 'file:///D:/Projects/miaohui/prototypes/design-directions.html';
const OUT = 'D:/Projects/miaohui/docs/evidence';
const log = [];
const say = s => { log.push(s); console.log(s); };

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1180, height: 900 }, deviceScaleFactor: 2 });
const errs = [];
page.on('pageerror', e => errs.push(e.message));
await page.goto(FILE, { waitUntil: 'load' });
await page.waitForTimeout(900);

for (const t of ['A', 'B', 'C', 'D']) {
  await page.click(`#tabs button[data-t="${t}"]`);
  await page.waitForTimeout(700);
  const visible = await page.locator(`#s${t}`).isVisible();
  const box = await page.locator(`#s${t} .canvas`).boundingBox();
  say(`[${t}] 可见=${visible} 画布=${box ? Math.round(box.width) + 'x' + Math.round(box.height) : 'n/a'}`);
  await page.locator(`#s${t} .canvas`).screenshot({ path: `${OUT}/proto-${t}.png` });
}
say('页面报错: ' + (errs.length ? errs.join(' ; ') : 'none'));
await browser.close();
fs.writeFileSync(OUT + '/proto-shot.log', log.join('\n'), 'utf8');

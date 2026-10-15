// 截图喜茶语言原型 E1/E2，并检测手写字体是否加载成功
import pw from 'file:///C:/Users/%E9%A5%B6%E4%BD%B3%E6%95%8F/.workbuddy/binaries/node/workspace/node_modules/playwright/index.js';
const { chromium } = pw;
import fs from 'node:fs';

const FILE = 'file:///D:/Projects/miaohui/prototypes/heytea-style.html';
const OUT = 'D:/Projects/miaohui/docs/evidence';
const log = [];
const say = s => { log.push(s); console.log(s); };

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1120, height: 900 }, deviceScaleFactor: 2 });
const errs = [];
page.on('pageerror', e => errs.push(e.message));
await page.goto(FILE, { waitUntil: 'load' });
await page.waitForTimeout(5000);

const fonts = await page.evaluate(async () => {
  await document.fonts.ready;
  const loaded = [];
  document.fonts.forEach(f => { if (f.status === 'loaded') loaded.push(f.family + ' / ' + f.weight); });
  const zk = document.fonts.check('40px "ZCOOL KuaiLe"');
  const cv = document.fonts.check('24px "Caveat"');
  return { loaded, zk, cv, families: Array.from(new Set(loaded.map(x => x.split(' / ')[0]))) };
});
say('ZCOOL KuaiLe 可用 = ' + fonts.zk);
say('Caveat 可用 = ' + fonts.cv);
say('已加载字族: ' + JSON.stringify(fonts.families));

for (const t of ['E1', 'E2']) {
  await page.click(`#tabs button[data-t="${t}"]`);
  await page.waitForTimeout(900);
  const box = await page.locator(`#s${t} .page`).boundingBox();
  say(`[${t}] 画布 ${box ? Math.round(box.width) + 'x' + Math.round(box.height) : 'n/a'}`);
  await page.locator(`#s${t} .page`).screenshot({ path: `${OUT}/heytea-${t}.png` });
}

/* 移动端视图 */
await page.setViewportSize({ width: 400, height: 900 });
await page.waitForTimeout(800);
await page.locator('#sE2 .page').screenshot({ path: OUT + '/heytea-E2-mobile.png' });
say('移动端截图完成');
say('页面报错: ' + (errs.length ? errs.join(' ; ') : 'none'));
await browser.close();
fs.writeFileSync(OUT + '/heytea-proto-shot.log', log.join('\n'), 'utf8');

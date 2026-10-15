// 实地抓取 heytea.com 的真实设计语言：截图 + 计算样式 + 结构
import pw from 'file:///C:/Users/%E9%A5%B6%E4%BD%B3%E6%95%8F/.workbuddy/binaries/node/workspace/node_modules/playwright/index.js';
const { chromium } = pw;
import fs from 'node:fs';

const OUT = 'D:/Projects/miaohui/docs/evidence';
const log = [];
const say = s => { log.push(s); console.log(s); };

const browser = await chromium.launch({ channel: 'msedge', headless: true });

/* ---- 桌面端 ---- */
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
try {
  await page.goto('https://www.heytea.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
} catch (e) { say('goto 异常: ' + e.message); }
await page.waitForTimeout(6000);

// 滚动触发懒加载
for (let i = 0; i < 6; i++) {
  await page.evaluate(() => window.scrollBy(0, 800));
  await page.waitForTimeout(700);
}
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(1200);

say('title = ' + (await page.title()));
await page.screenshot({ path: OUT + '/heytea-hero.png' });

// 首屏往下几段
for (let i = 0; i < 4; i++) {
  await page.evaluate(y => window.scrollTo(0, y), i * 900);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/heytea-scroll-${i + 1}.png` });
}

const info = await page.evaluate(() => {
  const cs = el => el ? getComputedStyle(el) : null;
  const pick = (el, keys) => { const s = cs(el); if (!s) return null; const o = {}; keys.forEach(k => o[k] = s[k]); return o; };
  const T = ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'color', 'backgroundColor', 'textTransform'];
  const B = ['backgroundColor', 'backgroundImage', 'borderRadius', 'border', 'padding', 'color', 'fontSize', 'fontFamily', 'letterSpacing', 'fontWeight'];
  const out = {
    body: pick(document.body, ['fontFamily', 'fontSize', 'backgroundColor', 'color', 'lineHeight']),
    html: pick(document.documentElement, ['backgroundColor']),
    h1: [], h2: [], h3: [],
    buttons: [], links: [], imgs: { count: 0, samples: [] },
    sections: [],
    colorTally: {}, fontTally: {}
  };
  document.querySelectorAll('h1').forEach(e => out.h1.push({ text: (e.innerText || '').slice(0, 60), ...pick(e, T) }));
  document.querySelectorAll('h2').forEach(e => out.h2.push({ text: (e.innerText || '').slice(0, 60), ...pick(e, T) }));
  document.querySelectorAll('h3').forEach(e => out.h3.push({ text: (e.innerText || '').slice(0, 60), ...pick(e, T) }));
  document.querySelectorAll('a,button').forEach(e => {
    const s = cs(e); if (!s) return;
    const r = e.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) return;
    if (out.buttons.length < 24) out.buttons.push({ tag: e.tagName, text: (e.innerText || '').trim().slice(0, 24), ...pick(e, B) });
  });
  const imgs = Array.from(document.querySelectorAll('img'));
  out.imgs.count = imgs.length;
  imgs.slice(0, 14).forEach(e => { const r = e.getBoundingClientRect(); out.imgs.samples.push({ src: (e.currentSrc || e.src || '').slice(0, 110), w: Math.round(r.width), h: Math.round(r.height), alt: e.alt }); });
  document.querySelectorAll('section, header, main > div').forEach(e => {
    const r = e.getBoundingClientRect();
    if (r.height < 160 || out.sections.length > 20) return;
    out.sections.push({ tag: e.tagName, cls: (e.className || '').toString().slice(0, 60), h: Math.round(r.height), bg: getComputedStyle(e).backgroundColor });
  });
  // 颜色/字体统计
  document.querySelectorAll('*').forEach(e => {
    const s = cs(e); if (!s) return;
    const c = s.color; if (c && c !== 'rgba(0, 0, 0, 0)') out.colorTally[c] = (out.colorTally[c] || 0) + 1;
    const bg = s.backgroundColor; if (bg && bg !== 'rgba(0, 0, 0, 0)') out.colorTally['bg:' + bg] = (out.colorTally['bg:' + bg] || 0) + 1;
    const f = s.fontFamily; if (f) out.fontTally[f] = (out.fontTally[f] || 0) + 1;
  });
  out.colorTally = Object.fromEntries(Object.entries(out.colorTally).sort((a, b) => b[1] - a[1]).slice(0, 18));
  out.fontTally = Object.fromEntries(Object.entries(out.fontTally).sort((a, b) => b[1] - a[1]).slice(0, 8));
  out.textSample = (document.body.innerText || '').replace(/\n{2,}/g, '\n').slice(0, 900);
  return out;
});

fs.writeFileSync(OUT + '/heytea-style.json', JSON.stringify(info, null, 1), 'utf8');
say('结构/样式已导出 heytea-style.json');
say('配色 top: ' + JSON.stringify(info.colorTally).slice(0, 700));
say('字体 top: ' + JSON.stringify(info.fontTally).slice(0, 500));
say('图片数 = ' + info.imgs.count);
say('h1 数 = ' + info.h1.length + ' / h2 数 = ' + info.h2.length + ' / h3 数 = ' + info.h3.length);

/* ---- 移动端 ---- */
try {
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const mp = await m.newPage();
  await mp.goto('https://www.heytea.com/', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(e => say('mobile goto: ' + e.message));
  await mp.waitForTimeout(6000);
  await mp.screenshot({ path: OUT + '/heytea-mobile.png' });
  say('移动端截图完成');
  await m.close();
} catch (e) { say('移动端异常: ' + e.message); }

say('页面报错: none-tracked');
await browser.close();
fs.writeFileSync(OUT + '/heytea-probe.log', log.join('\n'), 'utf8');

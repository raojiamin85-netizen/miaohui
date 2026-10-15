// 诊断：clearAll 是否存在、直接调用是否生效
import pw from 'file:///C:/Users/%E9%A5%B6%E4%BD%B3%E6%95%8F/.workbuddy/binaries/node/workspace/node_modules/playwright/index.js';
const { chromium } = pw;

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage();
page.on('pageerror', e => console.log('[pageerror]', e.message));
page.on('console', m => console.log('[console]', m.text()));
await page.goto('https://miaohui-reply.app.workbuddy.host/', { waitUntil: 'load' });
await page.waitForTimeout(2500);

const r = await page.evaluate(() => {
  const out = {};
  out.clearAllType = typeof window.clearAll;
  out.emptyHtmlDefined = typeof window.EMPTY_HTML;
  out.emptyHtmlLen = (window.EMPTY_HTML || '').length;
  document.getElementById('context').value = '测试上下文';
  document.getElementById('extra').value = '测试补充';
  out.before = document.getElementById('context').value;
  try {
    if (typeof window.clearAll === 'function') window.clearAll();
    out.callOk = true;
  } catch (e) { out.callErr = String(e && e.message || e); }
  out.after = document.getElementById('context').value;
  out.extraAfter = document.getElementById('extra').value;
  return out;
});
console.log(JSON.stringify(r, null, 2));

// 再模拟真实点击两次，观察 arm 与结果
await page.fill('#context', '对话内容');
await page.evaluate(() => { window.__armProbe = () => document.querySelector('#results'); });
await page.click('#go');
for (let i = 0; i < 40; i++) { await page.waitForTimeout(1500); if (await page.locator('#results .cand').count()) break; }
const btn = page.locator('#results .regen button.clear');
console.log('按钮存在:', await btn.count(), '文案:', await btn.innerText());
await btn.click();
await page.waitForTimeout(200);
console.log('点击1后 arm 属性:', await btn.getAttribute('data-arm'), '文案:', await btn.innerText());
await btn.click();
await page.waitForTimeout(800);
console.log('点击2后 按钮还在吗:', await page.locator('#results .regen button.clear').count());
console.log('点击2后 context:', JSON.stringify(await page.inputValue('#context')));
console.log('点击2后 结果区结构:', (await page.locator('#results').innerHTML()).slice(0, 120));
await browser.close();

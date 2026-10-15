// 负向验证：未登录时云端风格档案表必须读不到、写不进（RLS + 授权只给已登录用户）
import pw from 'file:///C:/Users/%E9%A5%B6%E4%BD%B3%E6%95%8F/.workbuddy/binaries/node/workspace/node_modules/playwright/index.js';
const { chromium } = pw;

const APP = 'https://miaohui-reply.app.workbuddy.host/';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage();
await page.goto(APP, { waitUntil: 'load' });
await page.waitForTimeout(3000);

const out = await page.evaluate(async () => {
  const cloud = WorkBuddyCloud.createWorkBuddyCloud({
    endpoint: 'https://miaohui-reply.app.workbuddy.host',
    publishableKey: 'wbpk_x1qdLtksbvbrVnqBXv7lmb_99s72umIDfBnDyDSCNCN5ml3yisx08TI'
  });
  const r = {};
  try {
    const s = await cloud.database.from('style_archives').select('name');
    r.read = { error: s.error ? (s.error.message || s.error.code || JSON.stringify(s.error)) : null, rows: (s.data || []).length };
  } catch (e) { r.read = { thrown: String(e.message || e) }; }
  try {
    const w = await cloud.database.from('style_archives').insert({ name: '匿名闯入', text: '不该写进来' }).select();
    r.write = { error: w.error ? (w.error.message || w.error.code || JSON.stringify(w.error)) : null, rows: (w.data || []).length };
  } catch (e) { r.write = { thrown: String(e.message || e) }; }
  return r;
});

console.log('未登录读取云端档案 →', JSON.stringify(out.read));
console.log('未登录写入云端档案 →', JSON.stringify(out.write));
await browser.close();

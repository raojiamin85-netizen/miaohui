// 端到端验证 v0.10：登录态渲染修复
// 回归点：SDK 的 session.user 没有 email 字段，v0.9 拿它判断登录 -> 登录成功也显示"登录同步"
// 覆盖：A) renderAcct 对 SDK 真实形状 session 的渲染  B) 注入已存会话后刷新页面仍是登录态
import pw from 'file:///C:/Users/%E9%A5%B6%E4%BD%B3%E6%95%8F/.workbuddy/binaries/node/workspace/node_modules/playwright/index.js';
const { chromium } = pw;
import fs from 'node:fs';

const APP = 'https://miaohui-reply.app.workbuddy.host/';
const PK = 'wbpk_x1qdLtksbvbrVnqBXv7lmb_99s72umIDfBnDyDSCNCN5ml3yisx08TI';
const SESSION_KEY = 'workbuddy-cloud.session.' + PK;
const OUT_DIR = 'D:/Projects/miaohui/docs/evidence';
const EMAIL = process.env.MH_TEST_EMAIL || 'test-account@example.com'; // 真实测试邮箱不写进仓库，用环境变量传入

const log = [];
const say = (...a) => { const s = a.join(' '); log.push(s); console.log(s); };

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 480, height: 1000 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', e => errors.push(e.message));

// 把 /v1/user/me 打桩成真实返回形状（含 email），模拟"已登录且能取到邮箱"
await page.route('**/v1/user/me', route => route.fulfill({
  status: 200, contentType: 'application/json',
  body: JSON.stringify({ sub: 'uid-test-0001', email: EMAIL, name: '测试账号' })
}));

await page.goto(APP, { waitUntil: 'load' });
await page.waitForTimeout(2500);

/* —— 1. 未登录基线 —— */
say('[1] 未登录 · 导航栏:', (await page.locator('#acct').innerText()).replace(/\n/g, ' | '));

/* —— 2. A 组：SDK 真实形状的 session（user 无 email 字段）—— */
const bare = { user: { id: 'uid-0001', name: '', avatarUrl: undefined, isAnonymous: false, raw: {} } };
await page.evaluate(s => { session = s; renderAcct(); }, bare);
say('[2] 仅 session 存在、无任何邮箱线索 → 导航栏:', (await page.locator('#acct').innerText()).replace(/\n/g, ' | '));
say('    含"退出"按钮:', (await page.locator('#acct button.out').count()) === 1);

/* —— 3. A 组：session.user.raw 里带 email —— */
await page.evaluate(e => {
  session = { user: { id: 'uid-0001', name: '', isAnonymous: false, raw: { sub: 'uid-0001', email: e } } };
  renderAcct();
}, EMAIL);
say('[3] session.user.raw.email 存在 → 导航栏:', (await page.locator('#acct').innerText()).replace(/\n/g, ' | '));

/* —— 4. A 组：loadAcctEmail() 走 getUser 兜底 —— */
await page.evaluate(() => { session = { user: { id: 'uid-0001', name: '', isAnonymous: false, raw: {} } }; acctEmail = ''; renderAcct(); });
await page.evaluate(async () => { await loadAcctEmail(); });
say('[4] getUser 兜底后 → 导航栏:', (await page.locator('#acct').innerText()).replace(/\n/g, ' | '));

/* —— 5. B 组：注入已存会话 + 重新加载 = 模拟"换设备/刷新后恢复登录" —— */
await page.evaluate(([k, e]) => {
  localStorage.setItem(k, JSON.stringify({
    accessToken: 'stub-access-token', refreshToken: 'stub-refresh-token',
    expiresAt: Date.now() + 86400000,
    user: { id: 'uid-0001', name: '', avatarUrl: null, isAnonymous: false, raw: { sub: 'uid-0001', email: e } }
  }));
}, [SESSION_KEY, EMAIL]);
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(3500);
say('[5] 刷新后 · 导航栏:', (await page.locator('#acct').innerText()).replace(/\n/g, ' | '));
say('    档案同步提示:', (await page.locator('#archSyncHint').innerText()).trim());
await page.screenshot({ path: OUT_DIR + '/app-v010-signed-in.png' });

/* —— 5b. 存会话里没有 email 时，靠 getUser() 兜底拿到邮箱 —— */
await page.evaluate(([k, e]) => {
  localStorage.setItem(k, JSON.stringify({
    accessToken: 'stub-access-token', refreshToken: 'stub-refresh-token',
    expiresAt: Date.now() + 86400000,
    user: { id: 'uid-0001', name: '', avatarUrl: null, isAnonymous: false, raw: { sub: 'uid-0001' } }
  }));
}, [SESSION_KEY, EMAIL]);
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(3500);
say('[5b] 存会话无 email、靠 getUser 兜底 → 导航栏:', (await page.locator('#acct').innerText()).replace(/\n/g, ' | '));

/* —— 6. 退出登录后回到未登录态 —— */
await page.click('#acct button.out', { force: true });
await page.waitForTimeout(1200);
say('[6] 退出后 · 导航栏:', (await page.locator('#acct').innerText()).replace(/\n/g, ' | '));
say('    会话已清除:', await page.evaluate(k => localStorage.getItem(k) === null, SESSION_KEY));

say('页面报错:', errors.length ? errors.join(' / ') : '无');
fs.writeFileSync(OUT_DIR + '/v010-verify.log', log.join('\n'), 'utf8');
await browser.close();

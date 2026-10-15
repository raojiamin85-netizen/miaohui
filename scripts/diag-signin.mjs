// 诊断：用用户已注册的邮箱打一次 /v1/signin，抓原始错误形状与响应体
// 只做一次失败尝试，不修改任何账号数据
import pw from 'file:///C:/Users/%E9%A5%B6%E4%BD%B3%E6%95%8F/.workbuddy/binaries/node/workspace/node_modules/playwright/index.js';
const { chromium } = pw;
import fs from 'node:fs';

const APP = 'https://miaohui-reply.app.workbuddy.host/';
const EMAIL = process.env.MH_TEST_EMAIL || 'test-account@example.com'; // 真实测试邮箱不写进仓库，用环境变量传入
const OUT = 'D:/Projects/miaohui/docs/evidence/diag-signin.log';
const log = [];
const say = (...a) => { const s = a.join(' '); log.push(s); console.log(s); };

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage();
const net = [];
page.on('response', async r => {
  const u = r.url();
  if (u.includes('/v1/')) {
    let body = '';
    try { body = (await r.text()).slice(0, 400); } catch {}
    net.push(`${r.status()} ${r.request().method()} ${u.replace(/\?.*$/, '')} :: ${body}`);
  }
});
page.on('pageerror', e => say('PAGEERROR:', e.message));
await page.goto(APP, { waitUntil: 'load' });
await page.waitForTimeout(3000);

say('会话存储键:', await page.evaluate(() => Object.keys(localStorage).filter(k => k.includes('workbuddy')).join(',') || '(空)'));
say('当前 getSession:', await page.evaluate(async () => {
  const r = await cloud.auth.getSession();
  return JSON.stringify({ hasData: !!r.data, error: r.error || null, user: r.data && r.data.user ? r.data.user.id : null });
}));

say('--- 用错误密码试登录（探测服务端错误语义）---');
const probe = await page.evaluate(async (email) => {
  const r = await cloud.auth.signInWithPassword({ email, password: 'probe_wrong_pwd_9x7' });
  return JSON.stringify({ data: r.data ? 'session' : null, error: r.error || null });
}, EMAIL);
say('错误密码 →', probe);

say('--- 空密码（前端校验路径）---');
const empty = await page.evaluate(async (email) => {
  const r = await cloud.auth.signInWithPassword({ email, password: '' });
  return JSON.stringify({ data: r.data ? 'session' : null, error: r.error || null });
}, EMAIL);
say('空密码 →', empty);

say('--- 未注册邮箱（对比错误语义）---');
const nobody = await page.evaluate(async () => {
  const r = await cloud.auth.signInWithPassword({ email: 'no_such_user_' + Date.now() + '@example.com', password: 'probe_wrong_pwd_9x7' });
  return JSON.stringify({ data: r.data ? 'session' : null, error: r.error || null });
});
say('未注册邮箱 →', nobody);

say('--- 网络活动 ---');
net.forEach(n => say(n));

fs.writeFileSync(OUT, log.join('\n'), 'utf8');
await browser.close();

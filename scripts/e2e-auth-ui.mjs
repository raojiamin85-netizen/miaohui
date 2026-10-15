// 端到端验证 v0.9：账号入口 + 登录弹层（密码/验证码/注册/重置四个面板）+ 未登录时档案仍可用
import pw from 'file:///C:/Users/%E9%A5%B6%E4%BD%B3%E6%95%8F/.workbuddy/binaries/node/workspace/node_modules/playwright/index.js';
const { chromium } = pw;
import fs from 'node:fs';
import path from 'node:path';

const APP = 'https://miaohui-reply.app.workbuddy.host/';
const OUT_DIR = 'D:/Projects/miaohui/docs/evidence';
fs.mkdirSync(OUT_DIR, { recursive: true });

const log = [];
const say = (...a) => { const s = a.join(' '); log.push(s); console.log(s); };

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 480, height: 1100 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto(APP, { waitUntil: 'load' });
await page.waitForTimeout(3000);

/* —— 1. 未登录态：导航栏应显示版本号 + 登录同步入口 —— */
say('未登录 · 账号区文案:', (await page.locator('#acct').innerText()).replace(/\n/g, ' | '));
say('未登录 · 有「登录同步」按钮:', await page.locator('#acct .acct-btn').count() === 1);
say('未登录 · 档案同步提示:', (await page.locator('#archSyncHint').innerText()).trim());

/* —— 2. 打开弹层：默认密码登录 —— */
await page.click('#acct .acct-btn', { force: true });
await page.waitForTimeout(700);
say('弹层已打开:', await page.locator('#authMask.on').count() === 1);
say('默认面板 = 密码登录:', await page.locator('#panePwd').isVisible(), '/ 其它面板隐藏:',
  !(await page.locator('#paneOtp').isVisible()) && !(await page.locator('#paneReg').isVisible()));

/* —— 3. 空提交的校验 —— */
await page.click('#pwdGo', { force: true });
await page.waitForTimeout(500);
say('密码登录空提交提示:', (await page.locator('#authMsg').innerText()).trim());

/* —— 4. 切到验证码登录 —— */
await page.click('#authTabs button[data-tab="otp"]', { force: true });
await page.waitForTimeout(500);
say('验证码面板可见:', await page.locator('#paneOtp').isVisible(), '/ 密码面板隐藏:', !(await page.locator('#panePwd').isVisible()));
await page.click('#otpSend', { force: true });
await page.waitForTimeout(500);
say('验证码登录空提交提示:', (await page.locator('#authMsg').innerText()).trim());

/* —— 5. 切到注册 —— */
await page.click('#authTabs button[data-tab="reg"]', { force: true });
await page.waitForTimeout(500);
say('注册面板可见:', await page.locator('#paneReg').isVisible());
await page.screenshot({ path: path.join(OUT_DIR, 'app-v09-auth-register.png') });
await page.click('#regGo', { force: true });
await page.waitForTimeout(500);
say('注册未发码直接提交提示:', (await page.locator('#authMsg').innerText()).trim());

/* —— 6. 重置密码面板（从密码登录页的「忘记密码」进入） —— */
await page.click('#authTabs button[data-tab="pwd"]', { force: true });
await page.waitForTimeout(500);
await page.click('#forgotLink', { force: true });
await page.waitForTimeout(500);
say('重置面板可见:', await page.locator('#paneReset').isVisible());
await page.click('#rstSend', { force: true });
await page.waitForTimeout(500);
say('重置空提交提示:', (await page.locator('#authMsg').innerText()).trim());
await page.screenshot({ path: path.join(OUT_DIR, 'app-v09-auth-reset.png') });
await page.click('#backLogin', { force: true });
await page.waitForTimeout(400);
say('返回密码登录:', await page.locator('#panePwd').isVisible());

/* —— 7. 关闭弹层 —— */
await page.click('#authClose', { force: true });
await page.waitForTimeout(500);
say('弹层已关闭:', await page.locator('#authMask.on').count() === 0);

/* —— 8. 未登录时档案照旧可用（存本机） —— */
await page.fill('#style', '哈哈哈可以啊\n行 我七点半到地铁口等你');
await page.click('#saveArchBtn', { force: true });
await page.waitForTimeout(400);
await page.fill('#archName', '对朋友');
await page.click('#archOk', { force: true });
await page.waitForTimeout(900);
say('未登录存档案提示:', (await page.locator('#archMsg').innerText()).trim());
say('本机档案数:', await page.locator('#archChips .arch-chip').count());
say('同步提示:', (await page.locator('#archSyncHint').innerText()).trim());

/* —— 9. 刷新后档案还在（本机持久化） —— */
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(3000);
say('刷新后档案数:', await page.locator('#archChips .arch-chip').count());
say('刷新后未登录态保持:', await page.locator('#acct .acct-btn').count() === 1);
await page.screenshot({ path: path.join(OUT_DIR, 'app-v09-signed-out.png'), fullPage: true });

say('页面报错:', errors.length ? errors.join(' | ') : '无');
fs.writeFileSync(path.join(OUT_DIR, 'e2e-auth-ui.log'), log.join('\n'), 'utf8');
await browser.close();

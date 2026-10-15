// 端到端验证：风格档案「存 → 换设备 → 拉回」全链路
// 思路：用 temp mail 自助注册一个测试账号（不需要用户介入），
//       context A 注册并存档案 -> 关闭 -> context B（全新存储 = 新设备）登录 -> 看档案是否回来。
import pw from 'file:///C:/Users/%E9%A5%B6%E4%BD%B3%E6%95%8F/.workbuddy/binaries/node/workspace/node_modules/playwright/index.js';
const { chromium } = pw;
import fs from 'node:fs';

const APP = 'https://miaohui-reply.app.workbuddy.host/';
const OUT = 'D:/Projects/miaohui/docs/evidence';
const log = [];
const say = (...a) => { const s = a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '); log.push(s); console.log(s); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ============ 0. 临时邮箱 ============ */
async function tempMail() {
  const dres = await tm('https://api.mail.tm/domains?page=1');
  const doms = (await dres.json())['hydra:member'] || [];
  if (!doms.length) throw new Error('mail.tm 没有可用域名');
  const domain = doms[0].domain;
  const user = 'miao' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const address = user + '@' + domain;
  const password = 'MiaoTest!2026';
  const cres = await tm('https://api.mail.tm/accounts', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address, password })
  });
  if (!cres.ok) throw new Error('建邮箱失败 ' + cres.status + ' ' + (await cres.text()));
  const tres = await tm('https://api.mail.tm/token', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address, password })
  });
  const t = await tres.json();
  if (!t.token) throw new Error('取邮箱 token 失败 ' + JSON.stringify(t));
  return { address, password, token: t.token };
}

async function tm(url, opt) {
  let lastErr;
  for (let i = 0; i < 5; i++) {
    try { return await fetch(url, opt); }
    catch (e) { lastErr = e; await sleep(1500 + i * 1500); }
  }
  throw lastErr;
}

async function fetchCode(mail, label) {
  const deadline = Date.now() + 150000;
  let seen = 0, round = 0;
  while (Date.now() < deadline) {
    round++;
    try {
      const r = await tm('https://api.mail.tm/messages', { headers: { Authorization: 'Bearer ' + mail.token } });
      const j = await r.json();
      const list = j['hydra:member'] || [];
      if (round % 3 === 0) say(`   [${label}] 第 ${round} 轮 · 收件箱 ${list.length} 封`);
      if (list.length > seen) {
        seen = list.length;
        const m = list[0];
        const d = await tm('https://api.mail.tm/messages/' + m.id, { headers: { Authorization: 'Bearer ' + mail.token } });
        const full = await d.json();
        const body = (full.text || '') + '\n' + (full.html || '');
        const codes = body.match(/\b\d{4,8}\b/g) || [];
        say(`   [${label}] 收到邮件: ${m.subject} / 候选码 ${JSON.stringify(codes.slice(0, 6))}`);
        if (codes.length) return { code: codes[0], subject: m.subject, from: (m.from && m.from.address) || '' };
      }
    } catch (e) {
      say(`   [${label}] 第 ${round} 轮取信失败（已重试）: ${e.message}`);
    }
    await sleep(4000);
  }
  throw new Error(label + ' 等验证码超时');
}

let mail;
try {
  mail = await tempMail();
  say('[0] 临时邮箱创建成功:', mail.address, '/ 密码', mail.password);
} catch (e) {
  say('[0] 临时邮箱不可用:', e.message);
  fs.writeFileSync(OUT + '/cross-device-run.log', log.join('\n'), 'utf8');
  process.exit(2);
}

const ARCH_NAME = 'zz测试存档请忽略';
const ARCH_TEXT = '哈哈哈哈可以\n等我看看先\n行 我七点半到';
const ARCHIVE_KEYS = [];

const browser = await chromium.launch({ channel: 'msedge', headless: true });

/* ============ A. 注册 + 存档案 ============ */
let ownerId = '';
try {
  const ctxA = await browser.newContext({ viewport: { width: 480, height: 1000 }, deviceScaleFactor: 2 });
  const p = await ctxA.newPage();
  const errsA = [];
  p.on('pageerror', e => errsA.push(e.message));
  await p.goto(APP, { waitUntil: 'load' });
  await p.waitForTimeout(2500);

  await p.click('#acct .acct-btn');
  await p.waitForTimeout(400);
  await p.click('#authTabs button[data-tab="reg"]');
  await p.waitForTimeout(300);
  await p.fill('#regEmail', mail.address);
  await p.click('#regSend');
  await p.waitForTimeout(2500);
  say('[A1] 点「获取验证码」后面板提示:', (await p.locator('#authMsg').innerText()).trim());
  say('[A1] 等待邮件…');

  const got = await fetchCode(mail, '注册');
  await p.fill('#regCode', got.code);
  await p.fill('#regPass', mail.password);
  await p.click('#regGo');
  await p.waitForTimeout(4000);
  say('[A2] 注册后 Auth 面板提示:', (await p.locator('#authMsg').innerText().catch(() => '')).trim() || '(已关闭)');
  say('[A2] 导航栏:', (await p.locator('#acct').innerText()).replace(/\n/g, ' | '));
  const loggedInA = (await p.locator('#acct button.out').count()) === 1;
  say('[A2] 是否登录态:', loggedInA);

  // 存档案
  await p.fill('#style', ARCH_TEXT);
  await p.click('#saveArchBtn');
  await p.waitForTimeout(300);
  await p.fill('#archName', ARCH_NAME);
  await p.click('#archOk');
  await p.waitForTimeout(3000);
  say('[A3] 存档提示:', (await p.locator('#archMsg').innerText()).trim());
  say('[A3] 档案 chips:', (await p.locator('#archChips').innerText()).replace(/\n/g, ' | '));
  say('[A3] 同步状态文案:', (await p.locator('#archSyncHint').innerText()).trim());
  const stored = await p.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('miaohui_archives_v1') || '[]').map(a => a.name); } catch (e) { return []; }
  });
  say('[A3] 本机档案:', JSON.stringify(stored));
  say('[A3] 页面报错:', errsA.length ? errsA.join(' ; ') : 'none');

  await ctxA.close();
} catch (e) {
  say('[A] 阶段异常:', e.message);
}

/* ============ B. 全新环境 = 换设备，登录后拉档案 ============ */
try {
  const ctxB = await browser.newContext({ viewport: { width: 480, height: 1000 }, deviceScaleFactor: 2 });
  const p = await ctxB.newPage();
  const errsB = [];
  p.on('pageerror', e => errsB.push(e.message));
  await p.goto(APP, { waitUntil: 'load' });
  await p.waitForTimeout(2500);

  const localBefore = await p.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('miaohui_archives_v1') || '[]').map(a => a.name); } catch (e) { return []; }
  });
  say('[B1] 新设备首次打开 · 本机档案:', JSON.stringify(localBefore), '(应为空，证明没有本地残留)');
  say('[B1] 导航栏:', (await p.locator('#acct').innerText()).replace(/\n/g, ' | '));

  await p.click('#acct .acct-btn');
  await p.waitForTimeout(400);
  await p.fill('#pwdEmail', mail.address);
  await p.fill('#pwdPass', mail.password);
  await p.click('#pwdGo');
  await p.waitForTimeout(6000);

  say('[B2] 登录后导航栏:', (await p.locator('#acct').innerText()).replace(/\n/g, ' | '));
  say('[B2] 是否登录态:', (await p.locator('#acct button.out').count()) === 1);
  say('[B2] 档案 chips:', (await p.locator('#archChips').innerText()).replace(/\n/g, ' | '));
  say('[B2] 同步状态文案:', (await p.locator('#archSyncHint').innerText()).trim());
  say('[B2] 提示信息:', (await p.locator('#archMsg').innerText()).trim());
  const localAfter = await p.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('miaohui_archives_v1') || '[]'); } catch (e) { return []; }
  });
  say('[B2] 拉回后本机档案:', JSON.stringify(localAfter.map(a => ({ name: a.name, text: a.text }))));
  say('[B2] 档案内容是否一致:', localAfter.some(a => a.name === ARCH_NAME && a.text === ARCH_TEXT) ? 'YES ✓' : 'NO ✗');
  ARCHIVE_KEYS.push(...localAfter.map(a => a.name));
  say('[B2] 页面报错:', errsB.length ? errsB.join(' ; ') : 'none');

  await p.screenshot({ path: OUT + '/app-cross-device.png', fullPage: false });
  // 局部截图：新设备上被拉回来的风格档案
  try {
    await p.locator('section').nth(2).scrollIntoViewIfNeeded();
    await p.waitForTimeout(600);
    await p.locator('section').nth(2).screenshot({ path: OUT + '/app-cross-device-archive.png' });
    say('[B3] 已截取 03 区块（档案区）');
  } catch (e) { say('[B3] 局部截图失败:', e.message); }
  await ctxB.close();
} catch (e) {
  say('[B] 阶段异常:', e.message);
}

await browser.close();
fs.writeFileSync(OUT + '/cross-device-run.log', log.join('\n'), 'utf8');
say('LOG WRITTEN');
say('TEST_EMAIL=' + mail.address);

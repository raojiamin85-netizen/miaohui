/**
 * 取证：GitHub 仓库首页那一列"提交信息"到底是什么
 * 用真实浏览器打开仓库页，把文件列表逐行抓出来（文件名 + 最后一次改动的提交信息 + 时间）
 * 回答用户疑问：截图里那一串重复条目是什么、谁能看到
 */
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const OUT = "D:/Projects/miaohui/docs/evidence";
const REPO = "https://github.com/raojiamin85-netizen/miaohui";

(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 1200 },
    locale: "zh-CN",
  });
  const page = await ctx.newPage();

  const log = [];
  const say = (s) => { console.log(s); log.push(s); };

  // ---------- 1. 仓库首页的文件列表 ----------
  const resp = await page.goto(REPO, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(3500);
  say(`[1] 仓库首页 HTTP ${resp.status()}  标题="${(await page.title()).slice(0, 80)}"`);

  const rows = await page.evaluate(() => {
    const out = [];
    // GitHub 文件树：每行有 名称 / 提交信息 / 时间
    document.querySelectorAll('div[role="row"], .react-directory-row').forEach((r) => {
      const nameEl = r.querySelector('[role="rowheader"], a.Link--primary, .react-directory-filename-column a');
      const msgEl = r.querySelector('[aria-label*="Commit message"], .react-directory-commit-message, [data-testid="listitem-message"], .f6.color-fg-muted');
      const name = nameEl ? nameEl.innerText.trim().split("\n")[0] : "";
      const msg = msgEl ? msgEl.innerText.trim().split("\n")[0] : "";
      if (name || msg) out.push({ name, msg });
    });
    return out;
  });
  say(`[1] 抓到文件行 ${rows.length} 行：`);
  rows.forEach((r, i) => say(`     ${String(i + 1).padStart(2)}. ${r.name.padEnd(30)} | ${r.msg}`));

  // 页面右侧每个文件行显示的最后提交信息（更稳的抓法）
  const msgs = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll("table tbody tr, .Box-row").forEach((r) => {
      const t = r.innerText.replace(/\s+/g, " ").trim();
      if (t) out.push(t.slice(0, 160));
    });
    return out;
  });
  say(`[1] 表格式抓取 ${msgs.length} 行：`);
  msgs.slice(0, 20).forEach((m, i) => say(`     ${String(i + 1).padStart(2)}. ${m}`));

  await page.screenshot({ path: path.join(OUT, "F-repo-home.png"), fullPage: false });

  // ---------- 2. 提交历史页 ----------
  const resp2 = await page.goto(REPO + "/commits/main", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(3000);
  say(`\n[2] 提交历史页 HTTP ${resp2.status()}`);
  const commits = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('li.Box-row, div[role="listitem"], .TimelineItem').forEach((r) => {
      const t = r.innerText.replace(/\s+/g, " ").trim();
      if (t) out.push(t.slice(0, 140));
    });
    return out;
  });
  say(`[2] 提交条目 ${commits.length} 条：`);
  commits.forEach((c, i) => say(`     ${String(i + 1).padStart(2)}. ${c}`));
  await page.screenshot({ path: path.join(OUT, "F-commits-page.png"), fullPage: false });

  // ---------- 3. 未登录访客能否看到 ----------
  say(`\n[3] 本次访问未登录任何 GitHub 账号（全新上下文，无 Cookie）→ 以上内容全部可见`);
  const anon = await page.evaluate(() => {
    const t = document.body.innerText;
    return {
      有登录入口: /Sign in|Sign up/.test(t),
      有用户名菜单: /raojiamin85-netizen/.test(t),
    };
  });
  say(`     页面出现"Sign in"：${anon.有登录入口}（说明当前是未登录游客视角）`);

  await browser.close();
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "gh-repo-page-probe.txt"), log.join("\n"), "utf8");
  say("\n报告已写入 docs/evidence/gh-repo-page-probe.txt");
})().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });

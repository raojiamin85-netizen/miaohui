/**
 * 提示小图标候选页 · 交互与截图复核
 * 跑法：NODE_PATH=<node workspace>/node_modules node scripts/shot-hint-icons.cjs
 *
 * 验三件事：
 *   ① 静止时气泡是隐藏的（不能一开始就摊在页面上）
 *   ② 鼠标悬停 / 键盘 Tab / 点按，三种方式都能把气泡翻出来
 *   ③ 手机上气泡不会顶出屏幕右边
 */
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const OUT = path.join(__dirname, "..", "docs", "evidence");
const URL = "file:///" + path.join(__dirname, "..", "prototypes", "hint-icon-options.html").replace(/\\/g, "/");

const CAND = ["A", "B", "C", "D", "E", "F", "G", "H"];
let pass = 0, fail = 0;
const ok = (c, label, extra) => {
  if (c) { pass++; console.log("PASS  " + label + (extra ? "   [" + extra + "]" : "")); }
  else { fail++; console.log("FAIL  " + label + (extra ? "   [" + extra + "]" : "")); }
};

const tipState = (page, i) => page.evaluate((k) => {
  const btn = document.querySelectorAll(".card .stage .mi")[k];
  const tip = btn.querySelector(".mi-tip");
  const cs = getComputedStyle(tip);
  const r = tip.getBoundingClientRect();
  return { vis: cs.visibility, op: +cs.opacity, w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right) };
}, i);

async function shotCard(page, i, file) {
  const box = await page.evaluate((k) => {
    const c = document.querySelectorAll(".card")[k];
    c.scrollIntoView({ block: "center" });
    return null;
  }, i);
  await page.waitForTimeout(350);
  // 悬停到卡片里的图标上
  const btn = page.locator(".card .stage .mi").nth(i);
  await btn.hover();
  await page.waitForTimeout(420);
  await page.screenshot({ path: path.join(OUT, file) });
  return box;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const errs = [];

  /* ---------------- 桌面 ---------------- */
  const page = await browser.newPage({ viewport: { width: 1180, height: 860 } });
  page.on("pageerror", e => errs.push("desktop: " + (e && e.message)));
  await page.goto(URL, { waitUntil: "load" });
  await page.waitForTimeout(900);

  const count = await page.locator(".card .stage .mi").count();
  ok(count >= 13, "图标总数 " + count + " 个（8 候选 + 3 气泡 + 2 真实位置 + 手机/键盘）");

  /* ① 静止时全部隐藏 */
  const idle = await page.evaluate(() => {
    const tips = [...document.querySelectorAll(".mi-tip")];
    return {
      total: tips.length,
      visible: tips.filter(t => getComputedStyle(t).visibility === "visible").length,
      marked: document.querySelectorAll(".mi[aria-expanded]").length
    };
  });
  ok(idle.visible === 0, "静止时没有一个气泡是露出来的", "共 " + idle.total + " 个，露出 " + idle.visible + " 个");
  ok(idle.marked === idle.total, "每个图标都带上了可访问状态 aria-expanded", idle.marked + " 个");

  /* ②a 悬停翻出 */
  const before = await tipState(page, 0);
  await page.locator(".card .stage .mi").nth(0).hover();
  await page.waitForTimeout(420);
  const after = await tipState(page, 0);
  ok(before.vis === "hidden" && after.vis === "visible" && after.op > 0.95,
    "鼠标悬停：气泡由隐藏变可见", "隐藏 -> " + after.vis + " / opacity=" + after.op + " / " + after.w + "x" + after.h);

  /* ②a2 气泡不出屏 + 箭头指着图标 */
  const geo = await page.evaluate(() => {
    const btn = document.querySelectorAll(".card .stage .mi")[0];
    const tip = btn.querySelector(".mi-tip");
    const tb = tip.getBoundingClientRect();
    const r = btn.getBoundingClientRect();
    const arrowLeft = parseFloat(getComputedStyle(tip, "::after").left) || 0;
    return {
      tipLeft: Math.round(tb.left), tipRight: Math.round(tb.right),
      arrowCenter: Math.round(tb.left + arrowLeft),
      btnCenter: Math.round(r.left + r.width / 2),
      vw: document.documentElement.clientWidth
    };
  });
  ok(geo.tipLeft >= 0 && geo.tipRight <= geo.vw, "气泡完整落在屏幕内", geo.tipLeft + " ~ " + geo.tipRight + " / 视口 " + geo.vw);
  ok(Math.abs(geo.arrowCenter - geo.btnCenter) <= 3, "小尖角仍然指着图标（偏移后箭头会跟着挪）", "箭头 " + geo.arrowCenter + " vs 图标 " + geo.btnCenter);

  /* ②b 移开收回 */
  await page.mouse.move(10, 10);
  await page.waitForTimeout(420);
  const away = await tipState(page, 0);
  ok(away.vis === "hidden", "鼠标移开：气泡收回", away.vis);

  /* ②c 键盘 Tab */
  await page.evaluate(() => document.querySelectorAll(".card .stage .mi")[0].focus());
  await page.waitForTimeout(350);
  const focused = await tipState(page, 0);
  ok(focused.vis === "visible", "键盘聚焦：气泡同样翻出来（不只有鼠标能用）", focused.vis);

  /* ②d 点按切换 */
  await page.evaluate(() => document.querySelectorAll(".card .stage .mi")[0].blur());
  await page.locator(".card .stage .mi").nth(0).click();
  await page.waitForTimeout(320);
  const clicked = await tipState(page, 0);
  const onCls = await page.evaluate(() => document.querySelectorAll(".card .stage .mi")[0].classList.contains("on"));
  ok(clicked.vis === "visible" && onCls, "点按：气泡留在页面上（手指没有悬停，只能靠点击）", "class.on=" + onCls);

  /* ②e 点别处关掉 */
  await page.mouse.click(600, 20);
  await page.waitForTimeout(320);
  const closed = await tipState(page, 0);
  ok(closed.vis === "hidden", "点页面别处：已展开的气泡关掉（同屏只留一个）", closed.vis);

  /* ③ 逐张截图：8 个候选 */
  for (let i = 0; i < 8; i++) await shotCard(page, i, "hint-" + CAND[i] + "-hover.png");
  ok(true, "8 个候选各截了一张「悬停中」的图", "docs/evidence/hint-A..H-hover.png");

  /* ③b 三种气泡呈现 */
  for (let i = 0; i < 3; i++) await shotCard(page, 8 + i, "hint-tip-" + (i + 1) + ".png");

  /* ③c 真实位置（放法一 / 放法二） */
  await page.evaluate(() => document.querySelectorAll(".real")[0].scrollIntoView({ block: "center" }));
  await page.waitForTimeout(300);
  await page.locator(".real").nth(0).locator(".mi").hover();
  await page.waitForTimeout(420);
  await page.screenshot({ path: path.join(OUT, "hint-real-1.png") });
  await page.locator(".real").nth(1).locator(".mi").hover();
  await page.waitForTimeout(420);
  await page.screenshot({ path: path.join(OUT, "hint-real-2.png") });

  /* 整理前静止全景，用来看「不吵」这件事 */
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, "hint-overview.png"), fullPage: true });

  await page.close();

  /* ---------------- 手机 ---------------- */
  const m = await browser.newPage({ viewport: { width: 393, height: 800 }, isMobile: true, hasTouch: true });
  m.on("pageerror", e => errs.push("mobile: " + (e && e.message)));
  await m.goto(URL, { waitUntil: "load" });
  await m.waitForTimeout(900);

  // 点一下第 8 个卡片的图标（H），看气泡在窄屏上会不会顶出右边
  await m.locator(".card .stage .mi").nth(7).scrollIntoViewIfNeeded();
  await m.waitForTimeout(300);
  await m.locator(".card .stage .mi").nth(7).tap();
  await m.waitForTimeout(420);
  const mt = await tipState(m, 7);
  ok(mt.vis === "visible", "手机上点一下：气泡出来", mt.vis);
  ok(mt.right <= 393, "气泡没有顶出手机屏幕右边", "右边界 " + mt.right + " / 视口 393");
  await m.screenshot({ path: path.join(OUT, "hint-mobile.png") });

  await m.close();

  console.log("");
  console.log("合计：" + pass + " 通过 / " + fail + " 失败");
  console.log("截图目录：" + OUT);
  console.log("页面异常：" + (errs.length ? errs.join(" | ") : "无"));
  await browser.close();
  process.exit(fail ? 1 : 0);
})();

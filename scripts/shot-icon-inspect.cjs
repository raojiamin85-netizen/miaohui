/**
 * 品牌小人提示图标候选页：① 放大看画得对不对 ② 验悬停/点按能不能出提示
 * 跑法：NODE_PATH=<node workspace>/node_modules node scripts/shot-icon-inspect.cjs
 */
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const OUT = path.join(__dirname, "..", "docs", "evidence");
const URL = "file:///" + path.join(__dirname, "..", "prototypes", "hint-icon-character.html").replace(/\\/g, "/");

let pass = 0, fail = 0;
const ok = (c, label, extra) => {
  if (c) { pass++; console.log("PASS  " + label + (extra ? "   [" + extra + "]" : "")); }
  else { fail++; console.log("FAIL  " + label + (extra ? "   [" + extra + "]" : "")); }
};

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const errs = [];

  const page = await browser.newPage({ viewport: { width: 1000, height: 900 }, deviceScaleFactor: 2 });
  page.on("pageerror", e => errs.push("desktop: " + (e && e.message)));
  await page.goto(URL, { waitUntil: "load" });
  await page.waitForTimeout(900);

  // ---- ① 尺寸阶梯：按 data-ic 生成，确认真的渲染出来了 ----
  const lad = await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".lrow[data-ic]")];
    return {
      rows: rows.length,
      cells: rows.map(r => r.querySelectorAll("svg").length),
      sizes: [...rows[0].querySelectorAll("svg")].map(s => s.getAttribute("width"))
    };
  });
  ok(lad.rows === 8, "尺寸阶梯 8 行（对应 8 个候选）", lad.rows + " 行");
  ok(lad.cells.every(c => c === 5), "每行 5 档尺寸都渲染出来了", "各 " + lad.cells.join("/") + " 个");
  ok(lad.sizes.join(",") === "14,18,22,28,36", "尺寸档位正确", lad.sizes.join(" / ") + " px");

  // ① 放大看（96px 版）
  await page.click("#zoomAll");
  await page.waitForTimeout(500);
  const box = await page.$("#zoombox");
  await box.screenshot({ path: path.join(OUT, "icon-zoom-96.png") });
  await (await page.$(".ladder")).screenshot({ path: path.join(OUT, "icon-ladder.png") });

  // ---- ①b 「?」/「!」两版：默认是不是叹号、切一下是不是真的变 ----
  const crypto = require("crypto");
  const hashOf = async (loc) => crypto.createHash("sha1").update(await loc.screenshot()).digest("hex").slice(0, 12);
  const iconBox = page.locator(".grid .card").nth(3).locator(".box svg");   // V4 放大图
  const ladRow = page.locator(".lrow[data-ic='ic4']");                      // V4 尺寸阶梯那行

  const groups = await page.evaluate(() => {
    const out = [];
    for (let i = 1; i <= 8; i++) {
      const b = document.getElementById("ic" + i + "b");
      const q = document.getElementById("ic" + i + "q");
      const old = document.getElementById("ic" + i);
      out.push(!!(b && q && !old && b.querySelector(".vb") && !b.querySelector(".vq") && q.querySelector(".vq") && !q.querySelector(".vb")));
    }
    return out;
  });
  ok(groups.every(Boolean), "8 个候选都拆成了 #icNb / #icNq 两版定义（各自只剩一版标点）", groups.map(v => v ? "✓" : "✗").join(""));

  // 标点在 24 单位坐标系里的真实尺寸 —— 换算成 22px 下有多高，这是「会不会糊」的硬指标
  // 注意：getBBox() 给的是元素「自己那套坐标」里的框，V1 外面套着 scale(0.39)，
  //       必须再乘上 getCTM()，否则 V1 会被算大 2.5 倍（第一次就踩了）。
  const mtr = await page.evaluate(() => {
    const box = (t) => {
      const b = t.getBBox(), m = t.getCTM(), xs = [], ys = [];
      [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]]
        .forEach(([x, y]) => { xs.push(m.a * x + m.c * y + m.e); ys.push(m.b * x + m.d * y + m.f); });
      return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), scale: m.a };
    };
    const out = [];
    for (let i = 1; i <= 8; i++) {
      const b = document.getElementById("ic" + i + "b");
      out.push(Object.assign({ v: "V" + i }, box(b.querySelector(".vb"))));
    }
    return out;
  });
  ok(Math.abs(mtr[0].scale - 0.39) < 0.001, "量标点尺寸时把祖先的 scale(0.39) 也乘进去了", "V1 的缩放 = " + mtr[0].scale.toFixed(3));
  const tall = mtr.map(m => Math.round(m.h / 24 * 22 * 10) / 10);
  console.log("    叹号在 22px 下的实际高度：" + mtr.map((m, i) => m.v + " " + tall[i] + "px").join(" · "));
  ok(tall.every(t => t >= 3), "每个候选的叹号在 22px 下都还占得住 3px 以上", "最矮 " + Math.min(...tall) + "px（" + mtr[tall.indexOf(Math.min(...tall))].v + "）");

  const labels = await page.$$eval(".lrow[data-ic] .nm", ns => ns.map(n => { const e = n.querySelector("em"); return e ? e.textContent : ""; }));
  ok(labels.filter(t => /高 [\d.]+px/.test(t)).length === 8, "尺寸阶梯上「量出来的标点高度」8 行都算出来了", labels.filter(t => /高 [\d.]+px/.test(t)).length + " 行");
  console.log("    " + labels.join(" · "));

  const btnA = (await page.textContent("#bangToggle")).trim();
  ok(/现在是「!」/.test(btnA), "默认显叹号，按钮文案也是「!」", btnA);
  const bangIcon = await hashOf(iconBox), bangLad = await hashOf(ladRow);

  await page.click("#bangToggle");
  await page.waitForTimeout(420);
  const qIcon = await hashOf(iconBox), qLad = await hashOf(ladRow);
  ok(bangIcon !== qIcon, "点一下真的换成了问号版（放大图像素变了）", bangIcon + " -> " + qIcon);
  ok(bangLad !== qLad, "尺寸阶梯里的也一起换（CSS 进得去 <use> 里面）", bangLad + " -> " + qLad);
  const btnB = (await page.textContent("#bangToggle")).trim();
  ok(/现在是「\?」/.test(btnB), "按钮文案跟着翻", btnB);

  await box.screenshot({ path: path.join(OUT, "icon-zoom-96-q.png") });
  await (await page.$(".ladder")).screenshot({ path: path.join(OUT, "icon-ladder-q.png") });

  await page.click("#bangToggle");
  await page.waitForTimeout(420);
  ok((await hashOf(iconBox)) === bangIcon, "再点一下切回叹号，像素回到原样（可逆）");

  const cards = await page.$$(".grid .card");
  for (let i = 0; i < cards.length; i++) {
    await cards[i].screenshot({ path: path.join(OUT, "icon-V" + (i + 1) + ".png") });
  }
  ok(cards.length === 8, "8 个候选卡片都截了图", "docs/evidence/icon-V1..V8.png");

  // ---- ② 交互 ----
  const mi = page.locator(".grid .card .mi");
  const state = (k) => page.evaluate((i) => {
    const b = document.querySelectorAll(".grid .card .mi")[i];
    const t = b.querySelector(".mi-tip");
    const cs = getComputedStyle(t);
    const r = t.getBoundingClientRect();
    return { vis: cs.visibility, op: +cs.opacity, l: Math.round(r.left), r: Math.round(r.right), vw: document.documentElement.clientWidth };
  }, k);

  const idle = await page.evaluate(() => [...document.querySelectorAll(".mi-tip")].filter(t => getComputedStyle(t).visibility === "visible").length);
  ok(idle === 0, "静止时没有一个气泡露在外面", "露出 " + idle + " 个");

  await mi.nth(3).hover();
  await page.waitForTimeout(420);
  const hov = await state(3);
  ok(hov.vis === "visible" && hov.op > 0.95, "悬停：气泡翻出来（V4 那一格）", hov.vis + " / opacity=" + hov.op);
  ok(hov.l >= 0 && hov.r <= hov.vw, "气泡完整落在屏幕内", hov.l + " ~ " + hov.r + " / 视口 " + hov.vw);

  await page.mouse.move(8, 8);
  await page.waitForTimeout(400);
  ok((await state(3)).vis === "hidden", "鼠标移开：气泡收回");

  await mi.nth(5).click();
  await page.waitForTimeout(320);
  const clk = await state(5);
  ok(clk.vis === "visible", "点按：气泡留下（手机没有悬停，只能点）", clk.vis);
  await page.mouse.click(500, 12);
  await page.waitForTimeout(300);
  ok((await state(5)).vis === "hidden", "点别处：关掉");

  // 键盘：必须真的按 Tab 走过去，不能用 el.focus() ——
  // 浏览器会忽略「先用过鼠标、再程序化聚焦」的 :focus-visible，那样测不出真键盘用户看到的东西。
  await page.evaluate(() => document.querySelectorAll(".grid .card .mi")[0].scrollIntoView({ block: "center" }));
  let reached = false;
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press("Tab");
    reached = await page.evaluate(() => document.activeElement === document.querySelectorAll(".grid .card .mi")[0]);
    if (reached) break;
  }
  await page.waitForTimeout(320);
  ok(reached, "键盘 Tab 能走到图标上", reached ? "已聚焦" : "按了 30 次 Tab 没走到");
  ok((await state(0)).vis === "visible", "焦点在图标上：气泡也出来（不是只有鼠标能用）", (await state(0)).vis);

  // 真实位置两张
  await page.evaluate(() => document.querySelectorAll(".real")[0].scrollIntoView({ block: "center" }));
  await page.waitForTimeout(300);
  await page.locator(".real").nth(0).locator(".mi").hover();
  await page.waitForTimeout(420);
  await page.screenshot({ path: path.join(OUT, "icon-real-v4.png") });
  await page.locator(".real").nth(1).locator(".mi").hover();
  await page.waitForTimeout(420);
  await page.screenshot({ path: path.join(OUT, "icon-real-v6.png") });

  await page.close();

  // ---- 手机 ----
  const m = await browser.newPage({ viewport: { width: 393, height: 800 }, isMobile: true, hasTouch: true });
  m.on("pageerror", e => errs.push("mobile: " + (e && e.message)));
  await m.goto(URL, { waitUntil: "load" });
  await m.waitForTimeout(900);
  const miM = m.locator(".grid .card .mi");
  await miM.nth(3).scrollIntoViewIfNeeded();
  await m.waitForTimeout(300);
  await miM.nth(3).tap();
  await m.waitForTimeout(420);
  const mt = await m.evaluate(() => {
    const b = document.querySelectorAll(".grid .card .mi")[3];
    const t = b.querySelector(".mi-tip");
    const r = t.getBoundingClientRect();
    return { vis: getComputedStyle(t).visibility, l: Math.round(r.left), r: Math.round(r.right) };
  });
  ok(mt.vis === "visible", "手机上点一下：气泡出来", mt.vis);
  ok(mt.l >= 0 && mt.r <= 393, "气泡没有顶出手机屏幕", mt.l + " ~ " + mt.r + " / 视口 393");
  await m.screenshot({ path: path.join(OUT, "icon-mobile.png") });
  await m.close();

  console.log("");
  console.log("合计：" + pass + " 通过 / " + fail + " 失败");
  console.log("页面异常：" + (errs.length ? errs.join(" | ") : "无"));
  await browser.close();
  process.exit(fail ? 1 : 0);
})();


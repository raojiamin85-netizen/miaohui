/**
 * V0.17 版面与提示图标复核（跑真页面 index.html，file:// 打开，不联网）。
 *
 * 复核的是这次改版真正承诺的三件事：
 *   ① 波浪线只在 01 / 02 / 03 / 04 四个编号块的末尾各一条；
 *   ② 三句长说明不再摊在页面上，改成「品牌小人 + 叹号」图标，放在上一行末尾，
 *      鼠标悬停 / 键盘 Tab / 点按三条通道都能出气泡，点别处或 Esc 关掉；
 *   ③ 手机上点得开、气泡不出屏、触屏热区够大。
 *
 * 跑法：NODE_PATH=<node workspace>/node_modules node scripts/shot-v017.cjs
 * 截图落到 docs/evidence/v017-*.png（不进仓库）。
 */
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "docs", "evidence");
const URL = "file:///" + path.join(ROOT, "index.html").replace(/\\/g, "/");
const LOG = path.join(__dirname, "layout-report.txt");

const results = [];
const ok = (name, pass, extra) => results.push((pass ? "PASS  " : "FAIL  ") + name + (extra ? "  | " + extra : ""));

const VER = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, "version.json"), "utf8")).version; } catch (e) { return "?"; } })();

async function shot(page, sel, file, pad = 6, padTop = null) {
  const el = await page.$(sel);
  if (!el) { console.log("  (跳过截图，找不到 " + sel + ")"); return; }
  const b = await el.boundingBox();
  if (!b) { console.log("  (跳过截图，无边界 " + sel + ")"); return; }
  // boundingBox 是「相对视口」的，而 fullPage 截图的 clip 是「相对整页」的 —— 页面滚动过就要补回 scrollY，
  // 否则截出来是别的地方（v0.17 头一次跑就踩到：想截 04 区，出来的是 01/02 区）。
  const sy = await page.evaluate(() => window.scrollY || 0);
  const top = padTop == null ? pad : padTop;
  await page.screenshot({
    path: path.join(OUT, file), fullPage: true,
    clip: {
      x: Math.max(0, b.x - pad),
      y: Math.max(0, b.y + sy - top),
      width: Math.min(b.width + pad * 2, 1400),
      height: Math.min(b.height + top + pad, 2400)
    }
  });
}

const tipState = (page, i) => page.evaluate(i => {
  const b = document.querySelectorAll(".mi")[i];
  if (!b) return null;
  const t = b.querySelector(".mi-tip");
  const cs = getComputedStyle(t);
  const r = t.getBoundingClientRect();
  const br = b.getBoundingClientRect();
  return {
    vis: cs.visibility, op: Number(cs.opacity),
    w: Math.round(r.width), h: Math.round(r.height),
    left: Math.round(r.left), right: Math.round(r.right),
    arrow: cs.getPropertyValue("--arrow").trim(),
    btnW: Math.round(br.width), btnH: Math.round(br.height),
    vw: document.documentElement.clientWidth,
    txt: t.textContent.trim()
  };
}, i);

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const errs = [];

  /* ==================== 桌面 1180 ==================== */
  const page = await browser.newPage({ viewport: { width: 1180, height: 1000 } });
  page.on("pageerror", e => errs.push("desktop: " + (e && e.message)));
  await page.goto(URL, { waitUntil: "load" });
  await page.waitForTimeout(1400);
  await page.evaluate(() => document.querySelectorAll(".reveal").forEach(e => e.classList.add("in")));
  await page.waitForTimeout(300);

  // ---- ① 版面：波浪线 4 条，且第 2 条正好落在「02 意图」和「03 身份」之间 ----
  const geo = await page.evaluate(() => {
    const rules = [...document.querySelectorAll(".rule")];
    const intents = document.getElementById("intents").getBoundingClientRect();
    const hd03 = document.querySelectorAll(".hd-sub h2")[0].getBoundingClientRect();
    return {
      n: rules.length,
      ys: rules.map(r => Math.round(r.getBoundingClientRect().top)),
      ws: rules.map(r => Math.round(r.getBoundingClientRect().width)),
      hs: rules.map(r => Math.round(r.getBoundingClientRect().height)),
      repeat: [...new Set(rules.map(r => getComputedStyle(r).backgroundRepeat))],
      intentsBottom: Math.round(intents.bottom),
      hd03Top: Math.round(hd03.top),
      wrapW: Math.round(document.querySelector(".wrap").getBoundingClientRect().width - 80),
      // 无档案时被藏起来的那句（仍在 DOM 里）
      emptyStateShown: getComputedStyle(document.querySelector("#archChips .shot-hint")).display,
      hintTexts: [...document.querySelectorAll(".hint")].map(h => {
        // textContent 会把气泡里的字也算进来 —— 气泡是 visibility:hidden，页面上看不见，
        // 所以这里先把 .mi 摘掉再取文本，只看「真正摊在页面上的字」。
        const c = h.cloneNode(true);
        c.querySelectorAll(".mi").forEach(x => x.remove());
        return c.textContent.replace(/\s+/g, " ").trim();
      })
    };
  });
  ok("波浪线恰好 4 条（01/02/03/04 各一条）", geo.n === 4, "实际 " + geo.n);
  ok("4 条波浪宽度一致且铺满内容区",
    new Set(geo.ws).size === 1 && geo.ws[0] === geo.wrapW && geo.hs.every(h => h === 12),
    "宽度 " + geo.ws.join("/") + "（内容区 " + geo.wrapW + "）高 " + geo.hs.join("/"));
  ok("新增的那条第 2 条在「02 意图」之后、「03 身份」之前",
    geo.ys[1] > geo.intentsBottom && geo.ys[1] < geo.hd03Top,
    "rule2.top=" + geo.ys[1] + " intents.bottom=" + geo.intentsBottom + " hd03.top=" + geo.hd03Top);
  ok("波浪仍是线上那一版的平铺节奏（30px 整周期）", geo.repeat.join() === "repeat-x", geo.repeat.join());
  ok("三句长说明不再摊在页面上",
    !geo.hintTexts.some(t => /不留存|还没有档案|同步到云端/.test(t)),
    geo.hintTexts.join(" || "));
  ok("「还没有档案」那句空态在页面上也不再显示", geo.emptyStateShown === "none", "display=" + geo.emptyStateShown);

  // ---- ① 三处图标onUpdate位置：都贴在上一行末尾，不单独占行 ----
  const pos = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll(".mi").forEach(b => {
      const r = b.getBoundingClientRect();
      const p = b.parentElement.getBoundingClientRect();
      const parentText = b.parentElement.textContent.replace(b.textContent, "").trim();
      out.push({
        cls: b.className,
        inRow: r.top >= p.top - 2 && r.bottom <= p.bottom + 24,   // 图标没有把父行撑开太多
        parentText: parentText.slice(0, 40),
        hidden: getComputedStyle(b).display === "none"
      });
    });
    return out;
  });
  ok("图标共 3 处，桌面端都可见", pos.length === 3 && pos.every(p => !p.hidden), JSON.stringify(pos.map(p => p.hidden)));
  ok("每个图标都挂在「上一行」的内容里（同一行尾端，不新起一行）",
    pos.every(p => p.inRow && p.parentText.length > 0),
    pos.map(p => p.parentText).join(" ｜ "));

  // ---- ② 静止：一个气泡都不许露 ----
  const idle = await Promise.all([0, 1, 2].map(i => tipState(page, i)));
  ok("静止时 3 个气泡全部隐藏（留白但不显示）",
    idle.every(s => s.vis === "hidden"),
    idle.map(s => s.vis + "/" + s.op).join(" "));

  // ---- ② 悬停出、移开收 ----
  await shot(page, "#sec1", "v017-desktop-01.png");          // 静止态：页面干净，一个气泡都不露
  await page.locator(".mi").nth(0).hover();
  await page.waitForTimeout(420);
  const hov = await tipState(page, 0);
  ok("鼠标悬停：01 区气泡翻出来", hov.vis === "visible" && hov.op > 0.95 && hov.w > 100,
    hov.vis + " op=" + hov.op + " " + hov.w + "x" + hov.h);
  ok("悬停气泡不出屏 + 箭头指着图标",
    hov.left >= 0 && hov.right <= hov.vw && parseFloat(hov.arrow) > 8 && parseFloat(hov.arrow) < hov.w - 8,
    "left=" + hov.left + " right=" + hov.right + " vw=" + hov.vw + " arrow=" + hov.arrow);
  ok("01 区气泡文案就是原来那句",
    hov.txt === "只贴需要的几条即可 · 内容与截图都仅用于本次生成和识别，不留存", hov.txt);
  await shot(page, ".mi", "v017-desktop-01-tip.png", 6, 108);   // 上方留出气泡的位置
  await page.mouse.move(10, 10);
  await page.waitForTimeout(400);
  const off = await tipState(page, 0);
  ok("鼠标移开：气泡收回", off.vis === "hidden", off.vis);

  // ---- ② 键盘 Tab 真的能走到（不用程序化 focus，那测不出 :focus-visible）----
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  let tabbed = false;
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press("Tab");
    await page.waitForTimeout(60);
    const isMi = await page.evaluate(() => !!(document.activeElement && document.activeElement.classList.contains("mi")));
    if (isMi) { tabbed = true; break; }
  }
  await page.waitForTimeout(350);
  const kb = await tipState(page, 0);
  ok("键盘 Tab 走到图标：气泡也出（光标可见）", tabbed && kb.vis === "visible", "tabbed=" + tabbed + " " + kb.vis);

  // ---- ② 点按：点一下留住、同屏只留一个、点别处 / Esc 关掉 ----
  await page.locator(".mi").nth(2).click();
  await page.waitForTimeout(300);
  const clickOn = await page.evaluate(() => ({
    n: document.querySelectorAll(".mi.on").length,
    clicked: document.querySelectorAll(".mi")[2].classList.contains("on"),
    expanded: document.querySelectorAll('.mi[aria-expanded="true"]').length
  }));
  ok("点按：气泡留住，且同屏只留一个", clickOn.n === 1 && clickOn.clicked, JSON.stringify(clickOn));
  const clickTip = await tipState(page, 2);
  ok("点按后的气泡也不出屏", clickTip.left >= 0 && clickTip.right <= clickTip.vw,
    "left=" + clickTip.left + " right=" + clickTip.right + " vw=" + clickTip.vw);
  await page.locator(".mi").nth(0).click();
  await page.waitForTimeout(250);
  const switched = await page.evaluate(() => ({
    n: document.querySelectorAll(".mi.on").length,
    first: document.querySelectorAll(".mi")[0].classList.contains("on")
  }));
  ok("点另一个图标：前一个自动收起", switched.n === 1 && switched.first, JSON.stringify(switched));
  await page.mouse.click(20, 20);
  await page.waitForTimeout(250);
  ok("点页面别处：气泡关掉",
    (await page.evaluate(() => document.querySelectorAll(".mi.on").length)) === 0);
  await page.locator(".mi").nth(1).click();
  await page.waitForTimeout(200);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);
  ok("按 Esc：气泡关掉",
    (await page.evaluate(() => document.querySelectorAll(".mi.on").length)) === 0);

  // ---- 截图：02/03 区、04 区 ----
  await shot(page, ".blk:nth-of-type(2)", "v017-desktop-0203.png");
  await shot(page, "#sec3", "v017-desktop-04.png");

  // ---- 结果区：候选之间只剩细线，regen 也只有细线（不再每条顶一道波浪）----
  await page.evaluate(() => {
    const box = document.getElementById("results");
    box.innerHTML = "";
    for (let i = 1; i <= 3; i++) {
      const d = document.createElement("div");
      d.className = "cand";
      d.innerHTML = '<div class="head"><span class="no">0' + i + '</span><span class="strategy">示例策略</span></div>'
        + '<div class="reply">这是一条示例候选回复，用来看分隔线是不是只剩一条细线。</div><div class="ops"></div>';
      box.appendChild(d);
    }
    const regen = document.createElement("div");
    regen.className = "regen";
    regen.innerHTML = "<button>更短</button><button>更委婉</button><button>更口语</button><button>换一批</button>";
    box.appendChild(regen);
  });
  await page.waitForTimeout(300);
  const lines = await page.evaluate(() => ({
    candBorder: [...document.querySelectorAll(".cand")].map(c => getComputedStyle(c).borderTopWidth),
    candWave: [...document.querySelectorAll(".cand")].map(c => getComputedStyle(c, "::before").backgroundImage.slice(0, 12)),
    regenBorder: getComputedStyle(document.querySelector(".regen")).borderTopWidth
  }));
  ok("候选之间是 1px 细线（第 1 条没有顶线）",
    lines.candBorder.join(",") === "0px,1px,1px", lines.candBorder.join(","));
  ok("候选 / 重新生成都不再顶一道波浪", lines.candWave.every(v => v === "none"), lines.candWave.join("/"));
  await shot(page, "#results", "v017-desktop-results.png");
  await page.close();

  /* ==================== 手机 393 ==================== */
  const m = await browser.newPage({ viewport: { width: 393, height: 800 }, hasTouch: true, isMobile: true });
  m.on("pageerror", e => errs.push("mobile: " + (e && e.message)));
  await m.goto(URL, { waitUntil: "load" });
  await m.waitForTimeout(1400);
  await m.evaluate(() => document.querySelectorAll(".reveal").forEach(e => e.classList.add("in")));

  const tapSize = await m.evaluate(() => {
    const b = document.querySelector(".mi").getBoundingClientRect();
    return { w: Math.round(b.width), h: Math.round(b.height), vw: document.documentElement.clientWidth };
  });
  ok("手机上图标热区够大（≥34px）", tapSize.w >= 34 && tapSize.h >= 34, tapSize.w + "x" + tapSize.h);

  const mIdle = await tipState(m, 0);
  await m.locator(".mi").nth(0).tap();
  await m.waitForTimeout(350);
  const mTip = await tipState(m, 0);
  ok("手指点一下：气泡出来（手机没有悬停，只能靠点）",
    mIdle.vis === "hidden" && mTip.vis === "visible", mIdle.vis + " -> " + mTip.vis);
  ok("手机气泡不出屏", mTip.left >= 0 && mTip.right <= mTip.vw,
    "left=" + mTip.left + " right=" + mTip.right + " vw=" + mTip.vw);

  // 手机上三处图标都点一遍，确认都不出屏
  const mAll = [];
  for (let i = 0; i < 3; i++) {
    await m.locator(".mi").nth(i).tap();
    await m.waitForTimeout(260);
    const s = await tipState(m, i);
    mAll.push("[" + i + "] " + s.vis + " " + s.left + "~" + s.right + "/" + s.vw);
    ok("手机气泡不出屏（第 " + (i + 1) + " 处）", s.vis === "visible" && s.left >= 0 && s.right <= s.vw, s.left + "~" + s.right + " / " + s.vw);
  }
  await m.locator(".mi").nth(0).tap();
  await m.waitForTimeout(300);
  await shot(m, ".mi", "v017-mobile-01-tip.png", 6, 110);
  await shot(m, "#sec3", "v017-mobile-04.png");
  await m.close();

  /* ==================== 有档案时：档案图标自己消失 ==================== */
  const p2 = await browser.newPage({ viewport: { width: 1180, height: 1000 } });
  p2.on("pageerror", e => errs.push("archives: " + (e && e.message)));
  await p2.addInitScript(() => {
    localStorage.setItem("miaohui_archives_v1", JSON.stringify([{ name: "对朋友", text: "好的我看看\n哈哈哈可以", persona: "朋友" }]));
  });
  await p2.goto(URL, { waitUntil: "load" });
  await p2.waitForTimeout(1200);
  const withArch = await p2.evaluate(() => ({
    chips: document.querySelectorAll("#archChips .arch-chip").length,
    archIcon: getComputedStyle(document.querySelector(".mi-arch")).display,
    emptyState: document.querySelector("#archChips .shot-hint") ? getComputedStyle(document.querySelector("#archChips .shot-hint")).display : "缺失"
  }));
  ok("有档案时：空态不显示、图标自己也让位",
    withArch.chips === 1 && withArch.archIcon === "none",
    JSON.stringify(withArch));
  await shot(p2, "#sec3", "v017-desktop-04-with-archive.png");
  await p2.close();

  await browser.close();

  const fails = results.filter(r => r.startsWith("FAIL")).length;
  const head = "妙回 V" + VER.replace(/^V/, "") + " 版面与提示图标复核\n"
    + "时间：" + new Date().toISOString() + "\n"
    + "用例：" + results.length + "  通过：" + (results.length - fails) + "  失败：" + fails + "\n"
    + "页面未捕获异常：" + (errs.length ? errs.join(" ; ") : "无") + "\n";
  fs.writeFileSync(LOG, head + "\n" + results.join("\n") + "\n", "utf8");
  console.log(head + "\n" + results.join("\n"));
  console.log("\n截图目录：" + OUT);
  if (mAll.length) console.log("手机三处气泡：" + mAll.join(" ｜ "));
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error("ERR", e && e.message); process.exit(1); });

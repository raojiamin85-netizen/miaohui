/**
 * 移动端上传截图回归测试（v0.13 修复验证）
 *
 * 背景：v0.12 及以前，<input type="file"> 用了 `hidden` 属性（= display:none），
 *       移动端 WebKit / 各家 WebView 会拒绝为「未渲染」的 input 唤起文件选择器，
 *       症状就是用户报的「点了没反应」。
 *
 * 本脚本用 iPhone 设备仿真（含 hasTouch），验证：
 *   1. file input 不再是 display:none
 *   2. input 覆盖层与按钮几何完全重合（所以触摸是直接落在 input 上）
 *   3. 真实 touchscreen.tap 能唤起 filechooser（关键证据）
 *   4. 选完文件后缩略图进入列表、识别流程真的跑了
 *   5. 触屏下点击热区 >= 44px、对手机无意义的 Ctrl+V 提示被隐藏
 *   6. 按钮 disabled 时覆盖层失去 pointer-events（不能绕过禁用态）
 *
 * 跑法：NODE_PATH=<node workspace>/node_modules node scripts/e2e-mobile-upload.cjs
 */
const { chromium, devices } = require("playwright");
const path = require("path");
const fs = require("fs");

const DIR = path.resolve(__dirname, "..");
const EV = path.join(DIR, "docs", "evidence");
const URL = "file:///" + DIR.replace(/\\/g, "/") + "/index.html";
const SHOT = path.join(EV, "fake-chat-screenshot.png");
const OUT = path.join(__dirname, "mobile-report.txt");

const lines = [];
let pass = 0, fail = 0;
const check = (name, cond, extra) => {
  lines.push((cond ? "PASS  " : "FAIL  ") + name + (extra ? "   [" + extra + "]" : ""));
  cond ? pass++ : fail++;
};

(async () => {
  lines.push("妙回 V0.13 移动端上传截图回归测试（iPhone 仿真 + 触摸）");
  lines.push("时间：" + new Date().toISOString());
  lines.push("");

  const browser = await chromium.launch({ channel: "msedge" });
  const ctx = await browser.newContext({
    ...devices["iPhone 13"],
    locale: "zh-CN",
    acceptDownloads: false
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(String(e && e.message || e)));

  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForSelector("#intents .chip", { timeout: 20000 });
  await page.waitForTimeout(1200);

  // ---------- 1) 根因验证：input 必须是「渲染态」 ----------
  const dom = await page.evaluate(() => {
    const pick = (id) => {
      const el = document.getElementById(id);
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        display: cs.display, visibility: cs.visibility, opacity: parseFloat(cs.opacity),
        w: Math.round(r.width), h: Math.round(r.height),
        x: Math.round(r.left), y: Math.round(r.top),
        hiddenAttr: el.hasAttribute("hidden"), cls: el.className
      };
    };
    const box = (id) => {
      const r = document.getElementById(id).getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.left), y: Math.round(r.top) };
    };
    return {
      shotFile: pick("shotFile"), styleShotFile: pick("styleShotFile"),
      shotBtn: box("shotBtn"), styleShotBtn: box("styleShotBtn"),
      touch: matchMedia("(pointer: coarse)").matches || matchMedia("(hover: none)").matches,
      kbdOnly: (() => {
        const el = document.querySelector(".kbd-only");
        return el ? getComputedStyle(el).display : "MISSING";
      })(),
      shotBtnFont: getComputedStyle(document.getElementById("shotBtn")).fontSize
    };
  });

  const a = dom.shotFile, b = dom.shotBtn;
  check("01 上下文截图 input 不再是 display:none", a.display !== "none" && a.visibility !== "hidden",
    "display=" + a.display + " visibility=" + a.visibility);
  check("02 上下文截图 input 仍带 .shot-file 覆盖层类", a.cls.indexOf("shot-file") >= 0 && !a.hiddenAttr,
    "class=" + a.cls + " hidden=" + a.hiddenAttr);
  check("03 04 区块（风格提取）同样不再是 display:none",
    dom.styleShotFile.display !== "none" && dom.styleShotFile.visibility !== "hidden",
    "display=" + dom.styleShotFile.display);

  const same = (p, q) => Math.abs(p.x - q.x) <= 1 && Math.abs(p.y - q.y) <= 1 && Math.abs(p.w - q.w) <= 1 && Math.abs(p.h - q.h) <= 1;
  check("04 覆盖层与按钮几何重合（触摸可直接落在 input 上）", same(a, b),
    "input " + a.w + "x" + a.h + "@" + a.x + "," + a.y + " vs 按钮 " + b.w + "x" + b.h + "@" + b.x + "," + b.y);
  check("05 04 区块覆盖层与按钮几何重合", same(dom.styleShotFile, dom.styleShotBtn),
    "input " + dom.styleShotFile.w + "x" + dom.styleShotFile.h + " vs 按钮 " + dom.styleShotBtn.w + "x" + dom.styleShotBtn.h);

  check("06 触屏媒体查询生效（pointer: coarse / hover: none）", dom.touch === true, "touch=" + dom.touch);
  check("07 点击热区 >= 44px（Apple HIG 最小值）", b.h >= 44, "按钮高度=" + b.h + "px  字号=" + dom.shotBtnFont);
  check("08 手机端隐藏了无意义的 Ctrl+V 提示", dom.kbdOnly === "none", ".kbd-only display=" + dom.kbdOnly);

  // ---------- 2) 关键证据：触摸真的唤起 filechooser ----------
  let chooserFired = false;
  // 注意：必须先把按钮滚到视口内再取坐标 —— 否则 getBoundingClientRect 可能给出
  // 视口外的负坐标，touchscreen.tap 就点空了（本脚本第一版就踩了这个坑）。
  await page.evaluate(() => document.getElementById("shotBtn").scrollIntoView({ block: "center" }));
  await page.waitForTimeout(400);
  const center = await page.evaluate(() => {
    const r = document.getElementById("shotBtn").getBoundingClientRect();
    return {
      x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2),
      inView: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth,
      vw: innerWidth, vh: innerHeight
    };
  });
  check("09a 待触摸点确实在视口内（防止假失败）", center.inView === true,
    "点 " + center.x + "," + center.y + " 视口 " + center.vw + "x" + center.vh);
  try {
    const [fc] = await Promise.all([
      page.waitForEvent("filechooser", { timeout: 8000 }),
      page.touchscreen.tap(center.x, center.y)
    ]);
    chooserFired = true;
    check("09 手指点在「上传聊天截图」上唤起了文件选择器", true, "点 " + center.x + "," + center.y);

    await fc.setFiles(SHOT);
    await page.waitForTimeout(800);
    const after = await page.evaluate(() => ({
      n: document.querySelectorAll("#shots .shot").length,
      state: (document.querySelector("#shots .shot .badge") || {}).textContent || "",
      ctxHasText: document.getElementById("context").value.length > 0,
      msgShown: getComputedStyle(document.getElementById("shotMsg")).display
    }));
    check("10 选图后缩略图进入列表", after.n === 1, "缩略图=" + after.n + " 状态=" + after.state);

    // 等识别流程收敛（网络可用则 ok，不可用则 err —— 两者都证明链路跑通了）
    let state = after.state;
    for (let i = 0; i < 60 && (state === "等待" || state === "识别中"); i++) {
      await page.waitForTimeout(1000);
      state = await page.evaluate(() => (document.querySelector("#shots .shot .badge") || {}).textContent || "");
    }
    const finalCtx = await page.evaluate(() => document.getElementById("context").value);
    check("11 识别流程跑通（状态收敛，非卡在等待/识别中）", state === "已提取" || state === "失败",
      "最终状态=" + state + (finalCtx ? "  写入上下文 " + finalCtx.length + " 字" : "  上下文为空"));
    lines.push("      · 识别结果：" + (state === "已提取" ? "成功，文字已填进 01 输入框" : "本次失败（多为网络/模型波动，不影响本次要验的『能否唤起选择器』）"));
  } catch (e) {
    check("09 手指点在「上传聊天截图」上唤起了文件选择器", false, "未触发 filechooser：" + e.message);
  }
  check("12 filechooser 是否触发", chooserFired, chooserFired ? "已触发" : "未触发");

  // ---------- 3) 禁用态不被覆盖层绕过 ----------
  const dis = await page.evaluate(() => {
    const btn = document.getElementById("shotBtn");
    btn.disabled = true;
    const pe = getComputedStyle(document.getElementById("shotFile")).pointerEvents;
    btn.disabled = false;
    const pe2 = getComputedStyle(document.getElementById("shotFile")).pointerEvents;
    return { disabled: pe, enabled: pe2 };
  });
  check("13 按钮置灰时覆盖层失去 pointer-events（不能绕过禁用）", dis.disabled === "none", "disabled 时 pointer-events=" + dis.disabled);
  check("14 按钮恢复时不误伤覆盖层", dis.enabled !== "none", "恢复后 pointer-events=" + dis.enabled);

  // ---------- 4) 04 区块也走一遍触摸 ----------
  await page.evaluate(() => document.getElementById("styleShotBtn").scrollIntoView({ block: "center" }));
  await page.waitForTimeout(400);
  const c2 = await page.evaluate(() => {
    const r = document.getElementById("styleShotBtn").getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  });
  try {
    await Promise.all([
      page.waitForEvent("filechooser", { timeout: 8000 }),
      page.touchscreen.tap(c2.x, c2.y)
    ]);
    check("15 04 区块「上传截图提取」触摸也能唤起选择器", true, "点 " + c2.x + "," + c2.y);
    await page.keyboard.press("Escape");
  } catch (e) {
    check("15 04 区块「上传截图提取」触摸也能唤起选择器", false, e.message);
  }

  // ---------- 5) 截图存档 ----------
  await page.evaluate(() => {
    document.querySelectorAll(".reveal").forEach(el => el.classList.add("in"));
    document.getElementById("sec1").scrollIntoView({ block: "start" });
    window.scrollBy(0, -70);
  });
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(EV, "mobile-v013-upload.png") });
  await page.evaluate(() => document.getElementById("shotBtn").scrollIntoView({ block: "center" }));
  await page.waitForTimeout(500);
  const clip = await page.locator(".shot-row").first().boundingBox();
  if (clip) {
    await page.screenshot({
      path: path.join(EV, "mobile-v013-upload-row.png"),
      clip: { x: 0, y: Math.max(0, clip.y - 14), width: 390, height: clip.height + 28 }
    });
  }

  check("16 页面零未捕获异常", errors.length === 0, errors.length ? errors.join(" | ") : "无");

  await browser.close();

  lines.push("");
  lines.push("合计：" + pass + " 通过 / " + fail + " 失败");
  fs.writeFileSync(OUT, lines.join("\n") + "\n", "utf8");
  console.log(lines.join("\n"));
  process.exit(fail ? 1 : 0);
})().catch(e => {
  fs.writeFileSync(OUT, lines.join("\n") + "\nFATAL: " + (e && e.stack || e) + "\n", "utf8");
  console.error(e);
  process.exit(1);
});

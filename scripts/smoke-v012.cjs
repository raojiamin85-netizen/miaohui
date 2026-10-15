/* 视觉改版后的功能冒烟：逐条走真实代码路径，确认换皮没丢功能。
   不依赖云服务（不点生成），只验前端交互与本地存储。 */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const LOG = path.join(__dirname, "smoke-report.txt");

const results = [];
const check = (name, pass, extra) => results.push((pass ? "PASS  " : "FAIL  ") + name + (extra ? "  | " + extra : ""));

(async () => {
  const browser = await chromium.launch({ channel: "msedge" });
  const page = await browser.newPage({ viewport: { width: 900, height: 1000 } });
  const consoleErr = [];
  page.on("pageerror", e => consoleErr.push("pageerror: " + e.message));

  await page.goto("file:///" + ROOT + "/index.html", { waitUntil: "load" });
  await page.waitForTimeout(2500);

  // 1) 意图 chip
  const nIntents = await page.locator("#intents .chip").count();
  check("意图 chip 渲染 10 个", nIntents === 10, "实际 " + nIntents);
  await page.locator("#intents .chip").nth(1).click();
  const intentOn = await page.evaluate(() => document.querySelectorAll("#intents .chip.on").length);
  const intentLabel = await page.locator("#intents .chip.on").first().textContent();
  check("点击意图后唯一选中且带 .on", intentOn === 1, "选中=" + intentLabel);
  await page.locator("#intents .chip").nth(3).click();
  const after2 = await page.evaluate(() => ({
    on: document.querySelectorAll("#intents .chip.on").length,
    label: document.querySelector("#intents .chip.on").textContent
  }));
  check("再点可切换（旧的取消）", after2.on === 1 && after2.label !== intentLabel, "新选中=" + after2.label);

  // 2) 身份 chip + 自定义
  const nPers = await page.locator("#personas .chip").count();
  check("身份 chip 渲染 13 个（12 + 其他自己填）", nPers === 13, "实际 " + nPers);
  await page.locator("#personas .chip").nth(2).click();
  const perOn = await page.evaluate(() => document.querySelector("#personas .chip.on").textContent);
  check("点击身份生效", perOn === await page.locator("#personas .chip").nth(2).textContent(), "选中=" + perOn);
  await page.locator("#personas .chip").last().click();
  const customShown = await page.evaluate(() => getComputedStyle(document.getElementById("personaCustom")).display);
  await page.locator("#personaCustom").fill("社团部长");
  const customVal = await page.evaluate(() => document.getElementById("personaCustom").value);
  check("「其他，自己填」展开并接受自定义身份", customShown === "block" && customVal === "社团部长", "display=" + customShown);

  // 3) 风格样本自动存 localStorage
  await page.locator("#style").fill("好的我看看\n哈哈哈可以\n等我十分钟");
  const lsStyle = await page.evaluate(() => localStorage.getItem("miaohui_style"));
  check("风格样本写入 localStorage", (lsStyle || "").includes("哈哈哈可以"), "");

  // 4) 存为档案
  await page.locator("#saveArchBtn").click();
  const formOn = await page.evaluate(() => document.getElementById("archForm").classList.contains("on"));
  const namePrefill = await page.evaluate(() => document.getElementById("archName").value);
  check("点「存为档案」展开命名框并按身份预填", formOn && namePrefill.length > 0, "预填=" + namePrefill);
  await page.locator("#archName").fill("对朋友");
  await page.locator("#archOk").click();
  await page.waitForTimeout(300);
  const archCount = await page.locator("#archChips .arch-chip").count();
  const lsArch = await page.evaluate(() => JSON.parse(localStorage.getItem("miaohui_archives_v1") || "[]"));
  check("档案落到 chips 与本机存储", archCount === 1 && lsArch.length === 1, "chips=" + archCount + " 存储=" + lsArch.length);

  // 5) 一键载入 / 本次不用
  await page.locator("#useNoneBtn").click();
  const styleAfterNone = await page.evaluate(() => document.getElementById("style").value);
  const archStill = await page.locator("#archChips .arch-chip").count();
  check("「本次不使用风格」清空输入但保留档案", styleAfterNone === "" && archStill === 1, "档案=" + archStill);
  await page.locator("#archChips .arch-chip").first().click();
  const styleReloaded = await page.evaluate(() => document.getElementById("style").value);
  check("点档案可一键载回风格", styleReloaded.includes("哈哈哈可以"), "");

  // 6) 删档案
  await page.locator("#archChips .arch-chip .del").first().click();
  await page.waitForTimeout(200);
  const archAfterDel = await page.locator("#archChips .arch-chip").count();
  check("档案可删除", archAfterDel === 0, "剩 " + archAfterDel);

  // 7) 截图上传入口仍在（识别按钮 + 隐藏 file input）
  const shotWired = await page.evaluate(() => {
    const b = document.getElementById("shotBtn"), f = document.getElementById("shotFile");
    const b2 = document.getElementById("styleShotBtn"), f2 = document.getElementById("styleShotFile");
    return !!b && !!f && f.multiple && !!b2 && !!f2 && f2.multiple;
  });
  check("上传截图入口（01 上下文 / 03 风格）都在且支持多选", shotWired);

  // 8) 结果区渲染 + 清空（调用真实的 render()，不用手工 DOM）
  await page.locator("#intents .chip").nth(0).click();
  await page.locator("#personas .chip").nth(1).click();
  await page.evaluate(() => {
    render([
      { reply: "行，我记一份发群里", strategy: "答应并推进" },
      { reply: "没问题，会前我把模板发你确认下", strategy: "答应但留余地" },
      { reply: "可以，周五我全程在，放心", strategy: "稳住对方" }
    ]);
  });
  await page.locator("#context").fill("对方：明天有空吗");
  await page.locator("#extra").fill("别提加班");
  const candCount = await page.locator("#results .cand").count();
  const copyCount = await page.locator("#results .ops button").count();
  const regenCount = await page.locator("#results .regen button").count();
  check("结果区 3 条候选 + 每条 3 个操作 + 底部 4 微调 1 清空",
    candCount === 3 && copyCount === 9 && regenCount === 5,
    "cand=" + candCount + " 操作=" + copyCount + " 底部=" + regenCount);

  // 8b) 反馈分支：点「太假了」应就地展开原因输入框
  await page.locator("#results .ops button").nth(2).click();
  await page.waitForTimeout(300);
  const fb = await page.evaluate(() => {
    const box = document.querySelector("#results .cand .ops");
    return { hasReason: !!box.querySelector(".fb-reason"), goodDisabled: box.querySelectorAll("button")[1].disabled };
  });
  check("「太假了」就地展开原因输入框并锁住好评", fb.hasReason && fb.goodDisabled, JSON.stringify(fb));

  await page.locator("#results .clear").click();          // 第一次：进入待确认
  await page.waitForTimeout(300);
  const armText = await page.locator("#results .clear").textContent();
  check("清空需二次确认", armText.includes("确认"), "提示=" + armText);
  await page.locator("#results .clear").click();          // 第二次：真清
  await page.waitForTimeout(700);
  const cleared = await page.evaluate(() => ({
    context: document.getElementById("context").value,
    extra: document.getElementById("extra").value,
    intentOn: document.querySelectorAll("#intents .chip.on").length,
    personaOn: document.querySelectorAll("#personas .chip.on").length,
    custom: getComputedStyle(document.getElementById("personaCustom")).display,
    emptyBack: !!document.querySelector("#results .empty"),
    styleKept: document.getElementById("style").value.length > 0
  }));
  check("清空：上下文/补充说明/意图/身份都复位",
    cleared.context === "" && cleared.extra === "" && cleared.intentOn === 0 && cleared.personaOn === 0 && cleared.custom === "none",
    JSON.stringify(cleared));
  check("清空后回到空状态插画", cleared.emptyBack);
  check("清空不动风格样本（用户资产保留）", cleared.styleKept);

  // 9) 账号弹窗
  await page.locator("#acct .acct-btn").click();
  const maskOn = await page.evaluate(() => document.getElementById("authMask").classList.contains("on"));
  await page.locator('#authTabs button[data-tab="reg"]').click();
  const regShown = await page.evaluate(() => getComputedStyle(document.getElementById("paneReg")).display);
  await page.locator('#authTabs button[data-tab="pwd"]').click();
  await page.locator("#forgotLink").click();
  const resetShown = await page.evaluate(() => getComputedStyle(document.getElementById("paneReset")).display);
  await page.locator("#backLogin").click();
  const pwdBack = await page.evaluate(() => getComputedStyle(document.getElementById("panePwd")).display);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  const maskOff = await page.evaluate(() => document.getElementById("authMask").classList.contains("on"));
  check("登录入口可开窗", maskOn);
  check("注册 / 忘记密码 / 回到登录 / Esc 关闭 都通",
    regShown === "block" && resetShown === "block" && pwdBack === "block" && !maskOff,
    "reg=" + regShown + " reset=" + resetShown + " pwd=" + pwdBack);

  // 10) 无障碍与隐私文案
  const a11y = await page.evaluate(() => ({
    sr: !!document.querySelector("h1.sr"),
    privacy: document.body.innerText.includes("不留存")
  }));
  check("保留屏幕阅读器标题与隐私说明", a11y.sr && a11y.privacy);

  await browser.close();

  const fails = results.filter(r => r.startsWith("FAIL")).length;
  const head = "妙回功能冒烟（换皮回归用，与版本号无关）\n"
    + "时间：" + new Date().toISOString() + "\n"
    + "用例：" + results.length + "  通过：" + (results.length - fails) + "  失败：" + fails + "\n"
    + "页面未捕获异常：" + (consoleErr.length ? consoleErr.join(" ; ") : "无") + "\n";
  fs.writeFileSync(LOG, head + "\n" + results.join("\n") + "\n", "utf8");
  console.log(head + "\n" + results.join("\n"));
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error("ERR", e && e.message); process.exit(1); });

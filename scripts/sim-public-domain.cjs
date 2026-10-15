const pw = require("playwright");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "docs", "evidence");
fs.mkdirSync(OUT, { recursive: true });

const DENY = '{"error":"access_denied","error_description":"the request origin is not allowed for this client"}';

(async () => {
  const browser = await pw.chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 1200, height: 980 } });

  let intercepted = 0;
  await page.route(/miaohui-reply\.app\.workbuddy\.host/, async (route) => {
    intercepted++;
    await route.fulfill({
      status: 403,
      contentType: "application/json",
      headers: { "access-control-expose-headers": "X-Request-ID, X-Trace-Id" },
      body: DENY,
    });
  });

  const errs = [];
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 220)); });
  page.on("pageerror", (e) => errs.push("pageerror: " + String(e.message).slice(0, 220)));

  const fileUrl = "file:///" + ROOT.replace(/\\/g, "/") + "/index.html";
  await page.goto(fileUrl, { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(3500);

  await page.locator("#context").fill("房东：下个月房租涨500，不接受就别住了\n我：");
  await page.locator("#intents .chip").nth(2).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, "E-public-domain-before.png") });

  let clickNote = "";
  let disabledAfter = false;
  try {
    await page.locator("#go").click({ timeout: 6000 });
    clickNote = "按钮可点，已点下";
  } catch (e) {
    clickNote = "按钮处于 disabled 状态，根本点不动";
  }
  disabledAfter = await page.locator("#go").isDisabled().catch(() => null);
  await page.waitForTimeout(10000);
  await page.screenshot({ path: path.join(OUT, "E-public-domain-after.png") });
  await page.locator("#go").scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(700);
  const gbox = await page.locator("#go").boundingBox().catch(() => null);
  if (gbox) {
    await page
      .screenshot({
        path: path.join(OUT, "E-status-tip.png"),
        clip: { x: 0, y: Math.max(0, gbox.y - 170), width: 1200, height: 340 },
      })
      .catch(() => {});
  }

  const bodyText = (await page.innerText("body").catch(() => "")).replace(/\s+/g, " ");
  const tail = bodyText.slice(-1400);

  const lines = [
    "===== 界面还原：当页面挂在公网第三方域名下（云请求一律 403）=====",
    `拦截到的云请求数 : ${intercepted}`,
    "返回的和平台真实 403 完全一致 : " + DENY,
    "",
    `按钮状态 : ${clickNote}   isDisabled=${disabledAfter}`,
    "",
    "点「生成」后页面尾部文案 :",
    tail,
    "",
    "控制台 :",
    errs.length ? [...new Set(errs)].slice(0, 6).join("\n") : "（无）",
  ];
  const out = lines.join("\n");
  fs.writeFileSync(path.join(OUT, "sim-public-domain-report.txt"), out, "utf8");
  console.log(out);

  await browser.close();
})();

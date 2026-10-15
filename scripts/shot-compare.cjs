const { chromium } = require("playwright");

const DIR = "D:/Projects/miaohui";
const EV = DIR + "/docs/evidence";

(async () => {
  // 本机没有下载 playwright 自带浏览器，直接用已安装的 Edge
  const browser = await chromium.launch({ channel: "msedge" });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1100 }, deviceScaleFactor: 1 });

  const shot = async (n, opts) => { await page.screenshot(Object.assign({ path: EV + "/" + n + ".png" }, opts || {})); };

  // 外部字体 / 云 SDK 走 CDN，"load" 事件可能迟迟不来；等 DOM 就绪 + 等真实元素出现即可
  await page.goto("file:///" + DIR + "/index.v0.10.backup.html", { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForSelector("#intents .chip", { timeout: 30000 });
  await page.waitForTimeout(2600);
  await page.evaluate(() => document.querySelectorAll(".reveal").forEach(el => el.classList.add("in")));
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(900);
  await shot("cmp-before-full", { fullPage: true });

  await page.goto("file:///" + DIR + "/index.html", { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForSelector("#intents .chip", { timeout: 30000 });
  await page.waitForTimeout(2600);
  await page.evaluate(() => document.querySelectorAll(".reveal").forEach(el => el.classList.add("in")));
  await page.waitForTimeout(900);
  await shot("cmp-after-full", { fullPage: true });

  await page.evaluate(() => {
    const its = document.querySelectorAll("#intents .chip");
    if (its[1]) its[1].click();
    const ps = document.querySelectorAll("#personas .chip");
    if (ps[2]) ps[2].click();
    const st = document.getElementById("style");
    st.value = "好的我看看 / 哈哈哈可以 / 等我十分钟";
    st.dispatchEvent(new Event("input"));
  });
  await page.waitForTimeout(800);
  await shot("cmp-after-picked", { fullPage: true });

  await page.evaluate(() => {
    const s = document.getElementById("status");
    s.style.display = "block";
    s.innerHTML = '<div class="track"><i></i></div><div class="stage">正在揣摩你们平时的说话方式…</div><div class="elapsed">已用 3 秒</div>';
    document.getElementById("cancel").style.display = "block";
  });
  await page.waitForTimeout(500);
  await shot("cmp-after-waiting", { fullPage: true });

  await page.evaluate(() => {
    document.getElementById("status").style.display = "none";
    document.getElementById("cancel").style.display = "none";
    render([
      { reply: "行，我记一份发群里", strategy: "答应并推进" },
      { reply: "没问题，会前我把模板发你确认下", strategy: "答应但留余地" },
      { reply: "可以，周五我全程在，放心", strategy: "稳住对方" }
    ]);
  });
  await page.waitForTimeout(1400);
  await shot("cmp-after-results", { fullPage: true });

  await page.evaluate(() => document.getElementById("authMask").classList.add("on"));
  await page.waitForTimeout(700);
  await shot("cmp-after-auth");

  await page.setViewportSize({ width: 390, height: 900 });
  await page.evaluate(() => { document.getElementById("authMask").classList.remove("on"); window.scrollTo(0, 0); });
  await page.waitForTimeout(800);
  await shot("cmp-after-mobile");

  await browser.close();
  console.log("done");
})().catch(e => { console.error("ERR", e && e.message); process.exit(1); });

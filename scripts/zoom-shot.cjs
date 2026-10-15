const { chromium } = require("playwright");
const DIR = "D:/Projects/miaohui";
const EV = DIR + "/docs/evidence";

(async () => {
  const browser = await chromium.launch({ channel: "msedge" });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
  await page.goto("file:///" + DIR + "/index.html", { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForSelector("#intents .chip", { timeout: 30000 });
  await page.waitForTimeout(3000);
  await page.evaluate(() => document.querySelectorAll(".reveal").forEach(el => el.classList.add("in")));
  await page.waitForTimeout(800);

  const fontOk = await page.evaluate(() => document.fonts.check('20px "ZCOOL KuaiLe"'));
  const fontList = await page.evaluate(() => [...document.fonts].map(f => f.family + ":" + f.status).slice(0, 8));

  await page.locator(".hero").screenshot({ path: EV + "/zoom-hero.png" });

  await page.evaluate(() => {
    const its = document.querySelectorAll("#intents .chip");
    if (its[1]) its[1].click();
    const ps = document.querySelectorAll("#personas .chip");
    if (ps[2]) ps[2].click();
  });
  await page.waitForTimeout(700);
  await page.locator("section:has(#intents)").screenshot({ path: EV + "/zoom-chips.png" });
  await page.locator("#sec1").screenshot({ path: EV + "/zoom-sec1.png" });
  await page.locator("#go").screenshot({ path: EV + "/zoom-go.png" });

  await page.locator("nav").screenshot({ path: EV + "/zoom-nav.png" });

  await page.evaluate(() => {
    document.querySelectorAll(".reveal").forEach(el => el.classList.add("in"));
    render([
      { reply: "行，我记一份发群里", strategy: "答应并推进" },
      { reply: "没问题，会前我把模板发你确认下", strategy: "答应但留余地" }
    ]);
  });
  await page.waitForTimeout(1300);
  await page.locator("#results").screenshot({ path: EV + "/zoom-results.png" });

  await browser.close();
  console.log("font ZCOOL loaded:", fontOk);
  console.log(fontList.join(" | "));
})().catch(e => { console.error("ERR", e && e.message); process.exit(1); });

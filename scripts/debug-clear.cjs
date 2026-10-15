const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");

(async () => {
  const browser = await chromium.launch({ channel: "msedge" });
  const page = await browser.newPage({ viewport: { width: 900, height: 1000 } });
  const logs = [];
  page.on("pageerror", e => logs.push("pageerror: " + e.message));
  page.on("console", m => logs.push("console." + m.type() + ": " + m.text()));

  await page.goto("file:///" + ROOT + "/index.html", { waitUntil: "load" });
  await page.waitForTimeout(2200);

  // 直接调用真实 render()，而不是手工塞 DOM，确保测的是真代码路径
  const rendered = await page.evaluate(() => {
    try {
      window.__testRender = true;
      // render 是函数声明，挂在全局作用域
      render([{ reply: "第一条", strategy: "策略A" }, { reply: "第二条", strategy: "策略B" }]);
      return { cands: document.querySelectorAll("#results .cand").length, regen: document.querySelectorAll("#results .regen button").length };
    } catch (e) { return { err: String(e) }; }
  });
  logs.push("render -> " + JSON.stringify(rendered));

  await page.locator("#context").fill("对方：明天有空吗");

  // A. 原生 click()：走完整命中测试
  const boxA = await page.locator("#results .clear").boundingBox();
  logs.push("clear boundingBox=" + JSON.stringify(boxA));
  const hit = await page.evaluate(() => {
    const el = document.querySelector("#results .clear");
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { tag: top && top.tagName, cls: top && top.className, same: top === el };
  });
  logs.push("elementFromPoint at clear center -> " + JSON.stringify(hit));

  await page.locator("#results .clear").click();
  await page.waitForTimeout(400);
  const afterA = await page.evaluate(() => {
    const el = document.querySelector("#results .clear");
    return { exists: !!el, arm: el && el.dataset.arm, text: el && el.textContent };
  });
  logs.push("after native click #1 -> " + JSON.stringify(afterA));

  if (afterA.exists && afterA.arm !== "1") {
    await page.locator("#results .clear").click();
    await page.waitForTimeout(400);
    logs.push("after native click #2 -> " + JSON.stringify(await page.evaluate(() => {
      const el = document.querySelector("#results .clear");
      return { exists: !!el, arm: el && el.dataset.arm, text: el && el.textContent, ctx: document.getElementById("context").value };
    })));
  }

  // B. 若原生点击无效，直接用 DOM click() 绕过命中测试，判断是"事件没到"还是"逻辑不对"
  await page.evaluate(() => { document.getElementById("results").innerHTML = ""; render([{ reply: "x", strategy: "y" }]); });
  await page.evaluate(() => document.querySelector("#results .clear").click());
  const afterB1 = await page.evaluate(() => {
    const el = document.querySelector("#results .clear");
    return { arm: el && el.dataset.arm, text: el && el.textContent };
  });
  await page.evaluate(() => { const el = document.querySelector("#results .clear"); if (el) el.click(); });
  await page.waitForTimeout(500);
  const afterB2 = await page.evaluate(() => ({
    ctx: document.getElementById("context").value,
    emptyBack: !!document.querySelector("#results .empty"),
  }));
  logs.push("DOM click #1 -> " + JSON.stringify(afterB1));
  logs.push("DOM click #2 -> " + JSON.stringify(afterB2));

  await browser.close();
  fs.writeFileSync(path.join(__dirname, "_debug-clear.log"), logs.join("\n") + "\n", "utf8");
})().catch(e => {
  fs.writeFileSync(path.join(__dirname, "_debug-clear.log"), "ERR " + (e && e.message) + "\n", "utf8");
  process.exit(1);
});

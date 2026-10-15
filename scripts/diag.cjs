const { chromium } = require("playwright");
const DIR = "D:/Projects/miaohui";

(async () => {
  const browser = await chromium.launch({ channel: "msedge" });
  const page = await browser.newPage({ viewport: { width: 760, height: 900 } });
  await page.goto("file:///" + DIR + "/index.html", { waitUntil: "load" });
  await page.waitForTimeout(2600);

  const out = await page.evaluate(() => {
    const lines = [];
    const sec = document.getElementById("sec1");
    const r0 = sec.getBoundingClientRect().top;
    sec.querySelectorAll("*").forEach(el => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const bb = parseFloat(cs.borderBottomWidth) || 0;
      const bt = parseFloat(cs.borderTopWidth) || 0;
      if ((bb > 0 || bt > 0) && r.height > 0) {
        lines.push(el.tagName + "#" + el.id + "." + el.className +
          " | top=" + Math.round(r.top - r0) + " h=" + Math.round(r.height) +
          " | borderTop=" + cs.borderTopWidth + " " + cs.borderTopColor +
          " | borderBottom=" + cs.borderBottomWidth + " " + cs.borderBottomColor +
          " | bg=" + cs.backgroundColor);
      }
    });
    const ta = document.getElementById("context");
    const tcs = getComputedStyle(ta);
    lines.push("-- textarea: h=" + Math.round(ta.getBoundingClientRect().height) +
      " border=" + tcs.borderTopWidth + "/" + tcs.borderRightWidth + "/" + tcs.borderBottomWidth + "/" + tcs.borderLeftWidth +
      " bg=" + tcs.backgroundColor + " appearance=" + tcs.appearance);
    lines.push("-- sec1 height=" + Math.round(sec.getBoundingClientRect().height));
    lines.push("-- body font loaded=" + document.fonts.check('16px "ZCOOL KuaiLe"'));
    lines.push("-- .label h2 font-family=" + getComputedStyle(document.querySelector("#sec1 .label h2")).fontFamily);
    lines.push("-- .chip font-family=" + getComputedStyle(document.querySelector("#intents .chip")).fontFamily);
    return lines;
  });

  await browser.close();
  require("fs").writeFileSync(DIR + "/scripts/_diag.log", out.join("\n") + "\n", "utf8");
})().catch(e => { console.error("ERR", e && e.message); process.exit(1); });

/* 检查线上/本地页面在真实浏览器里，手写字体到底有没有加载成功、有没有降级。
   用途：判定 jsDelivr 不可达时页面会退化成什么样。 */
const pw = require("playwright");

(async () => {
  const browser = await pw.chromium.launch({ channel: "msedge" });
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });

  const failed = [];
  page.on("requestfailed", r => failed.push(r.url() + " :: " + (r.failure() && r.failure().errorText)));

  const lines = [];
  await page.goto("https://miaohui-reply.app.workbuddy.host/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(8000);

  const info = await page.evaluate(async () => {
    await document.fonts.ready;
    const loaded = [];
    document.fonts.forEach(f => loaded.push(f.family + " / " + f.status));
    const el = document.querySelector(".brand");
    const h1 = document.querySelector(".hero .zh, .hero h1, h1");
    const probe = t => {
      if (!t) return "no-element";
      const cs = getComputedStyle(t);
      return cs.fontFamily;
    };
    return {
      fontFaces: loaded,
      brandFontFamily: probe(el),
      heroFontFamily: probe(h1),
      kuaileAvailable: document.fonts.check('16px "ZCOOL KuaiLe"'),
      caveatAvailable: document.fonts.check('16px "Caveat"'),
    };
  });

  lines.push("fontFaces: " + JSON.stringify(info.fontFaces, null, 1));
  lines.push("brand fontFamily: " + info.brandFontFamily);
  lines.push("hero  fontFamily: " + info.heroFontFamily);
  lines.push("ZCOOL KuaiLe 可用: " + info.kuaileAvailable);
  lines.push("Caveat 可用: " + info.caveatAvailable);
  lines.push("");
  lines.push("请求失败数: " + failed.length);
  failed.slice(0, 12).forEach(f => lines.push("  " + f));

  require("fs").writeFileSync(__dirname + "/font-fallback-report.txt", lines.join("\n"), "utf8");
  await browser.close();
  console.log("done");
})().catch(e => { console.error("ERR " + (e && e.message)); process.exit(1); });

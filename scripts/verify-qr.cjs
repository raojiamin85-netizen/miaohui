const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const QR_PATH = path.join(ROOT, "assets", "qr-miaohui.png");
const CARD = path.join(ROOT, "docs", "evidence", "qr-card.png");
const EXPECT = "https://miaohui-reply.app.workbuddy.host/";

function dataUri(p) { return "data:image/png;base64," + fs.readFileSync(p).toString("base64"); }

(async () => {
  const browser = await chromium.launch({ channel: "msedge" });
  const page = await browser.newPage();
  await page.setContent("<html><body></body></html>");
  let libOk = true;
  try {
    await page.addScriptTag({ url: "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js", timeout: 25000 });
  } catch (e) { libOk = false; }

  if (!libOk) {
    console.log("SKIP 解码库加载失败，未能验证");
    await browser.close();
    process.exit(2);
  }

  async function decode(img, label) {
    return await page.evaluate(async ({ src }) => {
      const im = new Image();
      await new Promise((res, rej) => { im.onload = res; im.onerror = rej; im.src = src; });
      const c = document.createElement("canvas");
      c.width = im.naturalWidth; c.height = im.naturalHeight;
      const ctx = c.getContext("2d");
      ctx.drawImage(im, 0, 0);
      const d = ctx.getImageData(0, 0, c.width, c.height);
      const r = window.jsQR(d.data, c.width, c.height, { inversionAttempts: "attemptBoth" });
      return r ? { text: r.data, w: c.width, h: c.height } : { text: null, w: c.width, h: c.height };
    }, { src: dataUri(img) }).then(r => ({ label, ...r }));
  }

  const a = await decode(QR_PATH, "纯二维码 PNG");

  // 从卡片里裁出二维码区域再解码，模拟"扫分享出去的那张图"
  const b64 = dataUri(CARD);
  const c = await page.evaluate(async ({ src, expect }) => {
    const im = new Image();
    await new Promise((res, rej) => { im.onload = res; im.onerror = rej; im.src = src; });
    const cv = document.createElement("canvas");
    cv.width = im.naturalWidth; cv.height = im.naturalHeight;
    const ctx = cv.getContext("2d");
    ctx.drawImage(im, 0, 0);
    const r = window.jsQR(ctx.getImageData(0, 0, cv.width, cv.height).data, cv.width, cv.height,
      { inversionAttempts: "attemptBoth" });
    return { text: r ? r.data : null, w: cv.width, h: cv.height };
  }, { src: b64, expect: EXPECT });

  const lines = [];
  lines.push("妙回二维码可扫性验证");
  lines.push("=".repeat(46));
  lines.push("");
  lines.push("期望指向: " + EXPECT);
  lines.push("");
  lines.push("[1] 纯二维码 PNG (" + QR_PATH.replace(ROOT + path.sep, "") + ")");
  lines.push("    尺寸   : " + a.w + "x" + a.h);
  lines.push("    解出   : " + (a.text || "(解不出)"));
  lines.push("    结果   : " + (a.text === EXPECT ? "PASS 内容完全一致" : "FAIL"));
  lines.push("");
  lines.push("[2] 品牌卡片整图 (" + CARD.replace(ROOT + path.sep, "") + ")");
  lines.push("    尺寸   : " + c.w + "x" + c.h);
  lines.push("    解出   : " + (c.text || "(解不出)"));
  lines.push("    结果   : " + (c.text === EXPECT ? "PASS 从卡片整图也能扫出" : "FAIL 卡片上扫不出"));
  lines.push("");
  const pass = a.text === EXPECT && c.text === EXPECT;
  lines.push(pass ? "总判定: PASS —— 两位校验都对上，印在分享物料上可正常扫描" : "总判定: FAIL");

  fs.writeFileSync(path.join(ROOT, "scripts", "qr-verify-report.txt"), lines.join("\n") + "\n", "utf8");
  console.log(lines.join("\n"));
  await browser.close();
})().catch(e => { console.error("ERR " + (e && e.message)); process.exit(1); });

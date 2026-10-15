/* 诊断：线上页面到底请求了哪些域名。
   目的：判断「把页面换到别的域名托管，云服务还能不能用」。
   若 API 走的是中心域名（非 *.app.workbuddy.host），则换域托管后微信内仍可用；
   若 API 就是 *.app.workbuddy.host，则该网关对微信 UA 全站 403，换域也救不了。
   跑法：NODE_PATH=<node_modules> node probe-api-hosts.cjs */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const OUT = path.join(__dirname, "api-hosts-report.txt");
const SITE = "https://miaohui-reply.app.workbuddy.host/";

(async () => {
  const browser = await chromium.launch({ channel: "msedge" });
  const page = await browser.newPage({ viewport: { width: 900, height: 1000 } });
  const reqs = [];
  const resps = [];
  const errs = [];
  const cloudReqs = [];
  page.on("request", async r => {
    reqs.push({ url: r.url(), method: r.method(), type: r.resourceType() });
    if (r.url().includes("/.cloud/")) {
      let h = {};
      try { h = await r.allHeaders(); } catch (e) { h = { "(allHeaders 失败)": e.message }; }
      cloudReqs.push({ method: r.method(), url: r.url(), headers: h, postData: r.postData() });
    }
  });
  page.on("response", r => resps.push({ url: r.url(), status: r.status() }));
  page.on("pageerror", e => errs.push("pageerror: " + e.message));

  await page.goto(SITE, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(6000);
  const afterLoad = reqs.length;

  // 主动触发一次生成，把 LLM 调用的域名也逼出来
  let genNote = "";
  try {
    await page.locator("#context").fill("对方：明天有空吗？\n我：应该可以");
    await page.locator("#intents .chip").first().click();
    await page.locator("#go").click();
    await page.waitForTimeout(25000);
    const n = await page.locator("#results .cand").count();
    genNote = "生成候选条数=" + n;
  } catch (e) { genNote = "触发生成失败: " + e.message; }

  const hostOf = u => { try { return new URL(u).host; } catch { return "(inline/data)"; } };
  const group = (list) => {
    const m = {};
    for (const it of list) { const h = hostOf(it.url); m[h] = m[h] || []; m[h].push(it); }
    return m;
  };

  const lines = [];
  lines.push("线上站点: " + SITE);
  lines.push("总请求数: " + reqs.length + "（首屏加载后 " + afterLoad + "）");
  lines.push(genNote);
  lines.push("");
  lines.push("===== 按域名分组（全部请求） =====");
  for (const [h, list] of Object.entries(group(reqs)).sort((a, b) => b[1].length - a[1].length)) {
    lines.push("");
    lines.push("## " + h + "   x" + list.length);
    const uniq = [...new Set(list.map(x => x.method + " " + x.url.split("?")[0]))];
    uniq.slice(0, 12).forEach(u => lines.push("   " + u));
    if (uniq.length > 12) lines.push("   ... 另有 " + (uniq.length - 12) + " 个");
  }
  lines.push("");
  lines.push("===== 云服务 API 请求头（用于跨域可行性判断） =====");
  const SECRET_RE = /^(wbpk_|Bearer\s+wbpk_)/;
  const mask = v => (typeof v === "string" && SECRET_RE.test(v.trim()))
    ? v.trim().slice(0, 14) + "…" + v.trim().slice(-4)
    : v;
  if (!cloudReqs.length) lines.push("  （未捕获到 /.cloud/ 请求）");
  for (const c of cloudReqs) {
    lines.push("");
    lines.push(c.method + " " + c.url);
    const hdrs = Object.entries(c.headers).filter(([k]) =>
      /authorization|api-key|apikey|x-|content-type|origin|referer|accept/i.test(k));
    for (const [k, v] of hdrs) {
      const val = String(v);
      lines.push("   " + k + ": " + (k.toLowerCase().includes("authorization") || k.toLowerCase().includes("key")
        ? val.replace(/(wbpk_[A-Za-z0-9]{6})[A-Za-z0-9_]+/g, "$1…(已截断)") : val));
    }
    if (c.postData) lines.push("   [body] " + c.postData.slice(0, 300) + (c.postData.length > 300 ? " …" : ""));
  }

  lines.push("");
  lines.push("===== 非 200 响应 =====");
  const bad = resps.filter(r => r.status >= 400);
  if (!bad.length) lines.push("  （无）");
  bad.forEach(r => lines.push("  " + r.status + "  " + r.url));
  lines.push("");
  lines.push("===== 页面异常 =====");
  if (!errs.length) lines.push("  （无）"); else errs.forEach(e => lines.push("  " + e));

  const isAppHost = h => /\.app\.workbuddy\.host$/.test(h);
  const apiHosts = [...new Set(reqs.map(r => hostOf(r.url)).filter(h => !isAppHost(h) && /workbuddy|tencent|qq\.com/.test(h)))];
  lines.push("");
  lines.push("===== 结论线索 =====");
  lines.push("非 app 域名但属平台侧: " + (apiHosts.length ? apiHosts.join(", ") : "（无）"));
  lines.push("是否存在打向 *.app.workbuddy.host 的 XHR/fetch: "
    + (reqs.some(r => isAppHost(hostOf(r.url)) && (r.type === "xhr" || r.type === "fetch")) ? "是" : "否"));

  fs.writeFileSync(OUT, lines.join("\n") + "\n", "utf8");
  await browser.close();
  console.log("report written:", OUT);
})().catch(e => { console.error("ERR", e && e.message); process.exit(1); });

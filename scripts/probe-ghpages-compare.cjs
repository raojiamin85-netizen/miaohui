const pw = require("playwright");
const fs = require("fs");
const path = require("path");

const OUT = path.join(__dirname, "..", "docs", "evidence");
fs.mkdirSync(OUT, { recursive: true });

const CASES = [
  { name: "A-ghpages-example", url: "https://kewenchang527-maker.github.io/", label: "第三方 GitHub Pages 站" },
  { name: "B-repo-page", url: "https://github.com/raojiamin85-netizen/miaohui", label: "你的仓库地址" },
  { name: "C-your-pages-404", url: "https://raojiamin85-netizen.github.io/miaohui/", label: "你的 Pages 地址（未开通）" },
];

(async () => {
  const browser = await pw.chromium.launch({ channel: "msedge", headless: true });
  const report = [];

  for (const c of CASES) {
    const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 } });
    const page = await ctx.newPage();
    const reqs = [];
    page.on("request", (r) => reqs.push(r.url()));
    let title = "(未能读取)";
    let bodyText = "";
    let status = 0;
    try {
      const resp = await page.goto(c.url, { waitUntil: "domcontentloaded", timeout: 60000 });
      status = resp ? resp.status() : 0;
      await page.waitForTimeout(3500);
      title = await page.title();
      bodyText = (await page.innerText("body").catch(() => "")).replace(/\s+/g, " ").slice(0, 500);
    } catch (e) {
      title = "ERR " + e.message.split("\n")[0];
    }
    await page.screenshot({ path: path.join(OUT, `${c.name}.png`) }).catch(() => {});

    const hosts = [...new Set(reqs.map((u) => { try { return new URL(u).host; } catch { return "?"; } }))];
    const apiLike = reqs.filter((u) => /\.cloud\/|supabase|firebase|\/api\/|amazonaws|cloudfunctions|generativelanguage|openai|bigmodel/i.test(u));

    report.push(
      [
        `========== ${c.label} ==========`,
        `URL        : ${c.url}`,
        `HTTP       : ${status}`,
        `页面标题   : ${title}`,
        `请求主机数 : ${hosts.length}  ->  ${hosts.slice(0, 8).join(" | ")}`,
        `后端/接口调用 : ${apiLike.length === 0 ? "0 处（纯静态）" : apiLike.length + " 处  ->  " + apiLike.slice(0, 5).join(" | ")}`,
        `正文开头   : ${bodyText.slice(0, 260)}`,
        "",
      ].join("\n")
    );
    await ctx.close();
    console.log(`done ${c.name}`);
  }

  await browser.close();
  const txt = report.join("\n");
  fs.writeFileSync(path.join(OUT, "ghpages-compare-report.txt"), txt, "utf8");
  console.log("\n" + txt);
})();

const https = require("https");

const HOST = "miaohui-reply.app.workbuddy.host";
const PATH_ = "/.cloud/llm/models";
const KEY = "wbpk_x1qdLtksbvbrVnqBXv7lmb_99s72umIDfBnDyDSCNCN5ml3yisx08TI";

const CASES = [
  { label: "平台自己的域名（白名单内）", o: "https://miaohui-reply.app.workbuddy.host" },
  { label: "本地 http://127.0.0.1:8899", o: "http://127.0.0.1:8899" },
  { label: "本地 http://localhost:8899", o: "http://localhost:8899" },
  { label: "file:// 打开（Origin=null）", o: "null" },
  { label: "你的 GitHub Pages", o: "https://raojiamin85-netizen.github.io" },
  { label: "例子的 GitHub Pages", o: "https://kewenchang527-maker.github.io" },
  { label: "Netlify", o: "https://miaohui-test.netlify.app" },
  { label: "（完全不带 Origin）", o: null },
];

function probe(origin) {
  return new Promise((resolve) => {
    const headers = {
      "x-wb-webapp-access-key": KEY,
      Accept: "application/json",
      "User-Agent": "miaohui-probe",
    };
    if (origin) headers.Origin = origin;
    const req = https.request(
      { hostname: HOST, path: PATH_, method: "GET", headers, timeout: 25000 },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            acao: res.headers["access-control-allow-origin"],
            vary: res.headers["vary"],
            len: Buffer.byteLength(body),
            body,
          })
        );
      }
    );
    req.on("error", (e) => resolve({ error: e.message }));
    req.on("timeout", () => { req.destroy(); resolve({ error: "timeout 25s" }); });
    req.end();
  });
}

(async () => {
  const lines = [];
  for (const c of CASES) {
    const r = await probe(c.o);
    if (r.error) {
      lines.push(`${c.label.padEnd(36)} -> ERROR  ${r.error}`);
      continue;
    }
    lines.push(
      `${c.label.padEnd(36)} -> HTTP ${r.status}  ACAO=${String(r.acao || "(无该头)").padEnd(50)}${r.vary ? "  Vary=" + r.vary : ""}  body=${r.len}B`
    );
  }
  const out = lines.join("\n");
  console.log(out);
})();

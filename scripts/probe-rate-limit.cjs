// 探测平台版 LLM 网关的限流/配额行为
// 结论输出：① 模型列表里的「积分倍率」② 响应头里有无配额信息 ③ 并发突发下的状态码与首字节时延
const https = require("https");

const HOST = "miaohui-reply.app.workbuddy.host";
const KEY = "wbpk_x1qdLtksbvbrVnqBXv7lmb_99s72umIDfBnDyDSCNCN5ml3yisx08TI";
const ORIGIN = "https://" + HOST;

function req(path, body, { timeout = 30000, abortOnFirstChunk = false } = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const payload = body ? JSON.stringify(body) : null;
    const headers = { "x-wb-webapp-access-key": KEY, Origin: ORIGIN, Accept: "application/json", "User-Agent": "miaohui-ratelimit-probe" };
    if (payload) { headers["Content-Type"] = "application/json"; headers["Content-Length"] = Buffer.byteLength(payload); }
    let done = false;
    const finish = (s, extra) => {
      if (done) return; done = true;
      resolve(Object.assign({ status: (s && s.statusCode) || 0, headers: (s && s.headers) || {}, ttfb: Date.now() - t0, total: Date.now() - t0 }, extra));
    };
    const r = https.request({ hostname: HOST, path, method: body ? "POST" : "GET", headers }, (s) => {
      let ttfb = null, bytes = 0; const chunks = [];
      const grab = () => Buffer.concat(chunks).toString("utf8");
      s.on("data", (c) => {
        if (ttfb === null) ttfb = Date.now() - t0;
        bytes += c.length; if (!abortOnFirstChunk || bytes < 3000) chunks.push(c);
        if (abortOnFirstChunk) { const out = grab(); s.destroy(); finish(s, { ttfb, body: out }); }
      });
      s.on("end", () => finish(s, { ttfb: ttfb === null ? Date.now() - t0 : ttfb, body: grab() }));
      s.on("close", () => finish(s, { ttfb: ttfb === null ? Date.now() - t0 : ttfb, body: grab() }));
    });
    r.on("error", (e) => finish(null, { body: "REQ_ERR " + e.message }));
    r.setTimeout(timeout, () => { r.destroy(); finish(null, { ttfb: timeout, body: "TIMEOUT" }); });
    if (payload) r.write(payload);
    r.end();
  });
}

const hdr = (h) => Object.entries(h || {}).filter(([k]) => /ratelimit|quota|credit|limit|remain|retry|x-wb/i.test(k)).map(([k, v]) => k + ": " + v);

(async () => {
  console.log("目标 " + HOST + " ｜ Origin " + ORIGIN);

  console.log("\n########## 1. 模型列表：是否按「积分」计量 ##########");
  const ms = await req("/.cloud/llm/models");
  const models = JSON.parse(ms.body);
  console.log("模型数:", models.length, "｜ HTTP", ms.status, "｜ TTFB", ms.ttfb + "ms");
  const def = models.find((m) => m.isDefault) || models[0];
  console.log("默认模型:", def.id, "｜ 描述:", def.descriptionZh);
  console.log("带积分倍率的模型（前 8）:");
  models.filter((m) => m.credits).slice(0, 8).forEach((m) => console.log("   " + m.id.padEnd(22) + m.credits));

  const modelId = (models.find((m) => m.disabled !== true) || {}).id;
  console.log("应用实际会选的模型（第一个未 disabled）:", modelId);

  console.log("\n########## 2. 单次 chat 调用（基线） ##########");
  const call = () => req("/.cloud/llm/chat/completions", { model: modelId, stream: true, messages: [{ role: "user", content: "回一个字：好" }] }, { abortOnFirstChunk: true });
  const one = await call();
  console.log("HTTP", one.status, "｜ TTFB", one.ttfb + "ms");
  console.log("配额/限流相关响应头:", hdr(one.headers).length ? "\n   " + hdr(one.headers).join("\n   ") : "(无 —— 拿不到剩余额度数字)");
  console.log("首块:", JSON.stringify((one.body || "").slice(0, 200)));

  for (const N of [4, 8, 16]) {
    console.log("\n########## 3. 并发突发 N=" + N + " ##########");
    const t0 = Date.now();
    const res = await Promise.all(Array.from({ length: N }, () => call()));
    const by = {};
    res.forEach((r) => { const k = String(r.status); by[k] = (by[k] || 0) + 1; });
    const t = res.map((r) => r.ttfb).sort((a, b) => a - b);
    console.log("状态分布:", JSON.stringify(by), "｜ 总耗时", (Date.now() - t0) + "ms");
    console.log("TTFB min/中位/max:", t[0] + " / " + t[Math.floor(t.length / 2)] + " / " + t[t.length - 1] + "ms");
    res.filter((r) => r.status !== 200).slice(0, 3).forEach((r) => console.log("   非 200:", r.status, JSON.stringify((r.body || "").slice(0, 200))));
    if (hdr(res[0].headers).length) console.log("   响应头:", hdr(res[0].headers).join(" | "));
  }
  console.log("\n########## 完成 ##########");
})();

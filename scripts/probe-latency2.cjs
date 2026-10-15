/**
 * 生成耗时实测 · 第二轮：为「换掉 auto」找证据
 *
 * 第一轮结论：应用选中的是模型列表里第一个未禁用项 = `auto`，
 * 同一 prompt 下 auto 首字 125.3s / 总计 125.6s，而 hy3 26.5s、hy4-preview 57.6s。
 *
 * 本轮要回答三件事：
 *  [A] auto 是不是稳定地慢（重测一次确认不是偶发）
 *  [B] 哪些「支持图片」的候选模型明显更快（文本生成）
 *  [C] 最快的两三个模型做截图识别（图片输入）要多久
 *
 * 单次调用 75s 上限，超时记为 TIMEOUT 而不是一直等。
 */
const https = require("https");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const HOST = "miaohui-reply.app.workbuddy.host";
const KEY = "wbpk_x1qdLtksbvbrVnqBXv7lmb_99s72umIDfBnDyDSCNCN5ml3yisx08TI";
const CAP_MS = 75000;

function extractPrompt() {
  const src = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const sysM = src.match(/const SYSTEM_PROMPT = \[([\s\S]*?)\]\.join\("\\n"\);/);
  const system = eval("[" + sysM[1] + "]").join("\n");
  const ocrM = src.match(/const OCR_SYSTEM = \[([\s\S]*?)\]\.join\("\\n"\);/);
  const ocrSys = ocrM ? eval("[" + ocrM[1] + "]").join("\n") : "识别聊天截图，逐行输出，带「我：」「对方：」前缀。";
  const ctxM = src.match(/const OCR_CTX = \[([\s\S]*?)\]\.join\("\\n"\);/);
  const ocrCtx = ctxM ? eval("[" + ctxM[1] + "]").join("\n") : "识别截图里的聊天记录，逐行输出。";
  const user = [
    "【聊天上下文】（带「我：」的是用户本人发的，带「对方：」的是对方发的；最后一条是需要回复的消息）",
    "对方：你好",
    "",
    "【回复意图】接住话头：自然接住对方的话，让对话能继续下去；如果对方在夸你，大方接受并简短感谢，不自贬也不恭维回去",
    "",
    "【对方身份】领导（严格按第 8 条把握语气分寸）",
  ].join("\n");
  return { system, user, ocrSys, ocrCtx };
}

function streamCall(modelId, messages, capMs) {
  return new Promise((resolve) => {
    const payload = JSON.stringify({ model: modelId, messages, stream: true, temperature: 0.9 });
    const t0 = Date.now();
    let ttft = null, text = "", chunks = 0, bufs = "", done = false;
    const finish = (extra) => { if (done) return; done = true; clearTimeout(timer); try { r.destroy(); } catch (e) {} resolve(Object.assign({ model: modelId, ttft, total: Date.now() - t0, chars: text.length, chunks, text }, extra)); };
    const timer = setTimeout(() => finish({ capped: true }), capMs);
    const r = https.request(
      { hostname: HOST, path: "/.cloud/llm/chat/completions", method: "POST",
        headers: { Origin: "https://" + HOST, "x-wb-webapp-access-key": KEY, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload), Accept: "text/event-stream", "User-Agent": "probe2" } },
      (s) => {
        if (s.statusCode !== 200) { let e = ""; s.on("data", (c) => (e += c)); s.on("end", () => finish({ ok: false, status: s.statusCode, err: e.slice(0, 200) })); return; }
        s.on("data", (c) => {
          bufs += c.toString("utf8");
          const lines = bufs.split("\n"); bufs = lines.pop();
          for (const ln of lines) {
            const t = ln.trim(); if (!t.startsWith("data:")) continue;
            const data = t.slice(5).trim(); if (data === "[DONE]") continue;
            try { const j = JSON.parse(data); const d = j.choices && j.choices[0] && j.choices[0].delta;
              if (d && d.content) { if (ttft === null) ttft = Date.now() - t0; text += d.content; chunks++; } } catch (e) {}
          }
        });
        s.on("end", () => finish({ ok: true }));
      }
    );
    r.on("error", (e) => finish({ ok: false, err: e.message }));
    r.write(payload); r.end();
  });
}

const fmt = (r) => (r.ok === false ? ("失败 " + (r.err || r.status)) : ((r.capped ? "超时>75s " : "") + "首字 " + r.ttft + "ms  总计 " + r.total + "ms  " + r.chars + " 字"));

(async () => {
  const { system, user, ocrSys, ocrCtx } = extractPrompt();
  const messages = [{ role: "system", content: system }, { role: "user", content: user }];

  console.log("############ A. 文本生成耗时对比（同一 prompt，各 1 次，上限 75s）############\n");
  const models = ["auto", "glm-5.3-flash", "deepseek-v4.1-flash", "step-5-preview", "hy3"];
  const results = [];
  for (const m of models) {
    const t = Date.now();
    const r = await streamCall(m, messages, CAP_MS);
    results.push(r);
    console.log("  " + m.padEnd(22) + fmt(r));
    console.log("      墙钟 " + Math.round((Date.now() - t) / 1000) + "s | " + (r.text || r.err || "").replace(/\s+/g, " ").slice(0, 150));
  }

  // 第二轮：最快的两个再各跑一次，看波动
  const okOnes = results.filter((r) => r.ok).sort((a, b) => a.total - b.total);
  const top = okOnes.slice(0, 2).map((r) => r.model);
  console.log("\n############ B. 最快的两个再各跑一次（看波动）############\n");
  for (const m of top) {
    const r = await streamCall(m, messages, CAP_MS);
    console.log("  " + m.padEnd(22) + fmt(r));
  }

  // 图片识别
  const imgPath = path.join(ROOT, "docs", "evidence", "fake-chat-screenshot.png");
  if (fs.existsSync(imgPath)) {
    const dataUrl = "data:image/png;base64," + fs.readFileSync(imgPath).toString("base64");
    console.log("\n############ C. 截图识别耗时（同一张聊天截图，上限 75s）############\n");
    console.log("  用图: docs/evidence/fake-chat-screenshot.png (" + Math.round(fs.statSync(imgPath).size / 1024) + "KB，base64 后 " + Math.round(dataUrl.length / 1024) + "KB)\n");
    for (const m of [top[0], top[1], "glm-5.3-flash"].filter((v, i, a) => v && a.indexOf(v) === i).slice(0, 3)) {
      const r = await streamCall(m, [
        { role: "system", content: ocrSys },
        { role: "user", content: [{ type: "text", text: ocrCtx }, { type: "image_url", image_url: { url: dataUrl } }] },
      ], CAP_MS);
      console.log("  " + String(m).padEnd(22) + fmt(r));
      console.log("      识别结果: " + (r.text || r.err || "").replace(/\s+/g, " ").slice(0, 160));
    }
  }
  console.log("\n############ 完成 ############");
})();

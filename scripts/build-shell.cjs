/* 换皮不换骨：把视觉层（scripts/shell-v0.18.html）与逻辑层（index.v0.18.logic.html 的内联 JS）
   机械拼接成 index.html，并逐项审计「功能有没有掉」。
   用途：改版可复现 + 上线前自检。跑法见文件末尾。
   注意：index.v0.18.logic.html 是当前逻辑层基线，不要改它；改逻辑要另存新基线并同步这里的 BASE，
   否则审计第 6 项「逻辑层逐字节一致」失去意义。
   历史基线 index.v0.10.backup.html、index.v0.17.logic.html 原样保留（v0.17 是提示词改动的对比基准）。 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SHELL = path.join(__dirname, "shell-v0.18.html");
const VER_TO = "V0.18";     // 本次产出的版本号
const BASE = path.join(ROOT, "index.v0.18.logic.html");
const OUT = path.join(ROOT, "index.html");
const LOG = path.join(__dirname, "build-report.txt");

const shell = fs.readFileSync(SHELL, "utf8");
const old = fs.readFileSync(BASE, "utf8");

// 逻辑层锚点：从云 SDK 的 script 标签开始到文件结束，全部原样保留
const MARK = '<script src="https://cdn.jsdelivr.net/npm/@tencent-ai/workbuddy-cloud-sdk';
const i = old.indexOf(MARK);
if (i < 0) { console.error("FATAL: 找不到逻辑层锚点"); process.exit(1); }
const tail = old.slice(i);

// 版本号只改逻辑层那一处（正则匹配，换版时不用改两处）
const VER_RE = /ver\.textContent = "V[\d.]+"/;
const tailFinal = tail.replace(VER_RE, 'ver.textContent = "' + VER_TO + '"');
const out = (shell.replace(/\s*$/, "\n") + tail).replace(VER_RE, 'ver.textContent = "' + VER_TO + '"');

fs.writeFileSync(OUT, out, "utf8");

// 供「打开的是旧版缓存」自检用：页面运行时 fetch 它做版本对比
fs.writeFileSync(path.join(ROOT, "version.json"), JSON.stringify({ version: VER_TO, builtAt: new Date().toISOString() }, null, 2) + "\n", "utf8");

const rep = [];
const ok = s => rep.push(s);
ok("生成时间：" + new Date().toISOString());
ok("视觉层：" + path.relative(ROOT, SHELL) + "  (" + shell.split("\n").length + " 行)");
ok("逻辑层：" + path.relative(ROOT, BASE) + " 第 " + old.slice(0, i).split("\n").length + " 行起  (" + tail.split("\n").length + " 行)");
ok("产出：" + path.relative(ROOT, OUT) + "  (" + out.split("\n").length + " 行)");
ok("版本号：" + VER_TO + "  " + (out.includes('ver.textContent = "' + VER_TO + '"') ? "OK" : "失败"));
ok("");

// 1) 所有 id 必须原样保留 —— JS 全靠 getElementById 取元素
const uniq = [...new Set([...old.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]))];
const missing = uniq.filter(id => !out.includes('id="' + id + '"'));
ok("[1] id 完整性：" + uniq.length + " 个，缺失 " + missing.length + (missing.length ? " -> " + missing.join(",") : " -> 无"));

// 2) JS 动态创建的 class 必须仍有样式定义
const cls = [".chip", ".cand", ".reply", ".strategy", ".ops", ".copy", ".fb-reason", ".regen", ".clear", ".arm",
  ".status", ".stage", ".track", ".elapsed", ".stage-sub", ".shot", ".badge", ".scan", ".shot-msg", ".spin", ".auth-msg",
  ".acct-user", ".acct-btn", ".cloud-dot", ".arch-form", ".mini", ".arch-chip", ".arch-chip.suggest", ".chip.on",
  ".reveal", ".empty", ".arch-chip .del", ".mi", ".mi-tip", ".ico", ".rule", ".mi-arch", ".hint.first", ".cand + .cand"];
const missCls = cls.filter(c => !out.includes(c));
ok("[2] 动态 class 有样式：" + cls.length + " 个，缺失 " + missCls.length + (missCls.length ? " -> " + missCls.join(",") : " -> 无"));

// 3) 用到的 keyframes 必须都有定义
const used = [...new Set([...out.matchAll(/animation(?:-name)?:\s*([A-Za-z][\w-]*)/g)].map(m => m[1]))].filter(n => n !== "none");
const noDef = used.filter(n => !new RegExp("@keyframes\\s+" + n + "\\b").test(out));
ok("[3] keyframes：" + used.length + " 个被引用，未定义 " + noDef.length + (noDef.length ? " -> " + noDef.join(",") : " -> 无"));

// 4) CSS 变量必须都已声明
const varsUsed = [...new Set([...out.matchAll(/var\((--[\w-]+)\)/g)].map(m => m[1]))];
const varsDecl = [...new Set([...out.matchAll(/(--[\w-]+)\s*:/g)].map(m => m[1]))];
const varsMiss = varsUsed.filter(v => !varsDecl.includes(v));
ok("[4] CSS 变量：" + varsUsed.length + " 个被引用，未声明 " + varsMiss.length + (varsMiss.length ? " -> " + varsMiss.join(",") : " -> 无"));

// 5) 回归护栏：登录态判定不得依赖 session.user.email（该字段不存在，见 v0.10 的 bug）
const banned = ["session.user.email", "session?.user?.email", "user.email ==", "user.email ?"];
const hit = banned.filter(b => out.includes(b));
ok("[5] 登录态回归护栏：" + (hit.length ? "命中禁用写法 -> " + hit.join(",") : "通过"));

// 6) 逻辑层必须逐字节一致（仅允许版本号那一处已声明的替换）
const tailSame = out.slice(out.length - tailFinal.length) === tailFinal;
ok("[6] 逻辑层字节一致性：" + (tailSame ? "完全一致（除版本号）" : "不一致！"));

// 7) 回归护栏：file input 不得用 display:none / hidden 隐藏
//    移动端 WebKit 与各家 WebView 会拒绝为「未渲染」的 file input 唤起选择器，
//    症状是「点了没反应」（v0.13 修的正是这个）。这里必须走 .shot-file 覆盖层方案。
const fileTags = [...out.matchAll(/<input[^>]*type="file"[^>]*>/g)].map(m => m[0]);
const badHidden = fileTags.filter(t => /\bhidden\b/.test(t));
ok("[7] file input 移动端护栏：" + fileTags.length + " 个 file input，display:none 写法命中 " + badHidden.length
  + (badHidden.length ? " -> " + badHidden.join(" | ") : " -> 通过（均用 .shot-file 覆盖层）"));
const overlayMissing = fileTags.filter(t => !/class="shot-file"/.test(t));
ok("[7b] file input 覆盖层 class：" + (overlayMissing.length ? "缺失 -> " + overlayMissing.join(" | ") : "全部带 .shot-file"));

// 8) PWA 护栏（v0.14 新增）：manifest + apple-touch-icon + 可独立运行的 meta 必须在
//    缺了它们，iOS「添加到主屏」会退化成普通书签，地址栏照样露出来。
const pwaNeed = [
  'rel="manifest"',
  'rel="apple-touch-icon"',
  'name="apple-mobile-web-app-capable"',
  'name="apple-mobile-web-app-title"',
];
const pwaHit = pwaNeed.filter(s => !out.includes(s));
ok("[8] PWA 标签：" + pwaNeed.length + " 项，缺失 " + pwaHit.length + (pwaHit.length ? " -> " + pwaHit.join(" | ") : " -> 全部就位"));
const manifestOk = fs.existsSync(path.join(ROOT, "manifest.webmanifest"));
const iconOk = [180, 192, 512].every(n => fs.existsSync(path.join(ROOT, "pwa", "icons", `icon-${n}.png`)));
ok("[8b] PWA 资源：manifest.webmanifest " + (manifestOk ? "存在" : "缺失")
  + "，icon-180/192/512 " + (iconOk ? "存在" : "缺失"));

// 9) 模型候选链护栏（v0.15 新增）
//    起因：线上用的 `models.find(m => m.disabled !== true)` 实际选中平台默认的 auto，
//    实测首字 125s（另一次 >75s 无输出），而 flash 档 0.9~7.6s。这一项防止改回去。
const prefM = out.match(/const PREFERRED_MODELS = \[([^\]]*)\]/);
const prefList = prefM ? prefM[1].split(",").map(s => s.trim().replace(/^"|"$/g, "")).filter(Boolean) : [];
const badPick = out.includes("models.find(m => m.disabled !== true)");
const badFirst = ["auto", "default"].includes(prefList[0]);
const hasWatchdog = out.includes("FIRST_TOKEN_MS") && out.includes("firstTokenTimeout");
ok("[9] 模型候选链：候选 " + prefList.length + " 个（首位 " + (prefList[0] || "无") + "）"
  + "，回退到「第一个未禁用项」的写法 " + (badPick ? "仍在 -> 不合格" : "已移除")
  + "，首字看门狗 " + (hasWatchdog ? "在" : "缺失")
  + "，首位是慢模型 " + (badFirst ? "是 -> 不合格" : "否"));

// 10) 旧版本缓存自检（v0.15 新增）：页面 fetch version.json 比对，落后就提示刷新。
//     平台不给静态资源发 Cache-Control / ETag，用户手机上很容易停在旧版（真实踩到过）。
let verFile = null;
try { verFile = JSON.parse(fs.readFileSync(path.join(ROOT, "version.json"), "utf8")); } catch (e) {}
const verFileOk = !!(verFile && verFile.version === VER_TO);
const hasGuard = out.includes("version.json") && out.includes("showUpdateBar");
ok("[10] 版本自检：version.json " + (verFileOk ? "= " + VER_TO : "缺失或与 " + VER_TO + " 不一致")
  + "，页面内自检逻辑 " + (hasGuard ? "已接入" : "缺失"));

// 11) 埋点隐私护栏（v0.16 新增）
//     匿名统计的底线是「只记发生了什么，不记说了什么」。一旦有人把聊天原文或风格样本
//     塞进 track(...)，这一项会当场拦下——隐私承诺不能靠自觉。
const trackLines = out.split("\n").filter(l => /track\(/.test(l) && !/^\s*function\s/.test(l));
const leakLines = out.split("\n").filter(l => /track\(/.test(l)
  && /(\$\("context"\)|\$\("style"\)|context\.value|style\.value|\.reply)/.test(l));
const hasEvents = out.includes('from("events")');
ok("[11] 埋点隐私：track 调用 " + trackLines.length + " 处"
  + "，写入 events 表 " + (hasEvents ? "已接入" : "缺失 -> 不合格")
  + "，把聊天原文/风格样本/回复内容带进埋点 " + (leakLines.length ? leakLines.length + " 处 -> 不合格" : "0 处"));

// 12) 版面约定（v0.17 重写）：两条，都来自「页面有点杂乱、分不清该点哪里」的真实反馈。
//     a. 波浪线只在 01 / 02 / 03 / 04 四个编号块的末尾各一条，别处不再出现（候选之间用 1px 细线）；
//     b. 长说明一律收进提示图标的气泡（.mi-tip），不许再摊在页面上。
//     以后谁把长说明摊回去、或把波浪线加回每张卡片顶上，这一项会当场拦住。
const ruleCount = (out.match(/<div class="rule"><\/div>/g) || []).length;
const miBtn = (out.split('class="mi"').length - 1) + (out.split('class="mi mi-arch"').length - 1);
const miTip = out.split('class="mi-tip"').length - 1;
const miUse = out.split('href="#tipIco"').length - 1;
const icoDef = out.includes('<g id="tipIco">');
// 图标必须是「小人 + 叹号」那一版：叹号那条竖笔在、问号的弯钩不在（防止有人换回问号版）
const icoBang = out.includes("M19.2 5.4 C19.05 8.1 19.05 10.8 19.2 13.5")
  && !out.includes("C15.4 6.8 17.5 4.9 19.9 4.9");
// 被藏起来的三句话，只允许以气泡的形式存在
const hiddenText = [
  "只贴需要的几条即可 · 内容与截图都仅用于本次生成和识别，不留存",
  "还没有档案。贴几条你自己发的话，或用截图提取，然后点「存为档案」。",
  "默认只存在你自己的浏览器里；登录后可同步到云端，换设备也能用。"
];
const notInTip = hiddenText.filter(s => !out.includes('<span class="mi-tip">' + s + "</span>"));
const hintText = [...out.matchAll(/<div class="hint[^"]*">([\s\S]*?)<\/div>/g)]
  .map(m => m[1].replace(/<button[\s\S]*?<\/button>/g, "").replace(/<[^>]+>/g, ""));
const leakedText = hiddenText.filter(s => hintText.some(t => t.includes(s)));
ok("[12] 版面约定：编号块末尾波浪线 " + ruleCount + " 条（期望 4 -> 01/02/03/04 各一条）"
  + "，提示图标 " + miBtn + " 个 / 气泡 " + miTip + " 个 / 引用图标 " + miUse + " 处"
  + "，图标定义 " + (icoDef ? "在" : "缺失 -> 不合格")
  + "，是叹号版 " + (icoBang ? "是" : "否 -> 不合格")
  + "，该藏的话仍摊在页面上 " + (notInTip.length + leakedText.length) + " 处");

fs.writeFileSync(LOG, rep.join("\n") + "\n", "utf8");

const fail = missing.length || missCls.length || noDef.length || varsMiss.length || hit.length || !tailSame
  || badHidden.length || overlayMissing.length || pwaHit.length || !manifestOk || !iconOk
  || leakLines.length || !hasEvents || ruleCount !== 4 || miBtn < 3 || miBtn !== miTip
  || miUse !== miBtn || !icoDef || !icoBang || notInTip.length || leakedText.length;
console.log(rep.join("\n"));
console.log("\n结果：" + (fail ? "有项目不通过，见上方标记" : "全部通过"));
process.exit(fail ? 1 : 0);

// 跑法：NODE_PATH=<node workspace>/node_modules node scripts/build-shell.cjs

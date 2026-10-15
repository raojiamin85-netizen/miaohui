/* 换皮不换骨：把视觉层（scripts/shell-v0.13.html）与逻辑层（v0.10 备份里的内联 JS）
   机械拼接成 index.html，并逐项审计「功能有没有掉」。
   用途：改版可复现 + 上线前自检。跑法见文件末尾。
   注意：index.v0.10.backup.html 是逻辑层基线，不要改它，否则审计失去意义。 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SHELL = path.join(__dirname, "shell-v0.14.html");
const VER_FROM = "V0.10";   // 逻辑层基线（index.v0.10.backup.html）里的版本号
const VER_TO = "V0.14";     // 本次产出的版本号
const BASE = path.join(ROOT, "index.v0.10.backup.html");
const OUT = path.join(ROOT, "index.html");
const LOG = path.join(__dirname, "build-report.txt");

const shell = fs.readFileSync(SHELL, "utf8");
const old = fs.readFileSync(BASE, "utf8");

// 逻辑层锚点：从云 SDK 的 script 标签开始到文件结束，全部原样保留
const MARK = '<script src="https://cdn.jsdelivr.net/npm/@tencent-ai/workbuddy-cloud-sdk';
const i = old.indexOf(MARK);
if (i < 0) { console.error("FATAL: 找不到逻辑层锚点"); process.exit(1); }
const tail = old.slice(i);

let out = shell.replace(/\s*$/, "\n") + tail;

// 版本号：只在逻辑层这一处替换，长度相同，便于第 6 项字节一致性核对
const tailFinal = tail.replace('ver.textContent = "' + VER_FROM + '"', 'ver.textContent = "' + VER_TO + '"');
out = out.replace('ver.textContent = "' + VER_FROM + '"', 'ver.textContent = "' + VER_TO + '"');

fs.writeFileSync(OUT, out, "utf8");

const rep = [];
const ok = s => rep.push(s);
ok("生成时间：" + new Date().toISOString());
ok("视觉层：" + path.relative(ROOT, SHELL) + "  (" + shell.split("\n").length + " 行)");
ok("逻辑层：" + path.relative(ROOT, BASE) + " 第 " + old.slice(0, i).split("\n").length + " 行起  (" + tail.split("\n").length + " 行)");
ok("产出：" + path.relative(ROOT, OUT) + "  (" + out.split("\n").length + " 行)");
ok("版本号：" + VER_FROM + " -> " + VER_TO + "  " + (out.includes('ver.textContent = "' + VER_TO + '"') ? "OK" : "失败"));
ok("");

// 1) 所有 id 必须原样保留 —— JS 全靠 getElementById 取元素
const uniq = [...new Set([...old.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]))];
const missing = uniq.filter(id => !out.includes('id="' + id + '"'));
ok("[1] id 完整性：" + uniq.length + " 个，缺失 " + missing.length + (missing.length ? " -> " + missing.join(",") : " -> 无"));

// 2) JS 动态创建的 class 必须仍有样式定义
const cls = [".chip", ".cand", ".reply", ".strategy", ".ops", ".copy", ".fb-reason", ".regen", ".clear", ".arm",
  ".status", ".stage", ".track", ".elapsed", ".shot", ".badge", ".scan", ".shot-msg", ".spin", ".auth-msg",
  ".acct-user", ".acct-btn", ".cloud-dot", ".arch-form", ".mini", ".arch-chip", ".arch-chip.suggest", ".chip.on",
  ".reveal", ".empty", ".arch-chip .del", ".cand::before", ".regen::before"];
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

fs.writeFileSync(LOG, rep.join("\n") + "\n", "utf8");

const fail = missing.length || missCls.length || noDef.length || varsMiss.length || hit.length || !tailSame
  || badHidden.length || overlayMissing.length || pwaHit.length || !manifestOk || !iconOk;
console.log(rep.join("\n"));
console.log("\n结果：" + (fail ? "有项目不通过，见上方标记" : "全部通过"));
process.exit(fail ? 1 : 0);

// 跑法：NODE_PATH=<node workspace>/node_modules node scripts/build-shell.cjs

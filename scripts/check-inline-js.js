// 从 index.html 抽出内联脚本做语法检查
const fs = require("fs");
const path = require("path");
const src = fs.readFileSync(path.resolve(__dirname, "..", "index.html"), "utf8");
const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
const blocks = [];
let m;
while ((m = re.exec(src)) !== null) blocks.push(m[1]);
const code = blocks.join("\n;\n");
console.log("inline blocks:", blocks.length, "chars:", code.length);
try {
  new Function(code);
  console.log("SYNTAX OK");
} catch (e) {
  console.log("SYNTAX ERROR:", e.message);
}
// 关键元素存在性检查
const ids = ["acct","authMask","authTabs","panePwd","paneOtp","paneReg","paneReset","pwdEmail","pwdPass","pwdGo","otpEmail","otpCode","otpSend","otpGo","regEmail","regCode","regSend","regPass","regGo","rstEmail","rstCode","rstSend","rstPass","rstGo","forgotLink","backLogin","authClose","authMsg","archSyncHint"];
const missing = ids.filter(id => !src.includes('id="' + id + '"'));
console.log("missing ids:", missing.length ? missing.join(",") : "none");

// 回归护栏：SDK 的 session.user 没有 email 字段，拿它判断登录态会让"已登录"永远渲染成未登录
// （v0.9 的真实 bug，见 index.html renderAcct 上方注释）。登录态必须只看 session 是否存在。
const banned = [
  ["session.user.email", "登录判定不得依赖 session.user.email（该字段不存在）"],
  ["session?.user?.email", "登录判定不得依赖 session.user.email（该字段不存在）"]
];
banned.forEach(([needle, why]) => {
  if (src.includes(needle)) console.log("REGRESSION:", why);
});
console.log("regression check done");

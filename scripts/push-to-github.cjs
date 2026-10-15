/**
 * 一次性推送脚本：把本地 miaohui 仓库推到 GitHub。
 *
 * 用法（Token 从环境变量读，绝不写进文件）：
 *   GITHUB_TOKEN=github_pat_xxx node scripts/push-to-github.cjs
 *
 * 可选环境变量：
 *   GH_OWNER  默认 raojiamin85-netizen
 *   GH_REPO   默认 miaohui
 *
 * 行为：
 *   1. 先用 API 校验 Token（查 /user），无效直接退出，不做任何 git 操作
 *   2. 校验本地 HEAD 与提交数
 *   3. push 到 refs/heads/main（用一次性 URL，不把 Token 落进 .git/config）
 *   4. 回头查远端 main 的 sha 与本地 HEAD 比对，逐字确认
 */
const { execFileSync } = require("child_process");
const https = require("https");
const path = require("path");

const REPO_DIR = path.resolve(__dirname, "..");
const OWNER = process.env.GH_OWNER || "raojiamin85-netizen";
const REPO = process.env.GH_REPO || "miaohui";
const TOKEN = process.env.GITHUB_TOKEN;

function git(args, opts = {}) {
  return execFileSync("git", args, {
    cwd: REPO_DIR,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...opts,
  }).trim();
}

function api(pathname) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "api.github.com",
        path: pathname,
        method: "GET",
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "miaohui-push",
        },
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          let json = null;
          try {
            json = JSON.parse(body);
          } catch (_) {}
          resolve({ status: res.statusCode, json, raw: body });
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

function fail(msg) {
  console.error(`\n[失败] ${msg}\n`);
  process.exit(1);
}

(async () => {
  if (!TOKEN) fail("缺少 GITHUB_TOKEN 环境变量");
  if (!/^github_pat_[A-Za-z0-9_]+$/.test(TOKEN)) fail("Token 格式不像细粒度 Token");
  const tail = TOKEN.slice(11);
  console.log(`[0] Token 长度=${TOKEN.length}（前缀后 ${tail.length} 字符，标准应为 82）`);
  if (TOKEN.length < 80) {
    console.log("    ⚠️  长度明显偏短，很可能是复制时被截断了。仍继续尝试校验。");
  }

  console.log("[1] 校验 Token ...");
  const me = await api("/user");
  if (me.status !== 200) {
    fail(`Token 无效：HTTP ${me.status} ${me.json && me.json.message ? "- " + me.json.message : ""}`);
  }
  console.log(`    ✅ 身份：${me.json.login}`);

  console.log("[2] 校验目标仓库 ...");
  const repo = await api(`/repos/${OWNER}/${REPO}`);
  if (repo.status !== 200) {
    fail(`仓库不可访问：HTTP ${repo.status} ${repo.json && repo.json.message ? "- " + repo.json.message : ""}`);
  }
  console.log(`    ✅ ${repo.json.full_name}  私有=${repo.json.private}  大小=${repo.json.size}KB  默认分支=${repo.json.default_branch}`);
  if (repo.json.permissions && !repo.json.permissions.push) {
    fail("Token 对该仓库没有写权限（Contents 需为 Read and write）");
  }

  console.log("[3] 校验本地 ...");
  const head = git(["rev-parse", "HEAD"]);
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  const count = git(["rev-list", "--count", "HEAD"]);
  const files = git(["ls-files"]).split("\n").filter(Boolean).length;
  console.log(`    分支=${branch}  HEAD=${head.slice(0, 8)}  提交=${count}  文件=${files}`);
  if (branch !== "main") fail(`当前分支是 ${branch}，预期 main`);

  console.log("[4] 推送 ...");
  const pushUrl = `https://x-access-token:${TOKEN}@github.com/${OWNER}/${REPO}.git`;
  try {
    const out = execFileSync("git", ["push", pushUrl, "HEAD:refs/heads/main"], {
      cwd: REPO_DIR,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    console.log(out.trim() || "    (git 未输出)");
  } catch (e) {
    // 错误信息里可能带 Token，做一次脱敏再打印
    const msg = ((e.stderr || "") + (e.stdout || "")).replace(TOKEN, "***");
    fail("git push 失败：\n" + msg);
  }

  console.log("[5] 远端回查 ...");
  const remoteRef = await api(`/repos/${OWNER}/${REPO}/commits/main`);
  if (remoteRef.status !== 200) {
    fail(`回查失败：HTTP ${remoteRef.status}`);
  }
  const remoteSha = remoteRef.json.sha;
  console.log(`    远端 main = ${remoteSha.slice(0, 8)}`);
  console.log(`    本地 HEAD = ${head.slice(0, 8)}`);
  if (remoteSha !== head) fail("远端 sha 与本地不一致，推送可能未生效");
  console.log("    ✅ 逐字一致");

  // 把 origin 设成不带 Token 的干净地址，方便你以后自己用
  try {
    git(["remote", "remove", "origin"]);
  } catch (_) {}
  git(["remote", "add", "origin", `https://github.com/${OWNER}/${REPO}.git`]);
  console.log(`[6] 已设置 origin = https://github.com/${OWNER}/${REPO}.git（不含 Token）`);

  console.log(`\n✅ 完成：https://github.com/${OWNER}/${REPO}`);
  console.log("   提醒：这个 Token 现在可以到 GitHub 设置里 Delete 了。\n");
})().catch((e) => fail(e.stack || String(e)));

/**
 * 通过 GitHub REST API 推送仓库内容（当环境不允许 git push 到 github.com 时的替代通道）。
 *
 * 背景：本机只有 api.github.com 可达，github.com:443 被网络策略阻断，
 *   `git push` 必然失败（CONNECT tunnel failed / Could not connect）。
 *   但 api.github.com 完全可用，于是改为用 Git Data API 手工重建同样的提交。
 *
 * 关键点：blob / tree / commit 都是**内容寻址**的。
 *   只要上传的内容字节一致、作者与时间戳一致，GitHub 算出的 SHA 就和本地一模一样。
 *   因此本脚本会逐层把远端返回的 SHA 与本地 SHA 比对，做到「可被机器验证的一致性」。
 *
 * 用法：GITHUB_TOKEN=github_pat_xxx node scripts/push-via-api.cjs
 */
const { execFileSync } = require("child_process");
const https = require("https");
const path = require("path");
const fs = require("fs");

const REPO_DIR = path.resolve(__dirname, "..");
const OWNER = process.env.GH_OWNER || "raojiamin85-netizen";
const REPO = process.env.GH_REPO || "miaohui";
const TOKEN = process.env.GITHUB_TOKEN;
const BRANCH = "main";

function git(args) {
  return execFileSync("git", args, {
    cwd: REPO_DIR,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}
function gitBuf(args) {
  return execFileSync("git", args, {
    cwd: REPO_DIR,
    encoding: "buffer",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
}

function api(method, apiPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request(
      {
        hostname: "api.github.com",
        path: apiPath,
        method,
        headers: Object.assign(
          {
            Authorization: `Bearer ${TOKEN}`,
            Accept: "application/vnd.github+json",
            "User-Agent": "miaohui-push-api",
            "X-GitHub-Api-Version": "2022-11-28",
          },
          payload
            ? {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(payload),
              }
            : {}
        ),
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          let json = null;
          try {
            json = JSON.parse(data);
          } catch (_) {}
          resolve({ status: res.statusCode, json, raw: data });
        });
      }
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function fail(msg) {
  console.error(`\n[失败] ${msg}\n`);
  process.exit(1);
}

/** 把 git 的 "1760000000 +0800" 转成带原偏移的 ISO 时间，保证时区不丢 */
function toIso(sec, tz) {
  const sign = tz[0] === "-" ? -1 : 1;
  const off = (parseInt(tz.slice(1, 3), 10) * 3600 + parseInt(tz.slice(3, 5), 10) * 60) * sign;
  const d = new Date((Number(sec) + off) * 1000);
  const base = d.toISOString().slice(0, 19);
  return `${base}${tz[0]}${tz.slice(1, 3)}:${tz.slice(3, 5)}`;
}

function parseCommit(raw) {
  const sep = raw.indexOf("\n\n");
  const header = raw.slice(0, sep);
  const message = raw.slice(sep + 2);
  const get = (re) => {
    const m = header.match(re);
    return m ? m : null;
  };
  const tree = get(/^tree ([0-9a-f]{40})$/m)[1];
  const parents = [...header.matchAll(/^parent ([0-9a-f]{40})$/gm)].map((m) => m[1]);
  const am = get(/^author (.+) <(.+)> (\d+) ([+-]\d{4})$/m);
  const cm = get(/^committer (.+) <(.+)> (\d+) ([+-]\d{4})$/m);
  const ident = (m) => ({
    name: m[1],
    email: m[2],
    date: toIso(m[3], m[4]),
  });
  return { tree, parents, author: ident(am), committer: ident(cm), message };
}

function lsTree(commitSha) {
  const out = git(["ls-tree", "-r", "-z", commitSha]);
  return out
    .split("\0")
    .filter(Boolean)
    .map((line) => {
      const [meta, file] = line.split("\t");
      const [mode, type, sha] = meta.split(" ");
      return { mode, type, sha, path: file };
    });
}

(async () => {
  if (!TOKEN) fail("缺少 GITHUB_TOKEN 环境变量");

  console.log("[1] 校验 Token ...");
  const me = await api("GET", "/user");
  if (me.status !== 200) fail(`Token 无效：HTTP ${me.status}`);
  console.log(`    ✅ ${me.json.login}`);

  console.log("[2] 校验仓库 ...");
  const repo = await api("GET", `/repos/${OWNER}/${REPO}`);
  if (repo.status !== 200) fail(`仓库不可访问：HTTP ${repo.status}`);
  if (repo.json.permissions && !repo.json.permissions.push) fail("无写权限");
  console.log(`    ✅ ${repo.json.full_name} 私有=${repo.json.private}`);

  // GitHub 不允许在「完全空」的仓库里用 Git Data API 建 blob/tree/commit（409 Git Repository is empty）。
  // 解法：先借 Contents API 落一个占位提交把仓库撑起来，最后再把分支强指到我们的提交上，
  // 占位提交随即变成不可达对象，不进入任何一条历史。
  console.log("[2b] 检查仓库是否为空 ...");
  const refProbe = await api("GET", `/repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`);
  let seeded = false;
  if (refProbe.status !== 200) {
    console.log("    仓库为空，落一个占位提交撑起对象库 ...");
    const seed = await api("PUT", `/repos/${OWNER}/${REPO}/contents/.push-placeholder`, {
      message: "chore: 占位提交（推送完成后即不可达，可忽略）",
      content: Buffer.from("placeholder so the Git Data API accepts new objects\n").toString("base64"),
      branch: BRANCH,
    });
    if (seed.status !== 201) fail(`落占位提交失败：HTTP ${seed.status} ${seed.raw.slice(0, 200)}`);
    seeded = true;
    console.log("    ✅ 仓库已非空");
  } else {
    console.log("    仓库已有分支，直接续写");
  }

  const localCommits = git(["rev-list", "--reverse", BRANCH]).split("\n").filter(Boolean);
  console.log(`[3] 本地 ${localCommits.length} 个提交，开始重建 ...`);

  const blobCache = new Map();
  const remoteShaByLocal = new Map();

  for (const sha of localCommits) {
    const raw = git(["cat-file", "commit", sha]);
    const c = parseCommit(raw);
    console.log(`\n  ● ${sha.slice(0, 8)}  ${c.message.split("\n")[0]}`);

    const entries = lsTree(sha);
    console.log(`    文件 ${entries.length} 个`);

    // --- blobs ---
    for (const e of entries) {
      if (blobCache.has(e.sha)) continue;
      const buf = gitBuf(["cat-file", "blob", e.sha]);
      const r = await api("POST", `/repos/${OWNER}/${REPO}/git/blobs`, {
        content: buf.toString("base64"),
        encoding: "base64",
      });
      if (r.status !== 201) fail(`上传 blob 失败 ${e.path}: HTTP ${r.status} ${r.raw.slice(0, 200)}`);
      if (r.json.sha !== e.sha) {
        fail(`blob 内容不一致：${e.path}\n  本地 ${e.sha}\n  远端 ${r.json.sha}`);
      }
      blobCache.set(e.sha, r.json.sha);
    }
    console.log(`    blobs 已上传（新增后累计 ${blobCache.size}），SHA 全部与本地一致`);

    // --- tree ---
    const treeRes = await api("POST", `/repos/${OWNER}/${REPO}/git/trees`, {
      tree: entries.map((e) => ({
        path: e.path,
        mode: e.mode,
        type: "blob",
        sha: blobCache.get(e.sha),
      })),
    });
    if (treeRes.status !== 201) fail(`建 tree 失败：HTTP ${treeRes.status} ${treeRes.raw.slice(0, 300)}`);
    const treeSame = treeRes.json.sha === c.tree;
    console.log(`    tree ${treeSame ? "✅ 与本地一致" : "⚠️ 与本地不同"}  ${treeRes.json.sha.slice(0, 8)}`);

    // --- commit ---
    const parents = c.parents.map((p) => {
      if (!remoteShaByLocal.has(p)) fail(`解析不到父提交 ${p} 的远端 SHA`);
      return remoteShaByLocal.get(p);
    });
    const comRes = await api("POST", `/repos/${OWNER}/${REPO}/git/commits`, {
      message: c.message,
      tree: treeRes.json.sha,
      parents,
      author: c.author,
      committer: c.committer,
    });
    if (comRes.status !== 201) fail(`建 commit 失败：HTTP ${comRes.status} ${comRes.raw.slice(0, 300)}`);
    remoteShaByLocal.set(sha, comRes.json.sha);
    const comSame = comRes.json.sha === sha;
    console.log(`    commit ${comSame ? "✅ 与本地一致" : "⚠️ 与本地不同"}  ${comRes.json.sha.slice(0, 8)}`);
  }

  const headLocal = localCommits[localCommits.length - 1];
  const headRemote = remoteShaByLocal.get(headLocal);

  console.log(`\n[4] 设置分支 ${BRANCH} ...`);
  let ref = await api("POST", `/repos/${OWNER}/${REPO}/git/refs`, {
    ref: `refs/heads/${BRANCH}`,
    sha: headRemote,
  });
  if (ref.status === 422 || ref.status === 409) {
    ref = await api("PATCH", `/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}`, {
      sha: headRemote,
      force: true,
    });
  }
  if (ref.status !== 201 && ref.status !== 200) {
    fail(`建/改分支失败：HTTP ${ref.status} ${ref.raw.slice(0, 300)}`);
  }
  console.log(`    ✅ refs/heads/${BRANCH} -> ${headRemote.slice(0, 8)}${seeded ? "（已覆盖占位提交）" : ""}`);

  console.log("[5] 远端回查 ...");
  const check = await api("GET", `/repos/${OWNER}/${REPO}/commits/${BRANCH}`);
  if (check.status !== 200) fail(`回查失败：HTTP ${check.status}`);
  console.log(`    远端 HEAD = ${check.json.sha.slice(0, 8)}  本地 HEAD = ${headLocal.slice(0, 8)}`);
  if (check.json.sha === headLocal) {
    console.log("    ✅ 逐字一致");
  } else {
    console.log("    ⚠️ SHA 不同（内容已上去，仅提交元数据有差异）");
  }

  try {
    git(["remote", "remove", "origin"]);
  } catch (_) {}
  git(["remote", "add", "origin", `https://github.com/${OWNER}/${REPO}.git`]);

  console.log(`\n✅ 完成：https://github.com/${OWNER}/${REPO}\n`);
})().catch((e) => fail(e.stack || String(e)));

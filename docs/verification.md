# 验证记录 · V0.15

> 每次版本变更都跑同一套检查，任何一项不过就不上线。
> 本页是 **V0.15** 的验证结果快照。原始输出在本地 `docs/evidence/`（未进仓库）。
> 复现方式见每节末尾的命令。

环境：Windows / Node 22.22.2 / Playwright（驱动本机 Edge）/ iPhone 13 仿真。
线上地址：<https://miaohui-reply.app.workbuddy.host/>

---

## 0. 本版改了什么

| 问题 | 处理 |
|---|---|
| 生成一条回复要等两分钟 | 定位到根因是**选模型**，不是场景复杂度；改为显式候选链 + 8 秒首字看门狗，实测 2.1 秒 |
| 「补充说明」输入框从 04 区漂到了 01 区 | 移回 04 区（「让回复像你」）内部 |
| 手机端点上传截图无反应 | 加了云 SDK 缺失守卫 + 4 秒看门狗提示；真机成因仍未定论（见文末诚实清单） |

## 1. 构建审计 12 项 —— 全绿

`node scripts/build-shell.cjs`

```
生成时间：2026-10-15T14:31:03.738Z
视觉层：scripts\shell-v0.15.html  (551 行)
逻辑层：index.v0.15.logic.html 第 384 行起  (1007 行)
产出：index.html  (1557 行)
版本号：V0.15  OK

[1] id 完整性：59 个，缺失 0 -> 无
[2] 动态 class 有样式：34 个，缺失 0 -> 无
[3] keyframes：20 个被引用，未定义 0 -> 无
[4] CSS 变量：13 个被引用，未声明 0 -> 无
[5] 登录态回归护栏：通过
[6] 逻辑层字节一致性：完全一致（除版本号）
[7] file input 移动端护栏：2 个 file input，display:none 写法命中 0 -> 通过（均用 .shot-file 覆盖层）
[7b] file input 覆盖层 class：全部带 .shot-file
[8] PWA 标签：4 项，缺失 0 -> 全部就位
[8b] PWA 资源：manifest.webmanifest 存在，icon-180/192/512 存在
[9] 模型候选链：候选 4 个（首位 deepseek-v4.1-flash），回退到「第一个未禁用项」的写法 已移除，首字看门狗 在，首位是慢模型 否
[10] 版本自检：version.json = V0.15，页面内自检逻辑 已接入

结果：全部通过
```

**这 12 项分别防的是什么**

| # | 审计项 | 防的问题 |
|---|---|---|
| 1 | id 完整性（59） | JS 全靠 `getElementById` 取元素，id 在功能就在 |
| 2 | 动态 class 有样式（34） | 改完样式后结果卡片变成裸文本 |
| 3 | keyframes 都有定义（20） | 动画静默失效 |
| 4 | CSS 变量都已声明（13） | 颜色静默丢失 |
| 5 | 登录态回归护栏 | `session.user.email` 判登录态（v0.10 的真实 bug） |
| 6 | **逻辑层逐字节一致性** | 改版动到业务逻辑——这是"换皮不换骨"可以被机器验证的关键 |
| 7 / 7b | file input 移动端护栏 | 再出现 `hidden` 的 file input（v0.13 的移动端故障） |
| 8 / 8b | PWA 标签与资源 | 标签写了但文件漏传 → iOS 静默退化成普通书签 |
| 9 | **模型候选链与首字看门狗** | 代码悄悄回退成"取列表第一个未禁用模型"（那就是平台默认路由器，v0.14 两分钟等待的根因） |
| 10 | 版本自检文件 | 页面拿到了缓存里的旧版本却毫无察觉 |

## 2. 桌面功能冒烟 22 例 —— 22/22 通过

`node scripts/smoke-v012.cjs`

```
用例：22  通过：22  失败：0
页面未捕获异常：无
```

覆盖：意图 chip 渲染与切换 / 身份 chip 与自定义身份 / 风格样本写入 localStorage / 存为档案并按身份预填 / 档案存取删载 / 「本次不使用风格」清空样本但保留档案 / 两个截图入口（01 上下文、04 风格）多选 / 结果区 3 条候选 + 9 个操作 + 底部 5 个控件 / 「太假了」就地展开原因并锁住好评 / 清空需二次确认 / 清空复位范围正确且**风格档案保留** / 空状态插画还原 / 登录弹窗四 Tab（登录·验证码·注册·忘记密码）与 Esc 关闭 / 无障碍标题与隐私说明。

## 3. 移动端触摸回归 17 例 —— 17/17 通过

`node scripts/e2e-mobile-upload.cjs`（iPhone 仿真 + 真实触摸事件，云端走替身，结果确定性）

```
妙回移动端上传截图回归测试（iPhone 仿真 + 触摸，云端用替身）
PASS  01 上下文截图 input 不再是 display:none   [display=block visibility=visible]
PASS  02 上下文截图 input 仍带 .shot-file 覆盖层类   [class=shot-file hidden=false]
PASS  03 04 区块（风格提取）同样不再是 display:none   [display=block]
PASS  04 覆盖层与按钮几何重合（触摸可直接落在 input 上）   [input 119x44@22,647 vs 按钮 119x44@22,647]
PASS  05 04 区块覆盖层与按钮几何重合   [input 119x44 vs 按钮 119x44]
PASS  06 触屏媒体查询生效（pointer: coarse / hover: none）   [touch=true]
PASS  07 点击热区 >= 44px（Apple HIG 最小值）   [按钮高度=44px  字号=16px]
PASS  08 手机端隐藏了无意义的 Ctrl+V 提示   [.kbd-only display=none]
PASS  09a 待触摸点确实在视口内（防止假失败）   [点 82,332 视口 393x670]
PASS  09 手指点在「上传聊天截图」上唤起了文件选择器   [点 82,332]
PASS  10 选图后缩略图进入列表   [缩略图=1 状态=已提取]
PASS  11 识别流程跑通并把文字回填到 01 输入框   [最终状态=已提取 写入上下文 33 字]
PASS  12 filechooser 是否触发   [已触发]
PASS  13 按钮置灰时覆盖层失去 pointer-events（不能绕过禁用）   [disabled 时 pointer-events=none]
PASS  14 按钮恢复时不误伤覆盖层   [恢复后 pointer-events=auto]
PASS  15 04 区块「上传截图提取」触摸也能唤起选择器   [点 82,308]
PASS  16 页面零未捕获异常   [无]
合计：17 通过 / 0 失败
```

关键在于**不是看样式，而是看行为**：`touchscreen.tap` 真的抛出了 `filechooser`。

## 4. 模型候选链与首字兜底 22 例 —— 22/22 通过（本版新增）

`node scripts/e2e-model-chain.cjs`（用替身 SDK 换掉 CDN 上的真实 SDK，把"模型选择"变成可复现的用例）

```
妙回 V0.15 模型候选链 / 首字超时兜底 / 版本自检 回归测试
PASS  A1 候选链首选 deepseek-v4.1-flash   [链=deepseek-v4.1-flash > glm-5.3-flash > hy3]
PASS  A2 候选链里没有 auto / default   [链=deepseek-v4.1-flash > glm-5.3-flash > hy3]
PASS  A3 模型就绪后「生成回复」可用
PASS  A4 生成出 3 条候选   [cand=3]
PASS  A5 等待期间出现过「已经写好 N 条」进度
PASS  A6 实际用的是候选链首位模型   [用了 deepseek-v4.1-flash]
PASS  A7 生成结束后进度条收起   [display=none]
PASS  A8 无未捕获异常
PASS  B1 没有优选模型时退到其它支持图片的模型（不是 auto）   [链=hy4-preview]
PASS  B2 连一个支持图片的模型都没有时明确报错并禁用生成   [status=暂时没有可用的模型，请稍后再试]
PASS  B3 云 SDK 没加载成功时明确提示并禁用生成（不再静默失灵）   [status=依赖脚本没加载成功（多半是网络问题），刷新页面重试一次]
PASS  C1 首选模型不吐字时自动换下一个候选   [调用顺序=deepseek-v4.1-flash > glm-5.3-flash]
PASS  C2 换模型后仍然给出 3 条候选   [cand=3]
PASS  C3 总耗时受控（<25s，首字看门狗 8s + 第二个模型生成）   [实际 10s]
PASS  C4 结束后按钮恢复可用
PASS  C5 无未捕获异常
PASS  D1 点取消后状态显示「已取消」   [status=已取消]
PASS  D2 取消后按钮恢复、不出候选   [go=false cand=0]
PASS  E1 服务端版本更新时出现提示条   [你打开的是旧版 V0.15，新版 V9.9 已发布刷新到新版]
PASS  E2 提示条带「刷新到新版」按钮   [刷新到新版]
PASS  E3 点刷新会带 ?v= 参数强制重新取（绕开缓存）   [file:///D:/Projects/miaohui/index.html?v=V9.9]
PASS  E4 版本一致时不出提示条   [页面版本=V0.15]
合计：22 通过 / 0 失败
```

## 5. 生成耗时实测（本版新增）

`node scripts/e2e-real-latency.cjs`（真实云端接口 + 真实页面，场景：领导只发「你好」）

```
候选链（页面自己读到的）：deepseek-v4.1-flash > glm-5.3-flash > deepseek-v4-flash > glm-4.6v > hy3 > hy3-x

【生成】
  实际使用的模型  : deepseek-v4.1-flash
  首个候选可见    : 未捕捉到（生成太快）
  全部 3 条完成   : 2.1 秒

【截图识别】
  耗时            : 2.5 秒
  结果状态        : 已提取
```

同一场景在 V0.14 上的实测是**首字 125 秒以上**（根因：选中的是平台默认路由器 `auto`，它会把请求转派给不确定的后端）。修复后模型改由显式的快模型候选链决定，并且 8 秒内不见首字就自动切下一个，所以最坏情况也有上界。

对照实测（首字延迟）：`deepseek-v4.1-flash` 1.5s / `glm-5.3-flash` 4.2s / `auto` 125s+。快档与慢档的输出格式、条数、长度一致，不是靠"少干活"换速度。

## 6. 线上一致性 —— 逐字节一致

`node scripts/check-live.cjs`（版本无关，自动读 `version.json`）

```
[1] 线上 index.html  HTTP 200  89530 B   本地 89530 B  -> 字节一致 OK
      线上版本号：V0.15  期望：V0.15  OK
      逐字节相同：是
[2] index.html               HTTP 200  text/html
[2] version.json             HTTP 200  application/json
[2] manifest.webmanifest     HTTP 200  application/manifest+json
[2] pwa/icons/icon-180.png   HTTP 200  image/png
[2] pwa/icons/icon-192.png   HTTP 200  image/png
[2] pwa/icons/icon-512.png   HTTP 200  image/png
[2] pwa/icon.svg             HTTP 200  image/svg+xml
[2b] 线上 version.json = V0.15  与页面一致 OK
[3] 页面内渲染版本号：V0.15
      模型候选链：deepseek-v4.1-flash > glm-5.3-flash > deepseek-v4-flash > glm-4.6v > hy3 > hy3-x
      旧版提示条：未出现 OK
      manifest 解析：HTTP 200  display=standalone  icons=3
      页面未捕获异常：无
```

## 7. 端到端链路（认证 / 跨设备 / 清空）

| 脚本 | 验证内容 | 结果 |
|---|---|---|
| `e2e-v010-session-render.mjs` | 登录态渲染：未登录基线 → 仅 session 无邮箱线索（旧版必失败）→ `raw.email` → `getUser()` 兜底 → 注入会话刷新仍为登录态 → 退出清会话 | 7 项全过 |
| `e2e-cross-device.mjs` | 跨设备同步闭环：自建临时邮箱真实注册 → 存档案 → **换一个干净浏览器上下文（本机为空）** → 登录 → 档案拉回且逐字一致 | 通过 |
| `e2e-auth-ui.mjs` | 认证四 Tab 切换与关闭 | 通过 |
| `e2e-clear-all.mjs` | 一键清空范围与二次确认 | 通过 |
| `e2e-rls-negative.mjs` | RLS 反向验证：未登录读写云端档案表必须失败 | 通过 |
| `e2e-shot-ocr.mjs` | 截图 → 多模态识别 → 文字回填 → 生成 | 通过 |

---

## 本版仍未覆盖的部分（诚实清单）

- **真机上的上传截图**：本机没有 WebKit / 真机，移动端回归跑的是 Chromium + iPhone 仿真 + 真实触摸事件。它证明"触摸能唤起选择器"，**不能证明某台具体手机上一定行**。本版因此加了两道诊断：云 SDK 没加载成功时明确报错并禁用生成（以前是静默失灵），以及点了上传 4 秒没弹选择器就提示改用粘贴或换系统浏览器。**真机成因仍未定论，需要机型 + 浏览器信息才能继续定位。**
- **iOS「添加到主屏幕」的最终效果**：需真机验证（Android / 桌面 Chrome 的安装条件由 manifest 满足，可实测）。线上 `manifest.webmanifest` 与三个图标均已确认 HTTP 200，入口在 iOS Safari 的**分享**菜单里（不在浏览器菜单里）。
- **生成质量的大样本评测**：目前只有自评与少量真实使用反馈，50 条测试集的"像人评分"盲评**尚未完成**，这是下一步最该补的。本版换用快模型是纯性能取舍，在"委婉拒绝 / 砍价"这类难表达的意图上还没有做快慢档对照。

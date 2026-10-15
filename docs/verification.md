# 验证记录 · V0.14

> 每次版本变更都跑同一套检查，任何一项不过就不上线。
> 本页是 **V0.14（含 PWA）** 的验证结果快照。原始输出在本地 `docs/evidence/`（未进仓库）。
> 复现方式见每节末尾的命令。

环境：Windows / Node 22.22.2 / Playwright（驱动本机 Edge）/ iPhone 13 仿真。
线上地址：<https://miaohui-reply.app.workbuddy.host/>

---

## 1. 构建审计 10 项 —— 全绿

`node scripts/build-shell.cjs`

```
生成时间：2026-10-15T10:31:08.411Z
视觉层：scripts\shell-v0.14.html  (549 行)
逻辑层：index.v0.10.backup.html 第 384 行起  (871 行)
产出：index.html  (1419 行)
版本号：V0.10 -> V0.14  OK

[1] id 完整性：59 个，缺失 0 -> 无
[2] 动态 class 有样式：33 个，缺失 0 -> 无
[3] keyframes：20 个被引用，未定义 0 -> 无
[4] CSS 变量：13 个被引用，未声明 0 -> 无
[5] 登录态回归护栏：通过
[6] 逻辑层字节一致性：完全一致（除版本号）
[7] file input 移动端护栏：2 个 file input，display:none 写法命中 0 -> 通过（均用 .shot-file 覆盖层）
[7b] file input 覆盖层 class：全部带 .shot-file
[8] PWA 标签：4 项，缺失 0 -> 全部就位
[8b] PWA 资源：manifest.webmanifest 存在，icon-180/192/512 存在

结果：全部通过
```

**这 10 项分别防的是什么**

| # | 审计项 | 防的问题 |
|---|---|---|
| 1 | id 完整性（59） | JS 全靠 `getElementById` 取元素，id 在功能就在 |
| 2 | 动态 class 有样式（33） | 改完样式后结果卡片变成裸文本 |
| 3 | keyframes 都有定义（20） | 动画静默失效 |
| 4 | CSS 变量都已声明（13） | 颜色静默丢失 |
| 5 | 登录态回归护栏 | `session.user.email` 判登录态（v0.10 的真实 bug） |
| 6 | **逻辑层逐字节一致性** | 改版动到业务逻辑——这是"换皮不换骨"可以被机器验证的关键 |
| 7 / 7b | file input 移动端护栏 | 再出现 `hidden` 的 file input（v0.13 的移动端故障） |
| 8 / 8b | PWA 标签与资源 | 标签写了但文件漏传 → iOS 静默退化成普通书签 |

## 2. 桌面功能冒烟 22 例 —— 22/22 通过

`node scripts/smoke-v012.cjs`

```
用例：22  通过：22  失败：0
页面未捕获异常：无
```

覆盖：意图 chip 渲染与切换 / 身份 chip 与自定义身份 / 风格样本写入 localStorage / 存为档案并按身份预填 / 档案存取删载 / 「本次不使用风格」清空样本但保留档案 / 两个截图入口（01 上下文、03 风格）多选 / 结果区 3 条候选 + 9 个操作 + 底部 5 个控件 / 「太假了」就地展开原因并锁住好评 / 清空需二次确认 / 清空复位范围正确且**风格档案保留** / 空状态插画还原 / 登录弹窗四 Tab（登录·验证码·注册·忘记密码）与 Esc 关闭 / 无障碍标题与隐私说明。

## 3. 移动端触摸回归 17 例 —— 17/17 通过

`node scripts/e2e-mobile-upload.cjs`（iPhone 仿真 + 真实触摸事件）

```
合计：17 通过 / 0 失败
```

关键在于**不是看样式，而是看行为**：

```
PASS  04 覆盖层与按钮几何重合（触摸可直接落在 input 上）  [input 126x44@22,647 vs 按钮 126x44@22,647]
PASS  07 点击热区 >= 44px（Apple HIG 最小值）             [按钮高度=44px  字号=16px]
PASS  09 手指点在「上传聊天截图」上唤起了文件选择器        [点 82,332]
PASS  11 识别流程跑通（状态收敛）                          [最终状态=已提取  写入上下文 67 字]
PASS  12 filechooser 是否触发                              [已触发]
PASS  13 按钮置灰时覆盖层失去 pointer-events（不能绕过禁用）
PASS  16 页面零未捕获异常                                  [无]
```

## 4. 线上一致性 —— 逐字节一致

`node scripts/check-live-v014.cjs`

```
[1] 线上 index.html  HTTP 200  80979 B   本地 80979 B  -> 字节一致 OK
      线上版本号：V0.14
      逐字节相同：是
[2] index.html               HTTP 200  text/html
[2] manifest.webmanifest     HTTP 200  application/manifest+json
[2] pwa/icons/icon-180.png   HTTP 200  image/png
[2] pwa/icons/icon-192.png   HTTP 200  image/png
[2] pwa/icons/icon-512.png   HTTP 200  image/png
[2] pwa/icon.svg             HTTP 200  image/svg+xml
[3] 页面内渲染版本号：V0.14
      manifest 解析：HTTP 200  display=standalone  icons=3
      appleIcon = pwa/icons/icon-180.png
      capable = yes        title = 妙回        theme = #FBF7F0
      页面未捕获异常：无
```

## 5. 端到端链路（认证 / 跨设备 / 清空）

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

- **真机 WebKit**：移动端回归跑的是 Chromium + iPhone 仿真 + 真实触摸事件，本机无 WebKit / 真机。"触摸能唤起选择器"是实测结论；"iOS Safari 拒绝 `display:none` 的 file input" 属平台已知行为，**仍需真机复点确认**。
- **iOS「添加到主屏幕」的最终效果**：需真机验证（Android / 桌面 Chrome 的安装条件由 manifest 满足，可实测）。
- **生成质量的大样本评测**：目前只有自评与少量真实使用反馈，50 条测试集的"像人评分"盲评**尚未完成**，这是下一步最该补的。

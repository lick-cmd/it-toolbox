# 实机验收清单（Manual QA）

本文件承接 `tasks.md` 第 9 组中**无法在自动化环境里验证**的四条任务：`9.3`、`9.4`、`9.6`、`9.10`。它们的**原文已从 `tasks.md` 移到这里**（`tasks.md` 只留一条指向本文件的说明），原因是这四条都需要真机 / 真断网 / Windows 环境，单测与 CI 都构造不出来。

> **状态：四条均未执行**（2026-09-16 由 comet 阶段 3 → 阶段 4 的 build 守卫阻塞点确认后移出）。
> **这是一次显式的范围收窄，不是「悄悄划掉」**：本文件是它们的唯一归宿，执行完成后按下面的记录格式把结果填回，届时才算真正验收。相关判定与影响范围记在验证报告里。

## 0. 共同前置与已有证据

| 项目 | 现状 |
| --- | --- |
| 前端产物 | `npm run build` = `tsc --noEmit && vite build && node scripts/scan-egress.mjs`，**已实测 exit 0**，末行 `[scan-egress] 网络 API 调用 0 处；远程 URL 字面量 7 处` / `通过：产物中未发现外发能力。` |
| 桌面端产物 | `npm run tauri:build`；`src-tauri/tauri.conf.json` 里 `bundle.targets = ["dmg", "nsis"]`、`beforeBuildCommand = npm run build`、`windows.webviewInstallMode = { type: "skip" }` |
| 运行期 CSP | 已无外网许可：`connect-src` 仅 `ipc: http://ipc.localhost`（开发态另加 `ws://localhost:1420 http://localhost:1420`）→ 出网会被 CSP 拦（属 `9.9` 已验部分） |
| 离线四层验证（`9.9`） | 已勾选完成：CSP 拒绝外发 / 开发期检测生效 / 产物扫描通过 / 远程图片与外部链接行为符合预期 |

**注意**：上面这些是**产物级与策略级**证据，**不等价于真机断网可用**。四条任务的价值正在于补上「真机」这一段。

## 1. `9.3` 断网冒烟

> **原文**：断网冒烟：离线状态下逐个使用 17 个工具，确认无功能降级且无出网请求

- **怎么验**：装好 `dmg`（macOS）与 `nsis`（Windows）产物 → 真断网（macOS 关 Wi-Fi；Windows 禁用网卡）→ 逐个打开 17 个工具各做一次典型操作（生成/转换/复制/下载各覆盖到）→ 观察是否出现加载失败、图标或字体缺失、请求超时、界面卡死。
- **要记什么**：17 行清单（工具名 × 操作 × 结论），外加「0 出网请求」的旁证（抓包截图 / 代理日志；只用 CSP 与静态扫描不算）。
- **状态**：☐ 未执行

## 2. `9.4` 四平台构建与启动

> **原文**：macOS（arm64 + x64）与 Windows（x64 + arm64）四平台构建，确认产物可安装可启动

- **怎么验**：
  - macOS arm64（本机可做）：`npm run tauri:build`；
  - macOS x64：`npm run tauri:build -- --target x86_64-apple-darwin`；
  - Windows x64 / arm64：需在 Windows 机器或 CI 的 `windows-latest` runner 上 `npm run tauri:build`（本机无法产出 Windows 产物）。
- **要记什么**：四行（平台 × 架构 × 命令 × 产物路径 × 能否安装启动），失败的附原始报错。
- **状态**：☐ 未执行

## 3. `9.6` 跨 WebView 冒烟

> **原文**：跨 WebView 冒烟：在 macOS WKWebView 与 Windows WebView2 上验证剪贴板、文件拖放与 WebCrypto 行为一致

- **怎么验**：同一份操作脚本在两端各跑一遍——① 复制（`clipboard-manager` 路径）；② 文件拖放（`plugin-fs` / `plugin-dialog` 路径）；③ WebCrypto（哈希 / 加解密类工具）。
- **要记什么**：三行（能力 × 平台 × 结论）；两端**行为不一致**处即为缺陷，单独列出。
- **状态**：☐ 未执行

## 4. `9.10` Windows 前置条件验证

> **原文**：Windows 前置条件验证：在具备 WebView2 的机器上零网络安装并启动；在缺失运行时的机器上确认失败提示清晰

- **背景**：`tauri.conf.json` 里 `windows.webviewInstallMode = { type: "skip" }` —— 安装包**不**自带 WebView2 运行时，因此这条是「前置条件」而不是「随便装」。
- **怎么验**：① 有 WebView2 的 Windows 机器上，断网安装 `nsis` 产物并启动；② 无 WebView2 的机器上安装并启动，确认失败提示清晰可行动（而不是白屏或含糊报错）。
- **要记什么**：两行（场景 × 结论）+ 截图；第 ② 种情形若提示不清晰，按缺陷登记。
- **状态**：☐ 未执行

## 记录格式（执行时填写）

```md
### <任务号> <任务简述>
- 日期 / 执行人 / 环境（OS 版本、架构、产物版本）：
- 步骤：
- 结果：PASS / FAIL
- 证据：（截图、日志、抓包）
- 偏差：（与 tasks.md 原文不一致之处，或验收标准之外的新发现）
```

## 与 `tasks.md` 的对应关系

| 本文件 | 原 `tasks.md` 位置 | 现 `tasks.md` 状态 |
| --- | --- | --- |
| `9.3` | 第 9 组第 3 条 | 已移出，第 9 组留一行说明指向本文件 |
| `9.4` | 第 9 组第 4 条 | 同上 |
| `9.6` | 第 9 组第 6 条 | 同上 |
| `9.10` | 第 9 组第 10 条 | 同上 |

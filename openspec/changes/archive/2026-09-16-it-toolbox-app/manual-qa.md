# 实机验收清单（Manual QA）

本文件承接 `tasks.md` 第 9 组中**无法在自动化环境里验证**的四条任务：`9.3`、`9.4`、`9.6`、`9.10`。它们的**原文已从 `tasks.md` 移到这里**（`tasks.md` 只留一条指向本文件的说明），原因是这四条都需要真机 / 真断网 / Windows 环境，单测与 CI 都构造不出来。

> **状态：四条均未执行**（2026-09-16 由 comet 阶段 3 → 阶段 4 的 build 守卫阻塞点确认后移出）。
> **这是一次显式的范围收窄，不是「悄悄划掉」**：本文件是它们的唯一归宿，执行完成后按下面的记录格式把结果填回，届时才算真正验收。相关判定与影响范围记在验证报告里。
>
> **2026-09-16 归档后补充**：`9.4` 的 **macOS 两架构**已在 arm64 本机上真跑完（构建 → 解包 → 启动，含 WebView 与 socket 证据），见文末「执行记录 A」；`9.3` 补上了**运行期**零出网旁证，见「执行记录 B」——**但这不等于 9.3 完成**，它的主体是 17 个工具的逐个操作，未做。
> `9.6`、`9.10` 以及 `9.4` 的 **Windows 两架构仍未执行**，必须有 Windows / 真机环境。另外本次执行顺带查出一个签名层面的实质问题（见「执行记录 A」的偏差栏）：**x64 产物完全未签名**，`spctl` 评估为 `rejected`。

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
- **状态**：☐ **未执行**（17 个工具的逐个操作未做 —— 这是本条的主体）
  - 已补的旁证：**运行期** socket 观测（非 CSP、非静态扫描），见「执行记录 B」。但它只覆盖「启动后静止 18s」这一个窗口、且 `lsof` 是快照，**不能替代真断网 + 17 工具走查**，也不等于抓包。

## 2. `9.4` 四平台构建与启动

> **原文**：macOS（arm64 + x64）与 Windows（x64 + arm64）四平台构建，确认产物可安装可启动

- **怎么验**：
  - macOS arm64（本机可做）：`npm run tauri:build`；
  - macOS x64：`npm run tauri:build -- --target x86_64-apple-darwin`；
  - Windows x64 / arm64：需在 Windows 机器或 CI 的 `windows-latest` runner 上 `npm run tauri:build`（本机无法产出 Windows 产物）。
- **要记什么**：四行（平台 × 架构 × 命令 × 产物路径 × 能否安装启动），失败的附原始报错。
- **状态**：◐ **部分执行**（macOS arm64 + x64 已执行，见「执行记录 A」；Windows x64 + arm64 未执行）

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

## 执行记录（2026-09-16，归档后补）

### 执行记录 A —— `9.4` macOS 两架构构建与启动

- 日期 / 执行人 / 环境：2026-09-16 / 本机（macOS 26.3.1，BuildVersion `25D771280a`，arm64；Node v23.7.0；rustc 1.96.0）。执行方式：脚本化，**无 GUI 交互**。
- 步骤：

| 平台 | 架构 | 命令 | 产物 | 构建 | 解包 | 启动 |
| --- | --- | --- | --- | --- | --- | --- |
| macOS | arm64 | `npm run tauri:build` | `src-tauri/target/release/bundle/dmg/IT Toolbox_0.1.0_aarch64.dmg`（2,362,828 B = 2.25 MiB） | PASS | PASS | PASS |
| macOS | x64 | `npm run tauri:build -- --target x86_64-apple-darwin` | `src-tauri/target/x86_64-apple-darwin/release/bundle/dmg/IT Toolbox_0.1.0_x64.dmg`（2,487,009 B = 2.37 MiB） | PASS（先 `rustup target add x86_64-apple-darwin`，本轮新装该 target） | PASS | PASS（Rosetta） |
| Windows | x64 | 需 Windows 机器（或 CI 的 `windows-latest`） | — | 未执行 | — | — |
| Windows | arm64 | 需 Windows 机器（或 CI 的 `windows-11-arm`） | — | 未执行 | — | — |

- 解包方式：`hdiutil attach` 挂载 dmg → `ditto` 解出 `.app` 到临时目录（等价于拖拽安装后的状态，未落盘到 `/Applications`）。
- 启动证据（两架构各一份）：
  - `lsappinfo list` 显示以 **`type="Foreground"`** 注册，`Version="0.1.0"`；arm64 包 `Arch=ARM64`、x64 包 `Arch=x86_64`；
  - 随启动新出现 3 个 **以本应用命名的** WebKit XPC 子进程（`com.apple.WebKit.Networking` / `.GPU` / `.WebContent`），即 WKWebView 确由本产物创建（取启动前后进程集合差集，并逐个 `ps -p` 校验 PID 有效后才计入结论）；
  - 应用进程与上述 3 个子进程的 `lsof -a -p <pid> -i -n -P` 均为 **0 条 socket 记录**；
  - 运行期 stderr/stdout 为空（无报错输出）。
- 结果：**PASS**（macOS 两架构「可构建 + 可解包 + 可启动」）。Windows 两架构与「分发后首次启动」**未执行**。
- 证据：本机命令原始输出（同步记入验证报告 §9.5）。**未做截图** —— 窗口几何查询需辅助功能授权，`osascript` 返回 `-1719 不允许辅助访问`，未申请该授权，故「界面逐工具操作正常」不在本轮结论内。
- **偏差（新发现，需决策）—— 两个 macOS 产物的签名状态不一致，且都过不了校验**：
  - arm64：`codesign --verify` 退出码 **1** —— `code has no resources but signature indicates they must be present`（adhoc / linker-signed，包内无 `_CodeSignature`）；`spctl --assess` 退出码 **1**，同一消息。
  - x64：`codesign --verify` 退出码 **1** —— **`code object is not signed at all`**；`spctl --assess` 退出码 **3** —— **`rejected`，`source=no usable signature`**。
  - 影响：本机（无 quarantine）直跑不受影响，但**「分发给他人后首次启动」这条路径未经任何验证**。设计文档 `:437` 承诺「未签名/未公证产物首次启动需右键打开」——该承诺对 arm64 能否成立、对**完全未签名的 x64** 是否成立（很可能提示为「已损坏」而非「未验证的开发者」），**都未验证，不应视为已知可用**。
  - 定性：`tauri.conf.json` 的 `bundle.macOS` 只有 `minimumSystemVersion`、**没有 `signingIdentity`**，故「未签名」属预期配置；但 **x64 连 adhoc 签名都没有**是实现事实，与设计意图无关，属产物级差异 —— **根因已在「执行记录 C」查清**（链接器行为，非 Tauri 行为）。

### 执行记录 B —— `9.3` 运行期零出网旁证（**不构成 `9.3` 完成**）

- 日期 / 执行人 / 环境：同上。
- 步骤：从 dmg 解出 `.app`（去掉 quarantine 属性）→ 直接运行 bundle 内可执行文件 → 静止 18s → 对应用进程与**本产物新起的 3 个 WebKit XPC 进程（含负责联网的 `Networking`）**逐个 `lsof -a -p <pid> -i -n -P`。两架构各做一次。
- 结果：应用进程 0 条 socket；`Networking` / `GPU` / `WebContent` 各 0 条 socket；stderr 无报错。
- **局限（必须与结论同时看）**：① 只覆盖「启动后静止」这一个窗口，**17 个工具的典型操作一个都没做**（那是 `9.3` 的主体）；② `lsof` 是瞬时快照，建立后立即关闭的连接可能漏掉；③ 未断网、未抓包（`nettop` 无 `sudo` 时只输出表头，未取到按进程流量）。
- 结论：比「CSP + 静态扫描」更强、但**仍不足**的旁证。`9.3` 保持「未执行」。
- **复现陷阱（留给下次执行的人）**：`zsh` 不对未加引号的变量做分词，`for pid in $NEW` 会把多个 PID 当成**一个**参数传给 `lsof` → `lsof` 报「无此进程」而输出为空 → 得到「0 个 socket」的**假绿**。本轮踩过两次，最终改用 `bash -c`（或 `${=NEW}`）强制分词，并加 `ps -p <pid>` 有效性校验后才计入结论。这个坑对「0 出网」这类**结论依赖空输出**的检查尤其危险：假绿与真绿长得一模一样。

### 执行记录 C —— macOS 签名根因与 quarantine 专项（2026-09-16，脚本化）

- 目的：查清「执行记录 A」偏差栏里两个产物签名状态不一致的根因，并判断「分发给他人后首次启动」是否可行。
- **方法 1（决定性实验）**：同一份 C 源码，只换架构，看链接器是否自动签名。

  | 编译命令 | 签名（`codesign -dv`） | `codesign --verify` |
  | --- | --- | --- |
  | `cc -arch arm64 -o t-arm64 t.c` | `CodeDirectory v=20400 ... flags=0x20002(adhoc,linker-signed)`、`Signature=adhoc` | **0** |
  | `cc -arch x86_64 -o t-x86_64 t.c` | 无任何签名（`not signed at all`） | **1** |

  → **根因确定**：Apple Silicon 要求 arm64 二进制必须持有签名才能执行，链接器因此自动打 adhoc 签名；x86_64 无此要求，链接器不签。**与 Tauri 无关** —— 两侧的 **bundle 层**都没有签名，因为 `bundle.macOS` 没有 `signingIdentity`，Tauri 的整个签名步骤被跳过（两份打包日志里 `codesign` / `signing` **零次**出现）。这也解释了 arm64 那句 `code has no resources but signature indicates they must be present`：主可执行文件有（链接器的）签名，而 bundle 缺 `_CodeSignature`。

- **方法 2**：手工补 adhoc 签名，验证「签名无效」能否修成「签名有效」。
  - `codesign --force --sign - <app>` 两架构均成功；`codesign --verify` **1 → 0**，`_CodeSignature/CodeResources` 出现，`Identifier` 由链接器的 `it_toolbox-8e0a1fed3f352069` 变为 bundle id `ai.it-toolbox.desktop`。
  - 但 `spctl --assess` **仍 exit 3**（Gatekeeper 不信任 adhoc），且**签名变有效并不足以让 quarantine 下的 arm64 副本变成可运行**（见下）。

- **方法 3**：quarantine × 架构 × 是否重签 的对照矩阵（quarantine 分别打在 `.app` 目录 / `.app`+可执行文件）。

  | 变体 | quarantine | 直接 exec 结果 |
  | --- | --- | --- |
  | adhoc-arm64 | 无 | 存活（对照组，符合预期） |
  | adhoc-arm64 | `.app` / `.app`+bin | 被杀(137) / 被杀(137) |
  | 原产物-arm64 | `.app` / `.app`+bin | 被杀(137) / 被杀(137) |
  | adhoc-x64 | 无 | 被杀(137) ← **对照组失败** |
  | adhoc-x64 | `.app` / `.app`+bin | 被杀(137) / 存活 |
  | 原产物-x64 | `.app` / `.app`+bin | 存活 / 被杀(137) |

  - **只取一致的那条**：**arm64 + quarantine ⇒ 无法启动（`Killed: 9`，退出码 137，5/5 一致）**。
  - x64 各行**互相矛盾**（同一条件重复跑出相反结果，连「无 quarantine」的对照组都被杀），**一个都不采用**。

- **为什么 x64 那几行不可信（本轮第三个测量陷阱，已查明）**：直接 exec 一个**带 quarantine 的 `.app` 内**的可执行文件时，macOS 会做 **App Translocation** —— 把进程转译到只读目录**另行启动**（PPID=1）。`lsappinfo` 抓到了现行：`pre-translocationBundlePath=/private/tmp/qa-mx/original-x64/IT Toolbox.app`、`originalPid` 与转译后 PID 相同。此时「`kill -0 $P` 说存活」指的是**被转译后跑起来的那个进程**，而不是我 exec 的那个 —— 于是「存活」被我误读成「Gatekeeper 放行了」。该转译实例实测连续运行 1 分钟以上（`Arch=x86_64`、`type="Foreground"`），**全程没有任何对话框**。
  → 教训：**「quarantine 应用能否启动」不能用「直接 exec + 存活探测」判定**，会被 App Translocation 干扰。必须走 Finder 双击 / 右键打开，并由人观察对话框。该转译实例（我自己的测试残留）已清理；`/Applications/IT Toolbox.app` 的另一个实例（`Arch=x86_64`，Spotlight 启动）非本轮产生，未触碰。

- **手工待办（脚本无法替代，需有屏幕的人）**：对带 quarantine 的副本做 ①双击 ②右键→打开，记录对话框**原文**是「已损坏，无法打开，应将它移到废纸篓」还是「未验证的开发者 ＋ 仍要打开」，以及最终能否启动。这是设计文档 `:437` 那句承诺的**唯一**验收方式，目前仍为**未验证**。
- **已实测可用的兜底**：`xattr -dr com.apple.quarantine "<app 路径>"` 之后启动正常（本轮两架构的启动冒烟（执行记录 A）正是以此为前提做的）。
- 复现本次调查的命令要点：C 源码双架构编译 → `codesign -dv` / `--verify` 对比；`xattr -w com.apple.quarantine "<flags>;<hex 时间戳>;Safari;<uuid>"` 构造 quarantine；`lsappinfo list` 观察 `pre-translocationBundlePath` / `parentASN` 来判断「谁启动的、有没有被转译」。

# 实机验收清单（Manual QA）

本文件承接 `tasks.md` 第 9 组中**无法在自动化环境里验证**的四条任务：`9.3`、`9.4`、`9.6`、`9.10`。它们的**原文已从 `tasks.md` 移到这里**（`tasks.md` 只留一条指向本文件的说明），原因是这四条都需要真机 / 真断网 / Windows 环境，单测与 CI 都构造不出来。

> **状态：四条均未执行**（2026-09-16 由 comet 阶段 3 → 阶段 4 的 build 守卫阻塞点确认后移出）。
> **这是一次显式的范围收窄，不是「悄悄划掉」**：本文件是它们的唯一归宿，执行完成后按下面的记录格式把结果填回，届时才算真正验收。相关判定与影响范围记在验证报告里。
>
> **2026-09-16 归档后补充**：`9.4` 的 **macOS 两架构**已在 arm64 本机上真跑完（构建 → 解包 → 启动，含 WebView 与 socket 证据），见文末「执行记录 A」；`9.3` 补上了**运行期**零出网旁证，见「执行记录 B」——**但这不等于 9.3 完成**，它的主体是 17 个工具的逐个操作，未做。
> `9.6`、`9.10` 以及 `9.4` 的 **Windows 两架构仍未执行**，必须有 Windows / 真机环境。另外本次执行顺带查出一个签名层面的实质问题（见「执行记录 A」的偏差栏）：**x64 产物完全未签名**，`spctl` 评估为 `rejected`。
>
> **同日续**：该签名问题已查清根因并做了 quarantine 专项（见「执行记录 C」，含三类产物的判定对照）；此后代码有实质改动（JSON 折叠，提交 `b64c5bf`），产物与代码不再对齐，故**重新打包并复测**，见「执行记录 D」。签名问题已按 W10 ① 落地修复（`signingIdentity = "-"`）并重新出包，见「执行记录 E」。

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
- **手工结果（2026-09-16，执行人实测）**：`/tmp/it-toolbox-manual/` 下的带 quarantine 副本**无法打开**（执行人随后删除了样本）。
  - **仍未判定**：①对话框**原文**未记录 —— 「已损坏（无解，只能移废纸篓）」与「未验证的开发者（有『仍要打开』）」是两条完全不同的分叉；②是否尝试过**右键→打开**未记录。因此设计文档 `:437` 的承诺既未被证实、也未被证伪。
  - 取证方法的坑（本次踩过）：样本放在 `/tmp`，重启即失效；且重测必须用**新的** quarantine 时间戳，否则 `syspolicyd`/LaunchServices 的既有判定缓存会污染结果。重测请按本节命令重新生成。
- **脚本侧复现（同日追加）**：用 `open "<app>"`（与 Finder 双击**同一条** LaunchServices 路径）复核带 quarantine 的 `arm64-原始`：`open` 退出码 0 但**没有任何实例启动**（**注意**：「无实例」这半个观测后来**没能复现**，见「执行记录 D」的方法学更正 —— 本条的结论只以 `syspolicyd` 拒绝日志为凭）；同秒 `syspolicyd` 日志给出 `[com.apple.syspolicy.exec] Terminating process due to Gatekeeper rejection`（**原因字段被系统打成 `<private>`，日志层读不到文字** —— 所以对话框原文无法脚本取证）。同一秒 `CoreServicesUIAgent`（弹框代理）在加载偏好 → **复现成功，弹框确实是它出的**。
- **三类产物的判定对照（`spctl` 报错文本是「签名坏了」与「只是没签名」的分水岭）**：

  | 样本 | `codesign --verify` | `spctl --assess -vv` 文本 | 对应弹框类别 |
  | --- | --- | --- | --- |
  | `arm64-原始` | 1 | `code has no resources but signature indicates they must be present`（**签名结构性损坏**） | **「已损坏，无法打开，应将它移到废纸篓」，没有「仍要打开」** |
  | `x64-原始` | 1 | `code object is not signed at all` / `rejected, source=no usable signature`（**干净拒绝**） | 「未验证的开发者」＋「仍要打开」可用 |
  | `arm64-adhoc`（手工补签） | **0**（`valid on disk`、`satisfies its Designated Requirement`） | `rejected`（**无签名级错误**） | 「未验证的开发者」＋「仍要打开」可用 |

- **关键结论：arm64 产物当前状态比「完全未签名」更糟。** 成因是「Apple Silicon 强制 arm64 二进制必须有签名」×「Tauri 未执行 bundle 签名」的叠加：链接器给了主可执行文件一个 adhoc 签名，而 bundle 缺 `_CodeSignature`，签名**结构不自洽** → 落进「已损坏」这个**连『仍要打开』都没有**的类别；反观 x64 完全没签名，反而落在**有**「仍要打开」的「未验证的开发者」类别。**补 adhoc 签名（`codesign --force --sign -`）可把 arm64 从「已损坏」拉回「未验证的开发者」** —— 这是 W10 选项①的实测依据（`codesign --verify` 1→0、`spctl` 报错文本由签名级错误变为干净 rejected）。
- **仍缺的最后一步（一次双击）**：上表第三列的「弹框类别」是**推断**（由 `codesign` / `spctl` 的判定文本推出，非人眼所见）。要落成结论，需有人双击 `/tmp/it-toolbox-manual/arm64-adhoc`，确认出现的是「未验证的开发者 ＋ 仍要打开」而非「已损坏」。样本在 `/tmp`，重启即失效。
- **已实测可用的兜底**：`xattr -dr com.apple.quarantine "<app 路径>"` 之后启动正常（本轮两架构的启动冒烟（执行记录 A）正是以此为前提做的）。
- 复现本次调查的命令要点：C 源码双架构编译 → `codesign -dv` / `--verify` 对比；`xattr -w com.apple.quarantine "<flags>;<hex 时间戳>;Safari;<uuid>"` 构造 quarantine；`lsappinfo list` 观察 `pre-translocationBundlePath` / `parentASN` 来判断「谁启动的、有没有被转译」。

### 执行记录 D —— 第二版产物复测（含 JSON 折叠功能，2026-09-16）

- **背景**：「执行记录 A」验的是 14:42 / 14:46 那版产物。此后代码有实质改动（JSON 折叠，提交 `b64c5bf`），产物与代码不再对齐，故重新打包复测。**构建时工作区干净、HEAD = `b64c5bf`**；`beforeBuildCommand = npm run build`（含 `tsc --noEmit` + `vite build` + 外发扫描），日志留在 `/tmp/build-both.log`。
- **产物与复测结果**：

  | 架构 | 产物 | 大小 | 主可执行文件架构 | `codesign --verify` | 真启动 | 运行期 socket |
  | --- | --- | --- | --- | --- | --- | --- |
  | arm64 | `src-tauri/target/release/bundle/dmg/IT Toolbox_0.1.0_aarch64.dmg` | 2.3M（解开 4.0M） | `arm64` | 1 | 存活 8s | **0** |
  | x64 | `src-tauri/target/x86_64-apple-darwin/release/bundle/dmg/IT Toolbox_0.1.0_x64.dmg` | 2.4M（解开 4.4M） | `x86_64` | 1 | 存活 8s | **0** |

  - 运行期 stdout/stderr 均为空；本机解包后的副本**无 quarantine**（未经过下载）。
  - `codesign -dv` 与「执行记录 A」**完全一致**：arm64 `flags=0x20002(adhoc,linker-signed)`、`Identifier=it_toolbox-8e0a1fed3f352069`、`TeamIdentifier=not set`；x64 输出为空（`not signed at all`）。**W10 尚未处置，本轮未改签名配置**。

- **「本次改动确实在包里」的取证链**（第一条找法失败，记下原因以免后人重踩）：
  1. ❌ 「在 .app 里 grep 中文字符串」**对 Tauri 产物无效**：`Contents/Resources/` 里只有 `icon.icns`，前端资源被**内嵌进二进制**且被压缩 —— 实测两架构都 grep 不到 `json-code-fold-bar` / `全部折叠`，**这不代表功能没进去**。
  2. ✅ 对账法：`dist/assets/JsonCode-*.js` 含新增代码（`json-code-fold-bar`、明文「全部折叠」，`shasum` = `8ff929feaa2bb2ae…`）；`dist/assets/index-*.css` 含 `json-fold-toggle`（`c7c42244affdc5b0…`）。
  3. ✅ `hdiutil attach` 解包后，**dmg 内二进制与构建产物 hash 完全一致**：arm64 `d3bbf46816d84c7b…`、x64 `360371b91ad5a1ea…`（两组各自相等）。
  4. ✅ 打包日志开头可见 `Running beforeBuildCommand npm run build` 与外发扫描输出 → 前端是在构建时从 `b64c5bf` 重建的（dist 在 15:02 门禁、arm64 构建、x64 构建各重建一次，三次同源）。

- **仍未验证**：① UI 层的折叠交互（点开关、全部折叠/展开的观感）—— 逻辑与 DOM 有单测覆盖，但**没有人眼看过**；② `9.4` 的 Windows 两架构；③ W10 的「右键打开」分叉（同上节）。
- 清理：`/tmp/qa-v2-arm64`、`/tmp/qa-v2-x64`、挂载点 `/tmp/mnt-*` 与测试进程均已清理（残留自查：无进程、无挂载卷）。

#### D-1 「能不能启动」的测法更正（同日追加，重要）

- **起因**：本轮用 `open "<app>"`（与 Finder 双击同一条 LaunchServices 路径）复核新产物时，出现过一次「`open` 退出码 0 但无实例」，当时差点被写成「启动不了」。**随后 0/4 未能复现**：同一路径重跑、加 3 个全新路径各跑一次，出实例耗时分别为 **77 / 75 / 83 ms**（每次完整走 解包 → `hdiutil detach` → `open` → 0.2s 粒度轮询）。
- **同轮校正的第二条**：**无 quarantine 时，两架构的原始产物都能经 Finder 双击启动** —— 本轮 **7/7 成功**（四格矩阵 4 + 复现 3），**包括** `codesign --verify` 为 1、`spctl` 报 `code has no resources but signature…` 的 arm64 原始产物。也就是说**签名结构问题只在「带 quarantine」时才致命**（与「执行记录 C」一致），这也解释了 `/Applications` 那份 arm64 副本（同为链接器 adhoc、`verify=1`）为何能正常跑。
- **测法结论（并入方法库）**：
  1. 「启动得了吗」**不能用单次 `open` + 固定 sleep 后查进程**来判定 —— 失败必须**重复 ≥3 次**并交叉 `syspolicyd` 日志；**只有日志里的拒绝记录是硬证据**。
  2. 与已知的两个坑并列：① App Translocation 会让「存活」判错（`lsappinfo` 看 `pre-translocationBundlePath`）；② `pgrep -f` 可能匹配到**自己的命令行**（先拿一个肯定不存在的路径跑自检，确认匹配数为 0 再判定）；③ 本轮新增：**单次启动探测的假阴性**。
  3. 无 quarantine 的本地副本**能被 `open` 正常拉起** → 「兜底 = 去掉 quarantine」这条路是**实测可用**的（此前只由直接 exec 佐证）。

### 执行记录 E —— W10 ① 落地：ad-hoc 签名修复（2026-09-16）

- **决策依据**：执行人实测手工补签样本 `/tmp/it-toolbox-manual/arm64-adhoc` 双击后的弹框为「未验证的开发者 ＋ 仍要打开」，即 ① 能把 arm64 从「已损坏」类别拉回可放行类别。
- **改动**：`src-tauri/tauri.conf.json` → `bundle.macOS.signingIdentity = "-"`。**只加这一个字段**，未动其它配置。
- **构建证据**：`/tmp/build-adhoc.log` 里**首次出现签名动作**（第一版日志一次都没有）：
  ```
       Signing with identity "-"
  Signing .../target/release/bundle/macos/IT Toolbox.app/Contents/MacOS/it-toolbox
  Signing .../target/release/bundle/macos/IT Toolbox.app
  .../IT Toolbox.app: replacing existing signature
          Warn skipping app notarization, no APPLE_ID & ... found
  ```
  （公证被跳过是**预期**：本项目没有 Apple 开发者账号，只做 ad-hoc 签名。）
- **修复前后对照（同一命令，两版产物）**：

  | 检查项 | 修复前 | 修复后 |
  | --- | --- | --- |
  | arm64 `codesign --verify` | 1 | **0** |
  | x64 `codesign --verify` | 1（`not signed at all`） | **0** |
  | `Identifier` | `it_toolbox-8e0a1fed3f352069`（链接器生成的） | **`ai.it-toolbox.desktop`**（bundle id） |
  | `flags` | arm64 `0x20002(adhoc,linker-signed)`；x64 无 | 两者均 `0x10002(adhoc,runtime)` |
  | `_CodeSignature/CodeResources` | arm64 缺、x64 无 | **有** |
  | `spctl --assess -vv` 文本 | arm64：`code has no resources but signature indicates they must be present`（结构性损坏 → 「已损坏」类别） | **`rejected`**（无签名级错误 → 「未验证的开发者」类别） |
- **带 quarantine 实测**：新 arm64 产物设 quarantine 后 `codesign --verify` **仍为 0**、`spctl` 文本是干净的 `rejected`；`open` 无实例，`syspolicyd` 记录 `Terminating process due to Gatekeeper rejection`（拒绝原因仍被系统打成 `<private>`，故**弹框原文无法脚本取证**）。
- **回归检查**：签名后两架构经 `open`（同 Finder 双击）**均正常启动**、**运行期出网 socket 数 0**；`lsappinfo` 里可见 `IT Toolbox Web Content`（WebKit 的 WebContent 进程）→ **hardened runtime 未影响 WKWebView 初始化**；`codesign -d --entitlements -` 为空（Tauri 未附加权限项）。
- **仍未验证（一条人眼）**：**新产物**带 quarantine 双击的弹框原文。手工补签样本上执行人已确认是「未验证的开发者＋仍要打开」，新产物落在**同一类别**（`spctl` 干净 `rejected`），但严格说**人眼只验过手工样本**。带 quarantine 的新样本留在 `/tmp/qa3q/IT Toolbox.app`（`/tmp` 重启即失效）。
- **产物**：`IT Toolbox_0.1.0_aarch64.dmg`（15:15:12，2360133 B）、`IT Toolbox_0.1.0_x64.dmg`（15:16:24，2523660 B）。

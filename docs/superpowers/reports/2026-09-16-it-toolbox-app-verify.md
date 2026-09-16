# 验证报告：`it-toolbox-app`

- **日期**：2026-09-16
- **阶段**：comet 阶段 4（验证与收尾），`verify_mode: full`
- **变更**：`openspec/changes/it-toolbox-app`（workflow `full`、`build_mode: subagent-driven-development`、`isolation: branch`）
- **分支**：`it-toolbox-app`
- **HEAD**：`77e1352`（本次验证前最后一次实现/文档提交）
- **验证者**：控制器 + 8 个只读验证 subagent（7 个 capability 各一名 + 1 名设计一致性）
- **判定**：**无 CRITICAL；6 条 WARNING、8 条 SUGGESTION**。除两条待你决策（§6）外，**可归档**。

---

## 1. Summary

| 维度 | 结果 |
| --- | --- |
| **Completeness** | tasks.md **98 / 98** 全部 `[x]`；38 个 Requirement 均有实现；4 条实机验收任务**经用户批准**移出至 `manual-qa.md`（见 §4 偏差 D1） |
| **Correctness** | 193 个 Scenario：**覆盖 156 / 部分 23 / 未覆盖 12 / 实现有分歧 2**（未覆盖里 10 条属环境不可构造，见 §4） |
| **Coherence** | 10 项设计决策 **9 遵守 / 1 偏差 / 2 子项无法判定**；另有 1 处**设计文档滞后**（12 条新增 Scenario 未回填，见 §6） |

**自动化门禁（控制器串行实测，原始输出留档）**

| 命令 | 期望 | 实测 | 退出码 |
| --- | --- | --- | --- |
| `npm test` | 全绿 | `Test Files 67 passed (67)`、`Tests 820 passed (820)` | 0 |
| `npm run typecheck` | exit 0 | 无输出 | 0 |
| `npm run lint` | exit 0 | 无输出 | 0 |
| `npm run build` | exit 0（含 egress 扫描） | `✓ built in 455ms` + `[scan-egress] 网络 API 调用 0 处；远程 URL 字面量 7 处` + `通过：产物中未发现外发能力。` | 0 |
| `openspec validate it-toolbox-app` | 通过 | `Change 'it-toolbox-app' is valid` | 0 |
| `git status --porcelain` | 干净 | 空 | — |

已知 flake：`src/tools/crypto/token-generator/Tool.test.tsx` 在与 typecheck/lint 并行时偶发假红（本轮未命中；根因见 §5 S6）。

**验证方法**：8 个只读 subagent 各自把 capability 的每个 Scenario 对到「实现证据 `文件:行` + 用例证据 `文件:行` + 用例名」，判定 `覆盖/部分/未覆盖/实现有分歧`。**判定基于读用例源码 + 全量 820 条全绿**，未逐条实跑；凡只能靠实跑或真机才能定论的，一律进存疑清单而非默认覆盖。控制器对高风险项（两处 spec 分歧、覆盖表引用、4 处「未覆盖=环境不可构造」）逐条亲验。

---

## 2. Completeness

- **任务**：`openspec instructions apply` 报告 `98 / 98 complete, 0 remaining`；build 守卫 `tasks.md all tasks checked` PASS。
- **Requirement**：38 个（`app-shell` 9、`tool-registry` 11、`crypto-tools` 5、`converter-tools` 5、`web-tools` 4、`dev-tools` 3、`image-tools` 1），**全部找得到实现证据**，无「Requirement 未实现」。
- **Scenario**：193 个（`app-shell` 26、`tool-registry` 35、`crypto-tools` 29、`converter-tools` 33、`web-tools` 33、`dev-tools` 26、`image-tools` 11），逐条核对结果见 §3。
- **被批准的范围收窄**：`9.3` 断网冒烟、`9.4` 四平台构建、`9.6` 跨 WebView 冒烟、`9.10` Windows 前置条件 —— 四条原文移入 `openspec/changes/it-toolbox-app/manual-qa.md`（提交 `77e1352`），`tasks.md` 第 9 组留一行说明指向该文件。**四条均未执行**，是本次验收的**显式例外**，不是遗漏（`docs/superpowers/specs/2026-09-15-it-toolbox-design.md:498-506` 的「无法自动化的部分」早已把它们列为人工冒烟矩阵）。

---

## 3. Correctness：193 个 Scenario 的覆盖情况

| capability | Scenario | 覆盖 | 部分 | 未覆盖 | 实现有分歧 |
| --- | --- | --- | --- | --- | --- |
| `app-shell` | 26 | 7 | 9 | 10 | 0 |
| `tool-registry` | 35 | 23 | 8 | 2 | **2** |
| `crypto-tools` | 29 | 28 | 1 | 0 | 0 |
| `converter-tools` | 33 | 32 | 1 | 0 | 0 |
| `web-tools` | 33 | 33 | 0 | 0 | 0 |
| `dev-tools` | 26 | 25 | 1 | 0 | 0 |
| `image-tools` | 11 | 8 | 3 | 0 | 0 |
| **合计** | **193** | **156** | **23** | **12** | **2** |

### 3.1 那 12 条「未覆盖」的构成（关键：**没有一条**是「该测却没测」的能力缺口）

| 类别 | 条数 | 明细 |
| --- | --- | --- |
| 需真机 / 环境不可构造 | 8 | `app-shell`：断网使用全部工具、无第三方运行时请求、结构性阻断外发、构建产物扫描、不包含更新与遥测组件、构建 macOS 产物、构建 Windows 产物、Windows 前置条件三条；`tool-registry`：离线可用 |
| 由人工冒烟承接 | 2 | 同上表内的 `9.3/9.4/9.10` 与 `manual-qa.md` 对应 |
| 可自动化却无用例 | 2 | `tool-registry`「算法逻辑位于 Core 层」（需人工核 `Tool.tsx`/`meta.ts`，或加一条静态断言）；`tool-registry`「离线可用」按 spec 已声明为例外（同类先例 `core/json/parse.ts` 的 `TOO_DEEP`） |

### 3.2 两处「实现有分歧」（控制器已亲验代码）

| # | Scenario（逐字） | 期望 | 实际 | 证据 | 严重度 |
| --- | --- | --- | --- | --- | --- |
| **W1** | `无输入工具隐藏输入区`：「输入区**不占据界面空间**」 | 无输入工具隐藏输入区 | 标准形态**永远渲染** `Pane title="输入"`；UUID 生成器只是把说明文案塞进该槽位 —— 输入区仍占据约一半横向空间 | `src/framework/ToolLayout.tsx:37-44`（`hasBody ? … : 双 Pane`）、`src/tools/crypto/uuid-generator/Tool.tsx:143-156`（说明文案）、spec `specs/tool-registry/spec.md:145-148` | **WARNING**（观感与 spec 字面不符，无功能损失） |
| **W2** | `输入区高亮错误位置`：「输入区在对应行或字符位置给出**可见标记**」 | 出错行可见标记 | `CodeArea` 的 `errorLine` **只在只读分支生效**（可编辑 `textarea` 不显示任何高亮）；而全仓唯一传 `errorLine` 的地方 `json-diff/Tool.tsx` 是**可编辑**输入 → 界面实际无标记 | `src/framework/ui/CodeArea.tsx:28-31`（注释明写）、`:57-60`（`data-error` 只在只读分支）、`src/tools/web/json-diff/Tool.tsx:146,162`；spec `specs/tool-registry/spec.md:169-172` | **WARNING**（框架只完成了只读侧；要么修 `json-diff` 的落点，要么改 spec 口径） |

两条都**不是** CRITICAL：不涉及构建/测试失败、不涉及安全、不涉及核心验收路径；且都有「已实现一半」的成色（W1 有说明文案占位，W2 只读视图的高亮已由 `CodeArea.test.tsx:24` 钉住）。

### 3.3 23 条「部分」的代表项（完整清单在各 capability 的验证记录里）

- `app-shell` 9 条：多为「机制被钉住、端到端主张未被钉住」，如「窗口尺寸自适应」只钉了 720px 断点、未钉「按钮仍可见可点击」；「快捷键不与输入框冲突」未断言输入框 `value` 前后不变；「恢复各工具上次输入」的既有用例只覆盖 **options** 而非**输入文本**。
- `tool-registry` 8 条：注册校验的三条失败路径（缺配对 / id 重复）**实现有、无用例触发**；「仅加载当前工具」无懒加载证据；「复制失败回退」的 Tauri 分支 jsdom 不可达。
- `crypto-tools` 1 条：UUID「格式选项」缺「关闭连字符 + 开启大写」**组合态**断言（两侧单独断言都过，组合可能漏）。
- `converter-tools` 1 条：Markdown「复制 HTML 源码」未点复制、未断言剪贴板内容。
- `dev-tools` 1 条：压缩「语义等价」只断言「可再次解析」，未与原文做语义相等比较。
- `image-tools` 3 条：彩色二维码的**扫码识别**、PNG 端到端落盘、复制图片到系统剪贴板 —— 均为 jsdom 造不出的可视/系统行为。

---

## 4. Coherence：设计决策遵守情况

| # | 决策 | 判定 | 关键证据 |
| --- | --- | --- | --- |
| 1 | D2/§2 分层与依赖方向单向 | 遵守 | `eslint.config.js:64-205` 规则真实存在（core 禁 React/Tauri/DOM、framework 禁 `@/app`+`@/tools`）；抽查 core/framework/tools 违规导入 **0 命中**；唯一豁免 `offline-guard.ts` 与 §5 设计一致 |
| 2 | D3 声明契约（`meta.ts`+`Tool.tsx`、id=目录名、无中心清单） | 遵守 | 17/17 配对；`registry.ts:36-40` 靠 `import.meta.glob`；不变式校验 `registry.ts:79-158` |
| 3 | D4 加密基于 WebCrypto | 遵守 | `crypto.subtle`/`getRandomValues`（`hmac.ts:80,87`、`rsa.ts:87,98,111`、`random.ts:13,36`）；第三方加密库与 `Math.random` **0 命中** |
| 4 | D5 错误模型 `Result<T>` | 遵守 | `core/result.ts:8-33`；解析类均返回 Result。轻微超范围：`hmac.ts:47` 对非法 hex 密钥也返回 Result（有注释论证，不违规） |
| 5 | D6 ToolLayout 强制一致性 | 遵守 | 17/17 `Tool.tsx` 均经 `ToolLayout`；无自造输入输出框 |
| 6 | D7 搜索在元数据层 + localStorage 持久化 | 遵守 | `search.ts:115-121` 只读 `entry.meta`，从不 `entry.load()`；`storage.ts:34-51` |
| 7 | D8/§6 打包 | **偏差** | `targets:["dmg","nsis"]` ✓、`webviewInstallMode: skip` ✓；**但 GitHub Actions 四平台矩阵未落地**（`.github/` 不存在，全仓无 workflow）—— 见 W4 |
| 8 | §5 离线四层强制 | 遵守 | ①CSP `tauri.conf.json:28-32`（`ipc:`+`http://ipc.localhost` 双写法、生产无 `unsafe-eval`/`ws:`）②`offline-guard.ts:73-143` + `main.tsx:9-11` 动态 import ③`scripts/scan-egress.mjs` 接入 `build` ④`core/converter/markdown.ts:37-74` 不产出 `<img>`/`<a href>` |
| 9 | §7 依赖清单 | 遵守 | 运行时依赖恰 **9 个**；「明确拒绝」清单 0 命中（无 updater、无字体/CDN、无遥测、无第三方加密库） |
| 10 | §10 的 P1–P8 修订 | 遵守（8/8） | P1 `app-shell:24-29`、P2 `:141-153`、P3 `tool-registry:155-177`、P4 `converter-tools:5,17-25`、P5 `dev-tools:5,27-84`、P6 `app-shell:83-125`、P7 `:155-172`、P8 `converter-tools:163-171` |

**偏差 D1（用户已批准）**：`tasks.md` 第 9 组 4 条实机验收任务移出至 `manual-qa.md`（提交 `77e1352`）。这是**范围收窄**，已按用户 2026-09-16 的选择执行，并在本报告 §2 记为显式例外。

**无法判定 2 项**：① ESLint 分层规则的**运行时**强制力（静态确认配置正确、`lint` 实测 exit 0，但未注入违规导入做反证）；② macOS `minimumSystemVersion: "10.15"` 是否与设计一致（**两份设计文档均未规定该值**，无基线可比）。

---

## 5. Issues by priority

### CRITICAL（必须在归档前修复）

**无。**

### WARNING（建议修复）

| # | 问题 | 证据 | 建议 |
| --- | --- | --- | --- |
| **W1** | 「无输入工具隐藏输入区」未满足：标准形态永远渲染输入 Pane | `ToolLayout.tsx:37-44`、`uuid-generator/Tool.tsx:143-156` | 二选一：给 `ToolLayout` 加「无输入」形态（`input` 省略时不渲染该 Pane）；或在 spec 里明确「无输入工具以说明文案占位」并补用例 |
| **W2** | 「输入区高亮错误位置」在可编辑输入区不生效：`CodeArea` 的 `errorLine` 仅只读分支响应，而唯一传参者 `json-diff` 是可编辑态 | `CodeArea.tsx:28-31,57-60`、`json-diff/Tool.tsx:146,162` | 二选一：让可编辑 `textarea` 也标错（如行内 `aria-invalid` + 边框/底色）；或改 spec 为「只读视图提供高亮」并把这一裁定写进设计文档 |
| **W3** | **设计文档滞后（漂移）**：`dev-tools`「JSON 树形视图」8 条 + `tool-registry`「JSON 只读视图的语法高亮」4 条**在两份设计文档中均无任何记录**（§10 修订表只有 P1–P8；§3.1 模块清单无 `tree.ts`；§3.7/§11 均无） | 反查证据：`design.md:31-193`、`docs/superpowers/specs/2026-09-15-it-toolbox-design.md:70-87,110-151,186-213,520-533,537-547` 全无命中；要求实际出处是 `tasks.md:118-129` 与 `.superpowers/sdd/2026-09-16-it-toolbox-json-view/` | **待你决策，见 §6 Q1（A/B/C）** |
| **W4** | D8/§6.3 承诺的 GitHub Actions 四平台矩阵未落地 | `.github/` 不存在、全仓无 workflow；`design.md:152-157`、技术设计 `:427-437` | 补 `.github/workflows/build.yml`（四平台矩阵），或在设计文档里降级为「本地构建 + 人工验收」并记录理由 |
| **W5** | 可自动化却无用例的覆盖缺口（非环境依赖）：`scan-egress.mjs` 无脚本级用例；`offline-guard` 的 `XMLHttpRequest` 拦截与控制台提示无用例；「收藏重启后仍在收藏区」无用例；注册一致性校验的三条失败路径无触发用例；`useToolState.reset()` **无任何消费方**（死代码） | `scripts/scan-egress.mjs`、`framework/offline-guard.ts:73-143`、`framework/useToolState.ts:53-56`、`registry.ts:129-158` | 逐条补最小用例；`reset()` 要么接入「清空」要么删掉 |
| **W6** | `json-format` 两条「非法/空输入」钉子咬合力偏弱：`json-tree === null` 本身不咬人（树分支只在 `result.ok` 内可达），真正咬人的是 `role=alert` 与「尚未输入」文案；且两条断言**与 `view` 无关**（删掉树分支也照样绿） | `json-format/Tool.test.tsx:264,275`、`Tool.tsx:167-170,199-204` | 断言改成「切到树形视图后仍无 `json-tree` **且** 有 alert」，或加一条「非法输入时树形按钮不可用」的正面钉子 |

### SUGGESTION（可选）

| # | 建议 |
| --- | --- |
| S1 | 23 条「部分」按 §3.3 逐条补强（优先：UUID 格式组合态、Markdown 复制断言、app-shell 的「输入文本恢复」与「快捷键不改内容」） |
| S2 | `\/` 只在 Core `raw` 层有钉子，两个视图的渲染断言都没覆盖它（`\u0041`/`1e2` 有）；`JsonCode` 的「拼回等于原文」是通用性质，风险低，补一条更稳 |
| S3 | 树视图**键名走解码**（`core/json/tree.ts:182` 用 `JSON.parse(keyToken.raw)`），只有**值**走原文切片 —— 与「标量原文保真」的边界在 spec 里没写清，且无含转义/重复键的键名用例 |
| S4 | 重复键文档下「类型标签一一对应」不成立（`tree.test.ts:190` 注释已限定「无重复键」，spec 未限定）；建议在 spec 里补一句口径 |
| S5 | `image-tools` 的 PNG 落盘一致性、复制图片到系统剪贴板、彩色码扫码识别建议在 `manual-qa.md` 补一条**专用**手测项（现仅靠 `9.3`/`9.6` 泛化覆盖） |
| S6 | flake 根因：`src/tools/crypto/token-generator/Tool.test.tsx:115` 的 `vi.waitFor` **未传 timeout**（默认 1000ms 去等 200ms 去抖，余量仅 800ms），而 `uuid-generator/Tool.test.tsx:139` 传了 `{timeout:3000}`；建议统一 |
| S7 | `src/core/json/roundtrip.test.ts:9-13` 注释已过期（声称 spec 漏写「未开启键排序」限定词，实际 `spec.md:98` 已含） |
| S8 | 计划执行记录里「其余 22 条不点复制」应为 **23** 条（`json-format/Tool.test.tsx` 共 24 条 `it`） |

---

## 6. 待用户决策

### Q1（必答）：设计文档漂移（W3）怎么处理？

按 comet-verify 的规程，`delta spec 有内容但 design doc 未体现` 必须由你选：

- **选项 A**：在技术设计文档追加「Implementation Divergence」节，记录这两组要求的实际设计决策（`JsonCode` 复用 `scanJson` token 流、`JsonTree` 与 `type-hints` 同口径、只读视图必须走框架层统一组件）与「为何未回填」。选项 A 属 verify 阶段允许产物。
- **选项 B**：退回 build 阶段（`transition verify-fail` → `/comet-build`），由 `/comet-build` 走 `brainstorming` 更新 Design Doc + delta spec。
- **选项 C**：确认偏差可接受，继续验证（归档时 design doc 会被标记 `superseded-by-main-spec`）。

### Q2：分支怎么处理？

`isolation: branch`，当前分支 `it-toolbox-app`（HEAD `77e1352`）。四选一：本地合并到主分支 / 推送并创建 PR / 保持分支稍后处理 / 丢弃工作。**未获你的选择前不会写 `branch_status: handled`。**

---

## 7. 证据与留痕

- 实现提交链：`98121b5`（Task 1）→ `77e1352`（第 9 组任务移出），本增量含 12 个提交（含 5 个控制器修正提交 `a7d132d`/`f9728cb`/`0de06ce`/`e4569e4`/`55e9ed6`）。
- 执行账本：`.superpowers/sdd/2026-09-16-it-toolbox-json-view/progress.md`（含全部裁定 Ruling 1–25 与两阶段审查结论）。
- 覆盖表（12 条 JSON 视图 Scenario）：`docs/superpowers/plans/2026-09-16-it-toolbox-json-view.md` 末尾「执行记录」（控制器机器核验：12 行逐字同序、19 处 `文件:行` 引用零错行、18 个被引 `it` 名全部命中）。
- 实机验收清单：`openspec/changes/it-toolbox-app/manual-qa.md`（4 条，状态均为「未执行」）。
- 本报告由 8 个只读 subagent 的逐条核对结果汇总，控制器亲验了 W1/W2 两处分歧、4 处「未覆盖＝环境不可构造」与全部自动化门禁。

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

---

## 8. 归档阶段补充记录（验证后追加）

### 8.1 两项待决策的落定

- **W3（设计文档漂移）→ 选 A**：已在技术设计文档追加 `## 12. Implementation Divergence`（提交 `323e25c`），记录两组 JSON 视图要求（`tool-registry` 语法高亮 4 条 + `dev-tools` 树形视图 8 条）的落点、8 条实际固化的设计决策与「未回填」原因；W1/W2 仅注明未裁定，指向本报告 §5。
- **分支处理 → 本地合并到主分支**：`main (7b01959) → it-toolbox-app (a742ecc)` 共 **102 个提交 / 210 文件 / +42464 −105**，主分支独有提交 **0**，以 **`--ff-only` 快进**合并（无 merge commit、未改写历史）；合并后 `main` = `a742ecc`，`main..it-toolbox-app` 剩余 0。验证守卫四项全绿 → `verify_result=pass`、`verified_at=2026-09-16`、`phase=archive`（提交 `3f7af09`）。

### 8.2 归档执行结果

`comet-archive it-toolbox-app`：入口校验 PASS、**13/13 steps succeeded**（dry-run 预览与实际一致）。

- 7 份 delta spec 同步到 `openspec/specs/`：**38 Requirement / 193 Scenario**，与 delta 逐项条数一致（`app-shell` 9/26、`tool-registry` 11/35、`crypto-tools` 5/29、`converter-tools` 5/33、`web-tools` 4/33、`dev-tools` 3/26、`image-tools` 1/11）。
- change 移至 `openspec/changes/archive/2026-09-16-it-toolbox-app/`，其 `.comet.yaml` 中 `archived: true`。
- 设计文档与计划已加前置元数据：`archived-with: 2026-09-16-it-toolbox-app`、`status: final`。
- 收尾提交 `419eb91`。

### 8.3 新增发现 W7（归档脚本缺口，已当场修复）

**问题**：`comet-archive` 的 delta→主 spec 同步是**原样复制**。本次主 spec 为空（7 个 capability 全为新增、delta 用的是 `## ADDED Requirements`），于是 7 份主 spec 都缺 `## Purpose` / `## Requirements`，`openspec validate --specs` 报 **0 passed / 7 failed**（`Spec must have a Purpose section…`）。归档脚本本身退出码 0，如果只看脚本结果就会带着 7 份**不合法的 canonical spec** 收尾。

**修复**：把每份主 spec 的首行 `## ADDED Requirements` 改为 `## Purpose` + 目的说明 + `## Requirements`；目的说明**逐字取自归档内的 `proposal.md`**（各 capability 的 Capabilities 描述），不新造内容。修改后 `openspec validate`：**7 passed / 0 failed**，Requirement / Scenario 条数不变（38 / 193）。

**影响与建议**：仅影响「主 spec 为空 + 全新增」的首次归档；若主 spec 已有基线（走 `## MODIFIED` / `## REMOVED` 路径）不受影响。建议把这一条（同步后自动补 `## Purpose` 并跑一次 `openspec validate --specs`）反馈给 comet 的归档脚本，否则每个新项目第一次归档都会踩到。

---

## 9. 遗留项闭合记录（归档后追加）

本节记录归档之后对本报告 §5 遗留项的处置。**判定方向**：W1/W2 一律**让实现对齐已归档的 canonical spec** —— spec 是要求源，把要求降级去迁就实现不作为默认路径。

### 9.1 已闭合

| 项 | 处置 | 证据 |
| --- | --- | --- |
| **W1** 无输入工具仍占输入区 | `ToolLayout` 的 `input` 省略时**整个输入面板不渲染**，输出占满整宽；原「说明文案借输入面板占位」的做法改为新增的可选 `note` 槽位。四个无输入工具全部改完：`uuid` / `ulid` / `token` / `rsa-key` 生成器（不止 UUID 一个） | `ToolLayout.tsx`（`note` + `props.input !== undefined` 条件渲染）、四个工具 `input={…}` → `note={…}`；`ToolLayout.test.tsx` 新增 2 条 |
| **W2** 可编辑输入区对 `errorLine` 无反应 | 可编辑分支同样消费 `effectiveErrorLine`：容器 `data-error`、`textarea` 加 `aria-invalid` + 错误底色、右上角显示「第 N 行」角标。**形态边界如实记录：可编辑态是「整区标记 + 行号角标」，逐行高亮依旧只在只读视图** —— spec 只要求「给出可见标记」，故不再假称逐行 | `CodeArea.tsx`；`CodeArea.test.tsx` 新增 3 条（含 `errorOffset` 兜底换算与「无错误时不出现任何标记」） |
| **W4** 四平台 CI 矩阵未落地 | 新增 `.github/workflows/build.yml`：`verify`（lint / typecheck / test / build，含产物外发扫描）+ `bundle` 四平台矩阵（`macos-14`→dmg arm64、`macos-13`→dmg x64、`windows-latest`→nsis x64、`windows-11-arm`→nsis arm64），带 `concurrency` 取消旧跑批、Rust 缓存与产物上传。**runner 行为本机无法验证**：已用 js-yaml 解析确认结构、矩阵与设计文档 §6.3 逐项一致，首次真实跑批需在 GitHub 上观察。（`manual-qa.md` 的 `9.4` 另有进展：macOS 两架构已在 arm64 本机真跑完，见 §9.5 —— 该条由「未执行」变为「部分执行」） | `.github/workflows/build.yml` |
| **W5** 五处覆盖缺口 | ① `scripts/scan-egress.mjs` 支持 `SCAN_EGRESS_DIST` 注入 → 新增**脚本级用例**（干净产物 exit 0 / `fetch(` exit 1 并报行号 / 远程 URL 只告警 / 允许清单不计 / 目录缺失 exit 1），并为此加 `scripts` project；② `offline-guard` 补 XHR 拦截、本机放行、控制台提示 3 条；③ 收藏持久化补「模块重载后从 storage 回读」；④ `registry` 校验失败路径补 11 条合成用例；⑤ 死代码 `useToolState.reset()` 接入 `json-diff` 的「清空」（现在会连带抹掉该工具已落盘的快照） | 见 9.3 的新文件清单与新增用例 |
| **W6** `json-format` 两条断言咬合力弱 | 先钉「确实切到了树形视图」（`aria-pressed`），再断言无 `json-tree` —— 删掉树分支不再能照样绿 | `json-format/Tool.test.tsx` |
| **S1**（优先 4 项） | UUID 格式开关**组合态**（关连字符 + 开大写）；Markdown「复制 HTML 源码」真正点复制并断言剪贴板内容与「已复制」反馈；新建 `useToolState.test.ts` 直接钉「恢复上次输入」与「状态互不污染」；全局快捷键补「工具输入框内容前后逐字符不变」 | 见 9.3 |
| **S2** | `\/`（第三类可改写写法）在 `JsonCode` 与 `JsonTree` 两个视图各补一条钉子 | 同上 |
| **S3 / S4** | 写进 canonical spec（`openspec/specs/dev-tools/spec.md`）：「原文保真只针对**值**，成员名按解码后展示（`\u0041` → `A`）」；「类型标签一一对应」补上「**无重复键**的文档中」这一限定，使 spec 与实现、用例三者一致 | spec 两处逐字修改 |
| **S6 / S7 / S8** | `token-generator` 的去抖轮询补 `{ timeout: 3000 }`；`roundtrip.test.ts` 的过期注释改为反映主 spec 已含限定词；计划执行记录「其余 22 条」→**23 条**（该文件 24 条 `it`，除剪贴板那条外 23 条不点复制） | 同上 |

### 9.2 本轮新发现

| # | 问题 | 处置 |
| --- | --- | --- |
| **W8** | **注册校验对非法 meta 会多报一条自相矛盾的 `orphan-tool`**（「有 Tool.tsx 但缺少 meta.ts」，而它明明有 meta.ts）：`continue` 跳过了「把该目录从孤儿候选里摘掉」那一步。真实目录结构下不可能出现非法 meta，故这条噪声长期无人发现 | 已修：凡该目录的 meta.ts 存在（含导出非对象的分支）都先从 `toolByDirectory` 摘除；`registry.build.test.ts` 用混合场景（合法 + 非法 + 真孤儿）做回归钉子。**这条是新增用例当场咬出来的，不是读代码读出来的** |
| **W9** | W6 补断言使 `json-format/Tool.test.tsx` 行号位移（+3 / +6），计划覆盖表里 3 处 `文件:行` 引用随之失效 | 已校准（`275→278`、`299→305`、`321→327`）。**本报告 §5 的 W1/W2 证据行号指向修复前的代码，不回改**（那是 `77e1352` 时的快照），以本节为准 |
| — | `README.md` 的「单测分两个 project」在新增 `scripts` project 后已不成立 | 已改为三个 project 并说明各自环境 |
| **W10** | **两个 macOS 产物的签名状态不一致，且都过不了校验**：arm64 是 adhoc/linker-signed 但包内无 `_CodeSignature`（`codesign --verify` 退出码 1）；**x64 连签名都没有**（`code object is not signed at all`，`spctl --assess` 退出码 3 = `rejected, source=no usable signature`）。设计文档 `:437` 承诺「未签名产物首次启动需右键打开」，但该路径**从未验证**；且实测 **arm64 + quarantine ⇒ 直接 exec 被杀（5/5）**，带 quarantine 的副本能否经 Finder 启动仍是未知 | **根因已查明（§9.5.1）**：arm64 的签名来自链接器（Apple Silicon 强制），x64 无此要求；两侧 bundle 层都无签名，因为 `bundle.macOS` 未配 `signingIdentity`、Tauri 跳过了签名步骤 —— 不是 Tauri 缺陷。未改代码。已登记 `manual-qa.md` 执行记录 A 偏差栏 + 执行记录 C。**待决策（证据已更新）**：① 给 `bundle.macOS` 补 `signingIdentity: "-"`（adhoc，无需证书）—— **实测依据**：手工 `codesign --force --sign -` 后 `codesign --verify` 1→0（`valid on disk` ＋ `satisfies its Designated Requirement`），`spctl` 报错文本由**签名级错误**（`code has no resources but signature indicates they must be present`）变为**干净 rejected**，即把 arm64 从「**已损坏**（无『仍要打开』）」拉回「**未验证的开发者**（有『仍要打开』）」；② 维持现状＋README 写明未签名并给出**已实测**的兜底 `xattr -dr com.apple.quarantine`；③ Developer ID＋公证（设计文档明确本 change 不申请证书）。**注意**：arm64 现状**比「完全未签名」更糟**（x64 未签名反而有『仍要打开』），这是①的现实理由。①收尾需一次人眼双击 `arm64-adhoc` 样本确认弹框类别 |

### 9.3 本轮门禁（控制器实测）

| 命令 | 期望 | 实测 | 退出码 |
| --- | --- | --- | --- |
| `npm test` | 全绿 | `Test Files 70 passed (70)`、`Tests 859 passed (859)`（含新增 `registry.build` 12 / `useToolState` 5 / `scan-egress` 5） | 0 |
| `npm run typecheck` | exit 0 | 无输出 | 0 |
| `npm run lint` | exit 0 | 无输出 | 0 |
| `npm run build` | exit 0（含 egress 扫描） | `[scan-egress] 网络 API 调用 0 处；远程 URL 字面量 7 处` + `通过：产物中未发现外发能力。` | 0 |
| `openspec validate --specs` | 通过 | `7 passed, 0 failed`（S3/S4 改的是主 spec，非 delta） | 0 |

新增测试文件：`src/framework/registry.build.test.ts`、`src/framework/useToolState.test.ts`、`scripts/scan-egress.test.mjs`。

### 9.4 仍未闭合（如实列出）

- **`manual-qa.md` 的 4 条实机验收**：`9.4` 的 **macOS 两架构已执行**（§9.5），状态由「未执行」改为「**部分执行**」（Windows 两架构仍缺）；`9.3` **仍为未执行**（本轮只补了运行期旁证，17 工具走查是它的主体）；`9.6`（跨 WebView，需 Windows 一侧）与 `9.10`（Windows 前置条件）**仍为未执行**。新加的 CI 只是把 Windows 两架构与 `9.4` 全量变成「可以在 CI/Windows 上做」，**不等于做过** —— 首次跑批结果需回填该文件。
- **W1/W2 的形态边界**：可编辑输入区是「整区标记 + 行号角标」而非逐行高亮（见 9.1）。
- **S1 的其余「部分」条目**（`app-shell` 的窗口断点、懒加载证据、Tauri 剪贴板回退分支等）与 **S5**（`image-tools` 的 PNG 落盘 / 复制图片 / 彩色码扫码建议在 `manual-qa.md` 补专用手测项）未逐条处理。
- **`scan-egress` 的允许清单**目前是 5 条正则的白名单：新增依赖若引入新的合法远程字面量，告警数会上升（不致命），需要人工判断是否入清单。

### 9.5 实机验收原始数据（2026-09-16 归档后，脚本化部分）

环境：macOS **26.3.1**（BuildVersion `25D771280a`）、**arm64**、Node **v23.7.0**、rustc **1.96.0**。执行方式：脚本化，**无 GUI 交互**（未做窗口操作、未截图）。记录同步回填到 `manual-qa.md`「执行记录 A/B」。

**构建（`9.4` 的 macOS 两架构）**

| 架构 | 命令 | 产物 | 体积 | 构建 |
| --- | --- | --- | --- | --- |
| arm64 | `npm run tauri:build` | `src-tauri/target/release/bundle/dmg/IT Toolbox_0.1.0_aarch64.dmg` | 2,362,828 B（2.25 MiB） | PASS（`Finished release profile in 50.36s`） |
| x64 | `npm run tauri:build -- --target x86_64-apple-darwin` | `src-tauri/target/x86_64-apple-darwin/release/bundle/dmg/IT Toolbox_0.1.0_x64.dmg` | 2,487,009 B（2.37 MiB） | PASS（先 `rustup target add x86_64-apple-darwin`） |

两个体积都远低于 15MB 上限；`lipo -info` 确认包内可执行文件分别为 `arm64` / `x86_64` 单一架构（**不是** universal 包，与四平台矩阵的设计一致）。

**签名与 Gatekeeper 判定（两个产物都失败，且失败方式不同）**

| 产物 | `codesign --verify` | `spctl --assess --type execute -vv` |
| --- | --- | --- |
| arm64 | 退出码 **1**：`code has no resources but signature indicates they must be present` | 退出码 **1**，同一消息 |
| x64 | 退出码 **1**：**`code object is not signed at all`**（`In architecture: x86_64`） | 退出码 **3**：**`rejected` / `source=no usable signature`** |

**启动证据（两架构各一份，均在本机、无 quarantine）**

| 检查 | arm64 | x64 |
| --- | --- | --- |
| 进程存活（18s 后） | 是 | 是（Rosetta 下，`arch -x86_64` 可用） |
| `lsappinfo` 注册 | `type="Foreground"`、`Version="0.1.0"`、`Arch=ARM64` | `type="Foreground"`、`Version="0.1.0"`、`Arch=x86_64` |
| WebView 创建 | 随启动新出现 3 个以本应用命名的 WebKit XPC 进程（`Networking` / `GPU` / `WebContent`） | 同左 |
| 网络 socket | 应用进程 + 3 个 WebKit 进程 **各 0 条** | 同左 |
| 运行期 stderr/stdout | 空 | 空 |

「新出现」用启动前后 `pgrep -f com.apple.WebKit` 的**集合差集**取得，并逐个 `ps -p <pid>` 校验 PID 有效后才计入结论 —— 第一次尝试直接 `pgrep` 时抓到的是 PID 906~954 那批（属于别的应用，含 IDE 自带 WebKit），**不可归属，已弃用不计**。

**过程自查（两次假绿，都发生在同一处）**

`zsh` 不对未加引号的变量做分词：`for pid in $NEW` 把多个 PID 当成**一个**参数传给 `lsof`，`lsof` 报「无此进程」→ 输出为空 → 被读成「0 个网络 socket」。**第一次我还把它当成结论汇报了，随后自查发现并重做**；最终改用 `bash -c`（强制分词）+ PID 有效性校验 + 非空断言。对「0 出网」这种**结论依赖空输出**的检查，假绿与真绿长得一模一样 —— 这条已写进 `manual-qa.md` 供下次执行者避开。

**本次没有验证的（不得从上面的数据推出）**

1. 「分发给他人后首次启动」：未构造 quarantine、未走 Finder 双击/右键打开、系统设置里的「仍要打开」也未试；
2. 界面可用性：未做任何窗口操作（窗口几何查询需辅助功能授权，`osascript` 返回 `-1719 不允许辅助访问`，未申请该权限）；
3. 17 个工具的逐个操作（`9.3` 主体）；
4. 文件拖放、剪贴板、WebCrypto 的**真机**行为（`9.6`）；
5. 任何 Windows 侧行为（构建、WebView2、`webviewInstallMode = skip` 的失败提示，即 `9.4` 的 Windows 两格与 `9.10`）。

#### 9.5.1 签名根因与 quarantine 专项（同日追加，证据与命令见 `manual-qa.md` 执行记录 C）

**根因（决定性实验：同一份 C 源码，只换架构）**

| 编译命令 | 签名 | `codesign --verify` |
| --- | --- | --- |
| `cc -arch arm64` | `flags=0x20002(adhoc,linker-signed)`、`Signature=adhoc` | **0** |
| `cc -arch x86_64` | 无签名（`not signed at all`） | **1** |

结论：**arm64 的签名来自链接器**（Apple Silicon 要求 arm64 二进制必须签名才可执行），x86_64 无此要求；**Tauri 全程未执行签名**（两份打包日志里 `codesign` / `signing` 零次出现，因为 `bundle.macOS` 没有 `signingIdentity`）。所以两侧 **bundle 层都没有 `_CodeSignature`** —— 这才是 arm64 那句 `code has no resources but signature indicates they must be present` 的成因。

手工 `codesign --force --sign -` 可把 `codesign --verify` 从 **1 修到 0**（`_CodeSignature/CodeResources` 出现、`Identifier` 变为 bundle id），但 `spctl --assess` **仍 exit 3**，且**并不足以让 quarantine 下的 arm64 副本变得可运行**。

**quarantine 对照（只取一致结论）**：**arm64 + quarantine ⇒ 直接 exec 被杀（`Killed: 9`，退出码 137），5/5 一致**；x64 各行互相矛盾（含「无 quarantine 却被杀」的对照组失败），**全部不采用**。

**第三个测量陷阱（已查明）**：直接 exec **带 quarantine 的 `.app` 内**的可执行文件，macOS 会 **App Translocation** 后另行启动（PPID=1；`lsappinfo` 可见 `pre-translocationBundlePath=/private/tmp/qa-mx/original-x64/IT Toolbox.app`）。「`kill -0` 说存活」测到的是**转译后那个进程**，于是被误读为「Gatekeeper 放行」。该转译实例实测连续运行 >1 分钟、**无任何对话框**，已清理。
→ **「quarantine 应用能否首次启动」不能用「直接 exec + 存活探测」判定**，必须走 Finder 双击 / 右键打开并由人观察对话框。

**已实测可用的兜底**：`xattr -dr com.apple.quarantine "<app 路径>"` 后启动正常（本轮两架构的启动冒烟均以此为前提）。

**LS 路径复现**：`open "<app>"`（与 Finder 双击同一条路径）对带 quarantine 的 arm64 原始产物：`open` 退出码 0 但**无任何实例启动**，同秒 `syspolicyd` 记录 `Terminating process due to Gatekeeper rejection`（原因被打成 `<private>`，脚本拿不到文字），`CoreServicesUIAgent` 在加载偏好 → 弹框由它出，**复现成功**。

**判定对照（`spctl` 报错文本区分「签名坏了」与「只是没签名」）**

| 样本 | `codesign --verify` | `spctl --assess -vv` 文本 | 弹框类别（推断） |
| --- | --- | --- | --- |
| arm64 原始 | 1 | `code has no resources but signature indicates they must be present`（签名结构性损坏） | **「已损坏…应移到废纸篓」，无「仍要打开」** |
| x64 原始 | 1 | `not signed at all` / `rejected, source=no usable signature` | 「未验证的开发者」＋「仍要打开」 |
| arm64 手工补 adhoc | **0**（`valid on disk`、`satisfies its Designated Requirement`） | `rejected`（无签名级错误） | 「未验证的开发者」＋「仍要打开」 |

**关键结论：arm64 产物当前比「完全未签名」更糟。** 「Apple Silicon 强制 arm64 必须有签名」×「Tauri 未做 bundle 签名」叠加后，主可执行文件有链接器的 adhoc 签名、bundle 却缺 `_CodeSignature`，签名**结构不自洽** → 落进「已损坏」这个**连『仍要打开』都没有**的类别；x64 没签名反而落在**有**「仍要打开」的类别。补 adhoc 签名能把 arm64 从「已损坏」拉回「未验证的开发者」，这是 W10 选项①的实测依据。

**仍未验证**：上表第三列是**推断**（由 `codesign`/`spctl` 判定文本推出），落成结论需一次人眼双击 `arm64-adhoc` 样本。执行人已实测「带 quarantine 的副本打不开」并删除样本，但**未记录对话框原文、未说明是否试过「右键→打开」**，故设计文档 `:437` 的承诺既未被证实也未被证伪。此外 `syspolicyd` 把拒绝原因打成 `<private>`，**这条路无法脚本取证**。

### 9.6 第二版产物复测（含 JSON 折叠功能，2026-09-16）

§9.5 验的是 14:42 / 14:46 那版产物；此后代码有实质改动（JSON 折叠，提交 `b64c5bf`），产物与代码不再对齐，故重新打包复测。**构建时工作区干净、HEAD = `b64c5bf`**，`beforeBuildCommand` 会在打包时重建前端（含类型检查与外发扫描）。

| 架构 | 产物 | 大小 | 主可执行文件架构 | `codesign --verify` | 真启动 | 运行期 socket |
| --- | --- | --- | --- | --- | --- | --- |
| arm64 | `IT Toolbox_0.1.0_aarch64.dmg` | 2.3M（解开 4.0M） | `arm64` | 1 | 存活 8s | **0** |
| x64 | `IT Toolbox_0.1.0_x64.dmg` | 2.4M（解开 4.4M） | `x86_64` | 1 | 存活 8s | **0** |

- **签名状态与 §9.5 完全一致**（arm64 仍是链接器 adhoc、bundle 无 `_CodeSignature`；x64 仍完全未签名）—— W10 尚未处置，本轮**未改签名配置**。
- **「改动确实在包里」的取证**：`Contents/Resources/` 只有 `icon.icns`，Tauri 把前端资源**内嵌并压缩**，故「在二进制里 grep 字符串」这条找法**不适用**（实测 grep 不到，不代表功能没进去）；改用对账法 —— `dist/assets/JsonCode-*.js` 含 `json-code-fold-bar` 与明文「全部折叠」，且 **dmg 内二进制与构建产物 hash 完全一致**（arm64 `d3bbf46816d84c7b…`、x64 `360371b91ad5a1ea…`），而该构建的前端由 `b64c5bf` 重建。
- **本轮门禁**（提交前实测）：单测 **71 文件 / 887 用例全过**、`tsc --noEmit` 通过、`eslint .` 通过、`npm run build` 通过且外发扫描仍为 **0 处网络 API**。验证期间对 8 个改动文件做前后 `shasum` 比对，**指纹一致**（未被并行改动污染）。
- **测法更正（重要）**：本轮用 `open`（与 Finder 双击同路径）复核时出现过一次「退出码 0 但无实例」，**0/4 未能复现**（3 个全新路径出实例耗时 77 / 75 / 83 ms）。同时校正：**无 quarantine 时两架构的原始产物都能双击启动**（本轮 7/7），签名结构问题**只在带 quarantine 时致命**；§9.5.1 中「无实例」那半个观测据此降级为**辅助**，其结论只以 `syspolicyd` 拒绝日志为凭。
- **遗留**：UI 层折叠交互未人眼验证；`9.4` 的 Windows 两架构、`9.6`、`9.10` 仍缺 Windows 环境；W10 的「右键打开」分叉仍待一次人眼双击。

### 9.7 W10 ① 落地：ad-hoc 签名修复与验收（2026-09-16）

- **决策**：执行人确认 ① 的目标类别（手工补签样本的双击弹框为「未验证的开发者＋仍要打开」），据此改动**一个字段**：`src-tauri/tauri.conf.json` 的 `bundle.macOS.signingIdentity = "-"`。
- **构建证据**：`/tmp/build-adhoc.log` 首次出现 `Signing with identity "-"`（**第一版日志里签名动作一次都没出现**），随后 `Signing .../MacOS/it-toolbox`、`Signing .../IT Toolbox.app`、`replacing existing signature`；公证按预期跳过（无 Apple 账号环境变量）。
- **修复前后（两版产物的同一组命令）**：

  | 检查项 | 修复前 | 修复后 |
  | --- | --- | --- |
  | arm64 `codesign --verify` | 1 | **0** |
  | x64 `codesign --verify` | 1（`not signed at all`） | **0** |
  | `Identifier` | `it_toolbox-8e0a1fed…`（链接器） | **`ai.it-toolbox.desktop`** |
  | `flags` | `0x20002(adhoc,linker-signed)` / x64 无 | 均 `0x10002(adhoc,runtime)` |
  | `_CodeSignature/CodeResources` | 缺 / 无 | **有** |
  | `spctl` 文本 | arm64 `code has no resources…`（结构性损坏 → 「已损坏」） | **干净 `rejected`**（→「未验证的开发者＋仍要打开」） |

- **带 quarantine 实测**：新 arm64 产物 `verify` 仍 **0**、`spctl` 干净 `rejected`；`open` 被拒，`syspolicyd` 有 `Terminating process due to Gatekeeper rejection`（原因字段 `<private>`，弹框原文无法脚本取证）。
- **回归**：签名后两架构经 `open` 均正常启动、运行期出网 socket **0**、`lsappinfo` 有 `IT Toolbox Web Content`（WebKit 进程）→ hardened runtime 不影响 WebView；entitlements 为空。
- **新产物**：`aarch64.dmg` 2.36MB（15:15:12）、`x64.dmg` 2.52MB（15:16:24）。
- **仍待一条人眼**：新产物带 quarantine 双击的弹框原文（样本 `/tmp/qa3q/IT Toolbox.app`，重启即失效）。

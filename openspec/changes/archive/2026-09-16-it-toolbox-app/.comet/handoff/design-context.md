# Comet Design Handoff

- Change: it-toolbox-app
- Phase: design
- Mode: compact
- Context hash: 1f792b3d2263546029ea1d91d657a98f2c0f78fdf9c6f9abdceb3124bf557ff6

Generated-by: comet-handoff.sh

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/it-toolbox-app/proposal.md

- Source: openspec/changes/it-toolbox-app/proposal.md
- Lines: 1-85
- SHA256: 20e845fb37a0afbdcefeb919fae30befa246fe46b0bf24e0a389ae6bb16b07b5

[TRUNCATED]

```md
## Why

开发者日常需要在十几个在线站点之间跳转来完成 token 生成、JWT 解析、YAML 转换、二维码生成等琐碎任务，这些站点普遍存在三类问题：把敏感数据（私钥、token、JWT 载荷）上传到第三方服务器、充斥广告与追踪脚本、以及断网即失效。本 change 交付一个**完全离线、零外发请求**的桌面工具箱，把 17 个高频 IT 小工具收敛到单一应用中，产物体积控制在 15MB 内，并建立一套「新增工具零框架改动」的扩展机制。

## What Changes

- 新建 Tauri 2.x 桌面应用骨架，前端为 React + TypeScript + Vite，Rust 侧仅承担窗口管理、文件读写与导出能力
- 建立**声明式工具注册机制**：每个工具是一个自包含目录，通过 `defineTool()` 声明元数据与组件，框架自动完成路由、侧栏分类、全局搜索、最近使用与收藏
- 建立与 UI 解耦的 **Core 纯逻辑层**，所有算法以纯函数实现并可独立单测，不依赖 DOM 或 Tauri API
- 交付 **17 个工具**，按 5 个类别组织：
  - 加密类（5）：Token 生成器、UUID 生成器、ULID 生成器、HMAC 生成器、RSA 密钥对生成器
  - 转换器（5）：日期转换器、Base64 编码/解码、YAML→JSON、JSON→YAML、Markdown→HTML
  - Web（4）：URL 编码/解码、JSON 差异比较、JWT 解析器、URL 分析器
  - 图片（1）：二维码生成器
  - 开发（2）：JSON 压缩、JSON 美化格式化
- 建立统一交互契约：输入/输出面板、一键复制、文件拖入与导出、错误提示、结果持久化到本地
- 配置 Tauri 打包流水线，产出 macOS arm64/x64 的 `.dmg` 与 Windows x64/arm64 的 `.exe`
- 明确**非目标**（见下）

### 非目标

- 不做账号体系、云同步、遥测或任何形式的网络上报
- 不做证书签名与公证流程（仅预留配置位，签名证书由使用者自备）
- 不做移动端与 Linux 产物
- 不引入任何在线 API 依赖（含二维码、Markdown 渲染均在本地完成）

## Capabilities

### New Capabilities

- `app-shell`: 桌面应用外壳 —— 窗口管理、应用布局（侧栏分类 + 工具面板）、亮暗主题、全局快捷键、本地偏好持久化，以及四平台打包产物（.dmg / .exe）
- `tool-registry`: 工具注册与发现 —— `defineTool()` 声明契约、目录即工具的自动注册、分类分组、全局模糊搜索、最近使用与收藏、工具懒加载与错误边界
- `crypto-tools`: 加密类工具集 —— Token 生成器、UUID 生成器（v1/v4/v7）、ULID 生成器、HMAC 生成器、RSA 密钥对生成器
- `converter-tools`: 转换器工具集 —— 日期转换器、Base64 编码/解码、YAML 转 JSON、JSON 转 YAML、Markdown 转 HTML
- `web-tools`: Web 工具集 —— URL 编码/解码、JSON 差异比较、JWT 解析器、URL 分析器
- `image-tools`: 图片工具集 —— 二维码生成器（文本输入、前景/背景色、纠错等级与模块尺寸、导出 PNG/SVG）
- `dev-tools`: 开发辅助工具集 —— JSON 压缩、JSON 美化格式化

### Modified Capabilities

无（全新项目，`openspec/specs/` 为空）

## Impact

**新建代码结构**

```
src/
├── core/            # 纯逻辑层（零 UI / 零 Tauri 依赖，可单测）
│   ├── crypto/      # token, uuid, ulid, hmac, rsa
│   ├── converter/   # date, base64, yaml, markdown
│   ├── web/         # url-codec, json-diff, jwt, url-analyzer
│   ├── image/       # qrcode
│   └── dev/         # json-format
├── framework/       # 注册机制：defineTool / registry / useTools / ToolHost
├── components/      # 通用 UI：InputPanel / OutputPanel / CopyButton / FileDrop ...
├── tools/           # 17 个工具，每个一个目录
└── app/             # 布局、路由、主题、偏好
src-tauri/           # Rust 侧：窗口、文件读写、导出、打包配置
```

**新增依赖**

| 依赖 | 用途 | 备注 |
|---|---|---|
| `@tauri-apps/api` + `@tauri-apps/cli` | 外壳与打包 | 2.x |
| `react` / `react-dom` / `vite` / `typescript` | 前端基座 | |
| `tailwindcss` | 样式 | |
| `js-yaml` | YAML ↔ JSON | |
| `markdown-it` | Markdown → HTML | 本地渲染 |
| `qrcode` | 二维码生成 | 支持 Canvas 与 SVG |
| `diff` | JSON 差异比较 | 结构化 diff |
| `ulid` | ULID 生成 | 单调性支持 |
| `vitest` | Core 层单测 | |

**算法实现来源**

- UUID v1/v4/v7、ULID、HMAC、RSA、Token 随机性：优先使用 WebCrypto（`crypto.subtle` / `crypto.getRandomValues`），避免引入大体积加密库
- RSA 密钥对导出 PEM（PKCS#1 / PKCS#8 / SPKI / OpenSSH 公钥格式）

```

Full source: openspec/changes/it-toolbox-app/proposal.md

## openspec/changes/it-toolbox-app/design.md

- Source: openspec/changes/it-toolbox-app/design.md
- Lines: 1-192
- SHA256: 389182332085f7b29205e74743cbff516830eb00837896a3e7eec3eb61ffaee1

[TRUNCATED]

```md
## Context

一个从零开始的桌面 IT 工具箱。当前仓库只有 OpenSpec 脚手架，没有任何应用代码。

已锁定的约束：

- 外壳：Tauri 2.x（本机 Rust 1.96 可用）
- 产物：macOS arm64/x64 的 `.dmg` + Windows x64/arm64 的 `.exe`（NSIS）
- 首版范围：全量 17 个工具，分 5 类
- 数据敏感性：工具处理 token、JWT 载荷、RSA 私钥，**必须 100% 本地执行、零外发请求**

核心设计张力：**首版要一次性交付 17 个工具，同时后续还要能低成本加工具。** 如果 17 个工具各自为政地写页面，那么第 18 个工具的成本不会降低；如果框架层过度设计，首版交付会被拖垮。本设计的全部取舍都围绕这一点：**把重复量最大的部分（元数据、布局、输入输出、复制导出、搜索路由）收敛进框架，把真正有差异的部分（算法）放进可单测的 Core 层，让单个工具的实现量降到接近于零。**

## Goals / Non-Goals

**Goals:**

- 新增一个工具的边际成本 = 1 个目录 + 2 个小文件 + 1 个纯函数，**不改动任何框架代码**
- Core 层 100% 纯函数、零 DOM 与零 Tauri 依赖，可在 Node 环境下用 Vitest 直接单测
- 单平台安装包体积 ≤ 15MB
- 断网可用，运行期无任何出网请求
- 框架层对 17 个工具形成强制的一致性（同样的输入输出布局、同样的复制/导出交互）

**Non-Goals:**

- 不做插件运行时（用户从外部安装第三方 JS 包）；本 change 的「可扩展」指**源码级扩展成本低**，而非动态加载不可信代码
- 不做国际化（首版仅中文界面，但文案集中管理，为后续 i18n 留位）
- 不做 CLI 版本（Core 层设计上可复用，但本 change 不实现）
- 不做工具在工作区内互相调用/编排

## Decisions

### D1. 外壳用 Tauri 2.x，而非 Electron

| 维度 | Tauri 2.x | Electron |
|---|---|---|
| 安装包体积 | ~8-15MB | ~120-200MB |
| 冷启动 | 依赖系统 WebView，快 | 需拉起 Chromium |
| 内存占用 | 低 | 高 |
| 原生能力 | Rust 插件 | Node 全栈 |
| 学习成本 | 需少量 Rust | 纯 JS/TS |

**理由**：本项目是**纯前端逻辑密集型**工具集，几乎不需要原生能力（仅需文件读写与导出），Tauri 的体积与内存优势直接命中「工具类常驻应用」的使用场景。Rust 侧只写少量胶水代码，不构成学习负担。

**代价**：WebView 不一致（macOS WKWebView / Windows WebView2）。缓解见 R1。

### D2. 四层架构：`app` / `framework` / `tools` / `core`

```
┌───────────────────────────────────────────────────────────────────┐
│ app/          布局、路由、主题、偏好持久化、命令面板                 │
│               ── 知道 framework，不知道具体 tool 实现              │
├───────────────────────────────────────────────────────────────────┤
│ framework/    defineTool / registry / ToolHost / ToolLayout /      │
│               useToolState / ErrorBoundary                         │
│               ── 知道 tool 的「形状」，不知道 tool 的「内容」       │
├───────────────────────────────────────────────────────────────────┤
│ tools/<category>/<tool-id>/{meta.ts, Tool.tsx}                     │
│               ── 唯一知道「这个工具干什么」的地方                   │
├───────────────────────────────────────────────────────────────────┤
│ core/<domain>/<name>.ts    纯函数，零 UI / 零 Tauri                 │
│               ── 不 import React，不认识 tools/                    │
└───────────────────────────────────────────────────────────────────┘
        依赖方向严格单向 ↓，无反向 import（加 ESLint 规则强制）
```

**理由**：把「算法」和「呈现」彻底分离是本设计的地基。算法可以在 Node 里秒级测试（不需要启动 WebView），呈现由框架兜底所以必然一致，而新增工具只需在两个已知位置各加一个文件。

**备选**：把算法直接写在 `Tool.tsx` 里。**否决**——无法单测，热重载慢，且 17 个工具会各自重复错误处理与校验逻辑。

### D3. 工具的声明契约：`meta.ts` + `Tool.tsx` 双文件约定

元数据必须**同步可得**（侧栏、搜索需要在组件不加载的情况下渲染），组件应当**按需加载**。用一个文件无法同时满足，因此拆成两个：

```ts
// src/tools/crypto/uuid-generator/meta.ts  —— 同步、极轻、纯数据
import type { ToolMeta } from '@/framework/types'

export default {
  id: 'uuid-generator',
```

Full source: openspec/changes/it-toolbox-app/design.md

## openspec/changes/it-toolbox-app/tasks.md

- Source: openspec/changes/it-toolbox-app/tasks.md
- Lines: 1-118
- SHA256: 140edd2274e25d39020fd01619ee8513f20ea7d027f19ec35918b0c06b88af48

[TRUNCATED]

```md
## 1. 项目脚手架与构建基座

- [ ] 1.1 初始化前端工程：Vite + React + TypeScript，配置 `@/*` 路径别名指向 `src/`
- [ ] 1.2 接入 Tailwind CSS，定义亮/暗两套主题令牌（背景、前景、边框、强调色）
- [ ] 1.3 初始化 Tauri 2.x 工程（`src-tauri/`），配置窗口标题、初始尺寸与最小尺寸
- [ ] 1.4 配置 Tauri 安全策略：关闭不需要的能力，仅开启文件读写与导出所需权限
- [ ] 1.5 接入 Vitest 并在 Node 环境跑通一个 Core 层的占位测试
- [ ] 1.6 配置 ESLint 依赖方向规则：禁止 `core/` import React 或 Tauri，禁止 `framework/` import `tools/` 具体实现
- [ ] 1.7 配置 `tauri.conf.json` 的 bundle targets 为 `dmg` + `nsis`，预留签名配置位（环境变量注入）
- [ ] 1.8 打通本机 `tauri dev` 与 `tauri build`，确认可产出可运行的调试产物
- [ ] 1.9 配置内容安全策略：`connect-src 'none'`，`img-src`/`font-src`/`style-src`/`script-src` 均不含远程来源；手工验证外发请求被拒
- [ ] 1.10 配置 Windows `webviewInstallMode` 为 `skip`，并验证安装过程零网络请求；记录 `offlineInstaller` 变体的构建开关

## 2. 工具注册框架

- [ ] 2.1 定义框架类型：`ToolMeta`、`ToolCategory`、`ToolManifest`、`Result<T>`
- [ ] 2.2 实现 `defineTool` 声明辅助函数与类别枚举常量（加密/转换器/Web/图片/开发）
- [ ] 2.3 实现 `registry.ts`：基于 `import.meta.glob` 自动发现 `meta.ts`（同步）与 `Tool.tsx`（懒加载）并完成配对
- [ ] 2.4 实现一致性校验：meta/Tool 配对、`id` 唯一、`id` 与目录名一致、类别合法、keywords 非空，违反时定位到具体目录
- [ ] 2.5 编写 `registry.test.ts`，覆盖校验的全部失败分支与通过分支
- [ ] 2.6 实现模糊搜索：在元数据层匹配 name / keywords / category，返回带排序的结果列表，且不触发组件加载
- [ ] 2.7 编写搜索单测：中英文混合查询、按关键词命中、无结果、排序稳定性

## 3. 统一交互层

- [ ] 3.1 实现 `ToolLayout`：Header（名称/描述/收藏）、OptionsBar、InputPanel、OutputPanel 四个区域，input/output 为可选插槽
- [ ] 3.2 实现 `InputPanel`：文本输入、清空、填入示例、文件拖入，支持只读模式
- [ ] 3.3 实现 `OutputPanel`：只读输出、复制、下载、交换，支持自定义渲染插槽（用于预览类结果）
- [ ] 3.4 实现 `framework/clipboard.ts`：优先 `navigator.clipboard`，失败回退到 Tauri 剪贴板能力
- [ ] 3.5 实现 `framework/file.ts`：文本下载与二进制下载（Blob + Tauri 保存对话框）
- [ ] 3.6 实现 `useToolState`：按工具 id 隔离的输入/参数持久化，含清空语义
- [ ] 3.7 实现 `ToolErrorBoundary`：单工具渲染异常隔离，提供重试入口且不影响侧栏与搜索
- [ ] 3.8 实现统一空态与错误提示组件（非法输入、无结果、无内容三种形态）
- [ ] 3.9 响应式布局：窗口宽度小于 720px 时输入输出区由并排转为堆叠
- [ ] 3.10 实现解析错误的统一呈现与输入区定位高亮：展示原因 + 行号/列号/偏移，无法定位时降级为仅展示原因

## 4. 应用外壳与导航

- [ ] 4.1 实现主布局：分类侧栏 + 工具面板
- [ ] 4.2 实现侧栏：按类别分组渲染工具，类别无工具时不展示
- [ ] 4.3 实现命令面板（Cmd/Ctrl+K）：唤起、搜索、键盘上下选择与回车打开，输入框聚焦时快捷键仍生效
- [ ] 4.4 实现主题切换：亮/暗/跟随系统，持久化用户选择
- [ ] 4.5 实现偏好存储层：主题、最近使用、收藏、各工具状态
- [ ] 4.6 实现最近使用与收藏区，排序规则与取消收藏
- [ ] 4.7 实现默认落地工具逻辑：有最近使用则打开最近一项，否则打开内置默认项
- [ ] 4.8 搭建并验证样板链路：UUID 工具可被搜索、打开、复制、状态恢复，且其余工具组件未被加载
- [ ] 4.9 实现窄窗口侧栏折叠：宽度不足时收起为抽屉，可唤起、选中工具后自动收起
- [ ] 4.10 实现 `offline-guard.ts`：开发构建包装 `fetch`/`XMLHttpRequest`/`WebSocket`，命中即抛错并显著提示
- [ ] 4.11 编写构建产物外发扫描脚本，发现远程 URL 字面量即令构建失败

## 5. 加密类工具

- [ ] 5.1 实现 `core/crypto/token.ts`：安全随机、字符集（字母数字/hex/base64/base64url/自定义）、长度、数量、前缀
- [ ] 5.2 实现 `core/crypto/uuid.ts`：v1（随机 multicast 节点 ID）、v4、v7（时间有序）、格式选项
- [ ] 5.3 实现 `core/crypto/ulid.ts`：Crockford Base32 编解码、时间戳解析、同毫秒单调递增
- [ ] 5.4 实现 `core/crypto/hmac.ts`：SHA-1/256/384/512、密钥编码（UTF-8/hex/base64）、输出编码（hex/base64/base64url）
- [ ] 5.5 实现 `core/crypto/rsa.ts`：密钥对生成、PEM 导出（PKCS#1 / PKCS#8 / SPKI / OpenSSH）
- [ ] 5.6 编写上述 Core 的 Vitest 用例，覆盖 spec 中全部 Scenario（含非法输入分支）
- [ ] 5.7 实现 Token 生成器工具（含字符集为空的校验提示）
- [ ] 5.8 实现 UUID 生成器工具（含 v1 节点 ID 为随机值的界面说明）
- [ ] 5.9 实现 ULID 生成器工具（展示解码出的时间戳）
- [ ] 5.10 实现 HMAC 生成器工具（含密钥为空与非法 hex 的提示）
- [ ] 5.11 实现 RSA 密钥对生成器工具（生成中禁用重复提交、参数变更不自动重算、公钥私钥分别复制与导出）
- [ ] 5.12 实现 `core/der.ts`（DER 最小写入器）与 `core/ssh-key.ts`（OpenSSH 公钥组装），并编写交叉验证用例：测试内独立 DER 读取器互校、`openssl rsa -check`（缺失则 skip）、`ssh-rsa` 与 JWK 的 n/e 比对

## 6. 转换器工具

- [ ] 6.1 实现 `core/converter/date.ts`：多格式解析（秒/毫秒时间戳、ISO 8601、常见日期格式）与多表示输出
- [ ] 6.2 实现 `core/converter/base64.ts`：标准/URL-safe、填充开关、UTF-8 文本与二进制
- [ ] 6.3 实现 `core/converter/yaml.ts`：`yamlToJson` 与 `jsonToYaml`，含行号错误定位与缩进配置
- [ ] 6.4 实现 `core/converter/markdown.ts`：Markdown 渲染与输出转义（防脚本执行）
- [ ] 6.5 编写上述 Core 的 Vitest 用例，覆盖 spec 中全部 Scenario（含往返一致性断言）
- [ ] 6.6 实现日期转换器工具（含无法识别的提示、结果逐项复制）
- [ ] 6.7 实现 Base64 编码/解码工具（含拖入文件编码、导出解码后文件、非法输入提示）
- [ ] 6.8 实现 YAML 转 JSON 工具（含缩进配置与语法错误行号提示）
- [ ] 6.9 实现 JSON 转 YAML 工具（含错误位置提示）
- [ ] 6.10 实现 Markdown 转 HTML 工具（源码视图 + 安全预览 + 复制源码）
- [ ] 6.11 日期转换器补充：时间戳单位可手动指定（自动/秒/毫秒/微秒/纳秒），并展示歧义输入所采用的判定依据
- [ ] 6.12 Markdown 转 HTML 补充：远程图片渲染为占位块（不发起加载），外部链接不在应用窗口内导航

```

Full source: openspec/changes/it-toolbox-app/tasks.md

## openspec/changes/it-toolbox-app/specs/app-shell/spec.md

- Source: openspec/changes/it-toolbox-app/specs/app-shell/spec.md
- Lines: 1-172
- SHA256: 2b6ceaf3fd8da325fc65bbcf842bd0c5d77a0a3f0a403fabd6783c16b340daf5

[TRUNCATED]

```md
## ADDED Requirements

### Requirement: 应用主布局

系统 SHALL 提供一个常驻主窗口，由分类侧栏与工具面板两部分组成；侧栏 SHALL 按工具类别分组展示可导航项，工具面板 SHALL 渲染当前选中工具。

#### Scenario: 首次启动进入默认工具

- **WHEN** 用户首次启动应用且未选择过工具
- **THEN** 系统展示主布局，并自动打开一个默认工具（最近使用列表为空时取内置默认项）

#### Scenario: 切换工具

- **WHEN** 用户在侧栏点击另一个工具
- **THEN** 工具面板在不刷新窗口、不重载应用的前提下替换为新工具内容

#### Scenario: 窗口尺寸自适应

- **WHEN** 用户将窗口缩窄至 720px 以下
- **THEN** 输入与输出面板由左右并排改为上下堆叠，且所有操作按钮仍可见可点击

### Requirement: 主题切换

系统 SHALL 支持暗色、亮色、跟随系统三种主题选项，并 SHALL 记住用户上次选择；未显式选择时 SHALL 默认为暗色。

#### Scenario: 首次启动默认暗色

- **WHEN** 用户首次启动应用且从未选择过主题，即使操作系统外观为亮色
- **THEN** 应用以暗色主题启动

#### Scenario: 手动切换并持久化

- **WHEN** 用户手动切换为亮色主题后关闭并重新打开应用
- **THEN** 应用以亮色主题启动，且不再跟随系统外观变化

#### Scenario: 选择跟随系统

- **WHEN** 用户显式选择「跟随系统」后操作系统外观发生变化
- **THEN** 应用主题随之切换，且重启后仍保持「跟随系统」选项

### Requirement: 全局快捷键

系统 SHALL 提供全局快捷键用于唤起工具搜索面板；在 macOS 上使用 Cmd、在其他平台使用 Ctrl 作为修饰键。

#### Scenario: 唤起搜索面板

- **WHEN** 用户在主窗口内按下 Cmd+K（macOS）或 Ctrl+K（Windows）
- **THEN** 工具搜索面板获得焦点并展示全部工具

#### Scenario: 快捷键不与输入框冲突

- **WHEN** 焦点位于某个工具的输入文本框中且用户按下 Cmd/Ctrl+K
- **THEN** 搜索面板仍被唤起，同时输入框原有内容不被修改

### Requirement: 本地偏好持久化

系统 SHALL 将用户偏好（主题、最近使用、收藏、各工具上次输入）持久化到本机；应用重启后 SHALL 恢复这些偏好。

#### Scenario: 恢复各工具上次输入

- **WHEN** 用户在 JSON 美化工具中粘贴内容后切换到其他工具，随后再次打开 JSON 美化工具
- **THEN** 输入框恢复为用户上次粘贴的内容

#### Scenario: 偏好数据仅存本机

- **WHEN** 应用任意时刻运行
- **THEN** 偏好数据与工具输入内容不离开本机，不产生任何出网请求

### Requirement: 桌面安装产物

系统 SHALL 能构建出以下安装产物：macOS Apple Silicon 与 Intel 的 `.dmg`，Windows x64 与 arm64 的 `.exe`。单个平台的安装包体积 SHALL 不超过 15MB。

#### Scenario: 构建 macOS 产物

- **WHEN** 在 macOS 上执行生产构建
- **THEN** 产出可分发的 `.dmg` 文件，双击后可拖入「应用程序」安装并正常启动

#### Scenario: 构建 Windows 产物

- **WHEN** 在 Windows 上执行生产构建
```

Full source: openspec/changes/it-toolbox-app/specs/app-shell/spec.md

## openspec/changes/it-toolbox-app/specs/converter-tools/spec.md

- Source: openspec/changes/it-toolbox-app/specs/converter-tools/spec.md
- Lines: 1-186
- SHA256: bf462f2472a2b73209ec0aff66257e8c4939d39c70c0e0fdb932010c656a4b7d

[TRUNCATED]

```md
## ADDED Requirements

### Requirement: 日期转换器

系统 SHALL 提供日期转换器，接受多种常见日期表示形式作为输入，并 SHALL 同时展示该时刻的多种表示：Unix 时间戳（秒）、Unix 时间戳（毫秒）、ISO 8601（UTC）、ISO 8601（本地）、RFC 2822、本地化日期时间与相对时间。系统 SHALL 允许用户显式指定时间戳单位，以消除数字型输入的单位歧义。

#### Scenario: 从时间戳（秒）解析

- **WHEN** 用户输入 `1700000000`
- **THEN** 系统识别为秒级时间戳，并展示其对应的 ISO 8601（UTC）为 `2023-11-14T22:13:20.000Z`

#### Scenario: 从时间戳（毫秒）解析

- **WHEN** 用户输入 `1700000000000`
- **THEN** 系统识别为毫秒级时间戳并正确解析，且不误判为秒级时间戳

#### Scenario: 手动指定时间戳单位

- **WHEN** 用户将时间戳单位由「自动」改为指定单位（秒、毫秒、微秒或纳秒之一）
- **THEN** 系统按指定单位解释输入，覆盖自动判定结果，并在结果中标注当前使用的单位

#### Scenario: 歧义数字输入

- **WHEN** 用户输入位数不属于常见时间戳长度的纯数字（例如 `20240315`）
- **THEN** 系统展示其采用的判定依据与结论，并允许用户通过手动指定单位纠正解释方式

#### Scenario: 从 ISO 8601 解析

- **WHEN** 用户输入 `2024-03-15T08:30:00Z`
- **THEN** 系统展示该时刻的秒级与毫秒级时间戳以及本地时间表示

#### Scenario: 从常见日期格式解析

- **WHEN** 用户输入 `2024-03-15` 或 `2024/03/15 08:30:00`
- **THEN** 系统成功解析并在结果中标注其被识别的输入格式

#### Scenario: 各表示可相互校验

- **WHEN** 任意输入被成功解析
- **THEN** 展示的秒级时间戳乘以 1000 与毫秒级时间戳一致，且 ISO 8601（UTC）与二者描述同一时刻

#### Scenario: 无法识别的输入

- **WHEN** 用户输入 `not-a-date`
- **THEN** 系统提示无法识别该日期格式，不输出任何时间表示

### Requirement: Base64 编码与解码

系统 SHALL 提供 Base64 编码与解码能力，支持标准与 URL-safe 两种变体，支持是否填充 `=` 以及 UTF-8 文本与文件内容的处理。

#### Scenario: 编码文本

- **WHEN** 用户输入 `hello` 并选择标准变体
- **THEN** 输出为 `aGVsbG8=`

#### Scenario: 解码文本

- **WHEN** 用户输入 `aGVsbG8=` 并执行解码
- **THEN** 输出为 `hello`

#### Scenario: URL-safe 变体

- **WHEN** 用户选择 URL-safe 变体并编码一段包含 `+` 与 `/` 的字节
- **THEN** 输出中不含 `+` 与 `/`，而使用 `-` 与 `_` 替代

#### Scenario: 不含填充字符

- **WHEN** 用户关闭「包含填充符」
- **THEN** 输出末尾不包含 `=`，且该输出可被系统自身成功解码

#### Scenario: 编码中文字符

- **WHEN** 用户输入中文文本进行编码
- **THEN** 解码结果为完全相同的中文文本，不发生乱码

#### Scenario: 非法 Base64 输入

- **WHEN** 用户输入包含非法字符（如 `abc!@#`）的内容并执行解码
- **THEN** 系统提示输入不是合法的 Base64，不输出结果

```

Full source: openspec/changes/it-toolbox-app/specs/converter-tools/spec.md

## openspec/changes/it-toolbox-app/specs/crypto-tools/spec.md

- Source: openspec/changes/it-toolbox-app/specs/crypto-tools/spec.md
- Lines: 1-166
- SHA256: 8c67cb5bb222b6baba25e55b494fae148a44b04e20dab9ed24535496dccc8792

[TRUNCATED]

```md
## ADDED Requirements

### Requirement: Token 生成器

系统 SHALL 提供随机 Token 生成器，支持配置长度、字符集、生成数量与可选前缀。字符集选项 SHALL 至少包含：字母数字（a-zA-Z0-9）、十六进制、Base64、Base64URL、自定义字符集。随机源 SHALL 使用密码学安全随机数。

#### Scenario: 按默认参数生成

- **WHEN** 用户打开 Token 生成器且不修改任何参数
- **THEN** 系统生成一个 Token，其长度等于默认长度，且所有字符均属于默认字符集

#### Scenario: 自定义长度与字符集

- **WHEN** 用户将长度设为 64、字符集设为十六进制
- **THEN** 生成的 Token 长度为 64 且仅包含 `0-9a-f`

#### Scenario: 自定义字符集校验

- **WHEN** 用户选择自定义字符集但未填写任何字符
- **THEN** 系统不生成结果，并提示字符集不可为空

#### Scenario: 批量生成

- **WHEN** 用户将生成数量设为 5
- **THEN** 系统输出 5 个 Token，每个独占一行，且 5 个值互不相同

#### Scenario: 带前缀生成

- **WHEN** 用户设置前缀为 `sk_`
- **THEN** 每个生成的 Token 均以 `sk_` 开头

#### Scenario: 使用安全随机源

- **WHEN** 连续生成多个 Token
- **THEN** 随机值来自 `crypto.getRandomValues`，不使用 `Math.random`

### Requirement: UUID 生成器

系统 SHALL 提供 UUID 生成器，支持 v1、v4、v7 三个版本，支持批量生成与格式选项（是否含连字符、是否大写）。

#### Scenario: 生成 v4

- **WHEN** 用户选择版本 v4
- **THEN** 生成结果符合 `xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx` 格式，其中 `y` 属于 `8/9/a/b`

#### Scenario: 生成 v7

- **WHEN** 用户选择版本 v7
- **THEN** 生成结果的前 48 位为当前时间的毫秒级 Unix 时间戳，且版本位为 `7`

#### Scenario: 生成 v1

- **WHEN** 用户选择版本 v1
- **THEN** 生成结果的版本位为 `1`，且时间字段对应当前时间

#### Scenario: v1 节点 ID 隐私

- **WHEN** 用户生成 v1 UUID
- **THEN** 节点 ID 使用随机生成的 multicast 地址而非真实 MAC 地址，且界面上说明该节点 ID 为随机值

#### Scenario: v7 时间有序

- **WHEN** 用户在同一毫秒内连续生成多个 v7 UUID
- **THEN** 结果按生成顺序字典序递增

#### Scenario: 格式选项

- **WHEN** 用户关闭「包含连字符」并开启「大写」
- **THEN** 输出为 32 位大写十六进制且不含 `-`

#### Scenario: 批量生成

- **WHEN** 用户将生成数量设为 10
- **THEN** 输出 10 个 UUID，每行一个，互不相同

### Requirement: ULID 生成器

系统 SHALL 提供 ULID 生成器，支持批量生成、大小写选项，并 SHALL 展示 ULID 内嵌的时间戳。

#### Scenario: 生成合法 ULID
```

Full source: openspec/changes/it-toolbox-app/specs/crypto-tools/spec.md

## openspec/changes/it-toolbox-app/specs/dev-tools/spec.md

- Source: openspec/changes/it-toolbox-app/specs/dev-tools/spec.md
- Lines: 1-99
- SHA256: 043c60e01e10302877f353bfab616eba9c57c89073cb7cc3e73e34d1a4ab087b

[TRUNCATED]

```md
## ADDED Requirements

### Requirement: JSON 压缩

系统 SHALL 提供 JSON 压缩能力，移除 JSON 中所有非必要空白字符，并 SHALL 保证压缩结果在语义上与原 JSON 完全等价。默认压缩路径 SHALL 保留字符串内的**原始转义字面量**，不进行规范化。

#### Scenario: 压缩格式化的 JSON

- **WHEN** 用户输入带缩进与换行的多行 JSON
- **THEN** 输出为不含换行与多余空格的单行 JSON，键值内容与顺序保持不变

#### Scenario: 语义等价

- **WHEN** 将压缩结果再次交给 JSON 美化工具处理
- **THEN** 得到的结构与压缩前的原 JSON 语义完全一致

#### Scenario: 保留字符串内空白

- **WHEN** 输入的 JSON 字符串值中本身包含空格、换行或制表符
- **THEN** 压缩结果中这些字符串内容被完整保留，不被移除

#### Scenario: 保留特殊字符转义

- **WHEN** 输入的 JSON 字符串值中包含转义字符（如 `\"`、`\n`、`\\`、Unicode 转义）
- **THEN** 压缩结果中的转义序列保持正确且可被重新解析

#### Scenario: 转义字面量不被规范化

- **WHEN** 输入的 JSON 字符串中包含可被等价改写的转义（例如 `\u0041` 可写作 `A`、`\/` 可写作 `/`）
- **THEN** 压缩结果保留其原始转义写法，不被改写为等价的其他写法

#### Scenario: 压缩与美化逐字节往返

- **WHEN** 用户将一份 JSON 先经美化（未开启键排序）再经压缩
- **THEN** 结果与对原始输入直接压缩所得结果逐字节一致

#### Scenario: 展示体积变化

- **WHEN** 压缩成功
- **THEN** 系统展示压缩前后的字节数以及节省比例

#### Scenario: 非法 JSON

- **WHEN** 用户输入不是合法 JSON
- **THEN** 系统提示解析失败并指出出错位置，不输出结果

#### Scenario: 空输入

- **WHEN** 输入区为空
- **THEN** 系统不报错、不输出内容

### Requirement: JSON 美化格式化

系统 SHALL 提供 JSON 美化能力，支持配置缩进（2 空格、4 空格、制表符），并 SHALL 支持可选的键排序、数组保持原序，以及 SHALL 展示每个值的数据类型提示。

#### Scenario: 默认缩进美化

- **WHEN** 用户输入压缩的单行 JSON 且不修改参数
- **THEN** 输出为按默认缩进（2 空格）换行展开的 JSON

#### Scenario: 缩进选项

- **WHEN** 用户选择 4 空格或制表符缩进
- **THEN** 输出按所选缩进样式格式化

#### Scenario: 键排序

- **WHEN** 用户开启「键排序」
- **THEN** 输出的每个对象内键按字典序排列，且数组元素的顺序保持不变

#### Scenario: 关闭键排序保持原序

- **WHEN** 用户关闭「键排序」
- **THEN** 输出的键顺序与输入完全一致

#### Scenario: 默认模式保留转义字面量

- **WHEN** 在未开启键排序的情况下对含转义字面量的 JSON 执行美化
- **THEN** 输出保留其原始转义写法，不被改写为等价的其他写法

```

Full source: openspec/changes/it-toolbox-app/specs/dev-tools/spec.md

## openspec/changes/it-toolbox-app/specs/image-tools/spec.md

- Source: openspec/changes/it-toolbox-app/specs/image-tools/spec.md
- Lines: 1-60
- SHA256: 98c372ce52a809e0711d591ea48938af6dfedd048500dede76bd814518bccb9b

```md
## ADDED Requirements

### Requirement: 二维码生成器

系统 SHALL 提供二维码生成器，接受文本输入，支持自定义前景色与背景色、纠错等级与模块尺寸，并 SHALL 实时展示二维码预览。二维码 SHALL 在本地生成，不调用任何在线服务。

#### Scenario: 默认参数生成

- **WHEN** 用户输入任意文本且不修改任何参数
- **THEN** 系统生成并展示二维码，前景色为黑色、背景色为白色

#### Scenario: 实时预览

- **WHEN** 用户修改输入文本或任一参数
- **THEN** 预览在无需点击生成按钮的情况下自动更新

#### Scenario: 空输入

- **WHEN** 输入区为空
- **THEN** 系统不展示二维码，并提示需要输入内容

#### Scenario: 自定义前景色与背景色

- **WHEN** 用户将前景色设为 `#1565c0`、背景色设为 `#fffde7`
- **THEN** 生成的二维码使用所选颜色，扫描后仍能被标准扫码器正确识别

#### Scenario: 颜色对比度不足的警告

- **WHEN** 用户选择的前景色与背景色对比度过低（导致难以识别）
- **THEN** 系统展示可识别性下降的警告，但仍按用户选择生成

#### Scenario: 调整二维码复杂度

- **WHEN** 用户调整复杂度（纠错等级在 L/M/Q/H 之间切换，或调整模块尺寸）
- **THEN** 预览随即更新：提高纠错等级使模块数量增加、抗污损能力增强；调整模块尺寸改变输出分辨率而不改变编码内容

#### Scenario: 长文本容量

- **WHEN** 用户输入接近所选纠错等级容量上限的长文本
- **THEN** 系统成功生成二维码；若超出容量上限则提示内容过长并给出当前等级的最大可容纳长度

#### Scenario: 中文内容

- **WHEN** 用户输入包含中文的文本
- **THEN** 生成的二维码可被标准扫码器扫描并还原为完全相同的中文文本

#### Scenario: 导出 PNG

- **WHEN** 用户点击导出 PNG
- **THEN** 系统下载一个 PNG 图片文件，其内容与预览一致，且尺寸与所选模块尺寸匹配

#### Scenario: 导出 SVG

- **WHEN** 用户点击导出 SVG
- **THEN** 系统下载一个 SVG 文件，该文件为矢量格式且可无损缩放

#### Scenario: 复制图片

- **WHEN** 用户点击复制图片
- **THEN** 二维码图片被写入系统剪贴板，可直接粘贴到其他应用
```

## openspec/changes/it-toolbox-app/specs/tool-registry/spec.md

- Source: openspec/changes/it-toolbox-app/specs/tool-registry/spec.md
- Lines: 1-196
- SHA256: e3150db71bede039f56243f4b2d4de04ce3ab982105aae49005b96433d90a015

[TRUNCATED]

```md
## ADDED Requirements

### Requirement: 工具声明契约

系统 SHALL 以「目录即工具」的方式定义工具。每个工具位于 `src/tools/<category>/<tool-id>/` 目录下，并 SHALL 由两个文件构成：`meta.ts` 同步导出一个元数据对象（含 `id`、`name`、`category`、`description`、`keywords`），`Tool.tsx` 默认导出一个 React 组件。

#### Scenario: 元数据字段完整

- **WHEN** 存在一个工具目录
- **THEN** 其 `meta.ts` 导出对象的 `id`、`name`、`category`、`description`、`keywords` 均为非空值

#### Scenario: id 与目录名一致

- **WHEN** 工具目录名为 `uuid-generator`
- **THEN** 其 `meta.ts` 中的 `id` 值必须为 `uuid-generator`

#### Scenario: 算法逻辑位于 Core 层

- **WHEN** 工具的 `Tool.tsx` 需要执行算法
- **THEN** 算法实现从 `src/core/**` 引入，`Tool.tsx` 与 `meta.ts` 均不包含可单测的算法实现

### Requirement: 工具自动注册

系统 SHALL 在构建时自动发现全部工具目录并完成注册，不依赖任何手工维护的中心清单；注册结果 SHALL 在应用启动时即可用于侧栏与搜索。

#### Scenario: 新增目录即被注册

- **WHEN** 开发者新增一个符合声明契约的工具目录后启动开发服务器
- **THEN** 该工具出现在侧栏对应分类中且可被搜索到，无需修改框架层任何文件

#### Scenario: 元数据同步可得

- **WHEN** 应用启动需要渲染侧栏与构建搜索索引
- **THEN** 全部工具的元数据同步可用，且此时未加载任何工具的 React 组件代码

### Requirement: 注册一致性校验

系统 SHALL 提供自动化校验，对工具注册结果断言以下不变式：每个 `meta.ts` 均有配对的 `Tool.tsx`（反之亦然）、`id` 全局唯一、`id` 与目录名一致、`category` 属于已知类别枚举、`keywords` 非空。任一不变式被违反时校验 SHALL 失败并指出违反的工具。

#### Scenario: 缺少配对组件

- **WHEN** 某工具目录存在 `meta.ts` 但缺少 `Tool.tsx`
- **THEN** 一致性校验失败，错误信息中包含该工具的目录路径

#### Scenario: id 重复

- **WHEN** 两个不同目录的 `meta.ts` 声明了相同的 `id`
- **THEN** 一致性校验失败，错误信息中包含该重复 `id`

#### Scenario: 全部合法时通过

- **WHEN** 全部工具目录均符合声明契约
- **THEN** 一致性校验通过且不产生警告

### Requirement: 分类分组导航

系统 SHALL 支持将工具归属到预定义类别，并在侧栏按类别分组展示。首版类别 SHALL 包含：加密、转换器、Web、图片、开发。

#### Scenario: 按类别分组

- **WHEN** 用户查看侧栏
- **THEN** 工具按所属类别分组呈现，每组展示类别名称与其下工具

#### Scenario: 类别为空时的展示

- **WHEN** 某类别下暂无任何工具
- **THEN** 该类别不出现在侧栏中

### Requirement: 全局工具搜索

系统 SHALL 提供全局搜索，依据元数据在工具名称、关键词与类别上做模糊匹配并返回排序结果；搜索过程 SHALL 不加载任何工具组件。

#### Scenario: 按名称搜索

- **WHEN** 用户在搜索框输入「uuid」
- **THEN** 结果中包含 UUID 生成器，且其他不匹配的工具被排除

#### Scenario: 按关键词搜索

- **WHEN** 用户输入的关键词命中某工具的 `keywords`（例如输入「唯一标识」命中 UUID 生成器）
```

Full source: openspec/changes/it-toolbox-app/specs/tool-registry/spec.md

## openspec/changes/it-toolbox-app/specs/web-tools/spec.md

- Source: openspec/changes/it-toolbox-app/specs/web-tools/spec.md
- Lines: 1-182
- SHA256: d4fdc1fddd45ef2c9e9276baa34cab748b603d2c17d52b517245e306b47d887d

[TRUNCATED]

```md
## ADDED Requirements

### Requirement: URL 编码与解码

系统 SHALL 提供 URL 编码与解码能力，并 SHALL 支持三种编码模式：组件编码（等价于 `encodeURIComponent`）、整体 URI 编码（等价于 `encodeURI`）、表单编码（空格编码为 `+`）。

#### Scenario: 组件编码

- **WHEN** 用户以组件模式编码 `a b&c=d`
- **THEN** 输出为 `a%20b%26c%3Dd`

#### Scenario: 整体 URI 编码

- **WHEN** 用户以整体 URI 模式编码 `https://a.com/b c?d=e&f=g`
- **THEN** 输出保留 `:/?&=` 等 URI 结构字符，仅对空格等非法字符编码

#### Scenario: 表单编码

- **WHEN** 用户以表单模式编码 `a b`
- **THEN** 输出为 `a+b`

#### Scenario: 解码

- **WHEN** 用户输入 `a%20b%26c%3Dd` 并执行解码
- **THEN** 输出为 `a b&c=d`

#### Scenario: 表单模式解码

- **WHEN** 用户以表单模式解码 `a+b`
- **THEN** 输出为 `a b`

#### Scenario: 中文往返一致

- **WHEN** 用户对包含 emoji 与中文的文本先编码再解码
- **THEN** 解码结果与原文完全一致

#### Scenario: 不完整转义序列

- **WHEN** 用户输入以 `%` 结尾或包含 `%ZZ` 的内容并执行解码
- **THEN** 系统提示存在非法的转义序列，不输出结果

### Requirement: JSON 差异比较

系统 SHALL 提供 JSON 差异比较，接受左右两份 JSON，输出结构化差异结果，并 SHALL 区分新增、删除与修改三种变更，且以 JSON 路径定位变更位置。

#### Scenario: 值修改

- **WHEN** 左侧为 `{"a":1}`、右侧为 `{"a":2}`
- **THEN** 结果中标记路径 `$.a` 为修改，并给出旧值 `1` 与新值 `2`

#### Scenario: 新增字段

- **WHEN** 右侧比左侧多出 `{"b":3}`
- **THEN** 结果中标记路径 `$.b` 为新增，值为 `3`

#### Scenario: 删除字段

- **WHEN** 左侧比右侧多出 `{"c":4}`
- **THEN** 结果中标记路径 `$.c` 为删除，值为 `4`

#### Scenario: 数组元素变化

- **WHEN** 左右两侧数组长度或元素不同
- **THEN** 结果按索引定位差异（如 `$.list[1]`），且能区分元素修改与元素增删

#### Scenario: 嵌套对象深层差异

- **WHEN** 差异位于多层嵌套的对象内部
- **THEN** 结果中的路径完整反映嵌套层级（如 `$.a.b.c`）

#### Scenario: 类型变化

- **WHEN** 同一路径的值由数字 `1` 变为字符串 `"1"`
- **THEN** 结果标记为修改，并同时展示两侧的值的类型

#### Scenario: 无差异

- **WHEN** 左右两份 JSON 语义完全一致（仅键序或空白不同）
- **THEN** 结果展示「无差异」，不产生虚假变更项

```

Full source: openspec/changes/it-toolbox-app/specs/web-tools/spec.md


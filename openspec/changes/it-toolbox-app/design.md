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
  name: 'UUID 生成器',
  category: 'crypto',
  description: '生成 UUID v1 / v4 / v7，支持批量与格式选项',
  keywords: ['uuid', 'guid', '唯一标识', 'id'],
} satisfies ToolMeta
```

```tsx
// src/tools/crypto/uuid-generator/Tool.tsx  —— 懒加载
export default function UuidGenerator() {
  return (
    <ToolLayout options={<VersionSelect/>} input={<NoneInput/>} output={...} />
  )
}
```

注册由 Vite 的 `import.meta.glob` 完成，无中心清单文件：

```ts
const metas = import.meta.glob('../tools/*/*/meta.ts', { eager: true })
const tools = import.meta.glob('../tools/*/*/Tool.tsx')            // 懒
```

**关键不变式（由 `registry.test.ts` 强制）**：每个 `meta.ts` 都有配对的 `Tool.tsx`（反之亦然）、`id` 全局唯一、`id` 与目录名一致、`category` 属于已知枚举、`keywords` 非空。任一违反则测试失败——**这保证了「加目录」就一定「被注册」，不会出现写了工具但忘了登记的情况。**

**备选**：中心化的 `tools/index.ts` 手动 export 列表。**否决**——会被遗忘、会引发合并冲突、且无法强制配对校验。

### D4. 加密能力基于 WebCrypto，不引入第三方加密库

UUID v1/v4/v7、ULID 随机源、HMAC、RSA 全部走 `crypto.getRandomValues` / `crypto.subtle`。

**理由**：供应链安全（加密库是攻击面最集中的依赖）、体积、以及 Tauri WebView 已提供完整实现。仅 `ulid` 的 Crockford Base32 编码与单调性逻辑自实现（约 60 行）。

**代价**：`crypto.subtle` 全为异步；RSA 4096 生成耗时数百毫秒至数秒 → 见 R2。

### D5. 错误模型：`Result<T>` 而非抛异常

```ts
type Result<T> = { ok: true; value: T } | { ok: false; error: string; detail?: string }
```

仅用于**解析类**操作（JSON / YAML / JWT / URL / Base64 / 日期解析），因为这些函数的「非法输入」是常规路径而非异常。生成类操作（token/uuid/ulid/hmac/rsa）输入由控件约束，直接返回终值。

**理由**：让 UI 不必到处 try/catch，且错误信息作为**返回值**可以被 spec 的 Scenario 精确断言（`WHEN 输入非法 JSON / THEN 返回 ok:false 且 error 说明位置`）。

### D6. UI 一致性由 `ToolLayout` 强制，而非靠约定

所有 17 个工具必须通过同一套布局组件呈现：

```
┌──────────────────────────────────────────────────────────────┐
│ ToolHeader   名称 · 描述                  [收藏] [复制链接]   │
├──────────────────────────────────────────────────────────────┤
│ OptionsBar   该工具特有参数（算法/位数/颜色/纠错等级…）        │
├───────────────────────────┬──────────────────────────────────┤
│ InputPanel                │ OutputPanel                      │
│  textarea / FileDrop      │  readonly / 预览 / 高亮           │
│  [清空] [填入示例]        │  [复制] [下载] [交换]             │
└───────────────────────────┴──────────────────────────────────┘
```

`ToolLayout` 的 `input` / `output` 为可选插槽（如 UUID/ULID 无输入，二维码有预览），因此同一组件能覆盖全部 17 个工具的形态差异。

**理由**：复制、下载、清空、示例这四个交互被 17 个工具重复需要；集中实现一次即可保证一致，也让每个工具的代码量骤降。

### D7. 搜索与导航：侧栏分类 + 命令面板（Cmd/Ctrl+K）

搜索在**元数据层**做模糊匹配（name / keywords / category），不加载任何工具组件。最近使用与收藏存于 `localStorage`（经 Tauri 的 store 能力亦可，首版用 localStorage 更简单且天然离线）。

**理由**：工具会增长到几十个，分类浏览的导航成本随数量线性上升，而全局搜索是常数成本。这是「后续可扩展」在交互层的对应设计。

### D8. 打包：`tauri.conf.json` + GitHub Actions 四平台矩阵

```yaml
bundle.targets: ['dmg', 'nsis']
matrix: [macos-14(arm64), macos-13(x64), windows-latest(x64), windows-11-arm(arm64)]
```

签名与公证仅**预留配置位**（环境变量注入），本 change 不申请证书，未签名产物在 macOS 需右键打开、Windows 会有 SmartScreen 提示。

### D9. Core 层测试用 Vitest 直跑 Node，不经过 WebView

`crypto.subtle` 在 Node 18+ 原生可用，因此 Core 测试无需 jsdom、无需浏览器宿主，毫秒级完成。spec 中的每个 Scenario 原则上对应一个 test case。

## Risks / Trade-offs

| 风险 | 缓解 |
|---|---|
| **R1 WebView 行为差异**（WebCrypto 细节、剪贴板 API、文件拖放） | 首版在 macOS + Windows 各做一次人工冒烟矩阵；对剪贴板统一封装 `framework/clipboard.ts`，内部优先 `navigator.clipboard` 并回退到 Tauri 剪贴板插件 |
| **R2 RSA 4096 生成慢，用户误以为卡死** | 生成按钮进入 loading 并禁用重复提交；展示进度文案；生成结果缓存于工具状态，避免参数微调即重算 |
| **R3 UUID v1 的 MAC 地址在 WebView 不可得** | 回退为随机 multicast 节点 ID（第 1 字节置 multicast 位），并在 UI 上显式说明「节点 ID 为随机值，含 MAC 隐私保护」 |
| **R4 一次性交付 17 个工具导致 review 与调试量过大** | 先落地框架 + 1 个样板工具（UUID）打通链路并做端到端验证，再按类别批量补齐；每类完成后跑 Core 单测与人工冒烟 |
| **R5 Markdown → HTML 存在 XSS 风险（预览内嵌）** | 输出默认走**转义后的源码视图**；预览使用受控渲染并禁用脚本，不引入 `dangerouslySetInnerHTML` 之外的任何放行策略 |
| **R6 Windows arm64 runner 在 CI 上的可用性** | 若 runner 不可用，退化为本地交叉构建并在文档中标注 arm64 产物为实验性 |
| **R7 单调 ULID 需要跨调用状态** | 单调性仅在工具内同一会话生效，状态内存持有；spec 明确限定为「同一会话内单调递增」，不做跨进程保证 |

## Migration Plan

全新项目，无迁移。交付顺序：

1. 脚手架（Vite + React + TS + Tailwind + Tauri 初始化）与四平台构建冒烟
2. framework 层 + UUID 样板工具，打通「注册 → 搜索 → 打开 → 复制」全链路
3. 按类别补齐 Core 与工具：crypto → converter → web → image → dev
4. 打包配置固化 + 四平台产物验证

**回滚**：仓库无历史代码，回滚等价于放弃该 change 分支。

## Open Questions

- RSA 私钥导出是否需要支持 `OpenSSH` 格式（`ssh-rsa` 单行公钥）？若需要，需额外实现 ASN.1 编码，约 100 行。倾向：**是**，因为「RSA 密钥对生成器」的典型用途正是生成服务器登录密钥。
- JSON 差异比较的呈现形态：左右并排 vs 统一 diff 行视图？倾向 **统一 diff 行视图 + 路径列表**，在窄窗口下更省空间。
- 时间戳精度统一为**毫秒**，但日期转换器需同时展示秒/毫秒/微秒视图。倾向：全部展示，由用户自取。

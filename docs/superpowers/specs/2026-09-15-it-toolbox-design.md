---
comet_change: it-toolbox-app
role: technical-design
canonical_spec: openspec
---

# IT Toolbox 技术设计

> 上游事实源为 `openspec/changes/it-toolbox-app/`。本文件承载**实现级设计**（架构、算法、取舍、测试策略），不重新定义需求。凡与 delta spec 冲突处，以 delta spec 为准。

## 1. Context

从零开始的离线桌面 IT 工具箱。仓库现状：仅有 OpenSpec 脚手架，无应用代码。

已锁定的约束：

| 约束 | 取值 | 来源 |
|---|---|---|
| 桌面外壳 | Tauri 2.x | 用户决策 |
| 目标产物 | macOS arm64/x64 `.dmg`，Windows x64/arm64 `.exe`(NSIS) | 用户决策 |
| 首版范围 | 全量 17 个工具，5 个类别 | 用户决策 |
| 导航形态 | 分类侧栏 + 工具面板 | 用户决策 |
| 视觉基调 | 开发者极简（高密度、等宽为主、小圆角、暗色默认） | 用户决策 |
| RSA 导出 | PEM 全套（PKCS#1 / PKCS#8 / SPKI）+ OpenSSH 单行公钥 | 用户决策 |
| JSON diff | 统一 diff 行视图（含 JSON 路径） | 用户决策 |
| 单平台安装包 | ≤ 15MB | proposal |
| 网络行为 | **运行期零外发请求** | proposal |

### 核心设计张力

首版要一次交付 17 个工具，同时后续必须能低成本扩展。两个失败模式：

- **各自为政**：17 个工具各自写页面 → 第 18 个工具的成本不降反升
- **过度设计**：框架层吃掉全部精力 → 首版交付被拖垮

本设计的全部取舍围绕一个目标：**把重复量最大的部分（元数据、布局、输入输出、复制导出、搜索路由、错误定位）收敛进框架，把真正有差异的部分（算法）放进可单测的 Core 层，使单个工具的实现量趋近于零。**

---

## 2. 分层架构

```
┌───────────────────────────────────────────────────────────────────┐
│ app/          布局、侧栏、命令面板、主题、偏好                       │
│               ── 知道 framework，不知道具体 tool 实现               │
├───────────────────────────────────────────────────────────────────┤
│ framework/    defineTool 契约 / registry / search / ToolHost /     │
│               ToolLayout / useToolState / clipboard / file         │
│               ── 知道 tool 的「形状」，不知道 tool 的「内容」        │
├───────────────────────────────────────────────────────────────────┤
│ tools/<category>/<tool-id>/{meta.ts, Tool.tsx}                     │
│               ── 唯一知道「这个工具干什么」的地方                   │
├───────────────────────────────────────────────────────────────────┤
│ core/         纯函数，零 React / 零 Tauri / 零 DOM                  │
│               ── 不 import 上层任何东西                            │
└───────────────────────────────────────────────────────────────────┘
        依赖方向严格单向，由 ESLint 规则强制，不靠自觉
```

**为何这样切**：把「算法」与「呈现」彻底分离是本设计的地基。算法可在 Node 里毫秒级测试（不必启动 WebView），呈现由框架兜底所以必然一致，新增工具只需在两个已知位置各加一个文件。

**备选否决**：算法直接写在 `Tool.tsx` 内。否决理由 —— 无法单测、热重载慢、17 个工具会各自重复错误处理与校验。

---

## 3. Core 层设计

### 3.1 模块清单

```
src/core/
├── result.ts        Result<T> 与 ok/err 构造
├── bytes.ts         hex / base64 / base64url / utf8 互转（crypto 与 converter 共用）
├── random.ts        安全随机原语
├── json/
│   ├── scanner.ts   逐 token 扫描 + 结构校验 + 精确错误定位
│   ├── parse.ts     严格解析（对外统一入口）
│   ├── minify.ts    token 级去空白（保留转义字面量）
│   └── format.ts    token 级重排缩进（+ 可选键排序）
├── der.ts           DER 最小写入器（仅服务 RSA PKCS#1 导出）
├── ssh-key.ts       OpenSSH 单行公钥组装
├── crypto/          token · uuid · ulid · hmac · rsa
├── converter/       date · base64 · yaml · markdown
├── web/             url-codec · json-diff · jwt · url-analyzer
├── image/           qrcode（只产出矩阵与 SVG 字符串，不碰 DOM）
└── dev/             json-format（组合 minify / format）
```

### 3.2 Result 类型

```ts
export type Result<T> =
  | { ok: true; value: T }
  | {
      ok: false
      error: string
      code?: string        // 机器可判别的错误码，如 'NOT_ABSOLUTE'
      detail?: string      // 补充说明
      suggestion?: string  // 可操作的修复建议（如补全为 https://…）
      offset?: number      // 字符偏移
      line?: number        // 行号（1-based）
      column?: number      // 列号（1-based）
    }
```

**为何用 Result 而非抛异常**：仅施加于**解析类**操作（JSON / YAML / JWT / URL / Base64 / 日期），因为这些函数的"非法输入"是常规路径而非异常。生成类操作（token / uuid / ulid / hmac / rsa）的输入由控件约束，直接返回终值。

`line` / `column` / `offset` 三个字段是为 §3.3 的跨 WebView 分歧点预留的统一出口。

### 3.3 决策：自实现 JSON 扫描器

**问题**：`JSON.parse` 的报错信息在 V8 与 JavaScriptCore 上格式不同。

```
WebView2 / Node（V8）  : Unexpected token } in JSON at position 42      ← 有位置
WKWebView（JSC）        : JSON Parse error: Unexpected token '}'        ← 无位置
```

而 delta spec 在 **6 处**要求"指出出错位置"（json-minify、json-format、json-to-yaml、json-diff、jwt payload、yaml 转 json 的产物校验）。依赖解析原生报错信息，在 macOS 上直接失效。

**决策**：自实现 `core/json/scanner.ts`，统一输出 `offset + line + column + 期望 token`。

```
core/json/scanner.ts ──┬──▶ parse.ts     严格解析
                       ├──▶ minify.ts    token 级去空白
                       └──▶ format.ts    token 级重排缩进
                                  │
                                  └──▶ 被 6 处工具复用
```

这不是过度设计，而是**一个必然的跨 WebView 分歧点**：写一次，省掉 6 处各自打补丁；且它同时是 §3.5 转义字面量保真能力的基础。

### 3.4 决策：token 级 JSON 压缩/格式化

**问题**：delta spec 要求 `minify(format(x))` 与 `x 去空白` **逐字节一致**，同时要求"保留特殊字符转义"。但"解析为值再序列化"会**规范化转义**：

```
输入          →  parse + stringify 后
"\u0041"      →  "A"        ← 逐字节往返被破坏
"\/"          →  "/"
```

**决策**：

| 路径 | 实现 | 转义字面量 | 逐字节往返 |
|---|---|---|---|
| 压缩（默认） | token 级去空白 | 原样保留 | ✅ |
| 美化（默认） | token 级重排缩进 | 原样保留 | ✅ |
| 美化（开启键排序） | parse + stringify | 可能被规范化 | ⚠️ 界面明确提示 |

键排序必须重建值对象，无法在 token 层完成，因此该模式下退化为规范化路径 —— 这是唯一的例外，且已在 spec 中显式声明。

### 3.5 决策：RSA 只写 DER 写入器，不写解析器

WebCrypto 只能导出 PKCS#8 / SPKI，拿不到 PKCS#1。常规做法是引入 `node-forge`（约 500KB）或 `asn1.js` 解析后重组。

**关键发现**：`crypto.subtle.exportKey('jwk', key)` 对私钥能直接返回全部 CRT 参数 `n, e, d, p, q, dp, dq, qi`。

```
PrivateKey ─JWK─▶ {n,e,d,p,q,dp,dq,qi} ─DER写入器(60行)─▶ PKCS#1 PEM
PublicKey  ─JWK─▶ {n, e}               ─DER写入器(20行)─▶ PKCS#1 公钥
                                       ─wire format────▶ ssh-rsa AAAA…
```

**结论**：只需要 **DER 写入（约 60 行）**，**完全不需要 DER 解析**。零新增依赖，行为完全确定，可逐字节断言。

DER 写入的两个要点：
- INTEGER 编码：先剥离 JWK 字节的前导 `0x00`，再在最高位为 1 时补一个 `0x00`（正数语义）
- 长度编码：`< 0x80` 用短形式；否则用长形式（`0x80 | 字节数` + 大端长度）

OpenSSH 公钥：`ssh-rsa ` + base64( `string"ssh-rsa"` + `mpint e` + `mpint n` )，其中 `string`/`mpint` 均为 `uint32 长度 + 大端字节`。整行不折行。

**范围界定**：用户选择的是"PEM 全套 + OpenSSH 单行公钥"，**不包含 OpenSSH 私钥**。这主动避开了 `bcrypt-pbkdf`/`openssh-key-v1` 的全部复杂度。

### 3.6 决策：UUID v7 / ULID 的单调性

同毫秒内生成多个时纯随机会导致字典序不稳定。采用 RFC 9562 的**单调计数器法**：

- v7：同毫秒内递增 `rand_a`（12 位）；溢出则用下一毫秒
- ULID：同毫秒内递增 80 位随机段；溢出则用下一毫秒

状态为模块级，导出 `__resetUuidState()` / `__resetUlidState()` 供测试重置。spec 已限定为"同一会话内单调"，不承诺跨进程。

UUID v1 的节点 ID：WebView 取不到 MAC 地址，固定使用随机生成的 multicast 地址（首字节最低位置 1），界面上显式说明该值为随机值。

### 3.7 其余 Core 决策速览

| 模块 | 决策 | 理由 |
|---|---|---|
| `random.ts` | `randomInt()` 用**拒绝采样**，不用 `%` | 避免取模偏差（密码学场景不可接受） |
| `crypto/token` | base64/base64url 字符集也走 `randomInt` 逐字符选取 | 保证长度精确、分布均匀，避免字节→base64 后截断产生偏斜 |
| `crypto/hmac` | `crypto.subtle.importKey('raw') + sign` | 原生实现，无第三方 |
| `converter/date` | 非标准格式（`YYYY-MM-DD HH:mm:ss`）**手写正则 + `new Date(y,m-1,d,…)`**，不用 `new Date(string)` | WKWebView 对非 ISO 字符串的解析行为与其他引擎不一致 |
| `converter/date` | 纯数字按位数判单位（10=秒 / 13=毫秒 / 16=微秒 / 19=纳秒），并提供手动指定覆盖 | `20240315` 这类 8 位数字有真实歧义（YYYYMMDD vs 时间戳） |
| `converter/base64` | 纯 TS 实现在 `Uint8Array` 上，不用 `btoa/atob` | `btoa` 需二进制字符串且各 WebView 行为有差异 |
| `converter/base64` | 解码前剥离空白/换行并自动补填充 | 用户从邮件/日志粘贴的场景极常见 |
| `converter/yaml` | 解析用 `js-yaml` 的 `JSON_SCHEMA` | 严格对应"布尔/数字/null 保持类型"，且避免 YAML 1.1 把 `yes` 当布尔 |
| `converter/yaml` | 序列化用 `lineWidth: -1, noRefs: true` | 禁止折行（折行会改变含换行字符串的语义），禁止 `&ref/*ref` 锚点 |
| `converter/markdown` | `markdown-it` 开 `html: false` | 原始 HTML 标签被转义，是**最简单且最彻底**的 XSS 防御，无需引入 DOM 净化库 |
| `web/url-codec` | 解码前用 `/%(?![0-9a-fA-F]{2})/` 预校验 | 原生 `decodeURIComponent` 抛出的 `URIError` 不含位置，无法满足"指出非法转义序列" |
| `web/json-diff` | 数组按**索引逐位比较**，不做 LCS | 索引比较可预测、路径形如 `$.list[1]`（spec 要求）。代价：数组中部插入会显示多处变更 —— 已记录为已知取舍 |
| `web/json-diff` | 对象键序：左侧键序优先，右侧独有键追加 | 输出稳定可读；且因比较的是解析后的值，键序差异天然不产生虚假 diff |
| `web/json-diff` | 路径转义：键名匹配标识符时用 `.key`，否则用 `['a.b']` | 避免含 `.`/`[` 的键名产生歧义路径 |
| `web/jwt` | 段数 5 时给出"这是 JWE"的专用提示 | 常见误用，直接说清比报"格式不合法"更有用 |
| `web/jwt` | 载荷解析失败时仍返回可用的头部（部分结果） | spec 明确要求 |
| `web/url-analyzer` | 默认端口表 `http:80 https:443 ws:80 wss:443 ftp:21`；Origin 为 `"null"` 时显示 `-` | URL API 对非特殊协议返回字面量 `"null"` |
| `web/url-analyzer` | 非绝对 URL 返回 `code: 'NOT_ABSOLUTE'` + `suggestion` | 让 UI 提供"按 https:// 解析"的一键操作 |
| `image/qrcode` | Core 只产出**矩阵**与 **SVG 字符串**；Canvas 渲染留在 Tool | Core 不得依赖 DOM |
| `image/qrcode` | 容量上限用 version-40 byte 模式的**硬编码容量表**（L=2953 / M=2331 / Q=1663 / H=1273） | 无需二分试探即可给出"当前等级最大可容纳长度" |
| `image/qrcode` | 对比度按 WCAG 相对亮度计算，低于 3:1 时告警 | 阈值有据可依，非拍脑袋 |
| `dev/json-format` | 输入 > 512KB 时先渲染"处理中"再延迟计算 | 满足"界面不出现无响应"。Web Worker 列为后续优化（YAGNI） |
| `dev/json-format` | 体积统计用 UTF-8 字节数（`TextEncoder`），非 `String.length` | spec 说的是"字节数" |

---

## 4. 框架层设计

### 4.1 模块清单

```
src/framework/
├── types.ts              ToolMeta / ToolCategory
├── categories.ts         类别枚举 · 顺序 · 图标 · 显示名
├── registry.ts           自动发现 + 不变式校验 + 索引
├── search.ts             模糊匹配（纯函数）
├── storage.ts            版本化 localStorage + 内存兜底
├── clipboard.ts          navigator.clipboard → Tauri 回退
├── file.ts               浏览器降级（dev）/ Tauri 保存对话框
├── offline-guard.ts      dev 期外发检测
├── theme.ts              主题解析与应用
├── ToolHost.tsx          懒加载 + Suspense + ErrorBoundary
├── ToolLayout.tsx        四区域布局
├── ToolErrorBoundary.tsx 单工具异常隔离
├── useToolState.ts       按工具 id 隔离的状态
├── usePrefs.ts           主题 / 最近使用 / 收藏
└── ui/                   Pane · CodeArea · CopyButton · DownloadButton ·
                          Field · Select · NumberInput · ColorInput ·
                          SegmentedControl · EmptyState · ErrorNote ·
                          Spinner · Icon
```

### 4.2 工具声明契约

元数据必须**同步可得**（侧栏与搜索需在组件不加载时渲染），组件应当**按需加载**。单个文件无法同时满足，故拆为两个：

```ts
// src/tools/crypto/uuid-generator/meta.ts —— 同步、极轻、纯数据
import type { ToolMeta } from '@/framework/types'

export default {
  id: 'uuid-generator',
  name: 'UUID 生成器',
  category: 'crypto',
  description: '生成 UUID v1 / v4 / v7，支持批量与格式选项',
  keywords: ['uuid', 'guid', '唯一标识', '唯一id', 'id生成', 'v1', 'v4', 'v7'],
} satisfies ToolMeta
```

```tsx
// src/tools/crypto/uuid-generator/Tool.tsx —— 懒加载
export default function UuidGenerator() {
  return <ToolLayout options={<VersionOptions />} output={<UuidList />} />
}
```

注册由 Vite 的 `import.meta.glob` 完成，**无中心清单文件**：

```ts
const metas = import.meta.glob('../tools/*/*/meta.ts', { eager: true })  // 同步
const tools = import.meta.glob('../tools/*/*/Tool.tsx')                  // 懒加载 → 自动代码分割
```

**关键不变式（由 `registry.test.ts` 强制）**：meta/Tool 配对、`id` 全局唯一、`id` 与目录名一致、`category` 属于已知枚举、`keywords` 非空。任一违反则测试失败 —— 这保证**「加了目录」就一定「被注册」**，不会出现写了工具却忘了登记的情况。

**备选否决**：中心化 `tools/index.ts` 手动 export 清单。否决理由 —— 会被遗忘、引发合并冲突、无法强制配对校验。

### 4.3 搜索的切词规则

**问题**：查询 `base64 解码` —— 工具名为 `Base64 编码/解码`。整串做子串匹配会**失败**（"base64 解码"不是连续子串）。

**决策**：查询按**空白 + 中英文（拉丁↔汉字）脚本边界**切词：

```
"base64 解码"  →  ["base64", "解码"]
"唯一标识"      →  ["唯一标识"]
"uuid v7"      →  ["uuid", "v7"]
```

所有词必须全部命中（AND 语义），得分累加。字段权重：name ×3 > keywords ×2 > category ×1.5 > description ×1。

单字段内匹配档位：精确相等 > 前缀 > 子串 > 子序列模糊。取各字段最高分。

这条规则同时覆盖纯中文与中英混合两类查询，且给了中文关键词（`唯一标识`）真实的检索能力 —— 这正是拒绝 `fuse.js` 的原因：需要控制切词策略。

### 4.4 ToolLayout 的两种形态

用**判别联合**覆盖两种形态，既类型安全又不必塞一堆可选 prop：

```ts
type ToolLayoutProps = {
  options?: ReactNode
  status?: ReactNode
} & (
  | { body: ReactNode;   input?: never; output?: never }   // 二维码 / JSON diff 双栏
  | { input?: ReactNode; output: ReactNode; body?: never } // 14 个标准工具
)
```

```
┌──────────────────────────────────────────────────────────────┐
│ ToolHeader   名称 · 描述                          [收藏]      │
├──────────────────────────────────────────────────────────────┤
│ OptionsBar   该工具特有参数                                   │
├───────────────────────────┬──────────────────────────────────┤
│ InputPanel                │ OutputPanel                      │
│  [清空] [填入示例]        │  [复制] [下载] [交换]             │
└───────────────────────────┴──────────────────────────────────┘
```

### 4.5 状态与持久化

**不引入状态管理库**。每个工具是"自身状态 → 纯函数 → 结果"的纯函数式组件，无需全局 store。

```ts
function useToolState<S>(toolId: string, initial: S): [S, (patch: Partial<S>) => void, () => void]
```

存储布局（单一键，避免键爆炸）：

```
itt:v1:prefs       { theme, favorites[], recents[{id, at, count}] }
itt:v1:toolState   { [toolId]: { input, options, updatedAt } }
```

- 写入去抖 200ms
- 单工具上限 50KB，全局上限 2MB，超限丢弃最久未使用者
- `storage.ts` 全量 try/catch，localStorage 不可用或超配额时降级为内存实现（应用仍可用，仅不持久化）

**为何不用 Tauri store**：localStorage 在 Tauri WebView 中持久化于应用数据目录，重启后保留，且可在 jsdom 中直接测试，无需任何 Rust 侧代码。

### 4.6 剪贴板与文件导出

```ts
function isTauri(): boolean   // '__TAURI_INTERNALS__' in window
```

| 能力 | 主路径 | 回退 |
|---|---|---|
| 复制文本 | `navigator.clipboard.writeText` | Tauri clipboard 插件 |
| 复制图片 | `navigator.clipboard.write([ClipboardItem])` | 不可用时隐藏按钮，改提供下载 |
| 文本下载 | Blob + `<a download>` | Tauri dialog + fs |
| 二进制下载 | 同上 | 同上 |

按 `isTauri()` 分支，使 `tauri dev` 与纯浏览器预览都能工作，便于开发期快速验证 UI。

---

## 5. 离线保证：四层强制

delta spec 的"离线可用"要求若只写"不产生出网请求"，第 18 个工具的作者引一个带版本检查的库就会静默失效。因此把它从**行为期望**升级为**可验证的不变量**。

| 层 | 手段 | 性质 |
|---|---|---|
| **1 结构层** | CSP：`default-src 'self'; connect-src ipc: http://ipc.localhost; img-src 'self' asset: http://asset.localhost data: blob:; font-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'` | 让外发在浏览器网络层**不可能** —— 即使代码写了 `fetch` 也会被拒 |
| **2 检测层** | dev 期包装 `fetch`/`XMLHttpRequest`/`WebSocket`，命中即抛错 + 控制台标红 | 开发时立刻暴露 |
| **3 预防层** | CI 扫描 `dist/` 中的外链字面量与 `fetch(` 调用，命中即构建失败 | 拦住回归 |
| **4 交互层** | Markdown 远程图片渲染为占位块（不发起加载）；外链点击交由系统浏览器，不在 WebView 内导航 | CSP 之外仍需向用户交代的行为 |

**CSP 的两处易错点**（已在实现计划中固化）：

1. `connect-src` **必须**包含 `ipc:` 与 `http://ipc.localhost`（两个写法都要，覆盖不同平台的自定义协议表现形式）。若写成 `'none'`，Tauri 的 `invoke` 会被拒绝，dialog / fs / clipboard 三个插件全部失效。该配置只放行应用内部通道，不产生任何外部出网能力。
2. Vite 的 HMR 走 `ws://`，而 `http:` **不覆盖** `ws:`。生产 CSP 必须保持最严，开发期放宽项放在 `devCsp` 中（含 `ws://localhost:1420` 与 `'unsafe-eval'`），**绝不带入生产构建**。

**CSP 的 `img-src` 不含 `https:`** 是缺口封堵的关键 —— 它结构性挡住了最容易被漏掉的声明式外发：

```
<img src="https://…">          ← 用户粘贴的内容
@font-face { src: url(…) }
background: url(…)
<a href="https://…">           ← 点击导航离开应用
```

**显式禁令**（本是默契，现写成检查项）：

- 不引入 `tauri-plugin-updater` —— 它会定期轮询更新服务器
- 不使用任何 Web 字体 / 图标字体 / CDN —— 字体走系统栈，约 20 个图标手写 SVG
- 不引入任何遥测 / 崩溃上报 SDK

---

## 6. 打包策略

### 6.1 Windows：WebView2 的三角约束

Tauri 默认的 Windows 安装器在安装时**从微软下载 WebView2 运行时**。官方各模式的实际代价：

| webviewInstallMode | 安装需联网 | 体积代价 | 说明 |
|---|---|---|---|
| `downloadBootstrapper`（默认） | 是 | 0 MB | 离线环境装不上 |
| `embedBootstrapper` | 是 | ~1.8 MB | 只嵌引导器，运行时仍要联网 —— **并不解决离线** |
| `offlineInstaller` | 否 | **~127 MB** | 真正离线，但**击穿 15MB 预算**（约 140MB） |
| `skip` | 否 | 0 MB | 不检测不安装；缺运行时则应用起不来 |

三者只能取二：

```
        ≤15MB 体积          离线可安装          任意 Windows 都能跑
           │                    │                     │
           └────────┬───────────┘                     │
                    ▼                                 │
              ✅ 取这两个                             ❌
        （要求系统自带 WebView2）          （要么 +127MB，要么放弃体积）
```

**决策**：默认 `skip`，取「≤15MB + 离线可安装」。

**依据**：Windows 11 与 Windows 10（2018 年 4 月版及以后）已将 WebView2 作为系统组件分发，覆盖目标用户绝大多数。

**兜底**：
- README 与安装说明中明确前置条件，并给出缺失时自备 WebView2 离线安装包的途径
- 保留 `--offline-installer` 构建开关，为内网/隔离环境产出 ~140MB 的全离线安装包。标准产物与内网变体共存，不牺牲任何一方

### 6.2 macOS

`.dmg` 安装无需联网。未签名/未公证产物在首次启动时需右键打开 —— 这是 macOS 的本地行为，不涉及出网。签名与公证仅预留配置位（环境变量注入），本 change 不申请证书。

### 6.3 CI 矩阵

```yaml
matrix:
  - macos-14          # arm64
  - macos-13          # x64
  - windows-latest    # x64
  - windows-11-arm    # arm64
```

注意：Windows arm64 runner 的可用性需在实施时验证；若不可用，退化为本地交叉构建，并将 arm64 产物标注为实验性。

---

## 7. 依赖清单

### 运行时（9 个）

`react` `react-dom` `@tauri-apps/api` `@tauri-apps/plugin-dialog` `@tauri-apps/plugin-fs` `@tauri-apps/plugin-clipboard-manager` `js-yaml` `markdown-it` `qrcode`

### 明确拒绝

| 拒绝 | 原因 |
|---|---|
| `node-forge` / `asn1.js` | JWK + 自写 DER 写入器已覆盖；加密库是攻击面最集中的依赖 |
| `crypto-js` | WebCrypto 全覆盖 |
| `dompurify` | markdown-it 开 `html:false` 后原始标签直接被转义，无需二次净化 |
| `fuse.js` | 需控制中英切词策略，自写 60 行匹配器更可控 |
| `uuid` / `ulid` npm 包 | 需精确控制 v1 节点 ID 隐私与 v7/ULID 单调性 |
| Radix / MUI / shadcn | 组件库默认间距与圆角与"高信息密度"直接冲突 |
| `zustand` / `redux` | 工具是自身状态的纯函数，无需全局 store |
| 任何图标库 | 手写约 20 个 SVG，省体积且保证零外网 |

---

## 8. 测试策略

### 8.1 两个 Vitest 项目

| 项目 | 环境 | 范围 |
|---|---|---|
| `core` | node | `src/core/**` —— `crypto.subtle` 在 Node 23 原生可用，无需 jsdom，用例毫秒级 |
| `ui` | jsdom + RTL | 仅框架层：`registry` 不变式、`search` 切词、`storage`、`useToolState`、`ToolHost` 隔离 |

**不给 17 个工具逐个写渲染测试** —— 工具的主体逻辑已在 Core 层被覆盖，渲染层是薄壳，逐个写测试的收益低于维护成本。

### 8.2 spec Scenario → test case

delta spec 的每个 Scenario 对应至少一个用例。这是测试覆盖率的判定依据，而非行覆盖率。

### 8.3 往返性质测试

| 性质 | 断言 |
|---|---|
| Base64 | `decode(encode(x)) == x`（含中文与 emoji） |
| URL 编解码 | 同上，三种模式 |
| JSON | `minify(format(x)) == x 去空白`（逐字节） |
| UUID v7 / ULID | 同毫秒内生成序列严格字典序递增 |
| HMAC | 同一密钥的不同编码（utf8/hex/base64）产出相同摘要 |
| YAML | `jsonToYaml(yamlToJson(y))` 语义等价 |

### 8.4 RSA 交叉验证（三层）

1. **独立重写**：在测试文件内另写一份最小 DER **读取器**，反解自己产出的 PKCS#1 PEM，校验 `n/e/d/p/q` 与 JWK 逐字节一致 —— 独立实现互校，不是自证
2. **外部权威**：`openssl` 存在时 shell 出去执行 `openssl rsa -check`（缺失则 `skipIf`）
3. **格式规范**：`ssh-rsa` 行解码后与 JWK 的 `n/e` 逐字节比对

### 8.5 解析错误定位

`core/json/scanner.ts` 单独用**表格驱动**测试：非法 JSON 输入 → 期望 `offset/line/column`。这是跨 WebView 一致性的直接保障。

### 8.6 无法自动化的部分

明确列为人工冒烟矩阵，不假装覆盖：

- 17 工具 × macOS / Windows
- 断网状态下全量使用
- 剪贴板、文件拖放、导出（WKWebView 与 WebView2 行为差异）
- 四平台产物安装与启动

---

## 9. 交付顺序

1. 脚手架（Vite + React + TS + Tailwind + Tauri）与四平台构建冒烟
2. framework 层 + UUID 样板工具，打通「注册 → 搜索 → 打开 → 复制 → 状态恢复」全链路
3. 按类别补齐 Core 与工具：crypto → converter → web → image → dev
4. 离线四层落地 + 打包配置固化 + 四平台产物验证

**回滚**：仓库无历史代码，回滚等价于放弃该 change 分支。

---

## 10. 本轮深度设计对 delta spec 的 8 处修订

`openspec/specs/` 为空，7 个 capability 均为新增，尚无已归档基线。因此修订**就地写入 `## ADDED Requirements`**，不使用 `## MODIFIED Requirements`（后者会在归档时因找不到基线而失败）。

| # | 位置 | 变更 | 触发原因 |
|---|---|---|---|
| P1 | `app-shell` 主题切换 | 未显式选择时**默认暗色**；选项为 暗色/亮色/跟随系统 | ⚠️ 用户选择的"暗色默认"与原文"默认跟随系统"**直接冲突**，必须二选一 |
| P2 | `app-shell` 新增 窄窗口侧栏折叠 | < 900px 侧栏收为抽屉并可唤起 | 240px 固定侧栏在窄窗口下挤压工具区 |
| P3 | `tool-registry` 新增 解析错误统一定位 | 解析类工具出错时统一展示 原因 + 行号/列号/偏移，可定位时高亮 | 跨 6 个工具的横切契约，写入框架层才有约束力 |
| P4 | `converter-tools` 日期转换器 | 时间戳单位可手动指定（自动/秒/毫秒/微秒/纳秒） | `20240315` 等 8 位数字有真实歧义（YYYYMMDD vs 时间戳） |
| P5 | `dev-tools` JSON 压缩 / 美化 | 默认保留原始转义字面量（逐字节往返成立）；开启键排序时转义可能被规范化并提示 | 原文"逐字节往返"与"保留转义"在实现上互相牵制，需明确边界 |
| P6 | `app-shell` 离线可用 | 明确四层强制机制；列出被禁止的声明式外发；升级为可验证的不变量 | 零外发原文只是"期望"，无机制阻止其失效 |
| P7 | `app-shell` 新增 Windows 运行时前置条件 | 安装包不检测不安装 WebView2（`skip`），要求 Win10 1803+ / Win11；补充自备途径与 `offlineInstaller` 变体 | 默认配置下 Windows 安装需联网，与"离线"约束冲突 |
| P8 | `converter-tools` Markdown 转 HTML | 远程图片渲染为占位块、不发起加载；外链不在 WebView 内导航 | 粘贴的 Markdown 中含远程图片会触发**真实外发请求**并携带用户内容 |

---

## 11. 已知取舍汇总

| 取舍 | 代价 | 缓解 |
|---|---|---|
| JSON diff 数组按索引比较，非 LCS | 数组中部插入会显示多处变更 | 已记录为已知行为；diff 结果仍精确可定位 |
| 键排序模式下转义字面量被规范化 | 该模式下逐字节往返不成立 | 界面显式提示该模式的行为差异 |
| Windows 默认 `skip` WebView2 | 极老系统（Win10 1803 前）缺运行时会启动失败 | README 前置说明 + `offlineInstaller` 变体 |
| 大 JSON（>512KB）在主线程序列化 | 超大输入时短暂阻塞 | 先渲染"处理中"再延迟计算；Web Worker 列为后续优化 |
| 单调性仅限会话内 | 跨进程不保证 ULID/v7 全局单调 | spec 已显式限定范围 |
| 工具组件不做逐个渲染测试 | 工具层回归依赖人工冒烟 | 算法已在 Core 层被覆盖；渲染层为薄壳 |
| RSA 生成期间无进度回调 | WebCrypto 不提供进度事件 | 不确定进度态 + 已耗时展示 + 禁用重复提交 |

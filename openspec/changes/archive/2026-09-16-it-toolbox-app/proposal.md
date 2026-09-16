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

**风险**

- RSA 4096 位密钥对生成在 WebCrypto 中为异步且耗时数百毫秒至数秒，需提供进度态与防重复提交
- UUID v1 的 MAC 地址获取在 WebView 环境下不可用，需回退为随机 multicast 节点 ID
- WebView 差异：macOS 用 WKWebView、Windows 用 WebView2，需验证 WebCrypto 与剪贴板 API 行为一致性

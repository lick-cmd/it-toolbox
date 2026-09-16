# IT Toolbox

离线可用的 IT 工具集合。运行期零网络请求。

> **当前进度**：**17 个工具全部交付**（加密 5：UUID / Token / ULID / HMAC / RSA 密钥对；
> 转换器 5：日期 / Base64 / YAML↔JSON / Markdown；Web 4：URL 编码 / JSON 差异 / JWT / URL 分析；
> 图片 1：二维码；开发 2：JSON 压缩 / JSON 美化），框架层完整
> （工具注册表、搜索、命令面板、主题、持久化、剪贴板/文件、错误定位、离线四层）。
> 安装产物已实测 **macOS Apple Silicon**（`.dmg` 2.36MB，含全部 17 个工具，远低于 15MB 上限）；
> Intel Mac 与两个 Windows 架构需在对应平台上构建，见下表。

## 平台与架构

| 平台 | 架构 | 产物 |
|---|---|---|
| macOS | Apple Silicon (arm64) | `.dmg` |
| macOS | Intel (x64) | `.dmg` |
| Windows | x64 | `.exe`（NSIS） |
| Windows | arm64 | `.exe`（NSIS） |

## Windows 前置条件

安装包**不检测、不安装** WebView2 运行时，因此安装过程无需联网。

- Windows 11 与 Windows 10（2018 年 4 月版及以后）**已随系统提供**该运行时，无需额外操作
- 若目标机器缺失该运行时，应用将无法启动。请从微软官方获取 WebView2 离线安装包后先安装

如需面向完全隔离或内网环境的分发产物，可构建内嵌运行时的变体：

```bash
# 将 tauri.conf.json 的 bundle.windows.webviewInstallMode 改为
#   { "type": "offlineInstaller" }
# 注意：该变体的安装包体积约为 140MB（内嵌约 127MB 的 WebView2 离线安装器）
```

## 开发

```bash
npm install
npm run tauri:dev     # 桌面应用
npm run dev           # 仅浏览器预览（UI 开发用，Tauri 能力自动降级）
npm run test          # 全部单测（core / ui / scripts 三个 project）
npm run typecheck     # 类型检查
npm run lint          # ESLint（含依赖方向规则）
npm run build         # 类型检查 + 前端构建 + 外发扫描
npm run tauri:build   # 打包桌面安装产物
```

单测分三个 project：`core`（Node 环境，纯算法，零 React / 零 Tauri / 零 DOM）、
`ui`（jsdom，框架层、工具组件与应用外壳）与 `scripts`（Node 环境，构建期脚本，如产物外发扫描）。

## 离线约束

运行期零出网由四层机制共同保证，修改代码时请注意：

1. **CSP**（`src-tauri/tauri.conf.json`）：`connect-src` 仅放行 Tauri IPC，`img-src` 不含远程来源
2. **开发期守卫**（`src/framework/offline-guard.ts`）：包装 `fetch` / `XMLHttpRequest` / `WebSocket`，命中外部目标即抛错
3. **产物扫描**（`scripts/scan-egress.mjs`）：构建时扫描产物中的网络 API 调用，发现即失败
4. **交互层**：远程图片渲染为占位块，外部链接不在应用窗口内导航

**不引入**自动更新、遥测、崩溃上报组件。

> 打包后的生产 CSP **故意不含** `connect-src 'self'`。生产页面 origin 为 `tauri://localhost`，
> 因此相对路径 `fetch('/')` 会被拒绝 —— 这是预期行为，不是缺陷：应用自身的脚本/样式/图片分别由
> `script-src` / `style-src` / `img-src` 放行，与 `connect-src` 无关；把 `'self'` 加进去只会扩大出网面。
> 验证生产 CSP 时应当断言的是「外部 fetch 被拒、界面正常渲染、走 IPC 的插件调用（剪贴板/保存对话框）成功」。

## 新增一个工具

1. 新建目录 `src/tools/<类别>/<kebab-case-id>/`
2. 写 `meta.ts`（同步元数据，导出 `satisfies ToolMeta` 的默认对象）
3. 写 `Tool.tsx`（默认导出组件）
4. 算法放进 `src/core/`，保持零 React / 零 Tauri / 零 DOM 依赖

无需登记 —— `import.meta.glob` 会自动发现。若配对或命名有误，`registry` 的不变式测试会失败并指出具体目录。

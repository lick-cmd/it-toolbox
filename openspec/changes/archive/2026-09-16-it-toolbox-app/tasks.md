## 1. 项目脚手架与构建基座

- [x] 1.1 初始化前端工程：Vite + React + TypeScript，配置 `@/*` 路径别名指向 `src/`
- [x] 1.2 接入 Tailwind CSS，定义亮/暗两套主题令牌（背景、前景、边框、强调色）
- [x] 1.3 初始化 Tauri 2.x 工程（`src-tauri/`），配置窗口标题、初始尺寸与最小尺寸
- [x] 1.4 配置 Tauri 安全策略：关闭不需要的能力，仅开启文件读写与导出所需权限
- [x] 1.5 接入 Vitest 并在 Node 环境跑通一个 Core 层的占位测试
- [x] 1.6 配置 ESLint 依赖方向规则：禁止 `core/` import React 或 Tauri，禁止 `framework/` import `tools/` 具体实现
- [x] 1.7 配置 `tauri.conf.json` 的 bundle targets 为 `dmg` + `nsis`，预留签名配置位（环境变量注入）
- [x] 1.8 打通本机 `tauri dev` 与 `tauri build`，确认可产出可运行的调试产物
- [x] 1.9 配置内容安全策略：`connect-src 'none'`，`img-src`/`font-src`/`style-src`/`script-src` 均不含远程来源；手工验证外发请求被拒
- [x] 1.10 配置 Windows `webviewInstallMode` 为 `skip`，并验证安装过程零网络请求；记录 `offlineInstaller` 变体的构建开关

## 2. 工具注册框架

- [x] 2.1 定义框架类型：`ToolMeta`、`ToolCategory`、`ToolManifest`、`Result<T>`
- [x] 2.2 实现 `defineTool` 声明辅助函数与类别枚举常量（加密/转换器/Web/图片/开发）
- [x] 2.3 实现 `registry.ts`：基于 `import.meta.glob` 自动发现 `meta.ts`（同步）与 `Tool.tsx`（懒加载）并完成配对
- [x] 2.4 实现一致性校验：meta/Tool 配对、`id` 唯一、`id` 与目录名一致、类别合法、keywords 非空，违反时定位到具体目录
- [x] 2.5 编写 `registry.test.ts`，覆盖校验的全部失败分支与通过分支
- [x] 2.6 实现模糊搜索：在元数据层匹配 name / keywords / category，返回带排序的结果列表，且不触发组件加载
- [x] 2.7 编写搜索单测：中英文混合查询、按关键词命中、无结果、排序稳定性

## 3. 统一交互层

- [x] 3.1 实现 `ToolLayout`：Header（名称/描述/收藏）、OptionsBar、InputPanel、OutputPanel 四个区域，input/output 为可选插槽
- [x] 3.2 实现 `InputPanel`：文本输入、清空、填入示例、文件拖入，支持只读模式
- [x] 3.3 实现 `OutputPanel`：只读输出、复制、下载、交换，支持自定义渲染插槽（用于预览类结果）
- [x] 3.4 实现 `framework/clipboard.ts`：优先 `navigator.clipboard`，失败回退到 Tauri 剪贴板能力
- [x] 3.5 实现 `framework/file.ts`：文本下载与二进制下载（Blob + Tauri 保存对话框）
- [x] 3.6 实现 `useToolState`：按工具 id 隔离的输入/参数持久化，含清空语义
- [x] 3.7 实现 `ToolErrorBoundary`：单工具渲染异常隔离，提供重试入口且不影响侧栏与搜索
- [x] 3.8 实现统一空态与错误提示组件（非法输入、无结果、无内容三种形态）
- [x] 3.9 响应式布局：窗口宽度小于 720px 时输入输出区由并排转为堆叠
- [x] 3.10 实现解析错误的统一呈现与输入区定位高亮：展示原因 + 行号/列号/偏移，无法定位时降级为仅展示原因

## 4. 应用外壳与导航

- [x] 4.1 实现主布局：分类侧栏 + 工具面板
- [x] 4.2 实现侧栏：按类别分组渲染工具，类别无工具时不展示
- [x] 4.3 实现命令面板（Cmd/Ctrl+K）：唤起、搜索、键盘上下选择与回车打开，输入框聚焦时快捷键仍生效
- [x] 4.4 实现主题切换：亮/暗/跟随系统，持久化用户选择
- [x] 4.5 实现偏好存储层：主题、最近使用、收藏、各工具状态
- [x] 4.6 实现最近使用与收藏区，排序规则与取消收藏
- [x] 4.7 实现默认落地工具逻辑：有最近使用则打开最近一项，否则打开内置默认项
- [x] 4.8 搭建并验证样板链路：UUID 工具可被搜索、打开、复制、状态恢复，且其余工具组件未被加载
- [x] 4.9 实现窄窗口侧栏折叠：宽度不足时收起为抽屉，可唤起、选中工具后自动收起
- [x] 4.10 实现 `offline-guard.ts`：开发构建包装 `fetch`/`XMLHttpRequest`/`WebSocket`，命中即抛错并显著提示
- [x] 4.11 编写构建产物外发扫描脚本，发现远程 URL 字面量即令构建失败

## 5. 加密类工具

- [x] 5.1 实现 `core/crypto/token.ts`：安全随机、字符集（字母数字/hex/base64/base64url/自定义）、长度、数量、前缀
- [x] 5.2 实现 `core/crypto/uuid.ts`：v1（随机 multicast 节点 ID）、v4、v7（时间有序）、格式选项
- [x] 5.3 实现 `core/crypto/ulid.ts`：Crockford Base32 编解码、时间戳解析、同毫秒单调递增
- [x] 5.4 实现 `core/crypto/hmac.ts`：SHA-1/256/384/512、密钥编码（UTF-8/hex/base64）、输出编码（hex/base64/base64url）
- [x] 5.5 实现 `core/crypto/rsa.ts`：密钥对生成、PEM 导出（PKCS#1 / PKCS#8 / SPKI / OpenSSH）
- [x] 5.6 编写上述 Core 的 Vitest 用例，覆盖 spec 中全部 Scenario（含非法输入分支）
- [x] 5.7 实现 Token 生成器工具（含字符集为空的校验提示）
- [x] 5.8 实现 UUID 生成器工具（含 v1 节点 ID 为随机值的界面说明）
- [x] 5.9 实现 ULID 生成器工具（展示解码出的时间戳）
- [x] 5.10 实现 HMAC 生成器工具（含密钥为空与非法 hex 的提示）
- [x] 5.11 实现 RSA 密钥对生成器工具（生成中禁用重复提交、参数变更不自动重算、公钥私钥分别复制与导出）
- [x] 5.12 实现 `core/der.ts`（DER 最小写入器）与 `core/ssh-key.ts`（OpenSSH 公钥组装），并编写交叉验证用例：测试内独立 DER 读取器互校、`openssl rsa -check`（缺失则 skip）、`ssh-rsa` 与 JWK 的 n/e 比对

## 6. 转换器工具

- [x] 6.1 实现 `core/converter/date.ts`：多格式解析（秒/毫秒时间戳、ISO 8601、常见日期格式）与多表示输出
- [x] 6.2 实现 `core/converter/base64.ts`：标准/URL-safe、填充开关、UTF-8 文本与二进制
- [x] 6.3 实现 `core/converter/yaml.ts`：`yamlToJson` 与 `jsonToYaml`，含行号错误定位与缩进配置
- [x] 6.4 实现 `core/converter/markdown.ts`：Markdown 渲染与输出转义（防脚本执行）
- [x] 6.5 编写上述 Core 的 Vitest 用例，覆盖 spec 中全部 Scenario（含往返一致性断言）
- [x] 6.6 实现日期转换器工具（含无法识别的提示、结果逐项复制）
- [x] 6.7 实现 Base64 编码/解码工具（含拖入文件编码、导出解码后文件、非法输入提示）
- [x] 6.8 实现 YAML 转 JSON 工具（含缩进配置与语法错误行号提示）
- [x] 6.9 实现 JSON 转 YAML 工具（含错误位置提示）
- [x] 6.10 实现 Markdown 转 HTML 工具（源码视图 + 安全预览 + 复制源码）
- [x] 6.11 日期转换器补充：时间戳单位可手动指定（自动/秒/毫秒/微秒/纳秒），并展示歧义输入所采用的判定依据
- [x] 6.12 Markdown 转 HTML 补充：远程图片渲染为占位块（不发起加载），外部链接不在应用窗口内导航

## 7. Web 工具

- [x] 7.1 实现 `core/web/url-codec.ts`：组件/整体 URI/表单三种模式的编码与解码，含不完整转义序列检测
- [x] 7.2 实现 `core/web/json-diff.ts`：基于 JSON 路径的结构化 diff，区分新增/删除/修改并识别类型变化，忽略键序差异
- [x] 7.3 实现 `core/web/jwt.ts`：三段拆分解码、时间声明可读化、过期状态判定、段数与载荷异常处理
- [x] 7.4 实现 `core/web/url-analyzer.ts`：协议/用户名/密码/主机/端口/Origin/路径/路径分段/查询参数（含重复键）/片段，默认端口识别与百分号解码
- [x] 7.5 编写上述 Core 的 Vitest 用例，覆盖 spec 中全部 Scenario
- [x] 7.6 实现 URL 编码/解码工具（三模式切换、非法转义提示）
- [x] 7.7 实现 JSON 差异比较工具（双输入面板、交换按钮、变更类型着色、无差异态）
- [x] 7.8 实现 JWT 解析器工具（三段分区展示、时间声明可读化、过期/有效期提示、「签名未校验」显式说明）
- [x] 7.9 实现 URL 分析器工具（参数表格逐行展示同名参数、编码与解码形式并列、非绝对 URL 的补全建议）

## 8. 图片与开发工具

- [x] 8.1 实现 `core/image/qrcode.ts`：前景/背景色、纠错等级、模块尺寸，输出 Canvas 与 SVG
- [x] 8.2 编写二维码 Core 用例：容量上限、中文往返、颜色选项
- [x] 8.3 实现二维码生成器工具：实时预览、对比度不足警告、内容过长提示、导出 PNG/SVG、复制图片
- [x] 8.4 实现 `core/dev/json-format.ts`：`minifyJson` 与 `formatJson`（缩进、键排序、保留字符串内空白与转义）
  - 已由 8.10 交付：`minifyJson` / `formatJson` 直接由 `core/json/{minify,format}.ts` 提供，工具层直连；`core/dev/` 组合层作为薄转发层按计划① Task 8 的决定取消（不新建 `core/dev/`）
- [x] 8.5 编写 JSON 压缩/美化的往返一致性用例与大输入用例
- [x] 8.6 实现 JSON 压缩工具（展示压缩前后字节数与节省比例、错误定位）
- [x] 8.7 实现 JSON 美化格式化工具（缩进选项、键排序开关、错误行号列号定位、大输入的处理中状态、键排序模式的行为提示）
- [x] 8.8 实现 `core/json/scanner.ts`：逐 token 扫描 + 结构校验 + 行号/列号/偏移定位，并编写表格驱动的错误定位用例（这是跨 WebView 一致性的保障）
- [x] 8.9 实现 `core/json/parse.ts` 严格解析入口，并接入全部使用点（json→yaml、json-diff、jwt 载荷、dev-tools）
- [x] 8.10 实现 token 级 `minify.ts` 与 `format.ts`：跳过字符串内部，保留转义字面量，保证 `minify(format(x))` 逐字节往返

## 9. 全量验收与打包

- [x] 9.1 核对 17 个工具在侧栏与搜索中均可发现，且分类归属正确
- [x] 9.2 执行全量 Core 单测，确认 spec 中每个 Scenario 均有对应用例且全部通过
- 9.3 / 9.4 / 9.6 / 9.10（断网冒烟、四平台构建、跨 WebView 冒烟、Windows 前置条件验证）：**四条均需真机环境，单测与 CI 构造不出来**，原文已移至 [`manual-qa.md`](./manual-qa.md)，本文件不再单列；在真机执行完成前不计入本次验收（判定与影响范围见验证报告）。
- [x] 9.5 校验单平台安装包体积不超过 15MB，超出则分析并裁剪依赖
- [x] 9.7 编写 README：开发启动、构建命令、新增工具的步骤说明（目录 + 两个文件 + Core 函数）
- [x] 9.8 运行 `openspec validate it-toolbox-app` 与一致性校验测试，确认全部通过
- [x] 9.9 离线四层验证：CSP 拒绝外发、开发期检测生效、产物扫描通过、远程图片与外部链接行为符合预期
- [x] 9.11 README 补充：Windows 运行时前置条件与自备途径、全离线安装包变体的构建方式与体积代价

## 10. JSON 视图优化（语法高亮与可折叠树）

- [x] 10.1 实现 `core/json/tree.ts`：token 流 → 不可变节点树（path / kind / key / raw / start / end / childCount / 折叠摘要），类型口径复用 `type-hints.ts`，并编写表驱动用例（嵌套推导、转义原文保真、空对象与空数组、超长数组、非法输入）
- [x] 10.2 补充 `core/json/tree.ts` 的大输入用例：节点数上限与超阈值降级策略（只展开第一层并给出提示），确认构建耗时可接受
- [x] 10.3 实现 `framework/ui/JsonCode.tsx`：只读 JSON 视图按 `scanJson` 的 token 流着色，行号与滚动外观对齐 `CodeArea`，无法解析时回退等宽纯文本，并编写用例（着色落点、复制文本不含标记、回退路径）
- [x] 10.4 `app/theme.css` 增加 `--json-*` 配色变量与 `.json-code` 样式：token 类别可区分、浅底对比度足够，且沿用既有调色板变量而非硬编码色值
- [x] 10.5 实现 `framework/ui/JsonTree.tsx`：节点逐个折叠（`aria-expanded`）、折叠态含元素个数摘要、全部展开与全部折叠、只渲染已展开路径，并编写用例（折叠交互、键盘可达、摘要文案、上限提示）
- [x] 10.6 从 `framework/ui/index.ts` 导出 `JsonCode` / `JsonTree` 及其 props 类型，并补充索引一致性校验
- [x] 10.7 接入 4 处只读 JSON 视图改用 `JsonCode`：JSON 美化输出、JSON 压缩输出、JWT 的 Header 与 Payload、YAML→JSON 输出
- [x] 10.8 JSON 美化工具增加「树形」视图（与源码、类型提示并列）：视图切换、折叠状态独立、空输入与非法输入不显示节点
- [x] 10.9 钉住不变量用例：同一份 JSON 的树形显示与源码显示逐字符一致（转义原样保留），且复制与下载仍给出完整原文
- [x] 10.10 按 spec 增量逐条核对覆盖表（树形视图 8 条 Scenario、只读高亮 4 条 Scenario），跑全量门禁 test / typecheck / lint / build（含 egress 扫描）

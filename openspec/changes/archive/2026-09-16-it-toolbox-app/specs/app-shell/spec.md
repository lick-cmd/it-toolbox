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
- **THEN** 产出 NSIS `.exe` 安装程序，安装后可从开始菜单启动应用

### Requirement: 离线可用

系统 SHALL 在无网络环境下提供全部工具功能。应用运行期间**零出网请求** SHALL 由以下四层机制共同保证，而非仅靠行为约定：

1. **结构层**：内容安全策略 SHALL 将 `connect-src` 限定为应用自身的内部通道（Tauri IPC），且 `img-src`、`font-src`、`style-src`、`script-src` SHALL 不包含任何远程来源
2. **检测层**：开发构建 SHALL 包装 `fetch`、`XMLHttpRequest`、`WebSocket`，任一被调用即抛出错误并在控制台显著提示
3. **预防层**：构建流水线 SHALL 扫描产物中的网络 API 调用（`fetch` / `XMLHttpRequest` / `WebSocket`），发现即令构建失败；远程 URL 字面量 SHALL 只产生告警（React 每次构建都会注入 `https://react.dev/errors/` 之类的常量，按字面设为致命会使构建恒红）
4. **交互层**：见「外部链接与远程资源处理」

#### Scenario: 断网使用全部工具

- **WHEN** 设备断开网络连接后用户依次打开并使用全部 17 个工具
- **THEN** 每个工具均正常产出结果，无功能降级或错误提示

#### Scenario: 无第三方运行时请求

- **WHEN** 应用启动并运行任意工具
- **THEN** 网络面板中不出现指向应用自身以外的请求（字体、图标、SDK 均随包内置）

#### Scenario: 结构性阻断外发

- **WHEN** 任一工具代码中尝试发起 `fetch`、`XMLHttpRequest` 或 `WebSocket` 请求
- **THEN** 该请求被内容安全策略拒绝，应用其余功能不受影响

#### Scenario: 开发期检测到外发

- **WHEN** 在开发构建中任一代码路径调用 `fetch`、`XMLHttpRequest` 或 `WebSocket`
- **THEN** 开发构建抛出错误并在控制台显著提示，使该问题在开发阶段即被发现

#### Scenario: 构建产物扫描

- **WHEN** 构建流水线扫描产物并发现网络 API 调用（`fetch` / `XMLHttpRequest` / `WebSocket`）
- **THEN** 构建失败并指出该调用所在的位置；发现远程 URL 字面量只告警，不使构建失败

#### Scenario: 禁止声明式外发

- **WHEN** 任一工具渲染的内容中包含指向远程资源的 `img` 的 `src`、`a` 的 `href`、`@font-face` 的 `src` 或 CSS 的 `url()` 引用
- **THEN** 系统不加载该远程资源

#### Scenario: 不包含更新与遥测组件

- **WHEN** 审查应用的依赖与运行行为
- **THEN** 不存在自动更新检查、遥测或崩溃上报组件，不产生周期性轮询

### Requirement: 外部链接与远程资源处理

系统 SHALL 在预览与展示类内容中隔离外部引用：远程图片 SHALL 渲染为占位提示而非加载，外部链接 SHALL 不在应用窗口内导航。

#### Scenario: 远程图片渲染为占位块

- **WHEN** 渲染内容中包含指向远程地址的图片
- **THEN** 系统展示占位提示与原始地址，不发起任何图片加载请求

#### Scenario: 外部链接不导航应用窗口

- **WHEN** 用户点击展示内容中的外部链接
- **THEN** 应用窗口不发生导航，链接交由系统默认浏览器打开或以只读形式展示地址

### Requirement: 窄窗口侧栏折叠

系统 SHALL 在窗口宽度不足以同时容纳侧栏与工具面板时，将侧栏收起为可唤起的抽屉，以优先保证工具面板的可用宽度。

#### Scenario: 窗口变窄时收起侧栏

- **WHEN** 用户将窗口宽度缩小至不足以舒适容纳侧栏与工具面板
- **THEN** 侧栏收起，工具面板占据释放出的宽度且内容不被截断

#### Scenario: 唤起折叠的侧栏

- **WHEN** 侧栏已收起且用户通过可见入口或快捷键将其唤起
- **THEN** 侧栏以覆盖层形式展开，可选择工具，选中后自动收起并展示该工具

### Requirement: Windows 运行时前置条件

系统的 Windows 安装包 SHALL 不检测、不安装 WebView2 运行时，也不因此要求安装时联网。系统 SHALL 在文档中声明该前置条件、给出运行时缺失时的自备途径，并提供可选的离线安装包构建方式。

#### Scenario: 离线安装 Windows 产物

- **WHEN** 在无网络环境的 Windows 机器上运行安装包，且该机器已具备 WebView2 运行时
- **THEN** 安装过程不发起任何网络请求并成功完成，应用可正常启动

#### Scenario: 前置条件已声明

- **WHEN** 用户查阅文档
- **THEN** 文档明确说明 Windows 需 Windows 10（2018 年 4 月版及以后）或 Windows 11，并说明运行时缺失时应如何获取

#### Scenario: 提供全离线安装包变体

- **WHEN** 用户需要面向完全隔离或内网环境的安装包
- **THEN** 系统提供包含 WebView2 运行时的构建方式，并说明该变体的体积代价

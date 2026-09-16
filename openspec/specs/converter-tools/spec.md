## Purpose

转换器工具集 —— 日期转换器、Base64 编码/解码、YAML 转 JSON、JSON 转 YAML、Markdown 转 HTML

## Requirements

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

#### Scenario: 编码文件

- **WHEN** 用户将一个文件拖入输入区并选择编码
- **THEN** 系统输出该文件字节内容的 Base64 表示

#### Scenario: 解码为文件

- **WHEN** 用户粘贴一段 Base64 并选择输出为文件
- **THEN** 系统提供下载，下载内容为解码后的原始字节

### Requirement: YAML 转 JSON

系统 SHALL 提供 YAML 到 JSON 的转换，支持嵌套结构、数组与多行字符串，并 SHALL 支持输出缩进配置。

#### Scenario: 转换嵌套结构

- **WHEN** 用户输入含嵌套映射与数组的合法 YAML
- **THEN** 输出为语义等价的合法 JSON，键值层级与内容一致

#### Scenario: 缩进配置生效

- **WHEN** 用户将输出缩进设为 4 空格
- **THEN** 输出的 JSON 使用 4 空格缩进

#### Scenario: 非字符串标量类型保持

- **WHEN** 输入的 YAML 中包含布尔值、数字与 null
- **THEN** 输出的 JSON 中对应位置分别为布尔值、数字与 null，而非字符串

#### Scenario: YAML 语法错误

- **WHEN** 用户输入存在缩进错误的 YAML
- **THEN** 系统提示解析失败并给出出错的行号

### Requirement: JSON 转 YAML

系统 SHALL 提供 JSON 到 YAML 的转换，并 SHALL 在输入为非法 JSON 时明确指出错误位置。

#### Scenario: 转换对象

- **WHEN** 用户输入合法 JSON 对象
- **THEN** 输出为语义等价的合法 YAML，可直接被本工具的 YAML 转 JSON 还原为原 JSON

#### Scenario: 转换数组

- **WHEN** 用户输入合法 JSON 数组
- **THEN** 输出的 YAML 使用列表语法且元素顺序与输入一致

#### Scenario: JSON 语法错误定位

- **WHEN** 用户输入缺少闭合括号的 JSON
- **THEN** 系统提示 JSON 解析失败，并指出出错的位置（行号或字符偏移）

#### Scenario: 空输入

- **WHEN** 输入区为空
- **THEN** 系统不报错、不输出内容

### Requirement: Markdown 转 HTML

系统 SHALL 提供 Markdown 到 HTML 的转换，支持标题、列表、表格、代码块、行内代码、链接、图片与引用，并 SHALL 同时提供 HTML 源码视图与安全预览。

#### Scenario: 转换标题与段落

- **WHEN** 用户输入 `# 标题` 与一段正文
- **THEN** 输出包含 `<h1>标题</h1>` 与 `<p>` 包裹的正文

#### Scenario: 转换表格与代码块

- **WHEN** 用户输入 Markdown 表格与围栏代码块
- **THEN** 输出包含 `<table>` 结构与 `<pre><code>` 结构，代码内容按语言标注 `class`

#### Scenario: 列表嵌套

- **WHEN** 用户输入多层嵌套的有序/无序列表
- **THEN** 输出的嵌套层级与输入一致

#### Scenario: 预览中不执行脚本

- **WHEN** Markdown 输入中包含 `<script>` 标签或 `onerror` 等事件属性
- **THEN** 预览视图中该脚本不执行，相关内容被转义或移除

#### Scenario: 远程图片不发起加载

- **WHEN** Markdown 输入中包含指向远程地址的图片引用
- **THEN** 预览中该位置展示占位提示与原始地址，不发起任何图片加载请求

#### Scenario: 外部链接不在应用内导航

- **WHEN** 用户点击预览中的外部链接
- **THEN** 应用窗口不发生导航，链接交由系统默认浏览器打开或以只读形式展示地址

#### Scenario: 原始 HTML 标签被转义

- **WHEN** Markdown 输入中包含原始 HTML 标签
- **THEN** 输出的 HTML 源码中该标签被转义为实体，预览中呈现为文本

#### Scenario: 复制 HTML 源码

- **WHEN** 用户在源码视图点击复制
- **THEN** 剪贴板内容为完整的 HTML 源码字符串

#### Scenario: 非法或空输入

- **WHEN** 输入区为空
- **THEN** 系统不报错、不输出内容

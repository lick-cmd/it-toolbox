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

#### Scenario: 单侧非法 JSON

- **WHEN** 左侧或右侧输入不是合法 JSON
- **THEN** 系统提示该侧 JSON 解析失败，不输出差异结果

#### Scenario: 交换两侧

- **WHEN** 用户点击交换按钮
- **THEN** 左右输入互换，差异结果中新增与删除的标记随之互换

### Requirement: JWT 解析器

系统 SHALL 提供 JWT 解析器，对输入的 token SHALL 解码并展示头部（Header）、载荷（Payload）与签名（Signature）三部分，且 SHALL 不校验签名、不发起任何网络请求。

#### Scenario: 解析标准 JWT

- **WHEN** 用户粘贴一个由三段 Base64URL 组成的合法 JWT
- **THEN** 系统分别展示解码后的 Header JSON 与 Payload JSON，以及原始签名片段

#### Scenario: 时间声明可读化

- **WHEN** Payload 中包含 `exp`、`iat`、`nbf` 声明
- **THEN** 系统为每个时间声明额外展示可读的日期时间，并标注该声明的含义（过期时间／签发时间／生效时间）

#### Scenario: 过期状态提示

- **WHEN** Payload 中 `exp` 对应时间早于当前时间
- **THEN** 系统显著提示该 token 已过期，并展示已过期时长

#### Scenario: 未过期状态提示

- **WHEN** Payload 中 `exp` 对应时间晚于当前时间
- **THEN** 系统提示该 token 仍在有效期内，并展示剩余时间

#### Scenario: 无 exp 声明

- **WHEN** Payload 中不含 `exp`
- **THEN** 系统提示该 token 未声明过期时间

#### Scenario: 常见头部信息摘要

- **WHEN** Header 中包含 `alg` 与 `typ`
- **THEN** 系统在概览区展示算法与类型，便于一眼识别

#### Scenario: 不校验签名的显式说明

- **WHEN** 用户解析任意 JWT
- **THEN** 界面上明确说明签名未被校验，避免误解为已通过验证

#### Scenario: 段数不合法

- **WHEN** 用户输入的 token 不是三段（例如两段或四段）
- **THEN** 系统提示 JWT 格式不合法并指出实际段数

#### Scenario: 载荷非法 JSON

- **WHEN** token 段数合法但载荷段无法解析为 JSON
- **THEN** 系统提示载荷解码失败，并仍展示可解码的头部信息

### Requirement: URL 分析器

系统 SHALL 提供 URL 分析器，将输入 URL 字符串拆解并展示其各个组成部分：协议、用户名、密码、主机名、端口、Origin、路径、路径分段、查询参数（含重复键的全部取值）与片段。

#### Scenario: 完整 URL 拆解

- **WHEN** 用户输入 `https://user:pass@example.com:8443/a/b?x=1&x=2#sec`
- **THEN** 系统分别展示协议 `https:`、用户名 `user`、密码 `pass`、主机名 `example.com`、端口 `8443`、路径 `/a/b`、查询参数 `x` 的两个取值 `1` 与 `2`、片段 `sec`

#### Scenario: Origin 推导

- **WHEN** 输入包含协议与主机名的 URL
- **THEN** 系统展示其 Origin（协议 + 主机 + 端口），端口为协议默认端口时 Origin 中不含端口

#### Scenario: 默认端口识别

- **WHEN** 用户输入 `https://example.com/path`（未显式写端口）
- **THEN** 系统展示端口为 `443`，并标注该端口为协议默认端口

#### Scenario: 路径分段

- **WHEN** 输入路径为 `/a/b/c`
- **THEN** 系统将路径拆解为 `a`、`b`、`c` 三个分段并逐项展示

#### Scenario: 查询参数以表格呈现

- **WHEN** 输入包含多个查询参数且存在同名参数
- **THEN** 系统以表格逐行展示键与值，同名参数的每一行均被展示，且支持对单个参数值进行解码后查看

#### Scenario: 相对 URL 或无协议输入

- **WHEN** 用户输入 `example.com/a?x=1`（不含协议）
- **THEN** 系统提示该输入不是绝对 URL，并给出可选的补全建议（如按 `https://` 解析）

#### Scenario: 非法 URL

- **WHEN** 用户输入无法被解析为 URL 的字符串
- **THEN** 系统提示解析失败并说明原因，不展示错误的分段结果

#### Scenario: 编码字符解码

- **WHEN** URL 的路径或参数中包含百分号编码字符
- **THEN** 系统同时展示原始编码形式与解码后的可读形式

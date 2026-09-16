## Purpose

加密类工具集 —— Token 生成器、UUID 生成器（v1/v4/v7）、ULID 生成器、HMAC 生成器、RSA 密钥对生成器

## Requirements

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

- **WHEN** 用户生成一个 ULID
- **THEN** 结果为 26 个字符且全部属于 Crockford Base32 字符集（不含 `I`、`L`、`O`、`U`）

#### Scenario: 时间戳可解析

- **WHEN** 用户生成一个 ULID
- **THEN** 系统展示其解码出的时间戳，且该时间与当前时间的偏差在 2 秒以内

#### Scenario: 单调递增

- **WHEN** 用户在同一毫秒内连续生成多个 ULID
- **THEN** 后一个 ULID 的字典序严格大于前一个

#### Scenario: 批量生成

- **WHEN** 用户将生成数量设为 20
- **THEN** 输出 20 个 ULID，每行一个，互不相同

### Requirement: HMAC 生成器

系统 SHALL 提供 HMAC 计算器，支持 SHA-1、SHA-256、SHA-384、SHA-512 算法，支持密钥与消息的多种编码（UTF-8 文本、十六进制、Base64），并支持多种输出格式（十六进制、Base64、Base64URL）。

#### Scenario: 默认算法计算

- **WHEN** 用户输入消息与密钥且使用默认算法
- **THEN** 输出为使用 SHA-256 计算所得 HMAC 的十六进制表示

#### Scenario: 密钥以十六进制给出

- **WHEN** 用户将密钥编码设为十六进制并输入 `6b6579`
- **THEN** 计算结果与使用 UTF-8 文本密钥 `key` 的结果一致

#### Scenario: 切换算法改变结果

- **WHEN** 用户在同一消息与密钥下将算法从 SHA-256 切换为 SHA-512
- **THEN** 输出摘要长度由 64 位十六进制字符变为 128 位十六进制字符

#### Scenario: 输出格式切换

- **WHEN** 用户将输出格式从十六进制切换为 Base64
- **THEN** 同一输入产生相同摘要的不同编码表示，且可相互还原

#### Scenario: 密钥为空

- **WHEN** 用户未填写密钥
- **THEN** 系统提示密钥不可为空且不输出结果

#### Scenario: 非法十六进制密钥

- **WHEN** 用户将密钥编码设为十六进制但输入了非十六进制字符
- **THEN** 系统提示密钥格式非法且不输出结果

### Requirement: RSA 密钥对生成器

系统 SHALL 提供 RSA 密钥对生成器，支持 1024、2048、3072、4096 位密钥长度，并 SHALL 支持以 PEM 格式导出公钥与私钥。

#### Scenario: 生成 2048 位密钥对

- **WHEN** 用户选择 2048 位并点击生成
- **THEN** 系统输出一对公钥与私钥，均为合法 PEM 文本

#### Scenario: 私钥格式

- **WHEN** 用户选择私钥格式为 PKCS#8
- **THEN** 私钥以 `-----BEGIN PRIVATE KEY-----` 开头；若选择 PKCS#1 则以 `-----BEGIN RSA PRIVATE KEY-----` 开头

#### Scenario: 公钥格式

- **WHEN** 用户选择公钥格式为 SPKI
- **THEN** 公钥以 `-----BEGIN PUBLIC KEY-----` 开头；若选择 OpenSSH 则以 `ssh-rsa ` 开头

#### Scenario: 生成期间的状态

- **WHEN** 用户触发密钥对生成
- **THEN** 生成按钮进入进行中状态并禁止重复提交，生成完成后恢复可点击

#### Scenario: 公钥私钥相互匹配

- **WHEN** 使用生成的公钥与私钥进行一次加密/解密或签名/验签验证
- **THEN** 验证通过，证明两者属于同一密钥对

#### Scenario: 参数变更不自动重算

- **WHEN** 用户修改密钥长度选项
- **THEN** 已生成的密钥对保持不变，直到用户再次点击生成

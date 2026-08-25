# Security Random Generator V2.0｜安全随机数据生成器

[简体中文](README.md) · [English](docs/readme-en.md)

浏览器本地运行的安全随机数据工作台。V2.0 将 Password、Passphrase、PIN、Token、API Secret、UUID、Hex、Random Bytes 与 BIP39 Mnemonic 统一到可审计的生成模型中。

[在线使用 V2.0](https://betaer.github.io/password-generator/index-2.0.html) · [稳定版 V1.7.5](https://betaer.github.io/password-generator/) · [源代码](https://github.com/betaer/password-generator)

> V1.7.5 的 `index.html` 保持不变；V2.0 使用独立入口 `index-2.0.html`。

## 九个生成器

| 模式 | 随机模型 | 主要用途 |
|---|---|---|
| Password | 在所有满足字符池、符号比例、必选类别、首尾、空格与重复约束的结果上均匀采样 | 账户密码、机器凭据 |
| Passphrase | 从实际唯一词表独立抽词，并计入随机大小写位置和每个随机分隔符 | 易输入的长口令 |
| PIN | completion-count 动态规划；按后缀可完成数量加权，均匀抽取合法 PIN | 设备码、门禁码、测试 PIN |
| Token | 随机字节后编码；固定前缀不计入熵 | 会话 Token、CSRF Token |
| API Secret | 随机字节 Secret，可选独立随机 Key ID | 测试和自建系统密钥 |
| UUID | RFC 9562 UUID v4 / v7 | 标准标识符 |
| Hex | 随机字节的十六进制表示 | Salt、Nonce、测试 Hex |
| Random Bytes | 1～1,048,576 原始随机字节，可显式下载二进制 | 密钥材料、测试向量 |
| Mnemonic | BIP39 ENT + SHA-256 checksum，十种官方词表 | 可校验助记词测试数据 |

所有随机数据来自 `crypto.getRandomValues()`。整数选择使用 rejection sampling，随机排列使用无偏 Fisher–Yates；Web Crypto 不可用时页面会明确停止生成，不会回退到 `Math.random()`。

## 安全度量

每条结果携带生成瞬间的不可变 `generationModel` 与配置快照，结果页不会再根据字符串“长什么样”反推生成器熵。

| 指标 | 含义 |
|---|---|
| Generator Min-Entropy | 真实生成分布中最大单个输出概率对应的保守安全强度 |
| Search Space | 当前约束下合法且可生成的精确结果数 |
| Effective Guess Count | 生成模型平均猜测次数与本地模式分析结果中更保守的一项 |
| Crack Time | 使用同一个 Effective Guess Count，在三种明确攻击速度下计算的估算时间 |

Password 的 estimator 与 sampler 共用同一个约束模型。符号比例范围不是取中间值近似；`requireEach`、首尾限制、内部非相邻 Space 与 `allowRepeated=false` 都进入计数和采样。自定义符号池按去重后的真实大小计算，因此只有 `!` 一个符号时不会按完整符号表高估。

Passphrase 会把实际词数、随机一个全大写词的位置，以及每个随机数字或符号分隔符都计入模型。PIN 不使用固定的 `-0.03 bit` 修正：弱 PIN 排名和规则集合与合法状态空间求精确交集，生成时再按 completion count 均匀抽样。

`zxcvbn-ts` 只做本地常见模式分析，而且只能降低 Effective Guess Count，不能给生成器增加熵。攻击时间是模型估算，不是安全承诺：

| 攻击模型 | 速度 |
|---|---:|
| 在线限速攻击 | 100 次/小时 |
| 慢速密码哈希 | 10⁴ 次/秒 |
| 快速离线哈希 | 10¹⁰ 次/秒 |

## BIP39 与标准格式

BIP39 支持 128 / 160 / 192 / 224 / 256-bit ENT，对应 12 / 15 / 18 / 21 / 24 个词。十种官方词表均为同源静态资源：English、Čeština、Français、Italiano、日本語、한국어、Português、简体中文、Español、繁體中文。Checksum 是确定性字段，不增加 Generator Min-Entropy。本页不会从助记词派生 seed、地址或私钥。

UUID v4 的随机强度为 122 bits；UUID v7 的时间戳、version 和 variant 是确定性结构，随机强度为 74 bits。大小写、连字符、Hex 的 `0x`、Token/API Secret 的固定前缀以及 Base64 padding 都只改变格式，不增加随机熵。

带有 `sk_test_`、`sk_live_` 或“钱包私钥外观”的方案只用于 UI、数据库和演示数据测试，不代表服务商签发，也不校验椭圆曲线，不能作为真实钱包密钥或第三方 API 凭据。

## 隐私与运行时边界

| 数据或能力 | V2.0 行为 |
|---|---|
| 生成 | 只生成，不自动写入剪贴板 |
| 复制 | 只有用户显式点击后才写入系统剪贴板；失败会明确提示 |
| 当前结果 | 默认显示独立遮蔽占位符；主动显示时明文才进入可见 DOM |
| 超长结果 | 超过 4,096 字符时即使点击显示也不渲染明文，改用显式复制或下载 |
| History | 默认关闭；启用后只保存在当前页面内存，最多 100 条 |
| localStorage | 仅保存白名单非秘密设置，不保存结果、History、自定义前缀或自定义符号文本 |
| sessionStorage / IndexedDB | 不保存 V2.0 生成历史 |
| 静态安全资源 | zxcvbn、PIN 风险库、词包与 BIP39 词表均从本站同源加载 |
| Google Analytics | 保留在只有 `allow-scripts`、没有 `allow-same-origin` 的 sandbox iframe；只接收固定 V2 页面访问，不存在父子消息桥 |

Google Analytics 的 JavaScript 在隔离 iframe 内仍可向 Google 发起统计请求，但不能读取父页面 DOM、JavaScript 状态、URL 查询、hash、referrer 或生成内容。父页面 CSP 不信任 Google 域，也不执行 Google 远程脚本。

浏览器 JavaScript String 不可变，平台不提供可靠的内存清零能力。因此项目只承诺主动清除可控的字节缓冲区和释放引用，不宣传“删除后立即从内存彻底擦除”。剪贴板管理器、跨设备同步、浏览器扩展、输入法、辅助软件和受感染终端仍属于外部攻击面。

## 本地运行与验证

```bash
npm install
npm run build:v2
npm run serve
```

然后访问 `http://127.0.0.1:8765/index-2.0.html`。

```bash
npm test                    # V1.7.5 回归测试
npm run test:v2             # V2.0 模型与集成测试
npm run test:coverage:v2    # V2.0 覆盖率门槛
```

`npm run build:v2` 会可复现地构建冻结的浏览器运行时、本地 zxcvbn 分析器、PIN 风险资源和十种 BIP39 词表。第三方版本、来源哈希和许可证见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。

## 项目结构

```text
.
├── index.html                 # V1.7.5 稳定入口
├── index-2.0.html             # V2.0 九模式入口
├── src/v2/                    # 随机核心、概率模型与统一结果/强度模型
├── assets/v2/                 # 浏览器运行时、UI、Worker、GA iframe、风险库与 BIP39 词表
├── scripts/                   # V1/V2 可复现构建脚本
├── tests/v2/                  # V2.0 确定性模型、资产与隐私集成测试
├── docs/                      # 英文文档、V2 设计与实现计划
└── THIRD_PARTY_NOTICES.md     # 第三方组件、语料与许可证
```

## 能力边界

- 本项目是生成与分析工具，不是密码管理器、钱包、密钥托管服务或硬件随机数设备。
- Generator Min-Entropy 描述本生成算法；用户自行修改、截短、复用或选择结果后，原模型不再适用。
- 高价值凭据仍应结合密码管理器、MFA、服务端限速、现代密码哈希与安全终端环境。
- 仓库当前未附带开源许可证；公开可读不等于获得复制、修改或再分发授权。

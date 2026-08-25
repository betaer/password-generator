# Security Random Generator V2.0.1｜安全随机数据生成器

[简体中文](README.md) · [English](docs/readme-en.md)

浏览器本地运行的安全随机数据工作台，覆盖 Password、Passphrase、PIN、Token、API Secret、UUID、Hex、Random Bytes 与 BIP39 Mnemonic。V2.0.1 采用“统一概率契约 + 各类型专用模型”，不会把九类数据都套进同一套密码强度结论。

[在线使用 V2.0.1](https://betaer.github.io/password-generator/v2.01.html) · [V2.0](https://betaer.github.io/password-generator/index-2.0.html) · [稳定版 V1.7.5](https://betaer.github.io/password-generator/) · [源代码](https://github.com/betaer/password-generator) · [![Visitors](https://visitor-badge.laobi.icu/badge?page_id=betaer.password-generator)](https://github.com/betaer/password-generator)

> 根入口 `index.html` 继续保留 V1.7.5；`index-2.0.html` 继续保留 V2.0；V2.0.1 独立发布为 `v2.01.html`，资源目录与旧版完全隔离。

## V2.0.1 的核心变化

- 每个批次冻结 `mode / config / quantity`，生成器切换会取消旧任务；Worker 回包必须匹配 generation epoch，失败、取消和过期任务会清理未提交结果。
- Password、Passphrase 与 PIN 每批只编译一次模型。PIN 批量默认使用精确 rank/unrank 无放回抽样，保证批内唯一。
- 均匀有限空间的 Expected Guess Count 使用精确 `(N + 1) / 2`，不再使用 `N / 2` 近似。
- Random Bytes 使用精确的 `2^n` 符号空间，不创建数百万位十进制 BigInt；完整 Hex/Base64 只在显式复制时生成。
- Passphrase 词包与 BIP39 词表是 V2.0.1 独立内容哈希资源；结果记录源词表 SHA-256 与有效词池 SHA-256。
- zxcvbn 位于单并发独立 Worker，输入最长 512 字符；late-ready 会重分析仍存活结果，stale 回调不会写回。
- API Secret 只保留 Generic 与无厂商含义的 `demo_test_v1_` Synthetic Demo，不再生成容易触发真实服务 Secret Scanner 的外观。
- “生成”与“复制”完全分离；History 每次会话默认关闭，只在内存中按条数与总字节预算保留。
- 所有浏览器资源采用内容哈希文件名，并通过 HTML/runtime `2.0.1` 版本握手防止混合缓存。

## 九个生成器与结果语义

| 类型 | 生成模型 | 结果页重点 |
|---|---|---|
| Password | 约束感知的均匀采样，符号比例、必选类别、首尾、空格与禁止重复进入同一模型 | 精确生成器指标、观察模式估算、带速率假设的攻击场景 |
| Passphrase | 实际词池独立抽取，并计入随机大小写位置和每个随机分隔符 | 词包/有效词池哈希、精确生成器指标、观察模式估算 |
| PIN | completion-count 加权抽样；批量可精确无放回 | 合法空间、精确期望次序、批次碰撞概率、启发式风险策略 |
| Token | CSPRNG 字节后编码 | 随机位数、编码、固定前缀长度、碰撞语义 |
| API Secret | Generic 或 Synthetic Demo 随机字节 Secret | 随机位数、合成凭据警告、碰撞语义 |
| UUID | RFC 9562 v4 / v7 | Version、Variant、随机位、v7 时间戳；明确“Identifier, not a secret” |
| Hex | CSPRNG 字节的十六进制表示 | 随机位数、编码与用途边界 |
| Random Bytes | 1～1,048,576 原始随机字节 | 字节数、Nominal CSPRNG Output Bits、SHA-256、下载 |
| BIP39 | ENT + SHA-256 checksum，官方词表固定哈希 | ENT、CS、词数、语言、checksum 与钱包兼容性边界 |

所有随机数据来自 `crypto.getRandomValues()`。整数选择使用 rejection sampling，随机排列使用无偏 Fisher–Yates；Web Crypto 或 `subtle.digest` 不可用时会 fail closed，不回退到 `Math.random()`。

## 三层安全度量

V2.0.1 不再使用统一的 “Exact Effective Guess Count / Exact Crack Time”。结果卡分成三层：

| 层级 | 性质 | 适用范围 |
|---|---|---|
| Exact Generator Metrics | 根据生成时不可变概率模型计算 Search Space、Min-Entropy、Shannon Entropy 和 `(N + 1) / 2` Expected Guess Count | 所有生成器，但字段按类型解释 |
| Observed Pattern Estimate | zxcvbn 对结果外观的经验型字典/模式估算，不是生成分布的数学证明 | Password、Passphrase |
| Attack Scenario Estimate | 按公开速率、锁定和验证函数假设估算攻击成本，不是安全保证 | Password、Passphrase；PIN 只披露设备重试策略 |

Password / Passphrase 的攻击场景会明确展示：100 次/小时在线限速、`10⁴` 次/秒慢速密码哈希 / KDF、`10¹⁰` 次/秒快速离线验证。UUID、Random Bytes、Token、Hex 与 BIP39 不显示通用密码哈希破解时间。

Passphrase 继续按实际有效词池计数；下表只是固定词池规模的直观对照，实际结果以 Generation Model Details 中的有效词池哈希与计数为准：

| 词包规模 | 每词熵 | 4 个词 | 6 个词 |
|---:|---:|---:|---:|
| 1,024 | 10 bits | 40 bits | 60 bits |
| 1,296 | 约 10.34 bits | 约 41.36 bits | 约 62.04 bits |
| 7,776 | 约 12.92 bits | 约 51.70 bits | 约 77.55 bits |

主题词包候选更聚焦、空间更小，主题词包建议至少 6 个词；需要更高强度时应增加词数或使用 7,776 词包。

Web Crypto 标准提供适用于密码学用途的高质量随机源，但不向页面承诺可测量的信息论最小熵下限。因此字节型结果使用更严谨的名称 `Nominal CSPRNG Output Bits`，并明确建立在浏览器 Web Crypto 未遭破坏、输出可建模为均匀 CSPRNG 的假设上。

## PIN 风险策略

PIN 核心 sampler 使用 completion-count DP，并根据后缀合法完成数量加权。`blockWeak` 被明确命名为 `Heuristic Common-PIN Exclusion Policy v1`：

- 4 位排名语料阈值：前 500；
- 6 位数字语料阈值：前 1,000；
- 固定来源中包含 68,202 个唯一六位数字候选，但策略只封锁公开阈值内的交集；
- 8 位及以上没有排名语料，主要依赖日期、连续、短周期与键盘路径规则；
- 页面披露 source commit、阈值、过滤前后空间和当前长度覆盖范围。

对公开过滤策略下的均匀生成器，剩余输出仍等概率。排除常见外观的价值来自 common-first 经验攻击策略，不应与均匀生成熵混为一谈。

## BIP39、UUID 与真实使用边界

BIP39 支持 128 / 160 / 192 / 224 / 256-bit ENT，对应 12 / 15 / 18 / 21 / 24 个词。十种官方词表在注册前验证固定 SHA-256。非 English 词表会显示显著兼容性警告，因为多数钱包只保证 English BIP39 兼容。生成前必须显式确认浏览器、扩展、剪贴板与钱包兼容性边界，该确认不会持久化。

在线页面不能等同硬件钱包。高价值真实资产优先使用硬件钱包或经过验证的离线构建；浏览器扩展、系统恶意软件、屏幕录制、剪贴板监听与被替换的终端环境不在页面保护边界内。

UUID v4 提供 122 个随机位，UUID v7 提供 74 个随机位并包含 48-bit Unix 毫秒时间戳。UUID 是标识符，不应作为密码、API Secret、capability 或访问凭据。

## 隐私、DOM 与资源预算

| 数据或能力 | V2.0.1 行为 |
|---|---|
| 生成 | 只生成，不自动写入系统剪贴板 |
| 复制 | 只有显式点击才写入；超过 1 MiB 二次确认，超过 4 MiB 拒绝并建议下载 |
| 当前结果 | 默认固定 24 个遮蔽符，不通过遮蔽 UI 泄露长度 |
| DOM | 主动显示后才写入明文；超过 4,096 字符只显示摘要；Model Details 会脱敏自由文本字段 |
| Random Bytes | `≥64 KiB` 时 quantity 必须为 1；批次原始数据总量上限 8 MiB；大结果延迟编码 |
| History | 每次会话默认关闭；最多 100 条且秘密总量最多 8 MiB；不写入 storage |
| localStorage | 只保存白名单结构化设置；不保存结果、History、自由文本 prefix、symbol pool 或 separator 候选 |
| sessionStorage / IndexedDB | 不保存 V2.0.1 生成历史 |
| 删除 | 覆写可控 `Uint8Array` 并释放引用；不承诺 JavaScript String 被可靠清零 |

简要说：只生成，不自动写入剪贴板。History | 默认关闭；启用后只保存在当前页面内存，并继续受 100 条与 8 MiB 双重预算限制。JavaScript String 不可变，因此只能释放引用，不能证明底层内存已被立即擦除。

## Google Analytics 隔离

GA 保留，但只作为“隔离、无本站 Analytics Cookie 的页面访问统计”：

- Google JS 不在生成器父页面执行；父页面 CSP 不信任 Google 域；
- iframe 只有 `sandbox="allow-scripts"`，没有 `allow-same-origin`、消息桥、referrer 或父页面 URL 数据；
- 只配置固定的 `https://betaer.github.io/password-generator/v2.01.html`、固定 path/title 和空 referrer；
- 不向 iframe 发送生成器类型、配置、输入、prefix、结果或 BIP39；
- `analytics_storage='denied'` 下仍会发送 cookieless measurement ping，Google 仍可能收到 User-Agent、IP、时间等标准浏览器/网络层元数据，因此不使用“完全匿名”表述。

Playwright 验收会拦截实际 `g/collect`，解析 URL、body 和 headers，以高辨识 sentinel 验证生成内容不会进入统计请求，并确认没有 Cookie header。

也可以在浏览器 DevTools → Network 中自行复核：生成、显示和复制若干结果，请求不应包含 `generated_value` 或任何生成内容。History 不会跨浏览器会话持久保存，且启用后可随时清空。

## 本地构建与完整验证

```bash
npm ci
npm run build:v201
npm run serve
```

访问 `http://127.0.0.1:8765/v2.01.html`。

```bash
npm run test:v201             # V2.0.1 单元与集成测试
npm run test:coverage:v201    # 80% branches/functions/lines/statements 门槛
npm run test:e2e:v201         # 九模式、竞态、预算、DOM、剪贴板、GA 网络与响应式验收
npm run verify:v201           # V1 + V2 + V2.0.1 + coverage + E2E + audit + artifact diff
```

`build:v201` 会重建 `v2.01.html` 与 `assets/v2.01/`，所有浏览器资源使用 SHA-256 前 12 位内容哈希命名。连续构建必须产生完全相同的文件，`git diff --exit-code` 才允许部署。

GitHub Pages 自定义 workflow 强制执行完整门禁，上传独立 `_site` 制品，并创建 Sigstore/GitHub build provenance attestation 后才部署。主页面 meta CSP 无法实现 `frame-ancestors`；需要反向代理响应头时请参考 [`docs/security-headers.v201.example`](docs/security-headers.v201.example)，该文件不会被 GitHub Pages 自动应用。

## 项目结构

```text
.
├── index.html                    # V1.7.5 稳定入口
├── index-2.0.html                # V2.0 保留入口
├── v2.01.html                    # V2.0.1 发布入口
├── src/v201/                     # 概率契约、任务、预算、专用结果语义与 UI 源码
├── assets/v2.01/                 # 内容哈希 runtime/UI/Workers/GA/词表/风险资源
├── scripts/build-v201.mjs        # 可复现内容哈希构建
├── scripts/verify-v201-browser.mjs # 浏览器与真实 GA 网络参数验收
├── tests/v201/                   # V2.0.1 单元、集成、发布契约测试
└── .github/workflows/v201-pages.yml # 强制验证后部署
```

## 能力边界

- 本项目是生成与分析工具，不是密码管理器、钱包、密钥托管服务或硬件随机数设备。
- Generator Min-Entropy 描述记录下来的生成算法；用户修改、截短、复用或挑选结果后，原模型不再适用。
- 攻击场景是明确假设下的估算，不是账户或资产安全保证。
- 仓库当前未附带开源许可证；公开可读不等于获得复制、修改或再分发授权。

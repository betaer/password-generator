# Password Generator V2.0 统一安全随机数据生成器设计规格

日期：2026-08-25  
版本：V2.0  
状态：设计已确认，待用户审阅书面规格后进入实施计划

## 1. 背景与目标

V1.7.5 已正确使用 Web Crypto、拒绝采样和 Fisher-Yates，但生成算法与熵估算器不是同一个概率模型。在符号比例、强制字符类型、边界限制、禁止重复、自定义字符池和 PIN 条件生成等高级配置下，页面可能显示与真实生成分布不一致的 Entropy、Guess Count 和 Crack Time。

V2.0 的目标是把项目升级为统一的本地安全随机数据生成器，完整覆盖：

1. Password
2. Passphrase
3. PIN
4. Token
5. API Secret
6. UUID
7. Hex
8. Random Bytes
9. BIP39 Mnemonic

V2.0 必须同时修复剪贴板、历史、明文 DOM、异步安全资源状态和第三方统计脚本的安全边界问题。

## 2. 交付边界

- 保留根目录 `index.html` 作为 V1.7.5 稳定版和回滚入口。
- 基于 V1.7.5 创建完整可用的 `index-2.0.html`，不以半成品或仅有页面骨架的形式发布。
- V2.0 使用独立的资源目录、构建入口、设置命名空间和测试入口，避免与 V1.7.5 缓存或配置互相污染。
- GitHub Pages 发布后，V2.0 可通过 `/password-generator/index-2.0.html` 直接访问。
- 本轮不自动把 V2.0 覆盖为根目录默认入口；默认入口切换留给独立的发布决策。

## 3. 安全不变量

以下条件是实现和测试不可放宽的验收标准：

- 所有秘密生成均使用 `crypto.getRandomValues()`。
- 所有有界随机整数均使用拒绝采样，不使用取模偏差。
- Password、Passphrase、PIN、Token、API Secret、UUID、Hex、Random Bytes 和 Mnemonic 的业务随机路径不得使用 `Math.random()`。
- Generator Min-Entropy 必须来自实际生成模型，不得从生成后的字符串外观反推。
- 生成结果必须携带不可变的生成模型快照和真实源熵。
- 固定前缀、版本位、时间戳、分隔符常量和校验和不得错误计入随机熵。
- zxcvbn 和 PIN 模式分析只能降低有效猜测次数，不能提高 Generator Min-Entropy。
- 点击“生成”不得写入系统剪贴板。
- History 默认关闭，秘密不得写入 `localStorage` 或 `sessionStorage`。
- 未主动显示结果前，秘密明文不得出现在 DOM、Tooltip、`title` 或 `aria-*` 属性中。
- Google Analytics 必须在无 `allow-same-origin` 的 sandbox iframe 中运行，不得在生成器主页面执行第三方脚本。
- 任何网络请求和统计参数不得包含密码、PIN、助记词、Token、API Secret、原始字节、用户输入或生成历史。
- 浏览器无法可靠清零 JavaScript String；产品和文档不得承诺“彻底内存擦除”。

## 4. 总体架构

```text
Web Crypto + Rejection Sampling
              ↓
统一随机、BigInt 与组合数学内核
              ↓
类型化 GenerationModel
  ├─ validate(config)
  ├─ countValidOutputs(config)
  ├─ sampleUniform(config, randomSource)
  ├─ describeEntropy(config)
  └─ createResult(value, metadata)
              ↓
Password / Passphrase / PIN / Token / API Secret
UUID / Hex / Random Bytes / BIP39 Mnemonic
              ↓
不可变 GenerationResult
              ↓
模式分析与攻击模型
              ↓
Generator Min-Entropy / Effective Guess Count / Crack Time
```

建议源码边界：

```text
src/v2/
  random-core.mjs
  combinatorics.mjs
  result-model.mjs
  password-model.mjs
  passphrase-model.mjs
  pin-model.mjs
  byte-secret-models.mjs
  uuid-model.mjs
  bip39-model.mjs
  security-assessment.mjs
  encoders.mjs
  runtime-entry.mjs
```

各模块必须是可独立测试的纯函数或具有显式依赖注入的函数。Web Crypto、当前时间和资源加载器均通过参数注入，测试不得依赖不可控的全局随机状态。

## 5. 概率与安全指标定义

### 5.1 Search Space

`searchSpace` 是满足当前全部生成约束的不同输出数量。计数使用 BigInt，显示层使用对数格式，不得因超大空间出现 `Infinity` 或 `NaN`。

### 5.2 Shannon Entropy

```text
H(X) = -Σ p(x) log2 p(x)
```

### 5.3 Generator Min-Entropy

```text
H∞(X) = -log2(max p(x))
```

Generator Min-Entropy 是 V2.0 的核心安全指标。所有受约束生成器应在合法输出集合上均匀采样，因此：

```text
Generator Min-Entropy = Shannon Entropy = log2(searchSpace)
```

如果某个标准格式因确定性字段或校验和使输出集合受限，只计算真正随机的自由度。

### 5.4 Average Guess Count

均匀输出空间的平均穷举猜测次数为：

```text
generatorAverageGuesses = searchSpace / 2
generatorAverageGuessBits = max(0, log2(searchSpace) - 1)
```

### 5.5 Effective Guess Count

```text
effectiveGuessBits = min(generatorAverageGuessBits, patternGuessBits)
```

只有模式分析状态为 `ready` 且分析器返回有效结果时才采用 `patternGuessBits`。分析器未就绪、失败或不适用时，页面必须明确状态，并使用生成模型的平均猜测次数。

### 5.6 Crack Time

```text
estimatedSeconds = 2 ^ effectiveGuessBits / guessesPerSecond
```

攻击模型继续使用：

| 模型 | 速度 | 场景 |
|---|---:|---|
| 在线限速攻击 | 100 次/小时 | 有限速、锁定或验证码的登录页面 |
| 慢速密码哈希 | 10⁴ 次/秒 | Argon2id、scrypt、bcrypt、PBKDF2 等 |
| 快速离线哈希 | 10¹⁰ 次/秒 | 数据库泄露、快速哈希和并行硬件 |

等级常量只保留 bit 边界、名称、颜色和与时间无关的建议。不得在等级常量中保存固定破解时间或固定年数文案。

### 5.7 Observed Composition Estimate

来源未知的手动输入只允许展示 `Observed Composition Estimate`。该估算必须明确标注为观察值，不得命名为理论熵、Generator Entropy 或生成器保证。

## 6. GenerationResult 数据模型

每个结果至少包含：

```js
{
  id,
  type,
  schemeId,
  value,
  createdAt,
  configSnapshot,
  generationModel: {
    sourceEntropyBits,
    minEntropyBits,
    shannonEntropyBits,
    searchSpace,
    averageGuessBits,
    alphabet,
    poolSizes,
    randomByteLength,
    encoding,
    prefix,
    checksumBits,
    standard,
  },
}
```

- `configSnapshot` 和 `generationModel` 必须深度冻结或通过不可变构造器创建。
- 生成后的安全分析只读取 `generationModel`，不得调用字符串组成估算器替代它。
- 原始字节类结果可以在当前结果存活期间保留 `Uint8Array`；删除结果时应清零仍可变的字节数组并释放引用，但不得把这描述为浏览器级可靠内存擦除。

## 7. Password 模型

### 7.1 约束语义

- `symbolRatioRange` 是最终密码中符号数量的硬范围。
- 最小符号数使用 `ceil(length × minPercent / 100)`。
- 最大符号数使用 `floor(length × maxPercent / 100)`。
- 首字符、尾字符、空格规则、`requireEach`、自定义字符池、排除字符和 `allowRepeated` 全部参与合法输出计数。
- 字符池必须规范化为互不重叠的字符集合；自定义符号中与字母或数字重复的字符从符号池移除，并在 UI 中说明。
- `allowRepeated=false` 时，长度超过全部可用唯一字符数量必须阻止生成并给出验证错误。

### 7.2 均匀采样

V2.0 不再均匀选择符号数量，也不再逐位置均匀选择当前可用字符类型。采样器根据每个候选分支的合法完成数量选择下一步：

```text
P(next branch) = completionCount(next state) / completionCount(current state)
```

对于长密码，使用组合闭式计数、对称类状态和缓存，而不是构建完整输出集合。对于禁止重复的配置，状态追踪各字符类剩余数量，不使用错误的全局 `P(totalPool, length)` 替代实际分类约束。

### 7.3 结果安全分析

- Generator Min-Entropy 来自生成时模型快照。
- 自定义单符号池按大小 1 计算。
- Hex、Base58、Bech32 等格式方案按真实方案字符池和随机字段计算。
- zxcvbn 只分析实际结果是否会被常见攻击顺序提前猜中。

## 8. Passphrase 模型

- 每个单词从所选词包的实际唯一词数中独立均匀抽取。
- 固定分隔符不增加熵。
- 随机数字分隔符、随机符号分隔符和随机分隔符集合按实际唯一候选数计数。
- 随机大小写位置或大小写模式按实际可生成的不同输出计数。
- 生成前设置估算和生成后结果分析必须读取同一个生成模型快照。
- 普通 Passphrase 不得标记为 BIP39，也不得暗示可恢复区块链钱包。

## 9. PIN 模型

### 9.1 支持范围

- 预设长度：4、6、8、12。
- 自定义长度：4～32 位。
- 支持前导零、允许/禁止重复、连续数字限制和弱 PIN 排除。

### 9.2 均匀受约束采样

PIN 使用 completion-count DP。每个候选数字按其后方合法完成数量加权，不再对当前可选数字简单均匀选择。

DP 状态必须覆盖：

- 当前长度和前缀约束状态；
- 前导零规则；
- 已用数字 mask；
- 连续方向和连续长度；
- 弱模式自动机或等价的精确状态；
- 4/6 位风险排名排除集合。

### 9.3 弱 PIN

- 重复数字、短周期循环、升降序、键盘路径和适用的日期格式覆盖全部支持长度。
- 4 位和 6 位使用本地排名库。
- 排除集合必须与约束合法集合求精确交集。
- `searchSpace = constraintValidPins - blockedPins`。
- 删除固定 `-0.03 bit` 修正。
- `blockWeak=true` 时，完整风险模型是生成前置条件；资源未 ready 时不得声称已经执行完整过滤。

## 10. Token 模型

- 核心参数是随机字节数，不是编码后的字符长度。
- 支持 Hex、Base64、Base64URL 和无填充 Base64URL。
- 预设：128、192、256、384、512 bits。
- 自定义范围：1～4096 bytes。
- 支持固定前缀；前缀不计入熵。
- 编码不改变源熵。

## 11. API Secret 模型

- 提供通用 API Secret，不声称可以替代真实服务商签发的密钥。
- 支持固定前缀、环境标识、版本字段、随机主体长度和编码方式。
- 提供 `sk_live_`、`sk_test_` 等测试外观模板，并明确标注“仅供测试”。
- 可选生成 Key ID + Secret；Key ID 与 Secret 使用独立随机源和独立结果字段。
- 强度只按 Secret 的随机主体计算；固定前缀、环境和格式字段不计入。

## 12. UUID 模型

- 支持 RFC 9562 UUID v4 和 UUID v7。
- UUID v4 固定 version/variant 位，Generator Min-Entropy 为 122 bits。
- UUID v7 的 48-bit Unix 毫秒时间戳不计入熵；12-bit `rand_a` 与 62-bit `rand_b` 合计 74 random bits。
- 每个 UUID v7 使用当前时间和独立 74-bit Web Crypto 随机值。
- 大小写与连字符只改变表示，不改变熵。
- 时间来源可注入，以便使用 RFC 格式和位级测试验证。

## 13. Hex 模型

- 按随机字节数生成，范围 1～4096 bytes。
- 支持小写、大写和可选 `0x` 前缀。
- Generator Min-Entropy 严格为 `byteLength × 8`。
- 钱包私钥外观方案继续标记为测试数据，不执行曲线验证、公钥推导或链上检查。

## 14. Random Bytes 模型

- 直接生成 `Uint8Array`，范围 1～1,048,576 bytes。
- 同一批字节可切换 Hex、Base64 和 Base64URL 表示，不重新生成随机数据。
- 超过 4096 个显示字符时默认不把全部内容渲染进 DOM，只提供摘要、复制和显式下载。
- 只有点击下载时才创建 Blob 和对象 URL；下载结束后立即撤销 URL。
- Generator Min-Entropy 为 `byteLength × 8`。

## 15. BIP39 Mnemonic 模型

- 支持 ENT 128、160、192、224、256 bits，对应 12、15、18、21、24 个单词。
- 使用 SHA-256 生成 `ENT / 32` 校验和 bits。
- 校验和是确定性字段，不增加 Generator Min-Entropy。
- 本地打包 BIP39 官方词表：英语、简体中文、繁体中文、日语、韩语、西班牙语、法语、意大利语、捷克语、葡萄牙语。
- 使用公开标准测试向量验证熵、校验和、单词索引和往返校验。
- Mnemonic 默认遮蔽显示，不自动复制，不自动写入历史。
- V2.0 不自动派生 seed、钱包地址或私钥，避免扩大助记词暴露面。

## 16. 信息架构与结果 UI

生成器按三组展示：

| 分组 | 生成器 |
|---|---|
| 人类凭据 | Password、Passphrase、PIN、Mnemonic |
| 机器密钥 | Token、API Secret、Hex、Random Bytes |
| 标准标识符 | UUID |

每个类型有独立 URL hash。刷新或直接访问 hash 后必须恢复正确生成器，但不得把生成值放入 URL。

每条结果显示：

1. Generator Min-Entropy
2. Search Space
3. Effective Guess Count
4. 三种攻击模型的 Crack Time
5. 生成来源和固定字段说明
6. 模式分析状态

默认只渲染遮蔽占位符。显示、隐藏、复制、下载和删除都是独立显式动作。

## 17. Clipboard

- 主按钮只命名为“生成”并只执行生成。
- “复制当前结果”和“复制全部”必须由用户显式点击。
- 复制成功后说明内容已经进入系统剪贴板及其潜在暴露范围。
- 优先使用 `navigator.clipboard.writeText()`。
- fallback textarea 必须在 `try/finally` 中清空 value 并删除节点。
- 复制操作不得把明文放入通知、Tooltip、日志或统计事件。
- 不自动清空系统剪贴板，避免覆盖用户后来复制的内容。

## 18. History、Storage 与 DOM

### 18.1 History

- 默认关闭。
- 用户主动开启后只保存在当前 React 内存中。
- 最多保留 100 条；达到上限删除最旧结果。
- 刷新、关闭页面、关闭 History 或手动清空时释放历史引用。
- V2.0 不把历史写入 `sessionStorage`、`localStorage`、IndexedDB 或 Cache Storage。

### 18.2 设置

- 非秘密设置使用独立命名空间 `password-generator:v2:settings`。
- 不保存生成结果、用户输入、助记词、Token、API Secret 或原始随机字节。
- V1.7.5 设置不得自动覆盖 V2.0 设置。

### 18.3 DOM

- 默认遮蔽必须生成独立占位符字符串，不能把明文放入 DOM 后依靠 CSS 隐藏。
- Tooltip、`title`、`aria-label`、复制状态和历史列表默认不得包含明文。
- 用户点击“显示”后，才允许该条明文进入可见 DOM。
- 再次隐藏或删除后，明文必须离开当前渲染树。
- 文档明确说明秘密仍会存在于当前 JavaScript 运行时，且浏览器不提供可靠 String zeroization。

## 19. Google Analytics 沙箱隔离

V2.0 保留 Measurement ID `G-DWZ72TFWQF`，但 Google 脚本不得在生成器主页面执行。

结构：

```text
index-2.0.html
  └─ iframe sandbox="allow-scripts"
       └─ assets/v2/analytics-frame.html
            └─ https://www.googletagmanager.com/gtag/js
```

要求：

- iframe 不得设置 `allow-same-origin`。
- iframe 使用 `referrerpolicy="no-referrer"`，不可见且不参与页面布局。
- 主页面 CSP 的 `script-src`、`connect-src` 和 `img-src` 不允许 Google 域名，只允许 `frame-src 'self'`。
- 统计 iframe 自己的 CSP 才允许 Google Tag Manager 和 GA 收集端点。
- iframe 只发送固定 V2.0 页面访问统计，不从父页面接收消息。
- `page_location` 使用固定公开 V2 URL，不读取父页面 URL、hash 或查询参数。
- 不发送生成器类型、配置、结果、输入、复制、显示、下载或 History 行为事件。
- 父页面不注册来自统计 iframe 的消息处理器。
- 自动化测试必须证明 iframe 无法读取父页面 DOM，并检查 GA 请求参数中不存在测试秘密。

该方案保留页面访问统计，但不承诺 Google 的 cookie 或增强统计能力与顶层脚本完全相同。

## 20. 异步资源状态与错误处理

所有异步资源统一使用：

```text
idle → loading → ready
               ↘ degraded
               ↘ error
```

- `loading`：显示正在加载，不能显示“未发现模式”。
- `ready`：分析成功后才允许显示“未发现常见模式”。
- `degraded`：显示生成器精确熵，但明确模式分析、排名或扩展词表不可用。
- `error`：影响正确生成的资源必须阻止生成并提供可恢复的重试操作。
- zxcvbn 失败不阻止已知模型的安全生成，但不能显示肯定的模式结论。
- `blockWeak=true` 的 PIN 风险模型、所选 Passphrase 词包和所选 BIP39 词表必须 ready 后才能生成。
- Web Crypto 不可用时所有秘密生成器硬失败，不回退到伪随机实现。
- 资源加载完成后，应重新校验仍在页面中的相关结果；失败结果不得被保存为 History。

## 21. 构建与兼容性

- V2.0 纯函数源码位于 `src/v2/`，浏览器构建产物位于 `assets/v2/`。
- 构建结果必须可复现，并由测试确认源码与提交产物一致。
- `index-2.0.html` 不从第三方 CDN 加载生成器、UI、安全模型、词表或随机数据依赖。
- 为兼容 `file://`，关键运行时使用本地 classic-script/IIFE 产物；按需词表和风险数据提供可由本地脚本加载的版本化资源，而不是只依赖 `fetch()` 或动态 ESM import。
- HTTP 和 `file://` 的资源状态必须可区分；不支持的能力应明确提示，不得静默使用错误模型。
- 大型组合计数必须缓存，不得在每次 React render 中重新计算。
- 长密码和大字节输出不得阻塞主线程到不可交互；必要时使用 Web Worker 或分片执行，且 Worker 仍只加载同源 V2 资源。

## 22. 测试策略

### 22.1 TDD 与覆盖率

- 新功能先写失败测试，再写实现。
- `src/v2/` 新概率和生成模块分支覆盖率不低于 80%。
- 标准格式、边界条件、安全失败路径和隐私行为必须有直接测试，不以源码正则断言代替行为测试。

### 22.2 数学验证

| 模块 | 验收方式 |
|---|---|
| Password | 小字符池穷举与模型 BigInt 计数完全一致 |
| Symbol range | 每个允许符号数量进入总空间，采样权重来自完成数量 |
| requireEach | 小空间穷举验证强制字符类计数 |
| Boundary | 首尾限制与总计数一致 |
| No-repeat | 分类剩余池模型与穷举一致 |
| PIN | 4/6 位 DP 计数与穷举一致，8/12 位规则行为验证 |
| blockWeak | 精确排除交集，不存在固定 bit 修正 |
| Passphrase | 生成前后使用同一词包、大小写和分隔符模型 |
| Bytes/Token/Hex | 源熵严格等于随机字节数乘 8 |
| UUID | 位级验证 version、variant、时间戳和随机位 |
| BIP39 | 官方测试向量和往返校验 |
| Crack Time | 三种模型只读取同一 Effective Guess Count |

随机性测试以确定性随机源、边界注入、拒绝区间和完成数量证明为主，避免依赖容易波动的统计测试作为唯一证据。

### 22.3 浏览器 E2E

- 点击生成不调用 Clipboard API。
- 显式复制才调用 Clipboard API。
- fallback 抛出异常后 textarea 已清空并删除。
- History 默认关闭且不写 `sessionStorage`。
- 未显示结果前测试秘密不存在于 DOM、Tooltip、title 和 aria 属性。
- 删除结果后测试秘密离开渲染树和 History 状态。
- GA iframe 无法访问父 DOM；请求参数不含测试秘密。
- zxcvbn、PIN 风险库、词包和 BIP39 词表的 loading、ready、degraded、error 状态正确。
- Web Crypto 缺失时硬失败。
- V1.7.5 与 V2.0 可同时打开且设置命名空间隔离。
- 八类目标能力加 PIN 的核心生成、复制、显示、批量和清空路径均覆盖。

### 22.4 发布验证

推送前必须通过：

- 全部单元测试；
- 全部集成测试；
- Chromium 浏览器 E2E；
- 新模块覆盖率门槛；
- 构建产物一致性检查；
- `git diff --check`；
- 安全审查清单；
- 独立代码复审，Critical 和 Important 均已处理；
- GitHub Pages V2 URL 在线冒烟测试。

## 23. 文档与许可证

- README 同时列出 V1.7.5 和 V2.0 入口，分别描述其行为，不把 V2 保证套用到旧版。
- 中英文文档同步八类能力、PIN、概率术语、攻击模型和隐私边界。
- 明确区分普通 Passphrase 和 BIP39 Mnemonic。
- 明确测试外观 API Secret、钱包私钥和地址格式不是真实服务签发或链上有效凭据。
- `THIRD_PARTY_NOTICES.md` 包含 zxcvbn、PIN 数据、BIP39 实现和全部词表的版本、来源、许可证与构建哈希。
- 安全文案必须承认明文在显示时进入 DOM、生成时存在于 JavaScript 运行时、显式复制后进入系统剪贴板。

## 24. 完成定义

V2.0 只有在以下条件全部成立时才算完成：

1. 九类生成器均可独立使用，并携带真实生成模型元数据。
2. Password 和 PIN 高级约束下的生成分布与计数模型一致。
3. 页面不再使用生成后字符串外观冒充 Generator Entropy。
4. Passphrase 生成前后熵口径一致。
5. PIN 不存在 8/12 位弱模式绕过、冷启动过滤缺口或 `-0.03 bit`。
6. Generate、Copy、History 和 DOM 行为符合本规格。
7. Google Analytics 在 sandbox iframe 中正常产生页面访问请求，且无法访问秘密页面上下文。
8. V1.7.5 保持可用，V2.0 通过独立 URL 访问。
9. 所有测试、覆盖率、构建、安全审查和独立代码复审通过。
10. 完成提交已推送到 GitHub，线上 V2 URL 冒烟验证通过。


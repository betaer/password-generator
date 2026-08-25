# Security Random Generator V2.0.1 设计规格

日期：2026-08-25  
发布入口：`v2.01.html`  
产品版本：V2.0.1

## 1. 目标与发布边界

V2.0.1 综合两轮安全审计，不覆盖 V1.7.5 的 `index.html`，也不修改已发布的 V2.0 页面 `index-2.0.html` 与 `assets/v2/`。新页面使用独立、内容哈希命名的资源，形成可回滚的不可变发布单元。

本版不再宣传“所有安全等级问题归零”“Exact Crack Time”或“Exact Effective Guess Count”。统一口径为：

> 精确计算生成空间与生成器概率指标；模式分析与攻击成本属于明确假设下的估算。

## 2. 统一概率契约，而非单一概率模型

九种生成器实现不同的专用概率模型，但都输出同一份不可变概率契约：

```js
{
  schemaVersion: '2.0.1',
  type,
  schemeId,
  configSnapshot,
  probability: {
    searchSpace: { kind: 'integer', value: BigInt } |
                 { kind: 'power-of-two', exponent: Number },
    generatorMinEntropyBits,
    generatorShannonEntropyBits,
    expectedRank: { numerator: BigInt, denominator: 2n, bits: Number },
    nominalCsprngOutputBits,
  },
  provenance,
  presentationProfile,
}
```

均匀有限空间大小为 `N` 时，期望枚举次序严格使用 `(N + 1) / 2`，不再使用 `N / 2` 近似。幂空间可保留符号表达，禁止为 1 MiB 随机字节创建并十进制格式化 `2^8,388,608` 的巨大 BigInt。

`sourceEntropyBits` 退出对外契约。字节类展示“名义 CSPRNG 输出位数”，并明确这是在浏览器 Web Crypto 未被破坏、输出可建模为均匀 CSPRNG 的假设下计算，不宣称测得信息论最小熵。

## 3. 三层安全指标

结果页严格分层：

1. **精确生成器指标**：生成空间、生成器 Min-Entropy、Shannon Entropy、精确期望枚举次序。
2. **观察模式估算**：zxcvbn 等经验分析，只说明攻击者可能优先猜测的结构；不得覆盖或冒充生成器分布。
3. **攻击场景估算**：只在适用类型中展示，并同时展示速率、锁定/KDF 等前提；不得称为精确破解时间。

zxcvbn 放入单并发 Worker，输入上限 512 字符；结果使用 generation epoch 丢弃过期回调。分析器晚于生成器就绪时，应重分析仍存活的当前结果和 History；删除结果必须同步删除分析状态。

## 4. 按生成器类型展示安全语义

| 类型 | 主指标 | 辅助提示 | 禁止展示 |
| --- | --- | --- | --- |
| Password / Passphrase | 精确生成空间、生成器熵、期望次序 | 观察模式、在线与 KDF 场景 | “精确破解时间” |
| PIN | 合法空间、期望次序、批内唯一、锁定场景 | Common-first 启发式策略 | 通用快速哈希结论 |
| Token / API Secret / Hex | 名义随机位数、编码、碰撞估算 | 固定前缀不增加随机性、用途警告 | zxcvbn 与密码等级 |
| Random Bytes | 字节数、名义位数、编码、SHA-256 | 下载/复制状态、资源预算 | 破解时间与密码等级 |
| UUID | 版本、Variant、随机位、v7 时间、碰撞估算 | “这是标识符，不是秘密” | 密码等级与破解时间 |
| BIP39 | ENT、CS、词数、语言、校验和、词表哈希 | English 兼容性与真实资产威胁边界 | 密码哈希破解场景 |

## 5. 不可变生成任务与批处理

每次生成编译为不可变任务：

```js
{
  id: ++generationEpoch,
  mode,
  config: structuredClone(config),
  quantity,
}
```

`generateOne(mode, compiledModel)` 不得读取全局可变 `state.mode`。每批只编译一次模型、创建至多一个对应 Worker，并复用模型生成全部结果。切换模式会取消或作废旧任务、清空 Current Result、保留 History；旧 Worker 回包不得写入新模式。

失败或取消时，所有未提交结果必须调用 `clearGenerationResult()`；可控临时字节缓冲区在 `finally` 中覆写。只有完整批次成功且任务仍是当前 epoch 时才能原子提交。

PIN 在批量场景默认“批内唯一”。使用均匀 rank 抽样加 exact unrank 或等价的无放回算法，不使用无界重试。数量大于 1 时显示独立有放回抽样的碰撞概率作为解释信息。

## 6. 资源与内存预算

统一预算：

```text
MAX_BATCH_RAW_BYTES       = 8 MiB
MAX_HISTORY_RAW_BYTES     = 8 MiB
MAX_CLIPBOARD_CHARACTERS  = 4 MiB
MAX_RENDER_CHARACTERS     = 4 KiB
MAX_ANALYZER_CHARACTERS   = 512
```

Random Bytes 达到 64 KiB 时 quantity 强制为 1；大结果只保留原始字节与短预览，Hex/Base64 在显式复制/下载时按需编码。大结果默认不进入 History；History 按总估算字节数与条数双重淘汰。超出剪贴板预算不复制，改为下载；接近预算的复制需要显式确认。

所有自由文本字段设置合理 `maxlength`。V2.0.1 默认 Password 自定义符号只允许可打印 ASCII，拒绝控制字符、格式字符、孤立组合符、ZWJ/ZWNJ、variation selector 与双向控制字符，避免含糊的 grapheme/code-point 模型。

## 7. 专项策略

### PIN

风险过滤命名为 `Heuristic Common-PIN Exclusion Policy v1`，展示来源、来源提交、4/6 位排名阈值、规则版本、当前配置过滤前后空间和 blocked count。明确它优化 common-first 攻击外观，不改变公开均匀生成器中单个合法 PIN 的等概率性质。

### API Secret

通用模板允许 prefix/environment/version。合成示例模板使用 `synthetic_` 或 `demo_` 前缀，隐藏并忽略不适用字段；禁止生成看似真实第三方厂商或生产环境的 `sk_live_*` 凭据。

### Passphrase 与 BIP39

Passphrase 迁出 `EmbeddedWordPacksV1`，使用 V2.0.1 独立内容哈希词包，并在模型中记录 `wordPackVersion`、`wordPackSha256`、`effectiveWordPoolSha256`。

BIP39 的十种官方词表均内置并验证 SHA-256。非 English 选择在生成按钮前显示强兼容性警告；真实资产提示优先使用硬件钱包或经验证的离线构建，并说明浏览器扩展、恶意软件、屏幕、剪贴板与静态资源替换不在页面保护边界内。

## 8. GA 隔离与隐私文案

保留 GA Measurement ID 与当前 sandbox iframe 架构：只有 `allow-scripts`，没有 `allow-same-origin`、message bridge 或 referrer。父页面不执行 Google JavaScript，也不把类型、配置、输入或结果发给 iframe。

对外名称改为“隔离页面访问统计”或“隔离的无 Cookie GA 页面访问统计”。明确拒绝 Analytics storage 时仍会发送无 Cookie page-view ping，Google 仍可能收到标准浏览器与网络层信号。

Playwright 必须拦截 `www.google-analytics.com/g/collect` 与 `region1.google-analytics.com/g/collect`，解析 URL、POST body 和 headers，验证固定 `dl`、空 `dr`、无父页面 query/hash、无 Cookie、无 sentinel 结果/配置。

## 9. DOM、剪贴板与状态 UI

> 交互更新（2026-08-26）：默认遮蔽要求已被后续批准的中文界面规格替代。当前结果默认显示明文；隐藏按钮只在原位置切换固定 24 个圆点，不重建结果卡、不改变滚动位置或键盘焦点。History 每次页面会话默认关闭且不持久化。复制 fallback 使用 CSS class、`data-v201-clipboard-fallback` 与 `aria-hidden="true"`，无论成功或抛错都清空 value 并删除节点。

顶部 Web Crypto chip 绑定真实资源状态。切换模式立即清空当前结果并取消旧任务。每个结果提供折叠的 Generation Model Details，展示实际池、范围、资产哈希、策略版本、攻击假设、UUID 时间和 schema 版本。

“恢复默认”必须删除当前 mode 的持久化配置并立即写回 localStorage。

## 10. CSP 与部署边界

移除脚本生成的内联 style，主页面 CSP 删除 `style-src 'unsafe-inline'`。同时在仓库内提供 `_headers`/安全头部署样例和自动检查，但不声称 GitHub Pages 会执行这些响应头。

W3C CSP 明确规定 meta 中的 `frame-ancestors` 必须被忽略，而且 `default-src 'none'` 不会阻止页面被嵌入。因此 V2.0.1 页面会如实注明：反点击劫持响应头需要支持自定义 HTTP headers 的反向代理/托管层；本次 GitHub Pages 发布不能假装已完成这一层。

## 11. 构建、测试与发布门禁

V2.0.1 资产全部输出到版本独立目录并使用内容哈希文件名，同时生成 manifest 和 HTML/runtime 版本握手。确定性构建必须在临时目录执行并与已提交产物逐 SHA-256 比较。

GitHub Actions 发布流程必须先通过：

- V1 单元测试；
- V2.0.1 单元/集成与覆盖率门槛；
- Chromium/WebKit 移动与桌面 E2E；
- 真实 GA collect 网络负向泄露测试；
- `npm audit`；
- 临时构建产物 SHA 对比；
- `git diff --exit-code`。

验证 job 成功后才上传并部署不可变 Pages artifact。仓库设置 required status checks 与 main 分支保护；若当前机器存在可用签名身份，则创建签名发布提交/Tag，否则不得虚报“已签名”，而是把签名状态作为明确未满足项报告。

## 12. 回归验收清单

必须覆盖审计列出的全部关键测试：模式切换/取消/部分失败清理、模型单次编译、PIN 批内唯一、`N=2` 的期望次序为 1.5、Random Bytes 符号空间与预算、History 字节预算、zxcvbn late-ready/stale/sequence、API 模板、BIP39 语言竞态与词表 SHA、Reset 刷新、clipboard fallback DOM 清理、全 DOM sentinel 扫描、GA 请求 sentinel 扫描、UUID 无密码破解时间、320/360/390/430 像素响应式与真实 Web Crypto fail-closed。

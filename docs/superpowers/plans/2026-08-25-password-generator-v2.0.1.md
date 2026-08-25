# Security Random Generator V2.0.1 实施计划

> **For Codex:** 按 TDD 顺序逐项执行；每完成一组行为都先看失败测试，再实现，再跑相关测试。旧版 `index.html`、`index-2.0.html`、`assets/v2/` 是不可变发布物。

**目标：** 将两轮审计的 P1/P2/P3 项合并实现为产品 V2.0.1，并发布独立入口 `v2.01.html`。

**架构：** 保留 V2.0 产物，新版源代码以统一概率契约、不可变 Generation Job、Compiled Generator、类型化 Assessment Profile 和资源预算为核心。构建器把新版运行时、App、Workers、词包、PIN 风险数据、BIP39 词表与 GA frame 输出到 `assets/v2.01/` 的内容哈希文件，并生成 manifest；HTML 只引用 manifest 固定下来的哈希产物。

**技术栈：** Vanilla JavaScript、ES modules、esbuild、Node test、c8、Playwright、GitHub Actions/Pages。

---

## Task 1：建立 V2.0.1 契约与失败测试

**文件：**

- 新增：`src/v201/probability-contract.mjs`
- 新增：`src/v201/result-model.mjs`
- 新增：`src/v201/security-assessment.mjs`
- 新增：`tests/v201/probability-contract.test.mjs`
- 新增：`tests/v201/result-model.test.mjs`
- 新增：`tests/v201/security-assessment.test.mjs`

**步骤：**

1. 先写 `N=1/2/3/10000` 的 `(N+1)/2` 精确 rational 测试。
2. 写 integer 与 power-of-two Search Space 的格式化/entropy 测试，禁止巨大 BigInt 十进制路径。
3. 写旧字段 `sourceEntropyBits` 被拒绝、名义 CSPRNG 字段与 schema 版本被保留的测试。
4. 写六类 presentation profile 测试，保证 UUID/Bytes/BIP39 不出现密码等级或哈希破解时间。
5. 实现契约与三层 assessment；只允许 Password/Passphrase 展示 zxcvbn，PIN 使用专用尝试场景。
6. 运行：`node --test tests/v201/probability-contract.test.mjs tests/v201/result-model.test.mjs tests/v201/security-assessment.test.mjs`。

## Task 2：Compiled Generator、不可变任务与原子批处理

**文件：**

- 新增：`src/v201/generation-job.mjs`
- 新增：`src/v201/batch-generator.mjs`
- 修改/复用：`src/v2/password-model.mjs`、`passphrase-model.mjs`、`pin-model.mjs`、`byte-secret-models.mjs`、`uuid-model.mjs`、`bip39-model.mjs`
- 新增：`tests/v201/generation-job.test.mjs`
- 新增：`tests/v201/batch-generator.test.mjs`

**步骤：**

1. 写 frozen mode/config/quantity、epoch stale、cancel、partial failure clear、compile-once 测试。
2. 实现 `createGenerationJob()`、`GenerationCoordinator` 与原子提交/清理。
3. 实现 `compile(mode, config) -> { model, sampleOne, sampleBatch, dispose }`，运行期间不得读取 UI state。
4. Password Worker 改为一次接收整批 jobId/config/quantity；回包校验 jobId。
5. 切换 mode 调用 cancel，Current Result 清空，History 保留。
6. 跑 Task 2 测试并补集成覆盖。

## Task 3：PIN 无放回批量与策略披露

**文件：**

- 新增：`src/v201/pin-batch.mjs`
- 修改：`src/v2/pin-model.mjs`
- 修改：`scripts/build-v2-pin-risk.mjs`
- 新增：`tests/v201/pin-batch.test.mjs`
- 新增：`tests/v201/pin-policy.test.mjs`

**步骤：**

1. 写 rank/unrank 双向、均匀边界、100 个四位 PIN 批内唯一、数量超过空间失败测试。
2. 实现 BigInt 无放回 rank 抽样和 completion-count exact unrank；默认启用批内唯一。
3. 计算并返回有放回碰撞概率、过滤前后空间、blocked count。
4. 风险数据加入 policy 名称、来源、来源提交、阈值和规则版本；UI 使用启发式措辞。

## Task 4：Random Bytes 延迟编码与全局预算

**文件：**

- 新增：`src/v201/resource-budget.mjs`
- 新增：`src/v201/lazy-secret.mjs`
- 修改：`src/v2/byte-secret-models.mjs`
- 新增：`tests/v201/resource-budget.test.mjs`
- 新增：`tests/v201/random-bytes.test.mjs`

**步骤：**

1. 写 1 MiB 不构造巨大 BigInt/完整 Hex、64 KiB quantity=1、8 MiB batch/history、4 MiB clipboard、4 KiB render 测试。
2. 结果保存 bytes、短 preview、编码描述与 SHA-256；复制/下载时才编码。
3. History 按估算内存字节和条数双限淘汰，大结果不进入 History。
4. 超预算复制 fail-closed，并提供下载路径。

## Task 5：Passphrase/BIP39 资产完整性与 API Secret 模板

**文件：**

- 新增：`scripts/build-v201-passphrase-packs.mjs`
- 新增：`scripts/build-v201-bip39.mjs`
- 修改：`src/v2/passphrase-model.mjs`
- 修改：`src/v2/bip39-model.mjs`
- 修改：`src/v2/byte-secret-models.mjs`
- 新增：`tests/v201/passphrase-assets.test.mjs`
- 新增：`tests/v201/bip39-assets.test.mjs`
- 新增：`tests/v201/api-secret.test.mjs`

**步骤：**

1. V2.0.1 Passphrase 词包构建为单独内容哈希资产，运行时验证 SHA 并记录 pack/effective pool SHA。
2. 十种 BIP39 官方词表构建时生成 SHA manifest，注册前校验 SHA；语言请求增加 epoch 防竞态。
3. 非 English 与真实资产风险警告在配置区和结果卡均可见。
4. 移除矛盾的 `sk_live_test`/`sk_test_test`；实现 Generic 与 Synthetic Demo 两种清晰模板。

## Task 6：zxcvbn Worker 与类型化结果 UI

**文件：**

- 新增：`src/v201/zxcvbn-worker-entry.mjs`
- 新增：`assets-src/v201/app.v201.js`
- 新增：`assets-src/v201/app.v201.css`
- 新增：`tests/v201/zxcvbn-coordinator.test.mjs`
- 新增：`tests/v201/ui-contract.test.mjs`

**步骤：**

1. 先写 sequence/pattern 字段、late-ready reanalyze、stale ignored、512 字符上限、删除清理测试。
2. 单 Worker 单并发排队，分析结果按 resultId + epoch 回写；批量渲染节流。
3. 实现六种结果 profile 与三层指标区块；UUID/Bytes/BIP39 禁止通用 Crack Time。
4. 增加 Generation Model Details 折叠快照。
5. 顶部 Web Crypto 状态绑定真实状态；切换模式清空 Current Result。
6. Reset 删除持久化 mode 设置并立即保存；History 开关不持久化。

## Task 7：输入、Clipboard、DOM 与 CSP 加固

**文件：**

- 修改：`assets-src/v201/app.v201.js`
- 修改：`assets-src/v201/app.v201.css`
- 新增：`tests/v201/input-validation.test.mjs`
- 新增：`tests/v201/privacy.integration.test.mjs`

**步骤：**

1. 所有自由文本字段增加 maxlength；Password 自定义符号限定 printable ASCII。
2. clipboard fallback 使用 marker/aria-hidden/CSS class，`finally` 清空并删除。
3. 固定 24 点遮蔽、长结果不渲染、全 DOM/属性 sentinel 扫描。
4. 删除所有需要 `style-src 'unsafe-inline'` 的 inline style；V2.0.1 CSP 仅允许 self stylesheet。
5. 添加安全 headers 样例与 GitHub Pages 不支持该响应头的明确文档，不伪造 frame-ancestors 已生效。

## Task 8：内容哈希构建与 `v2.01.html`

**文件：**

- 新增：`scripts/build-v201.mjs`
- 新增：`scripts/verify-v201-build.mjs`
- 新增：`v2.01.html`
- 生成：`assets/v2.01/*.<sha256-prefix>.*`
- 生成：`assets/v2.01/manifest.json`
- 修改：`package.json`
- 新增：`tests/v201/build.integration.test.mjs`
- 新增：`tests/v201/html.integration.test.mjs`

**步骤：**

1. 写构建确定性、旧产物 SHA 不变、manifest 完整、HTML/runtime handshake 测试。
2. 构建器在临时目录生成全部产物，内容哈希命名，最后原子发布到 `assets/v2.01/`。
3. `v2.01.html` 使用 V2.0.1 文案、隔离 GA 披露、独立资源；不引用 `assets/v2/` 或 V1 运行时。
4. 确认 `index.html`、`index-2.0.html`、`assets/v2/` SHA 与任务开始时一致。

## Task 9：真实浏览器、GA 网络与移动端验收

**文件：**

- 新增：`scripts/verify-v201-browser.mjs`
- 新增：`scripts/verify-v201-ga-network.mjs`
- 新增：`tests/v201/analytics-isolation.test.mjs`

**步骤：**

1. 覆盖 9 模式、切换竞态、取消 stale worker、partial failure、Reset 刷新、late zxcvbn、BIP39 快切。
2. 使用唯一 sentinel，验证秘密默认不在整个 DOM 文本/属性；显示后只在目标容器；删除后移除。
3. 拦截 GA collect URL/body/headers；固定 dl/dr/title/path、无 Cookie、无 sentinel、无 hash/query。
4. 检查 clipboard fallback 全 DOM 无 textarea/marker 残留。
5. Chromium 与 WebKit 覆盖 320/360/390/430 和桌面，检查触控尺寸、焦点、长错误、顺序和无横向溢出。

## Task 10：CI、保护规则、发布与在线复核

**文件：**

- 新增：`.github/workflows/verify-and-deploy-v2.01.yml`
- 修改：`package.json`
- 新增：`docs/releases/v2.0.1.md`

**步骤：**

1. workflow 设置 verify -> deploy 依赖：V1/V201 tests、coverage、browser、GA network、audit、临时构建 SHA、`git diff --exit-code`。
2. Pages 切到 GitHub Actions，自 verify artifact 部署；部署环境使用 `github-pages`。
3. 本地依次执行 `npm test`、`npm run test:v201`、`npm run test:coverage:v201`、`npm run test:e2e:v201`、`npm audit --audit-level=high`、`npm run verify:build:v201`。
4. 进行安全复审与 `git diff --check`，提交并推送 main。
5. 等待 workflow success 后，验证 `https://betaer.github.io/password-generator/v2.01.html` 九模式与哈希资源。
6. 通过 GitHub API启用 main 分支 required checks；先确认不会锁死管理员维护路径。
7. 检查本机签名配置：可用则创建签名 `v2.0.1` tag；不可用则明确报告未签名，不生成伪签名。


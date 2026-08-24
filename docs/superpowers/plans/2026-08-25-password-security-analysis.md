# Password Security Analysis Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在保持纯静态 GitHub Pages、浏览器本地生成和现有三种生成模式稳定的前提下，完成 zxcvbn 模式分析、完整四位 PIN 排名、丰富六位 PIN 语料、三种攻击模型和可核验安全说明。

**Architecture:** 继续保留 `index.html` 单页应用。把小型、启动必需的攻击模型运行时从独立源文件压缩后内置进 HTML；把体积较大的 zxcvbn 分析器和 PIN 风险数据作为同源、版本化资源按需加载。同步理论空间先渲染，异步模式分析完成后只更新当前结果的安全评估，不阻塞生成，也不把生成值写入 URL、日志、统计或持久化缓存。

**Tech Stack:** 原生 ES2022、React/Ant Design 现有内联运行时、Web Crypto API、`@zxcvbn-ts/core@4.2.0`、`@zxcvbn-ts/language-common@4.1.3`、`esbuild@0.28.2`、Node.js 20 `node:test`、GitHub Pages。

---

## Task 1: 固化基线并补充安全随机回归测试

**Files:**
- Modify: `tests/html.integration.test.mjs`
- Create: `tests/randomness.test.mjs`

- [ ] **Step 1: 写出业务随机链路的失败测试**

在 `tests/randomness.test.mjs` 中提取 `secureUint32`、`secureInt`、`secureChoice`、`secureRandomIndex`、`secureShuffle`，用可控的 `crypto.getRandomValues()` 验证拒绝区间会重采样：

```js
test('secureInt 遇到拒绝区间值时重新取样', () => {
  const samples = [0xffffffff, 7];
  const crypto = {
    getRandomValues(array) {
      array[0] = samples.shift();
      return array;
    },
  };
  const secureInt = buildSecureInt(crypto);
  assert.equal(secureInt(10), 7);
  assert.equal(samples.length, 0);
});
```

- [ ] **Step 2: 增加静态扫描，禁止业务代码使用 `Math.random()`**

只扫描 `const React =` 之后的应用业务脚本，避开已打包 Ant Design/CSS-in-JS 运行时：

```js
test('业务生成逻辑不使用 Math.random', () => {
  assert.doesNotMatch(app, /Math\.random\s*\(/);
});
```

- [ ] **Step 3: 运行测试确认现有实现通过**

Run: `node --test tests/randomness.test.mjs tests/html.integration.test.mjs`

Expected: PASS；证明密码、PIN、词语、随机分隔符、洗牌和格式方案均沿用 Web Crypto + rejection sampling。

- [ ] **Step 4: 提交基线测试**

```bash
git add tests/randomness.test.mjs tests/html.integration.test.mjs
git commit -m "test: lock down unbiased random generation"
```

## Task 2: 建立独立可测试的攻击模型运行时

**Files:**
- Create: `assets/js/security-analysis.js`
- Create: `scripts/build-security-runtime.mjs`
- Modify: `index.html`
- Create: `tests/security-analysis.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: 为三种攻击模型与强度边界写失败测试**

测试固定模型、平均尝试次数、有效猜测空间、超大数格式和 L1～L8 边界：

```js
assert.deepEqual(Object.keys(runtime.ATTACK_MODELS), ['online', 'slowHash', 'fastOffline']);
assert.equal(runtime.ATTACK_MODELS.online.guessesPerSecond, 100 / 3600);
assert.equal(runtime.ATTACK_MODELS.slowHash.guessesPerSecond, 1e4);
assert.equal(runtime.ATTACK_MODELS.fastOffline.guessesPerSecond, 1e10);
assert.equal(runtime.strengthFromGuessBits(19.99).level, 'L1');
assert.equal(runtime.strengthFromGuessBits(20).level, 'L2');
assert.equal(runtime.strengthFromGuessBits(112).level, 'L8');
```

- [ ] **Step 2: 实现纯函数运行时**

`assets/js/security-analysis.js` 暴露全局 `PasswordSecurityRuntime`，不读 DOM、不发请求、不保存凭据：

```js
(function attachSecurityRuntime(global) {
  const ATTACK_MODELS = Object.freeze({
    online: Object.freeze({ id: 'online', label: '在线限速攻击', guessesPerSecond: 100 / 3600 }),
    slowHash: Object.freeze({ id: 'slowHash', label: '慢速密码哈希', guessesPerSecond: 1e4 }),
    fastOffline: Object.freeze({ id: 'fastOffline', label: '快速离线哈希', guessesPerSecond: 1e10 }),
  });

  function createAssessment({ theoreticalBits, patternGuesses = null }) {
    const theoreticalAverageGuesses = 2 ** Math.max(0, theoreticalBits - 1);
    const effectiveGuesses = Number.isFinite(patternGuesses)
      ? Math.min(theoreticalAverageGuesses, Math.max(1, patternGuesses))
      : theoreticalAverageGuesses;
    const effectiveGuessBits = Math.log2(effectiveGuesses);
    return {
      theoreticalBits,
      theoreticalAverageGuesses,
      patternGuesses,
      effectiveGuesses,
      effectiveGuessBits,
      attackTimes: estimateAttackTimes(effectiveGuesses),
      strength: strengthFromGuessBits(effectiveGuessBits),
    };
  }

  global.PasswordSecurityRuntime = Object.freeze({
    ATTACK_MODELS,
    createAssessment,
    estimateAttackTimes,
    formatAttackTime,
    formatGuessCount,
    strengthFromGuessBits,
  });
})(globalThis);
```

对 `2 ** bits` 溢出的情况保存 `log2`/`log10` 表示，格式化函数不得返回 `Infinity` 或 `NaN`。

- [ ] **Step 3: 增加压缩内联构建脚本**

`scripts/build-security-runtime.mjs` 使用 esbuild 压缩源文件，并替换：

```html
<script data-startup-runtime="security-analysis">
/* minified runtime */
</script>
```

在 `package.json` 增加：

```json
{
  "scripts": {
    "build:security-runtime": "node scripts/build-security-runtime.mjs"
  },
  "devDependencies": {
    "esbuild": "0.28.2"
  }
}
```

- [ ] **Step 4: 生成内联运行时并运行测试**

Run: `npm install`

Run: `npm run build:security-runtime`

Run: `node --test tests/security-analysis.test.mjs tests/html.integration.test.mjs`

Expected: PASS；`index.html` 冷启动无需额外请求即可使用三种攻击模型。

- [ ] **Step 5: 提交攻击模型运行时**

```bash
git add package.json package-lock.json assets/js/security-analysis.js scripts/build-security-runtime.mjs index.html tests/security-analysis.test.mjs tests/html.integration.test.mjs
git commit -m "feat: add multi-model security runtime"
```

## Task 3: 本地构建并异步加载 zxcvbn 模式分析器

**Files:**
- Create: `src/zxcvbn-analyzer.entry.mjs`
- Create: `scripts/build-zxcvbn.mjs`
- Create: `assets/vendor/zxcvbn-analyzer.v1.min.js`
- Create: `assets/vendor/zxcvbn-LICENSE.txt`
- Create: `tests/zxcvbn-analyzer.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: 写出模式识别失败测试**

测试常见密码、l33t、键盘路径、日期、重复值明显弱于等长随机字符串：

```js
const weak = ['password123', 'p@ssw0rd', 'qwertyuiop', '20260825', 'abcabcabc'];
const random = analyzer.analyzePassword('vQ7!mZ2@xR9#');
for (const value of weak) {
  assert.ok(analyzer.analyzePassword(value).guesses < random.guesses, value);
}
```

- [ ] **Step 2: 实现最小本地分析入口**

`src/zxcvbn-analyzer.entry.mjs` 只返回 UI 需要的字段，不包含输入值：

```js
import { zxcvbn, zxcvbnOptions } from '@zxcvbn-ts/core';
import { adjacencyGraphs, dictionary } from '@zxcvbn-ts/language-common';

zxcvbnOptions.setOptions({ dictionary, graphs: adjacencyGraphs });

export function analyzePassword(value) {
  const result = zxcvbn(String(value || ''));
  return Object.freeze({
    guesses: Math.max(1, Number(result.guesses) || 1),
    score: result.score,
    sequence: result.sequence.map(({ pattern, token }) => ({ pattern, length: token.length })),
  });
}
```

禁止返回 `password`、`token` 明文或把生成值拼入异常信息。

- [ ] **Step 3: 固定依赖并生成同源 ESM 包**

在 `package.json` 固定：

```json
{
  "scripts": {
    "build:zxcvbn": "node scripts/build-zxcvbn.mjs"
  },
  "devDependencies": {
    "@zxcvbn-ts/core": "4.2.0",
    "@zxcvbn-ts/language-common": "4.1.3"
  }
}
```

`scripts/build-zxcvbn.mjs` 使用 esbuild 的 `bundle: true`、`format: 'esm'`、`minify: true`、`target: ['es2020']`，输出 `assets/vendor/zxcvbn-analyzer.v1.min.js`。

- [ ] **Step 4: 生成并验证分析器**

Run: `npm install`

Run: `npm run build:zxcvbn`

Run: `node --test tests/zxcvbn-analyzer.test.mjs`

Expected: PASS；生成器值不出现在分析结果对象、模块 URL 或测试输出中。

- [ ] **Step 5: 提交 zxcvbn 本地资源**

```bash
git add package.json package-lock.json src/zxcvbn-analyzer.entry.mjs scripts/build-zxcvbn.mjs assets/vendor/zxcvbn-analyzer.v1.min.js assets/vendor/zxcvbn-LICENSE.txt tests/zxcvbn-analyzer.test.mjs
git commit -m "feat: add local zxcvbn pattern analyzer"
```

## Task 4: 构建完整四位 PIN 排名与丰富六位 PIN 语料

**Files:**
- Create: `scripts/build-pin-risk-data.mjs`
- Create: `assets/data/pin-risk.v1.json`
- Create: `assets/data/pin-risk-source.txt`
- Create: `assets/js/pin-risk-engine.js`
- Create: `tests/pin-risk-engine.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: 写出 PIN 数据完整性失败测试**

测试解码后四位排名恰好覆盖 10,000 个唯一组合，六位语料为 68,202 个唯一纯数字值，并核对头部顺序：

```js
assert.equal(database.fourDigitCount, 10000);
assert.equal(database.sixDigitCount, 68202);
assert.deepEqual(['1234', '1111', '0000', '1212'].map(pin => database.rank(pin)), [1, 2, 3, 4]);
assert.ok(database.rank('123456') >= 1);
```

- [ ] **Step 2: 实现固定上游与哈希校验的构建脚本**

固定 SecLists 提交 `0e0329aa77f0f3d2ff5035e989ad320a2ac4a35d`，下载并验证：

```js
const SOURCES = Object.freeze({
  fourDigit: {
    path: 'Passwords/Common-Credentials/four-digit-pin-codes-sorted-by-frequency-withcount.csv',
    sha256: '18e0ebf05f5a9ab24dfd1d59cff979e931bc0dee8d0663008d6bd3e4b0fc320b',
  },
  sixDigit: {
    path: 'Passwords/Common-Credentials/xato-net-10-million-passwords-1000000.txt',
    sha256: '424a3e03a17df0a2bc2b3ca749d81b04e79d59cb7aeec8876a5a3f308d0caf51',
  },
});
```

四位数据编码为按 PIN 数值索引的 `Uint16Array` 排名；六位数据按频率顺序编码为 `Uint32Array` Base64，运行时只在 PIN 模式初始化排名 `Map`。构建脚本拒绝重复值、错误长度、错误哈希和错误数量。

- [ ] **Step 3: 实现 PIN 风险引擎**

`assets/js/pin-risk-engine.js` 提供：

```js
export async function loadPinRiskDatabase(url = './assets/data/pin-risk.v1.json') {}
export function inspectPin(pin, database) {
  return {
    rank: database?.rank(pin) ?? null,
    corpus: pin.length === 4 ? 'four-digit-complete' : pin.length === 6 ? 'six-digit-common' : null,
    ruleMatches: detectPinPatterns(pin),
    patternGuesses: derivePinPatternGuesses(pin, database),
    blocked: shouldBlockWeakPin(pin, database),
  };
}
```

过滤阈值：四位前 500、六位前 1,000；四位 501～2,000 仍降级并显示排名。重复、循环、日期、键盘路径、三位以上升降序列继续独立生效。

- [ ] **Step 4: 生成数据并运行离线测试**

Run: `npm run build:pin-risk`

Run: `node --test tests/pin-risk-engine.test.mjs`

Expected: PASS；常规测试读取已提交 JSON，不访问网络。

- [ ] **Step 5: 提交 PIN 风险资源**

```bash
git add package.json scripts/build-pin-risk-data.mjs assets/data/pin-risk.v1.json assets/data/pin-risk-source.txt assets/js/pin-risk-engine.js tests/pin-risk-engine.test.mjs
git commit -m "feat: add ranked common PIN analysis"
```

## Task 5: 在应用中接入异步模式分析与可靠回退

**Files:**
- Modify: `index.html`
- Modify: `tests/html.integration.test.mjs`

- [ ] **Step 1: 写出异步分析状态与回退失败测试**

覆盖 `idle / loading / ready / fallback`、旧结果不会覆盖新结果、记忆短语不被 zxcvbn 覆盖、模块加载失败时仍显示理论评估。

- [ ] **Step 2: 增加单例资源加载器**

在应用脚本中实现：

```js
let zxcvbnAnalyzerPromise;
function loadZxcvbnAnalyzer() {
  zxcvbnAnalyzerPromise ||= import('./assets/vendor/zxcvbn-analyzer.v1.min.js');
  return zxcvbnAnalyzerPromise;
}

let pinRiskEnginePromise;
function loadPinRiskEngine() {
  pinRiskEnginePromise ||= import('./assets/js/pin-risk-engine.js')
    .then(async module => ({ module, database: await module.loadPinRiskDatabase() }));
  return pinRiskEnginePromise;
}
```

随机密码在首屏空闲时 `requestIdleCallback` 预热 zxcvbn；进入 PIN Tab 时加载 PIN 模块与数据库。不支持空闲回调时使用短延迟 `setTimeout`。

- [ ] **Step 3: 把同步估算改成分层 assessment**

保留 `estimateGeneratedResult()` 作为理论/回退估算，新增：

```js
function createSynchronousAssessment(result) {}
async function enrichAssessment(result, baseAssessment) {}
function shouldApplyAssessment(resultId, activeResultId) {
  return resultId === activeResultId;
}
```

规则：

- 随机密码和格式字符串：`patternGuesses = zxcvbn.guesses`。
- 四/六位 PIN：优先 PIN 排名与规则猜测，再与 zxcvbn 取更小值。
- 其他 PIN：zxcvbn + 规则估算。
- 记忆短语：保留实际词包空间；只有整词重复时补充风险提示，不让普通字典评分覆盖。
- `effectiveGuesses = min(theoreticalAverageGuesses, patternGuesses)`。

- [ ] **Step 4: 接入 React 状态并处理竞态**

将 `StrengthMeter({ entropy, stats })` 改为 `StrengthMeter({ assessment, stats })`。结果改变时立即显示同步 assessment，异步完成后仅当 `result.id` 仍是当前首条结果时更新。模块失败设置 `fallback`，不弹“无法生成”。

- [ ] **Step 5: 让弱 PIN 过滤使用完整数据库**

PIN 数据未就绪时仍用现有规则过滤；数据就绪后 `generatePin()` 同时拒绝数据库高风险值。为避免异步生成函数侵入所有调用，PIN Tab 加载完成前继续显示加载状态并禁用“排除明显弱 PIN”开启状态下的生成按钮；加载失败则明确回退到规则过滤。

- [ ] **Step 6: 运行集成测试**

Run: `node --test tests/html.integration.test.mjs tests/security-analysis.test.mjs tests/zxcvbn-analyzer.test.mjs tests/pin-risk-engine.test.mjs`

Expected: PASS；加载失败不影响随机密码、PIN 或记忆短语生成。

- [ ] **Step 7: 提交应用分析逻辑**

```bash
git add index.html tests/html.integration.test.mjs
git commit -m "feat: combine theoretical and pattern analysis"
```

## Task 6: 重做强度分析 UI 与三模型气泡

**Files:**
- Modify: `index.html`
- Modify: `tests/html.integration.test.mjs`

- [ ] **Step 1: 写出强度面板文案和结构失败测试**

断言主面板包含“理论熵”“有效猜测次数”“快速离线”，气泡包含三种模型、速度、解释和免责声明；断言不再出现固定“每秒 1 万次估算”的单一结论。

- [ ] **Step 2: 将 L1～L8 改为有效猜测 bit 边界**

移除 `entropyForAverageCrackSeconds()` 和由时间反推等级的逻辑，使用：

```js
const STRENGTH_LEVELS = [
  { level: 'L1', minGuessBits: 0, label: '瞬间破解' },
  { level: 'L2', minGuessBits: 20, label: '极易破解' },
  { level: 'L3', minGuessBits: 32, label: '容易破解' },
  { level: 'L4', minGuessBits: 40, label: '有一定风险' },
  { level: 'L5', minGuessBits: 52, label: '较难破解' },
  { level: 'L6', minGuessBits: 64, label: '很难破解' },
  { level: 'L7', minGuessBits: 80, label: '极难破解' },
  { level: 'L8', minGuessBits: 112, label: '几乎无法破解' },
];
```

强度目标滑块继续按配方生成；配方校验比较理论平均猜测 bit，而不是任何攻击速度。

- [ ] **Step 3: 主面板保持紧凑**

四行指标改为：

1. 字符多样性。
2. 理论熵。
3. 有效猜测次数。
4. 预计破解时间，主值为 `快速离线：约 X`。

分析尚未完成时，第三、四行显示理论回退结果和“模式分析中”轻量状态，不产生布局跳动。

- [ ] **Step 4: 实现加宽三模型气泡**

增加 `AttackModelTooltip({ assessment })`，每个模型一段：加粗标题、实时估算时间、速度、通俗解释。结尾固定显示：

> 这些结果是攻击模型估算，不是安全保证。实际结果还受登录限速、哈希算法、工作因子、硬件规模、密码泄露、钓鱼和重复使用影响。

沿用现有桌面 hover、移动单击保持、点击外部关闭行为。

- [ ] **Step 5: 显示 PIN 排名与模式命中**

四位/六位命中时在黄色建议条追加：

```text
常见四位 PIN 排名：第 23 位。攻击者通常会优先尝试该组合。
```

未加载或无排名时不显示排名。建议条明确当前主时间属于“快速离线模型”。

- [ ] **Step 6: 运行 UI 集成测试**

Run: `node --test tests/html.integration.test.mjs`

Expected: PASS；旧的单模型文案全部移除。

- [ ] **Step 7: 提交强度 UI**

```bash
git add index.html tests/html.integration.test.mjs
git commit -m "feat: explain strength with three attack models"
```

## Task 7: 增加“安全说明”与用户可验证入口

**Files:**
- Modify: `index.html`
- Modify: `tests/html.integration.test.mjs`

- [ ] **Step 1: 写出安全说明失败测试**

断言“本地生成，不上传”变成可访问按钮并打开 Modal；内容必须包含 CSPRNG、Unbiased Selection、Mode-aware Analysis、Local Secret Data Plane、sessionStorage、静态资源请求、匿名统计面和 DevTools 验证步骤。

- [ ] **Step 2: 实现安全说明 Modal**

点击顶部隐私入口打开 `Modal`，显示四步链路：

```text
Browser CSPRNG
→ Unbiased Selection
→ Mode-aware Analysis
→ Local Secret Data Plane
```

明确分层：

- 凭据数据面：生成值只在当前页面内存、剪贴板和可清空的会话历史中流转。
- 静态资源面：词包、zxcvbn、PIN 数据从本站同源加载。
- 匿名统计面：Google Analytics 只接收页面/功能事件，任何事件对象禁止包含生成值或输入内容。

- [ ] **Step 3: 增加 DevTools 可验证步骤**

展示三步说明：打开开发者工具 → Network、清空列表、生成密码并检查请求 URL/参数/载荷。不得宣称 Zero Network Requests 或 No Storage。

- [ ] **Step 4: 审计统计调用**

静态扫描所有 `gtag()` 调用，只允许固定事件名和枚举值；禁止 `value`、`password`、`pin`、`words`、`clipboard`、`story` 字段进入参数。

- [ ] **Step 5: 运行测试并提交**

Run: `node --test tests/html.integration.test.mjs tests/seo.test.mjs`

```bash
git add index.html tests/html.integration.test.mjs
git commit -m "feat: add verifiable security explanation"
```

## Task 8: 文档、许可证与来源说明

**Files:**
- Modify: `README.md`
- Modify: `docs/readme-en.md`
- Create: `THIRD_PARTY_NOTICES.md`
- Modify: `llms.txt`
- Create: `tests/security-docs.test.mjs`

- [ ] **Step 1: 写出文档一致性失败测试**

测试中英文 README 均包含 Web Crypto、rejection sampling、zxcvbn、三攻击模型、PIN 数据来源、模型免责声明和 DevTools 验证；许可证文件包含 zxcvbn-ts 与 SecLists MIT 来源。

- [ ] **Step 2: 更新中英文安全架构说明**

README 明确：

- zxcvbn 识别实际结果模式，但不替代理论生成熵。
- 记忆短语按词包实际规模计算：1,024 / 1,296 / 7,776 的每词与整条理论熵。
- 主题词包默认至少 6 词，安全性低于标准 7,776 词包。
- 三种攻击模型使用同一有效猜测次数，只是换算速度不同。
- 当前会话历史使用 `sessionStorage`，不是“No password storage”。

- [ ] **Step 3: 增加第三方来源与许可证**

`THIRD_PARTY_NOTICES.md` 写明准确包版本、许可证链接、SecLists 固定提交、两个源文件路径、SHA-256 和数据转换方式。

- [ ] **Step 4: 更新 `llms.txt` 的可检索描述**

用简洁中英文说明“理论搜索空间 + 模式猜测 + 三攻击模型”，避免“绝对无法破解”“零网络请求”等过度承诺。

- [ ] **Step 5: 运行并提交文档测试**

Run: `node --test tests/security-docs.test.mjs tests/seo.test.mjs`

```bash
git add README.md docs/readme-en.md THIRD_PARTY_NOTICES.md llms.txt tests/security-docs.test.mjs
git commit -m "docs: document security models and data sources"
```

## Task 9: 全量验证、浏览器回归与发布

**Files:**
- Modify only if verification finds a defect.

- [ ] **Step 1: 重建所有派生安全资源**

Run: `npm ci`

Run: `npm run build:security-runtime`

Run: `npm run build:zxcvbn`

Run: `npm run build:pin-risk`

Expected: 工作树中的已提交派生文件没有非预期变化。

- [ ] **Step 2: 运行全量测试**

Run: `npm test`

Expected: 全部测试 PASS，0 fail。

- [ ] **Step 3: 启动本地服务器做浏览器回归**

Run: `npm run serve`

检查：

1. `#password` 冷启动可生成并复制，zxcvbn 从“分析中”无跳动更新。
2. `#pin` 首次加载排名数据；`1234` 显示排名并被弱 PIN 规则拒绝。
3. `#words` 的 1,024 / 1,296 / 7,776 词包熵保持准确，不受 zxcvbn 覆盖。
4. 桌面 hover 气泡和手机点击气泡行为正常。
5. 断开网络并重新加载已缓存页面时，生成与理论回退分析仍可用。
6. DevTools Network 中无生成值、PIN、记忆短语或输入内容。

- [ ] **Step 4: 检查派生资源体积与页面启动**

Run: `wc -c index.html assets/vendor/zxcvbn-analyzer.v1.min.js assets/data/pin-risk.v1.json`

记录体积；确认 zxcvbn 和 PIN 数据未被内联进 `index.html`。

- [ ] **Step 5: 最终工作树与提交检查**

Run: `git status --short`

Run: `git log --oneline -10`

Expected: 工作树干净；实现提交完整且顺序清晰。

- [ ] **Step 6: 推送 GitHub**

Run: `git push origin main`

Expected: `main` 推送成功；GitHub Pages 构建完成后在线复测三种模式和首次移动端加载。

## Plan self-review

- 已覆盖设计规格的随机安全、zxcvbn、PIN 数据、三层分析、三攻击模型、UI、触摸气泡、安全说明、文档、许可证和发布。
- 所有运行时依赖均为同源静态资源；生成失败与分析资源失败相互隔离。
- 所有版本、SecLists 提交、源路径、SHA-256、阈值、模型速度和测试期望均已明确，实施时无需补充未决参数。
- 所有关键函数的输入输出在计划中一致：`theoreticalBits` → `createAssessment()` → `effectiveGuesses/effectiveGuessBits/attackTimes/strength` → `StrengthMeter({ assessment, stats })`。
- 记忆短语保持词包理论模型；PIN 与随机字符串才使用模式分析器，避免混淆理论熵和实际猜测复杂度。

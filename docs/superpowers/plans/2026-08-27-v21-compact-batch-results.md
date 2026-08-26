# V2.1 Compact Batch Results Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 V2.1 每条结果重复的完整安全卡改为紧凑结果列表，并在底部只渲染一次批次公共安全说明，同时增加安全的单条重新生成。

**Architecture:** 新增一个无 DOM 的 `result-batch.mjs`，负责冻结批次请求、原子替换、唯一性判断和模式状态聚合；`app.v21.js` 保留 DOM 与生成协调职责。每行只渲染值、类型摘要、模式提示和操作；批次安全说明使用第一条结果的公共概率模型，并验证其余结果具有相同公共指标。

**Tech Stack:** 原生 JavaScript、ES modules + esbuild IIFE、Web Crypto、现有 V2.0.1 CompiledGenerator/GenerationCoordinator、Node test、Playwright、CSS container/media queries。

---

## 文件结构

- Create: `src/v21/result-batch.mjs` — 纯函数：批次请求快照、替换、重复检测、模式聚合。
- Create: `tests/v21/result-batch.test.mjs` — 上述纯函数的单元与边界测试。
- Modify: `src/v21/web/app.v21.js` — 紧凑列表、共享安全说明、行内气泡、单条重新生成。
- Modify: `src/v21/web/app.v21.css` — 紧凑行、图标按钮、批次说明、响应式布局。
- Modify: `src/v21/web/page.v21.html` — 批量工具栏增加“重新生成全部”并调整中文文案。
- Modify: `tests/v21/web-contract.test.mjs` — 静态契约，禁止每条重复安全卡。
- Modify: `scripts/verify-v21-browser.mjs` — 真实批量、重生成、模式、九类型与响应式验收。
- Regenerate: `index-2.1.html`, `assets/v2.1/*` — 内容哈希发布制品。
- Replace: `design-qa.md` and create `docs/qa/v21-compact-results/*` — 来源/实现/并排验收证据。

### Task 1: 批次纯函数与单元测试

**Files:**
- Create: `tests/v21/result-batch.test.mjs`
- Create: `src/v21/result-batch.mjs`

- [ ] **Step 1: 写失败测试**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregatePatternStates, createBatchRequestSnapshot,
  hasDuplicateResultValue, replaceResultById,
} from '../../src/v21/result-batch.mjs';

test('批次请求深拷贝并冻结非秘密配置', () => {
  const config = { length: 20, ratio: [10, 20] };
  const snapshot = createBatchRequestSnapshot('password', config);
  config.ratio[0] = 99;
  assert.deepEqual(snapshot, { mode: 'password', config: { length: 20, ratio: [10, 20] } });
  assert.equal(Object.isFrozen(snapshot.config.ratio), true);
});

test('单条替换保持顺序且找不到 id 时拒绝', () => {
  const first = { id: 'a', value: 'one' };
  const second = { id: 'b', value: 'two' };
  const replacement = { id: 'c', value: 'three' };
  assert.deepEqual(replaceResultById([first, second], 'b', replacement), [first, replacement]);
  assert.throws(() => replaceResultById([first], 'missing', replacement), /不存在/u);
});

test('唯一结果检测排除被替换行', () => {
  const results = [{ id: 'a', value: '1234' }, { id: 'b', value: '5678' }];
  assert.equal(hasDuplicateResultValue(results, 'a', { value: '5678' }), true);
  assert.equal(hasDuplicateResultValue(results, 'a', { value: '1234' }), false);
});

test('模式聚合区分分析中、已完成和风险行', () => {
  const results = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const patterns = new Map([
    ['a', { status: 'ready', sequences: [] }],
    ['b', { status: 'ready', sequences: ['dictionary'] }],
    ['c', { status: 'loading', sequences: [] }],
  ]);
  assert.deepEqual(aggregatePatternStates(results, patterns), { total: 3, completed: 2, risky: 1, loading: 1, failed: 0 });
});
```

- [ ] **Step 2: 运行并确认失败**

Run: `node --test tests/v21/result-batch.test.mjs`

Expected: FAIL，提示 `src/v21/result-batch.mjs` 不存在。

- [ ] **Step 3: 实现纯函数**

```js
function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const item of Object.values(value)) deepFreeze(item, seen);
  return Object.freeze(value);
}

export function createBatchRequestSnapshot(mode, config) {
  if (typeof mode !== 'string' || !mode || !config || Object.getPrototypeOf(config) !== Object.prototype) {
    throw new TypeError('批次请求必须包含 mode 与 plain config');
  }
  return deepFreeze({ mode, config: structuredClone(config) });
}

export function replaceResultById(results, id, replacement) {
  const index = results.findIndex((result) => result.id === id);
  if (index < 0) throw new RangeError('待替换结果不存在');
  const next = [...results]; next[index] = replacement; return next;
}

export function hasDuplicateResultValue(results, excludedId, replacement) {
  return results.some((result) => result.id !== excludedId && result.value === replacement.value);
}

export function aggregatePatternStates(results, patterns) {
  const summary = { total: results.length, completed: 0, risky: 0, loading: 0, failed: 0 };
  for (const result of results) {
    const pattern = patterns.get(result.id);
    if (pattern?.status === 'ready') { summary.completed += 1; if (pattern.sequences?.length) summary.risky += 1; }
    else if (pattern?.status === 'loading' || pattern?.status === 'idle') summary.loading += 1;
    else summary.failed += 1;
  }
  return Object.freeze(summary);
}
```

- [ ] **Step 4: 运行单元测试和覆盖率**

Run: `node --test tests/v21/result-batch.test.mjs && npm run test:coverage:v21`

Expected: PASS；V2.1 statements/branches/functions/lines 全部不低于 80%。

- [ ] **Step 5: 提交**

```bash
git add src/v21/result-batch.mjs tests/v21/result-batch.test.mjs
git commit -m "test(v2.1): define compact batch result invariants"
```

### Task 2: 写结果区失败契约与浏览器旅程

**Files:**
- Modify: `tests/v21/web-contract.test.mjs`
- Modify: `scripts/verify-v21-browser.mjs`

- [ ] **Step 1: 增加静态契约**

```js
test('批量结果只渲染一份公共安全说明并提供单条重生成', async () => {
  const [app, css, page] = await Promise.all([
    read('src/v21/web/app.v21.js'), read('src/v21/web/app.v21.css'), read('src/v21/web/page.v21.html'),
  ]);
  assert.match(app, /buildCompactResultRow/u);
  assert.match(app, /buildBatchAssessment/u);
  assert.match(app, /regenerateResult/u);
  assert.doesNotMatch(app, /buildResultCard/u);
  assert.match(css, /\.compact-result-list/u);
  assert.match(css, /\.batch-assessment/u);
  assert.match(page, /id="regenerate-all"/u);
});
```

- [ ] **Step 2: 增加浏览器失败断言**

在 Password 模式把 `quantity` 设置为 5 并生成，然后断言：

```js
assert.equal(await page.locator('.compact-result-row').count(), 5);
assert.equal(await page.locator('[data-batch-assessment]').count(), 1);
assert.equal(await page.getByText('精确生成器指标', { exact: true }).count(), 1);
assert.equal(await page.getByText('攻击场景估算', { exact: true }).count(), 1);
assert.ok(await page.locator('.compact-result-row').nth(2).isVisible(), '一屏至少能看到三条常规密码');
```

记录 Clipboard 长度，点击第二行 `[data-regenerate-result]`，断言第二行 id/value 改变、其余四行不变、Clipboard 没增加。

- [ ] **Step 3: 运行并确认失败**

Run: `npm run test:v21 && npm run build:v21 && npm run test:e2e:v21`

Expected: contract 和 E2E 因紧凑列表尚未实现而 FAIL。

- [ ] **Step 4: 提交失败测试**

```bash
git add tests/v21/web-contract.test.mjs scripts/verify-v21-browser.mjs
git commit -m "test(v2.1): require compact shared batch assessment"
```

### Task 3: 紧凑列表与共享安全说明

**Files:**
- Modify: `src/v21/web/page.v21.html`
- Modify: `src/v21/web/app.v21.js`
- Modify: `src/v21/web/app.v21.css`

- [ ] **Step 1: 导入批次 helper 并调整工具栏**

在 `app.v21.js` 顶部加入：

```js
import {
  aggregatePatternStates, createBatchRequestSnapshot,
  hasDuplicateResultValue, replaceResultById,
} from '../result-batch.mjs';
```

在 `page.v21.html` 的结果工具栏加入：

```html
<button class="button button-small button-primary" id="regenerate-all" type="button">重新生成全部</button>
```

- [ ] **Step 2: 创建逐条摘要和模式气泡**

实现 `resultMetaText(result)`，覆盖 Password/Passphrase/PIN/Token/API Secret/Hex/Random Bytes/UUID/BIP39。实现 `buildPatternIndicator(result, index)`：只有 Password/Passphrase 创建按钮，状态通过 `aria-label` 与 tooltip 文本表达，不复制秘密值。

- [ ] **Step 3: 用紧凑行替换大卡**

`buildCompactResultRow(result, index)` 输出：

```html
<article class="compact-result-row" data-result-id="…">
  <span class="compact-result-index">1</span>
  <div class="compact-result-content">
    <button class="compact-result-value">明文结果</button>
    <span class="compact-result-meta">20 位 · 小写 5 / 大写 5 / 数字 5 / 符号 5</span>
  </div>
  <div class="compact-result-actions">模式、隐藏、复制、重新生成、删除</div>
</article>
```

值按钮点击复制，hover/focus 使用与 History 相同的受控气泡；隐藏切换只改变值层，不改变行高。

- [ ] **Step 4: 创建唯一批次说明**

`buildBatchAssessment(results)` 使用第一条 `assessmentFor` 渲染一份公共 `profileContent`，并在折叠摘要显示公共最小熵、期望猜测次数和 `aggregatePatternStates`。完整 `localizedModelDetails` 只显示一次，标题明确“同一冻结配置，适用于本批 N 条结果”。

- [ ] **Step 5: 定向更新分析状态**

`updateResultAssessment(id)` 只替换该行 `[data-result-pattern]` 和唯一 `[data-batch-assessment-content]`，不得重建所有结果行。

- [ ] **Step 6: 实现 CSS**

桌面行高目标 64～78px；值单行截断；图标按钮 34px；列表用单一外边框和虚线行分隔。`details.batch-assessment` 默认折叠，摘要高度不超过 64px。320/390px 将操作区放到内容右侧或次行，但禁止全页横向溢出和位移动画。

- [ ] **Step 7: 运行契约与 E2E**

Run: `npm run test:v21 && npm run build:v21 && npm run test:e2e:v21`

Expected: 紧凑结构断言通过；单条重新生成断言仍因功能未完成而失败。

- [ ] **Step 8: 提交**

```bash
git add src/v21/web/page.v21.html src/v21/web/app.v21.js src/v21/web/app.v21.css index-2.1.html assets/v2.1 tests/v21/web-contract.test.mjs
git commit -m "feat(v2.1): render compact batch results"
```

### Task 4: 原子单条重新生成

**Files:**
- Modify: `src/v21/web/app.v21.js`
- Modify: `scripts/verify-v21-browser.mjs`

- [ ] **Step 1: 保存并释放批次请求**

在 state 增加 `resultBatchRequest: null`。完整生成接受后设置：

```js
state.resultBatchRequest = createBatchRequestSnapshot(job.mode, job.config);
```

切换模式或当前结果清空时设回 `null`；删除部分结果时保留。

- [ ] **Step 2: 实现单次原子采样 helper**

```js
async function sampleReplacement(snapshot) {
  const job = coordinator.begin(snapshot.mode, snapshot.config, 1);
  const batch = await runtime.batch.generateAtomicBatch({
    job, compile: compileForJob, isCurrent: coordinator.isCurrent,
    clearResult: runtime.results.clearGenerationResult,
  });
  if (!coordinator.isCurrent(job) || batch.length !== 1) throw cancellationError();
  return { job, result: batch[0] };
}
```

- [ ] **Step 3: 实现 `regenerateResult(id)`**

开始时确认 id 与快照仍存在，设置 `state.busy`。最多 16 次生成 replacement；PIN `uniqueWithinBatch` 且与其余行重复时清理该 replacement 并继续。成功后用 `replaceResultById` 原子替换；旧结果按 History 引用决定是否清理；新结果加入启用的 History、创建 loading pattern、渲染并分析。任何失败都保留旧行。

- [ ] **Step 4: 绑定工具栏和行按钮**

- `#regenerate-all` 调用 `generateResults()`，不复制。
- 行刷新图标调用 `regenerateResult(result.id)`。
- `updateAvailability()` 同步禁用所有 `[data-regenerate-result]` 和 `#regenerate-all`。

- [ ] **Step 5: 完成 E2E 边界**

断言：只替换目标行；失败 mock 保留旧行；PIN 生成 100 条后重生成仍唯一；切换模式取消过期 replacement；Clipboard 不变；History 开启时新增 replacement。

- [ ] **Step 6: 运行测试**

Run: `npm run test:v21 && npm run build:v21 && npm run test:e2e:v21`

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add src/v21/web/app.v21.js scripts/verify-v21-browser.mjs index-2.1.html assets/v2.1
git commit -m "feat(v2.1): regenerate individual results atomically"
```

### Task 5: 九类语义、视觉 QA 与完整门禁

**Files:**
- Modify: `scripts/verify-v21-browser.mjs`
- Replace: `design-qa.md`
- Create: `docs/qa/v21-compact-results/source-current.png`
- Create: `docs/qa/v21-compact-results/source-v175.png`
- Create: `docs/qa/v21-compact-results/implementation-desktop.png`
- Create: `docs/qa/v21-compact-results/implementation-mobile-390.png`
- Create: `docs/qa/v21-compact-results/implementation-mobile-320.png`
- Create: `docs/qa/v21-compact-results/comparison-desktop.png`

- [ ] **Step 1: 九类浏览器验收**

遍历九种 mode，生成 quantity=3（Random Bytes 使用允许数量），断言三行、一份批次说明、类型专用 meta、复制与删除可用。额外断言 Random Bytes 下载、UUID “标识符”、BIP39 ENT/CS 与校验和、PIN 唯一策略没有丢失。

- [ ] **Step 2: 响应式密度验收**

在 320/390/430/1280px 生成 5 条 20 位 Password，断言无全页横向溢出、前三行可在结果滚动区的首屏高度内看见、图标按钮 bounding box 至少 32 × 32px、气泡位于视口内且可命中。

- [ ] **Step 3: 运行 Design QA**

打开两个用户来源截图与桌面实现并排图，检查字体、间距、颜色、图标、文案和响应式。发现 P0/P1/P2 就修复并重拍；在 `design-qa.md` 记录所有迭代，最终必须为 `final result: passed`。

- [ ] **Step 4: 全量门禁**

Run: `npm run verify:v21`

Expected: V1 73、V2 171、V2.0.1 67、V2.1 新增后测试全部通过；两套 coverage ≥80%；两套浏览器 E2E 通过；npm audit 0 high；生成制品无 diff。

- [ ] **Step 5: 提交**

```bash
git add scripts/verify-v21-browser.mjs design-qa.md docs/qa/v21-compact-results index-2.1.html assets/v2.1
git commit -m "test(v2.1): verify compact result experience"
```

### Task 6: 独立复审与发布

**Files:**
- Review: `git diff origin/main...HEAD`

- [ ] **Step 1: 请求独立代码复审**

给审查员提供 BASE/HEAD、设计规格、单条生成安全不变量、测试结果和视觉证据。Critical/Important 必须修复，Minor 逐项判断。

- [ ] **Step 2: 重跑受影响门禁并保持工作区干净**

Run: `npm run verify:v21 && git status --short`

Expected: 全部 PASS，status 无输出。

- [ ] **Step 3: 推送并创建 PR**

```bash
git push -u origin codex/v2.1-compact-results
gh pr create --base main --head codex/v2.1-compact-results --title "feat(v2.1): compact batch results" --body-file /tmp/v21-compact-results-pr.md
```

- [ ] **Step 4: 等待安全门禁、合并和 Pages 部署**

PR 门禁通过后 merge；等待 main 的 `V2.1 verified Pages deployment` 验证、打包和部署三个 job 全绿。

- [ ] **Step 5: 验证线上制品与交互**

比较本地与线上 `index-2.1.html` SHA-256；确认线上引用新的内容哈希 CSS/JS；真实浏览器生成 5 条并完成单条重新生成，页面无 console error。

## 计划自检

- Spec coverage：紧凑列表、共享数学、逐条观察模式、单条重生成、PIN 唯一、九类语义、History、安全清理、响应式与发布均有对应任务。
- Placeholder scan：无 TBD、TODO、“稍后实现”或无代码的泛化测试步骤。
- Type consistency：统一使用 `resultBatchRequest`、`createBatchRequestSnapshot`、`replaceResultById`、`hasDuplicateResultValue`、`aggregatePatternStates`、`buildCompactResultRow`、`buildBatchAssessment`、`regenerateResult`。

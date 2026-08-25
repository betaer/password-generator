# V2.0.1 中文界面与紧凑结果交互 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 V2.0.1 九类生成器改成完整中文结果体验、稳定的默认明文切换、紧凑 History 与 V1.7.5 风格快捷操作，同时保留现有安全内核和发布门禁。

**Architecture:** 底层概率模型与结果 schema 保持不变；展示层在 `app.v201.js` 中集中定义中文模式元数据与标签映射。明文切换采用原地 DOM 更新，History 使用独立紧凑行组件，快捷操作使用原生 HTML/CSS/JS；构建脚本继续生成内容哈希资产与独立 `v2.01.html`。

**Tech Stack:** 原生 HTML/CSS/JavaScript、Node.js test runner、Playwright、现有 V2.0.1 构建器与 GitHub Pages 安全门禁。

---

## 文件结构

- 修改 `src/v201/web/page.v201.html`：三步中文工作区、双语导航 DOM、History 标题、快捷操作容器。
- 修改 `src/v201/web/app.v201.css`：双语导航、无位移结果框、紧凑 History、临时气泡、浮动按钮和响应式规则。
- 修改 `src/v201/web/app.v201.js`：集中中文元数据、中文结果卡、默认明文、原地隐藏/显示、History 行、分享与回顶行为。
- 修改 `tests/v201/web-contract.test.mjs`：静态源码与构建制品契约。
- 修改 `scripts/verify-v201-browser.mjs`：九类中文化、明文、无位移、History、分享泄漏和响应式 E2E。
- 重建 `v2.01.html` 与 `assets/v2.01/*`：只由 `npm run build:v201` 生成。

### Task 1: 先锁定中文界面与交互契约

**Files:**
- Modify: `tests/v201/web-contract.test.mjs`
- Modify: `scripts/verify-v201-browser.mjs`

- [ ] **Step 1: 添加失败的静态契约测试**

在 `tests/v201/web-contract.test.mjs` 增加对三步标题、九类中文元数据、默认明文状态、原地切换函数、紧凑 History 和快捷操作的断言：

```js
test('V2.0.1 工作区、结果与快捷操作采用完整中文交互', async () => {
  const [html, source, css] = await Promise.all([
    read('src/v201/web/page.v201.html'),
    read('src/v201/web/app.v201.js'),
    read('src/v201/web/app.v201.css'),
  ]);
  assert.match(html, /1、选择生成类型/);
  assert.match(html, /2、策略配置/);
  assert.match(html, /3、生成结果/);
  assert.match(html, /生成记录 History/);
  assert.match(html, /site-floating-actions/);
  for (const label of ['密码', '口令', 'PIN', '助记词', 'Token', 'API 密钥', 'Hex', '随机字节', 'UUID']) {
    assert.match(source, new RegExp(label));
  }
  assert.match(source, /updateSecretPresentation/);
  assert.match(source, /copySharePromotion/);
  assert.match(css, /history-row/);
  assert.doesNotMatch(css, /\.result-card[^}]*animation:/s);
});
```

- [ ] **Step 2: 添加失败的浏览器验收**

把原来的“结果默认遮蔽”断言改为以下行为，并增加九类标题断言：

```js
const modeLabels = new Map([
  ['password', ['密码策略配置', '密码生成结果']],
  ['passphrase', ['口令策略配置', '口令生成结果']],
  ['pin', ['PIN 策略配置', 'PIN 生成结果']],
  ['mnemonic', ['助记词策略配置', '助记词生成结果']],
  ['token', ['Token 策略配置', 'Token 生成结果']],
  ['apiSecret', ['API 密钥策略配置', 'API 密钥生成结果']],
  ['hex', ['Hex 策略配置', 'Hex 生成结果']],
  ['randomBytes', ['随机字节策略配置', '随机字节生成结果']],
  ['uuid', ['UUID 策略配置', 'UUID 生成结果']],
]);
for (const [mode, [configTitle, resultTitle]] of modeLabels) {
  await page.locator(`.mode-link[data-mode="${mode}"]`).click();
  if (mode === 'mnemonic') await page.locator('input[name="mnemonicAck"]').check();
  await clickGenerate(page);
  assert.equal(await page.locator('#config-title').textContent(), configTitle);
  assert.equal(await page.locator('#result-title').textContent(), resultTitle);
  assert.notEqual(await page.locator('.secret-value').textContent(), '••••••••••••••••••••••••');
}
```

- [ ] **Step 3: 运行测试并确认失败**

Run: `npm run test:v201 && npm run test:e2e:v201`  
Expected: FAIL，指出三步标题、默认明文、中文结果标题或快捷操作尚未实现。

- [ ] **Step 4: 提交测试契约**

```bash
git add tests/v201/web-contract.test.mjs scripts/verify-v201-browser.mjs
git commit -m "test: define v2.0.1 Chinese UI behavior"
```

### Task 2: 重构三步工作区与双语导航

**Files:**
- Modify: `src/v201/web/page.v201.html`
- Modify: `src/v201/web/app.v201.css`
- Modify: `src/v201/web/app.v201.js`

- [ ] **Step 1: 写入三步语义 DOM**

导航按钮统一使用可独立对齐的中文与英文节点：

```html
<nav class="panel mode-panel" aria-labelledby="mode-panel-title">
  <h2 class="mode-panel-title" id="mode-panel-title"><span>1、</span>选择生成类型</h2>
  <div class="mode-group">
    <p>人类凭据</p>
    <button class="mode-link" type="button" data-mode="password">
      <span class="mode-label-zh">密码</span><span class="mode-label-en">Password</span>
    </button>
  </div>
</nav>
```

配置区和结果区使用固定步骤标签与动态标题：

```html
<span class="panel-index">2、策略配置</span>
<h2 id="config-title">密码策略配置</h2>
<span class="panel-index">3、生成结果</span>
<h2 id="result-title">密码生成结果</h2>
```

- [ ] **Step 2: 集中定义九类中文显示元数据**

将 `MODE_META` 改为对象字段，供导航、配置和结果共用：

```js
const MODE_META = Object.freeze({
  password: Object.freeze({ zh: '密码', en: 'Password', configTitle: '密码策略配置', resultTitle: '密码生成结果', description: '约束感知的精确均匀模型。', badge: '均匀约束模型' }),
  passphrase: Object.freeze({ zh: '口令', en: 'Passphrase', configTitle: '口令策略配置', resultTitle: '口令生成结果', description: '实际词池、大小写与分隔符共同计入模型。', badge: '词语概率模型' }),
  pin: Object.freeze({ zh: 'PIN', en: 'PIN', configTitle: 'PIN 策略配置', resultTitle: 'PIN 生成结果', description: '按完成数量加权的均匀约束采样。', badge: '完成数量模型' }),
  mnemonic: Object.freeze({ zh: '助记词', en: 'Mnemonic', configTitle: '助记词策略配置', resultTitle: '助记词生成结果', description: 'ENT、CS 与官方词表校验。', badge: '钱包恢复材料' }),
  token: Object.freeze({ zh: 'Token', en: 'Token', configTitle: 'Token 策略配置', resultTitle: 'Token 生成结果', description: '固定前缀不增加随机位数。', badge: '机器随机密钥' }),
  apiSecret: Object.freeze({ zh: 'API 密钥', en: 'API Secret', configTitle: 'API 密钥策略配置', resultTitle: 'API 密钥生成结果', description: '按供应商格式生成的本地演示密钥。', badge: '机器随机密钥' }),
  hex: Object.freeze({ zh: 'Hex', en: 'Hex', configTitle: 'Hex 策略配置', resultTitle: 'Hex 生成结果', description: '随机字节的十六进制编码。', badge: '十六进制编码' }),
  randomBytes: Object.freeze({ zh: '随机字节', en: 'Random Bytes', configTitle: '随机字节策略配置', resultTitle: '随机字节生成结果', description: '受资源预算约束的原始字节。', badge: '原始随机字节' }),
  uuid: Object.freeze({ zh: 'UUID', en: 'UUID', configTitle: 'UUID 策略配置', resultTitle: 'UUID 生成结果', description: '标准标识符，不作为秘密。', badge: '标准标识符' }),
});
```

- [ ] **Step 3: 实现桌面与移动端双语布局**

```css
.mode-panel-title { margin: 0; padding: 20px 22px 8px; font-size: 16px; }
.mode-link { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; }
.mode-label-zh { text-align: left; font-weight: 760; }
.mode-label-en { color: var(--muted); font: 650 10px/1.2 var(--mono); text-align: right; }
.mode-link[aria-current="page"] .mode-label-en { color: rgba(255,255,255,.7); }
```

- [ ] **Step 4: 运行静态测试并提交**

Run: `npm run test:v201`  
Expected: 三步标题、中文元数据和双语导航相关断言 PASS。

```bash
git add src/v201/web/page.v201.html src/v201/web/app.v201.css src/v201/web/app.v201.js
git commit -m "feat: localize v2.0.1 workspace navigation"
```

### Task 3: 中文化九类结果并实现稳定明文切换

**Files:**
- Modify: `src/v201/web/app.v201.js`
- Modify: `src/v201/web/app.v201.css`
- Modify: `src/v201/web/page.v201.html`

- [ ] **Step 1: 建立显示层中文标签映射**

```js
const RESULT_TYPE_LABELS = Object.freeze({
  password: '密码', passphrase: '口令', pin: 'PIN', mnemonic: '助记词', token: 'Token',
  'api-secret': 'API 密钥', hex: 'Hex', 'random-bytes': '随机字节', uuid: 'UUID',
});
const METRIC_LABELS = Object.freeze({
  minEntropy: '生成器最小熵', shannonEntropy: '生成器 Shannon 熵', searchSpace: '生成空间', expectedRank: '期望猜测次数',
});
```

将 `profileContent()` 中的标题改为“精确生成器指标”“观察模式估算”“攻击场景估算”，并将各 profile 专属字段、UUID 提示、BIP39 校验和与模型详情标题翻译成中文。

- [ ] **Step 2: 默认渲染明文并保留大结果摘要**

```js
function secretDisplayText(result, hidden) {
  if (hidden) return MASK;
  if (result.type === 'random-bytes') return result.preview;
  if (result.value.length <= runtime.budgets.MAX_RENDER_CHARACTERS) return result.value;
  return '内容超过 DOM 渲染预算；请显式复制或下载。';
}
```

新结果不加入隐藏集合，`buildResultCard()` 默认使用 `data-secret-state="revealed"` 与“隐藏内容”按钮。

- [ ] **Step 3: 原地更新明文状态**

```js
function updateSecretPresentation(id) {
  const result = state.results.find((item) => item.id === id) || historyBudget.entries.find((item) => item.id === id);
  if (!result) return;
  const hidden = state.hidden.has(id);
  document.querySelectorAll(`[data-result-id="${CSS.escape(id)}"]`).forEach((card) => {
    const value = card.querySelector('.secret-value');
    const toggle = card.querySelector('[data-secret-toggle]');
    if (value) {
      value.dataset.secretState = hidden ? 'masked' : 'revealed';
      value.textContent = secretDisplayText(result, hidden);
    }
    if (toggle) {
      toggle.textContent = hidden ? '显示内容' : '隐藏内容';
      toggle.setAttribute('aria-pressed', String(!hidden));
    }
  });
}
function toggleReveal(id) {
  if (state.hidden.has(id)) state.hidden.delete(id); else state.hidden.add(id);
  updateSecretPresentation(id);
}
```

- [ ] **Step 4: 移除结果入场与切换位移动效**

```css
.result-card { border: 1px solid var(--line); border-radius: 14px; overflow: hidden; background: #fff; }
.secret-box { min-height: 92px; contain: layout paint; }
.secret-toggle { transform: none !important; transition: color .12s ease, background .12s ease, border-color .12s ease; }
.secret-toggle:hover { transform: none !important; }
```

- [ ] **Step 5: 运行测试并提交**

Run: `npm run test:v201 && npm run build:v201 && npm run test:e2e:v201`  
Expected: 九类中文结果、默认明文和无位移切换断言 PASS。

```bash
git add src/v201/web/app.v201.js src/v201/web/app.v201.css src/v201/web/page.v201.html v2.01.html assets/v2.01
git commit -m "feat: localize v2.0.1 results and stabilize reveal"
```

### Task 4: 紧凑生成记录与临时完整内容气泡

**Files:**
- Modify: `src/v201/web/page.v201.html`
- Modify: `src/v201/web/app.v201.css`
- Modify: `src/v201/web/app.v201.js`
- Modify: `scripts/verify-v201-browser.mjs`

- [ ] **Step 1: 将 History 标题和说明改成生成记录**

```html
<h2 id="history-title">生成记录 History</h2>
<p>每次会话默认关闭；不持久化开关或秘密。最多保留 100 条，并受 8 MiB 总预算限制。</p>
```

- [ ] **Step 2: 实现紧凑记录行**

```js
function buildHistoryRow(result, index) {
  const row = document.createElement('div');
  row.className = 'history-row';
  row.dataset.historyId = result.id;
  const type = document.createElement('span'); type.className = 'history-type'; type.textContent = RESULT_TYPE_LABELS[result.type] || result.type;
  const preview = actionButton(result.type === 'random-bytes' ? result.preview : result.value, () => copyResults([result]));
  preview.classList.add('history-preview');
  preview.setAttribute('aria-label', `复制第 ${index + 1} 条${type.textContent}生成记录`);
  const copy = actionButton('复制', () => copyResults([result]));
  const remove = actionButton('删除', () => deleteResult(result.id), 'button-danger');
  row.append(type, preview, copy, remove);
  installHistoryTooltip(row, preview, result);
  return row;
}
```

- [ ] **Step 3: 气泡只在 hover/focus 生命周期存在**

```js
function installHistoryTooltip(row, trigger, result) {
  const show = () => {
    if (row.querySelector('.history-tooltip')) return;
    const tip = document.createElement('div');
    tip.className = 'history-tooltip';
    tip.setAttribute('role', 'tooltip');
    tip.textContent = result.type === 'random-bytes' ? result.preview : result.value;
    row.append(tip);
  };
  const hide = () => row.querySelector('.history-tooltip')?.remove();
  trigger.addEventListener('mouseenter', show);
  trigger.addEventListener('mouseleave', hide);
  trigger.addEventListener('focus', show);
  trigger.addEventListener('blur', hide);
}
```

- [ ] **Step 4: 实现单行省略与受限气泡**

```css
.history-row { position: relative; display: grid; grid-template-columns: auto minmax(0,1fr) auto auto; gap: 8px; align-items: center; }
.history-preview { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; justify-content: flex-start; }
.history-tooltip { position: absolute; z-index: 20; right: 0; bottom: calc(100% + 8px); max-width: min(560px, calc(100vw - 32px)); max-height: 220px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; }
```

- [ ] **Step 5: 运行 E2E 并提交**

Run: `npm run build:v201 && npm run test:e2e:v201`  
Expected: History 默认关闭、单行省略、点击复制、删除以及 hover/focus 气泡 PASS。

```bash
git add src/v201/web/page.v201.html src/v201/web/app.v201.css src/v201/web/app.v201.js scripts/verify-v201-browser.mjs v2.01.html assets/v2.01
git commit -m "feat: add compact in-memory generation history"
```

### Task 5: 恢复 V1.7.5 风格右下角快捷操作

**Files:**
- Modify: `src/v201/web/page.v201.html`
- Modify: `src/v201/web/app.v201.css`
- Modify: `src/v201/web/app.v201.js`
- Modify: `scripts/verify-v201-browser.mjs`

- [ ] **Step 1: 添加原生快捷操作 DOM**

```html
<div class="site-floating-actions" role="group" aria-label="网站快捷操作">
  <button class="site-floating-button site-floating-backtop" id="back-to-top" type="button" hidden aria-label="回到顶部"><span aria-hidden="true">↑</span><span class="site-floating-button-label">回到顶部</span></button>
  <a class="site-floating-button site-floating-github" href="https://github.com/betaer/password-generator" target="_blank" rel="noopener noreferrer" aria-label="在 GitHub 查看源代码，999+ Stars"><span aria-hidden="true">⌘</span><span class="site-floating-button-label">GitHub</span><span class="site-floating-star-badge" aria-hidden="true">999+</span></a>
  <button class="site-floating-button site-floating-copy" id="copy-share" type="button" aria-label="复制网站分享文案"><span aria-hidden="true">⧉</span><span class="site-floating-button-label">复制分享</span></button>
</div>
```

- [ ] **Step 2: 分享固定公开文案**

```js
const SHARE_PROMOTION_TEXT = `分享一个专业、安全、完全在浏览器本地运行的随机数据生成器 🔐
支持密码、口令、PIN、Token、API 密钥、UUID、Hex、随机字节与 BIP39 助记词。
V2.0.1：精确生成空间、独立模式分析与明确攻击假设。
立即体验：https://betaer.github.io/password-generator/v2.01.html`;
async function copySharePromotion() {
  if (!await copyText(SHARE_PROMOTION_TEXT)) throw new Error('浏览器拒绝复制网站分享文案。');
  showToast('已复制网站分享文案。');
}
```

- [ ] **Step 3: 回顶即时执行并按滚动状态显示**

```js
function updateBackToTop() {
  const button = document.getElementById('back-to-top');
  button.hidden = !(document.documentElement.scrollHeight > innerHeight + 1 && scrollY > 80);
}
document.getElementById('back-to-top').addEventListener('click', () => scrollTo({ top: 0, left: 0, behavior: 'auto' }));
document.getElementById('copy-share').addEventListener('click', () => copySharePromotion().catch((error) => showToast(error.message, 'error')));
addEventListener('scroll', updateBackToTop, { passive: true });
```

- [ ] **Step 4: 复刻桌面胶囊与移动端圆形视觉**

```css
.site-floating-actions { position: fixed; right: max(18px, env(safe-area-inset-right)); bottom: max(18px, env(safe-area-inset-bottom)); z-index: 40; display: flex; flex-direction: column; align-items: flex-end; gap: 10px; }
.site-floating-button { position: relative; width: 124px; min-height: 42px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; border: 1px solid rgba(23,48,39,.2); border-radius: 999px; background: rgba(255,255,255,.95); box-shadow: 0 8px 24px rgba(15,23,42,.13); }
.site-floating-star-badge { position: absolute; top: -10px; right: -11px; min-width: 36px; height: 22px; display: grid; place-items: center; border: 2px solid #fff; border-radius: 999px; color: #fff; background: var(--ink); }
@media (max-width: 640px) { .site-floating-button { width: 44px; min-width: 44px; height: 44px; } .site-floating-button-label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); } }
```

- [ ] **Step 5: 测试分享不泄露 sentinel 并提交**

Run: `npm run build:v201 && npm run test:e2e:v201`  
Expected: 分享复制只包含固定 V2.0.1 文案与公开网址，不包含生成结果、hash 或 query；三个快捷操作 PASS。

```bash
git add src/v201/web/page.v201.html src/v201/web/app.v201.css src/v201/web/app.v201.js scripts/verify-v201-browser.mjs v2.01.html assets/v2.01
git commit -m "feat: restore v2.0.1 floating site actions"
```

### Task 6: 完整门禁、视觉复核与发布

**Files:**
- Modify: `README.md`
- Modify: `docs/readme-en.md`
- Generated: `v2.01.html`
- Generated: `assets/v2.01/*`

- [ ] **Step 1: 更新默认明文与 History 文档**

README 中文说明必须包含：

```markdown
- 当前生成结果默认显示明文；“隐藏内容 / 显示内容”只原地更新，不触发滚动或位移动画。
- 生成记录 History 每次会话默认关闭，仅在当前页面内存中受 100 条与 8 MiB 预算约束。
- 右下角分享按钮只复制固定公开介绍与 V2.0.1 地址，不读取生成结果。
```

英文文档写入语义一致的说明。

- [ ] **Step 2: 重建并运行完整本地门禁**

Run: `npm run verify:v201`  
Expected: V1 73/73、V2 171/171、V2.0.1 全部测试、覆盖率、Browser E2E、`npm audit` 与制品 diff 全部 PASS。

- [ ] **Step 3: 使用真实浏览器复核视觉**

Run: `command -v npx >/dev/null 2>&1 && npm run serve`，另一个终端运行 Playwright CLI 打开 `http://127.0.0.1:8765/v2.01.html`。  
Expected: 1280×900 与 390×844 下双语导航对齐、结果切换无跳动、History 不撑宽、浮动按钮不遮挡主要操作。

- [ ] **Step 4: 提交文档与最终制品**

```bash
git add README.md docs/readme-en.md src/v201/web tests/v201 scripts/verify-v201-browser.mjs v2.01.html assets/v2.01
git commit -m "docs: describe v2.0.1 localized result experience"
```

- [ ] **Step 5: 推送分支并创建 PR**

```bash
git push -u origin codex/v2.0.1-ui-localization
gh pr create --base main --head codex/v2.0.1-ui-localization --title "V2.0.1：中文结果与紧凑记录体验" --body-file docs/superpowers/specs/2026-08-26-password-generator-v2.0.1-ui-localization-design.md
```

- [ ] **Step 6: 等待门禁、合并和线上核验**

Run: `gh pr checks --watch`，成功后通过 GitHub 合并 PR，并等待 `V2.0.1 verified Pages deployment` 完成。  
Expected: `https://betaer.github.io/password-generator/v2.01.html` 返回 200；线上与本地 SHA-256 一致；`index.html` 和 `index-2.0.html` 继续返回 200。

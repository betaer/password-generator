# X Floating Action Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a responsive X profile shortcut to the V1.7.5 archive and V2.1 production floating action groups, then publish both verified pages.

**Architecture:** V2.1 keeps its static semantic link in the canonical page source and regenerates content-hashed assets. V1.7.5 keeps its existing inline React/Ant Design structure and adds one dependency-free inline SVG component. Both implementations inherit their version's shared floating-button styles so dimensions and mobile label hiding remain consistent.

**Tech Stack:** Static HTML, inline React/Ant Design (V1.7.5), vanilla HTML/CSS (V2.1), Node.js test runner, Playwright Chromium, GitHub Actions/Pages.

---

### Task 1: Add failing V1.7.5 and V2.1 contracts

**Files:**
- Modify: `tests/html.integration.test.mjs`
- Modify: `tests/v21/web-contract.test.mjs`
- Modify: `scripts/verify-v21-browser.mjs`

- [ ] **Step 1: Add the V1.7.5 contract assertions**

```js
assert.match(app, /const XOutlined = createInlineIcon/);
assert.match(app, /const X_PROFILE_URL = 'https:\/\/x\.com\/Betaer'/);
assert.match(app, /className: "site-floating-button site-floating-x"/);
assert.match(floatingActions, /"aria-label": "在 X 关注 Betaer"/);
assert.ok(floatingActions.indexOf('site-floating-github') < floatingActions.indexOf('site-floating-x'));
assert.ok(floatingActions.indexOf('site-floating-x') < floatingActions.indexOf('site-floating-copy'));
```

- [ ] **Step 2: Add the V2.1 source contract assertions**

```js
assert.match(page, /class="site-floating-button site-floating-x"/u);
assert.match(page, /href="https:\/\/x\.com\/Betaer"/u);
assert.match(page, /target="_blank" rel="noopener noreferrer"/u);
assert.match(page, /aria-label="在 X 关注 Betaer"/u);
```

- [ ] **Step 3: Add browser assertions for desktop and mobile sizing**

```js
const xLink = page.getByRole('link', { name: '在 X 关注 Betaer' });
assert.equal(await xLink.getAttribute('href'), 'https://x.com/intent/user?screen_name=betaer');
assert.equal(await xLink.getAttribute('target'), '_blank');
assert.equal(await xLink.getAttribute('rel'), 'noopener noreferrer');
const desktopSizes = await page.locator('.site-floating-github, .site-floating-x, .site-floating-copy')
  .evaluateAll((nodes) => nodes.map((node) => ({ width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height })));
assert.equal(new Set(desktopSizes.map(({ width }) => width)).size, 1);
await page.setViewportSize({ width: 390, height: 844 });
assert.deepEqual(await xLink.evaluate((node) => ({ width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height })), { width: 44, height: 44 });
```

- [ ] **Step 4: Run focused tests and verify RED**

Run: `node --test tests/html.integration.test.mjs tests/v21/web-contract.test.mjs`

Expected: FAIL because neither page contains `site-floating-x` or `https://x.com/intent/user?screen_name=betaer` yet.

### Task 2: Implement both X links and rebuild V2.1

**Files:**
- Modify: `index-v1.75.html`
- Modify: `src/v21/web/page.v21.html`
- Modify: `src/v21/web/app.v21.css`
- Generated: `index.html`
- Generated: `index-2.1.html`
- Generated: `assets/v2.1/manifest.json`
- Generated: `assets/v2.1/app.*.css`

- [ ] **Step 1: Add the V1.7.5 inline X icon, constant, and button**

```js
const XOutlined = createInlineIcon([
  { d: 'M4 4l16 16M20 4 4 20', stroke: 'currentColor', strokeWidth: 2.1, strokeLinecap: 'round' },
]);
const X_PROFILE_URL = 'https://x.com/intent/user?screen_name=betaer';

React.createElement(Button, {
  className: 'site-floating-button site-floating-x',
  href: X_PROFILE_URL,
  target: '_blank',
  rel: 'noopener noreferrer',
  icon: React.createElement(XOutlined, null),
  'aria-label': '在 X 关注 Betaer',
}, React.createElement('span', { className: 'site-floating-button-label' }, '@Betaer'));
```

- [ ] **Step 2: Include the X class in the V1.7.5 shared neutral-button selector**

```css
.site-floating-github.ant-btn,
.site-floating-x.ant-btn,
.site-floating-copy.ant-btn { border-color: rgba(23, 32, 51, .2); color: #172033; }
```

- [ ] **Step 3: Add the semantic V2.1 X link between GitHub and copy**

```html
<a class="site-floating-button site-floating-x" href="https://x.com/intent/user?screen_name=betaer" target="_blank" rel="noopener noreferrer" aria-label="在 X 关注 Betaer"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4l16 16M20 4 4 20" /></svg><span class="site-floating-button-label">@Betaer</span></a>
```

- [ ] **Step 4: Build and run focused tests to verify GREEN**

Run: `npm run build:v21 && node --test tests/html.integration.test.mjs tests/v21/web-contract.test.mjs`

Expected: all focused tests pass and V2.1 content hashes are regenerated.

- [ ] **Step 5: Commit the feature**

```bash
git add index-v1.75.html src/v21/web/page.v21.html src/v21/web/app.v21.css index.html index-2.1.html assets/v2.1 tests scripts/verify-v21-browser.mjs
git commit -m "feat: add X floating profile link"
```

### Task 3: Verify, publish, and inspect production

**Files:**
- Verify: all files changed in Tasks 1-2

- [ ] **Step 1: Run the complete security and release gate**

Run: `npm run verify:v21`

Expected: V1, V2, V2.0.1 and V2.1 tests pass; coverage stays above 80%; Chromium E2E and artifact reproducibility pass; npm audit reports zero high-severity vulnerabilities.

- [ ] **Step 2: Push the feature branch and open a PR**

```bash
git push -u origin codex/v2.1-x-floating-action
gh pr create --base main --head codex/v2.1-x-floating-action --title "Add X floating profile shortcut" --body "Adds aligned responsive X shortcuts to V1.7.5 and V2.1."
```

- [ ] **Step 3: Merge only after the GitHub security gate succeeds**

```bash
gh pr checks --watch
gh pr merge --merge --delete-branch
```

- [ ] **Step 4: Wait for the exact main commit Pages deployment**

```bash
gh run list --branch main --workflow v201-pages.yml --limit 3
gh run watch "$(gh run list --branch main --workflow v201-pages.yml --limit 1 --json databaseId --jq '.[0].databaseId')" --exit-status
```

- [ ] **Step 5: Verify both production URLs with Playwright CLI**

```text
Open https://betaer.github.io/password-generator/
Open https://betaer.github.io/password-generator/index-v1.75.html
Confirm the X link is between GitHub and copy, opens https://x.com/intent/user?screen_name=betaer in a new tab, is equal-width on desktop, and is 44 × 44px with a visually hidden label at 390px.
```

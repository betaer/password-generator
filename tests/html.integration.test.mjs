import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const memorableEngineSource = await readFile(new URL('../assets/js/memorable-engine.js', import.meta.url), 'utf8');
const wordPackManagerSource = await readFile(new URL('../assets/js/word-pack-manager.js', import.meta.url), 'utf8');
const securityAnalysisSource = await readFile(new URL('../assets/js/security-analysis.js', import.meta.url), 'utf8');
const appStart = html.indexOf('const React =');
assert.ok(appStart > -1, '缺少 V1.7.5 应用脚本');
const app = html.slice(appStart);

test('完整应用脚本可以被 JavaScript 引擎解析', () => {
  const scriptStart = html.lastIndexOf('\ntry {', appStart);
  const scriptEnd = html.indexOf('</script>', appStart);
  const runtimeScript = html.slice(scriptStart + 1, scriptEnd);
  assert.doesNotThrow(() => new Function(runtimeScript));
});

test('首次冷启动所需的小型运行时已压缩内置且可以直接执行', () => {
  assert.doesNotMatch(html, /<script src="\.\/assets\/js\/(?:memorable-engine|word-pack-manager)\.js"><\/script>/);

  const embeddedMemorableEngine = html.match(/<script data-startup-runtime="memorable-engine">\n([\s\S]*?)\n  <\/script>/)?.[1];
  const embeddedWordPackManager = html.match(/<script data-startup-runtime="word-pack-manager">\n([\s\S]*?)\n  <\/script>/)?.[1];
  const embeddedSecurityAnalysis = html.match(/<script data-startup-runtime="security-analysis">\n([\s\S]*?)\n  <\/script>/)?.[1];

  assert.ok(embeddedMemorableEngine, '缺少内置的记忆短语安全随机运行时');
  assert.ok(embeddedWordPackManager, '缺少内置的异步词包管理运行时');
  assert.ok(embeddedSecurityAnalysis, '缺少内置的密码安全分析运行时');
  assert.ok(
    embeddedMemorableEngine.length + embeddedWordPackManager.length + embeddedSecurityAnalysis.length
      < memorableEngineSource.length + wordPackManagerSource.length + securityAnalysisSource.length,
    '内置启动模块应使用压缩代码',
  );

  const sandbox = {};
  assert.doesNotThrow(() => vm.runInNewContext(
    `${embeddedMemorableEngine}\n${embeddedWordPackManager}\n${embeddedSecurityAnalysis}`,
    sandbox,
  ));
  assert.equal(typeof sandbox.MemorableEngine?.SecureWordGenerator, 'function');
  assert.equal(typeof sandbox.MemorableEngine?.EntropyCalculator?.forWords, 'function');
  assert.equal(typeof sandbox.WordPackRuntime?.WordPackManager, 'function');
  assert.equal(typeof sandbox.PasswordSecurityRuntime?.createAssessment, 'function');
});

test('说明气泡在触摸设备首次点击后保持展开并支持点击外部关闭', () => {
  const infoTipSource = app.match(/function isTouchTooltipEnvironment[\s\S]*?(?=\nfunction MetricLabel)/)?.[0];
  assert.ok(infoTipSource, '缺少触摸设备气泡交互逻辑');
  assert.match(infoTipSource, /matchMedia\('\(hover: none\), \(pointer: coarse\)'\)/);
  assert.match(infoTipSource, /navigator\.maxTouchPoints > 0/);
  assert.match(infoTipSource, /trigger: touchTooltip \? \["click"\] : \["hover", "focus"\]/);
  assert.match(infoTipSource, /open: touchTooltip \? touchOpen : undefined/);
  assert.match(infoTipSource, /onOpenChange: touchTooltip \? setTouchOpen : undefined/);
});

test('页面不调用 WebAudio 且不生成浏览器的主要内容跳转入口', () => {
  assert.doesNotMatch(app, /\b(?:AudioContext|webkitAudioContext|OfflineAudioContext|createOscillator)\b/);
  const pageRender = app.slice(app.indexOf('return (React.createElement(Layout'), app.indexOf('\nfunction RootApp'));
  assert.ok(pageRender, '缺少页面主体渲染代码');
  assert.doesNotMatch(pageRender, /React\.createElement\(Content/);
  assert.doesNotMatch(pageRender, /React\.createElement\("main"/);
  assert.match(pageRender, /React\.createElement\("div", \{ className: "page-main" \}/);
});

test('V1.7.5 顶部导航使用四种批准图标', () => {
  for (const token of ['SparklesOutlined', 'BulbOutlined', 'DialPadOutlined', 'SafetyCertificateFilled']) {
    assert.match(app, new RegExp(token), `缺少 ${token}`);
  }
  assert.match(app, /mode-option-label/);
  assert.match(app, /React\.createElement\(SafetyCertificateFilled, \{ style: \{ color: '#1677ff'/);
  const navigation = app.slice(app.indexOf('className: "mode-nav"'), app.indexOf('], onChange: switchMode'));
  assert.ok(navigation.indexOf('"随机密码"') < navigation.indexOf('"PIN 码"'), 'PIN 码应位于随机密码之后');
  assert.ok(navigation.indexOf('"PIN 码"') < navigation.indexOf('"记忆短语"'), '记忆短语应位于 PIN 码之后');
});

test('顶部 Tab 与 URL 锚点双向同步且内容垂直居中', () => {
  const helperSource = app.match(/const MODE_HASH_BY_MODE[\s\S]*?(?=\nconst SHARE_PROMOTION_TEXTS)/)?.[0];
  assert.ok(helperSource, '缺少 Tab 与 URL 锚点映射');
  const { modeHashFor, modeFromHash } = Function(`${helperSource}; return { modeHashFor, modeFromHash };`)();

  assert.equal(modeHashFor('random'), '#password');
  assert.equal(modeHashFor('pin'), '#pin');
  assert.equal(modeHashFor('memorable'), '#words');
  assert.equal(modeFromHash('#password'), 'random');
  assert.equal(modeFromHash('#pin'), 'pin');
  assert.equal(modeFromHash('#words'), 'memorable');
  assert.equal(modeFromHash('#unknown'), 'random');
  assert.equal(modeFromHash(''), 'random');

  assert.match(app, /next\.mode = modeFromHash\(window\.location\.hash\)/);
  assert.match(app, /catch \{[\s\S]*?fallback\.mode = modeFromHash\(window\.location\.hash\);[\s\S]*?return fallback;/);
  assert.match(app, /window\.history\.pushState\(null, '', nextHash\)/);
  assert.match(app, /window\.history\.replaceState\(null, '', nextHash\)/);
  assert.match(app, /window\.addEventListener\('popstate', syncModeFromHash\)/);
  assert.match(app, /window\.addEventListener\('hashchange', syncModeFromHash\)/);
  assert.match(app, /switchMode\(mode, \{ syncHash: false \}\)/);

  assert.match(html, /\.mode-nav \.ant-segmented-item \{[\s\S]*?display: flex;[\s\S]*?align-items: stretch;/);
  assert.match(html, /\.mode-nav \.ant-segmented-item-label \{[\s\S]*?display: flex;[\s\S]*?align-items: center;[\s\S]*?justify-content: center;[\s\S]*?line-height: 1\.2;/);
  assert.match(html, /\.mode-option-label \{[\s\S]*?height: 100%;[\s\S]*?align-items: center;[\s\S]*?line-height: 1\.2;/);
});

test('直接打开记忆短语锚点时等待词库就绪后自动生成', () => {
  assert.match(app, /loadSelectedWordPack\(stateRef\.current\.memorable, stateRef\.current\.mode === 'memorable'\)/);
  assert.match(app, /useEffect\(\(\) => \{[\s\S]*?if \(stateRef\.current\.mode !== 'memorable'\)[\s\S]*?generateAll\(stateRef\.current\);[\s\S]*?\}, \[\]\);/);
});

test('右下角提供 GitHub 与按语言选择文案的分享本站按钮', () => {
  assert.match(app, /const GitHubOutlined = createInlineIcon/);
  assert.match(app, /const GITHUB_REPOSITORY_URL = 'https:\/\/github\.com\/betaer\/password-generator'/);
  assert.match(app, /const GITHUB_PAGES_URL = 'https:\/\/betaer\.github\.io\/password-generator\/'/);
  assert.match(app, /const GITHUB_STAR_DISPLAY = '999\+'/);
  assert.match(app, /const SHARE_PROMOTION_TEXTS = Object\.freeze/);
  assert.match(app, /分享一个专业又好用的密码生成器/);
  assert.match(app, /A privacy-first Password Generator for passwords, passphrases, and PINs\./);
  assert.match(app, /function preferredShareLanguage/);
  assert.match(app, /className: "site-floating-button site-floating-github"/);
  assert.match(app, /className: "site-floating-button site-floating-copy"/);
  assert.match(app, /className: "site-floating-star-badge"[\s\S]*?GITHUB_STAR_DISPLAY/);
  assert.match(app, /copyText\(getSharePromotionText\(\), '本站分享文案已复制'\)/);
  assert.match(app, /"分享本站"/);
  assert.match(html, /\.site-floating-actions \{[\s\S]*?position: fixed/);
  assert.match(html, /\.site-floating-button\.ant-btn \{[\s\S]*?width: 120px;[\s\S]*?min-width: 120px;/);
  assert.match(html, /@media \(max-width: 640px\)[\s\S]*?\.site-floating-button\.ant-btn \{[\s\S]*?min-width: 44px;[\s\S]*?width: 44px;/);
  assert.match(html, /\.site-floating-github\.ant-btn,[\s\S]*?\.site-floating-copy\.ant-btn \{[\s\S]*?color: #172033/);
  assert.match(html, /\.site-floating-star-badge \{[\s\S]*?background: #172033/);
  const floatingActions = app.slice(app.indexOf('className: "site-floating-actions"'), app.indexOf('function RootApp'));
  assert.doesNotMatch(floatingActions, /React\.createElement\(Tooltip/, '右下角两个按钮不应显示黑色气泡提示');
});

test('页面超过一屏且已向下滚动时在快捷按钮上方显示回到顶部', () => {
  const helperSource = app.match(/function shouldShowBackToTop[\s\S]*?(?=\nfunction isChineseLocale)/)?.[0];
  assert.ok(helperSource, '缺少回到顶部可见性判断函数');
  const shouldShowBackToTop = Function(`${helperSource}; return shouldShowBackToTop;`)();
  assert.equal(shouldShowBackToTop(1200, 800, 0), false, '页面顶部不应显示');
  assert.equal(shouldShowBackToTop(800, 800, 200), false, '页面不超过一屏时不应显示');
  assert.equal(shouldShowBackToTop(1200, 800, 80), false, '轻微滚动不应显示');
  assert.equal(shouldShowBackToTop(1200, 800, 81), true, '长页面向下滚动后应显示');
  assert.match(app, /const \[showBackToTop, setShowBackToTop\] = useState\(false\)/);
  assert.match(app, /new ResizeObserver\(updateBackToTopVisibility\)/);
  assert.match(app, /window\.addEventListener\('scroll', updateBackToTopVisibility, \{ passive: true \}\)/);
  assert.match(app, /window\.scrollTo\(\{ top: 0, left: 0, behavior \}\)/);
  const floatingActions = app.slice(app.indexOf('className: "site-floating-actions"'), app.indexOf('function RootApp'));
  assert.ok(floatingActions.indexOf('site-floating-backtop') < floatingActions.indexOf('site-floating-github'), '回到顶部应位于 GitHub 按钮上方');
  assert.match(floatingActions, /showBackToTop \? React\.createElement\(Button/);
  assert.match(app, /"回到顶部"/);
});

test('分享文案在浏览器或系统语言命中中文时使用中文，否则使用英文', () => {
  const sourceStart = app.indexOf("const GITHUB_PAGES_URL =");
  const sourceEnd = app.indexOf('const { Header', sourceStart);
  assert.ok(sourceStart > -1 && sourceEnd > sourceStart, '缺少分享语言选择源码');
  const shareSource = app.slice(sourceStart, sourceEnd);
  const api = Function('navigator', 'Intl', `${shareSource}; return { preferredShareLanguage, getSharePromotionText };`)(
    { language: 'en-US', languages: ['en-US'] },
    Intl,
  );
  const intlFor = (locale) => ({
    DateTimeFormat: function DateTimeFormat() {
      return { resolvedOptions: () => ({ locale }) };
    },
    NumberFormat: function NumberFormat() {
      return { resolvedOptions: () => ({ locale }) };
    },
  });
  assert.equal(api.preferredShareLanguage(
    { language: 'zh-CN', languages: ['zh-CN', 'en-US'] },
    intlFor('en-US'),
  ), 'zh');
  assert.equal(api.preferredShareLanguage(
    { language: 'en-US', languages: ['en-US'] },
    intlFor('zh-Hant-TW'),
  ), 'zh');
  assert.equal(api.preferredShareLanguage(
    { language: 'en-US', languages: ['en-US', 'fr-FR'] },
    intlFor('en-US'),
  ), 'en');
  assert.match(api.getSharePromotionText(
    { language: 'zh-TW', languages: ['zh-TW'] },
    intlFor('en-US'),
  ), /^分享一个专业又好用的密码生成器/);
  assert.match(api.getSharePromotionText(
    { language: 'en-US', languages: ['en-US'] },
    intlFor('en-GB'),
  ), /^A privacy-first Password Generator/);
});

test('三个模式共用立方体结果标题和主次按钮层级', () => {
  assert.match(app, /ResultCubeOutlined/);
  assert.match(app, /className: "result-regenerate-button", type: "primary"/);
  assert.match(app, /className: "result-copy-button"/);
  assert.match(html, /\.result-copy-button[\s\S]*?background: #fff !important/);
  assert.match(html, /\.password-text[\s\S]*?text-align: center/);
});

test('结果复制状态只在当前结果成功写入剪贴板后显示', () => {
  assert.match(app, /copiedResultSignature/);
  assert.match(app, /resultWasCopied/);
  assert.match(app, /已安全生成，已复制到剪贴板/);
  assert.match(app, /已安全生成，点击复制可写入剪贴板/);
  assert.match(app, /return true/);
  assert.match(app, /return false/);
});

test('PIN 规则使用四张响应式卡片并移除重复的推荐长度区块', () => {
  assert.equal((app.match(/React\.createElement\(PinRuleCard/g) || []).length, 4);
  assert.match(html, /\.pin-rule-grid[\s\S]*?grid-template-columns: repeat\(2/);
  assert.match(html, /@media \(max-width: 760px\)[\s\S]*?\.pin-rule-grid \{ grid-template-columns: 1fr/);
  assert.match(app, /title: "连续数字限制"/);
  assert.match(app, /limitSequential: true/);
  assert.match(app, /const SETTINGS_SCHEMA_VERSION = 12/);
  assert.match(app, /if \(!saved \|\| Number\(saved\.settingsVersion \|\| 0\) < 12\)[\s\S]*?next\.pin\.limitSequential = true/);
  assert.match(app, /checked: state\.pin\.limitSequential/);
  assert.doesNotMatch(app, /pin-scenario-panel|推荐长度/);
});

test('连续数字限制阻止三位升序或降序并参与组合空间估算', () => {
  const source = app.match(/function nextSequentialRun[\s\S]*?(?=\nfunction validatePin)/)?.[0];
  assert.ok(source, '缺少连续数字检测函数');
  const hasSequentialDigitRun = Function(`${source}; return hasSequentialDigitRun;`)();
  assert.equal(hasSequentialDigitRun('12'), false);
  assert.equal(hasSequentialDigitRun('123'), true);
  assert.equal(hasSequentialDigitRun('321'), true);
  assert.equal(hasSequentialDigitRun('012'), true);
  assert.equal(hasSequentialDigitRun('1203'), false);
  assert.match(app, /if \(config\.limitSequential\)[\s\S]*?choices = choices\.filter\(\(digit\) => !hasSequentialDigitRun\(result \+ digit, 2\)\)/);
  assert.match(app, /function countPinPossibilities[\s\S]*?config\.limitSequential && next\.runLength > 2/);
  assert.match(app, /if \(config\.limitSequential\) \{[\s\S]*?log2BigInt\(countPinPossibilities\(config\)\)/);
});

test('强度圆环按 L1-L4 警告、L5-L8 盾牌并继承等级颜色', () => {
  assert.match(app, /strength\.index < 4 \? WarningTriangleFilled : SafetyCertificateFilled/);
  assert.match(app, /style: \{ color: strength\.color \}/);
  assert.match(app, /strokeColor: strength\.color/);
});

test('记忆短语保留完整格式选项并移除生硬的记忆故事模块', () => {
  for (const label of ['全部小写', '每词首字大写', '首词大写', '随机全大写', '空格Space', '随机数字', '随机符号']) {
    assert.match(app, new RegExp(label), `缺少完整选项：${label}`);
  }
  assert.match(html, /\.memorable-format-grid \.ant-segmented-item-label[\s\S]*?text-overflow: clip/);
  for (const token of ['记忆故事', '生成三幕记忆故事', 'story-context', 'MemoryStoryCard', 'StoryDisplay', 'buildStoryHint', 'storyContext', 'showStory', 'StoryRenderer', 'StoryIntentParser']) {
    assert.doesNotMatch(app, new RegExp(token), `仍残留记忆故事实现：${token}`);
  }
  for (const selector of ['memory-story-card', 'story-context-field', 'story-security-note', 'story-generator-box']) {
    assert.doesNotMatch(html, new RegExp(`\\.${selector}`), `仍残留记忆故事样式：${selector}`);
  }
});

test('结果结构分割线无阴影并统一弱虚线', () => {
  assert.match(html, /\.result-sticky-summary \{[\s\S]*?border-bottom: 1px dashed var\(--structural-divider\) !important;[\s\S]*?box-shadow: none !important/);
});

test('随机密码将超长推荐场景替换为完整密码方案', () => {
  for (const id of ['bank-pin-4', 'bank-pin-6', 'bank-card-16', 'bank-card-19', 'btc-legacy', 'btc-p2sh', 'btc-bech32', 'eth-address', 'tron-address', 'btc-private-key', 'eth-private-key', 'tron-private-key']) {
    assert.match(app, new RegExp(`id: '${id}'`), `缺少密码方案：${id}`);
  }
  for (const group of ['数字场景', '钱包地址', '钱包私钥']) {
    assert.match(app, new RegExp(`group: '${group}'`), `缺少方案分组：${group}`);
  }
  assert.match(app, /function PasswordSchemePanel/);
  assert.match(app, /function generatePasswordSchemeValue/);
  for (const format of ['纯数字', 'Base58', 'Bech32', '十六进制 Hex']) {
    assert.match(app, new RegExp(format), `方案按钮缺少字符集说明：${format}`);
  }
  assert.match(app, /仅用于测试演示：不校验银行卡规则、地址校验和或链上有效性，请勿用于真实交易/);
  assert.match(app, /role: "group", "aria-labelledby": labelId/);
  assert.doesNotMatch(app, /EXTENDED_LENGTH_SCENARIOS|function ExtendedLengthScenarios/);
  assert.match(html, /\.password-surface\.is-ultra-long \.password-text[\s\S]*?white-space: nowrap/);
});

test('密码方案按常用顺序排列', () => {
  const schemeStart = app.indexOf('const PASSWORD_SCHEMES');
  const schemeEnd = app.indexOf('const SETTINGS_KEY', schemeStart);
  const schemes = app.slice(schemeStart, schemeEnd);
  assert.ok(schemes.indexOf("id: 'bank-pin-6'") < schemes.indexOf("id: 'bank-pin-4'"), '6 位银行卡密码应位于 4 位之前');
  assert.ok(schemes.indexOf("id: 'eth-address'") < schemes.indexOf("id: 'tron-address'"), 'ETH 地址应位于 TRON 地址之前');
  assert.ok(schemes.indexOf("id: 'tron-address'") < schemes.indexOf("id: 'btc-legacy'"), 'ETH、TRON 应位于三种 BTC 地址之前');
});

test('钱包地址文案按协议区分前缀与实际字符数', () => {
  assert.match(app, /title: 'ETH 地址', detail: '42 字符 · 0x \+ 40 Hex', length: 42/);
  assert.match(app, /title: 'TRON 地址', detail: '34 字符 · T 开头 · Base58', length: 34/);
  assert.match(app, /title: 'BTC Legacy', detail: '34 字符示例 · 1 开头', length: 34/);
  assert.match(app, /title: 'BTC P2SH', detail: '34 字符示例 · 3 开头', length: 34/);
  assert.match(app, /title: 'BTC Bech32', detail: '42 字符 · bc1q · P2WPKH', length: 42/);
});

test('密码方案生成器遵守各格式长度、前缀和字符集', () => {
  const constants = app.match(/const SCHEME_HEX_LOWER[\s\S]*?(?=\nconst SETTINGS_KEY)/)?.[0];
  const randomIndex = app.match(/function secureRandomIndex[\s\S]*?(?=\nfunction secureShuffle)/)?.[0];
  const generator = app.match(/function passwordSchemeById[\s\S]*?(?=\nfunction loadSettings)/)?.[0];
  assert.ok(constants && randomIndex && generator, '缺少密码方案常量或生成函数');
  const generatePasswordSchemeValue = Function(
    'crypto',
    `${constants}; ${randomIndex}; ${generator}; return generatePasswordSchemeValue;`,
  )({ getRandomValues(array) { for (let i = 0; i < array.length; i += 1) array[i] = (i * 2654435761 + 17) >>> 0; return array; } });

  const checks = [
    ['bank-pin-4', 4, /^\d{4}$/],
    ['bank-pin-6', 6, /^\d{6}$/],
    ['bank-card-16', 16, /^\d{16}$/],
    ['bank-card-19', 19, /^\d{19}$/],
    ['btc-legacy', 34, /^1[1-9A-HJ-NP-Za-km-z]{33}$/],
    ['btc-p2sh', 34, /^3[1-9A-HJ-NP-Za-km-z]{33}$/],
    ['btc-bech32', 42, /^bc1q[023456789acdefghjklmnpqrstuvwxyz]{38}$/],
    ['eth-address', 42, /^0x[0-9a-f]{40}$/],
    ['tron-address', 34, /^T[1-9A-HJ-NP-Za-km-z]{33}$/],
    ['btc-private-key', 64, /^[0-9a-f]{64}$/],
    ['eth-private-key', 64, /^[0-9a-f]{64}$/],
    ['tron-private-key', 64, /^[0-9a-f]{64}$/],
  ];
  for (const [id, length, pattern] of checks) {
    const value = generatePasswordSchemeValue(id);
    assert.equal(value.length, length, `${id} 长度错误`);
    assert.match(value, pattern, `${id} 格式错误`);
  }
});

test('选择密码方案后同步规则、立即生成复制并进入普通历史记录', () => {
  assert.match(app, /schemeId: 'custom'/);
  assert.match(app, /const applyPasswordScheme = async \(schemeId\)/);
  assert.match(app, /next\.random\.schemeId = schemeId/);
  assert.match(app, /next\.quantity = 1/);
  assert.match(app, /generatePasswordSchemeValue\(schemeId\)/);
  assert.match(app, /copyText\(item\.value, `已按“\$\{scheme\.title\} · \$\{scheme\.detail\}”生成并复制`\)/);
  assert.match(app, /const generated = generateAll\(next\)/);
  assert.match(app, /setResults\(nextResults\);[\s\S]*?addHistory\(nextResults, sourceState\)/);
  assert.match(app, /已按“\$\{scheme\.title\} · \$\{scheme\.detail\}”生成并复制/);
  assert.match(app, /next\.random\.schemeId = 'custom'/);
  assert.doesNotMatch(app, /schemeId[\s\S]{0,80}(禁用历史|不保存历史)/);
});

test('自动生成成功气泡不重复添加 Emoji', () => {
  assert.match(app, /AUTO_GENERATE_COPY_SUCCESS_MESSAGE = '新密码已生成并复制'/);
  assert.doesNotMatch(app, /AUTO_GENERATE_COPY_SUCCESS_MESSAGE = '✅/);
});

test('随机密码设置依次显示密码强度、生成数量、密码长度', () => {
  const start = app.indexOf('const renderRandomSettings');
  const end = app.indexOf('const renderMemorableSettings', start);
  const randomSettings = app.slice(start, end);
  const strengthIndex = randomSettings.indexOf('title: "\\u5BC6\\u7801\\u5F3A\\u5EA6"');
  const quantityIndex = randomSettings.indexOf('renderQuantitySettings()');
  const lengthIndex = randomSettings.indexOf('title: "\\u5BC6\\u7801\\u957F\\u5EA6"');
  assert.ok(strengthIndex > -1, '缺少密码强度区块');
  assert.ok(quantityIndex > strengthIndex, '生成数量应位于密码强度之后');
  assert.ok(lengthIndex > quantityIndex, '密码长度应位于生成数量之后');
});

test('除页面品牌外所有内容区块标题统一使用 H3', () => {
  assert.match(app, /function SectionHeading\([\s\S]*?React\.createElement\(Title, \{ level: 3/);
  assert.doesNotMatch(app, /React\.createElement\(Title, \{ level: 2/);
  assert.match(app, /React\.createElement\("h3", \{ className: "strength-analysis-title" \}/);
  assert.match(app, /React\.createElement\("h3", null,[\s\S]*?React\.createElement\(HeadingIcon, \{ icon: HistoryOutlined \}\)/);
  assert.match(app, /React\.createElement\(Title, \{ level: 3, style: \{ fontSize: 18 \} \},[\s\S]*?result-title-content/);
  assert.match(app, /React\.createElement\(Title, \{ level: 1, className: "brand-title" \}/);
});

test('所有 H3 标题使用透明底简洁 SVG 图标', () => {
  for (const title of ['密码强度', '生成数量', '密码长度', '字符类型', '开头与结尾', '高级设置', '符号占比', '符号设置', '单词数量', '词库与安全', 'PIN 长度', 'PIN 规则']) {
    assert.match(app, new RegExp(`'${title}': [A-Za-z]+Outlined|'${title}': SafetyCertificateFilled`), `缺少标题图标映射：${title}`);
  }
  for (const icon of ['ChartLineOutlined', 'KeyOutlined', 'ResultCubeOutlined', 'HistoryOutlined']) {
    assert.match(app, new RegExp(`HeadingIcon, \\{ icon: ${icon}`), `缺少独立 H3 图标：${icon}`);
  }
  assert.match(html, /\.h3-heading-icon \{[\s\S]*?background: transparent !important;[\s\S]*?box-shadow: none !important/);
  assert.match(html, /\.pin-rule-card\.enabled \.pin-rule-icon \{ color: var\(--blue\); background: transparent !important; \}/);
  assert.match(app, /function createInlineIcon[\s\S]*?React\.createElement\('svg'/);
});

test('随机密码默认使用 L8、生成 1 个、32 位及 20%～80% 符号范围', () => {
  assert.match(app, /const SETTINGS_SCHEMA_VERSION = 12/);
  assert.match(app, /const SETTINGS_KEY = 'password-generator-settings-v175'/);
  assert.match(app, /const HISTORY_SESSION_KEY = 'password-generator-history-session-v175'/);
  assert.match(app, /mode: 'random',[\s\S]*?quantity: 1,[\s\S]*?length: 32/);
  for (const type of ['lowercase', 'uppercase', 'digits', 'symbols']) {
    assert.match(app, new RegExp(`${type}: true`), `默认未启用 ${type}`);
  }
  assert.match(app, /symbolRatioMode: 'range'/);
  assert.match(app, /random: \{[\s\S]*?symbolRatioRange: \[20, 80\]/);
  assert.match(app, /Number\(saved\.settingsVersion \|\| 0\) < 11[\s\S]*?next\.mode = 'random';[\s\S]*?next\.quantity = 1;[\s\S]*?next\.random = structuredClone\(DEFAULT_STATE\.random\)/);
});

test('密码强度分析只根据当前生成结果实时计算，不复用生成规则估算', () => {
  assert.match(app, /function estimateGeneratedResult\(result\)/);
  assert.match(app, /const currentEstimate = useMemo\(\(\) => firstResult[\s\S]*?estimateGeneratedResult\(firstResult\)/);
  assert.match(app, /React\.createElement\(StrengthTargetControl, \{ entropy: configuredEstimate\.entropy/);
  assert.doesNotMatch(app, /firstResult\?\.estimate/);
  assert.doesNotMatch(app, /nextResults\.push\(\{ id: createId\(\), \.\.\.item, estimate:/);
  assert.doesNotMatch(app, /replacement = \{ id: createId\(\), \.\.\.item, estimate:/);

  const statsSource = app.match(/function passwordStats[\s\S]*?(?=\nfunction modeName)/)?.[0];
  const estimateSource = app.match(/function log2Factorial[\s\S]*?(?=\nfunction modeName)/)?.[0];
  assert.ok(statsSource && estimateSource, '缺少结果级强度计算函数');
  const estimateGeneratedResult = Function(
    'LOWER', 'UPPER', 'DIGITS', 'ALL_SYMBOLS', 'isWeakPin', 'hasSequentialDigitRun', 'pinRiskRuntime', 'pinRiskDatabase',
    `${statsSource}; ${estimateSource}; return estimateGeneratedResult;`,
  )(
    'abcdefghijklmnopqrstuvwxyz',
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    '0123456789',
    `!\"#$%&'()*+,-./:;<=>?@[\\]^_\`{|}~`,
    (value) => ['0000', '1111', '1234', '4321'].includes(value),
    (value) => value === '1234' || value === '4321',
    null,
    null,
  );

  const simple = estimateGeneratedResult({ value: 'aaaaaaaa', mode: 'random' });
  const diverse = estimateGeneratedResult({ value: 'aB3!xY7@', mode: 'random' });
  assert.ok(diverse.entropy > simple.entropy, '相同长度但组成更丰富的实际结果应得到更高熵值');
  assert.notEqual(diverse.entropy, simple.entropy, '不同实际结果不应返回同一个静态规则估算');
  assert.ok(estimateGeneratedResult({ value: '5941', mode: 'pin' }).entropy > estimateGeneratedResult({ value: '1111', mode: 'pin' }).entropy, '明显弱 PIN 应按实际结果降级');
});

test('安全分析按理论空间、zxcvbn 模式与三种攻击模型实时合并', () => {
  assert.match(app, /const \{[\s\S]*?createAssessment,[\s\S]*?formatGuessCount,[\s\S]*?\} = globalThis\.PasswordSecurityRuntime/);
  assert.match(app, /import\('\.\/assets\/vendor\/zxcvbn-analyzer\.v2\.min\.js'\)/);
  assert.match(app, /patternGuesses: pattern\.patternGuesses/);
  assert.match(app, /createAssessment\(\{ theoreticalBits: currentEstimate\.entropy, patternGuesses \}\)/);
  assert.match(app, /在线限速攻击/);
  assert.match(app, /慢速密码哈希/);
  assert.match(app, /快速离线哈希/);
  assert.match(app, /这些结果是攻击模型估算，不是安全保证/);
  assert.doesNotMatch(app, /const CRACK_GUESSES_PER_SECOND = 10000/);
});

test('完整 PIN 风险库异步加载、参与生成过滤并展示排名', () => {
  assert.match(app, /import\('\.\/assets\/modules\/pin-risk-engine\.js'\)/);
  assert.match(app, /loadPinRiskDatabase\('\.\/assets\/data\/pin-risk\.v1\.json'\)/);
  assert.match(app, /pinRiskRuntime\.shouldBlockWeakPin\(pin, pinRiskDatabase\)/);
  assert.match(app, /常见 PIN 排名/);
  assert.match(app, /10,000 个四位排名/);
  assert.match(app, /68,202 个六位数字组合/);
});

test('本地生成入口会展开并滚动到底部安全说明', () => {
  assert.match(app, /function openSecurityDetails\(\)/);
  assert.match(app, /document\.getElementById\('security-verification'\)/);
  assert.match(app, /details\.open = true/);
  assert.match(app, /scrollIntoView\(\{ behavior, block: 'start' \}\)/);
  assert.match(html, /CSPRNG/);
  assert.match(html, /Rejection Sampling/);
  assert.match(html, /密码数据平面/);
  assert.match(html, /匿名统计平面/);
  assert.match(html, /DevTools/);
  assert.doesNotMatch(app, /securityModalOpen|setSecurityModalOpen/);
  assert.doesNotMatch(app, /React\.createElement\(Modal, \{/);
  assert.match(app, /本地安全运行时加载失败/);
});

test('网站底部整体折叠展示功能、安全边界、会话历史与自行验证方法', () => {
  assert.match(html, /<details id="security-verification" class="seo-shell-overview">/);
  assert.doesNotMatch(html, /<details id="security-verification" class="seo-shell-overview" open>/);
  assert.match(html, /\.seo-shell-overview-summary::after/);
  assert.match(html, /\.seo-shell-overview\[open\] > \.seo-shell-overview-summary::after/);
  assert.match(html, /id="seo-security-title">安全与可验证性</);
  assert.doesNotMatch(html, /id="seo-faq-title"|class="seo-shell-faq"/);
  assert.match(html, /Web Crypto API/);
  assert.match(html, /拒绝采样/);
  assert.match(html, /历史记录不会跨浏览器会话持久保存/);
  assert.match(html, /关闭当前标签页后自动清除，也可随时手动清空/);
  assert.match(html, /DevTools → Network/);
  assert.match(app, /sessionStorage/);
  assert.doesNotMatch(app, /localStorage\.setItem\(HISTORY_SESSION_KEY/);
});

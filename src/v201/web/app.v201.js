'use strict';

(() => {
  const ASSETS = __V201_ASSET_MANIFEST__;
  const VERSION = '2.0.1';
  const SETTINGS_KEY = 'password-generator:v201:settings';
  const SETTINGS_SCHEMA = 201;
  const MASK = '••••••••••••••••••••••••';
  const LARGE_COPY_CONFIRM_CHARACTERS = 1024 * 1024;
  const runtime = globalThis.PasswordGeneratorV201;
  const root = document.documentElement;

  const failClosed = (message) => {
    root.dataset.passwordGeneratorError = 'true';
    const button = document.getElementById('generate-button');
    if (button) { button.disabled = true; button.textContent = '运行时不可用'; }
    const strip = document.getElementById('resource-strip');
    if (strip) {
      const node = document.createElement('span');
      node.className = 'resource-item';
      node.dataset.state = 'error';
      node.textContent = message;
      strip.replaceChildren(node);
    }
  };

  if (!runtime || runtime.version !== VERSION || root.dataset.runtimeVersion !== VERSION) {
    failClosed('V2.0.1 页面与运行时版本不一致 · 已停止生成');
    return;
  }

  const MODE_HASH = Object.freeze({
    password: '#password', passphrase: '#passphrase', pin: '#pin', token: '#token',
    apiSecret: '#api-secret', uuid: '#uuid', hex: '#hex', randomBytes: '#random-bytes',
    mnemonic: '#mnemonic',
  });
  const HASH_MODE = Object.freeze(Object.fromEntries(Object.entries(MODE_HASH).map(([mode, hash]) => [hash, mode])));
  const MODE_META = Object.freeze({
    password: ['Password', '约束感知的精确均匀模型；生成后不再从字符串外观反推熵。', 'UNIFORM CONSTRAINED'],
    passphrase: ['Passphrase', '实际词池、随机大小写与逐间隔随机分隔符共同计入模型。', 'WORD MODEL'],
    pin: ['PIN', 'completion-count 加权采样；批量默认精确无放回。', 'DP + UNRANK'],
    token: ['Token', '随机位、编码和碰撞语义；固定前缀不增加随机性。', 'RANDOM BITS'],
    apiSecret: ['API Secret', '通用或无厂商含义的 Synthetic Demo 格式。', 'SYNTHETIC SECRET'],
    uuid: ['UUID', 'RFC 9562 标识符；不是秘密，也不展示密码破解时间。', 'IDENTIFIER'],
    hex: ['Hex', '随机字节的 Hex 表示；钱包私钥外观不代表有效私钥。', 'RANDOM BITS'],
    randomBytes: ['Random Bytes', '延迟编码、符号化搜索空间、SHA-256 与全局内存预算。', 'RAW BYTES'],
    mnemonic: ['BIP39 Mnemonic', 'ENT、CS、官方词表固定哈希与恢复兼容性边界。', 'WALLET RECOVERY'],
  });
  const LANGUAGE_LABELS = Object.freeze({
    english: 'English', czech: 'Čeština', french: 'Français', italian: 'Italiano', japanese: '日本語',
    korean: '한국어', portuguese: 'Português', 'simplified-chinese': '简体中文', spanish: 'Español',
    'traditional-chinese': '繁體中文',
  });
  const PATTERN_MESSAGES = Object.freeze({
    idle: '模式分析尚未 ready；精确生成器指标不受影响。',
    loading: 'Observed Pattern Estimate 正在独立 Worker 中分析。',
    ready: 'Observed Pattern Estimate 已完成。',
    error: '模式分析失败；精确生成器指标仍然有效。',
    degraded: '模式分析资源不可用；精确生成器指标仍然有效。',
  });

  const form = document.getElementById('generator-form');
  const configBody = document.getElementById('config-body');
  const resultContainer = document.getElementById('result-container');
  const historyContainer = document.getElementById('history-container');
  const resultToolbar = document.getElementById('result-toolbar');
  const generateButton = document.getElementById('generate-button');
  const cryptoChip = document.getElementById('crypto-status-chip');
  const coordinator = runtime.jobs.createGenerationCoordinator();
  const patterns = runtime.patternAnalysis.createPatternAnalysisCoordinator();
  const scriptPromises = new Map();
  const analyzerRequests = new Map();
  let analyzerWorker = null;
  let analyzerSequence = 0;
  let toastTimer = 0;
  let renderFrame = 0;
  let mnemonicRequestEpoch = 0;

  const state = {
    mode: HASH_MODE[location.hash.toLowerCase()] || 'password',
    results: [], revealed: new Set(), patterns: new Map(), historyEnabled: false,
    busy: false, activePasswordWorker: null, pinRiskIndex: null, analysisEpoch: 0,
    settings: loadSettings(),
    resources: {
      crypto: globalThis.crypto?.getRandomValues && globalThis.crypto?.subtle
        ? { status: 'ready', detail: 'Web Crypto 随机源' }
        : { status: 'error', detail: 'Web Crypto 不可用 · 已停止生成' },
      passphrase: { status: 'loading', detail: 'V2.0.1 Passphrase 词包' },
      pinRisk: { status: 'loading', detail: 'PIN 启发式风险库' },
      mnemonic: { status: 'loading', detail: 'BIP39 English' },
      zxcvbn: { status: 'loading', detail: 'Observed Pattern Worker' },
    },
  };
  const historyBudget = runtime.budgets.createHistoryBudget({
    maxEntries: 100,
    maxBytes: runtime.budgets.MAX_HISTORY_RAW_BYTES,
    estimateBytes: runtime.budgets.estimateResultRetentionBytes,
    clearEntry(result) {
      if (!state.results.some((current) => current.id === result.id)) {
        state.patterns.delete(result.id);
        state.revealed.delete(result.id);
        runtime.results.clearGenerationResult(result);
      }
    },
  });

  function loadSettings() {
    try {
      const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
      return parsed.schema === SETTINGS_SCHEMA && parsed.modes && typeof parsed.modes === 'object'
        ? parsed : { schema: SETTINGS_SCHEMA, modes: {} };
    } catch { return { schema: SETTINGS_SCHEMA, modes: {} }; }
  }

  function persistSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings)); } catch { /* 非秘密设置失败不影响生成。 */ }
  }

  function saveNonSecretSettings() {
    const allowed = new Set([
      'length', 'quantity', 'wordCount', 'capitalization', 'separator', 'pack', 'allowLeadingZero',
      'allowRepeated', 'limitSequential', 'blockWeak', 'uniqueWithinBatch', 'byteLength', 'encoding',
      'uppercase', 'includePrefix', 'version', 'hyphens', 'entropyBits', 'language', 'requireEach',
      'allowSpace', 'lowercase', 'uppercaseLetters', 'digits', 'symbols', 'symbolMin',
      'symbolMax', 'startsWith', 'endsWith', 'apiTemplate', 'hexScheme',
    ]);
    const data = new FormData(form);
    const values = {};
    for (const element of form.elements) {
      if (!element.name || !allowed.has(element.name)) continue;
      values[element.name] = element.type === 'checkbox' ? element.checked : data.get(element.name);
    }
    state.settings.modes[state.mode] = values;
    persistSettings();
  }

  function applySettings() {
    const values = state.settings.modes[state.mode];
    if (!values) return;
    for (const [name, value] of Object.entries(values)) {
      const element = form.elements.namedItem(name);
      if (!element || !element.tagName) continue;
      if (element.type === 'checkbox') element.checked = Boolean(value);
      else element.value = String(value);
    }
  }

  const numberField = (name, fallback) => {
    const value = Number(new FormData(form).get(name));
    return Number.isFinite(value) ? value : fallback;
  };
  const checkbox = (name, label, checked = false) => `<label class="check"><input name="${name}" type="checkbox"${checked ? ' checked' : ''}>${label}</label>`;
  const quantityMarkup = (max = 100) => `<div class="field"><label for="quantity">生成数量</label><input id="quantity" name="quantity" type="number" min="1" max="${max}" value="1"><small>结果默认遮蔽；PIN 批量默认唯一。</small></div>`;

  const CONFIG_TEMPLATES = Object.freeze({
    password: () => `<div class="field-grid">
      <div class="field"><label for="length">密码长度</label><input id="length" name="length" type="number" min="1" max="4096" value="20"><small>整批只编译一次概率模型并在一个 Worker 中采样。</small></div>${quantityMarkup()}
      <div class="field full"><span class="field-label">字符类型</span><div class="checks">${checkbox('lowercase', '小写字母', true)}${checkbox('uppercaseLetters', '大写字母', true)}${checkbox('digits', '数字', true)}${checkbox('symbols', '符号', true)}${checkbox('allowSpace', '内部空格')}</div></div>
      <div class="field full"><label for="symbolPool">符号字符池</label><input id="symbolPool" name="symbolPool" type="text" maxlength="64" value="!@#$%^&amp;*()-_=+[]{};:,.?" autocomplete="off" spellcheck="false"><small>最多 64 个 printable ASCII；拒绝控制字符、ZWJ 与规范化歧义。</small></div>
      <div class="field"><span class="field-label">符号占比</span><div class="range-pair"><div class="range-unit"><input name="symbolMin" type="number" min="0" max="100" value="10" aria-label="最小符号百分比"></div><div class="range-unit"><input name="symbolMax" type="number" min="0" max="100" value="35" aria-label="最大符号百分比"></div></div></div>
      <div class="field"><span class="field-label">高级约束</span><div class="checks">${checkbox('requireEach', '每类至少一个', true)}${checkbox('allowRepeated', '允许重复', true)}</div></div>
      <div class="field"><label for="startsWith">首字符</label><select id="startsWith" name="startsWith"><option value="any">任意启用类别</option><option value="letter">字母</option><option value="digit">数字</option><option value="symbol">符号</option></select></div>
      <div class="field"><label for="endsWith">尾字符</label><select id="endsWith" name="endsWith"><option value="any">任意启用类别</option><option value="letter">字母</option><option value="digit">数字</option><option value="symbol">符号</option></select></div>
    </div>`,
    passphrase: () => `<div class="field-grid">
      <div class="field"><label for="wordCount">单词数量</label><input id="wordCount" name="wordCount" type="number" min="1" max="100" value="6"></div>${quantityMarkup()}
      <div class="field full"><label for="pack">V2.0.1 独立词包</label><select id="pack" name="pack"></select><small>结果快照记录源词包 SHA-256 与有效词池 SHA-256。</small></div>
      <div class="field"><label for="capitalization">大小写</label><select id="capitalization" name="capitalization"><option value="lowercase">全部小写</option><option value="first-word">首词首字母大写</option><option value="every-word">每词首字母大写</option><option value="random-uppercase">随机一个词全大写</option></select></div>
      <div class="field"><label for="separator">分隔符</label><select id="separator" name="separator"><option value="hyphen">固定连字符 -</option><option value="underscore">固定下划线 _</option><option value="period">固定句点 .</option><option value="space">固定空格</option><option value="random-digit">每个间隔随机数字</option><option value="random-symbol">每个间隔随机符号</option></select></div>
      <div class="field full"><label for="separatorSymbols">随机符号候选</label><input id="separatorSymbols" name="separatorSymbols" type="text" maxlength="32" value="!@#$%&amp;*+?" autocomplete="off" spellcheck="false"></div>
    </div>`,
    pin: () => `<div class="field-grid">
      <div class="field"><label for="length">PIN 长度</label><select id="length" name="length"><option>4</option><option selected>6</option><option>8</option><option>12</option><option>16</option><option>24</option><option>32</option></select></div>${quantityMarkup()}
      <div class="field full"><span class="field-label">PIN 规则</span><div class="checks">${checkbox('allowLeadingZero', '允许前导零', true)}${checkbox('allowRepeated', '允许重复数字', true)}${checkbox('limitSequential', '限制连续数字', true)}${checkbox('blockWeak', '启发式常见 PIN 排除', true)}${checkbox('uniqueWithinBatch', '批内唯一', true)}</div><small>4/6 位使用排名阈值；8 位以上主要使用规则过滤。公开过滤策略与均匀生成熵分开披露。</small></div>
    </div>`,
    token: () => `<div class="field-grid"><div class="field"><label for="byteLength">随机字节数</label><input id="byteLength" name="byteLength" type="number" min="1" max="4096" value="32"></div>${quantityMarkup()}<div class="field"><label for="encoding">编码</label><select id="encoding" name="encoding"><option value="base64url-nopad">Base64URL 无 padding</option><option value="base64url">Base64URL</option><option value="base64">Base64</option><option value="hex">Hex</option></select></div><div class="field"><label for="prefix">固定前缀</label><input id="prefix" name="prefix" type="text" maxlength="64" value="tok_" autocomplete="off" spellcheck="false"><small>前缀不增加随机位数。</small></div></div>`,
    apiSecret: () => `<div class="field-grid"><div class="field"><label for="byteLength">Secret 随机字节</label><input id="byteLength" name="byteLength" type="number" min="1" max="4096" value="32"></div>${quantityMarkup()}<div class="field"><label for="apiTemplate">模板</label><select id="apiTemplate" name="apiTemplate"><option value="generic">Generic</option><option value="synthetic-demo">Synthetic Demo · demo_test_v1_</option></select></div><div class="field"><label for="encoding">编码</label><select id="encoding" name="encoding"><option value="base64url-nopad">Base64URL 无 padding</option><option value="hex">Hex</option><option value="base64">Base64</option></select></div><div class="field api-generic"><label for="prefix">固定前缀</label><input id="prefix" name="prefix" type="text" maxlength="64" value="api_" autocomplete="off"></div><div class="field api-generic"><label for="environment">环境字段</label><input id="environment" name="environment" type="text" maxlength="32" value="test" autocomplete="off"></div><div class="field api-generic"><label for="apiVersion">版本字段</label><input id="apiVersion" name="apiVersion" type="text" maxlength="32" value="v1" autocomplete="off"></div><div class="field full callout">Synthetic Demo 是无厂商含义的合成凭据，不由 Stripe 或任何服务商签发，也不能用于真实服务。</div></div>`,
    uuid: () => `<div class="field-grid"><div class="field"><label for="version">UUID 版本</label><select id="version" name="version"><option value="4">UUID v4 · 122 random bits</option><option value="7">UUID v7 · 74 random bits + 时间戳</option></select></div>${quantityMarkup()}<div class="field full callout warning">Identifier, not a secret。RFC 9562 不建议假定 UUID 难以猜测，也不应把 UUID 用作访问凭据。</div><div class="field full"><div class="checks">${checkbox('hyphens', '保留连字符', true)}${checkbox('uppercase', '大写')}</div></div></div>`,
    hex: () => `<div class="field-grid"><div class="field"><label for="byteLength">随机字节数</label><input id="byteLength" name="byteLength" type="number" min="1" max="4096" value="32"></div>${quantityMarkup()}<div class="field full"><div class="checks">${checkbox('uppercase', '大写 Hex')}${checkbox('includePrefix', '添加 0x 前缀')}</div></div><div class="field full"><label for="hexScheme">用途标记</label><select id="hexScheme" name="hexScheme"><option value="random-hex">通用随机 Hex</option><option value="wallet-private-key-appearance">钱包私钥外观（仅测试）</option></select><small>外观不代表曲线范围、链格式或可安全用于真实资产。</small></div></div>`,
    randomBytes: () => `<div class="field-grid"><div class="field"><label for="byteLength">原始字节数</label><input id="byteLength" name="byteLength" type="number" min="1" max="1048576" value="64"><small>≥64 KiB 自动要求 quantity=1；完整编码仅在复制时生成。</small></div>${quantityMarkup(10)}<div class="field"><label for="encoding">预览 / 复制编码</label><select id="encoding" name="encoding"><option value="hex">Hex</option><option value="base64">Base64</option><option value="base64url">Base64URL</option><option value="base64url-nopad">Base64URL 无 padding</option></select></div><div class="field"><div class="checks">${checkbox('uppercase', '大写 Hex')}</div></div></div>`,
    mnemonic: () => `<div class="field-grid"><div class="field"><label for="entropyBits">ENT / 单词数</label><select id="entropyBits" name="entropyBits"><option value="128">128 bits · 12 words</option><option value="160">160 bits · 15 words</option><option value="192">192 bits · 18 words</option><option value="224">224 bits · 21 words</option><option value="256">256 bits · 24 words</option></select></div>${quantityMarkup(20)}<div class="field full"><label for="language">BIP39 官方词表</label><select id="language" name="language">${Object.entries(LANGUAGE_LABELS).map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select></div><div id="mnemonic-warning" class="field full callout warning">高价值真实资产优先使用硬件钱包或经过验证的离线构建。非 English 词表必须先验证目标钱包恢复兼容性。</div><div class="field full"><div class="checks">${checkbox('mnemonicAck', '我理解浏览器、扩展、剪贴板与钱包兼容性不在数学模型保证范围内')}</div><small>此确认不持久化；每次进入 BIP39 模式都必须重新确认。</small></div></div>`,
  });

  function showToast(message, tone = 'info') {
    const toast = document.getElementById('toast');
    toast.textContent = message; toast.dataset.tone = tone; toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; toast.textContent = ''; }, 4800);
  }

  function actionButton(label, handler, extraClass = '') {
    const button = document.createElement('button');
    button.type = 'button'; button.className = `button button-small ${extraClass}`.trim();
    button.textContent = label; button.addEventListener('click', handler); return button;
  }

  function setResource(name, status, detail) {
    state.resources[name] = { status, detail }; renderResources(); updateAvailability();
  }

  function renderResources() {
    const strip = document.getElementById('resource-strip');
    strip.replaceChildren(...Object.entries(state.resources).map(([name, resource]) => {
      const item = document.createElement('span'); item.className = 'resource-item'; item.dataset.state = resource.status;
      const dot = document.createElement('span'); dot.className = 'resource-dot';
      const text = document.createElement('span'); text.textContent = `${resource.detail} · ${resource.status}`;
      item.append(dot, text);
      if (['error', 'degraded'].includes(resource.status)) item.append(actionButton('重试', () => retryResource(name)));
      return item;
    }));
    const cryptoState = state.resources.crypto.status;
    cryptoChip.dataset.state = cryptoState;
    cryptoChip.textContent = cryptoState === 'ready' ? 'Web Crypto / 本地生成' : 'Web Crypto / 已停止';
  }

  function updateAvailability() {
    const blockWeakNeedsAsset = state.mode === 'pin' && form.elements.blockWeak?.checked && state.resources.pinRisk.status !== 'ready';
    const mnemonicNeedsAcknowledgement = state.mode === 'mnemonic' && !form.elements.mnemonicAck?.checked;
    const unavailable = state.busy || state.resources.crypto.status !== 'ready'
      || (state.mode === 'passphrase' && state.resources.passphrase.status !== 'ready')
      || (state.mode === 'mnemonic' && state.resources.mnemonic.status !== 'ready')
      || blockWeakNeedsAsset || mnemonicNeedsAcknowledgement;
    generateButton.disabled = unavailable;
    generateButton.textContent = state.busy ? '生成中（切换类型可取消）…' : '生成';
  }

  function loadLocalScriptOnce(src, check) {
    if (check()) return Promise.resolve();
    if (scriptPromises.has(src)) return scriptPromises.get(src);
    const promise = new Promise((resolve, reject) => {
      const script = document.createElement('script'); script.src = src;
      script.onload = () => check() ? resolve() : reject(new Error(`资源未注册：${src}`));
      script.onerror = () => reject(new Error(`资源加载失败：${src}`)); document.head.appendChild(script);
    }).catch((error) => { scriptPromises.delete(src); throw error; });
    scriptPromises.set(src, promise); return promise;
  }

  function renderConfig() {
    const [title, description, badge] = MODE_META[state.mode];
    document.getElementById('config-title').textContent = title;
    document.getElementById('config-description').textContent = description;
    document.getElementById('model-badge').textContent = badge;
    configBody.innerHTML = CONFIG_TEMPLATES[state.mode]();
    if (state.mode === 'passphrase') populatePassphrasePacks();
    applySettings();
    if (state.mode === 'apiSecret') syncApiTemplate();
    if (state.mode === 'mnemonic') { updateMnemonicWarning(); ensureMnemonicLanguage(form.elements.language.value); }
    updateAvailability();
  }

  function populatePassphrasePacks() {
    const select = form.elements.pack;
    const packs = globalThis.PasswordGeneratorV201PassphraseAssets?.packs || {};
    const options = Object.values(packs).map((pack) => {
      const option = document.createElement('option'); option.value = pack.id;
      option.textContent = `${pack.label} · ${pack.words.length.toLocaleString('zh-CN')} 词`;
      option.selected = pack.id === 'memorable-long'; return option;
    });
    select.replaceChildren(...options);
  }

  function syncApiTemplate() {
    const synthetic = form.elements.apiTemplate?.value === 'synthetic-demo';
    configBody.querySelectorAll('.api-generic input').forEach((input) => { input.disabled = synthetic; });
  }

  function updateMnemonicWarning() {
    const language = form.elements.language?.value || 'english';
    const notice = runtime.bip39.bip39CompatibilityNotice(language);
    const warning = document.getElementById('mnemonic-warning');
    if (warning) warning.textContent = [notice.compatibilityWarning, notice.assetSafetyWarning].filter(Boolean).join(' ');
  }

  function modeFromLocation() { return HASH_MODE[location.hash.toLowerCase()] || 'password'; }

  function cancelActiveGeneration(reason) {
    coordinator.cancel(reason);
    const active = state.activePasswordWorker;
    if (active) {
      active.worker.terminate();
      active.reject(Object.assign(new Error(`生成任务已取消：${reason}`), { name: 'GenerationCancelledError' }));
      state.activePasswordWorker = null;
    }
    state.busy = false; updateAvailability();
  }

  function releaseCurrentResults() {
    const retained = new Set(historyBudget.entries.map((result) => result.id));
    for (const result of state.results) if (!retained.has(result.id)) runtime.results.clearGenerationResult(result);
    state.results = []; state.revealed.clear(); state.analysisEpoch += 1; renderResults();
  }

  function setMode(mode, replace = false) {
    const normalized = MODE_HASH[mode] ? mode : 'password';
    if (normalized !== state.mode) { cancelActiveGeneration('切换生成器类型'); releaseCurrentResults(); }
    state.mode = normalized;
    const hash = MODE_HASH[normalized];
    if (location.hash !== hash) history[replace ? 'replaceState' : 'pushState'](null, '', hash);
    document.querySelectorAll('.mode-link').forEach((button) => button.setAttribute('aria-current', button.dataset.mode === normalized ? 'page' : 'false'));
    renderConfig();
  }

  async function initializePassphrase() {
    setResource('passphrase', 'loading', 'V2.0.1 Passphrase 词包');
    try {
      await loadLocalScriptOnce(`./assets/v2.01/${ASSETS.passphrase}`, () => Boolean(globalThis.PasswordGeneratorV201PassphraseAssets?.ready));
      await globalThis.PasswordGeneratorV201PassphraseAssets.ready;
      setResource('passphrase', 'ready', 'V2.0.1 Passphrase 词包');
      if (state.mode === 'passphrase') renderConfig();
    } catch (error) { setResource('passphrase', 'error', 'V2.0.1 Passphrase 词包'); showToast(error.message, 'error'); }
  }

  async function initializePinRisk() {
    setResource('pinRisk', 'loading', 'PIN 启发式风险库');
    try {
      await loadLocalScriptOnce(`./assets/v2.01/${ASSETS.pinRisk}`, () => Boolean(globalThis.PasswordGeneratorV201Assets?.pinRisk));
      state.pinRiskIndex = runtime.createPinRiskIndex(globalThis.PasswordGeneratorV201Assets.pinRisk);
      setResource('pinRisk', 'ready', 'PIN 启发式风险库 v1');
    } catch (error) { state.pinRiskIndex = null; setResource('pinRisk', 'error', 'PIN 启发式风险库'); showToast(error.message, 'error'); }
  }

  async function ensureMnemonicLanguage(language) {
    const requestEpoch = ++mnemonicRequestEpoch;
    const label = LANGUAGE_LABELS[language] || language;
    if (runtime.bip39.getBip39WordlistStatus(language).state === 'ready') {
      if (requestEpoch === mnemonicRequestEpoch) setResource('mnemonic', 'ready', `BIP39 ${label}`);
      return;
    }
    setResource('mnemonic', 'loading', `BIP39 ${label}`);
    try {
      const filename = ASSETS.bip39[language];
      if (!filename) throw new Error(`未知 BIP39 词表：${language}`);
      await loadLocalScriptOnce(`./assets/v2.01/${filename}`, () => Boolean(globalThis.PasswordGeneratorV201Bip39Assets?.[language]?.ready));
      await globalThis.PasswordGeneratorV201Bip39Assets[language].ready;
      if (requestEpoch !== mnemonicRequestEpoch || form.elements.language?.value !== language) return;
      setResource('mnemonic', 'ready', `BIP39 ${label}`);
    } catch (error) {
      if (requestEpoch === mnemonicRequestEpoch) setResource('mnemonic', 'error', `BIP39 ${label}`);
      showToast(error.message, 'error');
    }
  }

  function createAnalyzerWorker() {
    if (!globalThis.Worker) throw new Error('浏览器不支持分析 Worker。');
    const worker = new Worker(`./assets/v2.01/${ASSETS.zxcvbnWorker}`);
    worker.onmessage = ({ data }) => {
      const pending = analyzerRequests.get(data?.requestId);
      if (!pending) return;
      analyzerRequests.delete(data.requestId);
      if (data.ok) pending.resolve(data.result); else pending.reject(new Error(data.error || '模式分析失败'));
    };
    worker.onerror = () => {
      for (const pending of analyzerRequests.values()) pending.reject(new Error('模式分析 Worker 失效'));
      analyzerRequests.clear(); worker.terminate(); analyzerWorker = null;
      setResource('zxcvbn', 'degraded', 'Observed Pattern Worker');
    };
    return worker;
  }

  async function initializeAnalyzer() {
    setResource('zxcvbn', 'loading', 'Observed Pattern Worker');
    try {
      analyzerWorker = analyzerWorker || createAnalyzerWorker();
      patterns.setAnalyzer((value) => new Promise((resolve, reject) => {
        const requestId = `analysis:${++analyzerSequence}`;
        analyzerRequests.set(requestId, { resolve, reject });
        analyzerWorker.postMessage({ requestId, epoch: state.analysisEpoch, value });
      }));
      setResource('zxcvbn', 'ready', 'Observed Pattern Worker');
      await analyzeLiveResults(true);
    } catch (error) { setResource('zxcvbn', 'degraded', 'Observed Pattern Worker'); showToast(error.message, 'error'); }
  }

  async function retryResource(name) {
    if (name === 'passphrase') return initializePassphrase();
    if (name === 'pinRisk') return initializePinRisk();
    if (name === 'zxcvbn') return initializeAnalyzer();
    if (name === 'mnemonic') return ensureMnemonicLanguage(form.elements.language?.value || 'english');
    if (name === 'crypto') {
      const ready = Boolean(globalThis.crypto?.getRandomValues && globalThis.crypto?.subtle);
      setResource('crypto', ready ? 'ready' : 'error', ready ? 'Web Crypto 随机源' : 'Web Crypto 不可用 · 已停止生成');
    }
  }

  async function readConfig(mode) {
    const data = new FormData(form);
    const quantity = numberField('quantity', 1);
    const max = mode === 'randomBytes' ? 10 : mode === 'mnemonic' ? 20 : 100;
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > max) throw new RangeError('生成数量超出当前类型允许范围。');
    let config;
    if (mode === 'password') {
      const symbolPool = runtime.inputValidation.normalizePrintableAscii(data.get('symbolPool'), '符号池', 64);
      config = { length: numberField('length', 20), lowercase: data.has('lowercase'), uppercase: data.has('uppercaseLetters'), digits: data.has('digits'), symbols: data.has('symbols'), symbolPool, allowSpace: data.has('allowSpace'), requireEach: data.has('requireEach'), allowRepeated: data.has('allowRepeated'), symbolRatioRange: [numberField('symbolMin', 0), numberField('symbolMax', 100)], startsWith: data.get('startsWith'), endsWith: data.get('endsWith') };
    } else if (mode === 'passphrase') {
      const packId = data.get('pack'); const pack = runtime.passphraseAssets.getPassphrasePack(packId);
      const wordCount = numberField('wordCount', 6); const capitalization = data.get('capitalization');
      const separator = data.get('separator');
      const separatorSymbols = runtime.inputValidation.normalizePrintableAscii(data.get('separatorSymbols'), '分隔符候选', 32);
      const words = runtime.getCompatiblePassphraseWords({ wordCount, words: pack.words, capitalization, separator, separatorSymbols });
      const provenance = await runtime.passphraseAssets.createPassphraseProvenance(packId, words);
      config = { wordCount, words, wordPackId: packId, capitalization, separator, separatorSymbols, sourceWordPoolSize: pack.words.length, provenance };
    } else if (mode === 'pin') {
      config = { length: numberField('length', 6), allowLeadingZero: data.has('allowLeadingZero'), allowRepeated: data.has('allowRepeated'), limitSequential: data.has('limitSequential'), blockWeak: data.has('blockWeak'), uniqueWithinBatch: data.has('uniqueWithinBatch') };
    } else if (mode === 'token') {
      config = { byteLength: numberField('byteLength', 32), encoding: data.get('encoding'), prefix: runtime.inputValidation.normalizeOptionalPrintableAscii(data.get('prefix'), 'Token 前缀', 64) };
    } else if (mode === 'apiSecret') {
      config = { byteLength: numberField('byteLength', 32), encoding: data.get('encoding'), template: data.get('apiTemplate'), prefix: runtime.inputValidation.normalizeOptionalPrintableAscii(data.get('prefix'), 'API 前缀', 64), environment: runtime.inputValidation.normalizeOptionalPrintableAscii(data.get('environment'), '环境字段', 32), version: runtime.inputValidation.normalizeOptionalPrintableAscii(data.get('apiVersion'), '版本字段', 32) };
    } else if (mode === 'uuid') {
      config = { version: numberField('version', 4), hyphens: data.has('hyphens'), uppercase: data.has('uppercase') };
    } else if (mode === 'hex') {
      config = { byteLength: numberField('byteLength', 32), uppercase: data.has('uppercase'), prefix: data.has('includePrefix'), schemeId: data.get('hexScheme') };
    } else if (mode === 'randomBytes') {
      config = { byteLength: numberField('byteLength', 64), encoding: data.get('encoding'), uppercase: data.has('uppercase') };
    } else if (mode === 'mnemonic') {
      if (!data.has('mnemonicAck')) throw new Error('请先确认 BIP39 浏览器与钱包兼容性边界。');
      config = { entropyBits: numberField('entropyBits', 128), language: data.get('language') };
      if (runtime.bip39.getBip39WordlistStatus(config.language).state !== 'ready') throw new Error('所选 BIP39 词表尚未 ready。');
    } else throw new RangeError('未知生成器类型。');
    runtime.budgets.assertBatchBudget({ mode, byteLength: ['token', 'apiSecret', 'hex', 'randomBytes'].includes(mode) ? config.byteLength : 0, quantity });
    return { quantity, config };
  }

  function deserializeWorkerResult(serialized) {
    const { id: _id, bytes, ...result } = serialized;
    return runtime.results.createGenerationResult({
      ...result,
      ...(bytes instanceof Uint8Array ? { bytes } : {}),
    });
  }

  function compilePasswordWorker(config, job) {
    if (!globalThis.Worker) return runtime.compileGenerator('password', config, { cryptoLike: globalThis.crypto });
    const worker = new Worker(`./assets/v2.01/${ASSETS.passwordWorker}`);
    let completed = false;
    return Promise.resolve({
      mode: 'password', model: Object.freeze({ jobId: job.id }),
      sampleBatch(quantity) {
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => { worker.terminate(); state.activePasswordWorker = null; reject(new Error('密码概率模型计算超时。')); }, 180000);
          state.activePasswordWorker = { worker, reject };
          worker.onmessage = ({ data }) => {
            clearTimeout(timer); completed = true; state.activePasswordWorker = null; worker.terminate();
            if (!data?.ok || data.jobId !== job.id) { reject(new Error(data?.error || 'Worker 回包无效。')); return; }
            try { resolve(data.results.map(deserializeWorkerResult)); } catch (error) { reject(error); }
          };
          worker.onerror = () => { clearTimeout(timer); state.activePasswordWorker = null; worker.terminate(); reject(new Error('密码 Worker 启动失败。')); };
          worker.postMessage({ jobId: job.id, config, quantity });
        });
      },
      dispose() { if (!completed) worker.terminate(); },
    });
  }

  async function compileForJob(mode, config, job) {
    if (mode === 'password') return compilePasswordWorker(config, job);
    return runtime.compileGenerator(mode, config, { cryptoLike: globalThis.crypto, pinRiskIndex: config.blockWeak ? state.pinRiskIndex : undefined });
  }

  async function generateResults(event) {
    event?.preventDefault();
    if (state.resources.crypto.status !== 'ready') return;
    saveNonSecretSettings();
    let job = null;
    let next = null;
    let accepted = false;
    try {
      const mode = state.mode; const { quantity, config } = await readConfig(mode);
      if (state.mode !== mode) throw Object.assign(new Error('配置读取期间已切换生成器。'), { name: 'GenerationCancelledError' });
      job = coordinator.begin(mode, config, quantity); state.busy = true; updateAvailability();
      next = await runtime.batch.generateAtomicBatch({ job, compile: compileForJob, isCurrent: coordinator.isCurrent, clearResult: runtime.results.clearGenerationResult });
      if (!coordinator.isCurrent(job) || state.mode !== job.mode) {
        for (const result of next) runtime.results.clearGenerationResult(result);
        next = null;
        return;
      }
      const previous = state.results;
      state.results = [...next]; state.revealed.clear(); state.analysisEpoch += 1;
      accepted = true;
      for (const result of next) {
        if (['password', 'passphrase'].includes(result.type)) {
          state.patterns.set(result.id, {
            status: state.resources.zxcvbn.status === 'ready' ? 'loading' : state.resources.zxcvbn.status,
            guessBits: null,
            sequences: [],
          });
        }
      }
      if (state.historyEnabled) historyBudget.add(next);
      const retained = new Set(historyBudget.entries.map((result) => result.id));
      for (const old of previous) {
        if (!retained.has(old.id)) {
          state.patterns.delete(old.id);
          runtime.results.clearGenerationResult(old);
        }
      }
      renderResults(); renderHistory(); analyzeLiveResults(false);
    } catch (error) {
      if (next && !accepted) for (const result of next) runtime.results.clearGenerationResult(result);
      if (error?.name !== 'GenerationCancelledError') showToast(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      if (job && coordinator.isCurrent(job)) coordinator.cancel('completed');
      state.busy = false; updateAvailability();
    }
  }

  function isLiveResult(id, epoch) {
    return Number.isSafeInteger(epoch) && epoch <= state.analysisEpoch
      && [...state.results, ...historyBudget.entries].some((result) => result.id === id);
  }

  function scheduleRender() {
    if (renderFrame) return;
    renderFrame = requestAnimationFrame(() => { renderFrame = 0; renderResults(); renderHistory(); });
  }

  async function analyzeLiveResults(reanalyze) {
    const epoch = state.analysisEpoch;
    const options = { current: state.results, history: historyBudget.entries, epoch, isLive: isLiveResult, onUpdate(id, analysis) { state.patterns.set(id, analysis); scheduleRender(); } };
    try { if (reanalyze) await patterns.reanalyzeLive(options); else await patterns.analyze(state.results, options); } catch { /* 分析失败不影响生成器指标。 */ }
  }

  function resultPlaintext(result) { return result.type === 'random-bytes' ? runtime.randomBytes.materializeRandomBytes(result) : result.value; }

  function estimatePlaintextCharacters(result) {
    if (result.type !== 'random-bytes') return result.value.length;
    const length = result.bytes.byteLength; const encoding = result.configSnapshot.encoding;
    if (encoding === 'hex') return length * 2;
    const padded = Math.ceil(length / 3) * 4;
    return encoding === 'base64url-nopad' ? padded - ((3 - (length % 3 || 3)) % 3) : padded;
  }

  async function copyText(text) {
    if (navigator.clipboard?.writeText) { try { await navigator.clipboard.writeText(text); return true; } catch { /* 进入受控 fallback。 */ } }
    const textarea = document.createElement('textarea');
    textarea.dataset.v201ClipboardFallback = 'true'; textarea.setAttribute('data-v201-clipboard-fallback', 'true');
    textarea.setAttribute('aria-hidden', 'true'); textarea.setAttribute('readonly', ''); textarea.className = 'clipboard-fallback';
    try { textarea.value = text; document.body.appendChild(textarea); textarea.select(); return document.execCommand('copy'); }
    finally { textarea.value = ''; textarea.remove(); }
  }

  async function copyResults(results) {
    const count = results.reduce((total, result) => total + estimatePlaintextCharacters(result), Math.max(0, results.length - 1));
    runtime.budgets.assertClipboardBudget(count);
    if (count > LARGE_COPY_CONFIRM_CHARACTERS && !globalThis.confirm('将向系统剪贴板写入超过 1 MiB 的秘密文本。确认继续？')) return;
    const text = results.map(resultPlaintext).join('\n');
    if (!await copyText(text)) throw new Error('浏览器拒绝复制请求。');
    showToast('已显式写入系统剪贴板；请留意剪贴板历史与跨设备同步。');
  }

  function downloadResult(result) {
    const download = runtime.createBinaryDownload(result.bytes, { mimeType: 'application/octet-stream' });
    const anchor = document.createElement('a'); anchor.href = download.url; anchor.download = `random-bytes-${result.id}.bin`; anchor.hidden = true;
    document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(download.revoke, 0);
  }

  function metric(label, value) {
    const node = document.createElement('div'); node.className = 'metric';
    const key = document.createElement('span'); key.className = 'metric-label'; key.textContent = label;
    const data = document.createElement('span'); data.className = 'metric-value'; data.textContent = value;
    node.append(key, data); return node;
  }

  function formatBits(value) { return `${Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 3 })} bits`; }
  function formatAttackTime(bits, rate) {
    if (!Number.isFinite(rate) || rate <= 0) return '取决于设备重试/锁定策略';
    const log10Seconds = bits * Math.LOG10E * Math.LN2 - Math.log10(rate);
    if (log10Seconds < 0) return '< 1 秒';
    if (log10Seconds < 2) return `约 ${Math.max(1, Math.round(10 ** log10Seconds)).toLocaleString('zh-CN')} 秒`;
    const log10Years = log10Seconds - Math.log10(31_557_600);
    if (log10Years < 0) return `约 10^${log10Seconds.toFixed(2)} 秒`;
    return `约 10^${log10Years.toFixed(2)} 年`;
  }

  function appendExactMetrics(container, assessment) {
    const exact = assessment.exactGenerator;
    container.append(metric('Generator Min-Entropy', formatBits(exact.generatorMinEntropyBits)), metric('Generator Shannon Entropy', formatBits(exact.generatorShannonEntropyBits)), metric('Generator Search Space', exact.searchSpaceLabel), metric('Expected Guess Count', exact.expectedRankLabel));
  }

  function profileContent(result, assessment) {
    const fragment = document.createDocumentFragment(); const metrics = document.createElement('div'); metrics.className = 'metric-grid';
    appendExactMetrics(metrics, assessment);
    const profile = result.generationModel.presentationProfile;
    if (['token', 'api-secret', 'hex'].includes(profile)) {
      const prefixLength = typeof result.generationModel.prefix === 'string' ? result.generationModel.prefix.length : 0;
      metrics.append(
        metric('Nominal CSPRNG Output Bits', formatBits(assessment.machineSecret.nominalCsprngOutputBits)),
        metric('编码 / 固定前缀', `${result.generationModel.encoding || '—'} / ${prefixLength ? `有（${prefixLength} characters）` : '无'}`),
      );
    } else if (profile === 'random-bytes') {
      metrics.append(metric('原始字节数', result.bytes.byteLength.toLocaleString('zh-CN')), metric('Nominal CSPRNG Output Bits', formatBits(assessment.randomBytes.nominalCsprngOutputBits)), metric('SHA-256', result.sha256));
    } else if (profile === 'uuid') {
      metrics.append(metric('用途', assessment.identifierNotice), metric('Version / Variant', `${result.generationModel.version} / ${result.generationModel.variant}`), metric('Random Bits', formatBits(result.generationModel.nominalCsprngOutputBits)), metric('v7 Timestamp', result.generationModel.timestampUnixMs == null ? '不适用' : new Date(result.generationModel.timestampUnixMs).toISOString()));
    } else if (profile === 'bip39') {
      metrics.append(metric('ENT / CS', `${result.generationModel.entropyBits} / ${result.generationModel.checksumBits} bits`), metric('Word Count / Language', `${result.generationModel.wordCount} / ${result.generationModel.language}`), metric('Checksum', result.checksumValid ? 'valid' : 'INVALID'), metric('Wordlist SHA-256', result.generationModel.wordlistSha256));
    } else if (profile === 'pin') {
      const policy = result.generationModel.commonPinPolicy;
      metrics.append(metric('批内唯一', result.configSnapshot.uniqueWithinBatch ? '是（无放回）' : '否（独立有放回）'), metric('独立批次碰撞概率', `${((result.generationModel.independentBatchCollisionProbability || 0) * 100).toPrecision(4)}%`), metric('Common-PIN Policy', policy?.name || '未启用'), metric('过滤数量', policy ? `${policy.blockedCount.toLocaleString('zh-CN')} / ${policy.baseSearchSpace.toLocaleString('zh-CN')}` : '0'));
    }
    fragment.append(metrics);
    if (['password', 'passphrase'].includes(profile)) {
      const observed = assessment.observedPattern; const observedBox = document.createElement('section'); observedBox.className = 'assessment-layer';
      const heading = document.createElement('h4'); heading.textContent = 'Observed Pattern Estimate';
      const detail = document.createElement('p');
      detail.textContent = observed.status === 'ready' ? `启发式猜测强度：${observed.guessBits == null ? '—' : `约 2^${observed.guessBits.toFixed(2)}`}；模式：${observed.sequences.join('、') || '未发现显著模式'}。` : PATTERN_MESSAGES[observed.status] || PATTERN_MESSAGES.idle;
      observedBox.append(heading, detail); fragment.append(observedBox);
    }
    if (assessment.attackScenarios.length) {
      const layer = document.createElement('section'); layer.className = 'assessment-layer';
      const heading = document.createElement('h4'); heading.textContent = 'Attack Scenario Estimate'; layer.append(heading);
      const list = document.createElement('ul'); list.className = 'attack-list';
      for (const scenario of assessment.attackScenarios) {
        const item = document.createElement('li'); const label = document.createElement('span'); label.textContent = `${scenario.label} · ${scenario.assumption}`;
        const value = document.createElement('strong'); value.textContent = formatAttackTime(assessment.exactGenerator.expectedRank.bits, scenario.guessesPerSecond);
        item.append(label, value); list.append(item);
      }
      layer.append(list); fragment.append(layer);
    }
    const note = document.createElement('p'); note.className = 'pattern-state';
    if (profile === 'uuid') note.textContent = 'Identifier, not a secret。UUID 不应作为密码、API Secret 或 capability。v7 会暴露毫秒级创建时间。';
    else if (profile === 'bip39') note.textContent = `${runtime.bip39.bip39CompatibilityNotice(result.generationModel.language).compatibilityWarning || ''} ${assessment.bip39Notice}`.trim();
    else if (['token', 'api-secret', 'hex'].includes(profile)) note.textContent = assessment.machineSecret.collisionSemantics;
    else if (profile === 'random-bytes') note.textContent = '位数是 Nominal CSPRNG Output Bits：假设浏览器 Web Crypto 未遭破坏且输出可建模为均匀 CSPRNG；不是可测量的信息论熵下限。';
    else note.textContent = assessment.disclaimer;
    fragment.append(note); return fragment;
  }

  function safeJson(value) { return JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item, 2); }

  const DETAIL_REDACTED_KEYS = new Set([
    'value', 'words', 'symbolPool', 'separatorSymbols', 'prefix', 'environment', 'version',
  ]);

  function redactModelDetails(value, key = '') {
    if (DETAIL_REDACTED_KEYS.has(key)) {
      const size = Array.isArray(value) ? value.length : typeof value === 'string' ? [...value].length : 0;
      return `[redacted${size ? ` · ${size} items/characters` : ''}]`;
    }
    if (Array.isArray(value)) return value.map((item) => redactModelDetails(item));
    if (!value || typeof value !== 'object' || typeof value === 'bigint') return value;
    return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, redactModelDetails(child, childKey)]));
  }

  function buildResultCard(result, index, context = 'current') {
    const card = document.createElement('article'); card.className = 'result-card'; card.dataset.resultId = result.id;
    const head = document.createElement('div'); head.className = 'result-card-head';
    const type = document.createElement('span'); type.className = 'result-type'; type.textContent = result.type;
    const number = document.createElement('span'); number.className = 'result-number'; number.textContent = `${context === 'history' ? 'H' : '#'}${index + 1}`; head.append(type, number);
    const box = document.createElement('div'); box.className = 'secret-box'; const value = document.createElement('div'); value.className = 'secret-value';
    const revealed = state.revealed.has(result.id); value.dataset.secretState = revealed ? 'revealed' : 'masked';
    if (!revealed) value.textContent = MASK;
    else if (result.type === 'random-bytes') { value.textContent = result.preview; value.classList.add('secret-summary'); }
    else if (result.value.length <= runtime.budgets.MAX_RENDER_CHARACTERS) value.textContent = result.value;
    else { value.textContent = '明文超过 DOM 渲染预算；请显式复制或下载。'; value.classList.add('secret-summary'); }
    box.append(value);
    const actions = document.createElement('div'); actions.className = 'result-actions';
    actions.append(actionButton(revealed ? '隐藏明文' : '显示明文', () => toggleReveal(result.id)), actionButton('复制', () => copyResults([result]).catch((error) => showToast(error.message, 'error'))));
    if (result.type === 'random-bytes') actions.append(actionButton('下载原始字节', () => downloadResult(result), 'button-signal'));
    actions.append(actionButton('删除', () => deleteResult(result.id), 'button-danger'));
    const assessment = runtime.assessment.createSecurityAssessment({ generationModel: result.generationModel, patternAnalysis: state.patterns.get(result.id) || { status: state.resources.zxcvbn.status, guessBits: null, sequences: [] } });
    const details = document.createElement('details'); details.className = 'model-details';
    const summary = document.createElement('summary'); summary.textContent = 'Generation Model Details';
    const pre = document.createElement('pre');
    pre.textContent = safeJson(redactModelDetails({
      schemaVersion: result.schemaVersion,
      schemeId: result.schemeId,
      configSnapshot: result.configSnapshot,
      generationModel: result.generationModel,
    }));
    details.append(summary, pre); card.append(head, box, actions, profileContent(result, assessment), details); return card;
  }

  function renderResults() {
    resultToolbar.hidden = state.results.length === 0;
    if (!state.results.length) {
      const empty = document.createElement('div'); empty.className = 'empty-state'; const inner = document.createElement('div');
      const mark = document.createElement('div'); mark.className = 'empty-mark'; mark.textContent = '⌁';
      const heading = document.createElement('h3'); heading.textContent = '等待本地随机源';
      const text = document.createElement('p'); text.textContent = '生成不会自动复制。秘密在主动显示前不会进入可见 DOM。';
      inner.append(mark, heading, text); empty.append(inner); resultContainer.replaceChildren(empty); return;
    }
    resultContainer.replaceChildren(...state.results.map((result, index) => buildResultCard(result, index)));
  }

  function renderHistory() {
    historyContainer.hidden = !state.historyEnabled;
    if (!state.historyEnabled) { historyContainer.replaceChildren(); return; }
    const entries = historyBudget.entries; const status = document.getElementById('history-budget-status');
    if (status) status.textContent = `${historyBudget.totalBytes.toLocaleString('zh-CN')} / ${runtime.budgets.MAX_HISTORY_RAW_BYTES.toLocaleString('zh-CN')} bytes`;
    if (!entries.length) { const empty = document.createElement('p'); empty.className = 'history-copy'; empty.textContent = 'History 已启用；只在当前内存中按 8 MiB 总预算保留。'; historyContainer.replaceChildren(empty); return; }
    const controls = document.createElement('div'); controls.className = 'result-toolbar'; controls.append(actionButton('清空 History', clearHistory, 'button-danger'));
    historyContainer.replaceChildren(controls, ...entries.map((result, index) => buildResultCard(result, index, 'history')));
  }

  function toggleReveal(id) { if (state.revealed.has(id)) state.revealed.delete(id); else state.revealed.add(id); renderResults(); renderHistory(); }
  function deleteResult(id) {
    const current = state.results.find((result) => result.id === id);
    state.results = state.results.filter((result) => result.id !== id);
    const removedHistory = historyBudget.removeById(id);
    if (current && !removedHistory) runtime.results.clearGenerationResult(current);
    state.revealed.delete(id); state.patterns.delete(id); renderResults(); renderHistory();
  }
  function clearCurrentResults() { for (const id of state.results.map((result) => result.id)) deleteResult(id); }
  function clearHistory() { historyBudget.clear(); renderResults(); renderHistory(); }
  function setHistoryEnabled(enabled) { state.historyEnabled = enabled; if (!enabled) clearHistory(); renderHistory(); }

  document.querySelectorAll('.mode-link').forEach((button) => button.addEventListener('click', () => setMode(button.dataset.mode)));
  addEventListener('hashchange', () => setMode(modeFromLocation(), true));
  form.addEventListener('submit', generateResults);
  form.addEventListener('reset', (event) => {
    event.preventDefault();
    delete state.settings.modes[state.mode];
    persistSettings();
    renderConfig();
  });
  form.addEventListener('change', (event) => {
    saveNonSecretSettings();
    if (event.target.name === 'language') { updateMnemonicWarning(); ensureMnemonicLanguage(event.target.value); }
    if (event.target.name === 'apiTemplate') syncApiTemplate(); updateAvailability();
  });
  document.getElementById('copy-current').addEventListener('click', () => state.results[0] && copyResults([state.results[0]]).catch((error) => showToast(error.message, 'error')));
  document.getElementById('copy-all').addEventListener('click', () => copyResults(state.results).catch((error) => showToast(error.message, 'error')));
  document.getElementById('clear-results').addEventListener('click', clearCurrentResults);
  document.getElementById('history-toggle').addEventListener('change', (event) => setHistoryEnabled(event.target.checked));
  addEventListener('pagehide', () => { cancelActiveGeneration('页面离开'); releaseCurrentResults(); historyBudget.clear(); analyzerWorker?.terminate(); }, { once: true });

  initializePassphrase(); initializePinRisk(); initializeAnalyzer(); ensureMnemonicLanguage('english');
  setMode(state.mode, true); renderResults(); renderHistory(); renderResources(); root.dataset.passwordGeneratorReady = 'true';
})();

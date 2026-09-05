import { shouldCommitMnemonicResourceState } from '../mnemonic-resource-state.mjs';
import { createPasswordWorkerBatch } from '../password-worker-batch.mjs';
import {
  DEFAULT_PASSWORD_SYMBOL_POOL,
  PASSWORD_COMPLEXITY_PRESETS,
  PASSWORD_LENGTH_PRESETS,
  PASSWORD_QUANTITY_PRESETS,
  applyPasswordComplexityPreset,
} from '../password-controls.mjs';
import {
  discreteSliderIndex,
  discreteSliderValue,
} from '../preset-slider.mjs';
import {
  aggregatePatternStates,
  createBatchPresentationSnapshot,
  createBatchRequestSnapshot,
  replaceResultById,
  shouldRejectUniqueReplacement,
} from '../result-batch.mjs';

(() => {
  const ASSETS = __V21_ASSET_MANIFEST__;
  const ENGINE_VERSION = '2.0.1';
  const PRODUCT_VERSION = '2.1.0';
  const SETTINGS_KEY = 'password-generator:v21:settings';
  const SETTINGS_SCHEMA = 210;
  const LARGE_COPY_CONFIRM_CHARACTERS = 1024 * 1024;
  const SHARE_PROMOTION_TEXT = `分享一个专业、安全、完全在浏览器本地运行的随机数据生成器 🔐
支持密码、口令、PIN 码、令牌、API 密钥、UUID 标识符、十六进制、随机字节与 BIP39 助记词。
V2.1：精确生成空间、独立模式分析与明确攻击假设。
立即体验：https://betaer.github.io/password-generator/index.html`;
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

  if (!runtime || runtime.version !== ENGINE_VERSION || root.dataset.runtimeVersion !== ENGINE_VERSION
    || root.dataset.productVersion !== PRODUCT_VERSION || ASSETS.version !== PRODUCT_VERSION) {
    failClosed('V2.1 页面与运行时版本不一致 · 已停止生成');
    return;
  }

  const MODE_HASH = Object.freeze({
    password: '#password', passphrase: '#passphrase', pin: '#pin', token: '#token',
    apiSecret: '#api-secret', uuid: '#uuid', hex: '#hex', randomBytes: '#random-bytes',
    mnemonic: '#mnemonic',
  });
  const HASH_MODE = Object.freeze(Object.fromEntries(Object.entries(MODE_HASH).map(([mode, hash]) => [hash, mode])));
  const MODE_META = Object.freeze({
    password: Object.freeze({ zh: '密码', en: 'Password', configTitle: '密码策略配置', resultTitle: '密码生成结果', description: '约束感知的精确均匀模型；生成后不再从字符串外观反推熵。', badge: '均匀约束模型' }),
    passphrase: Object.freeze({ zh: '口令', en: 'Passphrase', configTitle: '口令策略配置', resultTitle: '口令生成结果', description: '实际词池、随机大小写与逐间隔随机分隔符共同计入模型。', badge: '词语概率模型' }),
    pin: Object.freeze({ zh: 'PIN 码', en: 'PIN', configTitle: 'PIN 码策略配置', resultTitle: 'PIN 码生成结果', description: '按完成数量加权采样；批量默认精确无放回。', badge: '完成数量模型' }),
    token: Object.freeze({ zh: '令牌', en: 'Token', configTitle: '令牌策略配置', resultTitle: '令牌生成结果', description: '随机位、编码和碰撞语义；固定前缀不增加随机性。', badge: '机器随机密钥' }),
    apiSecret: Object.freeze({ zh: 'API 密钥', en: 'API Secret', configTitle: 'API 密钥策略配置', resultTitle: 'API 密钥生成结果', description: '通用或无厂商含义的合成演示格式。', badge: '合成演示密钥' }),
    uuid: Object.freeze({ zh: 'UUID 标识符', en: 'UUID', configTitle: 'UUID 标识符策略配置', resultTitle: 'UUID 标识符生成结果', description: 'RFC 9562 标识符；不是秘密，也不展示密码破解时间。', badge: '标准标识符' }),
    hex: Object.freeze({ zh: '十六进制', en: 'Hex', configTitle: '十六进制策略配置', resultTitle: '十六进制生成结果', description: '随机字节的十六进制表示；钱包私钥外观不代表有效私钥。', badge: '十六进制编码' }),
    randomBytes: Object.freeze({ zh: '随机字节', en: 'Random Bytes', configTitle: '随机字节策略配置', resultTitle: '随机字节生成结果', description: '延迟编码、符号化搜索空间、SHA-256 与全局内存预算。', badge: '原始随机字节' }),
    mnemonic: Object.freeze({ zh: '助记词', en: 'Mnemonic', configTitle: '助记词策略配置', resultTitle: '助记词生成结果', description: 'ENT、CS、官方词表固定哈希与恢复兼容性边界。', badge: '钱包恢复材料' }),
  });
  const RESULT_TYPE_LABELS = Object.freeze({
    password: '密码', passphrase: '口令', pin: 'PIN 码', mnemonic: '助记词', token: '令牌',
    'api-secret': 'API 密钥', hex: '十六进制', 'random-bytes': '随机字节', uuid: 'UUID 标识符',
  });
  const SCHEME_LABELS = Object.freeze({
    password: '均匀约束密码模型 V2.1', passphrase: '独立词池口令模型 V2.1', pin: '均匀约束 PIN 码模型 V2.1',
    token: '随机字节令牌模型 V2.1', 'api-secret': 'API 密钥模型 V2.1', hex: '十六进制随机字节模型 V2.1',
    'random-bytes': '原始随机字节模型 V2.1', uuid: 'RFC 9562 UUID 标识符模型', mnemonic: 'BIP39 助记词模型 V2.1',
  });
  const PRESENTATION_PROFILE_LABELS = Object.freeze({
    password: '密码概率模型', passphrase: '口令概率模型', pin: 'PIN 码概率模型', token: '令牌随机位模型',
    'api-secret': 'API 密钥随机位模型', hex: '十六进制随机位模型', 'random-bytes': '原始随机字节模型',
    uuid: 'UUID 标识符模型', bip39: 'BIP39 助记词模型',
  });
  const ENCODING_LABELS = Object.freeze({
    'base64url-nopad': 'Base64URL（无填充）', base64url: 'Base64URL', base64: 'Base64', hex: '十六进制', uuid: 'UUID 格式',
  });
  const CAPITALIZATION_LABELS = Object.freeze({
    lowercase: '全部小写', 'first-word': '首词首字母大写',
    'every-word': '每词首字母大写', 'random-uppercase': '随机一个词全大写',
  });
  const PATTERN_LABELS = Object.freeze({
    dictionary: '字典词', repeat: '重复结构', sequence: '连续序列', spatial: '键盘路径', date: '日期', regex: '正则模式',
  });
  const LANGUAGE_LABELS = Object.freeze({
    english: '英语', czech: '捷克语', french: '法语', italian: '意大利语', japanese: '日语',
    korean: '韩语', portuguese: '葡萄牙语', 'simplified-chinese': '简体中文', spanish: '西班牙语',
    'traditional-chinese': '繁体中文',
  });
  const PATTERN_MESSAGES = Object.freeze({
    idle: '模式分析尚未准备完成；精确生成器指标不受影响。',
    loading: '观察模式估算正在独立工作线程中分析。',
    ready: '观察模式估算已完成。',
    error: '模式分析失败；精确生成器指标仍然有效。',
    degraded: '模式分析资源不可用；精确生成器指标仍然有效。',
  });
  const RESOURCE_STATUS_LABELS = Object.freeze({ ready: '已就绪', loading: '加载中', degraded: '降级', error: '错误' });

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
  let mnemonicRequestEpoch = 0;

  const state = {
    mode: HASH_MODE[location.hash.toLowerCase()] || 'password',
    results: [], hidden: new Set(), patterns: new Map(), historyEnabled: false,
    busy: false, generationIntent: 0, activePasswordWorker: null, pinRiskIndex: null, analysisEpoch: 0,
    resultBatchRequest: null, resultBatchSource: null,
    settings: loadSettings(),
    resources: {
      crypto: globalThis.crypto?.getRandomValues && globalThis.crypto?.subtle
        ? { status: 'ready', detail: 'Web Crypto 随机源' }
        : { status: 'error', detail: 'Web Crypto 不可用 · 已停止生成' },
      passphrase: { status: 'loading', detail: 'V2.1 口令词包' },
      pinRisk: { status: 'loading', detail: 'PIN 启发式风险库' },
      mnemonic: { status: 'loading', detail: 'BIP39 英语词表' },
      zxcvbn: { status: 'loading', detail: '观察模式分析工作线程' },
    },
  };
  const historyBudget = runtime.budgets.createHistoryBudget({
    maxEntries: 100,
    maxBytes: runtime.budgets.MAX_HISTORY_RAW_BYTES,
    estimateBytes: runtime.budgets.estimateResultRetentionBytes,
    clearEntry(result) {
      if (!state.results.some((current) => current.id === result.id)) {
        state.patterns.delete(result.id);
        state.hidden.delete(result.id);
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
      'symbolMax', 'startsWith', 'endsWith', 'apiTemplate', 'hexScheme', 'complexityPreset',
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

  function currentPasswordFormConfig() {
    return {
      length: Number(form.elements.namedItem('length')?.value || 20),
      lowercase: Boolean(form.elements.lowercase?.checked),
      uppercase: Boolean(form.elements.uppercaseLetters?.checked),
      digits: Boolean(form.elements.digits?.checked),
      symbols: Boolean(form.elements.symbols?.checked),
      symbolPool: form.elements.symbolPool?.value || DEFAULT_PASSWORD_SYMBOL_POOL,
      allowSpace: Boolean(form.elements.allowSpace?.checked),
      requireEach: Boolean(form.elements.requireEach?.checked),
      allowRepeated: Boolean(form.elements.allowRepeated?.checked),
      symbolRatioRange: [Number(form.elements.symbolMin?.value || 0), Number(form.elements.symbolMax?.value || 0)],
      startsWith: form.elements.startsWith?.value || 'letter',
      endsWith: form.elements.endsWith?.value || 'letter',
    };
  }

  function sliderRoot(kind) {
    return configBody.querySelector(`[data-preset-slider="${kind}"]`);
  }

  function clearForcedCustomSlider(kind) {
    const rootElement = sliderRoot(kind);
    if (rootElement) delete rootElement.dataset.forceCustom;
  }

  function revealActiveSliderMark(kind) {
    const rootElement = sliderRoot(kind);
    const activeMark = rootElement?.querySelector('.preset-slider-mark.is-active');
    const scrollArea = rootElement?.querySelector('.preset-slider-scroll');
    if (!activeMark || !scrollArea) return;
    const inset = 8;
    const scrollRect = scrollArea.getBoundingClientRect();
    const markRect = activeMark.getBoundingClientRect();
    const clippedLeft = (scrollRect.left + inset) - markRect.left;
    const clippedRight = markRect.right - (scrollRect.right - inset);
    if (clippedLeft > 0) scrollArea.scrollLeft -= clippedLeft;
    else if (clippedRight > 0) scrollArea.scrollLeft += clippedRight;
  }

  function syncDiscreteSlider(kind, currentValue, presetValues, valueText, { hasCustomEndpoint = true } = {}) {
    const rootElement = sliderRoot(kind);
    if (!rootElement) return;
    const revealInitialSelection = rootElement.dataset.sliderInitialized !== 'true';
    rootElement.dataset.sliderInitialized = 'true';
    const forceCustom = rootElement.dataset.forceCustom === 'true';
    const range = rootElement.querySelector('.preset-slider-range');
    const requestedIndex = forceCustom ? presetValues.length : discreteSliderIndex(currentValue, presetValues);
    const isCustom = requestedIndex === presetValues.length;
    const visibleIndex = isCustom && !hasCustomEndpoint
      ? Math.min(Number(range.value) || 0, presetValues.length - 1)
      : requestedIndex;
    range.value = String(visibleIndex);
    range.setAttribute('aria-valuetext', valueText(requestedIndex));
    rootElement.dataset.sliderIndex = String(visibleIndex);
    rootElement.dataset.sliderCustom = String(isCustom);
    rootElement.querySelectorAll('.preset-slider-mark').forEach((button) => {
      const active = Number(button.dataset.sliderIndex) === visibleIndex && (hasCustomEndpoint || !isCustom);
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    if (revealInitialSelection) revealActiveSliderMark(kind);
  }

  function syncPasswordControls() {
    if (state.mode !== 'password') return;
    const selectedLevel = form.elements.complexityPreset?.value || 'custom';
    const selectedPreset = PASSWORD_COMPLEXITY_PRESETS.find(({ level }) => level === selectedLevel);
    syncDiscreteSlider(
      'complexity',
      selectedLevel,
      PASSWORD_COMPLEXITY_PRESETS.map(({ level }) => level),
      (index) => index === PASSWORD_COMPLEXITY_PRESETS.length
        ? '自定义配置；移动滑块即可重新应用 L1～L8 档位'
        : `${PASSWORD_COMPLEXITY_PRESETS[index].level}，${PASSWORD_COMPLEXITY_PRESETS[index].label}`,
      { hasCustomEndpoint: false },
    );
    const description = document.getElementById('complexity-description');
    if (description) description.textContent = selectedPreset
      ? `${selectedPreset.level} · ${selectedPreset.label}：已应用完整配方；最终安全结果仍按实际生成模型精确计算。`
      : '自定义配置：复杂度快捷方案已解除，安全结果按当前具体长度和约束精确计算。';
    syncDiscreteSlider(
      'length',
      Number(form.elements.namedItem('length')?.value),
      PASSWORD_LENGTH_PRESETS,
      (index) => index === PASSWORD_LENGTH_PRESETS.length ? `自定义，当前 ${form.elements.namedItem('length')?.value} 位` : `${PASSWORD_LENGTH_PRESETS[index]} 位`,
    );
    syncDiscreteSlider(
      'quantity',
      Number(form.elements.quantity?.value),
      PASSWORD_QUANTITY_PRESETS,
      (index) => index === PASSWORD_QUANTITY_PRESETS.length ? `自定义，当前 ${form.elements.quantity?.value} 个` : `${PASSWORD_QUANTITY_PRESETS[index]} 个`,
    );
  }

  function markPasswordComplexityCustom() {
    if (state.mode !== 'password' || !form.elements.complexityPreset) return;
    form.elements.complexityPreset.value = 'custom';
    syncPasswordControls();
  }

  function setPasswordFormValue(name, value) {
    const element = form.elements.namedItem(name);
    if (!element || !element.tagName) return;
    if (element.type === 'checkbox') element.checked = Boolean(value);
    else element.value = String(value);
  }

  function applyComplexityLevel(level) {
    clearForcedCustomSlider('complexity');
    clearForcedCustomSlider('length');
    const next = applyPasswordComplexityPreset(currentPasswordFormConfig(), level);
    for (const [name, value] of Object.entries({
      length: next.length,
      lowercase: next.lowercase,
      uppercaseLetters: next.uppercase,
      digits: next.digits,
      symbols: next.symbols,
      symbolPool: next.symbolPool,
      allowSpace: next.allowSpace,
      requireEach: next.requireEach,
      allowRepeated: next.allowRepeated,
      symbolMin: next.symbolRatioRange[0],
      symbolMax: next.symbolRatioRange[1],
      startsWith: next.startsWith,
      endsWith: next.endsWith,
      complexityPreset: level,
    })) setPasswordFormValue(name, value);
    syncPasswordControls();
    saveNonSecretSettings();
    updateAvailability();
  }

  function activateCustomSlider(kind, { focusExact = false } = {}) {
    const rootElement = sliderRoot(kind);
    if (!rootElement) return;
    if (kind === 'complexity') {
      markPasswordComplexityCustom();
      if (focusExact) form.elements.lowercase?.focus();
      return;
    }
    rootElement.dataset.forceCustom = 'true';
    syncPasswordControls();
    if (focusExact) {
      const exactInput = form.elements.namedItem(kind);
      exactInput?.focus();
      exactInput?.select?.();
    }
  }

  function applySliderIndex(kind, rawIndex) {
    const index = Number(rawIndex);
    if (kind === 'complexity') {
      const levels = PASSWORD_COMPLEXITY_PRESETS.map(({ level }) => level);
      const level = discreteSliderValue(index, levels, 'custom');
      if (level === 'custom') {
        markPasswordComplexityCustom();
        saveNonSecretSettings();
        updateAvailability();
      } else applyComplexityLevel(level);
      revealActiveSliderMark(kind);
      return;
    }
    const values = kind === 'length' ? PASSWORD_LENGTH_PRESETS : PASSWORD_QUANTITY_PRESETS;
    const fieldName = kind;
    const currentValue = Number(form.elements.namedItem(fieldName)?.value);
    const nextValue = discreteSliderValue(index, values, currentValue);
    if (index === values.length) {
      activateCustomSlider(kind);
      revealActiveSliderMark(kind);
      return;
    }
    clearForcedCustomSlider(kind);
    setPasswordFormValue(fieldName, nextValue);
    if (kind === 'length') markPasswordComplexityCustom();
    else syncPasswordControls();
    saveNonSecretSettings();
    updateAvailability();
    revealActiveSliderMark(kind);
  }

  const numberField = (name, fallback) => {
    const value = Number(new FormData(form).get(name));
    return Number.isFinite(value) ? value : fallback;
  };
  const checkbox = (name, label, checked = false) => `<label class="check"><input name="${name}" type="checkbox"${checked ? ' checked' : ''}>${label}</label>`;
  const quantityMarkup = (max = 100) => `<div class="field"><label for="quantity">生成数量</label><input id="quantity" name="quantity" type="number" min="1" max="${max}" value="1"><small>当前结果默认显示明文；PIN 码批量默认唯一。</small></div>`;
  const complexitySliderMarks = () => PASSWORD_COMPLEXITY_PRESETS
    .map((preset, index) => `<button class="preset-slider-mark${preset.level === 'L8' ? ' is-active' : ''}" type="button" data-slider-index="${index}" data-complexity-level="${preset.level}" aria-label="${preset.level}，${preset.label}" aria-pressed="${preset.level === 'L8'}"><strong>${preset.level}</strong><span>${preset.label}</span></button>`)
    .join('');
  const numericSliderMarks = (kind, values, attribute, active) => [
    ...values.map((value, index) => `<button class="preset-slider-mark${value === active ? ' is-active' : ''}" type="button" data-slider-index="${index}" ${attribute}="${value}" aria-pressed="${value === active}"><strong>${value}</strong></button>`),
    `<button class="preset-slider-mark preset-slider-custom" type="button" data-slider-index="${values.length}" data-preset-custom="${kind}" aria-pressed="false"><strong>自定义</strong></button>`,
  ].join('');
  const sliderShell = ({ kind, label, maximumIndex, value, valueText, marks, exactField = '' }) => `<div class="preset-slider-control" data-preset-slider="${kind}" data-slider-index="${value}">
    <span class="preset-slider-label field-label">${label}</span>
    <div class="preset-slider-layout${exactField ? '' : ' preset-slider-layout-wide'}">
      <div class="preset-slider-scroll" tabindex="-1">
        <div class="preset-slider-axis">
          <div class="preset-slider-track">
            <input class="preset-slider-range" data-slider-input="${kind}" type="range" min="0" max="${maximumIndex}" step="1" value="${value}" aria-label="${label}" aria-valuetext="${valueText}">
            <div class="preset-slider-mark-row" role="group" aria-label="${label}快捷刻度">${marks}</div>
          </div>
        </div>
      </div>
      ${exactField}
    </div>
  </div>`;
  const complexityMarkup = () => `<div class="field full password-complexity-control">
    ${sliderShell({ kind: 'complexity', label: '按照复杂度生成', maximumIndex: PASSWORD_COMPLEXITY_PRESETS.length - 1, value: 7, valueText: 'L8，几乎无法破解', marks: complexitySliderMarks() })}
    <input name="complexityPreset" type="hidden" value="L8">
    <small id="complexity-description">L8 会应用完整配方；最终安全结果仍按实际生成模型精确计算。</small>
  </div>`;
  const passwordLengthMarkup = () => `<div class="field full password-slider-field">${sliderShell({ kind: 'length', label: '密码长度', maximumIndex: PASSWORD_LENGTH_PRESETS.length, value: 5, valueText: '20 位', marks: numericSliderMarks('length', PASSWORD_LENGTH_PRESETS, 'data-password-length-preset', 20), exactField: '<label class="preset-exact-input" aria-label="精确密码长度" for="length"><span class="preset-exact-value"><input id="length" name="length" type="number" min="4" max="4096" value="20"><b data-exact-unit="length">位</b></span></label>' })}<small>拖动进度条、点击快捷数值或输入精确值，三者双向同步；支持 4～4096 位。</small></div>`;
  const passwordQuantityMarkup = () => `<div class="field full password-slider-field">${sliderShell({ kind: 'quantity', label: '生成数量', maximumIndex: PASSWORD_QUANTITY_PRESETS.length, value: 0, valueText: '1 个', marks: numericSliderMarks('quantity', PASSWORD_QUANTITY_PRESETS, 'data-password-quantity-preset', 1), exactField: '<label class="preset-exact-input" aria-label="精确生成数量" for="quantity"><span class="preset-exact-value"><input id="quantity" name="quantity" type="number" min="1" max="100" value="1"><b data-exact-unit="quantity">个</b></span></label>' })}<small>可自定义 1～100 个；整批只编译一次概率模型并在一个工作线程中采样。</small></div>`;

  const CONFIG_TEMPLATES = Object.freeze({
    password: () => `<div class="field-grid">
      ${complexityMarkup()}${passwordLengthMarkup()}${passwordQuantityMarkup()}
      <div class="field full"><span class="field-label">字符类型</span><div class="checks">${checkbox('lowercase', '小写字母', true)}${checkbox('uppercaseLetters', '大写字母', true)}${checkbox('digits', '数字', true)}${checkbox('symbols', '符号', true)}${checkbox('allowSpace', '空格')}</div></div>
      <div class="field full"><label for="symbolPool">符号字符池</label><input id="symbolPool" name="symbolPool" type="text" maxlength="64" value="!@#$%^&amp;*()-_=+[]{};:,.?" autocomplete="off" spellcheck="false"><small>最多 64 个可打印 ASCII 字符；拒绝控制字符、零宽连接符与规范化歧义。</small></div>
      <div class="field"><span class="field-label">符号占比</span><div class="range-pair"><div class="range-unit"><input name="symbolMin" type="number" min="0" max="100" value="10" aria-label="最小符号百分比"></div><div class="range-unit"><input name="symbolMax" type="number" min="0" max="100" value="35" aria-label="最大符号百分比"></div></div></div>
      <div class="field"><span class="field-label">高级约束</span><div class="checks">${checkbox('requireEach', '每类至少一个', true)}${checkbox('allowRepeated', '允许重复', true)}</div></div>
      <div class="field"><label for="startsWith">首字符</label><select id="startsWith" name="startsWith"><option value="any">任意启用类别</option><option value="letter" selected>字母</option><option value="digit">数字</option><option value="symbol">符号</option></select></div>
      <div class="field"><label for="endsWith">尾字符</label><select id="endsWith" name="endsWith"><option value="any">任意启用类别</option><option value="letter" selected>字母</option><option value="digit">数字</option><option value="symbol">符号</option></select></div>
    </div>`,
    passphrase: () => `<div class="field-grid">
      <div class="field"><label for="wordCount">单词数量</label><input id="wordCount" name="wordCount" type="number" min="1" max="100" value="6"></div>${quantityMarkup()}
      <div class="field full"><label for="pack">V2.1 独立词包</label><select id="pack" name="pack"></select><small>结果快照记录源词包 SHA-256 与有效词池 SHA-256。</small></div>
      <div class="field"><label for="capitalization">大小写</label><select id="capitalization" name="capitalization"><option value="lowercase">全部小写</option><option value="first-word">首词首字母大写</option><option value="every-word">每词首字母大写</option><option value="random-uppercase">随机一个词全大写</option></select></div>
      <div class="field"><label for="separator">分隔符</label><select id="separator" name="separator"><option value="hyphen">固定连字符 -</option><option value="underscore">固定下划线 _</option><option value="period">固定句点 .</option><option value="space">固定空格</option><option value="random-digit">每个间隔随机数字</option><option value="random-symbol">每个间隔随机符号</option></select></div>
      <div class="field full"><label for="separatorSymbols">随机符号候选</label><input id="separatorSymbols" name="separatorSymbols" type="text" maxlength="32" value="!@#$%&amp;*+?" autocomplete="off" spellcheck="false"></div>
    </div>`,
    pin: () => `<div class="field-grid">
      <div class="field"><label for="length">PIN 码长度</label><select id="length" name="length"><option>4</option><option selected>6</option><option>8</option><option>12</option><option>16</option><option>24</option><option>32</option></select></div>${quantityMarkup()}
      <div class="field full"><span class="field-label">PIN 码规则</span><div class="checks">${checkbox('allowLeadingZero', '允许前导零', true)}${checkbox('allowRepeated', '允许重复数字', true)}${checkbox('limitSequential', '限制连续数字', true)}${checkbox('blockWeak', '启发式常见 PIN 码排除', true)}${checkbox('uniqueWithinBatch', '批内唯一', true)}</div><small>4/6 位使用排名阈值；8 位以上主要使用规则过滤。公开过滤策略与均匀生成熵分开披露。</small></div>
    </div>`,
    token: () => `<div class="field-grid"><div class="field"><label for="byteLength">随机字节数</label><input id="byteLength" name="byteLength" type="number" min="1" max="4096" value="32"></div>${quantityMarkup()}<div class="field"><label for="encoding">编码</label><select id="encoding" name="encoding"><option value="base64url-nopad">Base64URL（无填充）</option><option value="base64url">Base64URL</option><option value="base64">Base64</option><option value="hex">十六进制</option></select></div><div class="field"><label for="prefix">固定前缀</label><input id="prefix" name="prefix" type="text" maxlength="64" value="tok_" autocomplete="off" spellcheck="false"><small>前缀不增加随机位数。</small></div></div>`,
    apiSecret: () => `<div class="field-grid"><div class="field"><label for="byteLength">密钥随机字节数</label><input id="byteLength" name="byteLength" type="number" min="1" max="4096" value="32"></div>${quantityMarkup()}<div class="field"><label for="apiTemplate">模板</label><select id="apiTemplate" name="apiTemplate"><option value="generic">通用模板</option><option value="synthetic-demo">合成演示模板 · demo_test_v1_</option></select></div><div class="field"><label for="encoding">编码</label><select id="encoding" name="encoding"><option value="base64url-nopad">Base64URL（无填充）</option><option value="hex">十六进制</option><option value="base64">Base64</option></select></div><div class="field api-generic"><label for="prefix">固定前缀</label><input id="prefix" name="prefix" type="text" maxlength="64" value="api_" autocomplete="off"></div><div class="field api-generic"><label for="environment">环境字段</label><input id="environment" name="environment" type="text" maxlength="32" value="test" autocomplete="off"></div><div class="field api-generic"><label for="apiVersion">版本字段</label><input id="apiVersion" name="apiVersion" type="text" maxlength="32" value="v1" autocomplete="off"></div><div class="field full callout">合成演示模板是无厂商含义的模拟凭据，不由 Stripe 或任何服务商签发，也不能用于真实服务。</div></div>`,
    uuid: () => `<div class="field-grid"><div class="field"><label for="version">UUID 版本</label><select id="version" name="version"><option value="4">UUID v4 · 122 个随机位</option><option value="7">UUID v7 · 74 个随机位 + 时间戳</option></select></div>${quantityMarkup()}<div class="field full callout warning">这是标识符，不是秘密。RFC 9562 不建议假定 UUID 难以猜测，也不应把 UUID 用作访问凭据。</div><div class="field full"><div class="checks">${checkbox('hyphens', '保留连字符', true)}${checkbox('uppercase', '大写')}</div></div></div>`,
    hex: () => `<div class="field-grid"><div class="field"><label for="byteLength">随机字节数</label><input id="byteLength" name="byteLength" type="number" min="1" max="4096" value="32"></div>${quantityMarkup()}<div class="field full"><div class="checks">${checkbox('uppercase', '大写十六进制')}${checkbox('includePrefix', '添加 0x 前缀')}</div></div><div class="field full"><label for="hexScheme">用途标记</label><select id="hexScheme" name="hexScheme"><option value="random-hex">通用随机十六进制</option><option value="wallet-private-key-appearance">钱包私钥外观（仅测试）</option></select><small>外观不代表曲线范围、链格式或可安全用于真实资产。</small></div></div>`,
    randomBytes: () => `<div class="field-grid"><div class="field"><label for="byteLength">原始字节数</label><input id="byteLength" name="byteLength" type="number" min="1" max="1048576" value="64"><small>达到 64 KiB 时自动限制生成数量为 1；完整编码仅在复制时生成。</small></div>${quantityMarkup(10)}<div class="field"><label for="encoding">预览 / 复制编码</label><select id="encoding" name="encoding"><option value="hex">十六进制</option><option value="base64">Base64</option><option value="base64url">Base64URL</option><option value="base64url-nopad">Base64URL（无填充）</option></select></div><div class="field"><div class="checks">${checkbox('uppercase', '大写十六进制')}</div></div></div>`,
    mnemonic: () => `<div class="field-grid"><div class="field"><label for="entropyBits">熵位数 / 单词数</label><select id="entropyBits" name="entropyBits"><option value="128">128 比特 · 12 个词</option><option value="160">160 比特 · 15 个词</option><option value="192">192 比特 · 18 个词</option><option value="224">224 比特 · 21 个词</option><option value="256">256 比特 · 24 个词</option></select></div>${quantityMarkup(20)}<div class="field full"><label for="language">BIP39 官方词表</label><select id="language" name="language">${Object.entries(LANGUAGE_LABELS).map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select></div><div id="mnemonic-warning" class="field full callout warning">高价值真实资产优先使用硬件钱包或经过验证的离线构建。非英语词表必须先验证目标钱包恢复兼容性。</div><div class="field full"><div class="checks">${checkbox('mnemonicAck', '我理解浏览器、扩展、剪贴板与钱包兼容性不在数学模型保证范围内')}</div><small>此确认不持久化；每次进入 BIP39 模式都必须重新确认。</small></div></div>`,
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

  const RESULT_ICONS = Object.freeze({
    copy: Object.freeze([
      Object.freeze({ d: 'M8 8.75A2.75 2.75 0 0 1 10.75 6h7.5A2.75 2.75 0 0 1 21 8.75v7.5A2.75 2.75 0 0 1 18.25 19h-7.5A2.75 2.75 0 0 1 8 16.25v-7.5Z' }),
      Object.freeze({ d: 'M16 6V5.75A2.75 2.75 0 0 0 13.25 3h-7.5A2.75 2.75 0 0 0 3 5.75v7.5A2.75 2.75 0 0 0 5.75 16H8' }),
    ]),
    delete: Object.freeze([
      Object.freeze({ d: 'M5 7h14M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6', linecap: 'round', linejoin: 'round' }),
    ]),
    reveal: Object.freeze([
      Object.freeze({ d: 'M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z', linecap: 'round', linejoin: 'round' }),
      Object.freeze({ d: 'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z', linecap: 'round', linejoin: 'round' }),
    ]),
    hide: Object.freeze([
      Object.freeze({ d: 'm3 3 18 18M10.1 6.2A9.8 9.8 0 0 1 12 6c6 0 9.5 6 9.5 6a15.8 15.8 0 0 1-3 3.7M6.1 7.2C3.7 9 2.5 12 2.5 12s3.5 6 9.5 6c1 0 2-.2 2.9-.5M9.7 9.7a3.2 3.2 0 0 0 4.6 4.6', linecap: 'round', linejoin: 'round' }),
    ]),
    regenerate: Object.freeze([
      Object.freeze({ d: 'M20 6v5h-5M4 18v-5h5M18.5 9A7.5 7.5 0 0 0 6 6.5L4 9M5.5 15A7.5 7.5 0 0 0 18 17.5l2-2.5', linecap: 'round', linejoin: 'round' }),
    ]),
    info: Object.freeze([
      Object.freeze({ d: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 15h-2v-6h2v6Zm0-8h-2V7h2v2Z', fill: 'currentColor', stroke: 'none' }),
    ]),
  });

  function iconButton(label, iconPaths, handler, extraClass = '', baseClass = 'result-icon-button') {
    const button = document.createElement('button');
    button.type = 'button'; button.className = `${baseClass} ${extraClass}`.trim(); button.setAttribute('aria-label', label); button.title = label;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
    for (const descriptor of iconPaths) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', descriptor.d); path.setAttribute('stroke-width', '1.8');
      if (descriptor.fill) path.setAttribute('fill', descriptor.fill);
      if (descriptor.stroke) path.setAttribute('stroke', descriptor.stroke);
      if (descriptor.linecap) path.setAttribute('stroke-linecap', descriptor.linecap);
      if (descriptor.linejoin) path.setAttribute('stroke-linejoin', descriptor.linejoin);
      svg.append(path);
    }
    button.append(svg); button.addEventListener('click', handler); return button;
  }

  function historyIconButton(label, iconPaths, handler, extraClass) {
    return iconButton(label, iconPaths, handler, extraClass, 'history-icon-button');
  }

  function setResource(name, status, detail) {
    state.resources[name] = { status, detail }; renderResources(); updateAvailability();
  }

  function renderResources() {
    const strip = document.getElementById('resource-strip');
    strip.replaceChildren(...Object.entries(state.resources).map(([name, resource]) => {
      const item = document.createElement('span'); item.className = 'resource-item'; item.dataset.state = resource.status;
      const dot = document.createElement('span'); dot.className = 'resource-dot';
      const text = document.createElement('span'); text.textContent = `${resource.detail} · ${RESOURCE_STATUS_LABELS[resource.status] || resource.status}`;
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
    document.getElementById('regenerate-all')?.toggleAttribute('disabled', state.busy || !state.results.length);
    document.querySelectorAll('[data-regenerate-result]').forEach((button) => {
      button.disabled = state.busy || !state.resultBatchRequest;
    });
  }

  function loadLocalScriptOnce(src, check) {
    if (check()) return Promise.resolve();
    if (scriptPromises.has(src)) return scriptPromises.get(src);
    const promise = new Promise((resolve, reject) => {
      const script = document.createElement('script'); script.src = src;
      let settled = false;
      const finish = (handler) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        script.onload = null;
        script.onerror = null;
        handler();
      };
      const timeout = setTimeout(() => finish(() => reject(new Error(`资源加载超时：${src}`))), 15000);
      script.onload = () => finish(() => (check() ? resolve() : reject(new Error(`资源未注册：${src}`))));
      script.onerror = () => finish(() => reject(new Error(`资源加载失败：${src}`)));
      document.head.appendChild(script);
    }).catch((error) => { scriptPromises.delete(src); throw error; });
    scriptPromises.set(src, promise); return promise;
  }

  function renderConfig() {
    const meta = MODE_META[state.mode];
    document.getElementById('config-title').textContent = meta.configTitle;
    document.getElementById('result-title').textContent = meta.resultTitle;
    document.getElementById('config-description').textContent = meta.description;
    document.getElementById('model-badge').textContent = meta.badge;
    configBody.innerHTML = CONFIG_TEMPLATES[state.mode]();
    configBody.querySelectorAll('input[type="number"]').forEach(input => { input.required = true; });
    if (state.mode === 'passphrase') populatePassphrasePacks();
    applySettings();
    if (state.mode === 'password') syncPasswordControls();
    if (state.mode === 'apiSecret') syncApiTemplate();
    syncRandomBytesQuantity();
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

  function syncRandomBytesQuantity() {
    if (state.mode !== 'randomBytes') return;
    const large = Number(form.elements.byteLength.value) >= runtime.budgets.LARGE_RANDOM_BYTES_THRESHOLD;
    const quantity = form.elements.quantity;
    quantity.max = large ? '1' : '10';
    quantity.readOnly = large;
    if (large) quantity.value = '1';
  }

  function updateMnemonicWarning() {
    const language = form.elements.language?.value || 'english';
    const notice = runtime.bip39.bip39CompatibilityNotice(language);
    const warning = document.getElementById('mnemonic-warning');
    if (warning) warning.textContent = [notice.compatibilityWarning, notice.assetSafetyWarning].filter(Boolean).join(' ');
  }

  function modeFromLocation() { return HASH_MODE[location.hash.toLowerCase()] || 'password'; }

  function cancelActiveGeneration(reason) {
    state.generationIntent += 1;
    coordinator.cancel(reason);
    const active = state.activePasswordWorker;
    state.activePasswordWorker = null;
    active?.cancel(reason);
    state.busy = false; updateAvailability();
  }

  function releaseCurrentResults() {
    const retained = new Set(historyBudget.entries.map((result) => result.id));
    for (const result of state.results) if (!retained.has(result.id)) runtime.results.clearGenerationResult(result);
    state.results = []; state.hidden.clear(); state.resultBatchRequest = null; state.resultBatchSource = null; state.analysisEpoch += 1; renderResults();
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
    setResource('passphrase', 'loading', 'V2.1 口令词包');
    try {
      await loadLocalScriptOnce(`./assets/v2.1/${ASSETS.passphrase}`, () => Boolean(globalThis.PasswordGeneratorV201PassphraseAssets?.ready));
      await globalThis.PasswordGeneratorV201PassphraseAssets.ready;
      setResource('passphrase', 'ready', 'V2.1 口令词包');
      if (state.mode === 'passphrase') renderConfig();
    } catch (error) { setResource('passphrase', 'error', 'V2.1 口令词包'); showToast(error.message, 'error'); }
  }

  async function initializePinRisk() {
    setResource('pinRisk', 'loading', 'PIN 启发式风险库');
    try {
      await loadLocalScriptOnce(`./assets/v2.1/${ASSETS.pinRisk}`, () => Boolean(globalThis.PasswordGeneratorV201Assets?.pinRisk));
      state.pinRiskIndex = runtime.createPinRiskIndex(globalThis.PasswordGeneratorV201Assets.pinRisk);
      setResource('pinRisk', 'ready', 'PIN 启发式风险库 v1');
    } catch (error) { state.pinRiskIndex = null; setResource('pinRisk', 'error', 'PIN 启发式风险库'); showToast(error.message, 'error'); }
  }

  async function ensureMnemonicLanguage(language) {
    const requestEpoch = ++mnemonicRequestEpoch;
    const label = LANGUAGE_LABELS[language] || language;
    if (runtime.bip39.getBip39WordlistStatus(language).state === 'ready') {
      if (shouldCommitMnemonicResourceState({
        requestEpoch,
        latestRequestEpoch: mnemonicRequestEpoch,
        activeMode: state.mode,
        selectedLanguage: state.mode === 'mnemonic' ? form.elements.language?.value : null,
        requestedLanguage: language,
      })) setResource('mnemonic', 'ready', `BIP39 ${label}`);
      return;
    }
    setResource('mnemonic', 'loading', `BIP39 ${label}`);
    try {
      const filename = ASSETS.bip39[language];
      if (!filename) throw new Error(`未知 BIP39 词表：${language}`);
      await loadLocalScriptOnce(`./assets/v2.1/${filename}`, () => Boolean(globalThis.PasswordGeneratorV201Bip39Assets?.[language]?.ready));
      await globalThis.PasswordGeneratorV201Bip39Assets[language].ready;
      if (!shouldCommitMnemonicResourceState({
        requestEpoch,
        latestRequestEpoch: mnemonicRequestEpoch,
        activeMode: state.mode,
        selectedLanguage: state.mode === 'mnemonic' ? form.elements.language?.value : null,
        requestedLanguage: language,
      })) return;
      setResource('mnemonic', 'ready', `BIP39 ${label}`);
    } catch (error) {
      if (shouldCommitMnemonicResourceState({
        requestEpoch,
        latestRequestEpoch: mnemonicRequestEpoch,
        activeMode: state.mode,
        selectedLanguage: state.mode === 'mnemonic' ? form.elements.language?.value : null,
        requestedLanguage: language,
      })) setResource('mnemonic', 'error', `BIP39 ${label}`);
      showToast(error.message, 'error');
    }
  }

  function createAnalyzerWorker() {
    if (!globalThis.Worker) throw new Error('浏览器不支持分析工作线程。');
    const worker = new Worker(`./assets/v2.1/${ASSETS.zxcvbnWorker}`);
    worker.onmessage = ({ data }) => {
      const pending = analyzerRequests.get(data?.requestId);
      if (!pending) return;
      clearTimeout(pending.timer);
      analyzerRequests.delete(data.requestId);
      if (data.ok) pending.resolve(data.result); else pending.reject(new Error(data.error || '模式分析失败'));
    };
    worker.onerror = () => {
      if (analyzerWorker !== worker) return;
      disposeAnalyzer('模式分析工作线程失效');
      setResource('zxcvbn', 'degraded', '观察模式分析工作线程');
    };
    worker.onmessageerror = worker.onerror;
    return worker;
  }

  function disposeAnalyzer(reason) {
    if (analyzerWorker) {
      analyzerWorker.onmessage = null; analyzerWorker.onerror = null; analyzerWorker.onmessageerror = null;
      analyzerWorker.terminate(); analyzerWorker = null;
    }
    for (const pending of analyzerRequests.values()) {
      clearTimeout(pending.timer); pending.reject(new Error(reason));
    }
    analyzerRequests.clear();
  }

  async function initializeAnalyzer() {
    setResource('zxcvbn', 'loading', '观察模式分析工作线程');
    try {
      analyzerWorker = analyzerWorker || createAnalyzerWorker();
      patterns.setAnalyzer((value) => new Promise((resolve, reject) => {
        if (!analyzerWorker) { reject(new Error('模式分析工作线程不可用')); return; }
        const worker = analyzerWorker;
        const requestId = `analysis:${++analyzerSequence}`;
        const timer = setTimeout(() => {
          if (analyzerWorker !== worker) return;
          disposeAnalyzer('模式分析超时');
          setResource('zxcvbn', 'degraded', '观察模式分析工作线程');
        }, 15000);
        analyzerRequests.set(requestId, { resolve, reject, timer });
        try { worker.postMessage({ requestId, epoch: state.analysisEpoch, value }); }
        catch { clearTimeout(timer); analyzerRequests.delete(requestId); reject(new Error('模式分析请求发送失败')); }
      }));
      setResource('zxcvbn', 'ready', '观察模式分析工作线程');
      await analyzeLiveResults(true);
    } catch (error) { setResource('zxcvbn', 'degraded', '观察模式分析工作线程'); showToast(error.message, 'error'); }
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
      const symbols = data.has('symbols');
      const symbolPool = symbols
        ? runtime.inputValidation.normalizePrintableAscii(data.get('symbolPool'), '符号池', 64)
        : DEFAULT_PASSWORD_SYMBOL_POOL;
      config = { length: numberField('length', 20), lowercase: data.has('lowercase'), uppercase: data.has('uppercaseLetters'), digits: data.has('digits'), symbols, symbolPool, allowSpace: data.has('allowSpace'), requireEach: data.has('requireEach'), allowRepeated: data.has('allowRepeated'), symbolRatioRange: [numberField('symbolMin', 0), numberField('symbolMax', 100)], startsWith: data.get('startsWith'), endsWith: data.get('endsWith') };
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
    const worker = new Worker(`./assets/v2.1/${ASSETS.passwordWorker}`);
    const batch = createPasswordWorkerBatch({
      worker, jobId: job.id, config, deserialize: deserializeWorkerResult,
      clearResult: runtime.results.clearGenerationResult,
      onSettled() { if (state.activePasswordWorker === batch) state.activePasswordWorker = null; },
    });
    state.activePasswordWorker = batch;
    return batch;
  }

  async function compileForJob(mode, config, job) {
    if (mode === 'password') return compilePasswordWorker(config, job);
    return runtime.compileGenerator(mode, config, { cryptoLike: globalThis.crypto, pinRiskIndex: config.blockWeak ? state.pinRiskIndex : undefined });
  }

  async function generateResults(event) {
    event?.preventDefault();
    if (state.resources.crypto.status !== 'ready') return;
    syncRandomBytesQuantity();
    if (!form.reportValidity()) return;
    // 意图编号与忙碌状态必须早于配置中的第一次 await。
    cancelActiveGeneration('新生成请求');
    const intent = state.generationIntent;
    const mode = state.mode;
    state.busy = true; updateAvailability();
    saveNonSecretSettings();
    let job = null;
    let next = null;
    let accepted = false;
    try {
      const { quantity, config } = await readConfig(mode);
      if (state.generationIntent !== intent || state.mode !== mode) throw Object.assign(new Error('配置读取期间请求已取消。'), { name: 'GenerationCancelledError' });
      job = coordinator.begin(mode, config, quantity);
      next = await runtime.batch.generateAtomicBatch({ job, compile: compileForJob, isCurrent: coordinator.isCurrent, clearResult: runtime.results.clearGenerationResult });
      if (!coordinator.isCurrent(job) || state.mode !== job.mode) {
        for (const result of next) runtime.results.clearGenerationResult(result);
        next = null;
        return;
      }
      const previous = state.results;
      state.results = [...next]; state.hidden.clear(); state.analysisEpoch += 1;
      state.resultBatchRequest = createBatchRequestSnapshot(job.mode, job.config);
      state.resultBatchSource = createBatchPresentationSnapshot(next[0], job.quantity);
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
      if (intent === state.generationIntent && error?.name !== 'GenerationCancelledError') showToast(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      if (job && coordinator.isCurrent(job)) coordinator.cancel('completed');
      if (intent === state.generationIntent) { state.busy = false; updateAvailability(); }
    }
  }

  async function regenerateResult(id) {
    if (state.busy || !state.resultBatchRequest) return;
    const request = state.resultBatchRequest;
    const original = state.results.find((result) => result.id === id);
    if (!original || request.mode !== state.mode) return;
    cancelActiveGeneration('单条重新生成');
    const intent = state.generationIntent;
    state.busy = true; updateAvailability();
    let replacement = null; let commitStarted = false; let committed = false;
    let previousResults = null; let previousHidden = null; let previousPatterns = null; let previousEpoch = null;
    try {
      for (let attempt = 0; attempt < 16 && !replacement; attempt += 1) {
        let job = null; let next = null;
        try {
          job = coordinator.begin(request.mode, request.config, 1);
          next = await runtime.batch.generateAtomicBatch({ job, compile: compileForJob, isCurrent: coordinator.isCurrent, clearResult: runtime.results.clearGenerationResult });
          if (!coordinator.isCurrent(job) || state.mode !== request.mode || !state.results.some((result) => result.id === id)) {
            for (const result of next) runtime.results.clearGenerationResult(result);
            throw Object.assign(new Error('单条重生成已取消。'), { name: 'GenerationCancelledError' });
          }
          const candidate = next[0];
          if (shouldRejectUniqueReplacement(state.results, id, candidate, request)) {
            runtime.results.clearGenerationResult(candidate); next = null;
          } else {
            replacement = candidate; next = null;
          }
        } finally {
          if (next) for (const result of next) runtime.results.clearGenerationResult(result);
          if (job && coordinator.isCurrent(job)) coordinator.cancel(replacement ? 'completed' : 'retry');
        }
      }
      if (!replacement) throw new Error('连续生成到批内重复结果，请再试一次。');
      const previous = state.results.find((result) => result.id === id);
      if (previous !== original || state.mode !== request.mode || state.resultBatchRequest !== request) {
        runtime.results.clearGenerationResult(replacement); replacement = null; return;
      }
      previousResults = state.results;
      previousHidden = new Set(state.hidden);
      previousPatterns = new Map(state.patterns);
      previousEpoch = state.analysisEpoch;
      commitStarted = true;
      const nextResults = replaceResultById(state.results, id, replacement);
      state.results = nextResults;
      state.hidden.delete(id); state.hidden.delete(replacement.id); state.analysisEpoch += 1;
      if (['password', 'passphrase'].includes(replacement.type)) {
        state.patterns.set(replacement.id, {
          status: state.resources.zxcvbn.status === 'ready' ? 'loading' : state.resources.zxcvbn.status,
          guessBits: null,
          sequences: [],
        });
      }
      renderResults();
      committed = true;
      let historyWarning = '';
      try {
        if (state.historyEnabled) historyBudget.add([replacement]);
        renderHistory();
      } catch (historyError) {
        historyWarning = `结果已更新，但生成记录刷新失败：${historyError instanceof Error ? historyError.message : String(historyError)}`;
      }
      const retained = historyBudget.entries.some((result) => result.id === previous.id);
      if (!retained) {
        state.patterns.delete(previous.id);
        runtime.results.clearGenerationResult(previous);
      }
      replacement = null; analyzeLiveResults(false);
      showToast(historyWarning || '已原位重新生成这一条；未写入剪贴板。', historyWarning ? 'error' : 'info');
    } catch (error) {
      if (commitStarted && !committed) {
        state.results = previousResults;
        state.hidden = previousHidden;
        state.patterns = previousPatterns;
        state.analysisEpoch = previousEpoch;
        if (replacement) {
          runtime.results.clearGenerationResult(replacement);
          replacement = null;
        }
        try { renderResults(); renderHistory(); } catch { /* 保留旧状态；错误气泡仍可报告根因。 */ }
      } else if (!commitStarted && replacement) {
        runtime.results.clearGenerationResult(replacement);
        replacement = null;
      }
      if (error?.name !== 'GenerationCancelledError') showToast(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      if (intent === state.generationIntent) { state.busy = false; updateAvailability(); }
    }
  }

  function isLiveResult(id, epoch) {
    return Number.isSafeInteger(epoch) && epoch <= state.analysisEpoch
      && [...state.results, ...historyBudget.entries].some((result) => result.id === id);
  }

  async function analyzeLiveResults(reanalyze) {
    const epoch = state.analysisEpoch;
    const options = { current: state.results, history: historyBudget.entries, epoch, isLive: isLiveResult, onUpdate(id, analysis) { state.patterns.set(id, analysis); updateResultAssessment(id); } };
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
    textarea.dataset.v21ClipboardFallback = 'true'; textarea.setAttribute('data-v21-clipboard-fallback', 'true');
    textarea.setAttribute('aria-hidden', 'true'); textarea.setAttribute('readonly', ''); textarea.className = 'clipboard-fallback';
    try { textarea.value = text; document.body.appendChild(textarea); textarea.select(); return document.execCommand('copy'); }
    finally { textarea.value = ''; textarea.remove(); }
  }

  async function copySharePromotion() {
    if (!await copyText(SHARE_PROMOTION_TEXT)) throw new Error('浏览器拒绝复制网站分享文案。');
    showToast('已复制网站分享文案。');
  }

  function updateBackToTop() {
    const button = document.getElementById('back-to-top');
    if (!button) return;
    button.hidden = !(document.documentElement.scrollHeight > innerHeight + 1 && scrollY > 80);
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

  function formatBits(value) { return `${Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 3 })} 比特`; }
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
    container.append(metric('生成器最小熵', formatBits(exact.generatorMinEntropyBits)), metric('生成器香农熵', formatBits(exact.generatorShannonEntropyBits)), metric('生成空间', exact.searchSpaceLabel), metric('期望猜测次数', exact.expectedRankLabel));
  }

  function profileContent(result, assessment, { includeObserved = true, shared = false } = {}) {
    const fragment = document.createDocumentFragment(); const metrics = document.createElement('div'); metrics.className = 'metric-grid';
    const metricsHeading = document.createElement('h4'); metricsHeading.className = 'metric-grid-title'; metricsHeading.textContent = '精确生成器指标'; metrics.append(metricsHeading);
    appendExactMetrics(metrics, assessment);
    const profile = result.generationModel.presentationProfile;
    if (['token', 'api-secret', 'hex'].includes(profile)) {
      const prefixLength = typeof result.generationModel.prefix === 'string' ? result.generationModel.prefix.length : 0;
      metrics.append(
        metric('CSPRNG 名义输出位数', formatBits(assessment.machineSecret.nominalCsprngOutputBits)),
        metric('编码 / 固定前缀', `${ENCODING_LABELS[result.generationModel.encoding] || '未标明'} / ${prefixLength ? `有（${prefixLength} 个字符）` : '无'}`),
      );
    } else if (profile === 'random-bytes') {
      const byteLength = shared ? result.randomByteLength : result.bytes.byteLength;
      metrics.append(metric('原始字节数', byteLength.toLocaleString('zh-CN')), metric('CSPRNG 名义输出位数', formatBits(assessment.randomBytes.nominalCsprngOutputBits)));
      if (!shared) metrics.append(metric('文件 SHA-256', result.sha256));
    } else if (profile === 'uuid') {
      metrics.append(metric('用途', '标准标识符（不是秘密）'), metric('版本 / 变体', `${result.generationModel.version} / ${result.generationModel.variant}`), metric('随机位数', formatBits(result.generationModel.nominalCsprngOutputBits)));
      if (!shared) metrics.append(metric('v7 时间戳', result.generationModel.timestampUnixMs == null ? '不适用' : new Date(result.generationModel.timestampUnixMs).toISOString()));
    } else if (profile === 'bip39') {
      metrics.append(metric('熵位数 / 校验位数', `${result.generationModel.entropyBits} / ${result.generationModel.checksumBits} 比特`), metric('单词数 / 词表语言', `${result.generationModel.wordCount} / ${LANGUAGE_LABELS[result.generationModel.language] || result.generationModel.language}`), metric('校验和', result.checksumValid ? '有效' : '无效'), metric('词表 SHA-256', result.generationModel.wordlistSha256));
    } else if (profile === 'pin') {
      const policy = result.generationModel.commonPinPolicy;
      const collision = result.generationModel.independentBatchCollisionProbability;
      metrics.append(metric('批内唯一', result.configSnapshot.uniqueWithinBatch ? '是（无放回）' : '否（独立有放回）'), metric(result.configSnapshot.uniqueWithinBatch ? '独立批次碰撞概率（假设独立，非本批）' : '独立批次碰撞概率', Number.isFinite(collision) ? `${(collision * 100).toPrecision(4)}%` : '未提供'), metric('常见 PIN 码排除策略', policy ? '启发式常见 PIN 码排除策略 v1' : '未启用'), metric('过滤数量', policy ? `${policy.blockedCount.toLocaleString('zh-CN')} / ${policy.baseSearchSpace.toLocaleString('zh-CN')}` : '0'));
    }
    fragment.append(metrics);
    if (includeObserved && ['password', 'passphrase'].includes(profile)) {
      const observed = assessment.observedPattern; const observedBox = document.createElement('section'); observedBox.className = 'assessment-layer';
      const heading = document.createElement('h4'); heading.textContent = '观察模式估算';
      const detail = document.createElement('p');
      detail.textContent = observed.status === 'ready' ? `启发式猜测强度：${observed.guessBits == null ? '—' : `约 2^${observed.guessBits.toFixed(2)}`}；模式：${observed.sequences.map((item) => PATTERN_LABELS[item] || '其他模式').join('、') || '未发现显著模式'}。` : PATTERN_MESSAGES[observed.status] || PATTERN_MESSAGES.idle;
      observedBox.append(heading, detail); fragment.append(observedBox);
    }
    if (assessment.attackScenarios.length) {
      const layer = document.createElement('section'); layer.className = 'assessment-layer';
      const heading = document.createElement('h4'); heading.textContent = '攻击场景估算'; layer.append(heading);
      const list = document.createElement('ul'); list.className = 'attack-list';
      for (const scenario of assessment.attackScenarios) {
        const item = document.createElement('li'); const label = document.createElement('span'); label.textContent = `${scenario.label} · ${scenario.assumption}`;
        const value = document.createElement('strong'); value.textContent = formatAttackTime(assessment.exactGenerator.expectedRank.bits, scenario.guessesPerSecond);
        item.append(label, value); list.append(item);
      }
      layer.append(list); fragment.append(layer);
    }
    const note = document.createElement('p'); note.className = 'pattern-state';
    if (profile === 'uuid') note.textContent = '这是标识符，不是秘密。UUID 不应作为密码、API 密钥或访问能力凭据；v7 会暴露毫秒级创建时间。';
    else if (profile === 'bip39') note.textContent = `${runtime.bip39.bip39CompatibilityNotice(result.generationModel.language).compatibilityWarning || ''} ${assessment.bip39Notice}`.trim();
    else if (['token', 'api-secret', 'hex'].includes(profile)) note.textContent = assessment.machineSecret.collisionSemantics;
    else if (profile === 'random-bytes') note.textContent = '这里显示的是 CSPRNG 名义输出位数：假设浏览器 Web Crypto 未遭破坏且输出可建模为均匀 CSPRNG；它不是可测量的信息论熵下限。';
    else note.textContent = assessment.disclaimer;
    fragment.append(note); return fragment;
  }

  function assessmentFor(result) {
    return runtime.assessment.createSecurityAssessment({
      generationModel: result.generationModel,
      patternAnalysis: state.patterns.get(result.id) || { status: state.resources.zxcvbn.status, guessBits: null, sequences: [] },
    });
  }

  function assessmentForBatchSource(source) {
    return runtime.assessment.createSecurityAssessment({ generationModel: source.generationModel });
  }

  function updateResultAssessment(id) {
    const result = state.results.find((item) => item.id === id);
    const row = [...document.querySelectorAll('.compact-result-row[data-result-id]')]
      .find((item) => item.dataset.resultId === id);
    const container = row?.querySelector('[data-pattern-indicator]');
    if (!result || !container) return;
    updatePatternIndicatorState(container, result, Number(row.dataset.resultNumber) - 1);
    refreshBatchAssessment();
  }

  function safeJson(value) { return JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item, 2); }

  function localizedModelDetails(result, assessment) {
    return {
      模型版本: result.schemaVersion,
      方案标识: SCHEME_LABELS[result.type] || 'V2.1 专用安全生成模型',
      结果类型: RESULT_TYPE_LABELS[result.type] || result.type,
      展示类别: PRESENTATION_PROFILE_LABELS[result.generationModel.presentationProfile] || '专用生成模型',
      生成空间: assessment.exactGenerator.searchSpaceLabel,
      期望猜测次数: assessment.exactGenerator.expectedRankLabel,
      配置快照: `已冻结 ${Object.keys(result.configSnapshot).length} 个配置字段；自由文本与秘密字段不在详情中展示。`,
      概率模型: `已冻结 ${Object.keys(result.generationModel).length} 个模型字段；秘密材料已省略。`,
    };
  }

  function resultDisplayText(result) {
    if (result.type === 'random-bytes') return result.preview;
    if (result.value.length <= runtime.budgets.MAX_RENDER_CHARACTERS) return result.value;
    return '内容超过 DOM 渲染预算；请显式复制或下载。';
  }

  function updateSecretPresentation(id) {
    const hidden = state.hidden.has(id);
    document.querySelectorAll(`.compact-result-row[data-result-id="${CSS.escape(id)}"]`).forEach((card) => {
      const value = card.querySelector('.compact-result-value');
      const toggle = card.querySelector('[data-secret-toggle]');
      if (value) {
        value.dataset.secretState = hidden ? 'masked' : 'revealed';
        value.removeAttribute('aria-describedby');
        card.querySelector(':scope > .result-tooltip')?.remove();
      }
      if (toggle) {
        card.querySelector(`#${CSS.escape(`result-action-tooltip-toggle-${id}`)}`)?.remove();
        toggle.removeAttribute('aria-describedby');
        const replacement = iconButton('', hidden ? RESULT_ICONS.reveal : RESULT_ICONS.hide, () => {});
        toggle.replaceChildren(...replacement.childNodes);
        toggle.removeAttribute('title');
        toggle.setAttribute('aria-pressed', String(!hidden));
        toggle.setAttribute('aria-label', `${hidden ? '显示' : '隐藏'}第 ${card.dataset.resultNumber} 条生成结果`);
      }
    });
  }

  function installTooltip(container, trigger, text, tooltipId, { toggleOnClick = false, tooltipClass = '' } = {}) {
    let focusOpened = false;
    trigger.removeAttribute('title');
    const show = () => {
      if (container.querySelector(`#${CSS.escape(tooltipId)}`)) return;
      const tooltip = document.createElement(container.tagName === 'SUMMARY' ? 'span' : 'div'); tooltip.className = `result-tooltip ${tooltipClass}`.trim(); tooltip.id = tooltipId;
      tooltip.setAttribute('role', 'tooltip'); tooltip.textContent = typeof text === 'function' ? text() : text;
      trigger.setAttribute('aria-describedby', tooltipId); container.append(tooltip);
    };
    const hide = () => { container.querySelector(`#${CSS.escape(tooltipId)}`)?.remove(); trigger.removeAttribute('aria-describedby'); };
    trigger.addEventListener('mouseenter', show); trigger.addEventListener('mouseleave', hide);
    trigger.addEventListener('focus', () => { show(); focusOpened = true; });
    trigger.addEventListener('blur', () => { focusOpened = false; hide(); });
    if (toggleOnClick) trigger.addEventListener('click', (event) => {
      event.preventDefault(); event.stopPropagation();
      if (focusOpened) { focusOpened = false; return; }
      if (container.querySelector(`#${CSS.escape(tooltipId)}`)) hide(); else show();
    });
  }

  function passwordComposition(value) {
    const characters = [...value];
    const count = (expression) => characters.filter((character) => expression.test(character)).length;
    return { length: characters.length, lower: count(/[a-z]/u), upper: count(/[A-Z]/u), digit: count(/[0-9]/u), symbol: count(/[^A-Za-z0-9]/u) };
  }

  function compactResultMeta(result) {
    const model = result.generationModel;
    if (result.type === 'password') {
      const composition = passwordComposition(result.value);
      return `${composition.length} 位 · 小写 ${composition.lower} / 大写 ${composition.upper} / 数字 ${composition.digit} / 符号 ${composition.symbol}`;
    }
    if (result.type === 'passphrase') return `${model.wordCount} 个词 · ${model.separatorGapCount === 0 ? '无分隔符' : model.separatorChoicesPerGap > 1 ? '随机分隔符' : '固定分隔符'} · ${CAPITALIZATION_LABELS[model.capitalization] || '未标明大小写'}`;
    if (result.type === 'pin') return `${result.value.length} 位 · ${result.configSnapshot.uniqueWithinBatch ? '批内唯一' : '独立抽样'}`;
    if (['token', 'api-secret', 'hex'].includes(result.type)) return `${model.nominalCsprngOutputBits} 个随机位 · ${ENCODING_LABELS[model.encoding] || '编码输出'}`;
    if (result.type === 'random-bytes') return `${result.bytes.byteLength.toLocaleString('zh-CN')} 字节 · ${ENCODING_LABELS[result.configSnapshot.encoding] || '编码输出'} · SHA-256 ${result.sha256.slice(0, 12)}…`;
    if (result.type === 'uuid') {
      const timestamp = model.timestampUnixMs == null ? '' : ` · ${new Date(model.timestampUnixMs).toISOString()}`;
      return `UUID ${model.version} · 标识符，不是秘密${timestamp}`;
    }
    if (result.type === 'mnemonic') return `ENT ${model.entropyBits} / CS ${model.checksumBits} 比特 · ${model.wordCount} 个词 · ${LANGUAGE_LABELS[model.language] || model.language}`;
    return RESULT_TYPE_LABELS[result.type] || result.type;
  }

  function patternTooltipText(result) {
    if (!['password', 'passphrase'].includes(result.type)) return '此生成器不使用通用密码模式分析；安全语义请查看批次级安全分析。';
    const observed = assessmentFor(result).observedPattern;
    if (observed.status !== 'ready') return PATTERN_MESSAGES[observed.status] || PATTERN_MESSAGES.idle;
    const names = observed.sequences.map((item) => PATTERN_LABELS[item] || '其他模式');
    return `观察模式估算：${observed.guessBits == null ? '未给出启发式猜测强度' : `约 2^${observed.guessBits.toFixed(2)} 次猜测`}；${names.length ? `发现 ${names.join('、')}` : '未发现显著常见模式'}。这不会改变精确生成器指标。`;
  }

  function buildPatternIndicator(result, index, tooltipContainer) {
    const indicator = document.createElement('span'); indicator.className = 'result-pattern-indicator';
    indicator.dataset.patternIndicator = 'true';
    const button = iconButton('', RESULT_ICONS.info, () => {}, 'result-info-button');
    indicator.append(button);
    updatePatternIndicatorState(indicator, result, index);
    installTooltip(tooltipContainer, button, () => patternTooltipText(result), `result-pattern-tooltip-${result.id}`, { toggleOnClick: true, tooltipClass: 'result-pattern-tooltip' });
    return indicator;
  }

  function updatePatternIndicatorState(indicator, result, index) {
    const pattern = state.patterns.get(result.id);
    const status = pattern?.status || 'idle';
    const risky = status === 'ready' && Boolean(pattern.sequences?.length);
    indicator.dataset.state = status;
    if (risky) indicator.dataset.risk = 'true'; else delete indicator.dataset.risk;
    const button = indicator.querySelector('.result-info-button');
    if (!button) return;
    const stateLabel = risky ? '发现常见模式' : status === 'ready' ? '未发现显著模式' : PATTERN_MESSAGES[status] || PATTERN_MESSAGES.idle;
    button.setAttribute('aria-label', `第 ${index + 1} 条观察模式：${stateLabel}`);
    button.removeAttribute('title');
    const openTooltipId = button.getAttribute('aria-describedby');
    const openTooltip = openTooltipId ? document.getElementById(openTooltipId) : null;
    if (openTooltip) openTooltip.textContent = patternTooltipText(result);
  }

  function buildCompactResultRow(result, index) {
    const row = document.createElement('article'); row.className = 'compact-result-row'; row.dataset.resultId = result.id;
    row.dataset.resultNumber = String(index + 1); row.dataset.resultType = result.type;
    const number = document.createElement('span'); number.className = 'compact-result-number'; number.textContent = String(index + 1);
    const content = document.createElement('div'); content.className = 'compact-result-content';
    const value = document.createElement('button'); value.type = 'button'; value.className = 'compact-result-value';
    value.dataset.secretState = state.hidden.has(result.id) ? 'masked' : 'revealed'; value.textContent = resultDisplayText(result);
    value.setAttribute('aria-label', `复制第 ${index + 1} 条生成结果`);
    value.addEventListener('click', () => copyResults([result]).catch((error) => showToast(error.message, 'error')));
    const meta = document.createElement('div'); meta.className = 'compact-result-meta'; meta.textContent = compactResultMeta(result);
    content.append(value, meta); installTooltip(row, value, () => state.hidden.has(result.id) ? '内容已隐藏；请先使用显示按钮再查看完整结果。' : resultDisplayText(result), `result-value-tooltip-${result.id}`);
    if (result.type === 'random-bytes') {
      const fileDetails = document.createElement('details'); fileDetails.className = 'result-file-details';
      const summary = document.createElement('summary'); summary.textContent = '文件 SHA-256';
      const hash = document.createElement('code'); hash.dataset.fileSha256 = 'true'; hash.textContent = result.sha256;
      const copyHash = iconButton(`复制第 ${index + 1} 条文件 SHA-256`, RESULT_ICONS.copy, () => {
        copyText(result.sha256).then(success => showToast(success ? '已复制文件 SHA-256。' : '浏览器拒绝复制摘要。', success ? 'info' : 'error'))
          .catch(() => showToast('浏览器拒绝复制摘要。', 'error'));
      });
      installTooltip(fileDetails, copyHash, '复制完整文件 SHA-256，用于下载后核验。', `file-hash-tooltip-${result.id}`);
      fileDetails.append(summary, hash, copyHash); content.append(fileDetails);
    }
    const actions = document.createElement('div'); actions.className = 'compact-result-actions';
    if (['password', 'passphrase'].includes(result.type)) actions.append(buildPatternIndicator(result, index, row));
    const hidden = state.hidden.has(result.id);
    const toggle = iconButton(`${hidden ? '显示' : '隐藏'}第 ${index + 1} 条生成结果`, hidden ? RESULT_ICONS.reveal : RESULT_ICONS.hide, () => toggleReveal(result.id));
    toggle.dataset.secretToggle = 'true'; toggle.setAttribute('aria-pressed', String(!hidden));
    const copy = iconButton(`复制第 ${index + 1} 条生成结果`, RESULT_ICONS.copy, () => copyResults([result]).catch((error) => showToast(error.message, 'error')));
    const regenerate = iconButton(`重新生成第 ${index + 1} 条结果`, RESULT_ICONS.regenerate, () => regenerateResult(result.id), 'result-regenerate-button');
    regenerate.dataset.regenerateResult = 'true';
    const remove = iconButton(`删除第 ${index + 1} 条生成结果`, RESULT_ICONS.delete, () => deleteResult(result.id), 'result-delete-button');
    actions.append(toggle, copy, regenerate);
    if (result.type === 'random-bytes') actions.append(actionButton('下载', () => downloadResult(result), 'button-signal compact-download-button'));
    actions.append(remove);
    for (const [name, button] of [['toggle', toggle], ['copy', copy], ['regenerate', regenerate], ['delete', remove]]) {
      button.removeAttribute('title');
      installTooltip(actions, button, () => button.getAttribute('aria-label') || '', `result-action-tooltip-${name}-${result.id}`);
    }
    row.append(number, content, actions); return row;
  }

  function batchPatternContent(results) {
    if (!results.some((result) => ['password', 'passphrase'].includes(result.type))) return null;
    const aggregate = aggregatePatternStates(results, state.patterns, { analyzableTypes: ['password', 'passphrase'] });
    const layer = document.createElement('section'); layer.className = 'assessment-layer batch-pattern-summary';
    const heading = document.createElement('h4'); heading.textContent = '观察模式估算';
    const detail = document.createElement('p'); detail.dataset.batchPatternText = 'true';
    detail.textContent = `共 ${aggregate.total} 条：已完成 ${aggregate.completed} 条，发现常见模式 ${aggregate.risky} 条，分析中 ${aggregate.loading} 条，失败或降级 ${aggregate.failed} 条。每条结果右侧的提示图标可查看具体模式；经验分析不会覆盖精确生成器指标。`;
    layer.append(heading, detail); return layer;
  }

  function buildBatchAssessment(results) {
    const first = state.resultBatchSource || createBatchPresentationSnapshot(results[0], results.length);
    const assessment = assessmentForBatchSource(first);
    const details = document.createElement('details'); details.className = 'batch-assessment'; details.dataset.batchAssessment = 'true';
    const summary = document.createElement('summary'); summary.className = 'batch-assessment-summary';
    const heading = document.createElement('span'); heading.className = 'batch-assessment-title'; heading.textContent = '批次级安全分析';
    const count = document.createElement('span'); count.className = 'batch-assessment-count'; count.textContent = `${results.length} 条共用 1 份模型`;
    const profile = first.generationModel.presentationProfile;
    const primary = document.createElement('strong'); primary.className = 'batch-assessment-primary';
    primary.textContent = profile === 'uuid'
      ? `${first.generationModel.nominalCsprngOutputBits} 个随机位 · 标识符`
      : profile === 'random-bytes'
        ? `${assessment.randomBytes.nominalCsprngOutputBits.toLocaleString('zh-CN')} 个名义随机位`
        : `${formatBits(assessment.exactGenerator.generatorMinEntropyBits)} 最小熵`;
    const info = iconButton('批次级安全分析说明', RESULT_ICONS.info, () => {}, 'batch-info-button');
    summary.append(heading, count, primary, info); details.append(summary);
    installTooltip(summary, info, '同一批次使用同一份冻结配置与生成模型，因此精确指标和攻击场景只展示一次；只有具体字符串的观察模式可能逐条不同。', `batch-assessment-tooltip-${first.id}`, { toggleOnClick: true });
    const body = document.createElement('div'); body.className = 'batch-assessment-body'; body.dataset.batchAssessmentContent = 'true';
    body.append(profileContent(first, assessment, { includeObserved: false, shared: true }));
    const pattern = batchPatternContent(results); if (pattern) body.append(pattern);
    const model = document.createElement('details'); model.className = 'model-details';
    const modelSummary = document.createElement('summary'); modelSummary.textContent = '生成模型详情';
    const pre = document.createElement('pre'); pre.textContent = safeJson({ 当前结果数量: results.length, 生成时批次数量: first.quantity, ...localizedModelDetails(first, assessment) });
    model.append(modelSummary, pre); body.append(model); details.append(body); return details;
  }

  function refreshBatchAssessment() {
    if (!state.results.length) return;
    const detail = resultContainer.querySelector('[data-batch-pattern-text]');
    if (!detail) return;
    const aggregate = aggregatePatternStates(state.results, state.patterns, { analyzableTypes: ['password', 'passphrase'] });
    detail.textContent = `共 ${aggregate.total} 条：已完成 ${aggregate.completed} 条，发现常见模式 ${aggregate.risky} 条，分析中 ${aggregate.loading} 条，失败或降级 ${aggregate.failed} 条。每条结果右侧的提示图标可查看具体模式；经验分析不会覆盖精确生成器指标。`;
  }

  function renderResults() {
    resultToolbar.hidden = state.results.length === 0;
    if (!state.results.length) {
      const empty = document.createElement('div'); empty.className = 'empty-state'; const inner = document.createElement('div');
      const mark = document.createElement('div'); mark.className = 'empty-mark'; mark.textContent = '⌁';
      const heading = document.createElement('h3'); heading.textContent = '等待本地随机源';
      const text = document.createElement('p'); text.textContent = '生成不会自动复制；新结果默认显示明文，可以在原位置隐藏。';
      inner.append(mark, heading, text); empty.append(inner); resultContainer.replaceChildren(empty); return;
    }
    const list = document.createElement('div'); list.className = 'compact-result-list';
    list.append(...state.results.map((result, index) => buildCompactResultRow(result, index)));
    resultContainer.replaceChildren(list, buildBatchAssessment(state.results));
    updateAvailability();
  }

  function historyDisplayText(result) { return result.type === 'random-bytes' ? result.preview : result.value; }

  function installHistoryTooltip(row, trigger, result) {
    const tooltipId = `history-tooltip-${result.id}`;
    const show = () => {
      if (row.querySelector('.history-tooltip')) return;
      const tip = document.createElement('div'); tip.className = 'history-tooltip'; tip.id = tooltipId; tip.setAttribute('role', 'tooltip'); tip.textContent = historyDisplayText(result);
      trigger.setAttribute('aria-describedby', tooltipId); row.append(tip);
    };
    const hide = () => { row.querySelector('.history-tooltip')?.remove(); trigger.removeAttribute('aria-describedby'); };
    trigger.addEventListener('mouseenter', show); trigger.addEventListener('mouseleave', hide);
    trigger.addEventListener('focus', show); trigger.addEventListener('blur', hide);
  }

  function buildHistoryRow(result, index) {
    const row = document.createElement('div'); row.className = 'history-row'; row.dataset.historyId = result.id;
    const preview = document.createElement('button');
    preview.type = 'button'; preview.className = 'history-preview'; preview.textContent = historyDisplayText(result); preview.setAttribute('aria-label', `复制第 ${index + 1} 条生成记录`);
    preview.addEventListener('click', () => copyResults([result]).catch((error) => showToast(error.message, 'error')));
    const copy = historyIconButton(`复制第 ${index + 1} 条生成记录`, RESULT_ICONS.copy, () => copyResults([result]).catch((error) => showToast(error.message, 'error')), 'history-copy-button');
    const remove = historyIconButton(`删除第 ${index + 1} 条生成记录`, RESULT_ICONS.delete, () => deleteHistoryResult(result.id), 'history-delete-button');
    row.append(preview, copy, remove); installHistoryTooltip(row, preview, result); return row;
  }

  function renderHistory() {
    const entries = historyBudget.entries;
    const summaryCount = document.getElementById('history-summary-count');
    const toggle = document.getElementById('history-toggle');
    const status = document.getElementById('history-budget-status');
    if (toggle) toggle.checked = state.historyEnabled;
    if (summaryCount) summaryCount.textContent = state.historyEnabled ? `${entries.length} 条` : '未启用';
    if (status) status.textContent = `${historyBudget.totalBytes.toLocaleString('zh-CN')} / ${runtime.budgets.MAX_HISTORY_RAW_BYTES.toLocaleString('zh-CN')} 字节`;
    historyContainer.hidden = !state.historyEnabled;
    if (!state.historyEnabled) { historyContainer.replaceChildren(); return; }
    if (!entries.length) { const empty = document.createElement('p'); empty.className = 'history-copy'; empty.textContent = '生成记录已启用；只在当前页面内存中按 8 MiB 总预算保留。'; historyContainer.replaceChildren(empty); return; }
    const controls = document.createElement('div'); controls.className = 'history-controls'; controls.append(actionButton('清空记录', clearHistory, 'button-danger'));
    const list = document.createElement('div'); list.className = 'history-list'; list.append(...entries.map(buildHistoryRow));
    historyContainer.replaceChildren(controls, list);
  }

  function toggleReveal(id) { if (state.hidden.has(id)) state.hidden.delete(id); else state.hidden.add(id); updateSecretPresentation(id); }
  function deleteHistoryResult(id) { historyBudget.removeById(id); renderHistory(); }
  function deleteResult(id) {
    const current = state.results.find((result) => result.id === id);
    state.results = state.results.filter((result) => result.id !== id);
    const removedHistory = historyBudget.removeById(id);
    if (current && !removedHistory) runtime.results.clearGenerationResult(current);
    state.hidden.delete(id); state.patterns.delete(id);
    if (!state.results.length) { state.resultBatchRequest = null; state.resultBatchSource = null; }
    renderResults(); renderHistory();
  }
  function clearCurrentResults() { cancelActiveGeneration('清空结果'); for (const id of state.results.map((result) => result.id)) deleteResult(id); }
  function clearHistory() { historyBudget.clear(); renderResults(); renderHistory(); }
  function setHistoryEnabled(enabled) { state.historyEnabled = enabled; if (!enabled) clearHistory(); renderHistory(); }

  document.querySelectorAll('.mode-link').forEach((button) => button.addEventListener('click', () => setMode(button.dataset.mode)));
  addEventListener('hashchange', () => setMode(modeFromLocation(), true));
  form.addEventListener('submit', generateResults);
  form.addEventListener('reset', (event) => {
    event.preventDefault();
    cancelActiveGeneration('恢复默认');
    delete state.settings.modes[state.mode];
    persistSettings();
    renderConfig();
  });
  form.addEventListener('click', (event) => {
    const complexityButton = event.target.closest?.('[data-complexity-level]');
    if (complexityButton) {
      applyComplexityLevel(complexityButton.dataset.complexityLevel);
      return;
    }
    const lengthButton = event.target.closest?.('[data-password-length-preset]');
    if (lengthButton) {
      clearForcedCustomSlider('length');
      setPasswordFormValue('length', lengthButton.dataset.passwordLengthPreset);
      markPasswordComplexityCustom();
      saveNonSecretSettings();
      return;
    }
    const quantityButton = event.target.closest?.('[data-password-quantity-preset]');
    if (quantityButton) {
      clearForcedCustomSlider('quantity');
      setPasswordFormValue('quantity', quantityButton.dataset.passwordQuantityPreset);
      syncPasswordControls();
      saveNonSecretSettings();
      return;
    }
    const customButton = event.target.closest?.('[data-preset-custom]');
    if (customButton) {
      activateCustomSlider(customButton.dataset.presetCustom, { focusExact: true });
      saveNonSecretSettings();
    }
  });
  form.addEventListener('input', (event) => {
    syncRandomBytesQuantity();
    if (state.mode !== 'password') return;
    if (event.target.matches?.('[data-slider-input]')) {
      applySliderIndex(event.target.dataset.sliderInput, event.target.value);
      return;
    }
    if (event.target.name === 'length' || event.target.name === 'quantity') clearForcedCustomSlider(event.target.name);
    if (event.target.name === 'length') markPasswordComplexityCustom();
    if (event.target.name === 'length' || event.target.name === 'quantity') syncPasswordControls();
  });
  form.addEventListener('change', (event) => {
    syncRandomBytesQuantity();
    if (state.mode === 'password' && [
      'length', 'lowercase', 'uppercaseLetters', 'digits', 'symbols', 'allowSpace', 'symbolPool',
      'symbolMin', 'symbolMax', 'requireEach', 'allowRepeated', 'startsWith', 'endsWith',
    ].includes(event.target.name)) markPasswordComplexityCustom();
    saveNonSecretSettings();
    if (event.target.name === 'language') { updateMnemonicWarning(); ensureMnemonicLanguage(event.target.value); }
    if (event.target.name === 'apiTemplate') syncApiTemplate(); updateAvailability();
  });
  document.getElementById('copy-current').addEventListener('click', () => state.results[0] && copyResults([state.results[0]]).catch((error) => showToast(error.message, 'error')));
  document.getElementById('regenerate-all').addEventListener('click', () => generateResults());
  document.getElementById('copy-all').addEventListener('click', () => copyResults(state.results).catch((error) => showToast(error.message, 'error')));
  document.getElementById('clear-results').addEventListener('click', clearCurrentResults);
  document.getElementById('history-toggle').addEventListener('change', (event) => setHistoryEnabled(event.target.checked));
  document.getElementById('copy-share').addEventListener('click', () => copySharePromotion().catch((error) => showToast(error.message, 'error')));
  document.getElementById('back-to-top').addEventListener('click', () => scrollTo({ top: 0, left: 0, behavior: 'auto' }));
  addEventListener('scroll', updateBackToTop, { passive: true });
  addEventListener('resize', () => {
    updateBackToTop();
    if (state.mode === 'password') ['complexity', 'length', 'quantity'].forEach(revealActiveSliderMark);
  }, { passive: true });
  addEventListener('pagehide', () => { cancelActiveGeneration('页面离开'); releaseCurrentResults(); historyBudget.clear(); disposeAnalyzer('页面离开'); });
  addEventListener('pageshow', (event) => { if (event.persisted) initializeAnalyzer(); });

  initializePassphrase(); initializePinRisk(); initializeAnalyzer(); ensureMnemonicLanguage('english');
  setMode(state.mode, true); renderResults(); renderHistory(); renderResources(); updateBackToTop(); root.dataset.passwordGeneratorReady = 'true';
})();

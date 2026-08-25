'use strict';

(() => {
  const SETTINGS_KEY = 'password-generator:v2:settings';
  const SETTINGS_SCHEMA_VERSION = 20;
  const MAX_DOM_SECRET_CHARACTERS = 4096;
  const HISTORY_LIMIT = 100;
  const runtime = globalThis.PasswordGeneratorV2;
  if (!runtime) {
    document.documentElement.dataset.passwordGeneratorError = 'true';
    return;
  }

  const MODE_HASH_BY_MODE = Object.freeze({
    password: '#password',
    passphrase: '#passphrase',
    pin: '#pin',
    token: '#token',
    apiSecret: '#api-secret',
    uuid: '#uuid',
    hex: '#hex',
    randomBytes: '#random-bytes',
    mnemonic: '#mnemonic',
  });
  const MODE_BY_HASH = Object.freeze(Object.fromEntries(
    Object.entries(MODE_HASH_BY_MODE).map(([mode, hash]) => [hash, mode]),
  ));
  const MODE_META = Object.freeze({
    password: ['Password', '符号范围、必选类别、首尾、空格与禁止重复都进入同一个精确模型。', 'UNIFORM CONSTRAINED'],
    passphrase: ['Passphrase', '实际词包、大小写选择与每个随机分隔符共同决定结果空间。', 'WORD MODEL'],
    pin: ['PIN', 'completion-count DP 均匀采样，并精确扣除弱模式与本地排名库。', 'DP + RISK INDEX'],
    token: ['Token', '以随机字节数定义安全强度；编码和固定前缀不会增加熵。', 'BYTE ENTROPY'],
    apiSecret: ['API Secret', '通用测试密钥外观，可选独立 Key ID；不冒充服务商签发凭据。', 'BYTE ENTROPY'],
    uuid: ['UUID', 'RFC 9562 UUID v4 / v7；版本位、variant 和时间戳不计入随机熵。', 'RFC 9562'],
    hex: ['Hex', '直接编码 Web Crypto 随机字节；大小写与 0x 前缀只改变表示。', 'BYTE ENTROPY'],
    randomBytes: ['Random Bytes', '保留原始 Uint8Array，可显式复制编码文本或下载二进制。', 'RAW BYTES'],
    mnemonic: ['BIP39 Mnemonic', '官方词表与 SHA-256 checksum；校验和不增加 Generator Min-Entropy。', 'BIP39'],
  });
  const LANGUAGE_ASSETS = Object.freeze({
    english: 'english.v2.js', czech: 'czech.v2.js', french: 'french.v2.js', italian: 'italian.v2.js',
    japanese: 'japanese.v2.js', korean: 'korean.v2.js', portuguese: 'portuguese.v2.js',
    'simplified-chinese': 'simplified-chinese.v2.js', spanish: 'spanish.v2.js',
    'traditional-chinese': 'traditional-chinese.v2.js',
  });
  const LANGUAGE_LABELS = Object.freeze({
    english: 'English', czech: 'Čeština', french: 'Français', italian: 'Italiano', japanese: '日本語',
    korean: '한국어', portuguese: 'Português', 'simplified-chinese': '简体中文', spanish: 'Español',
    'traditional-chinese': '繁體中文',
  });
  const RESOURCE_MESSAGES = Object.freeze({
    idle: '尚未加载安全分析',
    loading: '安全分析正在加载',
    ready: '安全分析已完成',
    degraded: '部分安全分析不可用，当前显示生成器精确熵',
    error: '安全资源加载失败，请重试',
  });
  const state = {
    mode: MODE_BY_HASH[location.hash.toLowerCase()] || 'password',
    results: [],
    revealedResultIds: new Set(),
    historyEnabled: false,
    history: [],
    busy: false,
    settings: loadSettings(),
    patterns: new Map(),
    pinRiskIndex: null,
    resources: {
      crypto: globalThis.crypto?.getRandomValues
        ? { status: 'ready', detail: 'Web Crypto 随机源' }
        : { status: 'error', detail: 'Web Crypto 不可用 · 已停止生成' },
      zxcvbn: { status: 'idle', detail: '模式分析' },
      pinRisk: { status: 'loading', detail: 'PIN 风险库' },
      passphrase: { status: 'loading', detail: 'Passphrase 词包' },
      mnemonic: { status: 'loading', detail: 'BIP39 English' },
    },
  };
  const resourcePromises = new Map();
  let toastTimer = 0;

  const form = document.getElementById('generator-form');
  const configBody = document.getElementById('config-body');
  const resultContainer = document.getElementById('result-container');
  const historyContainer = document.getElementById('history-container');
  const resultToolbar = document.getElementById('result-toolbar');
  const generateButton = document.getElementById('generate-button');

  function loadSettings() {
    try {
      const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
      return parsed.schema === SETTINGS_SCHEMA_VERSION && parsed.modes && typeof parsed.modes === 'object'
        ? parsed
        : { schema: SETTINGS_SCHEMA_VERSION, modes: {} };
    } catch {
      return { schema: SETTINGS_SCHEMA_VERSION, modes: {} };
    }
  }

  function saveNonSecretSettings() {
    const data = new FormData(form);
    const allowed = new Set([
      'length', 'quantity', 'wordCount', 'capitalization', 'separator', 'pack', 'allowLeadingZero',
      'allowRepeated', 'limitSequential', 'blockWeak', 'byteLength', 'encoding', 'uppercase',
      'includePrefix', 'version', 'hyphens', 'entropyBits', 'language', 'requireEach', 'allowSpace',
      'lowercase', 'uppercaseLetters', 'digits', 'symbols', 'symbolMin', 'symbolMax', 'startsWith',
      'endsWith', 'includeKeyId', 'apiTemplate', 'hexScheme',
    ]);
    const values = {};
    for (const element of form.elements) {
      if (!element.name || !allowed.has(element.name)) continue;
      values[element.name] = element.type === 'checkbox' ? element.checked : data.get(element.name);
    }
    state.settings.modes[state.mode] = values;
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
    } catch {
      // 设置持久化失败不影响生成，秘密从不进入这里。
    }
  }

  function applySavedSettings() {
    const values = state.settings.modes[state.mode];
    if (!values) return;
    for (const [name, value] of Object.entries(values)) {
      const element = form.elements.namedItem(name);
      if (!element || (!element.tagName && typeof element.length === 'number')) continue;
      if (element.type === 'checkbox') element.checked = Boolean(value);
      else element.value = String(value);
    }
  }

  function numberField(name, fallback) {
    const value = Number(new FormData(form).get(name));
    return Number.isFinite(value) ? value : fallback;
  }

  function quantityMarkup(max = 100) {
    return `<div class="field"><label for="quantity">生成数量</label><input id="quantity" name="quantity" type="number" min="1" max="${max}" step="1" value="1"><small>批量结果仍逐条遮蔽。</small></div>`;
  }

  function checkbox(name, label, checked = false) {
    return `<label class="check"><input name="${name}" type="checkbox"${checked ? ' checked' : ''}>${label}</label>`;
  }

  const CONFIG_TEMPLATES = Object.freeze({
    password: () => `<div class="field-grid">
      <div class="field"><label for="length">密码长度</label><input id="length" name="length" type="number" min="1" max="4096" value="20"><small>复杂长配置在独立 Worker 中计算。</small></div>${quantityMarkup()}
      <div class="field full"><span class="field-label">字符类型</span><div class="checks">${checkbox('lowercase', '小写字母', true)}${checkbox('uppercaseLetters', '大写字母', true)}${checkbox('digits', '数字', true)}${checkbox('symbols', '符号', true)}${checkbox('allowSpace', '内部空格')}</div></div>
      <div class="field full"><label for="symbolPool">符号字符池</label><input id="symbolPool" name="symbolPool" type="text" value="!@#$%^&amp;*()-_=+[]{};:,.?" autocomplete="off" spellcheck="false"><small>与字母或数字重叠的字符会被移除。</small></div>
      <div class="field"><span class="field-label">符号占比</span><div class="range-pair"><div class="range-unit"><input name="symbolMin" type="number" min="0" max="100" value="10" aria-label="最小符号百分比"></div><div class="range-unit"><input name="symbolMax" type="number" min="0" max="100" value="35" aria-label="最大符号百分比"></div></div></div>
      <div class="field"><span class="field-label">高级约束</span><div class="checks">${checkbox('requireEach', '每类至少一个', true)}${checkbox('allowRepeated', '允许重复', true)}</div></div>
      <div class="field"><label for="startsWith">首字符</label><select id="startsWith" name="startsWith"><option value="any">任意已启用类别</option><option value="letter">字母</option><option value="digit">数字</option><option value="symbol">符号</option></select></div>
      <div class="field"><label for="endsWith">尾字符</label><select id="endsWith" name="endsWith"><option value="any">任意已启用类别</option><option value="letter">字母</option><option value="digit">数字</option><option value="symbol">符号</option></select></div>
    </div>`,
    passphrase: () => `<div class="field-grid">
      <div class="field"><label for="wordCount">单词数量</label><input id="wordCount" name="wordCount" type="number" min="1" max="100" value="6"></div>${quantityMarkup()}
      <div class="field full"><label for="pack">本地词包</label><select id="pack" name="pack"></select><small>使用实际唯一词数，不以标签规模代替。</small></div>
      <div class="field"><label for="capitalization">大小写</label><select id="capitalization" name="capitalization"><option value="lowercase">全部小写</option><option value="first-word">首词首字母大写</option><option value="every-word">每词首字母大写</option><option value="random-uppercase">随机一个词全大写</option></select></div>
      <div class="field"><label for="separator">分隔符</label><select id="separator" name="separator"><option value="hyphen">固定连字符 -</option><option value="underscore">固定下划线 _</option><option value="period">固定句点 .</option><option value="space">固定空格</option><option value="random-digit">每个间隔随机数字</option><option value="random-symbol">每个间隔随机符号</option></select></div>
      <div class="field full"><label for="separatorSymbols">随机符号候选</label><input id="separatorSymbols" name="separatorSymbols" type="text" value="!@#$%&amp;*+?" autocomplete="off" spellcheck="false"></div>
    </div>`,
    pin: () => `<div class="field-grid">
      <div class="field"><label for="length">PIN 长度</label><select id="length" name="length"><option>4</option><option selected>6</option><option>8</option><option>12</option><option>16</option><option>24</option><option>32</option></select></div>${quantityMarkup()}
      <div class="field full"><span class="field-label">PIN 规则</span><div class="checks">${checkbox('allowLeadingZero', '允许前导零', true)}${checkbox('allowRepeated', '允许重复数字', true)}${checkbox('limitSequential', '限制连续数字', true)}${checkbox('blockWeak', '排除明显弱 PIN', true)}</div><small>弱 PIN 排除要求本地风险模型 ready。</small></div>
    </div>`,
    token: () => `<div class="field-grid">
      <div class="field"><label for="byteLength">随机字节数</label><input id="byteLength" name="byteLength" type="number" min="1" max="4096" value="32"><small>32 bytes = 256 bits 源熵。</small></div>${quantityMarkup()}
      <div class="field"><label for="encoding">编码</label><select id="encoding" name="encoding"><option value="base64url-nopad">Base64URL 无 padding</option><option value="base64url">Base64URL</option><option value="base64">Base64</option><option value="hex">Hex</option></select></div>
      <div class="field"><label for="prefix">固定前缀</label><input id="prefix" name="prefix" type="text" value="tok_" autocomplete="off" spellcheck="false"><small>固定前缀不计入熵，也不会保存。</small></div>
    </div>`,
    apiSecret: () => `<div class="field-grid">
      <div class="field"><label for="byteLength">Secret 随机字节</label><input id="byteLength" name="byteLength" type="number" min="1" max="4096" value="32"></div>${quantityMarkup()}
      <div class="field"><label for="apiTemplate">外观模板</label><select id="apiTemplate" name="apiTemplate"><option value="generic">通用</option><option value="sk_test">sk_test_（仅测试）</option><option value="sk_live">sk_live_（仅测试）</option></select></div>
      <div class="field"><label for="encoding">编码</label><select id="encoding" name="encoding"><option value="base64url-nopad">Base64URL 无 padding</option><option value="hex">Hex</option><option value="base64">Base64</option></select></div>
      <div class="field"><label for="prefix">自定义固定前缀</label><input id="prefix" name="prefix" type="text" value="api_" autocomplete="off" spellcheck="false"></div>
      <div class="field"><label for="environment">环境字段</label><input id="environment" name="environment" type="text" value="test" autocomplete="off"></div>
      <div class="field"><label for="apiVersion">版本字段</label><input id="apiVersion" name="apiVersion" type="text" value="v1" autocomplete="off"></div>
      <div class="field"><span class="field-label">复合凭据</span><div class="checks">${checkbox('includeKeyId', '独立生成 Key ID')}</div></div>
    </div>`,
    uuid: () => `<div class="field-grid">
      <div class="field"><label for="version">UUID 版本</label><select id="version" name="version"><option value="4">UUID v4 · 122 random bits</option><option value="7">UUID v7 · 74 random bits</option></select></div>${quantityMarkup()}
      <div class="field full"><span class="field-label">显示格式</span><div class="checks">${checkbox('hyphens', '保留连字符', true)}${checkbox('uppercase', '大写')}</div></div>
    </div>`,
    hex: () => `<div class="field-grid">
      <div class="field"><label for="byteLength">随机字节数</label><input id="byteLength" name="byteLength" type="number" min="1" max="4096" value="32"></div>${quantityMarkup()}
      <div class="field full"><span class="field-label">显示格式</span><div class="checks">${checkbox('uppercase', '大写 Hex')}${checkbox('includePrefix', '添加 0x 前缀')}</div></div>
      <div class="field full"><label for="hexScheme">用途标记</label><select id="hexScheme" name="hexScheme"><option value="random-hex">通用随机 Hex</option><option value="wallet-private-key-appearance">钱包私钥外观（仅测试，不校验曲线）</option></select></div>
    </div>`,
    randomBytes: () => `<div class="field-grid">
      <div class="field"><label for="byteLength">原始字节数</label><input id="byteLength" name="byteLength" type="number" min="1" max="1048576" value="64"><small>最大 1 MiB；长输出默认不渲染明文。</small></div>${quantityMarkup(10)}
      <div class="field"><label for="encoding">预览 / 复制编码</label><select id="encoding" name="encoding"><option value="hex">Hex</option><option value="base64">Base64</option><option value="base64url">Base64URL</option><option value="base64url-nopad">Base64URL 无 padding</option></select></div>
      <div class="field"><span class="field-label">Hex 格式</span><div class="checks">${checkbox('uppercase', '大写')}</div></div>
    </div>`,
    mnemonic: () => `<div class="field-grid">
      <div class="field"><label for="entropyBits">ENT / 单词数</label><select id="entropyBits" name="entropyBits"><option value="128">128 bits · 12 words</option><option value="160">160 bits · 15 words</option><option value="192">192 bits · 18 words</option><option value="224">224 bits · 21 words</option><option value="256">256 bits · 24 words</option></select></div>${quantityMarkup(20)}
      <div class="field full"><label for="language">BIP39 官方词表</label><select id="language" name="language">${Object.entries(LANGUAGE_LABELS).map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select><small>Checksum 是确定性字段，不增加源熵。本页不派生 seed、地址或私钥。</small></div>
    </div>`,
  });

  function renderConfig() {
    const [title, description, badge] = MODE_META[state.mode];
    document.getElementById('config-title').textContent = title;
    document.getElementById('config-description').textContent = description;
    document.getElementById('model-badge').textContent = badge;
    configBody.innerHTML = CONFIG_TEMPLATES[state.mode]();
    if (state.mode === 'passphrase') populateWordPacks();
    applySavedSettings();
    if (state.mode === 'mnemonic') ensureMnemonicLanguage(form.elements.language.value);
    updateGenerationAvailability();
  }

  function populateWordPacks() {
    const select = form.elements.pack;
    const packs = globalThis.EmbeddedWordPacksV1?.packs || {};
    const options = Object.values(packs).map((pack) => {
      const option = document.createElement('option');
      option.value = pack.id;
      option.textContent = `${pack.label} · ${pack.count.toLocaleString('zh-CN')} 词`;
      option.selected = pack.id === 'memorable-long';
      return option;
    });
    select.replaceChildren(...options);
  }

  function modeFromLocation() {
    return MODE_BY_HASH[location.hash.toLowerCase()] || 'password';
  }

  function setMode(mode, replace = false) {
    if (!MODE_HASH_BY_MODE[mode]) mode = 'password';
    state.mode = mode;
    const hash = MODE_HASH_BY_MODE[mode];
    if (location.hash !== hash) history[replace ? 'replaceState' : 'pushState'](null, '', hash);
    document.querySelectorAll('.mode-link').forEach((button) => {
      button.setAttribute('aria-current', button.dataset.mode === mode ? 'page' : 'false');
    });
    renderConfig();
  }

  function showToast(message, tone = 'info') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.dataset.tone = tone;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.hidden = true;
      toast.textContent = '';
    }, 4200);
  }

  function setResource(name, status, detail) {
    state.resources[name] = { status, detail: detail || state.resources[name]?.detail || name };
    renderResources();
    updateGenerationAvailability();
  }

  function renderResources() {
    const strip = document.getElementById('resource-strip');
    strip.replaceChildren(...Object.entries(state.resources).map(([name, resource]) => {
      const item = document.createElement('span');
      item.className = 'resource-item';
      item.dataset.state = resource.status;
      const dot = document.createElement('span');
      dot.className = 'resource-dot';
      const label = document.createElement('span');
      label.textContent = `${resource.detail} · ${resource.status}`;
      item.append(dot, label);
      if (resource.status === 'error') {
        const retry = actionButton('重试', () => retryResource(name));
        item.append(retry);
      }
      return item;
    }));
  }

  function updateGenerationAvailability() {
    const weakPinBlocked = state.mode === 'pin'
      && form.elements.blockWeak?.checked
      && state.resources.pinRisk.status !== 'ready';
    const blocked = state.busy
      || !globalThis.crypto?.getRandomValues
      || state.mode === 'passphrase' && state.resources.passphrase.status !== 'ready'
      || weakPinBlocked
      || state.mode === 'mnemonic' && state.resources.mnemonic.status !== 'ready';
    generateButton.disabled = blocked;
    generateButton.textContent = state.busy ? '正在安全生成…' : '生成';
  }

  function loadLocalScriptOnce(src, globalCheck) {
    if (globalCheck()) return Promise.resolve();
    if (resourcePromises.has(src)) return resourcePromises.get(src);
    const promise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = () => globalCheck() ? resolve() : reject(new Error(`资源未注册：${src}`));
      script.onerror = () => reject(new Error(`资源加载失败：${src}`));
      document.head.appendChild(script);
    }).catch((error) => {
      resourcePromises.delete(src);
      throw error;
    });
    resourcePromises.set(src, promise);
    return promise;
  }

  async function ensureMnemonicLanguage(language) {
    const status = runtime.bip39.getBip39WordlistStatus(language);
    if (status.state === 'ready') {
      setResource('mnemonic', 'ready', `BIP39 ${LANGUAGE_LABELS[language]}`);
      return;
    }
    setResource('mnemonic', 'loading', `BIP39 ${LANGUAGE_LABELS[language]}`);
    try {
      await loadLocalScriptOnce(
        `./assets/v2/bip39/${LANGUAGE_ASSETS[language]}`,
        () => runtime.bip39.getBip39WordlistStatus(language).state === 'ready',
      );
      setResource('mnemonic', 'ready', `BIP39 ${LANGUAGE_LABELS[language]}`);
    } catch (error) {
      setResource('mnemonic', 'error', `BIP39 ${LANGUAGE_LABELS[language]}`);
      showToast(error.message, 'error');
    }
  }

  async function retryResource(name) {
    if (name === 'mnemonic') return ensureMnemonicLanguage(form.elements.language?.value || 'english');
    if (name === 'pinRisk') return initializePinRisk();
    if (name === 'passphrase') return initializePassphrase();
    if (name === 'zxcvbn') return initializeAnalyzer();
  }

  function initializePassphrase() {
    const ready = Boolean(globalThis.EmbeddedWordPacksV1?.packs
      && Object.keys(globalThis.EmbeddedWordPacksV1.packs).length);
    setResource('passphrase', ready ? 'ready' : 'error', 'Passphrase 词包');
  }

  function initializePinRisk() {
    setResource('pinRisk', 'loading', 'PIN 风险库');
    try {
      state.pinRiskIndex = runtime.pin.createPinRiskIndex(
        globalThis.PasswordGeneratorV2Assets?.pinRisk,
      );
      setResource('pinRisk', 'ready', 'PIN 风险库');
    } catch {
      state.pinRiskIndex = null;
      setResource('pinRisk', 'error', 'PIN 风险库');
    }
  }

  function initializeAnalyzer() {
    setResource('zxcvbn', 'loading', '模式分析');
    const analyzer = globalThis.PasswordGeneratorV2Zxcvbn;
    setResource(
      'zxcvbn',
      analyzer && typeof analyzer.analyzePassword === 'function' ? 'ready' : 'degraded',
      '模式分析',
    );
  }

  function readConfig() {
    const data = new FormData(form);
    const quantity = numberField('quantity', 1);
    const maximum = state.mode === 'randomBytes' ? 10 : state.mode === 'mnemonic' ? 20 : 100;
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > maximum) {
      throw new RangeError('生成数量超出当前类型允许范围。');
    }
    switch (state.mode) {
      case 'password':
        return { quantity, config: {
          length: numberField('length', 20),
          lowercase: data.has('lowercase'), uppercase: data.has('uppercaseLetters'),
          digits: data.has('digits'), symbols: data.has('symbols'), symbolPool: data.get('symbolPool'),
          allowSpace: data.has('allowSpace'), requireEach: data.has('requireEach'),
          allowRepeated: data.has('allowRepeated'),
          symbolRatioRange: [numberField('symbolMin', 0), numberField('symbolMax', 100)],
          startsWith: data.get('startsWith'), endsWith: data.get('endsWith'),
        } };
      case 'passphrase': {
        const packId = data.get('pack');
        const pack = globalThis.EmbeddedWordPacksV1?.packs?.[packId];
        if (!pack) throw new Error('所选 Passphrase 词包尚未 ready。');
        return { quantity, config: {
          wordCount: numberField('wordCount', 6), words: pack.entries, wordPackId: pack.id,
          capitalization: data.get('capitalization'), separator: data.get('separator'),
          separatorSymbols: data.get('separatorSymbols'),
        } };
      }
      case 'pin':
        return { quantity, config: {
          length: numberField('length', 6), allowLeadingZero: data.has('allowLeadingZero'),
          allowRepeated: data.has('allowRepeated'), limitSequential: data.has('limitSequential'),
          blockWeak: data.has('blockWeak'),
        } };
      case 'token':
        return { quantity, config: {
          byteLength: numberField('byteLength', 32), encoding: data.get('encoding'), prefix: data.get('prefix'),
        } };
      case 'apiSecret': {
        const template = data.get('apiTemplate');
        const prefix = template === 'sk_test' ? 'sk_test_' : template === 'sk_live' ? 'sk_live_' : data.get('prefix');
        return { quantity, config: {
          byteLength: numberField('byteLength', 32), encoding: data.get('encoding'), prefix,
          environment: data.get('environment'), version: data.get('apiVersion'),
          template: template === 'generic' ? null : template,
          keyId: data.has('includeKeyId')
            ? { byteLength: 12, encoding: 'base64url-nopad', prefix: 'kid_' }
            : false,
        } };
      }
      case 'uuid':
        return { quantity, config: {
          version: numberField('version', 4), hyphens: data.has('hyphens'), uppercase: data.has('uppercase'),
        } };
      case 'hex':
        return { quantity, config: {
          byteLength: numberField('byteLength', 32), uppercase: data.has('uppercase'),
          prefix: data.has('includePrefix'), schemeId: data.get('hexScheme'),
        } };
      case 'randomBytes':
        return { quantity, config: {
          byteLength: numberField('byteLength', 64), encoding: data.get('encoding'),
          uppercase: data.has('uppercase'),
        } };
      case 'mnemonic':
        return { quantity, config: {
          entropyBits: numberField('entropyBits', 128), language: data.get('language'),
        } };
      default:
        throw new RangeError('未知生成器类型。');
    }
  }

  function generatePasswordInWorker(config) {
    if (!globalThis.Worker || location.protocol === 'file:') {
      return Promise.resolve(runtime.password.generatePassword(config));
    }
    return new Promise((resolve, reject) => {
      const worker = new Worker('./assets/v2/password-worker.v2.js');
      const timer = setTimeout(() => {
        worker.terminate();
        reject(new Error('复杂密码模型计算超时，请缩短长度或收窄约束。'));
      }, 180000);
      worker.onmessage = ({ data }) => {
        clearTimeout(timer);
        worker.terminate();
        if (!data.ok) {
          reject(new Error(data.error));
          return;
        }
        try {
          const { bytes, ...serializedResult } = data.result;
          resolve(runtime.results.createGenerationResult({
            ...serializedResult,
            ...(bytes instanceof Uint8Array ? { bytes } : {}),
          }));
        } catch (error) {
          reject(error);
        }
      };
      worker.onerror = () => {
        clearTimeout(timer);
        worker.terminate();
        reject(new Error('密码计算 Worker 启动失败。'));
      };
      worker.postMessage({ config });
    });
  }

  async function generateOne(config) {
    switch (state.mode) {
      case 'password': return generatePasswordInWorker(config);
      case 'passphrase': return runtime.passphrase.generatePassphrase(config);
      case 'pin': return runtime.pin.generatePin(config, config.blockWeak ? state.pinRiskIndex : undefined);
      case 'token': return runtime.byteSecrets.generateToken(config);
      case 'apiSecret': return runtime.byteSecrets.generateApiSecret(config);
      case 'uuid': return config.version === 7
        ? runtime.uuid.generateUuidV7(config)
        : runtime.uuid.generateUuidV4(config);
      case 'hex': return runtime.byteSecrets.generateHex(config);
      case 'randomBytes': return runtime.byteSecrets.generateRandomBytes(config);
      case 'mnemonic': return runtime.bip39.generateMnemonic(config);
      default: throw new RangeError('未知生成器类型。');
    }
  }

  async function generateResults(event) {
    event?.preventDefault();
    if (state.busy) return;
    if (!globalThis.crypto?.getRandomValues) {
      showToast('Web Crypto 不可用，已停止生成。', 'error');
      return;
    }
    state.busy = true;
    updateGenerationAvailability();
    saveNonSecretSettings();
    try {
      const { quantity, config } = readConfig();
      if (state.mode === 'mnemonic'
        && runtime.bip39.getBip39WordlistStatus(config.language).state !== 'ready') {
        throw new Error('所选 BIP39 词表尚未 ready。');
      }
      const next = [];
      for (let index = 0; index < quantity; index += 1) {
        next.push(await generateOne(config));
      }
      releaseReplacedResults(next);
      state.results = next;
      state.revealedResultIds.clear();
      appendHistory(next);
      renderResults();
      analyzeResults(next);
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      state.busy = false;
      updateGenerationAvailability();
    }
  }

  function releaseReplacedResults(next) {
    const retained = new Set([...next, ...state.history].map((result) => result.id));
    for (const result of state.results) {
      if (!retained.has(result.id)) runtime.results.clearGenerationResult(result);
    }
  }

  function appendHistory(entries) {
    if (!state.historyEnabled) return;
    const combined = [
      ...entries,
      ...state.history.filter((old) => !entries.some((entry) => entry.id === old.id)),
    ];
    const removed = combined.slice(HISTORY_LIMIT);
    state.history = combined.slice(0, 100);
    for (const result of removed) {
      if (!state.results.some((current) => current.id === result.id)) {
        runtime.results.clearGenerationResult(result);
      }
    }
    renderHistory();
  }

  function analyzeResults(results) {
    const analyzer = globalThis.PasswordGeneratorV2Zxcvbn;
    for (const result of results) {
      if (!['password', 'passphrase'].includes(result.type)) {
        state.patterns.set(result.id, { status: 'ready', guesses: null, patterns: [] });
        continue;
      }
      if (state.resources.zxcvbn.status !== 'ready' || !analyzer?.analyzePassword) {
        state.patterns.set(result.id, {
          status: state.resources.zxcvbn.status,
          guesses: null,
          patterns: [],
        });
        continue;
      }
      Promise.resolve().then(() => analyzer.analyzePassword(result.value)).then((analysis) => {
        state.patterns.set(result.id, {
          status: 'ready',
          guesses: analysis.patternGuesses,
          patterns: analysis.patterns || [],
        });
        renderResults();
        renderHistory();
      }).catch(() => {
        state.patterns.set(result.id, { status: 'error', guesses: null, patterns: [] });
        renderResults();
        renderHistory();
      });
    }
    renderResults();
    renderHistory();
  }

  function resultPlaintext(result) {
    if (result.fields?.keyId && result.fields?.secret) {
      return `Key ID: ${result.fields.keyId}\nSecret: ${result.fields.secret}`;
    }
    return result.value;
  }

  function maskedValue() {
    return '••••••••••••••••••••••••';
  }

  function formatSearchSpace(value) {
    if (typeof value !== 'bigint') return '—';
    return value < 1_000_000_000_000_000n
      ? value.toLocaleString('zh-CN')
      : runtime.combinatorics.formatBigIntScientific(value, 4);
  }

  function formatGuessBits(bits) {
    return bits < 48
      ? Math.max(1, Math.round(2 ** bits)).toLocaleString('zh-CN')
      : `约 2^${bits.toFixed(2)}`;
  }

  function assessmentFor(result) {
    const pattern = state.patterns.get(result.id) || {
      status: ['password', 'passphrase'].includes(result.type)
        ? state.resources.zxcvbn.status
        : 'ready',
      guesses: null,
      patterns: [],
    };
    return runtime.assessment.createAssessment({
      generationModel: result.generationModel,
      patternAnalysis: pattern,
    });
  }

  function actionButton(label, handler, extraClass = '') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `button button-small ${extraClass}`.trim();
    button.textContent = label;
    button.addEventListener('click', handler);
    return button;
  }

  function metric(label, value) {
    const node = document.createElement('div');
    node.className = 'metric';
    const key = document.createElement('span');
    key.className = 'metric-label';
    key.textContent = label;
    const data = document.createElement('span');
    data.className = 'metric-value';
    data.textContent = value;
    node.append(key, data);
    return node;
  }

  function buildResultCard(result, index, context = 'current') {
    const card = document.createElement('article');
    card.className = 'result-card';
    card.dataset.resultId = result.id;

    const head = document.createElement('div');
    head.className = 'result-card-head';
    const type = document.createElement('span');
    type.className = 'result-type';
    type.textContent = result.type;
    const number = document.createElement('span');
    number.className = 'result-number';
    number.textContent = `${context === 'history' ? 'H' : '#'}${index + 1}`;
    head.append(type, number);

    const box = document.createElement('div');
    box.className = 'secret-box';
    const value = document.createElement('div');
    value.className = 'secret-value';
    const revealed = state.revealedResultIds.has(result.id);
    value.dataset.secretState = revealed ? 'revealed' : 'masked';
    const plaintext = revealed ? resultPlaintext(result) : '';
    if (!revealed) {
      value.textContent = maskedValue();
    } else if (plaintext.length <= MAX_DOM_SECRET_CHARACTERS) {
      value.textContent = plaintext;
    } else {
      value.textContent = '明文过长，未渲染到 DOM。请显式复制或下载。';
      value.classList.add('secret-summary');
    }
    box.append(value);

    const actions = document.createElement('div');
    actions.className = 'result-actions';
    actions.append(
      actionButton(revealed ? '隐藏明文' : '显示明文', () => toggleReveal(result.id)),
      actionButton('复制', () => copyResult(result)),
    );
    if (result.type === 'random-bytes' && result.bytes) {
      actions.append(actionButton('下载原始字节', () => downloadResult(result), 'button-signal'));
    }
    actions.append(actionButton('删除', () => deleteResult(result.id), 'button-danger'));

    const assessment = assessmentFor(result);
    const metrics = document.createElement('div');
    metrics.className = 'metric-grid';
    metrics.append(
      metric('Generator Min-Entropy', `${result.generationModel.minEntropyBits.toFixed(2)} bits`),
      metric('Search Space', formatSearchSpace(result.generationModel.searchSpace)),
      metric('Effective Guess Count', formatGuessBits(assessment.effectiveGuessBits)),
      metric('强度等级', `${assessment.strength.level} · ${assessment.strength.label}`),
    );

    const attacks = document.createElement('ul');
    attacks.className = 'attack-list';
    for (const key of ['online', 'slowHash', 'fastOffline']) {
      const item = document.createElement('li');
      const label = document.createElement('span');
      const estimate = document.createElement('strong');
      label.textContent = runtime.assessment.ATTACK_MODELS[key].label;
      estimate.textContent = assessment.attackTimes[key].label;
      item.append(label, estimate);
      attacks.append(item);
    }

    const pattern = document.createElement('p');
    pattern.className = 'pattern-state';
    pattern.textContent = ['password', 'passphrase'].includes(result.type)
      ? assessment.patternMessage || RESOURCE_MESSAGES[assessment.patternStatus]
      : '此标准格式使用精确生成模型；常见密码模式分析不适用。';
    card.append(head, box, actions, metrics, attacks, pattern);
    return card;
  }

  function renderResults() {
    resultToolbar.hidden = state.results.length === 0;
    if (!state.results.length) {
      resultContainer.innerHTML = '<div class="empty-state"><div><div class="empty-mark">⌁</div><h3>等待本地随机源</h3><p>点击“生成”不会写入系统剪贴板。秘密在主动显示前不会进入可见 DOM。</p></div></div>';
      return;
    }
    resultContainer.replaceChildren(
      ...state.results.map((result, index) => buildResultCard(result, index)),
    );
  }

  function renderHistory() {
    historyContainer.hidden = !state.historyEnabled;
    if (!state.historyEnabled) {
      historyContainer.replaceChildren();
      return;
    }
    if (!state.history.length) {
      const empty = document.createElement('p');
      empty.className = 'history-copy';
      empty.textContent = 'History 已启用，下一次生成后会在当前内存中保留结果。';
      historyContainer.replaceChildren(empty);
      return;
    }
    const controls = document.createElement('div');
    controls.className = 'result-toolbar';
    controls.append(actionButton('清空 History', clearHistory, 'button-danger'));
    historyContainer.replaceChildren(
      controls,
      ...state.history.map((result, index) => buildResultCard(result, index, 'history')),
    );
  }

  function toggleReveal(id) {
    if (state.revealedResultIds.has(id)) state.revealedResultIds.delete(id);
    else state.revealedResultIds.add(id);
    renderResults();
    renderHistory();
  }

  async function copyText(text) {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        // 使用受控 fallback。
      }
    }
    const textarea = document.createElement('textarea');
    try {
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      return document.execCommand('copy');
    } finally {
      textarea.value = '';
      textarea.remove();
    }
  }

  async function copyResult(result) {
    try {
      const copied = await copyText(resultPlaintext(result));
      if (!copied) throw new Error('浏览器拒绝了复制请求。');
      showToast('已写入系统剪贴板；请留意剪贴板历史、跨设备同步与其他应用权限。');
    } catch {
      showToast('复制失败；浏览器未授予剪贴板权限，明文未保留在临时 DOM。', 'error');
    }
  }

  async function copyCurrentResult() {
    if (state.results[0]) await copyResult(state.results[0]);
  }

  async function copyAllResults() {
    if (!state.results.length) return;
    try {
      const copied = await copyText(state.results.map(resultPlaintext).join('\n'));
      if (!copied) throw new Error('浏览器拒绝了复制请求。');
      showToast('全部结果已显式写入系统剪贴板。');
    } catch {
      showToast('复制失败；浏览器未授予剪贴板权限，明文未保留在临时 DOM。', 'error');
    }
  }

  function downloadResult(result) {
    const download = runtime.byteSecrets.createBinaryDownload(result.bytes, {
      mimeType: 'application/octet-stream',
    });
    const anchor = document.createElement('a');
    anchor.href = download.url;
    anchor.download = `random-bytes-${result.id}.bin`;
    anchor.hidden = true;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => download.revoke(), 0);
  }

  function deleteResult(id) {
    const targets = [...state.results, ...state.history].filter((result) => result.id === id);
    state.results = state.results.filter((result) => result.id !== id);
    state.history = state.history.filter((result) => result.id !== id);
    state.revealedResultIds.delete(id);
    state.patterns.delete(id);
    for (const result of new Set(targets)) runtime.results.clearGenerationResult(result);
    renderResults();
    renderHistory();
  }

  function clearCurrentResults() {
    for (const result of [...state.results]) deleteResult(result.id);
  }

  function clearHistory() {
    for (const result of state.history) {
      if (!state.results.some((current) => current.id === result.id)) {
        runtime.results.clearGenerationResult(result);
      }
    }
    state.history = [];
    state.revealedResultIds.clear();
    renderResults();
    renderHistory();
  }

  function setHistoryEnabled(enabled) {
    state.historyEnabled = enabled;
    if (!enabled) clearHistory();
    renderHistory();
  }

  document.querySelectorAll('.mode-link').forEach((button) => {
    button.addEventListener('click', () => setMode(button.dataset.mode));
  });
  addEventListener('hashchange', () => setMode(modeFromLocation(), true));
  form.addEventListener('submit', generateResults);
  form.addEventListener('reset', () => setTimeout(() => {
    state.settings.modes[state.mode] = {};
    renderConfig();
  }, 0));
  form.addEventListener('change', (event) => {
    saveNonSecretSettings();
    if (event.target.name === 'language') ensureMnemonicLanguage(event.target.value);
    updateGenerationAvailability();
  });
  document.getElementById('copy-current').addEventListener('click', copyCurrentResult);
  document.getElementById('copy-all').addEventListener('click', copyAllResults);
  document.getElementById('clear-results').addEventListener('click', clearCurrentResults);
  document.getElementById('history-toggle').addEventListener('change', (event) => {
    setHistoryEnabled(event.target.checked);
  });

  initializePassphrase();
  initializePinRisk();
  initializeAnalyzer();
  try {
    const status = runtime.bip39.getBip39WordlistStatus('english');
    setResource('mnemonic', status.state === 'ready' ? 'ready' : 'error', 'BIP39 English');
  } catch {
    setResource('mnemonic', 'error', 'BIP39 English');
  }
  setMode(state.mode, true);
  renderResults();
  renderHistory();
  renderResources();
  document.documentElement.dataset.passwordGeneratorReady = 'true';
})();

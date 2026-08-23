(function attachMemorableEngine(globalScope, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (globalScope) globalScope.MemorableEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createMemorableEngine() {
  'use strict';

  function secureRandomIndex(size, cryptoImpl = globalThis.crypto) {
    if (!Number.isSafeInteger(size) || size <= 0 || size > 0xffffffff) {
      throw new RangeError('词池大小必须是 1～4,294,967,295 之间的安全整数。');
    }
    if (!cryptoImpl || typeof cryptoImpl.getRandomValues !== 'function') {
      throw new Error('当前环境不支持 Web Crypto，无法安全生成记忆短语。');
    }
    const range = 0x100000000;
    const limit = Math.floor(range / size) * size;
    const buffer = new Uint32Array(1);
    let value;
    do {
      cryptoImpl.getRandomValues(buffer);
      value = buffer[0];
    } while (value >= limit);
    return value % size;
  }

  class SecureWordGenerator {
    constructor(cryptoImpl = globalThis.crypto) {
      this.crypto = cryptoImpl;
    }

    generate(entries, count) {
      if (!Array.isArray(entries) || entries.length === 0) {
        throw new RangeError('词包为空，无法生成记忆短语。');
      }
      if (!Number.isSafeInteger(count) || count <= 0 || count > 100) {
        throw new RangeError('单词数量必须是 1～100 之间的整数。');
      }
      return Array.from({ length: count }, () => {
        const entry = entries[secureRandomIndex(entries.length, this.crypto)];
        return typeof entry === 'string' ? entry : entry.word;
      });
    }
  }

  const THEMES = [
    { id: 'science-fiction', label: '科幻探索', keywords: ['宇航', '火星', '星球', '太空', '未来', '机器人', '科幻', 'rocket', 'space', 'mars'] },
    { id: 'technology', label: '科技任务', keywords: ['服务器', '电脑', '代码', '软件', '网络', '系统', '科技', '数据', 'server', 'code', 'tech'] },
    { id: 'adventure', label: '冒险旅程', keywords: ['冒险', '城堡', '宝藏', '森林', '山洞', '旅行', '探险', 'dragon', 'castle'] },
    { id: 'business', label: '商务现场', keywords: ['公司', '办公室', '会议', '项目', '合同', '客户', 'business', 'office'] },
    { id: 'nature', label: '自然旅行', keywords: ['海边', '河流', '森林', '花园', '动物', '自然', '露营', 'nature', 'travel'] },
    { id: 'mystery', label: '悬疑线索', keywords: ['秘密', '谜题', '侦探', '线索', '夜晚', '神秘', 'mystery'] },
  ];

  const StoryIntentParser = {
    parse(description) {
      const normalized = String(description || '').trim().toLowerCase();
      let best = THEMES[2];
      let bestScore = 0;
      for (const theme of THEMES) {
        const score = theme.keywords.reduce((sum, keyword) => sum + (normalized.includes(keyword) ? 1 : 0), 0);
        if (score > bestScore) {
          best = theme;
          bestScore = score;
        }
      }
      const tone = /幽默|搞笑|有趣|funny/.test(normalized)
        ? 'humorous'
        : /紧张|危险|惊险|urgent/.test(normalized)
          ? 'tense'
          : /温暖|治愈|轻松|calm/.test(normalized)
            ? 'gentle'
            : 'vivid';
      return { theme: best.id, themeLabel: best.label, tone, hasDescription: Boolean(normalized) };
    },
  };

  const STORY_FRAMES = {
    'science-fiction': [
      ['飞船舱门打开后，宇航员先看到 ', '，又把 ', ' 固定在控制台上；随后 ', ' 发出蓝光，导航最终指向 ', '。'],
      ['穿过环形空间站时，队员带着 ', ' 接近 ', '；警报响起后，', ' 启动了通道，出口旁留下 ', '。'],
      ['抵达陌生星球后，探测器记录了 ', '，基地同时收到 ', '；就在风暴来临前，', ' 与 ', ' 一起完成了返航坐标。'],
    ],
    technology: [
      ['清晨的机房里，工程师先检查 ', '，再把 ', ' 接入终端；屏幕随后显示 ', '，最后由 ', ' 完成确认。'],
      ['系统升级开始后，控制台弹出 ', '，旁边的设备保存着 ', '；当 ', ' 发出提醒时，团队用 ', ' 恢复了服务。'],
      ['发布窗口即将结束，值班员核对 ', ' 和 ', '；几秒后 ', ' 通过检测，', ' 成为最后一条成功记录。'],
    ],
    adventure: [
      ['旅人走进古老城门，首先捡到 ', '，又在石桥下发现 ', '；远处的 ', ' 指向山顶，而 ', ' 打开了下一段道路。'],
      ['穿过起雾森林时，队伍带着 ', ' 绕过 ', '；就在地图失效时，', ' 出现在路边，最终带他们找到 ', '。'],
      ['夜幕降临后，营地保存着 ', '，山谷回应着 ', '；一阵风吹来，', ' 与 ', ' 共同组成了回家的线索。'],
    ],
    business: [
      ['会议开始前，桌上放着 ', '，投影幕展示 ', '；讨论转向 ', ' 后，团队最终以 ', ' 达成一致。'],
      ['项目进入关键阶段，负责人先确认 ', '，随后核对 ', '；客户带来 ', '，而 ', ' 成为当天的决定依据。'],
      ['办公室安静下来时，文件夹里留下 ', '，白板上仍写着 ', '；当 ', ' 得到批准，', ' 也随之完成归档。'],
    ],
    nature: [
      ['沿着河岸前行时，旅行者看见 ', '，又在树下找到 ', '；风把 ', ' 吹向远方，最后停在 ', ' 旁边。'],
      ['清晨的山谷里，背包中装着 ', '，小路经过 ', '；阳光照亮 ', ' 后，远处出现了 ', '。'],
      ['越过海边岩石时，浪花带来 ', '，沙地上留下 ', '；傍晚 ', ' 指向营地，而 ', ' 守在入口。'],
    ],
    mystery: [
      ['侦探推开暗门，第一条线索是 ', '，第二条藏在 ', '；钟声响起后，', ' 指向抽屉里的 ', '。'],
      ['走廊尽头只有 ', '，旧照片背面写着 ', '；灯光熄灭时，', ' 突然出现，旁边还放着 ', '。'],
      ['谜题进入最后一层，桌面依次摆着 ', ' 和 ', '；机关接受 ', ' 后，真正的答案竟然是 ', '。'],
    ],
  };

  const STORY_SKELETONS = [
    ['先看见 ', '，再把 ', ' 放到安全位置；随后 ', ' 发出信号，线索最终指向 '],
    ['从 ', ' 开始检查，又在附近找到 ', '；当 ', ' 发生变化时，大家立刻想起 '],
    ['带着 ', ' 进入现场，把 ', ' 留在入口；几分钟后 ', ' 唤醒了沉睡的 '],
    ['沿着 ', ' 继续前进，途中遇见 ', '；正准备返回时，', ' 突然照亮了 '],
    ['先记录 ', ' 的位置，再确认 ', '；警报响起后，', ' 成为了保护 ', ' 的关键'],
    ['把 ', ' 装进背包，并用 ', ' 标记方向；穿过转角时，', ' 正好停在 ', ' 旁边'],
    ['在地图上圈出 ', '，又把 ', ' 写进日志；下一秒 ', ' 带来消息，内容只提到 '],
    ['打开写着 ', ' 的箱子，里面放着 ', '；当门缓缓开启，', ' 正带着 ', ' 出现'],
    ['先听见 ', ' 的回声，随后触碰 ', '；灯光切换以后，', ' 与 ', ' 组成完整线索'],
    ['把 ', ' 交给同伴，同时保管 ', '；就在计划改变时，', ' 指出了通往 ', ' 的路线'],
    ['绕过 ', ' 后发现 ', '，便立即呼叫支援；等到 ', ' 抵达，', ' 已经准备就绪'],
    ['先用 ', ' 测试入口，再让 ', ' 保持安静；倒计时结束时，', ' 成功连接到 '],
    ['记住 ', ' 的颜色，接着辨认 ', '；当风向改变，', ' 把大家带到 ', ' 面前'],
    ['从抽屉取出 ', '，又在背面读到 ', '；最后一盏灯亮起时，', ' 正守护着 '],
    ['围绕 ', ' 制定计划，并让 ', ' 负责观察；一阵震动过后，', ' 带回了关于 ', ' 的答案'],
    ['先把 ', ' 放在左侧，再将 ', ' 移到右侧；只有当 ', ' 出现时，机关才显示 '],
    ['越过标有 ', ' 的门，便看到 ', '；走到尽头后，', ' 留下了一张写着 ', ' 的卡片'],
    ['用 ', ' 交换地图，再以 ', ' 确认身份；任务结束前，', ' 必须陪同 ', ' 返回'],
    ['沿途收集 ', ' 和 ', '，并把它们分开保存；到达终点时，', ' 正等待 ', ' 的回应'],
    ['先解决 ', ' 引起的问题，再检查 ', '；一切恢复正常后，', ' 与 ', ' 成为胜利标志'],
  ];

  const THEME_OPENINGS = {
    'science-fiction': ['飞船舱门打开后，宇航员', '抵达陌生星球后，探测器', '穿过环形空间站时，队员', '火星风暴来临前，基地', '进入深空轨道后，导航员'],
    technology: ['清晨的机房里，工程师', '系统升级开始后，值班员', '发布窗口即将关闭时，团队', '控制台重新亮起后，操作员', '数据中心恢复安静时，管理员'],
    adventure: ['旅人走进古老城门后，', '穿过起雾森林时，队伍', '夜幕降临后的山谷里，向导', '越过石桥以后，冒险者', '进入失落遗迹时，伙伴们'],
    business: ['会议开始前，项目组', '办公室安静下来时，负责人', '客户抵达以后，团队', '季度计划确认前，经理', '合同审阅进入尾声时，顾问'],
    nature: ['沿着河岸前行时，旅行者', '清晨的山谷里，背包客', '越过海边岩石后，摄影师', '森林雨停以后，露营者', '抵达高原湖畔时，向导'],
    mystery: ['侦探推开暗门后，', '走廊尽头的灯亮起时，调查员', '谜题进入最后一层后，大家', '午夜钟声响起时，守夜人', '旧宅窗帘被风吹开后，访客'],
  };

  const THEME_ENDINGS = {
    'science-fiction': ['，返航坐标随即完成。', '，星图因此恢复完整。', '，基地终于收到确认。', '，舱门在倒计时前关闭。'],
    technology: ['，服务随即恢复正常。', '，发布记录显示成功。', '，系统完成了最后校验。', '，故障告警终于消失。'],
    adventure: ['，新的道路终于打开。', '，宝藏地图显出终点。', '，队伍顺利返回营地。', '，山顶传来胜利的钟声。'],
    business: ['，会议最终达成一致。', '，项目进入下一阶段。', '，文件当天完成归档。', '，客户确认了最终方案。'],
    nature: ['，晚霞正好照亮营地。', '，归途在远处清晰可见。', '，湖面恢复了平静。', '，旅程留下完整的记忆。'],
    mystery: ['，隐藏的门终于开启。', '，真正的答案随之出现。', '，所有线索连成一条线。', '，谜案在天亮前解决。'],
  };

  const STORY_GRAMMAR_STATS = {
    themeCount: THEMES.length,
    skeletonsPerTheme: STORY_SKELETONS.length,
    microCombinationsPerTheme: STORY_SKELETONS.length * 5 * 4,
  };

  function stableHash(values) {
    let hash = 2166136261;
    for (const character of values.join('|')) {
      hash ^= character.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function composedFrame(theme, words, sceneIndex) {
    const hash = stableHash([theme, String(sceneIndex), ...words]);
    const skeleton = STORY_SKELETONS[hash % STORY_SKELETONS.length];
    const openings = THEME_OPENINGS[theme] || THEME_OPENINGS.adventure;
    const endings = THEME_ENDINGS[theme] || THEME_ENDINGS.adventure;
    const opening = openings[Math.floor(hash / STORY_SKELETONS.length) % openings.length];
    const ending = endings[Math.floor(hash / (STORY_SKELETONS.length * openings.length)) % endings.length];
    return [`${opening}${skeleton[0]}`, skeleton[1], skeleton[2], skeleton[3], `${skeleton[4] || ''}${ending}`];
  }

  function frameToParts(frame, words) {
    const parts = [];
    for (let index = 0; index < words.length; index += 1) {
      parts.push({ type: 'text', value: frame[index] || (index ? '，随后出现 ' : '场景中出现 ') });
      parts.push({ type: 'word', value: words[index] });
    }
    parts.push({ type: 'text', value: frame[words.length] || '。' });
    return parts;
  }

  const StoryRenderer = {
    render(words, intent = StoryIntentParser.parse('')) {
      if (!Array.isArray(words) || words.length === 0) {
        return { theme: intent.theme, themeLabel: intent.themeLabel, scenes: [] };
      }
      const scenes = [];
      for (let offset = 0; offset < words.length; offset += 4) {
        const sceneWords = words.slice(offset, offset + 4);
        const frame = composedFrame(intent.theme, sceneWords, scenes.length);
        const parts = frameToParts(frame, sceneWords);
        scenes.push({
          index: scenes.length + 1,
          title: `第${['一', '二', '三', '四', '五', '六'][scenes.length] || scenes.length + 1}幕`,
          words: sceneWords,
          parts,
          sentence: parts.map(part => part.value).join(''),
        });
      }
      return { theme: intent.theme, themeLabel: intent.themeLabel, tone: intent.tone, scenes };
    },
  };

  const EntropyCalculator = {
    forWords(poolSize, wordCount) {
      if (!Number.isSafeInteger(poolSize) || poolSize <= 0) throw new RangeError('实际词池数量无效。');
      if (!Number.isSafeInteger(wordCount) || wordCount <= 0) throw new RangeError('单词数量无效。');
      const bitsPerWord = Math.log2(poolSize);
      return {
        poolSize,
        wordCount,
        bitsPerWord,
        totalBits: bitsPerWord * wordCount,
        contextBits: 0,
      };
    },
  };

  return {
    secureRandomIndex,
    SecureWordGenerator,
    StoryIntentParser,
    StoryRenderer,
    EntropyCalculator,
    THEMES,
    STORY_GRAMMAR_STATS,
  };
});

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { brotliCompressSync, constants as zlibConstants } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = path.join(root, 'assets/wordpacks');
const outputEnglish = path.join(outputRoot, 'en');
const sourceHtml = path.join(root, 'index.html');
const EFF_LARGE_URL = 'https://www.eff.org/files/2016/07/18/eff_large_wordlist.txt';
const DATAMUSE_URL = 'https://api.datamuse.com/words';

const THEME_SPECS = [
  {
    id: 'technology',
    label: '科技与软件',
    topics: ['technology', 'software', 'computing', 'programming', 'digital'],
    seeds: ['algorithm', 'compiler', 'database', 'browser', 'software', 'firmware', 'processor', 'keyboard', 'frontend', 'backend', 'debugger', 'repository', 'framework', 'library', 'syntax', 'binary', 'semaphore', 'cache', 'pixel', 'chipset', 'scripting', 'codebase', 'filesystem', 'websocket'],
  },
  {
    id: 'cloud-devops',
    label: '云计算与运维',
    topics: ['cloud', 'devops', 'computing', 'infrastructure', 'server'],
    seeds: ['kubernetes', 'docker', 'containerization', 'microservice', 'load balancer', 'reverse proxy', 'datacenter', 'virtualization', 'autoscaling', 'deployment', 'telemetry', 'observability', 'uptime', 'failover', 'backup', 'cluster', 'ingress', 'kubectl', 'terraform', 'ansible', 'serverless', 'cloud native', 'orchestration', 'prometheus'],
  },
  {
    id: 'network-security',
    label: '网络与安全',
    topics: ['security', 'network', 'privacy', 'cryptography', 'internet'],
    seeds: ['cryptography', 'cybersecurity', 'firewall', 'encryption', 'decryption', 'authentication', 'authorization', 'vulnerability', 'exploit', 'malware', 'phishing', 'ransomware', 'cipher', 'certificate', 'packet', 'router', 'switch', 'dns', 'vpn', 'zero trust', 'intrusion', 'antivirus', 'forensics', 'pentest'],
  },
  {
    id: 'finance-web3',
    label: '金融与 Web3',
    topics: ['finance', 'banking', 'investment', 'economics', 'blockchain'],
    seeds: ['accounting', 'bookkeeping', 'equity', 'bond', 'dividend', 'portfolio', 'brokerage', 'derivative', 'futures', 'option', 'valuation', 'liquidity', 'mortgage', 'invoice', 'settlement', 'payment', 'ledger', 'blockchain', 'cryptocurrency', 'tokenization', 'smart contract', 'collateral', 'escrow', 'underwriting'],
  },
  {
    id: 'science-space',
    label: '科学与太空',
    topics: ['science', 'space', 'astronomy', 'physics', 'research'],
    seeds: ['astronomy', 'astrophysics', 'telescope', 'satellite', 'spacecraft', 'rocket', 'orbit', 'galaxy', 'nebula', 'comet', 'asteroid', 'planet', 'astronaut', 'cosmology', 'quantum', 'molecule', 'atom', 'isotope', 'laboratory', 'microscope', 'biology', 'geology', 'experiment', 'research'],
  },
  {
    id: 'business-office',
    label: '商务与办公',
    topics: ['business', 'office', 'management', 'commerce', 'work'],
    seeds: ['contract', 'invoice', 'meeting', 'project management', 'stakeholder', 'customer', 'procurement', 'logistics', 'marketing', 'sales', 'revenue', 'strategy', 'negotiation', 'leadership', 'operations', 'workflow', 'presentation', 'deadline', 'milestone', 'budget', 'forecast', 'partnership', 'compliance', 'productivity'],
  },
];

const BLOCKED_WORDS = new Set([
  'abuse', 'abuser', 'assault', 'bigot', 'bombing', 'corpse', 'cruelty', 'genocide', 'hateful', 'heroin',
  'murder', 'nazi', 'porn', 'racist', 'rape', 'rapist', 'slavery', 'suicide', 'terrorist', 'torture',
]);

const EFF_REPLACEMENTS = new Map([
  ['cruelty', 'kindhearted'],
]);

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function normalizeWord(value) {
  return String(value || '').trim().toLowerCase().replace(/[’]/g, "'");
}

function isAcceptableWord(word) {
  return /^[a-z][a-z'-]{2,11}$/.test(word)
    && !word.includes('--')
    && !word.includes("''")
    && !BLOCKED_WORDS.has(word);
}

function inferPos(word, sourceTags = []) {
  const tags = new Set(sourceTags);
  const result = [];
  if (tags.has('n')) result.push('noun');
  if (tags.has('v')) result.push('verb');
  if (tags.has('adj')) result.push('adjective');
  if (tags.has('adv')) result.push('adverb');
  if (!result.length) {
    if (word.endsWith('ly')) result.push('adverb');
    else if (/(ing|ize|ise|ify|ate)$/.test(word)) result.push('verb');
    else if (/(ous|ful|less|able|ible|ive|al|ic|ary)$/.test(word)) result.push('adjective');
    else result.push('noun');
  }
  return result;
}

function makeEntry(word, id, tags, sourceTags = [], rankRatio = 0.5) {
  const pos = inferPos(word, sourceTags);
  const difficulty = word.length <= 6 ? 1 : word.length <= 10 ? 2 : 3;
  const imageability = pos.includes('noun') && word.length <= 9 ? 3 : pos.some(item => item === 'verb' || item === 'adjective') ? 2 : 1;
  const frequency = rankRatio < 0.25 ? 3 : rankRatio < 0.7 ? 2 : 1;
  return {
    id,
    word,
    locale: 'en',
    pos,
    tags,
    difficulty,
    imageability,
    frequency,
    sensitive: false,
    ambiguous: false,
  };
}

async function fetchText(url) {
  const response = await fetch(url, { headers: { 'user-agent': 'Password-Generator-WordPack-Builder/1.7' } });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  return response.text();
}

async function loadCommonShort() {
  const html = await readFile(sourceHtml, 'utf8');
  const match = html.match(/const WORDS = (\[[^\n]+\]);\nconst BASIC_WORDS/);
  if (!match) throw new Error('无法从当前应用提取内置简单词库。');
  const words = JSON.parse(match[1]).map(normalizeWord);
  if (words.length !== 1296 || new Set(words).size !== 1296) {
    throw new Error(`现有简单词库应为 1,296 个唯一词，实际 ${words.length}/${new Set(words).size}。`);
  }
  return words;
}

async function loadEffLong() {
  const text = await fetchText(EFF_LARGE_URL);
  const words = text.trim().split(/\r?\n/)
    .map(line => normalizeWord(line.split(/\s+/)[1]))
    .map(word => EFF_REPLACEMENTS.get(word) || word)
    .filter(Boolean);
  if (words.length !== 7776 || new Set(words).size !== 7776) {
    throw new Error(`EFF 标准词库应为 7,776 个唯一词，实际 ${words.length}/${new Set(words).size}。`);
  }
  if (words.some(word => !isAcceptableWord(word))) throw new Error('EFF 标准词库包含当前规则无法接受的词条。');
  return words;
}

async function queryDatamuse(seed, topics) {
  const url = new URL(DATAMUSE_URL);
  url.searchParams.set('ml', seed);
  url.searchParams.set('topics', topics.join(','));
  url.searchParams.set('max', '300');
  url.searchParams.set('md', 'pf');
  const response = await fetch(url, { headers: { 'user-agent': 'Password-Generator-WordPack-Builder/1.7' } });
  if (!response.ok) throw new Error(`Datamuse HTTP ${response.status}: ${seed}`);
  const data = await response.json();
  return data.map((item, rank) => ({
    word: normalizeWord(item.word),
    score: Number(item.score || 0),
    rank,
    tags: Array.isArray(item.tags) ? item.tags.filter(tag => ['n', 'v', 'adj', 'adv'].includes(tag)) : [],
  }));
}

async function collectThemeCandidates(spec) {
  const batches = [];
  for (let offset = 0; offset < spec.seeds.length; offset += 4) {
    const seeds = spec.seeds.slice(offset, offset + 4);
    const responses = await Promise.all(seeds.map(seed => queryDatamuse(seed, spec.topics)));
    responses.forEach((items, index) => batches.push({ seed: seeds[index], items }));
  }
  const byWord = new Map();
  for (const batch of batches) {
    for (const item of batch.items) {
      if (!isAcceptableWord(item.word)) continue;
      const current = byWord.get(item.word) || { word: item.word, score: 0, relevance: 0, seedHits: 0, tags: new Set(), seeds: [] };
      current.score = Math.max(current.score, item.score);
      current.relevance += 1 / (item.rank + 12);
      current.seedHits += 1;
      current.seeds.push(batch.seed);
      item.tags.forEach(tag => current.tags.add(tag));
      byWord.set(item.word, current);
    }
  }
  return [...byWord.values()]
    .map(item => ({ ...item, tags: [...item.tags] }))
    .sort((a, b) => b.seedHits - a.seedHits || b.relevance - a.relevance || b.score - a.score || a.word.length - b.word.length || a.word.localeCompare(b.word));
}

function createPayload({ id, label, kind, words, source, sourceTagsByWord = new Map() }) {
  const count = words.length;
  return {
    id,
    label,
    version: '1.0.0',
    locale: 'en',
    kind,
    count,
    source,
    generatedAt: '2026-08-24',
    entries: words.map((word, index) => {
      const sourceItem = sourceTagsByWord.get(word);
      return makeEntry(word, index + 1, kind === 'theme' ? [id, 'professional', 'memorable'] : [id, 'memorable'], sourceItem?.tags || [], index / Math.max(1, count - 1));
    }),
  };
}

async function writePack(payload, filename) {
  const raw = Buffer.from(JSON.stringify(payload));
  const filePath = path.join(outputEnglish, filename);
  await writeFile(filePath, raw);
  const compressed = brotliCompressSync(raw, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 } });
  await writeFile(`${filePath}.br`, compressed);
  return {
    path: `en/${filename}`,
    compressedPath: `en/${filename}.br`,
    sha256: sha256(raw),
    compressedSha256: sha256(compressed),
    bytes: raw.length,
    compressedBytes: compressed.length,
  };
}

async function main() {
  await mkdir(outputEnglish, { recursive: true });
  const [commonWords, standardWords] = await Promise.all([loadCommonShort(), loadEffLong()]);
  const standardSet = new Set(standardWords);
  const usedThemeWords = new Set();
  const packs = [];

  const commonPayload = createPayload({
    id: 'common-short', label: '简单词库', kind: 'core', words: commonWords,
    source: { name: '当前内置简单词库（EFF 短词表体系）', url: 'https://www.eff.org/dice', license: 'CC BY 3.0 US' },
  });
  packs.push({
    id: commonPayload.id, label: commonPayload.label, kind: commonPayload.kind, version: commonPayload.version,
    locale: 'en', count: commonPayload.count, minLength: Math.min(...commonWords.map(word => word.length)), maxLength: Math.max(...commonWords.map(word => word.length)),
    ...(await writePack(commonPayload, 'common-short.1296.v1.json')),
  });

  const standardPayload = createPayload({
    id: 'memorable-long', label: '标准词库', kind: 'core', words: standardWords,
    source: { name: '基于 Electronic Frontier Foundation Large Wordlist，经敏感词过滤', url: EFF_LARGE_URL, license: 'CC BY 3.0 US' },
  });
  packs.push({
    id: standardPayload.id, label: standardPayload.label, kind: standardPayload.kind, version: standardPayload.version,
    locale: 'en', count: standardPayload.count, minLength: Math.min(...standardWords.map(word => word.length)), maxLength: Math.max(...standardWords.map(word => word.length)),
    ...(await writePack(standardPayload, 'memorable-long.7776.v1.json')),
  });

  for (const spec of THEME_SPECS) {
    process.stdout.write(`正在收集 ${spec.label} 候选词……\n`);
    const candidates = await collectThemeCandidates(spec);
    const selected = candidates.filter(item => !standardSet.has(item.word) && !usedThemeWords.has(item.word)).slice(0, 1024);
    if (selected.length < 1024) throw new Error(`${spec.label} 去重后只有 ${selected.length} 个候选词。`);
    selected.forEach(item => usedThemeWords.add(item.word));
    const sourceTagsByWord = new Map(selected.map(item => [item.word, item]));
    const words = selected.map(item => item.word);
    const payload = createPayload({
      id: spec.id, label: spec.label, kind: 'theme', words, sourceTagsByWord,
      source: {
        name: 'Datamuse 构建期候选词，经本项目清洗、过滤和跨包去重',
        url: DATAMUSE_URL,
        license: 'Datamuse API terms; generated pack distributed with source attribution',
        seeds: spec.seeds,
      },
    });
    packs.push({
      id: payload.id, label: payload.label, kind: payload.kind, version: payload.version,
      locale: 'en', count: payload.count, minLength: Math.min(...words.map(word => word.length)), maxLength: Math.max(...words.map(word => word.length)),
      ...(await writePack(payload, `${spec.id}.1024.v1.json`)),
    });
  }

  const manifest = {
    schemaVersion: 1,
    version: '1.0.0',
    locale: 'en',
    generatedAt: '2026-08-24',
    totalUniqueCoreAndThemes: standardSet.size + usedThemeWords.size,
    packs,
  };
  await writeFile(path.join(outputRoot, 'manifest.v1.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`已生成 ${packs.length} 个词包；标准与主题合计 ${manifest.totalUniqueCoreAndThemes.toLocaleString('zh-CN')} 个唯一词。\n`);
}

await main();

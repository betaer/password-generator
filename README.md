# Password Generator

一个完全在浏览器本地运行的密码生成器，当前版本为 **V1.7.5**。

在线使用：[https://betaer.github.io/password-generator/](https://betaer.github.io/password-generator/)

## 功能

- 随机密码：长度、强度、字符类型、符号占比、首尾类型与排除字符。
- 密码方案：银行卡密码/卡号测试字符串，以及 BTC、ETH、TRON 地址和私钥格式演示。
- 记忆短语：本地词包、主题词包和三幕记忆故事。
- PIN：长度、弱 PIN 过滤、重复数字与连续数字限制。
- 实时强度分析：字符多样性、熵值、穷举次数和预计破解时间。
- 自动复制与会话历史记录。

所有生成过程均在本地完成，不会上传生成结果。

> “密码方案”中的银行卡、钱包地址和私钥仅生成符合长度、前缀与字符集的测试字符串，不执行银行卡校验、地址校验和、公钥推导或链上有效性验证，请勿用于真实交易。

## 本地运行

直接打开 `index.html` 可以使用兼容模式。推荐通过本地 HTTP 服务预览，以完整测试异步词包：

```bash
npm run serve
```

然后打开：

```text
http://127.0.0.1:8765/
```

## 测试

```bash
npm test
```

测试覆盖随机密码、记忆短语、词包加载、嵌入词包、PIN 规则、密码方案格式和页面集成行为。

## 项目结构

```text
.
├── index.html                 # 应用入口
├── assets/                    # 本地引擎与词包
├── scripts/                   # 词包构建脚本
├── tests/                     # Node.js 测试
└── password-generator-icon.*  # Logo 与 favicon
```

## 技术说明

- 随机数据使用 Web Crypto API。
- 词包由项目本地加载，不调用第三方随机词 API。
- 项目为静态网页，不需要后端服务。

## SEO、GEO 与社交分享

- 页面规范标题为“密码生成器 | Password Generator”，并提供唯一 canonical 地址。
- Open Graph 与 Twitter Card 共用 `assets/social-preview.png`（1200 × 630）。
- `WebApplication` JSON-LD 用于描述应用类别、版本、功能、价格与隐私特征。
- `robots.txt`、`sitemap.xml` 与 `llms.txt` 分别服务搜索抓取、站点发现和生成式搜索理解。

## 词库来源

- 简单词库与标准词库基于 [EFF Diceware 词表](https://www.eff.org/dice)，按 CC BY 3.0 US 标注来源。
- 主题词包使用 Datamuse 构建期候选词，经项目清洗、过滤与跨包去重。
- 每个词包的数量、来源、SHA-256 与压缩文件校验值记录在 `assets/wordpacks/manifest.v1.json`。

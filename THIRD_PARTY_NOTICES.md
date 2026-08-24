# Third-party notices｜第三方声明

本项目会把必要的分析模型、风险语料与词包作为静态资源部署到同一 GitHub Pages 站点。生成值不会被发送给这些来源；下列网络地址仅用于构建期下载、来源核验或许可证说明。

## zxcvbn-ts

- 组件：`@zxcvbn-ts/core` 4.2.0、`@zxcvbn-ts/language-common` 4.1.3
- 用途：浏览器本地识别字典词、重复、序列、键盘路径等可预测密码模式。
- 许可证：MIT
- 上游：https://github.com/zxcvbn-ts/zxcvbn
- 随部署文件附带的许可证：`assets/vendor/zxcvbn-LICENSE.txt`

浏览器端分析器只返回猜测次数、评分，以及去除原文后的“模式类型 + 长度”摘要；不返回、记录或上报被分析的密码。

## SecLists PIN risk corpus

- 项目：https://github.com/danielmiessler/SecLists
- 固定提交：`0e0329aa77f0f3d2ff5035e989ad320a2ac4a35d`
- 许可证：MIT
- 4 位来源：`Passwords/Common-Credentials/four-digit-pin-codes-sorted-by-frequency-withcount.csv`
- 4 位 SHA-256：`18e0ebf05f5a9ab24dfd1d59cff979e931bc0dee8d0663008d6bd3e4b0fc320b`
- 6 位候选来源：`Passwords/Common-Credentials/xato-net-10-million-passwords-1000000.txt`
- 6 位 SHA-256：`424a3e03a17df0a2bc2b3ca749d81b04e79d59cb7aeec8876a5a3f308d0caf51`

构建脚本校验下载内容的 SHA-256，并生成只包含 PIN 数值与排名的本地防御性索引：10,000 个四位 PIN 排名和 68,202 个唯一六位数字 PIN。完整构建记录位于 `assets/data/pin-risk-source.txt`。

## EFF Diceware word lists

- 来源：https://www.eff.org/dice
- 用途：简单词库与标准词库的基础来源。
- 许可：Creative Commons Attribution 3.0 United States（CC BY 3.0 US）。

项目在静态词包清单中记录数量、版本与 SHA-256：`assets/wordpacks/manifest.v1.json`。

## Datamuse

- 服务：https://www.datamuse.com/api/
- 用途：仅作为主题词包的构建期候选词来源。

候选词经过项目侧清洗、过滤与跨包去重后，作为本站版本化静态词包发布；用户生成记忆短语时不会调用 Datamuse API。

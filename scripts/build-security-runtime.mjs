import { readFile, writeFile } from 'node:fs/promises';
import { transform } from 'esbuild';

const sourceURL = new URL('../assets/js/security-analysis.js', import.meta.url);
const htmlURL = new URL('../index-v1.75.html', import.meta.url);
const marker = 'security-analysis';

const [source, html] = await Promise.all([
  readFile(sourceURL, 'utf8'),
  readFile(htmlURL, 'utf8'),
]);

const { code } = await transform(source, {
  loader: 'js',
  minify: true,
  target: 'es2020',
  legalComments: 'none',
});
const minified = code.trim();
const block = `  <script data-startup-runtime="${marker}">\n${minified}\n  </script>`;
const expression = new RegExp(`  <script data-startup-runtime="${marker}">[\\s\\S]*?<\\/script>`);

let nextHTML;
if (expression.test(html)) {
  nextHTML = html.replace(expression, block);
} else {
  const anchor = '  <script data-startup-runtime="word-pack-manager">';
  const anchorIndex = html.indexOf(anchor);
  if (anchorIndex < 0) throw new Error('找不到启动运行时插入位置。');
  const closeIndex = html.indexOf('  </script>', anchorIndex);
  if (closeIndex < 0) throw new Error('找不到 WordPackManager 运行时结束标签。');
  const insertionIndex = closeIndex + '  </script>'.length;
  nextHTML = `${html.slice(0, insertionIndex)}\n${block}${html.slice(insertionIndex)}`;
}

await writeFile(htmlURL, nextHTML);
console.log(`已将 ${minified.length.toLocaleString('en-US')} 字节安全分析运行时内置到 index-v1.75.html。`);

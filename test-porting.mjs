/**
 * 校验 PORTING.md 说的都是真的。
 *
 * ────────────────────────────────────────────────────────────────
 *  为什么给一份文档配一个测试
 * ────────────────────────────────────────────────────────────────
 *  `PORTING.md` 是**给别人看的承诺**：哪些模块能原样搬、有哪些接口、
 *  多大、有没有外部依赖。文档最容易烂 —— 改了代码没人回头改它，
 *  下一个来移植的人会照着错的说明走，然后卡在一个不存在的函数上。
 *
 *  所以把文档里的每条事实写成断言。第一版写出来就抓到我三个错：
 *    · 大小写成 66 KB（那是**字符数**，字节是 87 KB —— 中文 3 字节/字）
 *    · 漏了一个导出（news.js 的 clean）
 *    · 两处措辞会被误读成导出名
 */

import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// ⚠️ 这个目录**不能写死** —— 那既是本机路径，也让别人 clone 下来跑不了。
//    从文件自己的位置往上推：文件在哪，插件根就在哪。
const ROOT = dirname(fileURLToPath(import.meta.url))

const SRC = ROOT
const doc = fs.readFileSync(SRC + '/PORTING.md', 'utf8')
const MODS = ['store.js', 'diary.js', 'news.js', 'proactive.js', 'memory.js', 'frames.js', 'taste.js', 'sessions.js']
// 声称"零 DSH 依赖"的那些 —— 除了 sessions.js（它有 2 处，得改两行）。
// ⚠️ 别写成 `slice(0, 5)`：加了 frames.js 之后它会被漏在统计外，体积对不上就报红。
const CORE = MODS.filter((f) => f !== 'sessions.js')
const code = Object.fromEntries(MODS.map((f) => [f, fs.readFileSync(SRC + '/' + f, 'utf8')]))

let pass = 0, fail = 0
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  ✅ ' + n) } else { fail++; console.log('  ❌ ' + n + (x ? '  → ' + x : '')) } }

const exportsOf = (f) => [...code[f].matchAll(/^export\s+(?:async\s+)?(?:function|const|let)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1])

// ── ① 代码里 export 的，文档必须都写到 ──
console.log('════ 文档覆盖度 ════')
const miss = []
for (const f of MODS) for (const n of exportsOf(f)) if (!doc.includes(n)) miss.push(f + '→' + n)
ok('代码里 export 的全部写进文档了', miss.length === 0, miss.join(', '))

// ── ② 文档里 `名字(` 形式的，必须真的是导出 ──
const wrong = []
for (const f of MODS) {
  const real = new Set(exportsOf(f))
  const sec = doc.split('### `' + f + '`')[1]
  if (!sec) continue
  // ⚠️ 切到**下一个 ## 或 ### 为止**。
  //    第一版只切 `\n### `，而 `sessions.js` 是最后一个模块节 ——
  //    它的"正文"一直拖到文末，把后面的"宿主必须提供的四样东西"也算了进来，
  //    于是 tools.register / section / prompt 全被当成 sessions.js 的假导出。
  const body = sec.split(/\n##+ /)[0]
  // 只看代码块，而且**只认行首的名字** ——
  // 缩进的名字是返回对象的**方法**（note / flush / search…），不是导出。
  const blocks = [...body.matchAll(/```[\s\S]*?```/g)].map((m) => m[0]).join('\n')
  for (const m of blocks.matchAll(/^([A-Za-z_$][\w$]*)\(/gm)) if (!real.has(m[1])) wrong.push(f + '→' + m[1])
}
ok('文档接口里写的函数名都是真导出', wrong.length === 0, wrong.join(', '))

// ── ③ 大小 ──
console.log()
console.log('════ 数字 ════')
const kb = Math.round(CORE.reduce((a, f) => a + fs.statSync(SRC + '/' + f).size, 0) / 1024)
const claim = doc.match(/\|\s*\*\*逻辑\*\*[^|]*\|[^|]*\|\s*(\d+)\s*KB/)
ok('文档写的 ' + (claim ? claim[1] : '?') + ' KB 和实际（' + kb + ' KB）对得上',
  // ⚠️ 容差原来是 ±2 KB —— **太窄了**。这个数字是六个模块加起来（2026-10-16 实测 209 KB），
  //    随便写两段注释就漂 3 KB，于是每次动代码都得来改这个数字，
  //    而真正想防的"文档和代码差一大截"反倒没人注意了（狼来了）。
  //    改成 15%：够宽，不用追着注释跑；够窄，真漏了一整个模块还是抓得到。
  !!claim && Math.abs(Number(claim[1]) - kb) <= Math.max(3, Math.round(kb * 0.15)),
  kb + ' KB（容差 ±' + Math.max(3, Math.round(kb * 0.15)) + '）')

const pkg = JSON.parse(fs.readFileSync(SRC + '/package.json', 'utf8'))
ok('「dependencies 空的」是真的', Object.keys(pkg.dependencies || {}).length === 0,
  JSON.stringify(pkg.dependencies))
ok('「唯一的 peer 是 dsh-tools」是真的',
  Object.keys(pkg.peerDependencies || {}).join(',') === '@deepseek-ai/dsh-tools',
  Object.keys(pkg.peerDependencies || {}).join(','))

// ── ④ 那 5 个模块真的零 DSH 依赖 ──
console.log()
console.log('════ 零依赖声明 ════')
// 只找真依赖：DSH 包名、DSH 事件名、客户端 slot。
// ⚠️ 不要因为"参数名叫 ctx"就报错 —— 那是普通变量名（proactive.js 里就有一个）。
const MARKS = /@deepseek-ai\/|session\/event|slots\.(inject|register)|dsh\.client|dsh\.bundle/
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/[^\n]*$/gm, '')
for (const f of CORE) {
  const t = strip(code[f])
  ok(f.padEnd(14) + ' 零 DSH 依赖', !MARKS.test(t), (t.match(MARKS) || []).slice(0, 3).join(' '))
}

// ── ⑤ 掉进文档里点名的那些坑了吗（每条都该在代码里有对应实现）──
console.log()
console.log('════ 文档里写的"坑"在代码里真的有防护 ════')
const host = fs.readFileSync(SRC + '/index.js', 'utf8')
const GUARDS = [
  ['注入的框不归档', /function isInjected/, /isInjected\(txt\)/],
  ['内容块挑类型（推理块不进）', /ty !== undefined && ty !== 'text'/, null],
  ['助手消息的嵌套形状', /data\.message && typeof data\.message === 'object'/, null],
  ['时间用时间戳不用 seq', /Number\(event\.at \|\| event\.ts \|\| 0\)/, null],
  ['静默 return 留诊断', /lastReportCheck/, null],
  ['会话 id 不赌一个字段名', /function sessionIdOf/, /sessionIdOf\(liveSession\)/],
]
for (const [name, a, b] of GUARDS) {
  const hit = a.test(host) && (!b || b.test(host))
  ok(name.padEnd(28) + ' 代码里有', hit)
}

// ── ⑥ memory 的路径必须是函数（迁移才生效）──
console.log()
console.log('════ 迁移相关的两条硬要求 ════')
ok('归档路径传的是函数不是字符串', /file: \(\) => dataFile\('dsh-mood-memory\.jsonl'\)/.test(host))
ok('迁移时两边一起改（搬文件 + 写配置）', /moveTo\(dir, \(d2\) => /.test(host) && /invalidateDataDir\(\)/.test(host))

console.log()
console.log('  通过 ' + pass + '  失败 ' + fail)
process.exit(fail ? 1 : 0)

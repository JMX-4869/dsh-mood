/**
 * 快照守卫 —— 重新抓一遍真接口，和 fixtures/ 里的比。
 *
 * ────────────────────────────────────────────────────────────────
 *  为什么必须有这个
 * ────────────────────────────────────────────────────────────────
 *  `test-client.mjs` 靠 fixtures/ 里的快照渲染面板。
 *  但快照**会过期**：接口加了字段、改了名字、挪了结构，快照还是老的 ——
 *  于是客户端测试继续"通过"，而真机上早就裂了。
 *
 *  更早的教训：第一版 test-client 的桩是**我手写的**，和真接口对不上：
 *    · /storage 我编的是 root/humanSize，实际是 dir/home/files
 *    · /diary 我以为是"今天的日记"，实际是**单日查询**，不带 date 直接 400
 *  拿编的桩测，测的是我脑子里的接口。
 *
 *  所以这个文件做两件事：
 *    ① 抓一份新的，和 _shape.json 比 —— 字段多了少了都报出来
 *    ② 把新快照写回 fixtures/（--update 时），让客户端测试跟上
 *
 *  用法：
 *    node test-fixtures.mjs            只比，不改（CI 用）
 *    node test-fixtures.mjs --update   抓新的覆盖旧快照
 *    node test-fixtures.mjs --capture  没有快照时抓一份（首次）
 */

import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// ⚠️ 这个目录**不能写死** —— 那既是本机路径，也让别人 clone 下来跑不了。
//    从文件自己的位置往上推：文件在哪，插件根就在哪。
const ROOT = dirname(fileURLToPath(import.meta.url))

const API = 'http://127.0.0.1:19387/dsh-mood-api'
const FX = join(ROOT, 'fixtures')
const UPDATE = process.argv.includes('--update') || process.argv.includes('--capture')

let pass = 0, fail = 0
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  ✅ ' + n) } else { fail++; console.log('  ❌ ' + n + (x ? '  → ' + x : '')) } }

function get(p) {
  try { return JSON.parse(execFileSync('curl', ['-s', '--max-time', '8', API + p], { encoding: 'utf8' })) }
  catch { return null }
}

// 插件没跑就跳过 —— 别在没网/没宿主时把构建搞红
let probe = get('/state')
if (!probe) {
  console.log('  ⏭  宿主没在跑（' + API + ' 不通），跳过快照核对')
  console.log('  通过 0  失败 0')
  process.exit(0)
}

const main = fs.mkdirSync(FX, { recursive: true }) || true
const hasShape = fs.existsSync(FX + '/_shape.json')
const oldShape = hasShape ? JSON.parse(fs.readFileSync(FX + '/_shape.json', 'utf8')) : null

// ⚠️ **快照不能依赖日记的门禁状态，但也不能假装它不存在。**
//
//    日记有门禁：**锁着时** /state 只给条数（diaries[0] 里没有 text/mood/date…），
//    /diary 直接 403 —— 和开着时的**字段形状不一样**。
//
//    而解锁是 `diary` **工具**的动作（日记归她所有，面板只能显示、不能替她决定），
//    HTTP 接口故意没开这个口子 —— 所以测试**没法自己放行**。
//
//    正确的做法：把快照抓取时的门禁状态一起记进 _shape.json（_gate 字段），
//    两边不一致就**明确跳过那两项**并说清楚原因 ——
//    报一个假红，比不报还坏（我会去"修"一个没坏的东西）。
const gateNow = probe.unlocked === true
// ⚠️ 快照里没有 _gate 时**不能默认成"和现在一样"** ——
//    那等于把一处真实的不一致（老快照是在开着的时候抓的）当成一致，报假红。
//    不知道就是不知道：用 undefined 表示，走"跳过传感器项"那条路，并提示重抓。
const gateSnap = hasShape && oldShape && '_gate' in oldShape ? oldShape._gate : undefined
const gateSame = gateSnap !== undefined && gateSnap === gateNow
if (!gateSame) {
  console.log('')
  console.log('  ⚠️  门禁和快照对不上：快照 ' +
    (gateSnap === undefined ? '**没记**门禁状态（是加 _gate 之前的版本抓的）'
      : '抓的时候是' + (gateSnap ? '开着' : '锁着') + '的') +
    '，现在是' + (gateNow ? '开着' : '锁着') + '的')
  console.log('      → **跳过日记那两项字段对比**。这不是失败，别去"修"。')
  console.log('      → 想重抓带正文的快照：先用 diary 工具放行，再跑 --update，抓完收回去。')
}

const diaryDate = probe.diaries && probe.diaries[0] ? probe.diaries[0].date : '2000-01-01'
const EPS = [
  ['state', '/state'],
  ['diary', '/diary?date=' + diaryDate],
  ['diary-nodate', '/diary'],
  ['diary-missing', '/diary?date=2000-01-01'],
  ['proactive', '/proactive'],
  ['memory', '/memory'],
  ['memory-search', '/memory?query=' + encodeURIComponent('测试') + '&limit=20'],
  ['news', '/news'],
  ['storage', '/storage'],
  ['persona', '/persona'],
]

const fresh = {}
for (const [name, p] of EPS) {
  const j = get(p)
  if (j) fresh[name] = j
}

const keys = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? Object.keys(o).sort() : null)
const shapeOf = (j) => ({
  top: keys(j),
  stats: keys(j.stats),
  recent0: j.recent && j.recent[0] ? keys(j.recent[0]) : null,
  hits0: j.hits && j.hits[0] ? keys(j.hits[0]) : null,
  current: keys(j.current),
  memory: keys(j.memory),
  persona: keys(j.persona),
  items0: j.items && j.items[0] ? keys(j.items[0]) : null,
  sources0: j.sources && j.sources[0] ? keys(j.sources[0]) : null,
  gates0: j.gates && j.gates[0] ? keys(j.gates[0]) : null,
  slot0: j.slotTable && j.slotTable[0] ? keys(j.slotTable[0]) : null,
  diaries0: j.diaries && j.diaries[0] ? keys(j.diaries[0]) : null,
  dirsKeys: j.dirs ? Object.keys(j.dirs).sort() : null,
})
const shape = {}
for (const [n, j] of Object.entries(fresh)) shape[n] = shapeOf(j)

console.log('  抓到 ' + Object.keys(fresh).length + ' 个接口')
ok('十个接口都能抓到', Object.keys(fresh).length === EPS.length, Object.keys(fresh).join(','))

if (!hasShape) {
  console.log('  （没有 _shape.json，这次当作首次抓取）')
} else {
  console.log()
  console.log('════ 字段对比（新 vs 快照）════')
  for (const [name, ns] of Object.entries(shape)) {
    const os = oldShape[name]
    if (!os) { ok(name + ' 是新接口（快照里没有）', false, ''); continue }
    for (const k of Object.keys(ns)) {
      // 门禁不一样时，这两项的形状本来就该不同 —— 跳过，别报假红（见上面那段说明）
      const gateSensitive = (name === 'diary' && k === 'top') || (name === 'state' && k === 'diaries0')
      if (!gateSame && gateSensitive) continue
      const a = ns[k], b = os[k]
      if (a === null && b === null) continue
      const sa = JSON.stringify(a), sb = JSON.stringify(b)
      if (sa !== sb) {
        // ⚠️ 别假设两边都是数组。第一版直接 `.filter` ——
        //    而更早那份 _shape.json 是用另一个脚本存的，里面把 undefined 存成了
        //    字符串 "undefined"，于是 `.filter is not a function` 直接崩。
        const arr = (x) => (Array.isArray(x) ? x : [])
        const added = arr(a).filter((x) => !arr(b).includes(x))
        const gone = arr(b).filter((x) => !arr(a).includes(x))
        const detail = (added.length ? '多了 ' + added.join(',') : '')
          + (added.length && gone.length ? '；' : '')
          + (gone.length ? '少了 ' + gone.join(',') : '')
        ok(name + '.' + k + ' 字段一致', false, detail || ('变了：' + sa + ' → ' + sb).slice(0, 120))
      }
    }
    ok(name + ' 字段和快照一致', true)
  }
  // 快照里有、新抓的没有 → 接口被删了
  //
  // ⚠️ 跳过 `_gate` —— 它**不是接口**，是我自己塞进 _shape.json 的元信息
  //    （记快照抓取时日记门禁开没开）。第一版忘了跳，
  //    于是每次报一句「_gate 还在（快照里有，这次没抓到）」的假红。
  for (const name of Object.keys(oldShape)) {
    if (name === '_gate') continue
    if (!shape[name]) ok(name + ' 还在（快照里有，这次没抓到）', false, '')
  }
}

// 顺手核对几条"客户端依赖的硬约定"
console.log()
console.log('════ 客户端依赖的约定 ════')
ok('/memory 的 recent 每条都有 id（客户端拿它当 React key）',
  !fresh.memory || !fresh.memory.recent.length || fresh.memory.recent.every((r) => r.id),
  fresh.memory && fresh.memory.recent[0] ? JSON.stringify(Object.keys(fresh.memory.recent[0])) : '（没有记录）')
ok('/diary 不带 date 会明确报错（而不是返回空）',
  !fresh['diary-nodate'] || fresh['diary-nodate'].ok === false, JSON.stringify(fresh['diary-nodate']))
ok('/state 带 diaries 列表（客户端靠它列目录）',
  !fresh.state || Array.isArray(fresh.state.diaries), fresh.state && typeof fresh.state.diaries)
ok('/proactive 的 slotTable 每项有 id/kind/label',
  !fresh.proactive || !fresh.proactive.slotTable || fresh.proactive.slotTable.every((s) => s.id && s.kind && s.label))

if (UPDATE) {
  for (const [name, j] of Object.entries(fresh)) fs.writeFileSync(FX + '/' + name + '.json', JSON.stringify(j, null, 2), 'utf8')
  // ⚠️ _gate 一起存 —— 下一轮才知道这份快照是在开着还是锁着的状态下抓的，
    //    不一致就跳过日记那两项（否则每次开关日记都会红一次）
    fs.writeFileSync(FX + '/_shape.json', JSON.stringify({ _gate: gateNow, ...shape }, null, 2), 'utf8')
  console.log()
  console.log('  ✍️  已把新快照和 _shape.json 写回 fixtures/')
}

console.log()
console.log('  通过 ' + pass + '  失败 ' + fail)
if (!UPDATE && fail) {
  console.log()
  console.log('  字段变了的话：确认是**有意的**改动之后，跑 node test-fixtures.mjs --update 更新快照。')
}
process.exit(fail ? 1 : 0)

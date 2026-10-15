import { scanDay, words } from './sessions.js'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// ⚠️ 这个目录**不能写死** —— 那既是本机路径，也让别人 clone 下来跑不了。
//    从文件自己的位置往上推：文件在哪，插件根就在哪。
const ROOT = dirname(fileURLToPath(import.meta.url))

let pass = 0, fail = 0
const OK = (s) => { pass++; console.log('  ✅ ' + s) }
const NG = (s) => { fail++; console.log('  ❌ ' + s) }

const DAY = '2026-10-13'
const at = (h, m = 0) => new Date(2026, 9, 13, h, m, 0).getTime()

// ── 假的事件流：故意塞一句"绝不能外泄"的原话 ──
const SECRET = '我的银行卡密码是八个八'
const events = [
  { type: 'user/message', seq: 1, time: at(9), data: { text: '帮我看看材质绑定 ' + SECRET } },
  { type: 'turn/end', seq: 2, time: at(9, 1), data: null },
  { type: 'tool/result', seq: 3, time: at(10), data: { ok: false, error: 'ENOENT' } },
  { type: 'tool/result', seq: 4, time: at(10, 1), data: { ok: true } },
  { type: 'user/message', seq: 5, time: at(14), data: { content: [{ type: 'text', text: '细分材质再调一次' }] } },
  { type: 'turn/end', seq: 6, time: at(14, 2), data: null },
  { type: 'user/message', seq: 7, time: new Date(2026, 9, 12, 23, 0).getTime(), data: { text: '昨天的话不该算进来' } },
]

// ── 三种 list 形状 × 两种 page 形状，都要能挖出来 ──
const listShapes = {
  'items': { items: [{ sessionId: 's1', updatedAt: at(15) }] },
  'sessions': { sessions: [{ id: 's1', updatedAt: at(15) }] },
  '裸数组': [{ sessionId: 's1', updatedAt: at(15) }],
}
const pageShapes = {
  'records': { records: events.map((e) => ({ type: 'event', event: e })) },
  'events': { events },
}

console.log('=== ① 兼容各种返回形状 ===')
for (const [ln, lv] of Object.entries(listShapes)) {
  for (const [pn, pv] of Object.entries(pageShapes)) {
    const ctl = { list: async () => lv, page: async () => pv }
    const r = await scanDay(ctl, DAY)
    r && r.turns >= 4
      ? OK(`list=${ln} / page=${pn} → turns=${r.turns} errors=${r.errors}`)
      : NG(`list=${ln} / page=${pn} 没算出来: ${JSON.stringify(r)}`)
  }
}

console.log('\n=== ② 只算当天（昨天那条不算）===')
const ctl = { list: async () => listShapes.items, page: async () => pageShapes.records }
const r = await scanDay(ctl, DAY)
r.turns === 4 ? OK('turns=4（2 条用户消息 + 2 个 turn/end，正好对上）') : NG('turns=' + r.turns)
r.errors === 1 ? OK('errors=1（ok:false 那条）') : NG('errors=' + r.errors)

console.log('\n=== ③ ★ 输出里绝不能有原文 ===')
const dump = JSON.stringify(r)
dump.includes(SECRET) ? NG('原文泄露了！') : OK('那句"银行卡密码"没出现在输出里')
dump.includes('材质绑定') ? NG('原句「材质绑定」出现在了输出里') : OK('原句没有出现在输出里')
const longCn = dump.match(/[\u4e00-\u9fa5]{6,}/)
longCn ? NG('输出里有长中文串，可疑：' + longCn[0]) : OK('输出里最长的中文只有词，没有句子')
console.log('    输出全文: ' + dump)

console.log('\n=== ④ 高频词确实提出来了（只有词）===')
const ws = Object.keys(r.words)
ws.includes('材质') ? OK('提到了「材质」') : NG('没提到材质: ' + ws.join(','))
ws.length > 0 && ws.every((w) => w.length <= 8) ? OK('词都很短（' + ws.slice(0, 6).join(' ') + '）') : NG('有长词')

console.log('\n=== ⑤ 失败必须无害 —— 一律返回 null ===')
const bad = [
  ['没有服务', null],
  ['list 不是函数', {}],
  ['list 抛错', { list: async () => { throw new Error('boom') }, page: async () => ({}) }],
  ['date 格式错', { list: async () => listShapes.items, page: async () => pageShapes.records }],
]
for (const [n, c] of bad) {
  const res = n === 'date 格式错' ? await scanDay(c, '乱写') : await scanDay(c, DAY)
  res === null ? OK(n + ' → null（退回实时计数）') : NG(n + ' → ' + JSON.stringify(res))
}
const ctlThrowPage = { list: async () => listShapes.items, page: async () => { throw new Error('page boom') } }
;(await scanDay(ctlThrowPage, DAY)) === null ? OK('page 抛错 → null') : NG('page 抛错没兜住')

console.log('\n=== ⑥ words() 单独测 ===')
const bag = words('这个材质绑定要重新细分，材质材质')
bag.get('材质') === 3 ? OK('「材质」出现 3 次') : NG('材质=' + bag.get('材质'))
!bag.has('这个') ? OK('停用词「这个」被滤掉') : NG('停用词没滤掉')

console.log(`\n  通过 ${pass}   失败 ${fail}`)
process.exit(fail ? 1 : 0)

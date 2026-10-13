import * as M from 'file:///D:/chajian/dsh-mood/index.js'

const L = (id) => M.MOODS[id].label

console.log('=== 心情总数:', M.MOOD_IDS.length, '===')
console.log('  ' + M.MOOD_IDS.map(L).join(' · '))
console.log()
console.log('  亲密类:', M.ROMANTIC_MOODS.map(L).join(' / '))
console.log('  现实提醒间隔:', M.REALITY_NUDGE_INTERVAL_MS / 3600000, '小时')
console.log()

console.log('=== 亲密类触发 ===')
const cases = [
  ['心动', ['喜欢你', '想你了', '抱抱']],
  ['恋慕', ['陪着我', '只有你', '离不开你']],
  ['吃醋', ['她比你厉害', '换一个吧']],
]
for (const [n, msgs] of cases) {
  const a = {}
  for (const t of msgs) {
    const d = M.judgeMessage(t)
    for (const [k, v] of Object.entries(d)) a[k] = (a[k] || 0) + v
  }
  const top = Object.entries(a).sort((x, y) => y[1] - x[1]).slice(0, 3)
  console.log('  ' + n + ': ' + top.map(([k, v]) => L(k) + ' +' + (Math.round(v * 10) / 10)).join('  '))
}
console.log()

console.log('=== 依赖信号 __clingy ===')
for (const t of ['陪着我好不好', '只有你最懂我', '这个bug搞不定', '今天天气不错']) {
  console.log('  ' + t.padEnd(16) + '->', M.judgeMessage(t).__clingy)
}
console.log()

console.log('=== 误报检查：正常技术对话不该触发亲密类 ===')
const tech = ['把这个细分补绘做成Live2D模型', '帮我看下这个报错', '图层要分割成三份', '这个方案不行，重来']
let dirty = 0
for (const t of tech) {
  const d = M.judgeMessage(t)
  const rom = Object.keys(d).filter((k) => M.ROMANTIC_MOODS.includes(k) && d[k] > 0)
  if (rom.length) { dirty++; console.log('  ❌ ' + t + ' 触发了 ' + rom.map(L).join(',')) }
}
console.log(dirty === 0 ? '  ✅ 4 条技术消息零误报' : '  ❌ 有 ' + dirty + ' 条误报')
console.log()

console.log('=== 现实守则内容 ===')
console.log(M.REALITY_GUARD.split('\n').map((l) => '  ' + l).join('\n'))

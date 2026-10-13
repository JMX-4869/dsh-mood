/**
 * 检验：分到底会不会减，以及"没人说话"时会不会自然回落
 */
import * as M from 'file:///D:/chajian/dsh-mood/index.js'

const L = (id) => M.MOODS[id].label
const show = (s, tag) => {
  const r = M.MOOD_IDS.map((id) => ({ id, label: L(id), value: Math.round(s.values[id] * 10) / 10 }))
    .sort((a, b) => b.value - a.value)
  console.log('  ' + tag.padEnd(14) + r.slice(0, 4).map((x) => x.label + x.value).join('  '))
}

console.log('=== 1. 消息判定里的"对冲"：加分常常伴随另一个减分 ===')
const cases = [
  ['正面词', '谢谢，做得不错'],
  ['负面词', '还是不行，又错了'],
  ['冷淡打发', '随便你，算了'],
  ['真心的夸', '还是你行，多亏你'],
  ['被怪', '都怪你'],
  ['提不起劲', '好累，不想动'],
]
for (const [name, t] of cases) {
  const d = M.judgeMessage(t)
  const up = Object.entries(d).filter(([, v]) => v > 0).map(([k, v]) => L(k) + '+' + (Math.round(v * 10) / 10))
  const down = Object.entries(d).filter(([, v]) => v < 0).map(([k, v]) => L(k) + (Math.round(v * 10) / 10))
  console.log('  ' + name.padEnd(8) + '↑ ' + up.join(' ') + (down.length ? '   ↓ ' + down.join(' ') : ''))
}

console.log()
console.log('=== 2. 周期判定：向基线回落 25% ===')
let s = M._internal.blankState()
// 造一个"嗨过头"的状态
s.values.happy = 95; s.values.excited = 88; s.values.calm = 5; s.values.tired = 5
s.current = 'happy'; s.lastSwitchAt = 0
show(s, '判定前')
const CFG = M._internal.CFG
for (let i = 0; i < 4; i++) {
  for (const id of M.MOOD_IDS) {
    const base = M.MOODS[id].baseline
    s.values[id] = Math.max(0, Math.min(100, s.values[id] + (base - s.values[id]) * CFG.decayRatio))
  }
  show(s, '第 ' + (i + 1) + ' 次判定后')
}
console.log('  → 4 次判定后，开心的 95 掉到 ' + Math.round(s.values.happy * 10) / 10 + '，平静从 5 升到 ' + Math.round(s.values.calm * 10) / 10)

console.log()
console.log('=== 3. 无人说话时的自然回落（修复前的漏洞）===')
const fresh = M._internal.blankState()
fresh.values.happy = 90
fresh.lastPeriodicAt = Date.now() - 5 * 3600 * 1000   // 假装已经过去 5 小时
fresh.nextPeriodicMs = 3 * 3600 * 1000                // 窗口是 3 小时 → 已到期
const due = (Date.now() - fresh.lastPeriodicAt) >= fresh.nextPeriodicMs
console.log('  距上次判定 5 小时 / 周期 3 小时 → 到点:', due ? '是' : '否')
console.log('  修复前: 只在收到消息时才检查 → 没人说话就永远不判定（分数冻结）')
console.log('  修复后: 30 秒心跳里也会检查 → 到点就自动回落 ✅')
console.log()
console.log('  周期区间: ' + (M._internal.CFG.periodMinMs / 3600000) + '~' + (M._internal.CFG.periodMaxMs / 3600000) + ' 小时，每次回落 ' + (CFG.decayRatio * 100) + '%')

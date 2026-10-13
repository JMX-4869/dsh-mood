// diary.js 纯逻辑测试
import * as D from 'file:///D:/chajian/dsh-mood/diary.js'
import { MOODS } from 'file:///D:/chajian/dsh-mood/index.js'

const lbl = (id) => (MOODS[id] ? MOODS[id].label : id)
const DAY = 24 * 3600 * 1000

console.log('=== 1. 日期与时刻判定 ===')
const at = (h, m) => new Date(2026, 9, 13, h, m, 0)
console.log('  23:58 到点了吗:', D.diaryDue(at(23, 58)), '（应 false）')
console.log('  23:59 到点了吗:', D.diaryDue(at(23, 59)), '（应 true）')
console.log('  00:30 到点了吗:', D.diaryDue(at(0, 30)), '（应 false）')
console.log('  dateKey:', D.dateKey(at(15, 0)))

console.log()
console.log('=== 2. 攒素材：一天的活动 ===')
const d = D.blankDiary()
let t = new Date(2026, 9, 13, 9, 12).getTime()
D.noteActivity(d, 'message', t)
D.noteMood(d, 'calm', t)
for (let i = 0; i < 35; i++) {
  t += 9 * 60 * 1000
  D.noteActivity(d, i % 3 === 0 ? 'turn' : 'message', t)
  if (i === 12) { D.noteSwitch(d, 'calm', 'curious', t); D.noteMood(d, 'curious', t) }
  if (i === 24) { D.noteSwitch(d, 'curious', 'happy', t); D.noteMood(d, 'happy', t) }
  if (i === 30) { D.noteActivity(d, 'error', t); D.noteActivity(d, 'error', t) }
}
D.noteMood(d, 'happy', t + 20 * 60 * 1000)

const key = D.dateKey(at(0, 0))
const b = d.daily[key]
console.log('  消息:', b.messages, ' 轮次:', b.turns, ' 报错:', b.errors, ' 切换:', b.switches.length)
console.log('  心情停留:', Object.entries(b.moodMs).map(([k, v]) => lbl(k) + Math.round(v / 60000) + '分').join(' / '))
console.log('  主导心情:', lbl(D.dominantMood(b)))

console.log()
console.log('=== 3. 合成日记 ===')
const text = D.composeDiary(key, b, lbl)
console.log('─'.repeat(46))
console.log(text)
console.log('─'.repeat(46))

console.log()
console.log('=== 4. ensureDiary（幂等）===')
const r1 = D.ensureDiary(d, key, lbl)
console.log('  第一次:', r1 ? (r1.created ? '新建' : '更新') : '跳过')
const r2 = D.ensureDiary(d, key, lbl)
console.log('  第二次:', r2 ? (r2.created ? '新建' : '更新') : '跳过（内容没变，正确）')

console.log()
console.log('=== 5. 模型改写后不被覆盖 ===')
D.writeDiary(d, key, '今天我改写了这篇日记。', lbl)
const r3 = D.ensureDiary(d, key, lbl)
console.log('  改写后再 ensure:', r3 ? '❌ 被覆盖了' : '✅ 跳过（保护模型的手写内容）')
console.log('  当前内容:', d.entries.find(e => e.date === key).text)

console.log()
console.log('=== 6. 空白的一天 ===')
const d2 = D.blankDiary()
const k2 = '2026-10-12'
D.dayBucket(d2, k2)
D.ensureDiary(d2, k2, lbl)
console.log('  ' + d2.entries.find(e => e.date === k2).text)

console.log()
console.log('=== 7. 素材清理 ===')
const d3 = D.blankDiary()
for (let i = 0; i < 200; i++) d3.daily['2026-' + String(i).padStart(2, '0') + '-01'] = { messages: 1 }
console.log('  清理前:', Object.keys(d3.daily).length, '  清理掉:', D.pruneDaily(d3, 180), '  清理后:', Object.keys(d3.daily).length)

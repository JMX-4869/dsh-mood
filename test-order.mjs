// 日记排序检查：宿主给的是新→旧，客户端 asc 时翻转
import * as D from 'file:///D:/chajian/dsh-mood/diary.js'

const d = D.blankDiary()
// 造 5 天
for (const k of ['2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13']) {
  const b = D.dayBucket(d, k)
  b.messages = 5; b.turns = 3; b.firstAt = Date.now() - 3600000; b.lastAt = Date.now()
  D.ensureDiary(d, k, (id) => id)
}

const dates = d.entries.map((e) => e.date)
console.log('宿主返回顺序:', dates.join(' , '))
const isDesc = dates.every((v, i) => i === 0 || dates[i - 1] > v)
console.log('  是否新→旧（宿主默认）:', isDesc ? '✅ 是' : '❌ 否')

const flipped = d.entries.slice().reverse().map((e) => e.date)
console.log('客户端翻转后  :', flipped.join(' , '))
const isAsc = flipped.every((v, i) => i === 0 || flipped[i - 1] < v)
console.log('  是否旧→新（用户切换）:', isAsc ? '✅ 是' : '❌ 否')

console.log()
console.log('总篇数:', d.entries.length, d.entries.length === 5 ? '✅' : '❌')

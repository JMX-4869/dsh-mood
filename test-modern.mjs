import * as M from 'file:///D:/chajian/dsh-mood/index.js'

const L = (id) => M.MOODS[id].label
const acc = (msgs) => {
  const a = {}
  for (const t of msgs) {
    const d = M.judgeMessage(t)
    for (const [k, v] of Object.entries(d)) a[k] = (a[k] || 0) + v
  }
  return Object.entries(a).sort((x, y) => y[1] - x[1]).slice(0, 3)
    .map(([k, v]) => L(k) + ' +' + (Math.round(v * 10) / 10)).join('  ')
}

console.log('=== 心情总数:', M.MOOD_IDS.length, '===')
console.log('  ' + M.MOOD_IDS.map(L).join(' · '))
console.log()

console.log('=== 当代说法触发 ===')
console.log('  内耗:', acc(['内耗太严重了', '一直在想太多', '又绕回来了，自我怀疑']))
console.log('  破防:', acc(['这句话破防了', '绷不住，扎心', '心态崩了']))
console.log('  摆烂:', acc(['算了摆烂吧', '卷不动了，躺平', '爱咋咋地']))
console.log('  上头:', acc(['这个太上头了', '根本停不下来', '越看越来劲']))
console.log()

console.log('=== 区分度：新词 vs 老词不该被混为一谈 ===')
console.log('  内耗 vs 焦虑  : 内耗=', acc(['想太多了，内耗']), ' | 焦虑=', acc(['怕来不及，万一出事']))
console.log('  摆烂 vs 麻木  : 摆烂=', acc(['摆烂，不想卷']), ' | 麻木=', acc(['无所谓，没感觉']))
console.log('  上头 vs 兴奋  : 上头=', acc(['上头，停不下来']), ' | 兴奋=', acc(['太好了！！']))
console.log('  破防 vs 委屈  : 破防=', acc(['破防了，绷不住']), ' | 委屈=', acc(['都怪你，明明不是我的错']))
console.log()

console.log('=== 误报检查 ===')
const tech = ['把这个细分补绘做成Live2D模型', '帮我看下这个报错', '图层分割成三份', '这个方案不行，重来', '继续优化压缩包']
let dirty = 0
for (const t of tech) {
  const d = M.judgeMessage(t)
  const hit = Object.entries(d).filter(([k, v]) => v > 0 && ['burnout', 'cracked', 'checkedout', 'hyper'].includes(k))
  if (hit.length) { dirty++; console.log('  ❌ "' + t + '" → ' + hit.map(([k]) => L(k)).join(',')) }
}
console.log(dirty === 0 ? '  ✅ 5 条技术消息零误报' : '  ❌ ' + dirty + ' 条误报')

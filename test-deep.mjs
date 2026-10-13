import * as M from 'file:///D:/chajian/dsh-mood/index.js'

const L = (id) => (M.MOODS[id] ? M.MOODS[id].label : id)
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
console.log('  ' + M.MOOD_IDS.map((id) => L(id) + '(' + M.MOODS[id].baseline + ')').join('  '))
console.log()

console.log('=== 新四类触发 ===')
console.log('  消沉:', acc(['提不起劲', '好累，什么都不想动', '没意思']))
console.log('  焦虑:', acc(['万一还是不行呢', '怕来不及', '会不会出问题']))
console.log('  麻木:', acc(['无所谓了', '都行', '没什么感觉']))
console.log('  孤单:', acc(['好久没人说话了', '一个人待着']))
console.log()

console.log('=== 区分度检查（这些不该混淆）===')
console.log('  生闷气(冷淡打发):', acc(['随便你', '算了', '不用了']))
console.log('  麻木(真没感觉)  :', acc(['无所谓', '都行', '没什么感觉']))
console.log('  消沉(提不起劲)  :', acc(['好累', '不想动', '没劲']))
console.log('  低落(泛泛地低)  :', acc(['还是不行', '又这样']))
console.log()

console.log('=== 真实痛苦信号（不进心情计算）===')
for (const t of ['我不想活了', '撑不下去了', '今天天气不错', '这个bug搞不定']) {
  const d = M.judgeMessage(t)
  console.log('  "' + t + '" -> __distress =', d.__distress, '  可枚举心情键:', Object.keys(d).map(L).join(',') || '（无）')
}

// dsh-mood 纯逻辑测试（不加载 DSH 运行时）
import { MOODS, MOOD_IDS, judgeMessage, _internal } from 'file:///D:/chajian/dsh-mood/index.js'

const { blankState, tryTransition, CFG } = _internal

function show(s, tag = '') {
  const ranked = MOOD_IDS.map(id => `${MOODS[id].label}${Math.round(s.values[id] * 10) / 10}`).join(' ')
  console.log(`  ${tag}当前=${MOODS[s.current].label}  ${ranked}`)
}

console.log('=== 1. 初始状态 ===')
let s = blankState()
show(s, '')

console.log()
console.log('=== 2. 单条正面消息（应几乎不动 / 不切换）===')
let d = judgeMessage('谢谢，做得挺好的')
console.log('  判分:', JSON.stringify(d))
for (const [id, v] of Object.entries(d)) s.values[id] = Math.max(0, Math.min(100, s.values[id] + v))
s.lastSwitchAt = Date.now()      // 模拟刚切换过
let r = tryTransition(s, 'test')
show(s, '')
console.log('  是否切换:', r.switched)

console.log()
console.log('=== 3. 连续 6 条正面消息（累积后应切到开心）===')
const good = ['不错不错', '厉害啊', '好的谢谢', '哈哈可以', '棒，搞定', '给力！']
s.messages = 0
for (let i = 0; i < good.length; i++) {
  const c = judgeMessage(good[i])
  for (const [id, v] of Object.entries(c)) s.values[id] = Math.max(0, Math.min(100, s.values[id] + v))
  s.messages++
  const rr = tryTransition(s, 'user-message', Date.now() + (i + 1) * 20 * 60 * 1000) // 每次跨越 20 分钟
  if (rr.switched) console.log(`  第 ${i + 1} 条后切换: ${MOODS[rr.from].label} → ${MOODS[rr.to].label}`)
}
show(s, '6 条之后 ')

console.log()
console.log('=== 4. 连续 5 条挫折消息（应切到烦躁）===')
const bad = ['还是不行啊', '又报错了，到底怎么回事', '搞不定，白做了', '慢死了，无语', '算了，重启吧']
for (let i = 0; i < bad.length; i++) {
  const c = judgeMessage(bad[i])
  for (const [id, v] of Object.entries(c)) s.values[id] = Math.max(0, Math.min(100, s.values[id] + v))
  const rr = tryTransition(s, 'user-message', Date.now() + (good.length + i + 1) * 20 * 60 * 1000)
  if (rr.switched) console.log(`  第 ${i + 1} 条后切换: ${MOODS[rr.from].label} → ${MOODS[rr.to].label}`)
}
show(s, '5 条之后 ')

console.log()
console.log('=== 5. 周期判定（向基线回落）===')
for (const id of MOOD_IDS) {
  const base = MOODS[id].baseline
  s.values[id] = s.values[id] + (base - s.values[id]) * CFG.decayRatio
}
r = tryTransition(s, 'periodic', Date.now() + 86400000)
show(s, '周期后 ')
console.log('  是否切换:', r.switched)

console.log()
console.log('=== 6. 极端：连发 20 条挫折消息 ===')
s = blankState()
s.lastSwitchAt = Date.now() - 7200000
let flips = 0
for (let i = 0; i < 20; i++) {
  const c = judgeMessage(bad[i % bad.length])
  for (const [id, v] of Object.entries(c)) s.values[id] = Math.max(0, Math.min(100, s.values[id] + v))
  const rr = tryTransition(s, 'user-message', Date.now() + i * 20 * 60 * 1000)
  if (rr.switched) flips++
}
show(s, '20 条后 ')
console.log('  切换次数:', flips, '（不应每轮都切）')

console.log()
console.log('=== 7. 空消息 / 纯数字（不应崩溃）===')
for (const t of ['', '   ', '12345', null, undefined]) {
  console.log(`  ${JSON.stringify(t)} ->`, JSON.stringify(judgeMessage(t)))
}

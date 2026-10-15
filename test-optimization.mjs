/**
 * 优化回归：品味库的 id 计数只应影响当前那份库。
 *
 * 这个测试专门锁住多实例场景：同一进程里同时维护两份库时，先改哪一份
 * 不该改变另一份新条目的形状。它不检查具体时间戳，只检查库内唯一和实例隔离。
 */
import { blankTaste, addPrinciple, addItem } from './taste.js'

let pass = 0
let fail = 0
const ok = (name, condition, detail = '') => {
  if (condition) { pass++; console.log('  ✅ ' + name) }
  else { fail++; console.log('  ❌ ' + name + (detail ? ' → ' + detail : '')) }
}

const one = blankTaste()
const two = blankTaste()
const a = addPrinciple(one, '测试库甲的原则：主体要有清晰的视觉落点。')
const b = addPrinciple(one, '测试库甲的第二条原则：次要信息要主动降噪。')
const c = addPrinciple(two, '测试库乙的原则：先保证内容再处理装饰。')
ok('同一库新增原则仍保持唯一 id', a.ok && b.ok && a.principle.id !== b.principle.id)
ok('不同库不会共享模块计数器', a.ok && c.ok && /p.+1$/.test(a.principle.id) && /p.+1$/.test(c.principle.id),
  JSON.stringify({ a: a.principle.id, c: c.principle.id }))

const itemA = addItem(one, { ref: 'asset-a', kind: 'positive', myRead: '甲库读法' })
const itemB = addItem(two, { ref: 'asset-b', kind: 'positive', myRead: '乙库读法' })
ok('条目 id 也按各自库隔离', itemA.ok && itemB.ok && /i.+1$/.test(itemA.item.id) && /i.+1$/.test(itemB.item.id),
  JSON.stringify({ a: itemA.item.id, b: itemB.item.id }))

console.log(`  通过 ${pass}  失败 ${fail}`)
process.exit(fail ? 1 : 0)

/**
 * 心情判定与转移。
 *
 * ⚠️ 原来这个文件**只打印**（"是否切换: true/false"这种）——
 *    也就是说：改了判定逻辑它红不了。现在断言的是**不变量**，
 *    不是某次具体转移（具体转移到哪是涌现出来的，锁死它反而脆）。
 */
import * as M from './index.js'
import { suite } from './testkit.mjs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// ⚠️ 这个目录**不能写死** —— 那既是本机路径，也让别人 clone 下来跑不了。
//    从文件自己的位置往上推：文件在哪，插件根就在哪。
const ROOT = dirname(fileURLToPath(import.meta.url))

const t = suite('心情判定与转移')
const { blankState, tryTransition, CFG } = M._internal
const J = M.judgeMessage
const L = (id) => M.MOODS[id].label

/** 把一次判定的加减分应用到状态上 */
function apply(s, changes) {
  for (const [id, v] of Object.entries(changes)) {
    if (id.startsWith('__')) continue
    if (!(id in s.values)) continue
    s.values[id] = Math.max(0, Math.min(100, s.values[id] + v))
  }
}

// ── 初始状态 ──
{
  const s = blankState()
  t.has(s, 'current', '有 current')
  t.has(s, 'values', '有 values')
  t.has(s, 'history', '有 history')
  t.eq(Object.keys(s.values).length, 33, '33 个分值键都在')
  t.ok(!!M.MOODS[s.current], 'current 是个合法心情：' + L(s.current))
}

// ── 单条消息不该切（防抖）──
{
  const s = blankState()
  s.lastSwitchAt = Date.now()      // 刚切过
  apply(s, J('谢谢，做得挺好的'))
  const r = tryTransition(s, 'test', Date.now())
  t.eq(r.switched, false, '单条正面消息 + 刚切过 → 不切换')
}

// ── 阈值：候选要超出当前 margin 才允许切 ──
{
  const s = blankState()
  s.lastSwitchAt = Date.now() - CFG.minHoldMs - 1000   // 早就过了冷却
  const cur = s.current
  // 给当前心情很高分，候选只高一点点
  s.values[cur] = 50
  const other = M.MOOD_IDS.find((id) => id !== cur)
  s.values[other] = 50 + CFG.margin - 1
  const r1 = tryTransition(s, 'test', Date.now())
  t.eq(r1.switched, false, '候选只高出 margin-1 → 不切（要超出 5 分）')
  s.values[other] = 50 + CFG.margin + 1
  const r2 = tryTransition(s, 'test', Date.now())
  t.eq(r2.switched, true, '候选高出 margin+1 → 切')
  t.eq(r2.to, other, '切到分最高的那个')
}

// ── 冷却：15 分钟内不许再切 ──
{
  const s = blankState()
  const now = Date.now()
  s.lastSwitchAt = now - CFG.minHoldMs + 60000     // 才过 14 分钟
  const other = M.MOOD_IDS.find((id) => id !== s.current)
  s.values[other] = 99
  const r = tryTransition(s, 'test', now)
  t.eq(r.switched, false, '冷却期内就算有人 99 分也不切')
  t.eq(CFG.minHoldMs / 60000, 15, '冷却是 15 分钟')
}

// ── 连续正面消息：最终会切，但不是每条都切 ──
{
  const s = blankState()
  s.lastSwitchAt = 0
  const good = ['不错不错', '厉害啊', '好的谢谢', '哈哈可以', '棒，搞定', '给力！']
  let flips = 0
  for (let i = 0; i < good.length; i++) {
    apply(s, J(good[i]))
    const r = tryTransition(s, 'user-message', Date.now() + (i + 1) * 20 * 60 * 1000)
    if (r.switched) flips++
  }
  t.ok(flips >= 1, '六条正面消息之后至少切过一次（' + flips + ' 次）')
  t.lt(flips, good.length, '但不是每条都切（' + flips + ' < ' + good.length + '）')
}

// ── 极端：连发 20 条挫折消息，也不该每轮都切 ──
{
  const s = blankState()
  s.lastSwitchAt = Date.now() - 7200000
  const bad = ['还是不行啊', '又报错了，到底怎么回事', '搞不定，白做了', '慢死了，无语', '算了，重启吧']
  let flips = 0
  for (let i = 0; i < 20; i++) {
    apply(s, J(bad[i % bad.length]))
    const r = tryTransition(s, 'user-message', Date.now() + i * 20 * 60 * 1000)
    if (r.switched) flips++
  }
  t.lt(flips, 20, '20 条里切换次数远少于 20（' + flips + ' 次）')
  t.ok(flips >= 1, '但也不是完全不动（' + flips + ' 次）')
}

// ── 分值永远在 0~100 ──
{
  const s = blankState()
  s.lastSwitchAt = 0
  for (let i = 0; i < 60; i++) {
    apply(s, J(i % 2 ? '气死了，全是错' : '谢谢，太好了，厉害'))
    tryTransition(s, 'user-message', Date.now() + i * 20 * 60 * 1000)
  }
  let ok = true
  for (const id of M.MOOD_IDS) if (!(s.values[id] >= 0 && s.values[id] <= 100)) ok = false
  t.ok(ok, '狂轰 60 条之后每一项仍在 0~100')
}

// ── 历史不会无限涨 ──
{
  const s = blankState()
  s.lastSwitchAt = 0
  for (let i = 0; i < 200; i++) {
    s.values.happy = i % 2 ? 90 : 1
    s.values.tired = i % 2 ? 1 : 90
    tryTransition(s, 'test', Date.now() + i * 20 * 60 * 1000)
  }
  // ⚠️ 这条以前是红的：上限只在 loadState 里裁，运行中不裁 ——
  //    跑 200 次切换 history 就是 200 条（写的是 60）。每条的 values 是 33 个数字的快照。
  t.ok(s.history.length <= CFG.historyMax, '历史不超过 historyMax（' + s.history.length + ' ≤ ' + CFG.historyMax + '）')
  t.eq(CFG.historyMax, 60, '上限是 60 条')
}

// ── 坏输入不崩 ──
{
  for (const bad of ['', '   ', '12345', null, undefined, 123]) {
    t.noThrow(() => J(bad), 'judgeMessage 坏输入不崩：' + JSON.stringify(bad))
  }
  const s = blankState()
  t.noThrow(() => tryTransition(s, 'weird', Date.now()), 'tryTransition 对未知 reason 不崩')
}

t.done()

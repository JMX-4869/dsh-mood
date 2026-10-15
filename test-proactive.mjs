import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// ⚠️ 这个目录**不能写死** —— 那既是本机路径，也让别人 clone 下来跑不了。
//    从文件自己的位置往上推：文件在哪，插件根就在哪。
const ROOT = dirname(fileURLToPath(import.meta.url))
const P = await import(new URL('proactive.js?t=', import.meta.url).href + Date.now())
let pass = 0, fail = 0
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  ✅ ' + n) } else { fail++; console.log('  ❌ ' + n + (x ? '  → ' + x : '')) } }

console.log('════ 时段表铺满 24 小时吗 ════')
const cover = []
for (const s of P.SLOTS) for (let h = s.from; h < s.to; h++) cover.push(h)
ok('覆盖 0~23 每个整点恰好一次', cover.length === 24 && new Set(cover).size === 24, '实际 ' + cover.length + ' 个')
ok('7 个时段', P.SLOTS.length === 7, P.SLOTS.length + '')
ok('没缝：每个整点都落进某段', [0, 3, 7, 8, 9, 12, 13, 14, 18, 20, 21, 23].every((h) => !!P.slotOf(h)))

console.log()
console.log('════ 空数组 = 全时段 ════')
for (const h of [0, 7, 12, 18, 23]) ok('  空选时 ' + h + ' 点允许', P.slotAllowed({ slots: [] }, h) === true)
ok('  没这个字段也允许', P.slotAllowed({}, 3) === true)
ok('  undefined 也允许', P.slotAllowed(undefined, 3) === true)

console.log()
console.log('════ 选了就只在选的里 ════')
const pick = { slots: ['am2', 'pm'] }   // 上午 9~12、下午 14~18
for (const [h, want] of [[10, true], [15, true], [8, false], [13, false], [20, false], [3, false]]) {
  ok('  选【上午+下午】时 ' + h + ' 点 → ' + (want ? '允许' : '禁止'), P.slotAllowed(pick, h) === want)
}
ok('  只选深夜时 3 点允许', P.slotAllowed({ slots: ['deep'] }, 3) === true)
ok('  只选深夜时白天禁止', P.slotAllowed({ slots: ['deep'] }, 12) === false)

console.log()
console.log('════ canSpeak 接上了吗（它读 p.cfg）════')
const mk = (slots, h) => ({
  cfg: { enabled: true, idleMs: 0, minGapMs: 0, maxPerDay: 99, quietFrom: 1, quietTo: 7, slots },
  lastSpokeAt: 0,
  sent: [],
  awaitingReply: false,
})
const at = (h) => new Date(2026, 9, 14, h, 30, 0).getTime()
const ctx = { busy: false, lastUserAt: at(0) }

const a1 = P.canSpeak(mk([], 15), at(15), ctx)
ok('  全时段：下午 3 点能开口', a1.ok === true, a1.reason)
const a2 = P.canSpeak(mk(['am2'], 15), at(15), ctx)
ok('  只选上午时下午 3 点不行', a2.ok === false && /不在你选的时段/.test(a2.reason), a2.reason)
const a3 = P.canSpeak(mk(['am2'], 10), at(10), ctx)
ok('  只选上午时上午 10 点可以', a3.ok === true, a3.reason)
const a4 = P.canSpeak(mk(['deep'], 3), at(3), ctx)
ok('  静默优先于时段（深夜选了也被静默拦）', a4.ok === false && /静默/.test(a4.reason), a4.reason)
const a5 = P.canSpeak(mk(['eve2'], 22), at(22), ctx)
ok('  晚间 22 点可以', a5.ok === true, a5.reason)

// ══════════════════════════════════════════════════════════════
//  重启汇报
// ══════════════════════════════════════════════════════════════
console.log()
console.log('════ 认出"真的重启"，而不是热重载 ════')
const ps = P.processStart()
ok('  processStart 合理（早于现在、不早于一天前）', ps < Date.now() && ps > Date.now() - 86400000,
  new Date(ps).toISOString())

const b1 = P.blankProactive()
let rb = P.noteBoot(b1, Date.now(), 0)
ok('  第一次启动：不算重启', rb.restarted === false && b1.pendingRestart === false, JSON.stringify(rb))
ok('  但记下了 procStart', b1.procStart > 0)

// 同一个进程再挂载一次 = HMR 重载插件 —— **不该**被当成重启
const rb2 = P.noteBoot(b1, Date.now(), 0)
ok('  热重载不算重启（用进程时刻而不是插件加载时刻）', rb2.restarted === false && b1.pendingRestart === false, JSON.stringify(rb2))

// procStart 变了 = 宿主真的重启过
//
// ⚠️ 但**只有"因为改了东西才重启"才挂待办**。
//    原来这里是 `if (restarted) pendingRestart = true` —— 只要进程启动时刻变了就挂。
//    后果：主人随手开一下 DSH 也会在几十秒后收到"宿主刚重启过，去看一眼现在的实际状态"，
//    而他什么都没让插件改。这条期望是**跟着旧语义写的**，现在一起改。
const b2 = P.blankProactive()
b2.procStart = Date.now() - 3600_000
const rb3 = P.noteBoot(b2, Date.now(), b2.procStart - 60_000)
ok('  procStart 变了 → 认出重启', rb3.restarted === true, JSON.stringify(rb3))
ok('  但没改过东西 → needed=false', rb3.needed === false, JSON.stringify(rb3))
ok('  → 也就不挂待办（随手开一下不该弹）', b2.pendingRestart === false, JSON.stringify(rb3))

// 上一轮运行期间文件被改过 → 这次重启是"需要"的 → 挂待办
const b2b = P.blankProactive()
b2b.procStart = Date.now() - 3600_000
const rb3b = P.noteBoot(b2b, Date.now(), b2b.procStart + 600_000)
ok('  上一轮期间改过文件 → needed=true 且挂待办',
  rb3b.needed === true && b2b.pendingRestart === true, JSON.stringify(rb3b))

console.log()
console.log('════ 改动待生效（文件比进程新）════')
const b3 = P.blankProactive()
P.noteBoot(b3, Date.now(), 0)
const rb4 = P.noteBoot(b3, Date.now(), Date.now() + 60000)
ok('  文件比进程新 → stale', rb4.stale === true && b3.pendingStale === true, JSON.stringify(rb4))

console.log()
console.log('════ 关掉开关就不挂待办 ════')
const b4 = P.blankProactive()
b4.cfg.reportRestart = false
b4.cfg.warnStale = false
b4.procStart = Date.now() - 3600_000
P.noteBoot(b4, Date.now(), Date.now() + 60000)
ok('  reportRestart=false', b4.pendingRestart === false)
ok('  warnStale=false', b4.pendingStale === false)

console.log()
console.log('════ 汇报完清标记（不能每个回合都念一遍）════')
P.markReported(b2, Date.now())
ok('  待办清掉了', b2.pendingRestart === false && b2.reportedAt > 0)

console.log()
console.log('════ 投递文本 ════')
const t1 = P.buildRestartNudge('restart')
const t2 = P.buildRestartNudge('stale')
ok('  restart：说明是刚重启过', /刚重启过/.test(t1))
ok('  restart：要求说具体、不许"一切正常"', /具体的/.test(t1) && /没有信息量/.test(t1))
ok('  restart：给了回绝出口 <silent/>', t1.includes('<silent/>'))
ok('  stale：区分了 HMR 和宿主配置', /HMR/.test(t2) && /宿主配置/.test(t2))
ok('  两条都写明"不是你发的"（不伪造用户的话）', /不是你发的/.test(t1) && /不是你发的/.test(t2))
ok('  两条都不是命令式（说不说由模型定）', /由模型/.test(t1 + t2) || /没什么可说的/.test(t1))

console.log()
console.log('  通过 ' + pass + '  失败 ' + fail)
process.exit(fail ? 1 : 0)

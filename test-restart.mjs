/**
 * 重启汇报：**什么时候该发** + **发到哪个对话**。
 *
 * ────────────────────────────────────────────────────────────────
 *  主人报的两个问题
 * ────────────────────────────────────────────────────────────────
 *  ①「重启信息发别的对话了，要发在对应的对话框」
 *     投递用的是 `liveSession`（最近一次有动静的 session）——
 *     他切过对话，提醒就跑到别的对话框去了。
 *
 *  ②「不是每次重启都发，需要重启才发」
 *     `noteBoot` 原来是 `if (restarted) pendingRestart = true` ——
 *     只要进程启动时刻变了就挂待办。随手开一下 DSH 也会在几十秒后收到
 *     "宿主刚重启过，去看一眼现在的实际状态"，而他**什么都没让插件改**。
 *
 *  这两条各自单独测 —— 别只测一条就当两件都好了。
 */
import { suite } from './testkit.mjs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// ⚠️ 这个目录**不能写死** —— 那既是本机路径，也让别人 clone 下来跑不了。
//    从文件自己的位置往上推：文件在哪，插件根就在哪。
const ROOT = dirname(fileURLToPath(import.meta.url))

const P = await import(new URL('proactive.js?t=', import.meta.url).href + Date.now())
const t = suite('重启汇报：何时发、发给谁')

const HOUR = 3600000
// 用一个固定"现在"，免得踩到静默时段
const NOW = new Date('2026-10-14T15:00:00').getTime()

// ══════════════════════════════════════════════════════════
//  ① 什么时候该发
// ══════════════════════════════════════════════════════════
{
  const mk = (procStart, extra = {}) => ({
    ...P.blankProactive(), cfg: { ...P.DEFAULTS }, procStart, ...extra,
  })

  // 第一次装：没有 prev → 不该说要汇报
  {
    const p = mk(0)
    const r = P.noteBoot(p, NOW, NOW - 10 * HOUR)
    t.eq(r.restarted, false, '第一次装不算重启')
    t.eq(r.needed, false, '第一次装不需要汇报')
    t.eq(p.pendingRestart, false, '第一次装不挂待办')
  }

  // 上一轮运行期间**文件被改过** → 这次重启是"需要"的 → 该汇报
  {
    const prev = NOW - 2 * HOUR
    const p = mk(prev)
    // 文件比上一轮的启动时刻新（= 上一轮跑到一半代码变了）
    const r = P.noteBoot(p, NOW, prev + 30 * 60000)
    t.eq(r.restarted, true, '认出重启')
    t.eq(r.needed, true, '上一轮期间改过文件 → 这次重启是需要的')
    t.eq(p.pendingRestart, true, '该汇报')
  }

  // 什么都没改，只是随手开了一下 → **不该**汇报（这就是主人抱怨的那条）
  {
    const prev = NOW - 2 * HOUR
    const p = mk(prev)
    // 文件比上一轮的启动时刻还老 → 上一轮期间没人动过它
    const r = P.noteBoot(p, NOW, prev - 5 * HOUR)
    t.eq(r.restarted, true, '仍然认出重启')
    t.eq(r.needed, false, '没改过任何东西 → 不需要汇报')
    t.eq(p.pendingRestart, false, '**不挂待办**（这就是"随手开一下不该弹"）')
  }

  // 边界：文件时间戳刚好等于上一轮启动 → 不算改过
  {
    const prev = NOW - 2 * HOUR
    const p = mk(prev)
    const r = P.noteBoot(p, NOW, prev)
    t.eq(r.needed, false, '文件时间戳等于上一轮启动 → 不算"改过"（要严格大于）')
  }

  // 关掉这个功能就一律不挂
  {
    const prev = NOW - 2 * HOUR
    const p = mk(prev)
    p.cfg.reportRestart = false
    const r = P.noteBoot(p, NOW, prev + 30 * 60000)
    t.eq(r.needed, true, '判据本身还是 true')
    t.eq(p.pendingRestart, false, '但功能关着 → 不挂待办')
  }

  // 说一次就够：报完之后同样的文件时间戳不该再触发
  {
    const prev = NOW - 2 * HOUR
    const p = mk(prev)
    P.noteBoot(p, NOW, prev + 30 * 60000)
    t.eq(p.pendingRestart, true, '第一次挂上了')
    P.markReported(p, NOW + 60000)
    t.eq(p.pendingRestart, false, '报完清掉')
    // 再启动一次：这次 prev 是 NOW，而文件时间戳（prev+30min）比 NOW 老
    const r2 = P.noteBoot(p, NOW + 3 * HOUR, prev + 30 * 60000)
    t.eq(r2.needed, false, '同样的文件时间戳不会二次触发（自带"说一次就够"）')
  }

  // 文件在这次进程启动**之后**才改 → 那是 pendingStale，不是重启汇报
  {
    const prev = NOW - 2 * HOUR
    const p = mk(prev)
    const r = P.noteBoot(p, NOW, NOW + 10 * 60000)
    t.eq(r.stale, true, '文件比进程新 → stale')
    t.eq(r.needed, true, '它同时也满足 needed（上一轮期间改过）')
    t.eq(p.pendingStale, true, '挂上 stale 待办')
  }
}

// ══════════════════════════════════════════════════════════
//  ② 发给哪个对话
// ══════════════════════════════════════════════════════════
{
  const p = P.blankProactive()
  t.eq(p.reportSid, '', '新建时没有绑定任何对话')
  P.markReported(p, NOW)
  t.eq(p.reportSid, '', '报完之后解绑（下一条提醒重新挑对话）')

  // 换一次待办要重新挑 —— 上次投过的那条不能再背这口锅
  {
    const q = { ...P.blankProactive(), cfg: { ...P.DEFAULTS }, procStart: NOW - 2 * HOUR, reportSid: 'old-session' }
    P.noteBoot(q, NOW, NOW - 2 * HOUR + 30 * 60000)
    t.eq(q.reportSid, '', '新待办挂上时清掉旧的绑定')
  }
}

// ══════════════════════════════════════════════════════════
//  ③ 投递逻辑：源码层面的两条硬要求
// ══════════════════════════════════════════════════════════
{
  const fs = await import('node:fs')
  const host = fs.readFileSync(join(ROOT, 'index.js'), 'utf8')
  // 投递用绑定值，不用"最近有动静的那个"
  const fn = host.slice(host.indexOf('async function maybeReportRestart'), host.indexOf('async function maybeReportRestart') + 3000)
  t.has(fn, "const sid = proactive.reportSid", '投递用的是绑定的对话（不是 liveSession）')
  t.ok(!/const sid = sessionIdOf\(liveSession\)/.test(fn), '不再拿"最近有动静的 session"当投递目标')
  t.has(fn, '还不知道该投给哪个对话', '没绑定就等着，不乱投')
  t.has(fn, '当前活跃的是别的对话', '活跃的是别的对话时也等着，绝不就近投递')
}

// ══════════════════════════════════════════════════════════
//  ④ 绑定时机：主人在某个对话里开口那一刻
// ══════════════════════════════════════════════════════════
{
  const fs = await import('node:fs')
  const host = fs.readFileSync(join(ROOT, 'index.js'), 'utf8')
  // ⚠️ 锚**那行代码本身**，别锚注释里的词 —— 上面那段解释性注释里也有 reportSid，
  //    锚在注释上会把窗口开进注释里，断言就"看不见"真正的代码了。
  const i = host.indexOf('const sid0 = sessionIdOf(session || liveSession)')
  t.gt(i, 0, 'user/message 里有绑定逻辑（找得到取当前会话 id 那行）')
  // ⚠️ **先剥注释再查代码。**
  //    这个项目里凡是"用正则检查代码文本"的断言都栽过同一个坑：
  //    解释性注释里出现了同样的词，断言就匹配到自己的注释上。
  //    这里更直接 —— 注释太长会把窗口撑爆，真正的代码反而落不进来。
  const raw = host.slice(Math.max(0, i - 500), i + 1600)
  const block = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/[^\n]*$/gm, '')
  t.has(block, 'sessionIdOf', '绑定用的是当前这个会话的 id')
  t.ok(!/reportSid = sid0;\s*$/.test(block.replace(/\s+/g, ' ').trim()) ||
    /if \(sid0\) proactive\.reportSid = sid0/.test(block), '取不到 id 就不绑（不写空值）')
  // ⚠️ 判据改过一次：能不被覆盖，看的是绑定的**来源**。
  //    · 启动时靠 list() 猜的（reportSidFrom=guess）→ 他开口就覆盖
  //      （猜错时原来会永远投不出去，实测踩过）
  //    · 他在某条对话里亲口定下的（reportSidFrom=user）→ 不许动
  //      （他早先明确要求过「重启信息不要发到别的对话去」）
  t.has(block, "reportSidFrom === 'guess'", '只覆盖「猜」的那条绑定')
}

// ══════════════════════════════════════════════════════════
//  ⑤ 不许再要求"此刻没人说话"
// ══════════════════════════════════════════════════════════
//
// 主人报的第三个症状：「重启了，没汇报」。
// 诊断里反复写着「回合还在跑」—— 因为原来有一道 `if (turnBusy) return`。
// 但那是个**死锁**：他只有说话的时候我才在，一说话就有回合在跑。
// 只有他走开 30 秒以上，心跳才可能撞上空档 —— 跟"重启后告诉你一声"正好相反。
//
// 而且那道门槛本来就多余：投递走 `mode: 'queue'`，排队投递，
// 本来就会等当前回合结束，不打断任何人。
{
  const fs = await import('node:fs')
  const host = fs.readFileSync(join(ROOT, 'index.js'), 'utf8')
  const i = host.indexOf('async function maybeReportRestart')
  const fn = host.slice(i, i + 4000)
  // ⚠️ **先剥注释再查** —— 我在那段里写了「这里原来有一道 if (turnBusy)」来解释，
  //    不剥的话断言会匹配到自己的注释，反过来报错。
  //    （这个坑今晚栽过十几次了，凡是"查代码文本"一律先剥。）
  const body = fn.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/[^\n]*$/gm, '')

  t.ok(!/if \(turnBusy\)/.test(body), '重启汇报里没有 turnBusy 门槛（那是死锁）')
  t.ok(!/'回合还在跑'/.test(body), '也不会再写"回合还在跑"这条诊断')
  t.has(body, "mode: 'queue'", '投递走 queue —— 排队，不打断当前回合')
  t.has(body, 'slotAllowed(c, h)', '允许时段照样管')
  // ⚠️ 这条以前写的是"静默时段照样管" —— 后来改掉了（见下面第 ⑧ 节）。
  //    夜间静默只管主动开口；重启汇报是对主人刚做的动作的回执，不该被它挡。
  t.ok(!/if \(isQuiet\)/.test(body), '深夜静默**不**管重启汇报（下面 ⑧ 有详细理由）')
  // 但普通开口（主动找话）**应该**继续等空闲 —— 那条性质不同
  t.has(host, 'busy: turnBusy', '主动开口那条仍然把 busy 交给 canSpeak（它才该等空闲）')
}

// ══════════════════════════════════════════════════════════
//  ⑥ 启动时自己认出"最近在哪个对话" —— 不许等主人先开口
// ══════════════════════════════════════════════════════════
//
// 主人第四个症状：「还是没有重启汇报」。
// 实测：01:07 重启 → 01:15 他忍不住问"怎么还没汇报" → 中间 8 分钟
// 诊断一直写「还不知道该投给哪个对话」。
//
// 根因是我上一版的设计错误：让他"开口那一刻才绑对话"。
// 听起来合理（他既然在这儿敲字，就在看这条），但后果是
// **它永远不可能在他开口之前说任何话** —— 而"重启后告诉你一声"
// 本来就该在他回来的时候就已经在那儿。
//
// 改成启动时问 `sessionController.list()`，挑**最近更新的那个会话**。
{
  const fs = await import('node:fs')
  const host = fs.readFileSync(join(ROOT, 'index.js'), 'utf8')
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/[^\n]*$/gm, '')
  const body = strip(host)

  t.has(body, 'async function bindReportSession', '有"启动时绑定会话"的函数')
  t.has(body, 'sessionCtl.list()', '用的是 sessionController.list()')
  // list() 的形状不保证，三种都要认
  t.has(body, 'Array.isArray(r) ? r', '认裸数组')
  t.has(body, 'r.items', '认 { items }')
  t.has(body, 'r.sessions', '认 { sessions }')
  t.has(body, 'updatedAt || x.at', '按更新时间挑')
  t.has(body, 'sort((a, b) => stamp(b) - stamp(a))[0]', '挑**最近**的那个（不是第一个）')

  // 两处触发：mountCore 里一次、sessionController 注入时再一次
  const mountCall = (host.match(/typeof reportBindRef === 'function'\) \{\s*$/m) || []).length
  t.gt(body.split('reportBindRef?.()').length - 1, 0, '注入 sessionController 时也补一次绑定')
  t.has(body, 'void reportBindRef()', '心跳里也会（异步，绑上了下一拍就投）')
}

// ══════════════════════════════════════════════════════════
//  ⑦ 绑上了就不该再要 liveSession
// ══════════════════════════════════════════════════════════
//
// liveSession 是靠**收到会话事件**才有的 —— 重启之后、主人开口之前必然是 null。
// 原来硬性要求它，等于又绕回"等他先说话"（跟刚删掉的那个 turnBusy 死锁同一类）。
// 调试时就是卡在这一条：list() 调了、绑上了，诊断却仍写「还没见过任何会话事件」。
{
  const fs = await import('node:fs')
  const host = fs.readFileSync(join(ROOT, 'index.js'), 'utf8')
  const i = host.indexOf('async function maybeReportRestart')
  const fn = host.slice(i, i + 4000)
  const body = fn.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/[^\n]*$/gm, '')

  t.ok(!/if \(!liveSession\) \{ skip/.test(body), '不再硬性要求 liveSession')
  t.has(body, '!liveSession && !proactive.reportSid', '只有"既没见过会话、又没认出目标"才等')
}

// ══════════════════════════════════════════════════════════
//  ⑧ 深夜静默不管重启汇报（只管主动开口）
// ══════════════════════════════════════════════════════════
//
// 最后一层拦路虎。实测：01:07 重启，诊断一路写「1~7 点静默」。
// 但这两件事性质不同：
//   · 主动开口 = 我没事找话（该被静默管住）
//   · 重启汇报 = 对你刚做的动作的回执（你亲手重启了，我才说这一句）
// 而且它是往对话里**排队投一条消息** —— 不弹通知、不会吵醒谁。
{
  const fs = await import('node:fs')
  const host = fs.readFileSync(join(ROOT, 'index.js'), 'utf8')
  const i = host.indexOf('async function maybeReportRestart')
  const fn = host.slice(i, i + 4000)
  const body = fn.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/[^\n]*$/gm, '')

  t.ok(!/if \(isQuiet\)/.test(body), '重启汇报里没有深夜静默那道闸')
  t.has(body, 'slotAllowed(c, h)', '但允许时段照样管（那是主人明确勾过的）')
  t.ok(!/'点静默'/.test(body), '也不会再写"X~Y 点静默"这条诊断')
  // 主动开口那条**必须继续**受静默管 —— 别顺手一起删了
  t.has(host, 'quietFrom: a, quietTo: b', '主动开口里仍然算静默时段')
  const i2 = host.indexOf('canSpeak(proactive, now, { lastUserAt, busy: turnBusy })')
  t.gt(i2, 0, '主动开口仍然走 canSpeak（静默/空闲都在那儿管）')
}

t.done()

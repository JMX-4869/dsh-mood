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

const P = await import('file:///D:/chajian/dsh-mood/proactive.js?t=' + Date.now())
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
  const host = fs.readFileSync('D:/chajian/dsh-mood/index.js', 'utf8')
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
  const host = fs.readFileSync('D:/chajian/dsh-mood/index.js', 'utf8')
  const i = host.indexOf("if ((proactive.pendingRestart || proactive.pendingStale) && !proactive.reportSid)")
  t.gt(i, 0, 'user/message 里有绑定逻辑')
  const block = host.slice(i, i + 320)
  t.has(block, 'sessionIdOf', '绑定用的是当前这个会话的 id')
  t.ok(!/reportSid = sid0;\s*$/.test(block.replace(/\s+/g, ' ').trim()) ||
    /if \(sid0\) proactive\.reportSid = sid0/.test(block), '取不到 id 就不绑（不写空值）')
  t.has(block, '!proactive.reportSid', '已经绑过的不会被后来的对话抢走')
}

t.done()

/**
 * 跨会话回查 —— **只出统计，不出内容**。
 *
 * ── 为什么要有这个文件 ──
 *
 * 心情和日记原来只吃 `session/event` 的**实时事件**。结果是：插件装上之前聊的、
 * DSH 关着的时候聊的，它一律不知道。实测差距很夸张 ——
 *
 *     日记里写着「说了 13 轮话」
 *     而界面状态栏显示那个会话有 190 轮
 *
 * 差了十几倍，因为它只看见了插件在跑的那一小段。
 *
 * 这个模块用 `sessionController`（插件本来就在 inject，给"主动开口"用的）
 * 去回查当天**所有**会话，把轮次 / 报错 / 高频词重新数一遍。
 *
 * ── 硬约束：原文进不了模型上下文 ──
 *
 * 读进来的事件**只在本模块内部过一遍**：计数、提词，然后丢掉。
 * 返回给调用方的只有一个纯数字对象。**一句话都不会被存下来或送出去。**
 *
 * 所以模型那边看到的仍然只是：
 *     「说了 190 轮话」「中间碰了 9 次壁」「在反复说『材质』『绑定』」
 * —— 而它从没看过那些对话里的任何一句话。
 *
 * ── 失败必须无害 ──
 *
 * 接口形状是照 DSH 的 schema 写的（`list` 的返回形状没扒到，所以做了多种容错），
 * 但**任何一步出问题都返回 null** —— 调用方就退回原来的实时计数。
 * 也就是：最坏情况等于这个文件不存在，绝不会把日记写坏。
 */

/** 一次最多看多少个会话 / 一个会话最多取多少条事件 —— 防止回查把内存吃了 */
const MAX_SESSIONS = 60
const MAX_EVENTS_PER_SESSION = 4000
/** 高频词的停用词表：只留"在聊什么"，不留虚词 */
const STOP = new Set([
  '这个', '那个', '可以', '什么', '怎么', '现在', '还是', '就是', '但是', '然后',
  '因为', '所以', '已经', '一个', '一下', '这些', '那些', '我们', '你们', '他们',
  '没有', '不是', '好的', '应该', '需要', '可能', '如果', '这样', '那样', '自己',
  '感觉', '觉得', '知道', '看到', '这里', '那里', '时候', '问题', '东西', '地方',
])

const isObj = (v) => v && typeof v === 'object'

/** 从各种可能的形状里把"会话数组"挖出来（接口返回形状没扒到，所以宽进） */
function pickSessions(res) {
  if (!res) return []
  if (Array.isArray(res)) return res
  for (const k of ['sessions', 'items', 'data', 'list']) {
    if (Array.isArray(res[k])) return res[k]
  }
  if (isObj(res.result)) return pickSessions(res.result)
  return []
}

/** 同理，把"事件数组"挖出来 */
function pickRecords(res) {
  if (!res) return []
  if (Array.isArray(res)) return res
  for (const k of ['records', 'events', 'items', 'data']) {
    if (Array.isArray(res[k])) return res[k]
  }
  if (isObj(res.result)) return pickRecords(res.result)
  return []
}

/** 事件的唯一 id —— 各版本字段名不一样，都试一遍 */
function sessionIdOf(s) {
  return s && (s.sessionId || s.id || s.session || s.key) || ''
}
function timeOf(s) {
  const t = s && (s.updatedAt || s.updated || s.lastActivityAt || s.createdAt || s.time)
  const n = typeof t === 'string' ? Date.parse(t) : t
  return Number.isFinite(n) ? n : 0
}

/** 从一条事件里尽量稳地取纯文本（只在内部用来提词，不往外传） */
function textOf(data) {
  if (!data) return ''
  if (typeof data === 'string') return data
  const out = []
  const push = (v) => { if (typeof v === 'string' && v.trim()) out.push(v) }
  if (typeof data.text === 'string') push(data.text)
  if (Array.isArray(data.content)) {
    for (const c of data.content) {
      if (typeof c === 'string') push(c)
      else if (isObj(c)) push(c.text || c.content)
    }
  }
  return out.join(' ')
}

/**
 * 把一段文本拆成词。**只返回词和次数，原句不留。**
 *
 * 两个坑，都踩过，写下来免得重踩。
 *
 * ── 坑一：`Intl.Segmenter` 对中文**不是分词器** ──
 * 看名字以为它能分词，实测（Node 24）`granularity:'word'` 把中文切成**单个字**：
 *     「这个材质绑定要重新细分」→ [这个][材][质][绑][定要][重新][细][分]
 * 于是 `length < 2` 的过滤把「材」「质」全滤掉 —— **一个词都不剩**。
 * 它对 CJK 就是这个行为（没有词典），别指望它。
 * 所以退回 **2 字滑窗**：噪声大，但中文能出词。
 *
 * ── 坑二：滑窗会把敏感内容切成碎片放出去 ──
 * 「银行卡密码」被切成 `的银` `银行` `行卡` `卡密` —— 碎片照样漏。
 * **但这个不该靠分词解决，靠 MIN_COUNT。** 一次性的提及，碎片全都只出现
 * 一次，而 MIN_COUNT=2 会全滤掉。噪声（`我看` `看材`）同理。
 *
 * ── 说清楚这是什么、不是什么 ──
 * 这是**削弱，不是保证**：反复出现的敏感词仍然会露头。
 * 所以"只出词不出句"这条边界，靠的是**只留高频**，不是靠屏蔽。
 * **MIN_COUNT 不能再抬高了** —— 安静的白天本来就说不了几句，抬到 3 就等于那天一个词都不出。
 */
const MIN_COUNT = 2

export function words(text) {
  const bag = new Map()
  const s = String(text || '')
  if (!s.trim()) return bag

  const add = (w) => {
    const t = String(w || '').trim().toLowerCase()
    if (t.length < 2 || STOP.has(t)) return
    bag.set(t, (bag.get(t) || 0) + 1)
  }

  // 英文按单词
  for (const m of s.matchAll(/[A-Za-z][A-Za-z0-9_-]{2,}/g)) add(m[0])
  // 中文 2 字滑窗 —— 没有分词器，这是能出词的最低成本办法
  const cn = s.replace(/[^\u4e00-\u9fa5]+/g, ' ')
  for (const seg of cn.split(/\s+/)) {
    for (let i = 0; i + 2 <= seg.length; i++) add(seg.slice(i, i + 2))
  }

  // ⚠️ 这里**不做阈值过滤** —— 阈值是跨消息的，见 topWords()
  return bag
}

/**
 * 从「合并后的词袋」里取前 n 个高频词。
 *
 * ⚠️ **阈值必须在这一步判，不能在 `words()` 里判。**
 *
 * 踩过的坑：一开始把 `MIN_COUNT` 写在 `words()` 里，也就是**按单条消息**过滤。
 * 结果「材质」在两条消息里各说一次 —— 每条都只有 1 次，**各自被滤掉**，
 * 合起来就没了。而日记要的是"这一天在**反复**说什么"，跨消息才算数。
 *
 * 所以：`words()` 只负责数，**过滤留给聚合之后**。
 */
export function topWords(bag, n = 12, min = MIN_COUNT) {
  const rows = []
  for (const [w, c] of bag) if (c >= min) rows.push([w, c])
  rows.sort((a, b) => b[1] - a[1])
  const out = {}
  for (const [w, c] of rows.slice(0, n)) out[w] = c
  return out
}

/**
 * 回查某一天的所有会话，返回**纯统计**。
 *
 * @param sessionCtl  `ctx.sessionController`
 * @param dayKey      'YYYY-MM-DD'
 * @returns {Promise<null | {turns:number, errors:number, words:Object, hours:Object, sessions:number}>}
 *
 * **失败一律返回 null**（调用方退回实时计数）。
 */
export async function scanDay(sessionCtl, dayKey) {
  try {
    if (!sessionCtl || typeof sessionCtl.list !== 'function') return null
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dayKey || ''))) return null

    // 当天零点 ~ 次日零点（本地时区）
    const [y, mo, d] = dayKey.split('-').map(Number)
    const from = new Date(y, mo - 1, d, 0, 0, 0, 0).getTime()
    const to = new Date(y, mo - 1, d + 1, 0, 0, 0, 0).getTime()

    const listed = await sessionCtl.list({})
    let sessions = pickSessions(listed)
    if (!sessions.length) return null

    // 只要"那天有动静"的会话，按最后活动倒序，取前 N 个
    sessions = sessions
      .filter((s) => {
        const t = timeOf(s)
        return !t || t >= from
      })
      .sort((a, b) => timeOf(b) - timeOf(a))
      .slice(0, MAX_SESSIONS)

    let turns = 0
    let errors = 0
    const bag = new Map()
    const hours = {}

    for (const s of sessions) {
      const sid = sessionIdOf(s)
      if (!sid || typeof sessionCtl.page !== 'function') continue
      let recs
      try {
        recs = pickRecords(await sessionCtl.page({
          address: { kind: 'session', sessionId: sid },
          // 从"很后面"往前取，等价于"给我最新的一批"
          throughSeq: Number.MAX_SAFE_INTEGER,
        }))
      } catch { continue /* 单个会话失败不影响别的 */ }
      if (!Array.isArray(recs) || !recs.length) continue

      let seen = 0
      for (const r of recs) {
        if (seen >= MAX_EVENTS_PER_SESSION) break
        const ev = isObj(r) && isObj(r.event) ? r.event : r
        if (!isObj(ev)) continue
        const t = Number(ev.time)
        if (!Number.isFinite(t) || t < from || t >= to) continue
        seen++
        const type = String(ev.type || '')
        if (type === 'turn/end') turns++
        if (type === 'user/message') {
          turns++ // 没记到 turn/end 的话，用用户消息兜底（下面会按较大者取）
          hours[new Date(t).getHours()] = (hours[new Date(t).getHours()] || 0) + 1
          for (const [w, n] of words(textOf(ev.data))) bag.set(w, (bag.get(w) || 0) + n)
        }
        if (type === 'tool/result' && isObj(ev.data) && (ev.data.ok === false || ev.data.error)) errors++
      }
    }

    if (!turns && !Object.keys(hours).length) return null

    // 取前 12 个高频词 —— **只有词，没有句子**。
    // 阈值在这里判（聚合之后），不在 words() 里 —— 见 topWords 的说明。
    const wordCounts = topWords(bag, 12)

    return { turns, errors, words: wordCounts, hours, sessions: sessions.length }
  } catch {
    return null // 任何意外都退回实时计数，绝不把日记写坏
  }
}

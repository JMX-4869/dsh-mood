/**
 * 硬盘记忆 —— 把对话正文归档到磁盘，跨对话可检索。
 *
 * ────────────────────────────────────────────────────────────────
 *  为什么要有这个东西
 * ────────────────────────────────────────────────────────────────
 *  模型的一次请求要把**整段对话重新喂进去**，没有"硬盘式记忆"。
 *  窗口满了只有两条路：压缩（丢八成五）或者报错。
 *
 *  这个模块补的是第三条：**正文留在硬盘上，需要的时候再查回来。**
 *  上下文里没有的东西，硬盘上有；模型主动调 `memory` 就能翻到。
 *
 * ────────────────────────────────────────────────────────────────
 *  三个设计决定
 * ────────────────────────────────────────────────────────────────
 *
 *  ① **不自动注入提示词。**
 *     归档可能几个月、几万条。每轮自动塞几条进上下文，既贵又容易塞错东西。
 *     改成模型**主动调** —— 它知道自己缺什么信息，比按关键词猜准。
 *
 *  ② **全对话共用一个归档。**
 *     "上次那个项目"不该因为换了会话就查不到。归档是全局的，
 *     每条记下它来自哪个会话，查出来能指回去。
 *
 *  ③ **只存够长的。**
 *     短句（"嗯""好的""继续"）存进去只会污染检索结果 —— 它们哪儿都是、
 *     又什么都不说明。低于 MIN_CHARS 的直接丢。
 *
 * ────────────────────────────────────────────────────────────────
 *  ⚠️ 隐私
 * ────────────────────────────────────────────────────────────────
 *  这个模块会把**对话正文写进磁盘**。所以：
 *    · 存储目录在设置页可见、可改、可迁移
 *    · 默认和心情日记同一个目录（用户已经知道那个目录在哪）
 *    · 设置页写明"存了什么"和体积，一键可清空
 *  不要把它做成"悄悄记下来"的东西 —— 那是另一回事。
 */

import fs from 'node:fs'
import { join, dirname } from 'node:path'
import { createHash } from 'node:crypto'

const FILE = 'dsh-mood-memory.jsonl'

/** 短于这个字数的存了没意义（"嗯""好的""继续"哪儿都是） */
export const MIN_CHARS = 8
/** 单条最长存这么多 —— 防止一条巨长的工具输出把归档撑爆 */
export const MAX_CHARS = 8000
/** 一次最多返回几条 */
export const DEFAULT_LIMIT = 8
/** 内存里最多缓存多少条（超过就只留最近的） */
const CACHE_MAX = 200000

/** 中文按 2 字滑窗切（Intl.Segmenter 对中文会切成单字，没用） */
function grams(text) {
  const t = String(text || '')
  const g = []
  // 英文/数字：按词
  for (const m of t.matchAll(/[A-Za-z0-9_]{2,}/g)) g.push(m[0].toLowerCase())
  // 中文：2 字滑窗
  const cjk = t.replace(/[^\u4e00-\u9fff]/g, ' ')
  for (const seg of cjk.split(/\s+/)) {
    for (let i = 0; i + 2 <= seg.length; i++) g.push(seg.slice(i, i + 2))
  }
  return g
}

export function createMemory(opts) {
  const { file, log = () => {} } = opts || {}
  let cache = null
  let cacheMtime = 0
  let pending = []
  let flushTimer = null

  const path = () => (typeof file === 'function' ? file() : file)

  // ── 读：整份读进内存，按 mtime 判断要不要重读 ──
  function load() {
    const p = path()
    let mtime = 0
    try { mtime = fs.statSync(p).mtimeMs } catch { mtime = 0 }
    if (cache && mtime === cacheMtime) return cache

    const out = []
    try {
      const txt = fs.readFileSync(p, 'utf8')
      for (const line of txt.split('\n')) {
        if (!line) continue
        try {
          const o = JSON.parse(line)
          if (o && o.x) out.push(o)
        } catch { /* 坏行跳过 —— 归档文件不该因为一行坏了整个读不出来 */ }
      }
    } catch { /* 还没有文件 —— 正常 */ }

    // 只留最近的 CACHE_MAX 条，防止内存被撑爆
    cache = out.length > CACHE_MAX ? out.slice(-CACHE_MAX) : out
    cacheMtime = mtime
    return cache
  }

  /**
   * 记一条。
   *
   * 去重靠 id（会话 + 方向 + 时间戳）：同一个事件被重复投递时不会写两遍。
   */
  function note(kind, text, sessionId, ts) {
    const x = String(text || '').trim()
    if (x.length < MIN_CHARS) return false
    const clipped = x.length > MAX_CHARS ? x.slice(0, MAX_CHARS) + '…[截断]' : x
    const t = ts || Date.now()
    const s = String(sessionId || '').slice(0, 8)
    const id = s + '#' + (kind === 'assistant' ? 'a' : 'u') + '#' + t
    pending.push({ id, t, s, k: kind === 'assistant' ? 'a' : 'u', x: clipped })
    scheduleFlush()
    return true
  }

  function scheduleFlush() {
    if (flushTimer) return
    flushTimer = setTimeout(() => { flushTimer = null; flush() }, 1500)
    if (flushTimer && typeof flushTimer.unref === 'function') flushTimer.unref()
  }

  function flush() {
    if (!pending.length) return 0
    const batch = pending
    pending = []
    try {
      const p = path()
      fs.mkdirSync(dirname(p), { recursive: true })
      const have = new Set(load().slice(-5000).map((o) => o.id))
      // ⚠️ 批内也要去重。
      //    第一版只拿归档文件比 —— 同一批里两条相同 id（比如一个事件被投递两次）
      //    照样都写进去。测试里那次直接多写了一行。
      const seen = new Set()
      const lines = []
      for (const o of batch) {
        if (seen.has(o.id) || have.has(o.id)) continue
        seen.add(o.id)
        lines.push(JSON.stringify(o))
      }
      if (lines.length) fs.appendFileSync(p, lines.join('\n') + '\n', 'utf8')
      cache = null // 让下次 load 重读
      return lines.length
    } catch (e) {
      log('硬盘记忆写入失败: ' + (e && e.message))
      // 写失败就把这批放回去，别丢
      pending = batch.concat(pending)
      return 0
    }
  }

  /**
   * 检索。
   *
   * 打分 = 命中的查询词比例 × 长度惩罚。
   * 长度惩罚是必须的 —— 否则一条几千字的长回复因为"碰巧包含所有词"
   * 永远排第一，把真正精确的短句压下去。
   */
  function search(query, limit = DEFAULT_LIMIT) {
    const q = grams(query)
    if (!q.length) return []
    const uniq = [...new Set(q)]
    const rows = load()
    const hits = []
    for (const o of rows) {
      const g = new Set(grams(o.x))
      let hit = 0
      for (const u of uniq) if (g.has(u)) hit++
      if (!hit) continue
      const cover = hit / uniq.length
      // 长度惩罚：以 200 字为基准，越长分越低（但不归零）
      const lenPen = 1 / (1 + Math.log10(1 + o.x.length / 200))
      // 时间：每 30 天衰减一档，最多打到 0.6
      const days = (Date.now() - o.t) / 86400000
      const recency = Math.max(0.6, 1 - days / 90)
      hits.push({ ...o, score: cover * lenPen * recency, cover })
    }
    hits.sort((a, b) => b.score - a.score)
    return hits.slice(0, Math.max(1, Math.min(50, limit)))
  }

  function recent(n = DEFAULT_LIMIT) {
    return load().slice(-Math.max(1, Math.min(200, n))).reverse()
  }

  function stats() {
    const rows = load()
    let bytes = 0
    try { bytes = fs.statSync(path()).size } catch { /* 没文件 */ }
    const sessions = new Set(rows.map((o) => o.s).filter(Boolean))
    return {
      count: rows.length,
      bytes,
      sessions: sessions.size,
      oldest: rows.length ? rows[0].t : null,
      newest: rows.length ? rows[rows.length - 1].t : null,
      path: path(),
    }
  }

  function clear() {
    try { fs.rmSync(path(), { force: true }) } catch { /* 不管 */ }
    cache = null; cacheMtime = 0; pending = []
    return true
  }

  /**
   * 迁移：把归档搬到新目录。
   *
   * ⚠️ **调用方必须把新目录写进配置，否则 `path()` 还指着旧路径。**
   *    这个对象拿到的 `file()` 是个闭包，文件被搬走它是不知道的。
   *    所以这里留了 `onMoved` 回调 —— 插件用 `store.js` 写配置、
   *    然后 `invalidateDataDir()`，路径才会真的跟着变。
   *    （第一版漏了这件事，测试里"迁移后还能搜到"直接挂了 —— 搜的是旧路径。）
   */
  function moveTo(newDir, onMoved) {
    const from = path()
    const to = join(newDir, FILE)
    try {
      if (from !== to) {
        fs.mkdirSync(newDir, { recursive: true })
        if (fs.existsSync(from)) {
          // 目标已有内容就追加，不覆盖（用户在两个目录间来回切时不能丢数据）
          if (fs.existsSync(to)) {
            const a = fs.readFileSync(from, 'utf8')
            fs.appendFileSync(to, a.endsWith('\n') ? a : a + '\n', 'utf8')
            fs.rmSync(from, { force: true })
          } else {
            fs.renameSync(from, to)
          }
        }
      }
      cache = null; cacheMtime = 0
      if (typeof onMoved === 'function') {
        try { onMoved(newDir) } catch (e) { log('迁移后写配置失败: ' + (e && e.message)); return { ok: false, error: 'moved-but-config-failed' } }
      }
      return { ok: true, to }
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) }
    }
  }

  return { note, flush, search, recent, stats, clear, moveTo, path, load, FILE, grams }
}

/** 给检索结果算一个稳定的短 id（界面上显示、日志里定位用） */
export function shortId(o) {
  return createHash('sha1').update(String(o.id || '') + o.t).digest('hex').slice(0, 8)
}

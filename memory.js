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

/**
 * 归档体积上限，**默认 50 MB**。
 *
 * ────────────────────────────────────────────────────────────────
 *  为什么必须有这个
 * ────────────────────────────────────────────────────────────────
 *  第一版**没有上限** —— 它只会一直涨。实测：一场重度使用 1 小时
 *  就 98 条 / 51 KB（约 530 B/条），外推每天 1.2 MB、每月 35 MB、每年 0.4 GB。
 *  数字本身不算吓人，但"**永远不封顶**"这件事是错的：
 *  用户装完就不管了，三年后打开一个 1 GB 的文件谁受得了。
 *
 *  50 MB 对聊天记录是很多的 —— 按上面的速率大约 40 天重度使用。
 *  超了就从**最旧的**开始丢（新的更有用），丢到 90% 停手（别每次 flush 都重写）。
 */
export const DEFAULT_MAX_BYTES = 50 * 1024 * 1024

/**
 * **无上限**的写法：任何负数（`-1` 是最自然的）都算。
 *
 * ────────────────────────────────────────────────────────────────
 *  为什么单独立一个常量，而不是到处写 `-1`
 * ────────────────────────────────────────────────────────────────
 *  "无上限"这个状态要穿过**四层**：设置页的输入框 → HTTP 路由 → memoryCfg() → cap()。
 *  每一层都有自己的 `> 0` 判断，**每一层都会单独把 -1 吃掉**：
 *    · client.js 输入框的 min=1 / onBlur 的 `v > 0`
 *    · 路由 `/memory limits` 的 `mb > 0`
 *    · memoryCfg() 的 `mb > 0 ? … : 默认`
 *    · cap() 的 `n > 0 ? n : DEFAULT_MAX_BYTES`
 *  任何一层漏了，用户看到的就是**"显示成功、实际还在丢"** —— 这比报错难查得多。
 *  所以这个常量集中写一处，四层都引用它，改的时候一眼能看见该改哪几层。
 *
 * ⚠️ **内部**用 `Infinity`（`bytes <= Infinity` 天然成立，所有比较都不用改），
 *    **对外**（stats / HTTP）一律折算成 `-1` —— 因为 `JSON.stringify(Infinity)`
 *    得到的是 `null`，开关会在传输途中丢掉。
 */
export const UNLIMITED = -1
/** 传进来的这个值是不是"无上限"？四层都该用这个判断，别各写各的 */
export const isUnlimited = (v) => Number.isFinite(Number(v)) && Number(v) < 0

/** 超限后丢到剩这么多比例 —— 留余量，避免每写一条就重写一次大文件 */
const TRIM_TO = 0.9

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
  // maxBytes / onlyUser 都可以传函数 —— 用户在设置页改了要**立刻生效**，
  // 传死值的话得重载插件才行（这个坑在别处栽过：改的是副本）。
  //
  // ⚠️ 这里曾经把解构名写成 `userOnly`，而调用方传的是 `onlyUser` ——
  //    **选项名对不上，静默失效**：开关点了没反应，还不报错。
  //    测试里断言 "打开后助手的不进" 才抓出来。
  const { file, log = () => {}, maxBytes, onlyUser } = opts || {}
  let cache = null
  let cacheMtime = 0
  let pending = []
  let flushTimer = null
  let trimmed = 0          // 累计丢了多少条（统计里给用户看）

  const path = () => (typeof file === 'function' ? file() : file)
  const cap = () => {
    const v = typeof maxBytes === 'function' ? maxBytes() : maxBytes
    const n = Number(v)
    // ⚠️ **负数是"无上限"的开关**（-1 是最自然的写法，见 UNLIMITED）。
    //
    //    这里原来是 `n > 0 ? n : DEFAULT_MAX_BYTES` —— 于是 -1 落进"不合法"那一支，
    //    **悄悄退回默认的 50 MB**。用户以为关掉了上限，其实还在丢最旧的，
    //    而且接口回 ok、设置页也显示成功。**最坏的那种失败：接受了，没生效，不报错。**
    if (isUnlimited(n)) return Infinity
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_BYTES
  }
  const onlyUserOn = () => {
    const v = typeof onlyUser === 'function' ? onlyUser() : onlyUser
    return v === true
  }

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
   * 去重靠 id：会话 + 方向 + 时间 + **正文指纹**。
   *
   * ⚠️ 最后那个指纹不能省。第一版 id 只到时间戳，结果**同一毫秒发出的两条
   *    不同消息**被判成重复，后一条直接被丢掉 —— 端到端测试里三条助手回复
   *    只存下两条。而重复投递同一条（这才该去重）的正文指纹是一样的，
   *    照样能挡住。
   */
  function note(kind, text, sessionId, ts) {
    const x = String(text || '').trim()
    if (x.length < MIN_CHARS) return false
    // ⚠️ **压缩摘要不是对话，别归档。**
    //
    //    实测：7932 条归档里有 2 条是 8005 字的
    //    「This is an automatically generated checkpoint condensing an …」，
    //    而且被标成了 `u`（用户）—— 它不是谁说的话，是插件自己写的复述。
    //
    //    为什么挡：
    //      · 同一条内容存了两遍；
    //      · 它全是**别处内容的摘要** —— 搜的时候会优先命中它、把原文盖掉，
    //        等于用二手顶掉一手；
    //      · 原文本来就都在归档里，摘要不提供新信息。
    //
    //    （dsh-world 是反过来的同一条原则：压缩时把会重新注入的东西
    //      ——时间块、记忆块、世界提示词——排除在摘要之外。两边都在防
    //      "同一份内容存两次、二手盖一手"。）
    if (/^(This is an automatically generated checkpoint|以下是此前交流的摘要|以下是先前对话的摘要)/.test(x)) return false
    // 「只存用户说的话」—— 实测我的回复占了 94% 的体积。
    // 打开它归档会瘦掉九成，代价是查不到"我上次怎么说的"。
    // **默认关**：主动丢一半对话是个大决定，不该由插件替用户做。
    if (kind !== 'user' && onlyUserOn()) return false
    const clipped = x.length > MAX_CHARS ? x.slice(0, MAX_CHARS) + '…[截断]' : x
    const t = ts || Date.now()
    // ⚠️ 会话名取的是**完整 id 的哈希**，不是前缀。
    //    第一版取前 8 位、第二版取前 12 位，都还是"取前缀" ——
    //    前缀多长都可能撞（测试里 `e2e-session-1` / `-2` 前 13 位完全一样）。
    //    哈希之后长度固定、碰撞概率与 id 结构无关。
    const s = createHash('sha1').update(String(sessionId || '')).digest('hex').slice(0, 8)
    const fp = createHash('sha1').update(clipped).digest('hex').slice(0, 10)
    const id = s + '#' + (kind === 'assistant' ? 'a' : 'u') + '#' + t + '#' + fp
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
      trim()
      return lines.length
    } catch (e) {
      log('硬盘记忆写入失败: ' + (e && e.message))
      // 写失败就把这批放回去，别丢
      pending = batch.concat(pending)
      return 0
    }
  }

  /**
   * 超上限就从**最旧的**开始丢。
   *
   * ⚠️ 只在真超了才动手，而且一次丢到 90% —— 不然每写一条就要重写一次大文件。
   *    50 MB 的速率大约是几十天，也就是说这个函数几十天才跑一次。
   *
   * 丢最旧的而不是最新的：**刚聊过的比三个月前的有用**。
   */
  function trim() {
    const p = path()
    let size = 0
    try { size = fs.statSync(p).size } catch { return 0 }
    const limit = cap()
    if (size <= limit) return 0
    const target = Math.floor(limit * TRIM_TO)
    const rows = load()
    // 从头部开始丢，累积到剩下的部分低于目标大小
    let drop = 0
    let rest = size
    while (drop < rows.length && rest > target) {
      rest -= Buffer.byteLength(JSON.stringify(rows[drop])) + 1
      drop++
    }
    if (drop <= 0) return 0
    const keep = rows.slice(drop)
    try {
      const tmp = p + '.trim'
      fs.writeFileSync(tmp, keep.map((o) => JSON.stringify(o)).join('\n') + (keep.length ? '\n' : ''), 'utf8')
      fs.renameSync(tmp, p)
      cache = null
      trimmed += drop
      log('硬盘记忆超出上限（' + (size / 1048576).toFixed(1) + ' MB > ' + (limit / 1048576).toFixed(0)
        + ' MB），丢掉最旧的 ' + drop + ' 条，剩 ' + keep.length + ' 条')
      return drop
    } catch (e) {
      log('硬盘记忆清理失败（数据没动）: ' + (e && e.message))
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
    const limit = cap()
    const oldest = rows.length ? rows[0].t : null
    const newest = rows.length ? rows[rows.length - 1].t : null
    // 实测速率：按"条数与时间跨度"估，比拍脑袋准
    let perDay = 0
    // 8 条就够估个大概了 —— 门槛设太高的话，刚清理完就估不出来（"每天 0 B"）
    if (rows.length >= 8 && oldest && newest && newest > oldest) {
      const days = (newest - oldest) / 86400000
      if (days > 0) perDay = bytes / days
    }
    // 按当前速率还能撑多久（满了就开始丢最旧的）
    const leftMs = perDay > 0 && bytes < limit ? ((limit - bytes) / perDay) * 86400000 : 0
    // ⚠️ **无上限的时候，对外报 -1，不能报 Infinity。**
    //    `JSON.stringify({ x: Infinity })` 得到的是 `{"x":null}` ——
    //    Infinity 过不了 HTTP 那道 JSON 序列化，到了设置页会变成 null，
    //    然后前端拿 `null || 0` 一算又是 0，最后显示成 50 MB。
    //    **开关打开了，界面显示的还是老样子。** 所以统一用 -1 当"无上限"的对外标记。
    const unlimited = !Number.isFinite(limit)
    return {
      count: rows.length,
      bytes,
      sessions: sessions.size,
      oldest,
      newest,
      path: path(),
      // 上限与清理
      maxBytes: unlimited ? UNLIMITED : limit,   // -1 = 无上限
      usedRatio: unlimited || !(limit > 0) ? 0 : bytes / limit,
      unlimited,
      trimmed,                                  // 累计丢了多少条
      perDayBytes: perDay,                      // 估算的每日增长
      daysLeft: unlimited ? 0 : (leftMs > 0 ? leftMs / 86400000 : 0),
      onlyUser: onlyUserOn(),
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


/**
 * sidx.js —— 全量会话索引 + 启发式摘要（跨会话共享）
 *
 * ══════════════════════════════════════════════════════════════════════
 * 目标：**新对话一进去就知道这个工作区以前那些对话都在聊什么。**
 *
 * ═══ 为什么不能"把全部内容塞进上下文"（实测的账）═══════════════════
 *   一个会话：4957 条消息 · 纯文本 **7.84 MB**
 *     光"用户消息"就 0.65 MB ≈ 20 万 token —— 每轮发一次就破产。
 *   → 所以形态只能是：**全量存盘 + 每轮带摘要 + 要细节按需拉**。
 *
 * ═══ DSH 的会话文件（实测，不是猜的）═════════════════════════════
 *   「~/.dsh/sessions/--<工作区>--/session-<uuid>/session.v4.jsonl.zstd」
 *   行形状 「{ type, seq, time, data }」，要的两种：
 *     user/message · assistant/message
 *   丢掉的：tool/call · tool/result · step/* · session-log-* · agent/inbox
 *     （**工具输出是文件里最大的部分，也是"每轮重发"最贵的部分**）
 *
 *   ⚠️ **那个 .zstd 是几万个独立帧**，不是一个流。实测一个 55 MB 的文件里
 *      魔数 「28 B5 2F FD」 出现 **28057 次**。
 *      「zstdDecompressSync(整个文件)」 只解出第一帧；
 *      「createZstdDecompress()」 流式解压也在第一帧的"最后一帧"标记处停住。
 *      **两个都不行 —— 必须自己按魔数找边界、逐帧解。**（实测失败 0，找不到假边界）
 *      全量扫一个 53 MB 会话：**2.1 秒**。
 *
 * ═══ 摘要用什么做（不用模型 → 不花钱）═════════════════════════════
 *   材料：用户说的那些消息（一个会话 778 条）—— **不是**我那些（6888 条，多数是
 *   "读了个文件说一句"，信噪比差）。
 *   做法：时间跨度 + 轮数 + 高频词（去掉停用词）+ 开头几条和结尾几条的前 120 字。
 *   → 能答"这个会话在干什么"，答不了"细节是什么" —— 而细节按需拉。
 */
import { readdirSync, statSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

const MAGIC = 0xFD2FB528

/**
 * **把话写进文件** —— 而不是靠宿主的 logger。
 *
 * ⚠️ 为什么要这个：`log()` 走的是 `root?.logger?.info`，而**它写到哪我找不到**
 *    （翻遍了 ~/.dsh 和 AppData 的日志目录，都没有 dsh-mood 的字样）。
 *    于是"这一节为什么是空的"就成了一个我**看不见**的问题 ——
 *    而那正是我最该避免的那类 bug：**程序知道但不告诉我**。
 *    → 写文件。路径固定，我一定能读到。
 */
export function dbg(msg) {
  try {
    const home = process.env.DSH_HOME || join(process.env.USERPROFILE || '', '.dsh')
    const f = join(home, 'dsh-mood-sidx.log')
    // ⚠️ 这个换行必须是**转义写法**。我用 py 脚本生成这段时写成了裸换行，
    //    于是 JS 字符串被劈成两行 → SyntaxError。
    //    **今晚第七次栽在"用 py 往 JS 里写代码"的转义上** —— 那条路不该再走。
    const line = new Date().toISOString().slice(11, 19) + '  ' + msg + '\n'
    if (existsSync(f) && statSync(f).size > 200000) writeFileSync(f, line)
    else writeFileSync(f, line, { flag: 'a' })
  } catch { /* 连日志都写不了就认了 —— 不能因为它把插件拖垮 */ }
}

/** 停用词：只留"在聊什么"，不留虚词（跟 sessions.js 那份同一套路） */
const STOP = new Set([
  '这个', '那个', '可以', '什么', '怎么', '现在', '还是', '就是', '但是', '然后',
  '因为', '所以', '已经', '一个', '一下', '这些', '那些', '我们', '你们', '他们',
  '没有', '不是', '好的', '应该', '需要', '可能', '如果', '这样', '那样', '自己',
  '感觉', '觉得', '知道', '看到', '这里', '那里', '时候', '问题', '东西', '地方',
  '文件', '目录', '看看', '帮我', '一下', '现在', '还有', '不了', '对的',
])

// ⚠️ **英文也要停用词。** 实测漏了它之后，"在聊"那一行全是
//    「the and objective for before this」 —— 一个信息量都没有。
//    （中文那边有 STOP 表，所以第一条真词就是"心情"，是对的。）
const STOP_EN = new Set(['the','and','for','this','that','not','with','you','are','was',
  'were','have','has','had','but','all','can','will','would','should','could','from',
  'into','out','about','when','what','which','who','how','why','there','here','then',
  'than','them','they','their','its','is','be','been','being','do','does','did','done',
  'get','got','let','may','might','must','need','use','used','using','one','two','any',
  'each','more','most','some','such','only','also','just','now','new','old','objective',
  'current','before','after','first','last','next','same','other','another','thing',
  'things','make','made','take','took','see','saw','know','knew','like','want','well',
  'still','even','much','many','change','changed'])

/**
 * **当前会话目录**（不依赖 process.cwd）。
 *
 * ⚠️ 原来这里用 「process.cwd()」 推工作区 —— 而**宿主的工作目录是什么我拿不准**
 *    （在 bash 里测出来的是"我启动 node 的目录"，而宿主是 Electron 起的，
 *      cwd 可能是安装目录、可能是工作区、也可能别处）。
 *    拿不准的东西不该当依据。
 *
 * 换成：**扫 sessions 下面每个工作区，找最近被写过的那个会话文件 —— 它所在的工作区就是当前工作区。**
 * 依据很硬：**正在写的就是我自己**，所以 mtime 最新那个必然是我这个会话。
 * 而这条路不依赖任何环境变量、任何 cwd。
 *
 * @returns 那个工作区的 sessions 目录路径（喂给 scanAll / currentSession）
 */
export function activeSessionsDir() {
  const home = process.env.DSH_HOME || join(process.env.USERPROFILE || '', '.dsh')
  const base = join(home, 'sessions')
  if (!existsSync(base)) return ''

  // ⚠️ **别"先筛新鲜、再挑最大的"** —— 那个顺序错了两次，而两次的错法是同一个。
  //
  //    ① 第一版只挑 mtime 最新，假设"正在写的就是我自己"。**那个假设漏了一半**：
  //       实测（宿主重启那一刻）**别的工作区的会话也会被写** ——
  //       悬浮球 dsh-orb 在 4 秒内就落了一次盘，它的文件 mtime 变成"刚刚"，
  //       于是抢在真正在写的我这里被选中 →
  //       **索引整个扫成了别人工作区的对话**：界面里显示两个 10-14 的会话，
  //       而当前工作区里明明有 8 个、最新的就在几分钟前。
  //
  //    ② 于是改成"限制在**最近 5 分钟内写过**的里面按大小挑最大的"。**而那道 5 分钟的筛子
  //       又踩了同一个坑** —— 它假设了「重启紧跟在我的最后写入之后」。实测不是：
  //       我是做完之后**隔了一段时间**才被重启的，我的会话 mtime 早就超过 5 分钟 → **被筛掉**；
  //       而 orb **每次启动都写一次** → 它落在 fresh 里 → **池子里只剩它** → 又选错。
  //
  //    → 所以**不筛**：按 mtime 取最近的 N 个当池子，在池子里挑最大的。
  //      正在被写的那个会话，它的特征不是"5 分钟内写过"，而是
  //      **最近写过的那几个里最大的** —— 因为它一路在写，所以又大又新；
  //      而别的（orb、别的工作区）只是**小**。
  //      退路：池子空了就退回全部 —— 宁可不准，也不要返回空字符串。
  const cands = []
  for (const key of readdirSync(base)) {
    const dir = join(base, key)
    let ids
    try { ids = readdirSync(dir) } catch { continue }
    for (const id of ids) {
      const f = join(dir, id, 'session.v4.jsonl.zstd')
      if (!existsSync(f)) continue
      try {
        const st = statSync(f)
        cands.push({ key, mtime: st.mtimeMs, size: st.size })
      } catch { /* 读不动就跳过 */ }
    }
  }
  if (!cands.length) return ''
  const RECENT_N = 8
  const pool = cands.slice().sort((a, b) => b.mtime - a.mtime).slice(0, RECENT_N)
  pool.sort((a, b) => b.size - a.size || b.mtime - a.mtime)
  return join(base, pool[0].key)
}

/**
 * 猜"当前是哪个会话" —— **用最近写过的那个**。
 * ⚠️ 拿不到宿主给的 session id（那个 API 我没扒到），所以用 mtime 最近的近似。
 *    正在写的就是我自己，所以这个近似是准的。
 * 参数是**会话目录**（由 activeSessionsDir 给），不是 cwd。
 */
export function currentSession(sessionsDir) {
  const dir = sessionsDir || activeSessionsDir()
  if (!dir || !existsSync(dir)) return ''
  let best = '', t = 0
  for (const name of readdirSync(dir)) {
    const f = join(dir, name, 'session.v4.jsonl.zstd')
    if (!existsSync(f)) continue
    try {
      const m = statSync(f).mtimeMs
      if (m > t) { t = m; best = name }
    } catch { /* 读不动就跳过 */ }
  }
  return best
}

/** 工作区路径 → sessions 目录名 */
export function workdirKey(cwd) {
  return '--' + String(cwd).replace(/:/g, '').replace(/[\\/]/g, '-') + '--'
}

/** 从 data 里挖纯文本（结构随版本可能变，几种形状都试） */
function extractText(o) {
  const d = o && o.data
  if (!d) return ''
  if (typeof d === 'string') return d
  const pick = (v) => {
    if (typeof v === 'string') return v
    if (Array.isArray(v)) {
      return v.map((x) => (typeof x === 'string' ? x : ((x && (x.text || x.content)) || '')))
        .filter(Boolean).join(' ')
    }
    return ''
  }
  for (const k of ['text', 'content', 'message']) {
    const s = pick(d[k])
    if (s) return s
    if (d[k] && typeof d[k] === 'object') {
      const s2 = pick(d[k].content) || pick(d[k].text)
      if (s2) return s2
    }
  }
  return ''
}

/**
 * 扫一个会话文件，抽出 user/assistant 消息。
 * **逐帧解压** —— 见文件头那段（流式和一次性都不行）。
 */
export function extractSession(file, opt = {}) {
  const maxMsgs = opt.maxMsgs || 40000
  // ⚠️ opt.shouldStop：让"退出 / 更新安装"能中途叫停这次扫描（见 scanAll 那段）。
  const stop = typeof opt.shouldStop === 'function' ? opt.shouldStop : null
  const buf = readFileSync(file)
  // ⚠️ 找 zstd 帧头**别用 JS 逐字节比**。
  //    那个 58 MB 的会话文件就是 **5800 万次 readUInt32LE**，实测是秒级；
  //    而这段跑在「启动后 4 秒」——正好可能撞上退出/更新：
  //    事件循环被占住，dispose 和信号处理都排不进去，宿主就报
  //    「Host did not complete graceful task teardown … graceful deadline exceeded」，
  //    更新于是**自己放弃安装**。Buffer.indexOf 是原生的，快一到两个数量级。
  const needle = Buffer.alloc(4)
  needle.writeUInt32LE(MAGIC, 0)
  const offs = []
  let at = buf.indexOf(needle)
  while (at !== -1) { offs.push(at); at = buf.indexOf(needle, at + 1) }
  const msgs = []
  let header = null
  for (const off of offs) {
    // 每个会话文件里帧数能到几万 —— 每帧都是一个可能的长阻塞点，逐帧给出口。
    if (stop && stop()) return { header, msgs, aborted: true }
    let out
    try { out = zstdDecompressSync(buf.subarray(off)) } catch { continue }
    for (const L of out.toString('utf8').split('\n')) {
      const q = L.trim()
      if (!q) continue
      let o
      try { o = JSON.parse(q) } catch { continue }
      if (o.type === 'session' && !header) { header = o; continue }
      if (o.type !== 'user/message' && o.type !== 'assistant/message') continue
      const t = extractText(o)
      if (!t) continue
      msgs.push({ r: o.type === 'user/message' ? 'u' : 'a', t, time: o.time || 0 })
      if (msgs.length >= maxMsgs) break
    }
    if (msgs.length >= maxMsgs) break
  }
  return { header, msgs, aborted: false }
}

/** 高频词（2~6 字的中文/英文词，去掉停用词） */
function topWords(msgs, n = 8) {
  const cnt = new Map()
  for (const m of msgs) {
    for (const w of String(m.t).match(/[\u4e00-\u9fa5]{2,6}|[A-Za-z][A-Za-z0-9_.-]{2,}/g) || []) {
      const k = w.toLowerCase()
      if (STOP.has(k) || STOP_EN.has(k)) continue
      cnt.set(k, (cnt.get(k) || 0) + 1)
    }
  }
  return [...cnt.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([w]) => w)
}

const clip = (s, n) => {
  const t = String(s).replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n) + '…' : t
}

/** 启发式摘要 —— **不用模型** */
function summarize(msgs) {
  const users = msgs.filter((m) => m.r === 'u')
  const turns = users.length
  const t0 = msgs.length ? Math.min(...msgs.map((m) => m.time || Infinity)) : 0
  const t1 = msgs.length ? Math.max(...msgs.map((m) => m.time || 0)) : 0
  const words = topWords(users)
  // ⚠️ **要滤掉系统注入和极短消息** —— 实测不滤的话"开头"抽到的是
  //    「The approval policy changed from ask to never」
  //    而"最近"抽到的是 system-reminder 那种 skill 清单。
  //    那些是系统消息，不是用户说的话 —— 对"在聊什么"是纯噪音。
  const real = users.filter((m) => {
    const t = String(m.t).trim()
    if (t.length < 6) return false                                  // "2" / "做吧" 这种太短
    if (t.startsWith('<')) return false                             // 系统注入都以 < 开头
    // ⚠️ 这条规则**扩过一次** —— 第一版只认 「<」 开头和 system-reminder，
    //    结果这两类漏过去了（实测）：
    //      「Current runtime context. This snapshot supersedes earlier...」
    //      「background job pwsh-61 (pwsh: $d='D:\DSHzuoye\dsh-mood-dev'...)」
    //    它们是宿主注入的，混在 user/message 里。
    if (/system-reminder|approval policy|skill is a reusable/i.test(t)) return false
    if (/^Current runtime context|^This snapshot supersedes|^background job /i.test(t)) return false
    return true
  })
  // ⚠️ **全被滤光时不给 head/tail，而不是退回原样。**
  //    我第一版写的是"退回原样" —— 结果那两个只有 5 条消息、全是系统注入的会话，
  //    把 「<system-reminder> A skill is a reusable set of...」 当成"最近"打了出来。
  //    **显示系统消息比显示空更糟**：那会让人以为那就是对话内容。
  const src = real.length >= 1 ? real : []
  const head = src.slice(0, 3).map((m) => clip(m.t, 120))
  const tail = src.slice(-3).map((m) => clip(m.t, 120))
  const span = (t0 && t1 && t1 > t0) ? Math.round((t1 - t0) / 60000) : 0
  return { turns, words, head, tail, span, t0, t1, nMsgs: msgs.length }
}

/**
 * 扫这个工作区的所有会话，返回 { sessionId: {file, mtime, size, header, msgs, sum} }。
 * ⚠️ **会读全部** —— 所以调用方该缓存结果（见 loadIndex/saveIndex）。
 */
export function scanAll(sessionsDir, opt = {}) {
  const dir = sessionsDir || activeSessionsDir()
  const out = {}
  if (!dir) return out
  if (!existsSync(dir)) return out
  const prev = opt.prev || {}
  for (const name of readdirSync(dir)) {
    if (typeof opt.shouldStop === 'function' && opt.shouldStop()) break
    const f = join(dir, name, 'session.v4.jsonl.zstd')
    if (!existsSync(f)) continue
    let st
    try { st = statSync(f) } catch { continue }
    if (opt.minBytes && st.size < opt.minBytes) continue
    // ⚠️ **没变就跳过 —— 这条才是真省。**
    //    实测全量扫 9 个会话 = **5144 ms**，而那 5 秒几乎全花在
    //    "逐帧解压 29858 个 zstd 帧"上（找帧头只占 254 ms）。
    //    每次都重解一遍，等于每次启动都让事件循环停摆 5 秒 ——
    //    正好能把更新的 graceful teardown 拖过期限。
    //    mtime 和 size 都没变 ⇒ 摘要不可能变 ⇒ 直接沿用。
    const old = prev[name]
    if (old && old.mtime === st.mtimeMs && old.size === st.size && old.sum) {
      out[name] = { file: f, mtime: st.mtimeMs, size: st.size, header: old.header, sum: old.sum, skipped: true }
      continue
    }
    try {
      const { header, msgs, aborted } = extractSession(f, opt)
      // ⚠️ 被叫停的这一次**不当成结果** —— 半个会话写进索引，下次就会显示成
      //    "这个对话最近没说话"，而那是一次退出动作造成的假象。
      if (aborted) break
      if (!msgs.length) continue
      out[name] = { file: f, mtime: st.mtimeMs, size: st.size, header, sum: summarize(msgs), msgs }
    } catch { /* 读不动就跳过这个会话 —— 不让一个坏文件毁掉整次扫描 */ }
  }
  return out
}

// ── 索引的存/取（增量：只重扫 mtime 变了的）──────────────────────────
// ⚠️ **这两个接的是"文件路径"，不是目录** —— 调用方传
//    dsh-mood 自己的 「dataFile('dsh-mood-sessions.json')」。
//    我第一版让它们自己拼 「~/.dsh/...」，而调用方传的是那个根目录 ——
//    结果在宿主里 「HOME」 那个变量根本不存在，抛 ReferenceError 被 catch 吞掉，
//    **表现就是"那一节永远是空的"**。
export function loadIndex(p) {
  if (!existsSync(p)) return { built: 0, sessions: {} }
  try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return { built: 0, sessions: {} } }
}

export function saveIndex(p, idx) {
  mkdirSync(dirname(p), { recursive: true })
  // ⚠️ 只存摘要，**不存 msgs 原文**（那才是"全量"的部分，而它该留在会话文件里）
  const slim = { built: Date.now(), sessions: {} }
  for (const [k, v] of Object.entries(idx.sessions || {})) {
    slim.sessions[k] = { mtime: v.mtime, size: v.size, header: v.header, sum: v.sum }
  }
  writeFileSync(p, JSON.stringify(slim), 'utf8')
  return p
}

/**
 * 生成注入用的那段。
 * ⚠️ **这段每一步都跟着走**，所以要有上限：
 *    最近的 full 个会话给摘要，更早的只给一行。
 */
export function renderIndex(idx, opt = {}) {
  const full = opt.full || 8
  const oneLine = opt.oneLine || 20
  const rows = Object.entries(idx.sessions || {})
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => (b.sum?.t1 || b.mtime) - (a.sum?.t1 || a.mtime))
  if (!rows.length) return ''
  const out = []
  const d = (t) => (t ? new Date(t).toISOString().slice(5, 16).replace('T', ' ') : '?')
  for (let i = 0; i < rows.length && i < oneLine; i++) {
    const r = rows[i]
    const s = r.sum || {}
    const cur = r.id === opt.selfId ? ' ←（就是当前这个）' : ''
    if (i < full) {
      out.push(`  · **${d(s.t1)}** ${s.turns || '?'} 轮 · ${Math.round((r.size || 0) / 1048576) || '<1'} MB${cur}`)
      if (s.words && s.words.length) out.push(`    在聊：${s.words.join(' ')}`)
      if (s.head && s.head.length) out.push(`    开头：${s.head[0]}`)
      if (s.tail && s.tail.length) out.push(`    最近：${s.tail[s.tail.length - 1]}`)
    } else {
      out.push(`  · ${d(s.t1)} ${s.turns || '?'} 轮 · 在聊 ${(s.words || []).slice(0, 5).join(' ')}`)
    }
  }
  return [
    '## 这个工作区以前的对话（自动索引）',
    '',
    '⚠️ **对话历史是按会话隔离的** —— 你看不到别的对话。下面是插件扫出来的索引，',
    '从**全部**会话的 `session.v4.jsonl.zstd` 里抽的（**工具输出全部丢弃**）。',
    `索引里共 **${rows.length} 个会话**，下面按时间排；前 ${full} 个带摘要，更早的只给一行。`,
    '',
    ...out,
    '',
    '⚠️ **想细看某个会话就在文件里翻**（`~/.dsh/sessions/--<工作区>--/`），',
    '   或者按关键词问 —— 那比让我猜准。',
    '⚠️ 这只是摘要，**别把"没提到"当成"没发生"**。',
  ].join('\n')
}

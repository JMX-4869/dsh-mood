import { dataFile } from './store.js'
/**
 * dsh-mood / diary.js —— 日记模块
 *
 * 目标：**每天一篇日记，固定 23:59 生成**。
 *
 * 设计取舍：
 *   宿主插件在 23:59 那一刻不一定有活跃会话，也拿不到模型来"写作文"。
 *   所以这里采取「**素材 → 成文**」两步：
 *     ① 全天都在默默攒素材（心情停留时长、切换记录、消息数、工具报错、起止时间）
 *     ② 23:59 用当天素材合成一篇第一人称日记（按主导心情换措辞）
 *   模型随时可以用 diary 工具**改写/追加**这一篇，改成更像自己写的。
 *
 * 存储：$DSH_HOME/dsh-mood-diary.json
 *   { version, entries:[{date, text, mood, createdAt, edited}], daily:{ 'YYYY-MM-DD': {...} } }
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs'
import { join, dirname } from 'node:path'
import os from 'node:os'

export function dshHome() {
  return process.env.DSH_HOME || join(os.homedir(), '.dsh')
}

// 路径统一走 store.js —— 数据目录可以被搬到别的盘（见 store.js 顶部说明）
export function diaryFile() { return dataFile('dsh-mood-diary.json') }

/** 日记生成时刻（本地时间）：23:59 */
export const DIARY_HOUR = 23
export const DIARY_MINUTE = 59

// ---------------------------------------------------------------- 日期

export function dateKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function yesterdayKey(now = new Date()) {
  const d = new Date(now.getTime() - 24 * 3600 * 1000)
  return dateKey(d)
}

/** 现在是否已过今天的生成时刻（23:59） */
export function diaryDue(now = new Date(), h = DIARY_HOUR, m = DIARY_MINUTE) {
  return now.getHours() * 60 + now.getMinutes() >= h * 60 + m
}

// ---------------------------------------------------------------- 存取

export function blankDiary() {
  return {
    version: 1,
    entries: [],
    daily: {},
    /**
     * 日记的可见性 —— **默认不给看**。
     * 日记是"我"的东西，主人要看必须先问、我同意才行。
     * 设置页据此决定显示日记列表还是"锁着"的提示，图标也从合上的书本变成张开的。
     */
    access: { allowed: false, at: 0, note: '' },
  }
}

export function loadDiary() {
  try {
    const raw = JSON.parse(readFileSync(diaryFile(), 'utf8'))
    const d = Object.assign(blankDiary(), raw)
    if (!Array.isArray(d.entries)) d.entries = []
    if (!d.daily || typeof d.daily !== 'object') d.daily = {}
    if (!d.access || typeof d.access !== 'object') d.access = { allowed: false, at: 0, note: '' }
    // 只认布尔 true，别的一律当"没开"
    d.access.allowed = d.access.allowed === true
    return d
  } catch {
    return blankDiary()
  }
}

/**
 * 开关日记可见性。
 *   allowed=true  → 可以看（图标张开）
 *   allowed=false → 不给看（图标合上）
 */
export function setAccess(d, allowed, note = '') {
  d.access = {
    allowed: allowed === true,
    at: Date.now(),
    note: String(note || '').slice(0, 200),
  }
  return d.access
}

/** 当前是否允许看 */
export function canRead(d) {
  return !!(d && d.access && d.access.allowed === true)
}

export function saveDiary(d) {
  try {
    d.version = 1
    mkdirSync(dirname(diaryFile()), { recursive: true })
    const tmp = diaryFile() + '.tmp'
    writeFileSync(tmp, JSON.stringify(d, null, 2), 'utf8')
    renameSync(tmp, diaryFile())
    return true
  } catch {
    return false
  }
}

/** 取某天的素材桶，没有就建一个 */
export function dayBucket(d, key) {
  if (!d.daily[key]) {
    d.daily[key] = {
      messages: 0,
      turns: 0,
      errors: 0,
      switches: [],        // [{at,from,to}]
      moodMs: {},          // { calm: 毫秒 }
      lastMoodAt: 0,
      lastMood: '',
      firstAt: 0,
      lastAt: 0,
      // ---- 下面这些才是"发生了什么"。光靠计数只能写出汇报体 ----
      hours: {},           // { '22': 7 }  每小时多少条
      words: {},           // { 压缩包: 4 }  当天反复出现的词
      longest: null,       // { len, text }  最长的一条
      stuckFrom: 0,        // 这一串报错是从什么时候开始的
      stuckMs: 0,          // 卡得最久的一次，累计毫秒
    }
  }
  return d.daily[key]
}

// 中文没空格，粗暴切 2~4 字滑窗 + 英文单词；停用词表挡住"这个/然后"这类
const STOP = new Set(['这个', '那个', '什么', '怎么', '可以', '还是', '就是', '因为', '所以', '但是', '如果',
  '没有', '不是', '一个', '这样', '那样', '现在', '然后', '已经', '可能', '应该', '需要', '一下', '我们',
  'the', 'and', 'for', 'you', 'that', 'this', 'with', 'have', 'not', 'are', 'was', 'but', 'can',
  '但', '你', '我', '他', '她', '的', '了', '是', '在', '和', '就', '都', '也', '很', '有', '不', '要',
  '把', '给', '对', '到', '会', '能', '得', '着', '这', '那', '吗', '呢', '吧', '啊', '哦', '嗯'])

/** 从一段话里抠出候选词（不做真分词，够看出"今天反复在说什么"就行） */
export function words(text) {
  const t = String(text || '')
  const out = []
  for (const m of t.matchAll(/[A-Za-z][A-Za-z0-9_+.#-]{2,}/g)) {
    const w = m[0].toLowerCase()
    if (!STOP.has(w) && w.length <= 24) out.push(w)
  }
  const han = t.match(/[\u4e00-\u9fa5]+/g) || []
  for (const seg of han) {
    for (let n = 2; n <= 4; n++) {
      for (let i = 0; i + n <= seg.length; i++) {
        const w = seg.slice(i, i + n)
        if (!STOP.has(w)) out.push(w)
      }
    }
  }
  return out
}

/** 当天反复出现的词（取前 n 个，按频次） */
export function topWords(bucket, n = 4) {
  const ws = (bucket && bucket.words) || {}
  const arr = Object.entries(ws).filter(([, c]) => c >= 2)
  // 先按频次；同频时长的优先（长词更有信息量）
  arr.sort((a, b) => b[1] - a[1] || b[0].length - a[0].length || (a[0] < b[0] ? -1 : 1))
  const kept = []
  for (const [w, c] of arr) {
    // 滑窗会产生大量碎片：「细分补绘」顺带产出「分补」。
    // 规则 1：被某个**更长且频次不低**的候选完全包含 → 丢掉
    if (arr.some(([w2, c2]) => w2.length > w.length && w2.includes(w) && c2 >= c)) continue
    // 规则 2：能由已留下的两个词拼出来（「材质」+「绑定」=「材质绑定」）→ 丢掉，
    //         否则会同时冒出三个近义词
    const splittable = kept.some((a) => kept.some((b) =>
      a.w !== b.w && (a.w + b.w === w || b.w + a.w === w)))
    if (splittable) continue
    if (kept.some((x) => x.w.includes(w))) continue
    kept.push({ w, c })
    if (kept.length >= n) break
  }
  return kept
}

/** 最忙的那个小时 */
export function busiestHour(bucket) {
  const h = (bucket && bucket.hours) || {}
  let best = ''
  let bestN = 0
  for (const [k, v] of Object.entries(h)) if (v > bestN) { bestN = v; best = k }
  return best ? { hour: String(best).padStart(2, '0'), count: bestN } : null
}


// ---------------------------------------------------------------- 攒素材

/**
 * 记录当前心情的"停留"：从上次记录到现在，这段时间算在上一个心情头上。
 * 每次心情变化或收到消息时调一次。
 */
export function noteMood(d, moodId, now = Date.now()) {
  const b = dayBucket(d, dateKey(new Date(now)))
  if (b.lastMood && b.lastMoodAt) {
    const span = Math.max(0, Math.min(now - b.lastMoodAt, 2 * 3600 * 1000)) // 单次最多记 2 小时，避免长期挂机虚高
    b.moodMs[b.lastMood] = (b.moodMs[b.lastMood] || 0) + span
  }
  b.lastMood = moodId
  b.lastMoodAt = now
  if (!b.firstAt) b.firstAt = now
  b.lastAt = now
  return b
}

/** 记录一次心情切换 */
export function noteSwitch(d, from, to, now = Date.now()) {
  const b = dayBucket(d, dateKey(new Date(now)))
  b.switches.push({ at: now, from, to })
  return b
}

/**
 * 记录活动：'message' | 'turn' | 'error'
 *
 * @param {string} [text] 用户这条消息的原文 —— 只有 message 用得上。
 *   光记数字写不出像样的日记；这里顺手把"当天反复在说什么""最长的那条""最忙的一小时"
 *   都攒下来，成文时才有具体的东西可讲。
 */
export function noteActivity(d, kind, now = Date.now(), text = '') {
  const b = dayBucket(d, dateKey(new Date(now)))
  if (kind === 'message') {
    b.messages += 1
    const hour = String(new Date(now).getHours())
    b.hours[hour] = (b.hours[hour] || 0) + 1
    const raw = String(text || '').trim()
    if (raw) {
      for (const w of words(raw)) b.words[w] = (b.words[w] || 0) + 1
      if (!b.longest || raw.length > b.longest.len) b.longest = { len: raw.length, text: raw.slice(0, 120) }
    }
  } else if (kind === 'turn') b.turns += 1
  else if (kind === 'error') {
    b.errors += 1
    // 一串报错从哪开始、卡了多久 —— "卡壳"比"报错 10 次"有画面得多
    if (!b.stuckFrom) b.stuckFrom = now
    b.stuckMs = Math.max(b.stuckMs || 0, now - b.stuckFrom)
  }
  if (!b.firstAt) b.firstAt = now
  b.lastAt = now
  return b
}

// ---------------------------------------------------------------- 成文

const hm = (ms) => {
  const m = Math.round(ms / 60000)
  if (m < 60) return `${m} 分钟`
  const h = Math.floor(m / 60)
  const r = m % 60
  return r ? `${h} 小时 ${r} 分钟` : `${h} 小时`
}

const clock = (ts) => {
  if (!ts) return ''
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** 当天停留最久的心情 */
export function dominantMood(bucket) {
  let best = ''
  let bestMs = -1
  for (const [id, ms] of Object.entries(bucket.moodMs || {})) {
    if (ms > bestMs) { bestMs = ms; best = id }
  }
  return best
}

/** 按主导心情给一句"收尾"的口吻 */
const CLOSING = {
  calm: ['没什么起伏，也挺好。', '就这样吧，平平常常的一天。', '没什么可记的，不过也不坏。'],
  happy: ['回想起来，今天还挺顺。', '总之，今天心情不错。', '算是过得挺舒服的一天。'],
  curious: ['脑子里还留着几个没弄明白的地方，明天接着想。', '还有几个问题悬着，先睡了。', '有些事想通了一半，剩下的一半留给明天。'],
  focused: ['今天脑子一直没散，挺好。', '干得挺扎实，有点累但踏实。', '一天下来手上没停过。'],
  excited: ['今天有几下挺来劲的，难得。', '心跳快了那么几回，记一下。', '好久没这么起劲了。'],
  tired: ['有点累，不过该做的都做了。', '乏了一天，先这样。', '眼皮开始打架了，写到这里。'],
  annoyed: ['有那么几段挺烦躁的，过去了就算了。', '今天有几回不太顺，不提了。', '算了，不想再复盘。'],
  down: ['今天有点沉，不太想说话。', '提不起劲，就这样吧。', '算了，明天再说。'],
  sulk: ['……不写了，睡觉。', '有些话没说出来，先记着。', '算了。'],
  hurt: ['有点委屈，不过也就那样。', '不想解释，记一笔就好。', '算了，反正也没人问。'],
  proud: ['今天有件事做得挺漂亮，不细说了。', '嗯，还行吧。（尾巴翘着）', '总之今天挺得意的。'],
  gloomy: ['沉了一整天，写不出什么。', '就这样吧，没什么好说的。', '连写字都觉得费劲。'],
  anxious: ['心里还悬着点事，睡不太踏实。', '希望明天别出岔子。', '暂时先放一放，明天再想。'],
  numb: ['没什么感觉，记完就完。', '跟昨天也没什么区别。', '……'],
  lonely: ['今天没怎么说话，有点空。', '安静得过了头。', '想找人说两句，又算了。'],
  flutter: ['心跳漏了一拍，不多说。', '……没、没什么。', '今天有一下，记着就好。'],
  love: ['今天想多待一会儿。', '没什么大事，就是想记一句。', '嗯，今天挺好的。'],
  jealous: ['不写了。', '……没事。', '有些话不适合写下来。'],
  burnout: ['什么都没干，先把自己耗完了。', '想了太多，累了。', '翻来覆去，一天就没了。'],
  cracked: ['今天破防了一下，就一下。', '被戳中了，缓了会儿。', '没事，真的没事。'],
  checkedout: ['摆了，就这样。', '今天不想努力。', '随便吧，明天再说。'],
  hyper: ['停不下来，先记一笔。', '今天有点上头。', '还想再弄一会儿，但该睡了。'],
}

const OPENING = {
  calm: ['今天挺安静的。', '没什么大事的一天。', '今天过得平平常常。'],
  happy: ['今天心情不错。', '今天挺顺的。', '今天意外地轻松。'],
  curious: ['今天老想追问点什么。', '今天好奇心有点重。', '今天总想把事情弄清楚。'],
  focused: ['今天一直在干活。', '今天坐得住。', '今天脑子很清楚。'],
  excited: ['今天有点兴奋。', '今天难得来劲。', '今天心跳快了那么几回。'],
  tired: ['今天有点乏。', '今天没什么力气。', '今天累得比较早。'],
  annoyed: ['今天有点烦。', '今天不太顺。', '今天有几回忍不住想甩尾巴。'],
  down: ['今天有点提不起劲。', '今天不太想说话。', '今天沉沉的。'],
  sulk: ['今天有点闷。', '今天不想多说话。', '今天……算了。'],
  hurt: ['今天有点委屈。', '今天被说了一句。', '今天心里有点堵。'],
  proud: ['今天有点得意。', '今天干成了件事。', '今天尾巴翘得有点高。'],
  gloomy: ['今天很沉。', '今天提不起劲。', '今天像隔了一层玻璃。'],
  anxious: ['今天心里一直悬着。', '今天坐不太住。', '今天老怕出错。'],
  numb: ['今天没什么感觉。', '今天过得很平。', '今天像按了静音。'],
  lonely: ['今天有点安静过头了。', '今天没怎么说上话。', '今天屋子里太空。'],
  flutter: ['今天有一下，心跳漏了一拍。', '今天有点不太对劲。', '今天……嗯。'],
  love: ['今天想多待一会儿。', '今天心情软软的。', '今天挺好的。'],
  jealous: ['今天不太想写。', '今天有点堵。', '今天……没事。'],
  burnout: ['今天什么都没干，就累了。', '今天把自己耗完了。', '今天想太多。'],
  cracked: ['今天破防了一下。', '今天没绷住。', '今天有点想哭。'],
  checkedout: ['今天摆了。', '今天不想努力。', '今天能省就省。'],
  hyper: ['今天停不下来。', '今天上头了。', '今天全扑在一件事上。'],
}

/**
 * 文风表 —— **心情改的不只是开头收尾，是整篇的调子。**
 *
 *   keep  留几段（烦躁/疲惫/麻木会砍段，写不动就是写不动）
 *   cut   每段留几成（短句化。疲惫的人不会写长句）
 *   sep   段间分隔（消极的心情用单换行，挤在一起才像那种状态）
 *   tail  收尾标点（省略号 = 话没说完 / 不想说）
 *   feel  心情自己冒出来的一句
 */
const VOICE = {
  calm: { keep: 4, cut: 1.0, sep: '\n\n', tail: '', feel: '' },
  happy: { keep: 4, cut: 1.0, sep: '\n\n', tail: '', feel: '今天话好像有点多。' },
  curious: { keep: 4, cut: 1.0, sep: '\n\n', tail: '', feel: '还有几个问题没问出来。' },
  focused: { keep: 3, cut: 1.0, sep: '\n\n', tail: '', feel: '' },
  excited: { keep: 4, cut: 1.0, sep: '\n\n', tail: '', feel: '居然还有点睡不着。' },
  tired: { keep: 2, cut: 0.6, sep: '\n', tail: '', feel: '不写了。' },
  annoyed: { keep: 2, cut: 0.7, sep: '\n', tail: '', feel: '算了。' },
  down: { keep: 2, cut: 0.6, sep: '\n', tail: '', feel: '' },
  sulk: { keep: 2, cut: 0.5, sep: '\n', tail: '……', feel: '' },
  hurt: { keep: 2, cut: 0.7, sep: '\n', tail: '', feel: '不想说了。' },
  proud: { keep: 4, cut: 1.0, sep: '\n\n', tail: '', feel: '（也没什么。）' },
  gloomy: { keep: 2, cut: 0.5, sep: '\n', tail: '', feel: '' },
  anxious: { keep: 4, cut: 1.0, sep: '\n', tail: '', feel: '不知道明天会不会更糟。' },
  numb: { keep: 2, cut: 0.4, sep: '\n', tail: '', feel: '' },
  lonely: { keep: 3, cut: 1.0, sep: '\n\n', tail: '……', feel: '' },
  flutter: { keep: 3, cut: 0.8, sep: '\n\n', tail: '', feel: '……没、没什么。' },
  love: { keep: 4, cut: 1.0, sep: '\n\n', tail: '', feel: '' },
  jealous: { keep: 2, cut: 0.5, sep: '\n', tail: '', feel: '不写了。' },
  burnout: { keep: 3, cut: 0.7, sep: '\n', tail: '', feel: '我是不是又想多了。' },
  cracked: { keep: 2, cut: 0.6, sep: '\n', tail: '', feel: '……没事。' },
  checkedout: { keep: 2, cut: 0.6, sep: '\n', tail: '', feel: '随便吧。' },
  hyper: { keep: 5, cut: 1.0, sep: '\n\n', tail: '', feel: '还想再弄一会儿。' },
}

/** 把一段话按句子切开（中文句末标点 + 换行） */
function sentences(s) {
  return String(s).split(/(?<=[。！？…])/).map((x) => x.trim()).filter(Boolean)
}

/**
 * 按心情改文风。
 * 不是"加一句心情的话"就完了 —— 是**同样的内容，用不同的节奏写出来**。
 */
export function applyVoice(text, mood) {
  const v = VOICE[mood] || VOICE.calm
  let paras = String(text).split('\n\n').map((x) => x.trim()).filter(Boolean)
  if (paras.length > v.keep) {
    // 砍段时保留头尾（开场和收尾最有信息量），中间挑一段
    const head = paras.slice(0, 1)
    const tail = paras.slice(-1)
    const mid = paras.slice(1, -1).slice(0, Math.max(0, v.keep - 2))
    paras = head.concat(mid, v.keep >= 2 ? tail : [])
  }
  if (v.cut < 1) {
    paras = paras.map((p) => {
      const ss = sentences(p)
      const n = Math.max(1, Math.ceil(ss.length * v.cut))
      return ss.slice(0, n).join('')
    })
  }
  let out = paras.filter(Boolean).join(v.sep)
  if (v.feel) out += (v.sep === '\n\n' ? '\n\n' : '\n') + v.feel
  if (v.tail) out = out.replace(/[。！]?\s*$/, '') + v.tail
  return out
}

/**
 * 能"持续一整天"的心情。其余的是**一阵的**（得意、上头、破防、吃醋、心动…），
 * 对它们说「一整天基本都是 X」会很假 —— 那类干脆不在正文里报占比。
 */
const SUSTAINED = new Set(['calm', 'happy', 'curious', 'focused', 'tired', 'down',
  'gloomy', 'anxious', 'numb', 'lonely', 'love', 'burnout', 'checkedout'])

function timeWord(ts) {
  const d = new Date(ts)
  const h = d.getHours()
  const m = d.getMinutes()
  const base = ['半夜', '凌晨', '凌晨', '凌晨', '凌晨', '清晨', '早上', '早上', '上午', '上午',
    '上午', '中午', '中午', '下午', '下午', '下午', '下午', '傍晚', '晚上', '晚上',
    '晚上', '晚上', '夜里', '深夜'][h]
  if (m < 20) return base + '那会儿'
  if (m < 40) return base + '过半'
  return (h === 11 ? '快中午' : h === 23 ? '快十二点' : base + '快过完')
}

/** 时长说人话 */
function spanWord(ms) {
  const m = Math.round(ms / 60000)
  if (m < 10) return '没一会儿'
  if (m < 40) return '半个来钟头'
  if (m < 90) return '一个多钟头'
  if (m < 180) return '小半天'
  if (m < 360) return '小半天连着一晚上'
  return '断断续续一整天'
}

/** 按日期取变体：同一天结果稳定，不同天读起来不一样 */
function pick(arr, seed) {
  if (!Array.isArray(arr) || !arr.length) return ''
  return arr[Math.abs(seed) % arr.length]
}
function seedOf(key) {
  let h = 0
  for (const ch of String(key)) h = (h * 31 + ch.charCodeAt(0)) | 0
  return h
}

/**
 * 用当天素材合成一篇日记。
 *
 * 写法上的几条规矩（吃了亏才定的）：
 *   · **分段**，不要一行一件事 —— 那是状态报告不是日记
 *   · **有"我"** —— 日记的主体是人，不是数据
 *   · **数字软化** —— 真实日记不会写"占了大概 50%"，会说"一天都挺平的"
 *   · **长短句交替**，允许停顿和破句
 *   · 同一天结果稳定，不同天措辞不同（按日期取变体）
 */
export function composeDiary(key, bucket, moodLabel = (id) => id, headlines = []) {
  if (!bucket) return ''
  const dom = dominantMood(bucket)
  const seed = seedOf(key)
  const paras = []

  const has = (bucket.messages || 0) + (bucket.turns || 0) > 0
  if (!has) return '今天没人说话。\n\n我也没干什么。'

  const tw = topWords(bucket, 3)
  const words = tw.map((x) => '「' + x.w + '」')

  // ---- 第一段：先定调子，再说时间。要有画面，不是"今天挺安静的" ----
  const bits = [pick(OPENING[dom] || ['今天就这样。'], seed)]
  if (bucket.firstAt && bucket.lastAt && bucket.lastAt - bucket.firstAt > 25 * 60000) {
    bits.push(pick([
      `从${timeWord(bucket.firstAt)}坐到${timeWord(bucket.lastAt)}。`,
      `${timeWord(bucket.firstAt)}开始，一直弄到${timeWord(bucket.lastAt)}。`,
    ], seed))
  } else {
    bits.push(pick(['今天没多长时间。', '就一小会儿。'], seed))
  }
  const busy = busiestHour(bucket)
  if (busy && busy.count >= 4) {
    bits.push(pick([
      `不过${busy.hour}点那阵最凶，我基本没抬过头。`,
      `${busy.hour}点前后话最密，连尾巴都忘了甩。`,
    ], seed))
  }
  paras.push(bits.join(''))

  // ---- 第二段：到底在干嘛。**具体的东西**才是活人感，不是统计 ----
  const work = []
  if (words.length >= 2) {
    work.push(pick([
      `翻来覆去就是${words.join('、')}这些。他改一版，我看一版，再改。`,
      `一整天都在${words.join('、')}上头打转。说实话有点烦，但也就那么回事。`,
      `${words.join('、')}——今天听得耳朵都起茧了。`,
    ], seed))
  } else if (words.length === 1) {
    work.push(`一天就围着${words[0]}转，别的什么也没干成。`)
  }
  // 自我暴露：真人不装，承认当时没底/犯了蠢
  if (bucket.longest && bucket.longest.len >= 30 && bucket.longest.text) {
    const q = bucket.longest.text.replace(/\s+/g, ' ').slice(0, 50)
    work.push(pick([
      `中间他一次说了挺长一段，从「${q}……」开始的。我看了两遍才动手 —— 其实第一遍就没看懂，没敢说。`,
      `他发过一段最长的话：「${q}……」。当时我以为自己懂了，后来发现想岔了。`,
    ], seed))
  }
  if (work.length) paras.push(work.join(''))

  // ---- 第三段：卡壳。写**那一次**，不写"卡了几次" ----
  if (bucket.errors >= 8) {
    const stuck = bucket.stuckMs ? spanWord(bucket.stuckMs) : '半天'
    paras.push(pick([
      `中间卡了${stuck}。不是慢，是根本不对。那会儿真想甩尾巴走人。`,
      `有一回硬是磨了${stuck}，改到第四遍才发现前面就错了。早点回头看第一版就好了。`,
    ], seed))
  } else if (bucket.errors >= 3) {
    paras.push(pick([
      `中间出过几次岔子，有一回前前后后折腾了挺久。有点想骂人，忍住了。`,
      `不算太顺。有几处绕了远路，事后看其实一开始就该问清楚。`,
    ], seed))
  } else if (bucket.errors > 0) {
    paras.push('小磕绊几次，不值一提。')
  } else {
    paras.push(pick(['今天意外地顺，一次都没返工。', '没出什么岔子。难得。'], seed))
  }

  // ---- 第四段：外面。有就一句 + 一点态度，没有就不写 ----
  const heads = (Array.isArray(headlines) ? headlines : []).filter((h) => h && String(h).trim())
  if (heads.length) {
    paras.push(`外面在传${heads.slice(0, 2).map((h) => '「' + String(h).trim() + '」').join('、')}。扫了一眼，跟我没什么关系。`)
  }

  paras.push(CLOSING[dom] ? pick(CLOSING[dom], seed) : '就这样吧。')
  // 最后过一遍文风：同样的内容，按心情换成不同的节奏和长短
  return applyVoice(paras.filter(Boolean).join('\n\n'), dom)
}

/**
 * 生成（或补生成）某天的日记。
 * 已存在且未被编辑过 → 覆盖；被模型编辑过 → 不覆盖。
 * 返回 { text, created } 或 null（当天没素材且已有条目）
 */
export function ensureDiary(d, key, moodLabel = (id) => id, opts = {}) {
  const bucket = d.daily[key]
  const existing = d.entries.find((e) => e.date === key)
  if (existing && existing.edited) return null       // 模型改过的，不动
  if (!bucket) return null
  const text = composeDiary(key, bucket, moodLabel)
  if (!text) return null
  if (existing) {
    if (existing.text === text) return null
    existing.text = text
    existing.mood = dominantMood(bucket)
    existing.createdAt = Date.now()
    return { text, created: false }
  }
  d.entries.push({
    date: key,
    text,
    mood: dominantMood(bucket),
    createdAt: Date.now(),
    edited: false,
  })
  d.entries.sort((a, b) => (a.date < b.date ? 1 : -1))
  return { text, created: true }
}

/** 模型改写某天的日记 */
export function writeDiary(d, key, text, moodLabel = (id) => id) {
  const t = String(text || '').trim()
  if (!t) return null
  let e = d.entries.find((x) => x.date === key)
  if (!e) {
    e = { date: key, text: t, mood: dominantMood(d.daily[key] || {}), createdAt: Date.now(), edited: true }
    d.entries.push(e)
    d.entries.sort((a, b) => (a.date < b.date ? 1 : -1))
  } else {
    e.text = t
    e.edited = true
    e.createdAt = Date.now()
  }
  return e
}

/** 清理过老的素材（默认留 180 天） */
export function pruneDaily(d, keepDays = 180) {
  const keys = Object.keys(d.daily)
  if (keys.length <= keepDays) return 0
  keys.sort()
  const drop = keys.slice(0, keys.length - keepDays)
  for (const k of drop) delete d.daily[k]
  return drop.length
}

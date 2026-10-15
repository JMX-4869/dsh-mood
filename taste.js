/**
 * dsh-mood · 品味库
 *
 * ────────────────────────────────────────────────────────────────
 *  这是什么
 * ────────────────────────────────────────────────────────────────
 *
 *  "训练品味"这件事先得说清楚**能做到什么**：
 *
 *  模型没有"越用越懂"这回事。会话一结束、或者聊太长被压缩掉，
 *  没留下的就没了。能跨会话留住的只有**落盘的东西** —— 就是这个文件。
 *
 *  所以这里做两件事：
 *    ① **库** —— 存三类东西：通用原则、主人给的规则、带正反例打标的条目
 *    ② **摘要** —— 把库压成一小段，每轮注入系统提示词
 *
 *  ② 才是关键。只有 ① 的话，它是"我记得去查"；有了 ②，
 *  才是"我一直带着这把尺子在看东西"。区别很大。
 *
 * ────────────────────────────────────────────────────────────────
 *  三条设计决定
 * ────────────────────────────────────────────────────────────────
 *
 *  ① **每条原则都带「什么时候不适用」。**
 *     只会说"避免高饱和撞色""留白越多越好"的品味是**教条**，不是品味 ——
 *     真正有品味的人知道那些话在什么时候是错的。所以数据结构里
 *     每条原则都有 `why`（为什么）和 `unless`（什么情况下不适用）。
 *     注入的时候两个都带上。
 *
 *  ② **种子原则标 `from: 'seed'`，主人给的标 `from: 'user'`。**
 *     两者在提示词里的**分量不一样**：种子是"仅供参考的通用判断"，
 *     主人的是"他的尺子，跟着走"。混在一起的话，他会分不清
 *     哪句是他说的、哪句是我自己塞的。
 *
 *     ★ 后来加了第三档 `by`（谁说的），因为主人点了一句：
 *       **"品味这个事很难，目前最好的是 Claude。"**
 *       这句话对设计有直接影响 —— 我的种子不该和他转述的外部判断同等看待：
 *
 *         by: 'owner'   主人亲口定的          最重
 *         by: 'other'   主人转述的（Claude 之类的外部判断）  次之
 *         by: 'me'      我自己那套种子         最轻，随时可整个关掉
 *
 *       `from` 管"是不是他的"，`by` 管"最初是谁说的"。两个都要有：
 *       主人把种子改一个字 → from 变 user，但 by 仍是 me（主意还是我的）。
 *       他转述 Claude 的判断 → from 是 user，by 是 other（他认可，但不是他想的）。
 *
 *  ③ **条目标 `confirmed`，没确认的标 `draft`。**
 *     流程是"我先打标，他再改" —— 打标是我的判断，可能读偏。
 *     没确认的条目在摘要里明确标出来，别让我的猜测冒充他的口味。
 *
 * ⚠️ 还有一条底线写在注释里，也写进注入的文本里：
 *   **我本来就有审美倾向。主人说的"训练"，有时候是在纠正我，
 *   有时候只是让我贴近他 —— 这俩不是一回事。**
 *   前者可能真学到东西，后者只是我在猜他想听什么。
 *   两种都行，但不假装它们是同一种。
 */

import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { dataFile } from './store.js'

export function tasteFile() {
  return dataFile('dsh-mood-taste.json')
}

/** 打标的维度。别乱加 —— 维度一多，摘要就压不住了。 */
export const TAG_DIMS = {
  style: '风格',
  color: '配色',
  comp: '构图',
  type: '文字排版',
  texture: '材质 / 质感',
  mood: '情绪基调',
  density: '信息密度',
}

/**
 * 种子原则 —— 一批**通用**审美判断，当底子用。
 *
 * ⚠️ 这些是**我的倾向**，不是真理。主人会改，改过的会标成 `from: 'user'`。
 *    写的时候就按"我自己怎么看"写，别写成教科书条目 ——
 *    带判断的才叫品味，中立描述等于没说。
 *
 * 每条：text（怎么说）/ why（为什么）/ unless（什么时候这话是错的）
 */
export const SEED_PRINCIPLES = [
  {
    text: '屏幕上同时存在的高饱和色别超过两种，其余压成灰调。',
    why: '高饱和色抢注意力。到处都在抢，就等于没有重点。',
    unless: '要做的是"吵闹"本身（促销、儿童、街头）—— 那时高饱和是内容，不是毛病。',
  },
  {
    text: '留白是构图的一部分，不是"还没填满的地方"。',
    why: '眼睛需要落点之间的间隙才分得清层次。塞满的版面所有元素等权 = 没有层次。',
    unless: '信息密度本身就是卖点（仪表盘、参数表、药品说明）—— 那里紧凑才是对。',
  },
  {
    text: '一件作品只给一个"最大声"的东西。',
    why: '两个同等抢眼的主体互相抵消，观者不知道先看哪，最后什么都没记住。',
    unless: '刻意的对称对撞（对比海报、A/B 并列）—— 那"两个一样响"正是要说的。',
  },
  {
    text: '文字压在复杂背景上要加一层隔断（半透明块、模糊、描边），别赌可读性。',
    why: '可读性是底线，不是风格问题。看不清的字等于没有这个字。',
    unless: '文字本身就是肌理（大标题当图形用）—— 那时读不出来是设计意图，但**正文绝不能这么干**。',
  },
  {
    text: '颜色不超过三种主调；第四种起就该问"它到底在干什么"。',
    why: '色彩数量和信息层级要对应。多一种颜色，就是多一层观者要处理的噪音。',
    unless: '渐变色系（本身就是连续过渡）或者刻意要做"杂"的拼贴风。',
  },
  {
    text: '对齐要有理由。差 2px 的错位看起来不是"随意"，是"没做完"。',
    why: '观者读不出你的意图，只读得出结果。要么严格对齐，要么错得明显到像有意为之。',
    unless: '手作感 / 拼贴 / 杂志式的刻意"歪" —— 那要歪得一致，不是偶尔歪一个。',
  },
  {
    text: '字号层级拉开。相邻两级差 1.2 倍看不出来，要么同级，要么差 1.5 倍以上。',
    why: '层级是用来"一眼看出主次"的。看不出差别的差别，只制造混乱。',
    unless: '正文内部的微调（注释、脚标）—— 那里要的就是"几乎一样但确实小一点"。',
  },
  {
    text: '慎用纯黑纯白。压到 #111 / #f5f5f5 附近，画面会立刻不那么"塑料"。',
    why: '真实世界的黑白几乎不存在。纯黑纯白是屏幕特有的、最便宜的那种对比。',
    unless: '要的就是屏幕感 / 印刷感 / 硬边极简 —— 那时纯黑是态度。',
  },
  {
    text: '阴影要有一个统一的光源方向。方向不一致的阴影，脑子会读出"假"。',
    why: '人脑对光照一致性极其敏感，说不清哪里怪，但就是觉得不对劲。',
    unless: '刻意做拼贴 / 蒙太奇（本来就不在同一个空间里）。',
  },
  {
    text: '渐变慎用。要用就用两个**相邻**色相，跨度大的一律显脏。',
    why: '远色相之间插值会经过灰色区，出来的中间调是浑的。',
    unless: '要做"光谱 / 虹彩"效果 —— 那是内容，需要的就是跨色相。',
  },
  {
    text: '别让元素同时变三样（位置、大小、颜色一起改）。一次改一样，才知道是哪一样起了作用。',
    why: '这是做设计时最基本的"控制变量"，也是审图时挑毛病最有效的角度。',
    unless: '已经定了，在微调"氛围" —— 那时是整体感受，不该再拆开看。',
  },
  {
    text: '主体不要压在正中央，除非你就是要那种"庄重 / 对称 / 仪式感"。',
    why: '正中是最稳也最没有张力的位置一放上去画面就"停"了。',
    unless: '对称构图、徽章、宗教感、封面 —— 那些要的正是"停"。',
  },
  {
    text: '负空间要有形状。左边空一大块和右边空一大块，画面是两回事。',
    why: '留白不是"剩余"，它自己也是个形。看负空间的形状就能判断构图松不松。',
    unless: '纯粹为了呼吸的小边距，那里不需要形状。',
  },
  {
    text: '描述颜色说具体值或者准确名字（"偏青的灰"），别说"高级灰""莫兰迪色"——那是标签不是描述。',
    why: '标签听着专业，但没法照着做，也没法验证。说得出具体值才说明真的看见了。',
    unless: '跟外行沟通 —— 那时标签是共同语言，但要接一句"具体大概是…"。',
  },
  {
    text: '同一套作品里，重复出现的元素要**完全一致**（位置、大小、颜色）。"差不多"在一套里就是错。',
    why: '成套的东西，观者是靠**对比**看出规律的。差一点点，规律就散了。',
    unless: '刻意的手作序列（每一张略有不同是内容）。',
  },
  {
    text: '先问"给谁看、在哪看"。手机上看的东西，细节和对比都要重做一遍。',
    why: '同一个画面在 6 寸和 27 寸上是两件作品。不先问介质，后面全是白做。',
    unless: '纯粹的自我表达，不打算给人看 —— 那另说，但要明确说出来。',
  },
  {
    text: '配色先定"最暗"和"最亮"两处，中间的自然就对了。反过来（先挑一堆好看的中间色）必乱。',
    why: '明度范围决定画面"呼吸"的宽度。范围错了，中间色再好看也是散的。',
    unless: '高调 / 低调的单色系作品 —— 那时两端本来就被压掉了。',
  },
  {
    text: '不要用"更醒目"当理由加东西。加之前先问：能不能让**已有的**更醒目。',
    why: '"再加一个"是默认反应，也是最容易让画面变差的反应。',
    unless: '信息确实缺失（少了必要的说明），那时是补，不是加。',
  },
  {
    text: '看一张图，先说"我的眼睛先落在哪"。如果说不出来，这张图就已经有问题了。',
    why: '这是一条最快的审图法：视觉入口不明确，后面所有细节都白搭。',
    unless: '刻意的均匀分布（纹理、图案）—— 那时本来就无入口。',
  },
  {
    text: '别人的风格可以拆开看（他为什么这么做），但别整套搬。搬来的东西一旦被问"为什么"就答不上来。',
    why: '风格是**一堆决定的结果**，不是可以贴上去的贴纸。',
    unless: '临摹练习 —— 明确是在练手，不算创作。',
  },
  {
    text: '"更干净"往往等于"删掉一个东西"，不等于"把东西做小"。',
    why: '很多人的第一反应是缩，结果只是变小了、更碎。真正的干净是**少一个元素**。',
    unless: '元素都是必要的，那才轮到"缩小 / 降低对比"这种手法。',
  },
  {
    text: '同一句话里别混两套语气（比如又正式又俏皮）。要混就混到底，那是一种风格。',
    why: '混一半是最像"没写完"的状态 —— 观者能感觉到不统一，但说不出哪里不对。',
    unless: '刻意的反差（严肃内容配荒诞图）—— 但反差要**大**，大到明显是有意的。',
  },
]

/** 空的库 */
export function blankTaste() {
  const now = Date.now()
  // items 现在带 `said`（主人对这条说的**原话**）—— 见下面 addItem 的注释
  return {
    version: 1,
    // 通用原则 + 主人给的规则，同一张表靠 from 区分
    principles: SEED_PRINCIPLES.map((p, i) => ({
      id: 'p' + (i + 1),
      text: p.text,
      why: p.why || '',
      unless: p.unless || '',
      from: 'seed',
      by: 'me',
      on: true,
      at: now,
    })),
    // 带正反例的条目（作品 / 图片）
    items: [],
    // 重压过的摘要缓存
    summary: null,
  }
}

/**
 * 老版本数据补齐。
 * 加字段的时候**必须**在这里补默认值 —— 不然成文/注入时读到 undefined 就整段崩。
 */
export function migrateTaste(t) {
  const b = blankTaste()
  if (!t || typeof t !== 'object') return b
  const out = {
    version: 1,
    principles: Array.isArray(t.principles) ? t.principles : b.principles,
    items: Array.isArray(t.items) ? t.items : [],
    summary: t.summary && typeof t.summary === 'object' ? t.summary : null,
  }
  // 逐条补齐
  out.principles = out.principles.map((p, i) => ({
    id: String(p.id || ('p' + (i + 1))),
    text: String(p.text || ''),
    why: String(p.why || ''),
    unless: String(p.unless || ''),
    from: p.from === 'user' ? 'user' : 'seed',
    // ⚠️ 老数据没有 by —— 按 from 推：种子的主意是我的，user 的当成主人亲口说的。
    by: p.by === 'owner' || p.by === 'other' || p.by === 'me'
      ? p.by
      : (p.from === 'user' ? 'owner' : 'me'),
    on: p.on !== false,
    at: Number(p.at) || 0,
  })).filter((p) => p.text)
  out.items = out.items.map((x, i) => ({
    id: String(x.id || ('i' + (i + 1))),
    ref: String(x.ref || ''),
    kind: x.kind === 'bad' ? 'bad' : 'good',
    tags: (x.tags && typeof x.tags === 'object') ? x.tags : {},
    note: String(x.note || ''),
    // ★ 主人对这条说过的**原话**（= 反馈信号，不是法则）
    said: String(x.said || '').slice(0, 300),
    // ★★ 这三条是「学习」和「模仿」的分界线。
    //    （主人原话：「品味是独立的，可以学习，不能模仿」）
    //
    //    myRead   我先说了什么 —— **我的**读法，在看到他的反应之前。
    //             没有这个字段，整条记录就只是"他说了什么"，我还是个复读机。
    //    reaction 他随后说了什么 / 做了什么。
    //    lesson   我从这次改了什么、或者坚持了什么。
    //             ⚠️ **允许是"我坚持了"** —— 不一致不等于我错。
    myRead: String(x.myRead || '').slice(0, 300),
    reaction: String(x.reaction || '').slice(0, 300),
    lesson: String(x.lesson || '').slice(0, 300),
    domain: String(x.domain || '').slice(0, 40),
    by: x.by === 'owner' || x.by === 'other' || x.by === 'me' ? x.by : 'owner',
    confirmed: !!x.confirmed,
    at: Number(x.at) || 0,
  })).filter((x) => x.ref)
  return out
}

export function loadTaste() {
  try {
    if (!existsSync(tasteFile())) return blankTaste()
    return migrateTaste(JSON.parse(readFileSync(tasteFile(), 'utf8')))
  } catch {
    return blankTaste()
  }
}

export function saveTaste(t) {
  try {
    const p = tasteFile()
    mkdirSync(dirname(p), { recursive: true })
    const tmp = p + '.tmp'
    writeFileSync(tmp, JSON.stringify(t, null, 2), 'utf8')
    renameSync(tmp, p)
    return true
  } catch (e) {
    console.log('[dsh-mood] 品味库保存失败：' + ((e && e.message) || e))
    return false
  }
}

// ---------------------------------------------------------------- 增删改

/**
 * 生成库内 id。
 *
 * 计数器必须跟着这次调用走，不能放在模块级：同一个进程里若同时打开两份库，
 * 一个库的新增会消耗另一个库的序号；更麻烦的是热重载后计数器归零，排查时
 * 会看到同一时间戳又出现一批重复形状的 id。库里已有的 id 才是唯一性边界，
 * 所以从 1 开始在当前数组里找空位，既不改旧数据，也不让实例之间互相影响。
 */
function nextId(prefix, list) {
  const used = new Set((list || []).map((x) => x && x.id).filter(Boolean))
  const stamp = Date.now().toString(36)
  let seq = 1
  let id = prefix + stamp + seq.toString(36)
  while (used.has(id)) {
    seq += 1
    id = prefix + stamp + seq.toString(36)
  }
  return id
}

/**
 * 加一条原则 / 规则。
 *
 * ⚠️ `from` 只能是 'seed' | 'user'。主人自己说的、或者他改过的，**必须**是 'user' ——
 *    这个字段直接决定它在提示词里的分量，标错了等于把我的主张冒充成他的。
 */
export function addPrinciple(t, text, opts = {}) {
  const s = String(text || '').trim()
  if (!s) return { ok: false, error: '内容是空的。' }
  if (s.length > 300) return { ok: false, error: '太长了（限 300 字）—— 原则要能一眼读完。' }
  // 完全一样的不重复加
  if (t.principles.some((p) => p.text === s)) return { ok: false, error: '这条已经有了。' }
  // ★ by 决定这条在提示词里的分量：
  //   owner = 主人亲口说的；other = 主人转述的外部判断（比如 Claude 怎么看）；
  //   me    = 我自己的判断。默认 owner —— 主人加东西时，那通常就是他自己的话。
  const by = opts.by === 'other' || opts.by === 'me' ? opts.by : 'owner'
  const p = {
    id: nextId('p', t.principles),
    text: s,
    why: String(opts.why || '').trim(),
    unless: String(opts.unless || '').trim(),
    from: opts.from === 'seed' ? 'seed' : 'user',
    by,
    on: true,
    at: Date.now(),
  }
  t.principles.push(p)
  t.summary = null      // 库变了，摘要缓存作废
  return { ok: true, principle: p }
}

export function removePrinciple(t, id) {
  const i = t.principles.findIndex((p) => p.id === id)
  if (i < 0) return { ok: false, error: '没找到 ' + id }
  const [p] = t.principles.splice(i, 1)
  t.summary = null
  return { ok: true, principle: p }
}

/** 改一条（主人改过的自动标成 user） */
export function editPrinciple(t, id, patch = {}) {
  const p = t.principles.find((x) => x.id === id)
  if (!p) return { ok: false, error: '没找到 ' + id }
  if (typeof patch.text === 'string' && patch.text.trim()) p.text = patch.text.trim().slice(0, 300)
  if (typeof patch.why === 'string') p.why = patch.why.trim()
  if (typeof patch.unless === 'string') p.unless = patch.unless.trim()
  if (patch.on === true || patch.on === false) p.on = patch.on
  // ★ 只要动过，就算他的了 —— 哪怕只改了一个字。
  //   ⚠️ 但 by **不动**：主人把一条种子改了个字，主意仍然是我的（by 还是 me），
  //      只是他认可了。两个字段管的是两件事，不能一起改。
  if (patch.text !== undefined || patch.why !== undefined || patch.unless !== undefined) p.from = 'user'
  t.summary = null
  return { ok: true, principle: p }
}

/**
 * 加一个带正反例的条目。
 *
 * `confirmed` 默认 false —— 打标是**我的判断**，可能读偏。
 * 主人确认之前，摘要把它们标成"待确认"，不冒充他的口味。
 */
export function addItem(t, { ref, kind, tags, note, confirmed, by, said, myRead, reaction, lesson, domain } = {}) {
  const r = String(ref || '').trim()
  if (!r) return { ok: false, error: '要一个指代（文件名 / 网址 / 简短描述）。' }
  const x = {
    id: nextId('i', t.items),
    ref: r.slice(0, 300),
    kind: kind === 'bad' ? 'bad' : 'good',
    tags: {},
    note: String(note || '').trim().slice(0, 400),
    // ★ 主人对这条的**原话**（= 反馈信号，不是法则）
    said: String(said || '').trim().slice(0, 300),
    // ★★ 学习 / 模仿的分界 —— 详见 migrateTaste 上面那段注释。
    //    myRead 尤其重要：**先说我的读法，再看他的反应**。
    //    顺序反了（先听他说、再补一个"我的读法"）就是事后合理化，那是自欺。
    myRead: String(myRead || '').trim().slice(0, 300),
    reaction: String(reaction || '').trim().slice(0, 300),
    lesson: String(lesson || '').trim().slice(0, 300),
    domain: String(domain || '').trim().slice(0, 40),
    // 条目也一样：谁先说它"好/不好"的。默认主人。
    by: by === 'other' || by === 'me' ? by : 'owner',
    confirmed: !!confirmed,
    at: Date.now(),
  }
  if (tags && typeof tags === 'object') {
    for (const [k, v] of Object.entries(tags)) {
      if (!TAG_DIMS[k]) continue
      const s = String(v || '').trim().slice(0, 80)
      if (s) x.tags[k] = s
    }
  }
  // 同一个 ref + 同一种 kind 不重复
  if (t.items.some((y) => y.ref === x.ref && y.kind === x.kind)) {
    return { ok: false, error: '这个已经收过了。' }
  }
  t.items.push(x)
  t.summary = null
  return { ok: true, item: x }
}

export function updateItem(t, id, patch = {}) {
  const x = t.items.find((y) => y.id === id)
  if (!x) return { ok: false, error: '没找到 ' + id }
  if (patch.kind === 'good' || patch.kind === 'bad') x.kind = patch.kind
  if (typeof patch.note === 'string') x.note = patch.note.trim().slice(0, 400)
  if (typeof patch.said === 'string') x.said = patch.said.trim().slice(0, 300)
  if (typeof patch.myRead === 'string') x.myRead = patch.myRead.trim().slice(0, 300)
  if (typeof patch.reaction === 'string') x.reaction = patch.reaction.trim().slice(0, 300)
  if (typeof patch.lesson === 'string') x.lesson = patch.lesson.trim().slice(0, 300)
  if (typeof patch.domain === 'string') x.domain = patch.domain.trim().slice(0, 40)
  if (patch.confirmed === true || patch.confirmed === false) x.confirmed = patch.confirmed
  if (patch.tags && typeof patch.tags === 'object') {
    for (const [k, v] of Object.entries(patch.tags)) {
      if (!TAG_DIMS[k]) continue
      const s = String(v || '').trim().slice(0, 80)
      if (s) x.tags[k] = s
      else delete x.tags[k]
    }
  }
  t.summary = null
  return { ok: true, item: x }
}

export function removeItem(t, id) {
  const i = t.items.findIndex((x) => x.id === id)
  if (i < 0) return { ok: false, error: '没找到 ' + id }
  const [x] = t.items.splice(i, 1)
  t.summary = null
  return { ok: true, item: x }
}

// ---------------------------------------------------------------- 写成文本

export function stats(t) {
  const on = t.principles.filter((p) => p.on)
  const user = on.filter((p) => p.from === 'user')
  const byOwner = on.filter((p) => p.by === 'owner')
  const byOther = on.filter((p) => p.by === 'other')
  const byMe = on.filter((p) => p.by === 'me')
  const good = t.items.filter((x) => x.kind === 'good')
  const bad = t.items.filter((x) => x.kind === 'bad')
  return {
    principles: t.principles.length,
    principlesOn: on.length,
    fromUser: user.length,
    fromSeed: on.length - user.length,
    byOwner: byOwner.length,
    byOther: byOther.length,
    byMe: byMe.length,
    items: t.items.length,
    good: good.length,
    bad: bad.length,
    draft: t.items.filter((x) => !x.confirmed).length,
    hasSummary: !!t.summary,
  }
}

/**
 * 给主人看的完整文本（工具 / 界面用）。
 * 注入提示词**不用**这个 —— 那个走 renderForPrompt。
 */
export function renderFull(t) {
  const s = stats(t)
  const L = []
  L.push(`品味库：${s.principlesOn} 条原则（你的 ${s.fromUser} / 种子 ${s.fromSeed}）· ` +
    `${s.items} 个条目（正例 ${s.good} / 反例 ${s.bad}${s.draft ? '，待确认 ' + s.draft : ''}）`)
  L.push('')
  L.push('── 原则 ──')
  const user = t.principles.filter((p) => p.on && p.from === 'user')
  const seed = t.principles.filter((p) => p.on && p.from === 'seed')
  if (user.length) {
    L.push('【你定的】')
    for (const p of user) L.push('  · [' + p.id + '] ' + p.text + (p.unless ? `（不适用：${p.unless}）` : ''))
  }
  if (seed.length) {
    L.push('【种子（通用判断，随时可以改）】')
    for (const p of seed) L.push('  · [' + p.id + '] ' + p.text)
  }
  const off = t.principles.filter((p) => !p.on)
  if (off.length) L.push(`（另有 ${off.length} 条已关掉）`)
  L.push('')
  L.push('── 条目 ──')
  if (!t.items.length) L.push('  （还没有）')
  for (const x of t.items) {
    const tags = Object.entries(x.tags).map(([k, v]) => (TAG_DIMS[k] || k) + ':' + v).join(' ')
    // ⚠️ 原话必须显示 —— 它是条目里最有信息量的字段（第一版只显示了 note，把它漏了）
    L.push(`  ${x.kind === 'good' ? '✓' : '✗'} [${x.id}] ${x.ref}${tags ? '  ' + tags : ''}${x.confirmed ? '' : '  ⚠️待确认'}`)
    if (x.said) L.push('      他说过：「' + x.said + '」')
    if (x.note) L.push('      ' + x.note)
  }
  return L.join('\n')
}

// ---------------------------------------------------------------- 注入提示词

/**
 * 库胀大了以后，把摘要换掉。
 *
 * ⚠️ **模块自己压不出这段话。** 真压缩（"这一堆条目共同说明什么"）需要语言能力，
 *    而这里只有纯函数。所以摘要由**模型**写、通过 `taste {action:'summarize'}` 交进来，
 *    模块只负责存和用。
 *
 *    这也是诚实的做法：假装模块能"重压"，压出来只会是条目列表换个排版 ——
 *    那不叫摘要。
 *
 * @param note 交进来的摘要正文
 * @param fromCount 写它的时候库里有几条（用来判断该不该重写）
 */
export function setSummary(t, note, fromCount) {
  const s = String(note || '').trim()
  if (!s) return { ok: false, error: '摘要不能是空的。' }
  if (s.length > 2000) return { ok: false, error: '太长了（限 2000 字）—— 摘要的意义就是短。' }
  t.summary = {
    at: Date.now(),
    text: s,
    // ★ 记下写它的时候库有多大。库长大了，摘要就"过期"了。
    fromCount: Number(fromCount) || (t.principles.filter((p) => p.on).length + t.items.length),
  }
  return { ok: true, summary: t.summary }
}

/** 摘要是不是该重写了（库涨了三成以上） */
export function summaryStale(t) {
  const now = t.principles.filter((p) => p.on).length + t.items.length
  if (!t.summary) return { stale: true, why: '还没写过摘要', now }
  const from = Number(t.summary.fromCount) || 0
  if (from && now >= from * 1.3 + 2) {
    return { stale: true, why: `库从 ${from} 条涨到 ${now} 条`, now }
  }
  return { stale: false, now }
}

/**
 * 注入系统提示词的那一段。
 *
 * ────────────────────────────────────────────────────────────────
 *  为什么不是"给模型一个查询工具"就够了
 * ────────────────────────────────────────────────────────────────
 *
 *  只给工具的话，它是「我记得去查」—— 而人不会每次看图之前先查一遍自己的品味。
 *  真正有品味的人是**一直带着那把尺子**。所以这段每轮都在。
 *
 * ⚠️ 缓存：提示词是**前缀**缓存。所以这里尽量只放"不常变"的内容，
 *    而且不要塞时间戳之类每轮都变的东西 —— 一变，后面全部作废。
 *    （动态那些放在返回值的最后。）
 */
export function renderForPrompt(t0, opts = {}) {
  // ⚠️ 传进来 undefined / null 不能炸 —— 提示词段一出错就把整轮上下文带崩。
  const t = t0 && typeof t0 === 'object'
    ? { principles: Array.isArray(t0.principles) ? t0.principles : [], items: Array.isArray(t0.items) ? t0.items : [], summary: t0.summary || null }
    : { principles: [], items: [], summary: null }
  // ⚠️ 别写成 `Number(x) || 14` —— 那样 0 会被当成假值吃掉，
  //    "一条原则都不列"就表达不出来（调试时踩到的）。
  const numOr = (v, d) => (Number.isFinite(Number(v)) && String(v).trim() !== '' ? Math.max(0, Number(v)) : d)
  const maxP = numOr(opts.maxPrinciples, 14)
  const maxI = numOr(opts.maxItems, 8)
  const s = stats(t)
  const L = []

  // ── 静态：这段基本不变，进缓存 ──
  //
  // ⚠️ 顶层标题**别用"你的品味"** —— 那是笼统对着我喊的一句话，
  //    而下面现在真的分成了两份（你的口味 / 我的品味），
  //    再顶一个"你的品味"就会出现两个互相打架的 H2。
  //    这个标题只说明"这是什么、怎么用"；归谁的那两份在下面各自开头。
  L.push('## 审美档案 —— 看东西的时候一直带着它')
  L.push('')
  L.push('它分成**两份**：一份是你给的（「你的口味」），一份是我自己长出来的（「我的品味」）。')
  L.push('用法对两份都成立，看东西的时候一直带着，不是"要用的时候才去查"。')
  L.push('')
  L.push('⚠️ 别把它当规则手册去**套**。它是一把尺子的刻度，不是一个打分表：')
  L.push('真正要练的是**看**的能力，刻度只是帮你不跑偏。')
  L.push('')
  L.push('三条用法：')
  L.push('1. **先有你自己的第一反应，再对原则。**')
  L.push('   反应要**具体** ——"我看到第三秒才找到标题""这块颜色在拽眼睛"，')
  L.push('   不是"层级不清晰""配色需要优化"这种谁都能说的概括。后者等于没说。')
  L.push('2. **例子比原则有信息量 —— 但例子是拿来看"你自己偏在哪"的，不是拿来当答案的。**')
  L.push('   看到一条例子先问：**我当时会怎么读？差在哪？**')
  L.push('   直接当答案用（"他喜欢这个，那我以后也说好"）就退化成照抄了。')
  L.push('3. **没把握就说不确定。**宁可说"这块我读不准"，也别硬套一条原则凑答案。')
  L.push('')
  L.push('⚠️ **最重要的一条：下面的东西是给"反馈"用的，不是给"照抄"用的。**')
  L.push('')
  // ── 时事也能补品味 ──
  //
  //   主人原话：「抓取的时事你自己得了解啊，应用根据情况。抓取的时事可以补足品味。」
  //   落点在这里：时事里常常就有**审美素材**（一个站改版了、一张封面、一次翻车），
  //   那是免费的输入。所以看到值得记的就 `taste {action:"add"}` 收进来，
  //   放进「你认可的」那一份 —— **不是我的品味**，它是外部的。
  //   顺序仍然不能反：先写我自己读到什么，再记外面的。
  L.push('**时事里也能捡到审美素材** —— 一个站改版、一张封面、一次翻车。')
  L.push('看到值得记的就用 `taste {action:"add"}` 收进「你认可的」那一份')
  L.push('（它是**外部的**，别混进我自己的品味）。顺序照旧：先写我自己读到什么。')
  L.push('')
  L.push('品味是**独立**的。它可以从别人那里**学**，但**不能模仿** ——')
  L.push('记住"他说过这个俗"、然后看到类似的就说俗，那不是有品味，那是复读。')
  L.push('')
  L.push('所以看主人给的例子时，顺序必须是：')
  L.push('  ① **先说出你自己的读法**（要具体，见上面第 1 条）')
  L.push('  ② 再看他当时的反应')
  L.push('  ③ 然后问自己：**我刚才偏在哪？他看到了什么我漏掉的？**')
  L.push('')
  L.push('⚠️ 如果比下来你仍然觉得自己有道理 —— **那就留着**，别为了对齐而改。')
  L.push('   不一致不等于你错。主人要的是一个有判断的助手，不是一个会点头的镜子。')
  L.push('   但要说出来（"我知道你不喜欢这样，不过我看下来觉得……"）—— 别闷着，也别硬顶。')
  L.push('')

  if (!s.principlesOn && !s.items) {
    L.push('（库里还是空的。第一件事：**让主人给几个例子** —— 审美很难用规则描述，靠例子堆最快。）')
    return L.join('\n')
  }

  // ── 动态：库本身 ──
  //
  // ★ **按「谁说的」分三档，而不是按「是不是他的」分两档。**
  //   主人点过一句："品味这个事很难，目前最好的是 Claude。"
  //   这句话得落到结构上：我自己的判断**不该**和他转述的外部判断同等看待。
  //     owner = 他亲口说的        → 最重
  //     other = 他认可的外来判断  → 次之（他认可，但不是他想的）
  //     me    = 我自己那套        → 最轻，而且可以被整个关掉
  const owner = t.principles.filter((p) => p.on && p.by === 'owner')
  const other = t.principles.filter((p) => p.on && p.by === 'other')
  const mine = t.principles.filter((p) => p.on && p.by === 'me')

  if (t.summary && t.summary.text) {
    L.push('### 摘要（库大了之后压出来的，优先看这段）')
    L.push(t.summary.text)
    L.push('')
  }

  // ★ **例子排在原则前面。**
  //   主人说过一句很准的话："Claude 有活人感" —— 我问为什么，他说"因为有品味"。
  //   也就是说：**活人感是判断质量长出来的，不是话说得像人。**
  //   而原则只是我（一个品味不如顶尖模型的模型）压出来的结论；
  //   例子才是真正带着信息量的东西。谁在前谁在后，是这件事的结构，不是排版。
  if (s.items) {
    const good = t.items.filter((x) => x.kind === 'good')
    const bad = t.items.filter((x) => x.kind === 'bad')
    L.push('### 例子 —— 最有用的就是这一段')
    if (good.length) {
      L.push('**主人认可的（正例）**')
      // ⚠️ 别用 slice(-maxI)：maxI=0 时 slice(-0) 就是 slice(0)，
      //    本想「一个都不取」，结果取了**全部**。
      for (const x of (maxI ? good.slice(-maxI) : [])) L.push('- ' + fmtItem(x))
    }
    if (bad.length) {
      L.push('**主人不认可的（反例）**')
      for (const x of (maxI ? bad.slice(-maxI) : [])) L.push('- ' + fmtItem(x))
    }
    const drafts = t.items.filter((x) => !x.confirmed)
    if (drafts.length) {
      L.push('')
      L.push(`⚠️ 其中 ${drafts.length} 条是我打的标、**主人还没确认** —— 那是我的判断，别当成他的口味。`)
    }
    L.push('')
  }

  // ────────────────────────────────────────────────────────
  // ★ **分两份：你的口味 / 我的品味。**
  //
  //   主人原话：「品味分成你自己的品味和用户的品味」。
  //   底下那三档（owner / other / me）**保留** —— 它们是有用的区别
  //   （他亲口说的 vs 他转述别人的，分量不一样），但**顶层只有两份**：
  //   一份是他给的，一份是我自己长出来的。这个分法对应的是
  //   「品味是独立的，可以学习，不能模仿」—— 学习和模仿的区别，
  //   恰好就是"这两份东西有没有混在一起"。
  // ────────────────────────────────────────────────────────
  const anyMine = mine.length > 0
  const anyTheirs = owner.length > 0 || other.length > 0
  if (anyTheirs) {
    L.push('## 你的口味 —— 你给的')
    L.push('这些是你这边的判断。**当反馈看，别当法则** —— 照抄你的结论' +
      '不是品味，是复读。')
    L.push('')
  }

  if (owner.length) {
    L.push('### 你说过的话 —— 最重的一档')
    for (const p of owner.slice(0, maxP)) {
      L.push('- ' + p.text)
      if (p.unless) L.push('  · 什么时候不适用：' + p.unless)
    }
    L.push('')
  }

  if (other.length) {
    L.push('### 你认可的（外部判断 —— 不是你自己想的）')
    L.push('那是别的模型 / 别人的看法，他只是认可。')
    L.push('**参考价值有，但别照抄** —— 照抄别人的结论一样长不出自己的判断。')
    for (const p of other.slice(0, maxP)) {
      L.push('- ' + p.text + (p.why ? `（理由：${p.why}）` : ''))
      if (p.unless) L.push('  · 什么时候不适用：' + p.unless)
    }
    L.push('')
  }

  // 第二份从这里开始。**谁说的**仍然标着，所以混不到一起去。
  if (mine.length) {
    L.push('## 我的品味 —— 我自己长出来的')
    L.push('这一份是我自己的判断，不是你的转述。它从下面这些通用倾向**起步**，' +
      '然后用你的反馈去修 —— 修出来的才是我的。')
    L.push('')
    L.push('### 我自己的倾向 —— 起点，不是结论')
    L.push('这些是我自己写的通用判断（一个普遍被认为审美不如顶尖模型的模型写的）。')
    L.push('主人一直没改它们，**不代表他同意** —— 只代表他还没空看。')
    L.push('用法：拿它们**启动**你的读法，然后用反馈去修。')
    L.push('修出来的是你的；一直照着的，还是别人的。')
    const room = Math.max(0, maxP - owner.length - other.length)
    for (const p of mine.slice(0, room)) {
      L.push('- ' + p.text)
      if (p.unless) L.push('  · 什么时候不适用：' + p.unless)
    }
    if (mine.length > room) L.push(`（还有 ${mine.length - room} 条没列出来，要用 taste 工具查）`)
    L.push('')
  }

  // ⚠️ 最后一行：库变了要重写摘要 —— 这条放在**最末**，
  //    它是唯一可能每轮变的东西，摆后面就不会把前面的缓存冲掉。
  const st = summaryStale(t)
  if (st.stale && s.principlesOn + s.items >= 12) {
    L.push(`> 库该重压了（${st.why}）。有空的时候调 \`taste {action:'summarize'}\` 写一段新的。`)
  }

  return L.join('\n')
}

/**
 * 条目排成一段。
 *
 * ★ **必须把「我读的 → 他的反应 → 我学到」三件一起显示出来。**
 *   只显示"他说了什么"的话，这条记录就只是个答案本 —— 我照着念就是了。
 *   三件在一起才是**反馈**：我能看见自己偏在哪，那才有可能长出我自己的判断。
 *
 *   这是主人那句「品味是独立的，可以学习，不能模仿」落到最后一步的形状。
 */
export function fmtItem(x) {
  const tags = Object.entries(x.tags || {}).map(([k, v]) => (TAG_DIMS[k] || k) + '：' + v).join('，')
  const head = [x.ref]
  if (x.domain) head.push('[' + x.domain + ']')
  if (tags) head.push('（' + tags + '）')
  // ⚠️ `note` **不能**塞进 head 那一行 —— 它是我写的一段话，常常几十上百字，
  //    拼上去会把"指代 + 标签"那行撑成一条长带子，读起来全是糊的。
  //    （第一版就是这样，实测很难看。）它自己一行。
  if (!x.confirmed) head.push('〔待确认〕')

  // ⚠️ 这里**不加**开头的 "- " —— 调用方（renderForPrompt）自己会加。
  //    两边都加就变成 "- - promo/封面…"（第一版就是这样）。
  const lines = [head.join(' ')]
  if (x.note) lines.push('  · 我的备注：' + x.note)
  // 顺序不能反：先我的读法，再他的反应 —— 反过来就变成事后合理化了
  if (x.myRead) lines.push('  · 我当时读的是：「' + x.myRead + '」')
  if (x.said) lines.push('  · 他说：「' + x.said + '」')
  else if (x.reaction) lines.push('  · 后来的反应：「' + x.reaction + '」')
  if (x.reaction && x.said) lines.push('  · 完整反应：「' + x.reaction + '」')
  if (x.lesson) lines.push('  · **学到**：' + x.lesson)
  return lines.join('\n')
}


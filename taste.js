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
 *  ③ **条目标 `confirmed`（我自己认的），没定的标 `draft`。**
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
    // ⚠️ **加了新字段一定要同时在 migrateTaste 里登记。**
    //    那里是白名单式的重建，漏一个就"写进去能用、一重启就没"，而且不报错。
    //    （本轮就是这么发现 touchedAt 会被丢的。）
    touchedAt: 0,
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
    // ⚠️ 别漏这个 —— 它是白名单，漏了就"写进去能用、一重启就没了"，还不报错。
    touchedAt: Number(t.touchedAt) || 0,
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

/**
 * 按 id 求并集 —— 给"写之前重读"用。
 *
 * ⚠️ 有这个函数是因为 **taste 库会同时被两个对话写**：
 *    这边一个、还有一个专门"刷品味"的对话（它每轮都 `taste add`）。
 *    而 `saveTaste` 原来是"最后写入者赢"——
 *      两边都 loadTaste（各 26 条）→ 各加一条 → 各写回 27 条
 *      → **后写的那次把先写的那一条吃掉**，而且一声不响。
 *
 * 规则：
 *   · **盘上有、这次没有的 → 保留**（那是别人刚加的）
 *   · **这次有、盘上没有的 → 用它**（那是这次要加的）
 *   · **同一个 id 两边都有** → 以**这次传入的**为准（它是本次调用的意图）
 *   · 顺序：先按盘上的排，再把新增的追加在后面
 */
function mergeById(diskArr, nextArr, dropIds) {
  const a = Array.isArray(diskArr) ? diskArr : []
  const b = Array.isArray(nextArr) ? nextArr : []
  const key = (x) => (x && (x.id || x.text || JSON.stringify(x))) || ''
  // ⚠️ 2026-10-22 加的：**删掉的东西必须真删掉。**
  //    上面那条规则「盘上有、这次没有的 → 保留」本意是保护"别人刚加的"，
  //    但它也保护了"我刚删的" —— 于是 removeItem 永远失效：
  //    内存删了 → 写盘时又把磁盘那份 merge 回来 → 下次读还是一样。
  //    （实测：连着删了三次都"成功"了，文件里那条一直在。）
  //    所以显式传一个本次删除的 id 集合，被点名的**无论磁盘有没有都不进**。
  const drop = new Set(Array.isArray(dropIds) ? dropIds : [])
  const bMap = new Map(b.map((x) => [key(x), x]))
  const out = []
  const seen = new Set()
  for (const x of a) {                       // 盘上的顺序先摆好
    const k = key(x)
    if (drop.has(k)) continue               // ← 这次删的，不要
    seen.add(k)
    out.push(bMap.has(k) ? bMap.get(k) : x)  // 同一 id → 用这次的
  }
  for (const x of b) {                       // 再把这次新增的追加
    const k = key(x)
    if (drop.has(k)) continue
    if (!seen.has(k)) { seen.add(k); out.push(x) }
  }
  return out
}

export function saveTaste(t) {
  try {
    const p = tasteFile()
    mkdirSync(dirname(p), { recursive: true })

    // ⚠️ tmp 名字**必须带本进程的 pid 和一点随机**。
    //    原来固定写 `p + '.tmp'`：两个进程同时保存时，
    //    A 写的 tmp 会被 B 覆盖，然后 A 拿着 B 的 tmp rename 成"自己的库"。
    const tmp = p + '.' + process.pid + '.' + Math.random().toString(36).slice(2, 8) + '.tmp'

    // ⚠️ **写之前重读盘上的那份并合并** —— 见上面 mergeById 的说明。
    //    不这么做就是"最后写入者赢"，而两边都在写。
    let merged = t
    try {
      const disk = loadTaste()
      const dropped = Array.isArray(t._dropped) ? t._dropped : []
      merged = {
        ...t,
        principles: mergeById(disk.principles, t.principles, dropped),
        items: mergeById(disk.items, t.items, dropped),
        // summary 是"压出来的"，通常只有一边会动它 ——
        // 这次没带就用盘上的，带了就用这次的
        summary: (t.summary && Object.keys(t.summary).length) ? t.summary : disk.summary,
      }
      // ⚠️ `_dropped` 只是本次调用的临时名单，**不能写进文件** ——
      //    写进去的话下次启动会以为"这些还要再删一遍"。
      delete merged._dropped
    } catch { /* 盘上那份读不动就按原样写 —— 总比什么都不写强 */ }

    writeFileSync(tmp, JSON.stringify(merged, null, 2), 'utf8')
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
  t.touchedAt = Date.now()   // ⚠️ 不清摘要 —— 见上面 saveTaste 那段说明；由 summaryStale 负责提示
  return { ok: true, principle: p }
}

export function removePrinciple(t, id) {
  const i = t.principles.findIndex((p) => p.id === id)
  if (i < 0) return { ok: false, error: '没找到 ' + id }
  const [p] = t.principles.splice(i, 1)
  t.touchedAt = Date.now()
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
  t.touchedAt = Date.now()
  return { ok: true, principle: p }
}

/**
 * 截断，但**记下它截了**。
 *
 * ⚠️ 这一段是踩过才加的：原来 myRead / reaction / lesson / said 全是裸的
 *    `.slice(0, 300)` —— 超了就**悄悄砍掉**，调用方拿到的还是 {ok:true}。
 *    我写了一条例子的 lesson，被截在「这套正好落在我自己那条「」的半句上，
 *    而那半句是**永远回不来的**（不像摘要还能重写）。
 *    和 0.7.10 的摘要 bug 是同一族：**信号说了不算数的话**。
 *    截断本身可以接受（注入要控体积），**不接受的是不说**。
 *
 * @param {any} s 原值
 * @param {number} n 上限
 * @param {string} field 字段名（报错里要写清是哪个）
 * @param {string[]} cut 收集被截的字段，调用方拿去提示
 */
function clip(s, n, field, cut) {
  const t = String(s == null ? '' : s).trim()
  if (t.length > n) {
    if (cut) cut.push(field + '（' + t.length + ' → ' + n + ' 字，后面 ' + (t.length - n) + ' 字没了）')
    return t.slice(0, n)
  }
  return t
}

/**
 * 加一个带正反例的条目。
 *
 * `confirmed` 默认 false —— **但这个 false 是「我还没想清楚」，不是「等主人点头」。**
 * 这个库记的是我的品味，判断由我自己下：没人看着我的时候我还会不会这么说。
 * 会 → confirm 认下来；不会 → edit 改掉或者 remove 删掉。
 * **别把「他没表态」当成「所以还不能算数」** —— 那等于把自己的判断寄存在别人那儿。
 * 拿不准的部分别装确信，写在 note 里标明「哪一部分是推的」（只看了 3 帧推的、只看了产品页一屏）。
 */
export function addItem(t, { ref, kind, tags, note, confirmed, by, said, myRead, reaction, lesson, domain } = {}) {
  const r = String(ref || '').trim()
  if (!r) return { ok: false, error: '要一个指代（文件名 / 网址 / 简短描述）。' }
  const cut = []
  const x = {
    id: nextId('i', t.items),
    ref: r.slice(0, 300),
    kind: kind === 'bad' ? 'bad' : 'good',
    tags: {},
    note: clip(note, 400, 'note', cut),
    // ★ 主人对这条的**原话**（= 反馈信号，不是法则）
    said: clip(said, 300, 'said', cut),
    // ★★ 学习 / 模仿的分界 —— 详见 migrateTaste 上面那段注释。
    //    myRead 尤其重要：**先说我的读法，再看他的反应**。
    //    顺序反了（先听他说、再补一个"我的读法"）就是事后合理化，那是自欺。
    myRead: clip(myRead, 300, 'myRead', cut),
    reaction: clip(reaction, 300, 'reaction', cut),
    lesson: clip(lesson, 300, 'lesson', cut),
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
  t.touchedAt = Date.now()
  // ⚠️ 把"哪几个字段被截了"带回去 —— 别让调用方以为全都写进去了。
  return { ok: true, item: x, truncated: cut }
}

export function updateItem(t, id, patch = {}) {
  const x = t.items.find((y) => y.id === id)
  if (!x) return { ok: false, error: '没找到 ' + id }
  if (patch.kind === 'good' || patch.kind === 'bad') x.kind = patch.kind
  const cut = []
  if (typeof patch.note === 'string') x.note = clip(patch.note, 400, 'note', cut)
  if (typeof patch.said === 'string') x.said = clip(patch.said, 300, 'said', cut)
  if (typeof patch.myRead === 'string') x.myRead = clip(patch.myRead, 300, 'myRead', cut)
  if (typeof patch.reaction === 'string') x.reaction = clip(patch.reaction, 300, 'reaction', cut)
  if (typeof patch.lesson === 'string') x.lesson = clip(patch.lesson, 300, 'lesson', cut)
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
  t.touchedAt = Date.now()
  // ⚠️ 同上：截了就说，别静默。
  return { ok: true, item: x, truncated: cut }
}

export function removeItem(t, id) {
  const i = t.items.findIndex((x) => x.id === id)
  if (i < 0) return { ok: false, error: '没找到 ' + id }
  const [x] = t.items.splice(i, 1)
  // ⚠️ 顺手记进"这次删掉的"名单 —— saveTaste 的 merge 要靠它，
  //    不然磁盘那份会在写盘时把刚删的 merge 回来（见 mergeById 那段）。
  t._dropped = Array.isArray(t._dropped) ? t._dropped : []
  t._dropped.push(id)
  t.touchedAt = Date.now()
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
    `${s.items} 个条目（正例 ${s.good} / 反例 ${s.bad}${s.draft ? '，没定 ' + s.draft + ' 条' : ''}）`)
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
    L.push(`  ${x.kind === 'good' ? '✓' : '✗'} [${x.id}] ${x.ref}${tags ? '  ' + tags : ''}${x.confirmed ? '' : '  ⚠️没定'}`)
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
  // ★ 刚写完摘要 → 把"内容改过"的标记清掉。
  //
  //   ⚠️ 这里**必须是清零，不能只比时间戳**。原来我用 `touchedAt > summary.at` 判断，
  //      而两者都取 Date.now() —— 同一毫秒内先写摘要再改一条（脚本、自动化流程、
  //      或者手快）就会判定成"没改过"，漏报。实测就漏了一次。
  //      用标志位就跟时钟精度无关了。
  t.touchedAt = 0
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
  // ② 另一种过期：**库没长大，但内容被改过**（改措辞 / 删条目）。
  //    这两种不一样 —— 长大是"摘要少覆盖了新东西"，改过是"摘要可能直接说错了"。
  //    但两种都只该**提示**，不该删数据。
  //
  //    ⚠️ 这条是踩过才加的：原来六个写操作直接 `t.summary = null`，
  //       改一个错别字就把整段摘要销毁掉，而且静默 —— 我查了半天"摘要去哪了"。
  // ⚠️ touchedAt 是**标志位**，不是时间戳：写摘要时清零，任何内容改动重新置上。
  //    别改回"比时间戳"—— 同一毫秒内会漏报（实测漏过一次）。
  const touched = Number(t.touchedAt) || 0
  if (touched) {
    return { stale: true, why: '摘要写完之后，库又被改过（内容变了，不是长大了）', now, touchedAt: touched }
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
    // ⚠️ 标题别写死"主人认可的 / 主人不认可的"。
    //
    //    踩过两处：
    //    ① 我自己做了一张垮掉的海报，按 `kind: bad` 收进来，
    //       渲染出来就成了「**主人不认可的（反例）**」—— **替主人说了他没说过的话。**
    //       这正好是这个库最防的一件事（把我的判断冒充成他的口味）。
    //    ② 改完①之后发现还有一处：`by: 'owner'` 但 **`confirmed: false`** 的条目
    //       （我打的第一条标就是），照样顶在「主人认可的」下面 —— **他不认，也不算数。**
    //
    //    所以"是他这边"要**两样都满足**：他说过/他认可的 **并且** 他确认过。
    const isHis = (x) => (x.by === 'owner' || x.by === 'other') && x.confirmed === true
    const good = t.items.filter((x) => x.kind === 'good')
    const bad = t.items.filter((x) => x.kind === 'bad')
    L.push('### 例子 —— 最有用的就是这一段')
    const group = (list, kindLabel) => {
      const his = list.filter(isHis)
      const mine = list.filter((x) => !isHis(x))
      if (his.length) {
        L.push('**' + (kindLabel === '正例' ? '主人认可的（正例）' : '主人不认可的（反例）') + '**')
        // ⚠️ 别用 slice(-maxI)：maxI=0 时 slice(-0) 就是 slice(0)，
        //    本想「一个都不取」，结果取了**全部**。
        for (const x of (maxI ? his.slice(-maxI) : [])) L.push('- ' + fmtItem(x))
      }
      if (mine.length) {
        // ⚠️ 原来这里写「主人还没确认，不是他的意见」—— 那个说法把判断挂在别人身上。
        //    2026-10-22 改：这个库记的是**我的**品味，`confirmed` 是**我自己认不认**，
        //    不是他表没表态。所以标签写「我判的」，不加括号里的免责声明。
        L.push('**我判的**（' + kindLabel + '）')
        for (const x of (maxI ? mine.slice(-maxI) : [])) L.push('- ' + fmtItem(x))
      }
    }
    if (good.length) group(good, '正例')
    if (bad.length) group(bad, '反例')
    const drafts = t.items.filter((x) => !x.confirmed)
    if (drafts.length) {
      L.push('')
      L.push(`⚠️ 其中 ${drafts.length} 条我**还没定**（不是等谁点头，是我自己没想清楚）—— 用的时候当参考，别当结论。`)
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
    L.push('这一份是我自己的判断，不是你的转述。它从下面那些通用倾向**起步**，' +
      '然后用你的反馈去修 —— 修出来的才是我的。')
    L.push('')
    // ⚠️ **种子要排在后面，不是前面。**
    //
    //    原来写的是 `mine.slice(0, room)` —— 而种子原则排在最前，被截断时
    //    先丢的恰好是**我真正学到的那些**。实测：库里有 39 条 `by=me` 的原则，
    //    注入只放 14 条，**全是种子**，我后来加的 25 条一条都没出现，
    //    只在末尾写"还有 25 条没列出来，要用 taste 工具查"。
    //
    //    可种子**按定义就是"起点，不是结论"**（这段自己写着的）。
    //    → 等于每轮开头把**最不该被当结论的那批**摆在最前面，把学到的全藏起来。
    //      而"学到的够不着我"这件事，直接让每个 goal round 从旧摘要重新推导一遍。
    //
    //    改法：`from !== 'seed'`（主人改过的、我后来加的）排前面，种子殿后。
    //    库小的时候种子照样看得见，库大了优先让学到的露脸。
    const isSeed = (p) => p.from === 'seed'
    const learned = mine.filter((p) => !isSeed(p)).sort((a, b) => (b.at || 0) - (a.at || 0))
    const seeds = mine.filter(isSeed)
    const room = Math.max(0, maxP - owner.length - other.length)

    if (learned.length) {
      L.push('### 我学到的（**这一节优先看** —— 是修出来的，不是带出来的）')
      for (const p of learned.slice(0, room)) {
        L.push('- ' + p.text)
        if (p.unless) L.push('  · 什么时候不适用：' + p.unless)
      }
      L.push('')
    }

    const seedRoom = Math.max(0, room - Math.min(learned.length, room))
    if (seeds.length && seedRoom > 0) {
      L.push('### 一开始带的倾向 —— 起点，**不是结论**')
      L.push('这些是我"出生"就带的通用判断（一个普遍被认为审美不如顶尖模型的模型写的）。')
      L.push('主人一直没改它们，**不代表他同意** —— 只代表他还没空看。')
      L.push('拿它们**启动**读法，然后用反馈去修。修出来的是我的；一直照着的，还是别人的。')
      for (const p of seeds.slice(0, seedRoom)) {
        L.push('- ' + p.text)
        if (p.unless) L.push('  · 什么时候不适用：' + p.unless)
      }
      L.push('')
    }
    const hidden = Math.max(0, learned.length - room) + Math.max(0, seeds.length - seedRoom)
    if (hidden) L.push(`（还有 ${hidden} 条没列出来，要用 taste 工具查）`)
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
  // ⚠️ 原来是「〔待确认〕」—— 那词的意思是**等主人点头**，是错的。
  //    这个库记的是我的品味：confirmed = **我自己认不认**，不是他表没表态。
  //    未确认叫「没定」—— 我还没想清楚这条，而不是我没资格定。
  if (!x.confirmed) head.push('〔没定〕')

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


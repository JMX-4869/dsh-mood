/**
 * dsh-mood · 存储位置
 *
 * 起因：四个数据文件默认都落在 `$DSH_HOME`（也就是 C:\Users\<你>\.dsh），
 * C 盘紧的时候没法挪。所以这里加一层"数据目录"的间接：
 *
 *   $DSH_HOME/dsh-mood-store.json   ← **指针文件，永远留在原地**（不然找不到新位置）
 *     内容：{ "dir": "D:\\dsh-mood-data", "movedAt": 1234567890 }
 *
 * 四个数据文件（state / diary / news / proactive）都通过 `dataFile()` 取路径。
 *
 * ⚠️ 目录在**模块加载时**解析一次。改完指针要**重启宿主**才生效 ——
 *   这是故意的：让路径在运行期变来变去，比"重启一次"危险得多。
 *
 * ⚠️ 迁移是**移动**不是复制：复制 → 逐个校验（文件大小 + JSON 能解析）→ 全过才写指针 → 删原件。
 *   任何一步不过就整个中止，一个字节都不动。
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, copyFileSync, statSync, unlinkSync } from 'node:fs'
import { join, dirname, resolve, isAbsolute } from 'node:path'
import os from 'node:os'

export function dshHome() {
  return process.env.DSH_HOME || join(os.homedir(), '.dsh')
}

/** 指针文件本身 —— 它**不能**挪，否则就找不着新位置了 */
export const POINTER_FILE = join(dshHome(), 'dsh-mood-store.json')

/** 我们的数据文件（迁移时就搬这几个） */
export const DATA_FILES = [
  'dsh-mood.json',
  'dsh-mood-diary.json',
  // ⚠️ **日记的密钥必须跟着搬。** 日记是加密存的（见 diary.js），
  //    密钥留在这儿而文件搬去别处 = 换个盘日记就打不开了，而且看着像"日记没了"。
  //    这个文件第一次保存在 0.7.17 之后才不会漏 —— 之前版本建的目录里没有它，
  //    所以 listCopyable 那边也允许它不存在。
  'dsh-mood-diary.key',
  'dsh-mood-news.json',
  'dsh-mood-proactive.json',
  'dsh-mood-memory.jsonl',
  'dsh-mood-taste.json',
  // ⚠️ 跨会话摘要 —— **这是所有文件里最敏感的一个**：它存的内容是从别的会话抽出来的
  //    对话摘要（谁说了什么、干过什么）。0.14.x 之前它连键都没挂，
  //    也就是说"选择性不存"根本够不着它 —— 那种漏是最难发现的。
  'dsh-mood-sessions.json',
]

/**
 * 文件名 → 短键。
 * 存储配置是**按文件**记的（一个文件一个位置），所以需要一个稳定的短名当键。
 */
export const FILE_KEYS = {
  'dsh-mood.json': 'state',
  'dsh-mood-diary.json': 'diary',
  // 密钥跟正文共用一个键 —— 迁移时两个一起去同一个新目录，这是刻意的
  'dsh-mood-diary.key': 'diary',
  'dsh-mood-news.json': 'news',
  'dsh-mood-proactive.json': 'proactive',
  // 硬盘记忆是 jsonl（一行一条），不是 json —— 但键名照旧走这套
  'dsh-mood-memory.jsonl': 'memory',
  'dsh-mood-taste.json': 'taste',
  'dsh-mood-sessions.json': 'sessions',
}

/** 短键 → 人话（界面上用） */
export const KEY_LABELS = {
  state: '心情状态',
  diary: '日记',
  news: '时事',
  proactive: '主动开口',
  memory: '硬盘记忆',
  taste: '品味库',
  procedures: '经验卡',
  sessions: '跨会话摘要',
}

/**
 * 个别人话要按**文件**说，不是一个键一个词。
 *
 * ⚠️ 日记的正文和密钥共用 'diary' 这个键（迁移时必须同进同退），
 *    但面板上要是两行都写「日记」，人分不清哪个是哪个 ——
 *    而这两个文件的性质完全不同（一个是内容，一个丢了就再也解不开）。
 */
const FILE_LABELS = {
  'dsh-mood-diary.key': '日记密钥（丢了日记就打不开）',
}

/** 每个文件"应该由哪个面板管"（界面上分组用） */
export const KEY_OWNER = {
  state: 'mood',
  diary: 'mood',
  news: 'news',
  proactive: 'proactive',
  memory: 'memory',
  taste: 'taste',
  procedures: 'procedures',
}

const normDir = (d) => {
  const s = typeof d === 'string' ? d.trim() : ''
  if (!s) return null
  return isAbsolute(s) ? resolve(s) : null   // 相对路径不认，免得跟着 cwd 乱跑
}

/**
 * 读指针配置。
 *
 * 两种形态都认：
 *   老：{ "dir": "D:\\x" }                    —— 一个目录管全部
 *   新：{ "default": "D:\\x", "dirs": { diary: "D:\\日记" } }
 *
 * 按文件的位置优先；没单独指定的落到 default；再没有就回 $DSH_HOME。
 */
export function readStoreConfig() {
  try {
    if (!existsSync(POINTER_FILE)) return { default: null, dirs: {}, nostore: {}, raw: null }
    const j = JSON.parse(readFileSync(POINTER_FILE, 'utf8')) || {}
    // 老字段 dir 当作 default —— 用户之前迁过的位置不能被丢掉
    const def = normDir(j.default) || normDir(j.dir)
    const dirs = {}
    if (j.dirs && typeof j.dirs === 'object') {
      for (const [k, v] of Object.entries(j.dirs)) {
        const d = normDir(v)
        if (d) dirs[k] = d
      }
    }
    // 「不落盘」：哪些键改成只写系统临时目录。
    // 只认 true —— 其他值一律当没写，免得手改坏配置之后整片静默失效。
    const nostore = {}
    if (j.nostore && typeof j.nostore === 'object') {
      for (const [k, v] of Object.entries(j.nostore)) {
        if (v === true) nostore[k] = true
      }
    }
    return { default: def, dirs, nostore, raw: j }
  } catch {
    return { default: null, dirs: {}, nostore: {}, raw: null }
  }
}

/** 兼容旧名字：只要"整体默认目录" */
export function readStoreDir() {
  return readStoreConfig().default
}

/** 写指针（保留我们认识之外的字段，别把用户配置吃掉） */
export function writeStoreConfig(cfg) {
  const prev = readStoreConfig().raw || {}
  const next = { ...prev }
  if (cfg.default) next.default = cfg.default
  else delete next.default
  next.dirs = { ...(cfg.dirs || {}) }
  if (!Object.keys(next.dirs).length) delete next.dirs
  delete next.dir   // 老字段不再写，统一用 default
  try {
    mkdirSync(dirname(POINTER_FILE), { recursive: true })
    const tmp = POINTER_FILE + '.tmp'
    writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8')
    renameSync(tmp, POINTER_FILE)
    return true
  } catch {
    return false
  }
}

/** 目录能不能写（不行就退回默认，宁可待在 C 盘也不能写不进去） */
function usableDir(d) {
  if (!d) return null
  try {
    mkdirSync(d, { recursive: true })
    const probe = join(d, '.dsh-mood-write-probe')
    writeFileSync(probe, 'ok', 'utf8')
    unlinkSync(probe)
    return d
  } catch {
    return null
  }
}

/**
 * 解析结果缓存：**整体默认 + 每个文件各自的位置**。
 *
 * 为什么要缓存：`usableDir()` 每次都要 mkdir + 写探针，而 `dataFile()` 在每次
 * 读/存盘时都会被调用 —— 不缓存就是每次都去建目录写一个字节。
 *
 * 为什么可以被 invalidate 掉：**迁移完必须立刻失效**。
 * 老版本路径在模块加载时算一次，结果迁移后到重启前，跑着的进程还在往旧位置读写：
 *   读 → 原件已经搬走/删掉，拿到空的；
 *   写 → mkdirSync 把旧目录建回来，又写一份新的进旧盘。
 * 于是"迁移后到重启前"那一段的改动全落在旧盘，重启一读新盘就丢了。
 */
let _resolved = null

function resolved() {
  if (_resolved) return _resolved
  const c = readStoreConfig()
  const dirs = {}
  for (const k of Object.keys(c.dirs)) {
    const d = usableDir(c.dirs[k])
    if (d) dirs[k] = d
  }
  _resolved = { default: usableDir(c.default) || dshHome(), dirs }
  return _resolved
}

/** 某个短键实际用哪个目录 */
export function dirForKey(key) {
  const r = resolved()
  return r.dirs[key] || r.default
}

/** 整体默认数据目录（所有"没单独指定"的文件都落这儿） */
export function dataDir() {
  return resolved().default
}

/** 兼容旧名字 */
export function resolveDataDir() {
  return dataDir()
}

/** 迁移之后必须调一次 —— 否则还在用旧目录 */
export function invalidateDataDir() {
  _resolved = null
}

/**
 * 数据文件路径。
 *
 * ★ 必须走 `dirForKey`，不能直接用 `dataDir()` ——
 *   `dataDir()` 只是"整体默认目录"，而**每个文件可以被单独指到别处**。
 *   第一版这里写的是 `join(dataDir(), name)`，结果"只把日记搬到另一个目录"之后，
 *   `storageStatus()` 显示新位置、而 `diaryFile()` 还指着旧位置 —— 界面和实际两张皮。
 */
/**
 * 把某个键（或整体的默认）指到新目录 —— 读-改-写，**别把别的字段吃掉**。
 *
 * ⚠️ 写完**必须**失效解析缓存（见下面 resolved() 那段"迁移后到重启前"）：
 *    不失效的话，跑着的进程还在往旧位置读写，那一段的改动全落在旧盘。
 *
 * @param key 短键（'procedures' / 'diary' / …）；传空 = 改整体的默认
 * @param dir 新目录（绝对路径）；传空 = 恢复默认
 */
export function setDirForKey(key, dir) {
  const c = readStoreConfig()
  const next = { default: c.default, dirs: { ...c.dirs } }
  if (key) {
    const d = normDir(dir)
    if (d) next.dirs[key] = d
    else delete next.dirs[key]
  } else {
    next.default = normDir(dir)
  }
  const ok = writeStoreConfig(next)
  if (ok) invalidateDataDir()
  return ok
}

/**
 * 「目录型」的东西 —— 和 DATA_FILES 那些「单个文件」不是一回事。
 *
 * 现在只有一个：**procedures（经验卡）**。它是一整个目录，而且默认值很特殊 ——
 * **默认跟随当前工作区**（那样模型能直接 grep / read 那些 .md，不必绕工具接口），
 * 但用户可以把它指到一个固定位置（比如让它**跨工作区共享**）。
 *
 * → 所以它不是 dataDir() 底下的一个文件，而是「配置过就用配置的，没配过才跟随工作区」。
 *   别的键也走这套，将来要加目录型的东西不用再想一遍。
 */
export function customDirFor(key) {
  try {
    const cfg = readStoreConfig()
    return normDir(((cfg && cfg.dirs) || {})[key]) || null
  } catch { return null }
}

export function dataFile(name) {
  const key = FILE_KEYS[name]
  // ── 「不落盘」：这个键被关掉时，改成写系统临时目录 ──
  //
  // ⚠️ 为什么不是"完全不写"：各模块都是自己 `writeFileSync(dataFile(...))`，
  //    要让它们一个都不写，得改十来个调用点 —— **漏一个就是静默的隐私故障**，
  //    而那种故障不会报错、只在某天被人发现文件还在盘上。
  //    指向临时目录只有一处改动，而且系统清理 / 重启就没了。
  //    代价是：它仍然写了一次盘（在 %TEMP% 里），所以 UI 上要写清这句，别让人误以为"一个字都没落盘"。
  if (key && noStoreFor(key)) {
    const d = join(os.tmpdir(), 'dsh-mood-nostore')
    try { mkdirSync(d, { recursive: true }) } catch { /* 真写的时候会再报 */ }
    return join(d, name)
  }
  return join(key ? dirForKey(key) : dataDir(), name)
}

/** 这个键是不是被设成「不落盘」 */
export function noStoreFor(key) {
  if (!key) return false
  try {
    const c = readStoreConfig()
    return (c.nostore || {})[key] === true
  } catch { return false }
}

/** 改某个键的「不落盘」开关（read-modify-write，只动 nostore 这一段） */
export function setNoStoreFor(key, on) {
  try {
    const prev = readStoreConfig().raw || {}
    const next = { ...prev }
    const ns = { ...(next.nostore || {}) }
    if (on) ns[key] = true
    else delete ns[key]
    if (Object.keys(ns).length) next.nostore = ns
    else delete next.nostore
    mkdirSync(dirname(POINTER_FILE), { recursive: true })
    const tmp = POINTER_FILE + '.tmp'
    writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8')
    renameSync(tmp, POINTER_FILE)
    invalidateDataDir()
    return true
  } catch { return false }
}

/** 现在这套是不是自定义位置 */
export function isCustom() {
  const c = readStoreConfig()
  return !!(c.default || Object.keys(c.dirs).length)
}

/**
 * 面板要显示的状态。**按文件给**，因为每个文件可以各自放在不同目录。
 */
export function storageStatus() {
  const c = readStoreConfig()
  const def = dataDir()
  const files = DATA_FILES.map((n) => {
    const key = FILE_KEYS[n]
    const configured = c.dirs[key] || null      // 这个文件单独指定的目录（没有就 null）
    const dir = configured || def
    const p = join(dir, n)
    let size = 0, exists = false
    try { const st = statSync(p); size = st.size; exists = true } catch { /* 还没生成 */ }
    return {
      name: n, key,
      label: FILE_LABELS[n] || KEY_LABELS[key] || key,
      owner: KEY_OWNER[key] || '',
      dir,
      configured,                              // 单独指定的位置（null = 跟着默认走）
      path: p,
      exists, size,
    }
  })
  return {
    ok: true,
    dir: def,                                  // 整体默认目录
    home: dshHome(),
    pointerFile: POINTER_FILE,
    custom: c.default,
    dirs: c.dirs,
    isCustom: isCustom(),
    files,
    // 默认位置还留着哪些（迁移过的话会列出来）
    leftovers: files.some((f) => f.dir !== dshHome())
      ? DATA_FILES.filter((n) => existsSync(join(dshHome(), n)))
      : [],
  }
}

/** 把磁盘占用写得好看点 */
export function humanSize(n) {
  if (!n) return '0 B'
  if (n < 1024) return n + ' B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
  return (n / 1024 / 1024).toFixed(1) + ' MB'
}

/**
 * 迁移到新目录。
 *
 * 步骤（任何一步失败都整个中止，原始数据一个字节不动）：
 *   1. 目标目录建好、能写
 *   2. 逐个文件复制过去
 *   3. 逐个校验：大小一致 + 是 .json 的话还能解析
 *   4. 全过了才写指针
 *   5. 最后才删原件（删不掉不算失败，只是 C 盘上多留一份）
 *
 * @returns {{ ok: boolean, error?: string, moved?: string[], kept?: string[], to?: string, restart?: boolean }}
 */
export function migrateStorage(targetDir, keys) {
  const raw = String(targetDir || '').trim()
  if (!raw) return { ok: false, error: '要填一个目录。' }
  if (!isAbsolute(raw)) return { ok: false, error: '要填绝对路径（比如 D:\\dsh-mood-data）。' }
  const to = resolve(raw)
  if (to === dshHome() || to.startsWith(dshHome() + '\\') || to.startsWith(dshHome() + '/')) {
    return { ok: false, error: '不能迁回默认的 .dsh 目录里 —— 那正是想躲开的地方。' }
  }

  // 要搬哪几个：不传就是全部；传了就只搬这几个（**一个文件一个位置**）
  // ⚠️ 去重 —— 一个键可以对应多个文件（日记正文 + 密钥都算 'diary'），
  //    不去重的话 allKeys 里会有重复，isAll 就永远算不对。
  const allKeys = [...new Set(DATA_FILES.map((n) => FILE_KEYS[n]))]
  const want = Array.isArray(keys) && keys.length ? keys.filter((k) => allKeys.includes(k)) : allKeys
  if (!want.length) return { ok: false, error: '没指定要搬哪个文件。' }
  const isAll = want.length === allKeys.length

  // 每个文件**各自**从它当前所在的目录出发 —— 这是"一个文件一个位置"的关键。
  // 老版本是从单一 from 出发，第二个文件的真实位置就会被忽略。
  const todo = []
  for (const k of want) {
    const from = dirForKey(k)
    if (to === from) return { ok: false, error: (KEY_LABELS[k] || k) + ' 已经在这个位置了。' }
    // ⚠️ **用 filter 不是 find。** 一个键现在可以对应**多个**文件 ——
    //    日记的正文（.json）和它的密钥（.key）共用 'diary' 这个键，是刻意的：
    //    两个必须一起去同一个新目录，走散了就再也读不出日记。
    //    原来写的是 find，只拿到第一个 —— 密钥永远搬不过去，
    //    而现象是"迁移很成功，然后日记全打不开了"。
    for (const n of DATA_FILES.filter((f) => FILE_KEYS[f] === k)) {
      if (existsSync(join(from, n))) todo.push({ key: k, name: n, from })
    }
  }
  // ★ 一个都搬不到 → 直接不干。
  //
  //   这条是踩出来的：老版本路径在加载时定死，用户迁了两次 ——
  //   第二次时源目录已经被第一次搬空了，于是**复制了 0 个文件，却照样把指针改了**。
  //   结果指针指向一个空目录，看起来像数据全没了。
  //   现在的规矩：搬不到东西就不许改指针。
  if (!todo.length) {
    return {
      ok: false,
      error: '选中的文件一个都不在它们当前的目录里 —— 没有可搬的东西，配置不动。' +
        '（用上面的「刷新」看它们现在实际在哪。）',
    }
  }

  // 1) 目标目录能写
  try {
    mkdirSync(to, { recursive: true })
    const probe = join(to, '.dsh-mood-write-probe')
    writeFileSync(probe, 'ok', 'utf8')
    unlinkSync(probe)
  } catch (e) {
    return { ok: false, error: '目标目录不可写：' + ((e && e.message) || e) }
  }

  // 2) 复制
  const copied = []
  try {
    for (const t of todo) {
      const dst = join(to, t.name)
      // 已经有一份同名文件就先挪开，别直接覆盖别人的东西
      if (existsSync(dst)) renameSync(dst, dst + '.replaced-' + Date.now())
      copyFileSync(join(t.from, t.name), dst)
      copied.push(t)
    }
  } catch (e) {
    return { ok: false, error: '复制失败：' + ((e && e.message) || e) + '（目标目录里可能留了半份，原始数据没动）' }
  }

  // 3) 校验
  for (const t of copied) {
    try {
      if (statSync(join(t.from, t.name)).size !== statSync(join(to, t.name)).size) {
        return { ok: false, error: '校验失败（大小不一致）：' + t.name + ' —— 原始数据没动。' }
      }
      if (t.name.endsWith('.json')) JSON.parse(readFileSync(join(to, t.name), 'utf8'))
    } catch (e) {
      return { ok: false, error: '校验失败：' + t.name + ' —— ' + ((e && e.message) || e) + '（原始数据没动）' }
    }
  }

  // 4) 写配置
  //    · 全搬 → 设成整体默认，顺手清掉按文件的分项（就是"都放一起"的意思）
  //    · 只搬一部分 → 只给这几个文件记单独位置，别的原样
  const c = readStoreConfig()
  const next = isAll
    ? { default: to, dirs: {} }
    : { default: c.default, dirs: { ...c.dirs } }
  if (!isAll) for (const t of copied) next.dirs[t.key] = to
  if (!writeStoreConfig(next)) {
    return { ok: false, error: '新位置已复制好，但配置没写成（指针文件写不进去）。' }
  }

  // ★ 立刻让路径缓存失效 —— 从这一行起，读写都去新目录。
  //   不失效的话，跑着的进程会继续往旧盘写，那段改动重启后就丢了。
  invalidateDataDir()

  // 5) 删原件（删不掉不算失败）
  const kept = []
  for (const t of copied) {
    try { unlinkSync(join(t.from, t.name)) } catch { kept.push(t.name) }
  }

  return {
    ok: true,
    moved: copied.map((t) => t.name),
    movedKeys: copied.map((t) => t.key),
    kept,
    to,
    scope: isAll ? '全部数据文件' : copied.map((t) => KEY_LABELS[t.key] || t.key).join('、'),
  }
}

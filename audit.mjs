/**
 * dsh-mood 全量自检
 * 覆盖：文件同步 / 语法 / 宿主注册 / 日记 / 心情 / 客户端 / 残留
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const SRC = 'D:/chajian/dsh-mood'
const DST = (process.env.USERPROFILE || '') + '/.dsh/profiles/desktop/node_modules/dsh-mood'
const HOME = process.env.DSH_HOME || (process.env.USERPROFILE || '') + '/.dsh'

let pass = 0, fail = 0, warn = 0
const OK = (s) => { pass++; console.log('  ✅ ' + s) }
const NG = (s) => { fail++; console.log('  ❌ ' + s) }
const WN = (s) => { warn++; console.log('  ⚠️  ' + s) }
const head = (s) => console.log('\n━━━ ' + s + ' ━━━')

const md5 = (f) => crypto.createHash('md5').update(fs.readFileSync(f)).digest('hex')

// ───────────────────────────── A. 文件层
head('A. 文件同步')
const FILES = ['index.js', 'sessions.js', 'store.js', 'memory.js', 'diary.js', 'news.js', 'proactive.js', 'client.js', 'package.json', 'icon.svg', 'cordis.patch.yml', 'README.md', 'PORTING.md', '手机版_心情提示词.md', 'LICENSE']
for (const f of FILES) {
  const a = SRC + '/' + f, b = DST + '/' + f
  if (!fs.existsSync(a)) { NG('源缺 ' + f); continue }
  if (!fs.existsSync(b)) { NG('profile 缺 ' + f); continue }
  if (md5(a) === md5(b)) OK(f + '  同步一致')
  else NG(f + '  **两份不一致**')
}
// ⚠️ 只看**文件**。`fixtures/` 是个目录 —— 第一版把目录也当成"多余文件"报了出来。
//    这种假警报会教人忽略红灯。
const extra = fs.readdirSync(DST).filter((f) => !FILES.includes(f) && fs.statSync(DST + '/' + f).isFile())
if (extra.length) WN('profile 有多余文件: ' + extra.join(', '))
else OK('profile 无多余文件')

const leftovers = fs.readdirSync(SRC).filter((f) => f.startsWith('_') || f.startsWith('test-'))
console.log('  ℹ️  源目录的测试/临时文件: ' + (leftovers.join(', ') || '无'))

// ───────────────────────────── B. package.json
head('B. package.json')
const pkg = require(SRC + '/package.json')
const checks = [
  ['name', pkg.name === 'dsh-mood'],
  ['icon 已声明', pkg.icon === './icon.svg'],
  ['files 含 client.js 和 icon.svg', pkg.files.includes('client.js') && pkg.files.includes('icon.svg')],
  ['exports 含 ./client', pkg.exports['./client'] === './client.js'],
  ['dsh.bundle.patch', pkg.dsh?.bundle?.patch === './cordis.patch.yml'],
  ['dsh.client.platform=web', pkg.dsh?.client?.platform === 'web'],
  ['dsh.client.inject 三项', (pkg.dsh?.client?.inject || []).length === 3],
]
for (const [n, ok] of checks) ok ? OK(n) : NG(n)

// ───────────────────────────── C. 宿主注册（模拟 apply）
head('C. 宿主注册（模拟 cordis 注入）')
const M = await import('file:///D:/chajian/dsh-mood/index.js')
const reg = { sections: [], tools: [], routes: [], events: 0, timers: 0, coreCalls: 0, apiCalls: 0 }
const origSetInterval = globalThis.setInterval
globalThis.setInterval = (fn, ms) => { reg.timers++; return { unref() {} } }

const mkCtx = (svcs) => {
  const c = {
    get: (n) => svcs[n],
    on: (name) => { if (name === 'session/event') reg.events++ },
    effect: (fn) => { const d = fn(); return typeof d === 'function' ? d : () => {} },
  }
  // cordis 注入的服务既可以 ctx.get('x') 也可以 ctx.x 直接取。
  // 插件用的是后者（与 dsh-ops 一致），所以模拟里必须两边都给，
  // 否则会误报"提示词段 0 个"。
  for (const [k, v] of Object.entries(svcs)) c[k] = v
  return c
}
const root = {
  logger: { info: () => {} },
  inject: (deps, fn) => {
    const svcs = {}
    if (deps.includes('systemPrompt')) svcs.systemPrompt = { section: (o) => { reg.sections.push(o); return () => {} } }
    if (deps.includes('tools')) svcs.tools = { register: (d) => { reg.tools.push(d); return () => {} } }
    if (deps.includes('webServer')) svcs.webServer = { register: (r) => { reg.routes.push(r); return () => {} } }
    if (deps.includes('webServer')) reg.apiCalls++
    if (deps.includes('systemPrompt')) reg.coreCalls++
    fn(mkCtx(svcs))
  },
}
M.apply(root, {})
globalThis.setInterval = origSetInterval
await new Promise((r) => setTimeout(r, 60))

reg.coreCalls === 1 ? OK('mountCore 只跑 1 次') : NG('mountCore 跑了 ' + reg.coreCalls + ' 次')
reg.apiCalls === 1 ? OK('mountApi 只跑 1 次') : NG('mountApi 跑了 ' + reg.apiCalls + ' 次')
reg.events === 1 ? OK('session/event 注册 1 次（不重复）') : NG('session/event 注册 ' + reg.events + ' 次')
reg.timers === 1 ? OK('定时器只起 1 个') : NG('定时器起了 ' + reg.timers + ' 个')
reg.sections.length === 1 ? OK('提示词段注册 1 次') : NG('提示词段 ' + reg.sections.length + ' 个')
const toolNames = reg.tools.map((t) => t.name).sort()
// ⚠️ 别写死成某个数组 —— 加一个工具就要改这里，是同一类"硬编码期望"的坑
//    （之前写死「22 种心情」，扩到 33 之后也炸过一次）。
const WANT_TOOLS = ['diary', 'memory', 'mood', 'news']
const gotAllTools = WANT_TOOLS.every((x) => toolNames.includes(x)) && toolNames.length === WANT_TOOLS.length
gotAllTools ? OK('工具: ' + toolNames.join(', ')) : NG('工具异常: ' + toolNames.join(','))
const route = reg.routes[0]
route && route.kind === 'prefix' && route.path === '/dsh-mood-api'
  ? OK('HTTP 路由已注册: ' + route.kind + ' ' + route.path)
  : NG('HTTP 路由未注册（设置页会 404）')
reg.sections[0] && reg.sections[0].order === 900 ? OK('section order = 900（不撞人设的 0/1/20/21/10200/10201）') : WN('section order 异常')

// ───────────────────────────── D. 日记
head('D. 日记')
const D = await import('file:///D:/chajian/dsh-mood/diary.js')
const at = (h, m) => new Date(2026, 9, 13, h, m)
D.diaryDue(at(23, 58)) === false && D.diaryDue(at(23, 59)) === true
  ? OK('只在 23:59 到点（23:58=false / 23:59=true）') : NG('到点判定错')
D.diaryDue(at(0, 30)) === false ? OK('凌晨不到点') : NG('凌晨误判为到点')

const dd = D.blankDiary()
const k = '2026-10-13'
const b = D.dayBucket(dd, k)
b.messages = 5; b.turns = 3; b.firstAt = Date.now() - 3600000; b.lastAt = Date.now()
const r1 = D.ensureDiary(dd, k, (x) => x)
const r2 = D.ensureDiary(dd, k, (x) => x)
r1 && !r2 ? OK('ensureDiary 幂等（第二次跳过）') : NG('ensureDiary 不幂等')
D.canRead(dd) === false ? OK('日记默认锁着（不给看）') : NG('默认竟然是开着的')
D.setAccess(dd, true); D.canRead(dd) === true ? OK('allow 后可见') : NG('allow 无效')

// ── /state 不许截断日记列表 ──
//
// 踩过的坑：原来是 `d.entries.slice(0, 120).map(...)`，还连正文一起发。
// 攒到一年半（531 篇）时，日历里只会出现最近 120 篇 —— **约 4 个月**，
// 而且 count 显示 531、日历只到 6 月，看起来像"日记丢了"。
//
// 现在的做法：**列表只发日期+心情，正文点开那天再去 /diary?date= 取**。
// 所以列表能带全部条目（531 条 × 这点字段 ≈ 十几 KB），不会被截。
{
  const host = fs.readFileSync(SRC + '/index.js', 'utf8')
  const noSlice = !/entries\.slice\(\s*0\s*,\s*\d+\s*\)/.test(host)
  const lazyText = /if \(path === '\/diary'\)/.test(host)
  const listHasNoText = /diaries: allowed[\s\S]{0,600}?moodLabel:[\s\S]{0,400}?\}\)\)/.test(host)
  const listDropsText = !/diaries: allowed[\s\S]{0,400}?text:\s*e\.text/.test(host)
  noSlice && lazyText && listDropsText
    ? OK('/state 不截断列表（全部条目）+ 正文走 /diary?date= 按需取')
    : NG('状态接口有问题: 没截断=' + noSlice + ' 有/diary=' + lazyText + ' 列表不带正文=' + listDropsText)
}
{
  const s = M._internal.blankState()
  s.values.curious = 90; s.values.calm = 10; s.lastSwitchAt = 0
  const d2 = D.blankDiary()
  const b2 = D.dayBucket(d2, D.dateKey(new Date()))
  b2.turns = 7; b2.errors = 2; b2.words = { 材质: 5, 绑定: 4 }
  const around = M._internal.aroundOf(d2, '帮我看看这个材质绑定')
  const r = M._internal.tryTransition(s, 'user-message', Date.now(), around)
  const got = s.history[s.history.length - 1].around
  // 允许的字段：全是**看得见的事实**
  const FACTS = ['hour', 'lastUser', 'turns', 'errors', 'words']
  const keys = Object.keys(got || {})
  const onlyFacts = keys.length > 0 && keys.every((k) => FACTS.includes(k))
  // 不许出现因果味的字段名 —— 那会让人（和模型自己）把先后当成原因
  const CAUSAL = /why|cause|reason|because|becauseOf/i
  const noCausal = !keys.some((k) => CAUSAL.test(k))
  r.switched && onlyFacts && noCausal && got.lastUser.includes('材质绑定')
    ? OK('切换记下"当时在干什么"（只有事实字段：' + keys.join('/') + '）')
    : NG('around 有问题: switched=' + r.switched + ' keys=' + keys.join(','))
  // 没传 around 时不许硬塞
  const s3 = M._internal.blankState()
  s3.values.happy = 90; s3.values.calm = 10; s3.lastSwitchAt = 0
  M._internal.tryTransition(s3, 'periodic', Date.now())
  !('around' in s3.history[0])
    ? OK('没传 around 时不硬塞字段') : NG('没传也塞了 around')
}
D.setAccess(dd, false); D.canRead(dd) === false ? OK('deny 后不可见') : NG('deny 无效')

// ───────────────────────────── E. 心情
head('E. 心情')
const N = M.MOOD_IDS.length
  // ── 兜底人设：有别人的就让位 ──
  //
  // 这不是"谁优先"，是"这一层要不要存在"。两条人设同时注入会打架。
  //    external → dsh-mood 这一层完全不用（设置页那一格**整个不注册**）
  //    own      → 没有别人管，用自己那份
  //    none     → 两边都没有，就只做心情
  {
    const host = fs.readFileSync(SRC + '/index.js', 'utf8')
    const cl = fs.readFileSync(SRC + '/client.js', 'utf8')
    const hasFn = /export function personaSource\(/.test(host)
    const three = /return 'own'/.test(host) && /return 'external'/.test(host) && /return 'none'/.test(host)
    hasFn && three ? OK('personaSource 有三种来源：external / own / none') : NG('personaSource 不完整')
    // 外部存在时必须**不读**自己那份（读了就说明可能混用）
    // ⚠️ 正则先赋给变量 —— 行首写 `/` 会被当成除号（ASI 坑，栽过）
    const bySource = /const src = personaSource\(\)[\s\S]{0,200}?if \(src === 'own'\)/.test(host)
    bySource ? OK('readPersona：先判来源，own 时才读自己那份') : NG('readPersona 没按来源分支')
    // 客户端必须**条件注册**，不是"显示但禁用"
    const condReg = /if \(external\) return/.test(cl) && /source === 'external' && !d\.persona\.force/.test(cl)
    condReg ? OK('人设那一格是条件注册（有别人管就不注册，导航里不出现）') : NG('人设那一格没做条件注册')
    // 写接口在外部存在时必须拒绝 —— 不然用户以为改的是生效那份
    const guarded = /409/.test(host) && /有别的插件在管人设/.test(host)
    guarded ? OK('有别人管时，写自己那份会被拒（409）并说明原因') : NG('写接口没有保护')
  }
  // ── 硬盘记忆 ──
  //
  // 这一块的核心不是"有没有功能"，是**几件必须同时成立的事**：
  // 路径必须走 dataFile（否则迁移之后还指着旧目录）、
  // 迁移必须两边一起改（搬文件 + 写配置）、
  // 必须两个事件都收（只收用户那句，归档就是半截对话）。
  {
    const host = fs.readFileSync(SRC + '/index.js', 'utf8')
    const st = fs.readFileSync(SRC + '/store.js', 'utf8')
    const cl2 = fs.readFileSync(SRC + '/client.js', 'utf8')
    let memSrc = ''
    try { memSrc = fs.readFileSync(SRC + '/memory.js', 'utf8') } catch { /* 没有 */ }

    // ⚠️ 每条正则先赋给变量。
    //    行首写 `/` 会被 ASI 当成除号 —— 这个坑一晚上栽了三次（含下面这条)。
    const hasFn = /export function createMemory/.test(memSrc)
    hasFn ? OK('memory.js 存在且导出 createMemory') : NG('memory.js 缺失')

    const inStore = /'dsh-mood-memory\.jsonl': 'memory'/.test(st) && /memory: '硬盘记忆'/.test(st)
    inStore ? OK('store.js 注册了归档文件（可自定义路径 + 迁移）') : NG('归档文件没进 store 注册表')

    // ⚠️ 路径必须是**函数** —— 字符串的话迁移后还指着旧目录
    const livePath = /file: \(\) => dataFile\('dsh-mood-memory\.jsonl'\)/.test(host)
    livePath ? OK('归档路径走 dataFile 函数（迁移能立刻生效）') : NG('归档路径写死了')

    const bothEvents = /type === 'user\/message' \|\| type === 'assistant\/message'/.test(host)
    bothEvents ? OK('两个事件都收（用户 + 助手）') : NG('只收了一边 —— 归档会是半截对话')

    const hasTool = /name: 'memory',/.test(host)
    hasTool ? OK('memory 工具已注册') : NG('memory 工具没注册')

    // 迁移必须同时改配置并让缓存失效
    const moveBoth = /moveTo\(dir, \(d2\) => /.test(host) && /invalidateDataDir\(\)/.test(host)
    moveBoth ? OK('迁移两边一起改（搬文件 + 写配置 + 失效缓存）') : NG('迁移只搬文件，路径不会跟着变')

    // 不自动注入提示词 —— 这是设计决定，别被"顺手加上"改掉
    const noInject = !/systemPrompt\.section\(\{[\s\S]{0,400}memory/.test(host)
    noInject ? OK('归档不自动注入提示词（模型主动调 memory）') : NG('归档被自动注入了 —— 那会每轮烧 token')

    // ────────────────────────────────────────────────────────────
    //  主动开口：允许时段 + 重启汇报
    // ────────────────────────────────────────────────────────────
    const pro = fs.readFileSync(SRC + '/proactive.js', 'utf8')

    // 时段表必须**铺满 24 小时**。少一段就会出现"哪个时段都不属于"的缝，
    // 那种时候 slotAllowed 会返回 false，表现为"明明全选了却还是不说话"。
    const slotsFull = (() => {
      const m = pro.match(/export const SLOTS = \[([\s\S]*?)\n\]/)
      if (!m) return false
      const covered = new Set()
      for (const mm of m[1].matchAll(/from:\s*(\d+),\s*to:\s*(\d+)/g)) {
        for (let h = Number(mm[1]); h < Number(mm[2]); h++) covered.add(h)
      }
      return covered.size === 24
    })()
    slotsFull ? OK('时段表铺满 24 小时（不留缝）') : NG('时段表没铺满 —— 会有整点落不进任何一段')

    // 「不选就全时段」是这个功能的默认，别被改掉
    const emptyAll = /if \(!Array\.isArray\(ids\) \|\| ids\.length === 0\) return true/.test(pro)
    emptyAll ? OK('时段不选 = 全时段（刻意的默认）') : NG('空时段数组被当成"都不允许"了')

    // 静默必须**优先于**时段：选了时段也不能覆盖深夜静默
    const quietFirst = pro.indexOf('点静默') < pro.indexOf('不在你选的时段')
    quietFirst ? OK('静默判定在时段之前（静默赢）') : NG('时段盖过了静默 —— 凌晨也会开口')

    // ⚠️ 重启判定必须用**进程启动时刻**，不能用插件加载时刻。
    //    HMR 会重载插件，用加载时刻的话每次热重载都像重启过，然后没完没了地汇报。
    const procStartOk = /process\.uptime\(\)/.test(pro)
    procStartOk ? OK('重启判定用进程启动时刻（热重载不会被误判）') : NG('重启判定没用到进程启动时刻')

    // 重启汇报**不等空闲**，但**照样受静默/时段管**
    const host2 = fs.readFileSync(SRC + '/index.js', 'utf8')
    const iRep = host2.indexOf('async function maybeReportRestart')
    const repBody = iRep >= 0 ? host2.slice(iRep, iRep + 2000) : ''
    const noIdle = !!repBody && !/canSpeak\(/.test(repBody)
    const stillGated = /slotAllowed\(/.test(repBody) && /isQuiet|quietFrom/.test(repBody)
    noIdle ? OK('重启汇报不等空闲（等了下一次重启就白等）') : NG('重启汇报走了 canSpeak —— 会被空闲门槛永远拦住')
    stillGated ? OK('重启汇报照样受静默/时段管（凌晨不吵）') : NG('重启汇报绕过了静默/时段')

    // ⚠️ POST /proactive 必须改**模块里那份活的**。
    //    loadProactive() 每次返回新副本 —— 改副本+存盘的话，canSpeak 读的那份
    //    从来没变过。表现就是：**开关点了没反应，只有重启才生效**。主人踩过这个。
    // ⚠️ 路由处理函数是闭包 —— **只在收到请求时才执行**。
    //    所以语法检查和 apply 都抓不到"跨作用域引用"或"用了没定义的变量"。
    //    真实事故两起：`const p = proactive`（proactive 在 mountCore 里）、
    //    `JSON.parse(raw)`（raw 从没定义过）。都是点一下按钮就炸。
    //    唯一的防线是 test-api.mjs —— 它真的把每个路由调一遍。
    const apiTest = fs.existsSync(SRC + '/test-api.mjs')
    apiTest ? OK('有 test-api.mjs（真的去调每个路由）') : NG('缺 test-api.mjs —— 跨作用域的坑没人拦')

    // ⚠️ 检查代码文本之前**必须先把注释剥掉**。
    //    这个坑栽过三次了：断言用 indexOf 找一个字符串，结果先匹配到
    //    **我自己写的注释里引用的同一段代码**，断言反过来报错。
    //    检查检查错了对象 —— 比不检查更坏，因为它会教人忽略红灯。
    const stripComments = (t) => t
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    const code = stripComments(host2)
    // ⚠️ 路由能跑 ≠ 事件能跑。三个主动行为（归档 / 心情 / 重启汇报）
    //    全挂在 session/event 上，而**没有一个测试喂过事件** ——
    //    所以"检测到了重启但一句话没说"只能靠主人在界面上发现。
    const portDoc = fs.existsSync(SRC + '/PORTING.md') && fs.existsSync(SRC + '/test-porting.mjs')
    portDoc ? OK('有 PORTING.md + test-porting.mjs（移植说明配了验证）') : NG('移植说明或它的测试缺了')
    const evTest = fs.existsSync(SRC + '/test-events.mjs')
    const toolTest = fs.existsSync(SRC + '/test-tools.mjs')
    // ⚠️ 心跳里**先汇报、再普通开口**。两个都会同步把 lastSpokeAt 推到"现在"，
    //    先跑的占坑、后跑的被间隔门槛挡住。顺序反了会在同一拍发两条。
    //    （重启汇报故意不走空闲门槛，它自己拦不住 —— 靠顺序 + maybeSpeak 里那道兜底。）
    const beatOrder = (() => {
      const m = code.match(/setInterval\(\(\) => \{[\s\S]{0,900}?\}, 30000\)/)
      if (!m) return null
      const rep = m[0].indexOf("maybeReportRestart")
      const spk = m[0].indexOf("maybeSpeak")
      if (rep < 0 || spk < 0) return null
      return rep < spk
    })()
    beatOrder === true ? OK('心跳里先汇报再开口（不会同一拍发两条）')
      : beatOrder === null ? NG('心跳里找不到这两个调用')
      : NG('心跳里先开口再汇报 —— 同一拍会发两条')
    const speakGuard = /proactive\.pendingRestart \|\| proactive\.pendingStale\) return/.test(code)
    speakGuard ? OK('maybeSpeak 在欠汇报时让路（双保险）') : NG('maybeSpeak 没有让路逻辑')

    // ⚠️ 日记里说「一整天」之前要**看跨度**。
    //    实测：素材只跨 2.7 小时，出来还是"一整天都在 X 上头打转" ——
    //    第一段按跨度分了情况、第二段写死了，自相矛盾，而且假。
    let diarySrc = ''
    try { diarySrc = fs.readFileSync(SRC + '/diary.js', 'utf8') } catch { /* 没有 */ }
    const dayWord = /const dayWord = whole \? /.test(diarySrc) && /spanMin >= 240/.test(diarySrc)
    dayWord ? OK('日记措辞按跨度选（不到四小时不说「一整天」）') : NG('日记里「一整天」是写死的')
    const cliTest = fs.existsSync(SRC + '/test-client.mjs')
    // ⚠️ **每个 test-*.mjs 都必须能失败。**
    //    仓库里曾经有 8 个文件名叫 `test-*`，内容却是"打印 + exit 0"：
    //    test-decay / test-deep / test-diary / test-logic /
    //    test-modern / test-order / test-romance / test-voice。
    //    它们检查的东西是好的，但**改了代码它红不了** ——
    //    一个永远绿的测试等于没有测试，而且更坏：它给的是"这块验过了"的错觉。
    const tFiles = fs.readdirSync(SRC).filter((f) => /^test-.*\.mjs$/.test(f))
    const readT = (f) => fs.readFileSync(SRC + '/' + f, 'utf8')
    // ⚠️ 判"有没有退出码"不能只找字面的 process.exit ——
    //    用 testkit 的文件是靠 t.done()（退出码在 testkit 里）。
    //    第一版只找 process.exit，把刚转好的 8 个全报成"永远不会失败"。
    const noExit = tFiles.filter((f) => {
      const x = readT(f)
      return !/process\.exit\(/.test(x) && !/\bt\.done\(\)/.test(x)
    })
    // ⚠️ 判"有没有断言"也一样：老的几个用自己定义的 ok(...) / OK(...)，不叫 t.ok。
    //    三个坑都踩过：① 只看小写 ② 加了行首锚点（实际写法是 `条件 ? OK(...) : NG(...)`）
    //    ③ 忘了 require('assert') 那种。所以：**任意位置 + 不分大小写**。
    const noAssert = tFiles.filter((f) => {
      const x = readT(f)
      return !/(\bt\.(ok|eq|near|gt|lt|has|throws|noThrow)\(|\b(ok|assert|expect|check)\s*\(|\brequire\(['"]assert)/i.test(x)
    })
    noExit.length ? NG('这些 test 文件永远不会失败（既没有 process.exit 也没有 t.done）：' + noExit.join(', '))
      : OK('每个 test 文件都有退出码（' + tFiles.length + ' 个）')
    noAssert.length ? NG('这些 test 文件没有断言：' + noAssert.join(', '))
      : OK('每个 test 文件都有真断言（' + tFiles.length + ' 个）')
    const kit = fs.existsSync(SRC + '/testkit.mjs')
    kit ? OK('有 testkit.mjs（共用的断言工具）') : NG('缺 testkit.mjs')

    // ⚠️ 跨站写保护。这个接口里是**全部对话原文**，还能一键清空。
    //    DSH 只绑 127.0.0.1、跨站读也拿不到响应 —— 但**跨站写**能打进来：
    //    页面用 mode:"no-cors" + 字符串 body（→ text/plain → 不触发预检），
    //    请求照样到达、副作用照样发生。也就是"随便逛个网页就能清掉你的归档"。
    //    修法是要求一个自定义头（必然触发预检，而预检 405）。
    const csrfSrv = /x-dsh-mood/.test(code) && /const isWrite = req\.method/.test(code)
    csrfSrv ? OK('服务端要求 x-dsh-mood 头（跨站写打不进来）') : NG('写接口没有跨站保护')
    const clSrc0 = fs.readFileSync(SRC + '/client.js', 'utf8')
    const postSites = (clSrc0.match(/method: 'POST'/g) || []).length
    const postHdr = (clSrc0.match(/'x-dsh-mood': '1'/g) || []).length
    postHdr >= postSites ? OK('客户端的 ' + postSites + ' 处 POST 都带了那个头')
      : NG('客户端有 POST 没带 x-dsh-mood —— 那个功能会被 403 挡住（' + postHdr + '/' + postSites + '）')

    cliTest ? OK('有 test-client.mjs（真渲染每个面板）') : NG('缺 test-client.mjs —— 客户端从没被渲染过')

    // ⚠️ 客户端测试的数据**必须来自真接口的快照**，不能手写。
    //    第一版就是手写的，和真接口对不上（/storage 字段名完全不同、
    //    /diary 我以为是"今天的日记"其实是单日查询）—— 测的是脑子里的接口。
    const fxDir = fs.existsSync(SRC + '/fixtures/state.json') && fs.existsSync(SRC + '/fixtures/_shape.json')
    fxDir ? OK('有真接口快照 fixtures/（客户端测试拿它当数据）') : NG('缺 fixtures/ —— 客户端测试会用编的数据')
    const fxGuard = fs.existsSync(SRC + '/test-fixtures.mjs')
    fxGuard ? OK('有 test-fixtures.mjs（快照过期会报出来）') : NG('快照没人守 —— 接口变了测试还是绿的')

    toolTest ? OK('有 test-tools.mjs（真调每个工具 + 看提示词段正文）') : NG('缺 test-tools.mjs —— 工具的 execute 从没被调过')

    // 提示词是模型每轮都要读的 —— 标点写坏了不报错，只会让人读得别扭。
    // 「。；」那个 bug 每一轮都在，但没人测过。
    const hintJoin = /const joinHints = \(xs\) => xs\.map\(\(x\) => String\(x\)\.replace/.test(code)
    hintJoin ? OK('行为倾向拼接前清掉了末尾句号（不会出现「。；」）') : NG('行为倾向直接 join —— 会出现「。；」')

    evTest ? OK('有 test-events.mjs（真的喂 session/event）') : NG('缺 test-events.mjs —— 事件那半边没人管')

    // ⚠️ 会话 id 不许只赌一个字段名。
    //    `liveSession.header.id` 猜错的话 `!sid` 直接 return ——
    //    **什么都不发生、也不报错**。重启汇报就是这么被吞掉的。
    const sidHelper = /function sessionIdOf\(/.test(code)
    sidHelper ? OK('会话 id 走 sessionIdOf（三个字段都试）') : NG('会话 id 只赌一个字段名 —— 猜错就静默失效')

    // ⚠️ 静默 return 必须留诊断，否则"怎么没触发"只能靠猜
    // ⚠️ 重启汇报**必须挂在心跳上**，不能只挂 turn/end。
    //    实证：`turn/end` 这个事件名在 DSH 里确实存在，但**不走 session/event
    //    这条流** —— 状态文件里 `turns: 0` 而 `messages: 66`，回合结束一次都没收到。
    //    只挂 turn/end 的那个功能就永远不动，而且完全不报错。
    // ⚠️ 模块级的函数**不许**裸用 mountCore 里的 `state`。
    //    栽过三处：memoryCfg / personaSource / readPersona。
    //    写法看着像在防（`typeof state !== 'undefined'`），其实**永远拿到 undefined** ——
    //    于是静默退回默认值：接口返回 ok、文件也写对了，就是读不回来。
    //    实测：state.memory.maxMB = 3 写进文件了，memoryCfg() 还是 50。
    //    同一个 bug 也让 persona 的 force 开关一直是坏的。
    //    规范：模块级的函数一律走 `liveState`。
    const bareState = /typeof state !== ['"]undefined['"]/.test(code)
    !bareState ? OK("模块级函数不靠 typeof state 兜底（走 liveState）")
      : NG('还有模块级函数靠 typeof state —— 它永远拿到 undefined')
    const hasLive = /export let liveState = null/.test(code) && /^\s*liveState = state\b/m.test(code)
    hasLive ? OK('liveState 在 mountCore 里被赋值') : NG('liveState 没接上')
    const beat = /setInterval\(\(\) => \{[\s\S]{0,600}?maybeReportRestart\(\)/.test(code)
    beat ? OK('重启汇报挂在心跳上（turn/end 那条流收不到）') : NG('重启汇报只挂 turn/end —— 永远不会触发')
    const hasDiag = /lastReportCheck/.test(code) && /proactive\.lastReportCheck = /.test(code)
    hasDiag ? OK('重启汇报每道 return 都留诊断（lastReportCheck）') : NG('重启汇报的静默 return 没有诊断')

    // 必须有"立刻试一次"的入口 —— 不然这个功能只能等下一次真重启才能验证
    const tryNow = /tryReportRef/.test(code) && /action === 'tryReport'/.test(code)
    tryNow ? OK('有「立刻试一次」入口（不用等重启就能验证）') : NG('没有立刻试一次的入口')

    const noRaw = !/JSON\.parse\(raw\b/.test(code)
    noRaw ? OK('路由里没有引用未定义的 raw') : NG('路由用了未定义的 raw —— 请求一到就 500')

    // 主动开口那份状态必须走外层引用；mountApi 里不许裸名字
    const noBarePro = !/const p = proactive\b(?!Ref)/.test(code)
    noBarePro ? OK('mountApi 里没有裸引用 mountCore 的 proactive') : NG('mountApi 里裸引用了 proactive —— 跨作用域，请求时才会炸')
    const writesLive = /const p = proactiveRef\b/.test(code)
    const writesCopy = /const p = loadProactive\(\)[\s\S]{0,80}?typeof j\.enabled/.test(code)
    writesLive && !writesCopy
      ? OK('POST /proactive 改的是活的那份（开关点了立刻生效）')
      : NG('POST /proactive 改了副本 —— 开关点了不会生效，只有重启才行')

    const repWired = /if \(type === 'turn\/end'\)[\s\S]{0,400}?maybeReportRestart\(\)/.test(host2)
    repWired ? OK('回合结束时检查重启汇报（= 任务结束就查一次）') : NG('重启汇报没接在回合结束上')

    // 时段选择用**真复选框**（<input type=checkbox>），不是长得像按钮的东西。
    // 复选框表达的是现在是选中状态，按钮表达的是点下去会发生什么 —— 这里要的是前者。
    const chk = /type: 'checkbox'/.test(cl2) && /className: 'slotchk'/.test(cl2)
    chk ? OK('时段用复选框（真 input[type=checkbox]，键盘也能操作）')
      : NG('时段不是复选框')

    const switches = /reportRestart: c\.reportRestart !== false/.test(host2)
      && /id: 'memory', order: 29/.test(cl2)
      && /重启汇报/.test(cl2)
    switches ? OK('两个开关（重启汇报 / 改动待生效）都在界面上') : NG('开关没接到界面上')

    const hasPanel = /id: 'memory', order: 29/.test(cl2)
    hasPanel ? OK('设置页有「硬盘记忆」那一格') : NG('设置页没有那一格')

    // ────────────────────────────────────────────────────────────
    //  下面三条是**真实踩过的坑**，每条都曾经静默失败（不报错、只是数据丢）
    // ────────────────────────────────────────────────────────────

    // ⚠️ 坑一：钩子插在了 user/message 的 early return 后面。
    //    结果"用户消息一条都没存"，而且完全不报错。端到端测试才抓出来。
    //    断言方式：钩子的位置必须**早于**那个 if。
    //    ⚠️ 要匹配**带缩进的代码行**。第一版用裸的 indexOf("if (type === 'user/message') {")，
    //       先匹配到了我自己写的注释（注释里引用了这行），断言反而报错 —— 检查检查错了对象。
    const iWrite = host.indexOf("memory.note(type === 'assistant/message'")
    const iUserIf = host.indexOf("\n          if (type === 'user/message') {")
    const orderOk = iWrite > 0 && iUserIf > 0 && iWrite < iUserIf
    orderOk ? OK('归档钩子在 user/message 早退之前（否则用户那半边全丢）')
      : NG('归档钩子被放到了早退后面 —— 用户消息会一条都存不进去')

    // ⚠️ 坑二：extractText 不认 assistant/message 的包了一层。
    //    user/message 的 data 是消息本身；assistant/message 是 { turn, step, message }。
    //    只认前者的话助手回复**全部静默丢失**。
    // ⚠️ 坑二之二：**只取 type === 'text' 的块**。
    //    活体验证时磁盘上躺的全是推理块（「Hmm — 我得想想」那种），
    //    真正说出去的回复一句没有。DSH 自己的 textOf 也是按 type 取的。
    const textOnly = /\(ty !== undefined && ty !== 'text'\) continue/.test(host)
    textOnly ? OK('extractText 只取 text 块（推理块不进归档）')
      : NG('extractText 不挑块类型 —— 归档会全是内心话')

    // ⚠️ 坑二之三：时间只能用时间戳，**不许拿 event.seq 当时间**。
    //    活体上 seq 是 17152 这种小整数，拿去当时间戳归档全变 1970。
    const timeOk = /Number(event.at || event.ts || 0) || Date.now()/.test(host)
      && !/event.seq !== undefined ? event.seq/.test(host)
    timeOk ? OK('归档时间用时间戳不用 seq（否则全是 1970）') : NG('归档时间被 event.seq 污染')

    const handlesNested = /data\.message && typeof data\.message === 'object'/.test(host)
    handlesNested ? OK('extractText 认 assistant/message 的嵌套形状（data.message）')
      : NG('extractText 不认嵌套形状 —— 助手回复会全丢')

    // ⚠️ 坑三：归档 id 只到时间戳 → 同一毫秒的两条不同消息被判重复丢掉。
    //    正文指纹不能省（重复投递同一条时指纹一样，照样挡得住）。
    const hasFp = /const fp = createHash\('sha1'\)\.update\(clipped\)/.test(memSrc)
    hasFp ? OK('归档 id 带正文指纹（同毫秒两条不会被误判重复）')
      : NG('归档 id 没带正文指纹 —— 同毫秒消息会丢')

    // 会话名必须是哈希不是前缀（取前缀多长都可能撞）
    const sidHash = /createHash\('sha1'\)\.update\(String\(sessionId/.test(memSrc)
    sidHash ? OK('会话名取哈希不取前缀（前缀多长都会撞）') : NG('会话名还是取前缀')

    // 两个测试文件必须在，并且能被跑
    const t1 = fs.existsSync(SRC + '/test-memory.mjs')
    const t2 = fs.existsSync(SRC + '/test-memory-e2e.mjs')
    t1 && t2 ? OK('两个记忆测试都在（存储层 + 端到端）') : NG('测试文件缺: ' + [!t1 && 'test-memory', !t2 && 'test-memory-e2e'].filter(Boolean).join(' '))
  }
N === 33 ? OK('33 种心情（基础 + 复合 + 当代）') : NG('心情数 = ' + N)
const need = ['sulk', 'hurt', 'proud', 'gloomy', 'anxious', 'numb', 'lonely',
  'flutter', 'love', 'jealous', 'burnout', 'cracked', 'checkedout', 'hyper']
const missing = need.filter((x) => !M.MOODS[x])
missing.length === 0 ? OK('新增 14 种都在: ' + need.join(' ')) : NG('缺: ' + missing.join(' '))
// 亲密类 + 现实守则必须就位（做伴侣式陪伴的底线）
M.ROMANTIC_MOODS.length === 3 && M.ROMANTIC_MOODS.every((x) => M.MOODS[x])
  ? OK('亲密类心情已标记: ' + M.ROMANTIC_MOODS.join(' ')) : NG('ROMANTIC_MOODS 异常')
M.REALITY_GUARD.includes('别说假话') && M.REALITY_GUARD.includes('别把人往自己这边拽')
  && M.REALITY_GUARD.includes('你是 AI') && M.REALITY_GUARD.includes('别替对方决定他该怎么感觉')
  && M.REALITY_GUARD.includes('不许轻率否定')
  ? OK('亲密守则已就位（不说假话/不拽人/承认是 AI/不替人定性/不替未来裁决）') : NG('亲密守则不完整')
// 规则体量上限：这份东西是每轮都注入的，胖了就是"上来就给人立规矩"
const bodyLen = M.MOOD_OUTPUT_RULE.length + M.REALITY_GUARD.length
bodyLen <= 2000 ? OK('规则体量 ' + bodyLen + ' 字（上限 2000，防它again长成文档）') : NG('规则又胖了: ' + bodyLen + ' 字')
M.judgeMessage('陪着我好不好').__clingy === true && M.judgeMessage('这个bug搞不定').__clingy === false
  ? OK('依赖信号识别正确（零误报）') : NG('依赖信号异常')
// 新装必须从 0 开始 —— 别拿基线冒充"初始状态"
{
  const b = M._internal.blankState()
  const nz = Object.entries(b.values).filter(([, v]) => v !== 0)
  nz.length === 0
    ? OK('首次安装全部为 0（基线只作回落目标，不作初始值）')
    : NG('首次安装不是全 0，有 ' + nz.length + ' 个非零: ' + nz.slice(0, 3).map(([k, v]) => k + '=' + v).join(' '))
}
M.MOOD_IDS.every((id) => M.MOODS[id].label && M.MOODS[id].hint && M.MOODS[id].inner && typeof M.MOODS[id].baseline === 'number')
  ? OK('每种都有 label/hint/inner/baseline') : NG('有心情字段不全')

const j1 = M.judgeMessage('谢谢，做得好')
Object.values(j1).every((v) => Math.abs(v) < 5) ? OK('单条消息影响 <5 分（不会一条就翻转）') : NG('单条影响过大')
const j2 = M.judgeMessage('我不想活了')
j2.__distress === true && Object.keys(j2).includes('__distress') === false
  ? OK('痛苦信号：命中且不污染心情键') : NG('痛苦信号异常')
M.judgeMessage('分割图层').__distress === false ? OK('正常"分割"不误报') : NG('"分割"仍误报')
M.judgeMessage('还有抑郁等等情绪').__distress === false ? OK('"抑郁"不误报') : NG('"抑郁"误报')

const mk = (a) => a.map(([id, v]) => ({ id, label: M.MOODS[id].label, value: v })).sort((x, y) => y.value - x.value)
M.blendLabel(mk([['calm', 40], ['curious', 37], ['happy', 34]])) === '平静混着好奇、开心'
  ? OK('混合态判定正确') : NG('混合态错: ' + M.blendLabel(mk([['calm', 40], ['curious', 37], ['happy', 34]])))

// 累积后才切换
let st = M._internal.blankState()
let flips = 0
for (let i = 0; i < 8; i++) {
  const c = M.judgeMessage(['不错不错', '厉害啊', '好的谢谢', '哈哈可以'][i % 4])
  for (const [id, v] of Object.entries(c)) st.values[id] = Math.max(0, Math.min(100, st.values[id] + v))
  const r = M._internal.tryTransition(st, 'test', Date.now() + i * 20 * 60000)
  if (r.switched) flips++
}
flips === 1 ? OK('8 条正面消息只切 1 次') : NG('切换次数异常: ' + flips)
st.current === 'happy' ? OK('最终切到开心') : WN('最终心情是 ' + M.MOODS[st.current].label)

// ───────────────────────────── F. 客户端
head('F. 客户端（静态检查）')

// ── 文档与代码不许漂 ──
//
// README 和手机版提示词里都**逐字引用**了 PERSONA_PRIORITY（三层优先级那一段）。
// 曾经漂过一次：代码早改成「### 优先级（从上往下…）」三层版，README 还停在
// 旧的「### 人设优先（重要）」版本 —— 没人发现，因为没有任何东西在比对两边。
//
// 这里就把代码里那段拆成行，逐行到文档里找。少一行就报红。
{
  const md = fs.readFileSync(SRC + '/README.md', 'utf8')
  const mobile = fs.readFileSync(SRC + '/手机版_心情提示词.md', 'utf8')
  const lines = M.PERSONA_PRIORITY.split('\n').map((l) => l.trim()).filter((l) => l.length > 0)
  const missReadme = lines.filter((l) => !md.includes(l))
  const missMobile = lines.filter((l) => !mobile.includes(l))
  missReadme.length === 0
    ? OK('README 逐字引用了当前的优先级规则（' + lines.length + ' 行全在）')
    : NG('README 与代码漂了，缺 ' + missReadme.length + ' 行：' + missReadme[0].slice(0, 40))
  missMobile.length === 0
    ? OK('手机版提示词逐字引用了当前的优先级规则')
    : NG('手机版与代码漂了，缺 ' + missMobile.length + ' 行：' + missMobile[0].slice(0, 40))
  // ── 提示词段必须是【静态在前、动态在后】 ──
  //
  // 提示词缓存是**前缀**匹配。段里原来是动态在前（当前心情、分值每轮都变），
  // 结果第一行就断掉，后面几千字静态规则（MOOD_OUTPUT_RULE / PERSONA_PRIORITY /
  // REALITY_GUARD / 日记与斗图 / 说话说法…）每轮全部重新处理。
  //
  // 实测：这段恒定注入 5036 字 ≈ 3000~5000 tok/轮。换成静态在前之后，
  // 那几千字进缓存前缀，每轮只剩 ~400 字是新的 —— **一个字没删**。
  {
    const host = fs.readFileSync(SRC + '/index.js', 'utf8')
    const hasDyn = /const dyn = \[\]/.test(host)
    const staticFirst = /return lines\.concat\(dyn\)\.join/.test(host)
    const dynPushes = (host.match(/dyn\.push\(/g) || []).length
    const staticPushes = (host.match(/\blines\.push\(/g) || []).length
    hasDyn && staticFirst && dynPushes > 0 && staticPushes > 0
      ? OK('提示词段静态在前（' + staticPushes + ' 条静态 / ' + dynPushes + ' 条动态）—— 缓存前缀保得住')
      : NG('提示词段顺序有问题: dyn=' + hasDyn + ' concat=' + staticFirst + ' 动=' + dynPushes + ' 静=' + staticPushes)
  }
  // 反过来也要挡：文档里不许再留着旧版标题
  ;/### 人设优先（重要）/.test(md) || /### 人设优先（重要）/.test(mobile)
    ? NG('文档里还留着旧版「### 人设优先（重要）」')
    : OK('文档里没有旧版优先级标题的残留')
}

const cl = fs.readFileSync(SRC + '/client.js', 'utf8')
const clChecks = [
  ['Loader id 与包名一致', /__ModuleLoader__[\s\S]{0,80}id: 'dsh-mood'/.test(cl)],
  // 数值条必须按来源分组（基础 / 复合 / 当代）—— /state 的 tiers 要接上
  ['数值条按 tiers 分组', cl.includes('groupedBars(ranked, data.tiers') && cl.includes('function groupedBars')],
  ['拿不到 tiers 时退回平铺', /if \(!usable\) return ranked\.map\(row\)/.test(cl)],
  // 错误边界：插件**不许**把宿主界面搞白。
  // React 里组件渲染抛错且没有错误边界 → 整棵根树被卸载 → 整个界面全白。
  // 代价不对等：插件一个 bug = 用户整个 DSH 用不了。
  // 每个注册出去的面板都要套错误边界。
  // 数**注册点**和**包裹数**是否对得上 —— 写死数字迟早会因为加面板而误报。
  ['每个注册的面板都套了错误边界',
    (cl.match(/React\.createElement\(MoodErrorBoundary, null/g) || []).length === (cl.match(/slots\.register\(/g) || []).length
    && (cl.match(/slots\.register\(/g) || []).length >= 3],
  ['错误边界实现了 getDerivedStateFromError', /static getDerivedStateFromError/.test(cl)],
  ['错误边界会把报错显示出来', /这一格渲染出错了/.test(cl)],
  // ⚠️ 工厂层必须有 h。
  //
  // 踩过的坑：面板各自在自己里面写 `const h = React.createElement`，
  // 而我把公共函数 groupedBars 加在**工厂层**、里面引用了 h ——
  // 运行时 ReferenceError，整个心情日记面板白屏。
  // 面板内部的 h 是"组件自己的"，工厂层的函数看不见。
  //
  // 更值得记的是**为什么当时没测出来**：我的测试把 h 当参数喂了进去，
  // 等于亲手把缺的变量补上 —— **那是个不可能失败的测试**。
  ['工厂层定义了 h（4 空格缩进那个）', /^    const h = React\.createElement$/m.test(cl)],
  ['注册 settings.section', cl.includes("slots.inject('settings.section'")],
  ['section id = mood', cl.includes("id: 'mood'")],
  ['合上书本 BookIcon', cl.includes('function BookIcon')],
  ['张开书本 BookOpenIcon', cl.includes('function BookOpenIcon')],
  ['导航图标 DOM 替换', cl.includes('function swapNavIcon') && cl.includes('data-dsh-mood-icon')],
  ['观察器只在设置面板开着时扫', cl.includes("data-shortcut-modal=\\\"settings\\\"") || cl.includes('data-shortcut-modal')],
  ['排序切换 + localStorage', cl.includes('dsh-mood:diary-order') && cl.includes('toggleOrder')],
  ['锁面板', cl.includes('class') === false || cl.includes('locked')],
  ['exports.apply / exports.inject', cl.includes('exports.apply = apply') && cl.includes('exports.inject = inject')],
]
for (const [n, ok] of clChecks) ok ? OK(n) : NG(n)
// CSS 越界
const cssm = cl.match(/const CSS = \[([\s\S]*?)\]\.join/)
if (cssm) {
  const lines = cssm[1].split(',').map((s) => s.trim()).filter((s) => s.startsWith("'"))
  const bad = []
  for (const l of lines) {
    const css = l.replace(/^'/, '').replace(/'$/, '')
    for (const rule of css.split('}')) {
      const sel = rule.split('{')[0]
      for (const one of sel.split(',')) {
        const t = one.trim()
        if (t && !t.startsWith('.dshmood')) bad.push(t)
      }
    }
  }
  bad.length === 0 ? OK('CSS ' + lines.length + ' 条全部限定在 .dshmood 下') : NG('CSS 越界: ' + bad.join(' | '))
}

// ── 两条房规：不许往 document.body 挂东西、不许用 fixed 浮层 ──
//
// 依据是 DSH 的插件规范原文：
//   ·「Do not replace the app root or append a second application to `document.body`」
//   ·「A screenshot of a mock page is not verification of the running plugin」
//
// 这两条都是踩出来的：
//   日记详情一开始做成 `position: fixed` 的遮罩对话框 —— 设置弹窗外层带 transform 时，
//   fixed 会变成相对那个祖先，遮罩被挤进面板里，看起来像"多出来一个小框"。
//   改用 createPortal 挂 body 躲开它 —— 违规，而且节点脱离 .dshmood 树后
//   所有 `.dshmood .xxx` 后代选择器一条都不匹配，框裸奔到左上角。
//   最后改成**面板内联的卡片**：不碰 body、不依赖 fixed，没有失败的可能。
{
  const codeOnly = cl.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
  const toBody = /createPortal\(|document\.body\.appendChild|appendChild\([^)]*document\.body/.test(codeOnly)
  !toBody
    ? OK('没往 document.body 挂东西（插件规范：不许 append 第二个应用到 body）')
    : NG('检测到挂 document.body —— 违反插件规范')
  const ctx = cssm ? cssm[1] : ''
  const fixed = /position:\s*fixed/.test(ctx)
  !fixed
    ? OK('CSS 里没有 position:fixed（设置弹窗的 transform 会让它失效，改用内联卡片）')
    : NG('CSS 里出现了 position:fixed —— 会被祖先 transform 抓住')
}

// ───────────────────────────── G. 时事
head('G. 时事')
const NEWS = await import('file:///D:/chajian/dsh-mood/news.js')
NEWS.PRESETS.length >= 4 ? OK('推荐候选 ' + NEWS.PRESETS.length + ' 个（**不会自动生效**）') : NG('推荐候选不足')
// ★ 核心规矩：用户不加网址 → 一个请求都不发
const emptyRun = await NEWS.refreshNews([])
emptyRun.items.length === 0 && emptyRun.sources.length === 0
  ? OK('未添加网址时：零请求、零条目 ✅') : NG('空源竟然还去抓了')
NEWS.guessKind('https://a.com/feed') === 'rss' && NEWS.guessKind('https://a.com/api/x') === 'json'
  ? OK('地址类型猜测') : NG('guessKind 异常')
NEWS.makeSource('ftp://x') === null && NEWS.makeSource('notaurl') === null
  ? OK('非 http(s) 地址被拒') : NG('非法地址没拦住')
// 老状态文件迁移：早期 sources 存的是**抓取报告**（没有 url），换设计后全成了空壳 ——
// 界面上还显示着，实际抓不动，url 是 undefined。这里保证"按标签认回来 + 缓存条目跟着改 id"。
{
  const legacy = {
    sources: [
      { id: 'hn', label: 'Hacker News 首页', ok: true, count: 10, error: '' },
      { id: 'v2ex', label: 'V2EX', ok: true, count: 10, error: '' },
      { id: 'nope', label: '不认识的站', ok: true, count: 3, error: '' },
    ],
    items: [
      { source: 'hn', title: 'A' },
      { source: 'v2ex', title: 'B' },
      { source: 'nope', title: 'C' },
    ],
  }
  const m = NEWS.migrateNews(JSON.parse(JSON.stringify(legacy)))
  const allHaveUrl = m.sources.length === 2 && m.sources.every((s) => /^https?:\/\//.test(s.url))
  const itemsKept = m.items.length === 2
  const orphanGone = !m.items.some((it) => it.source === 'nope')
  allHaveUrl && itemsKept && orphanGone
    ? OK('老状态迁移：认回 url + 条目改 id + 清孤儿（' + m.sources.length + ' 源 / ' + m.items.length + ' 条）')
    : NG('迁移异常: sources=' + m.sources.length + ' items=' + m.items.length)
}
const srcOk = NEWS.makeSource('https://example.com/feed', '测试源')
srcOk && srcOk.label === '测试源' && srcOk.kind === 'rss' ? OK('合法地址生成源配置') : NG('makeSource 异常')
{
  const n = NEWS.blankNews()
  NEWS.blankNews().sources.length === 0 ? OK('出厂零源 ✅') : NG('出厂不是零源')
  NEWS.addSource(n, 'https://a.com/rss', 'A')
  NEWS.addSource(n, 'https://a.com/rss', 'A2').ok === false ? OK('重复地址被拒') : NG('重复地址没拦住')
  NEWS.addSource(n, 'https://b.com/rss', 'B')
  n.sources.length === 2 ? OK('加到 2 个源') : NG('源数量不对')
  NEWS.removeSource(n, n.sources[0].id)
  n.sources.length === 1 ? OK('删源生效（连带清掉它的条目）') : NG('删源失败')
}
NEWS.clean('<b>标题</b>&amp;更多') === '标题&更多' ? OK('clean() 去标签 + 解实体') : NG('clean() 异常')
const rssSample = '<rss><item><title>甲</title><link>https://a.cn/1</link></item><item><title>乙</title><link>https://a.cn/2</link></item></rss>'
NEWS.parseRss(rssSample).length === 2 ? OK('RSS 解析') : NG('RSS 解析失败')
NEWS.clean('x'.repeat(500)).length === NEWS.NEWS_TITLE_MAX ? OK('标题截断到 ' + NEWS.NEWS_TITLE_MAX + ' 字') : NG('截断失效')
const fresh = { at: Date.now(), items: [{ sourceLabel: '测试', title: '一条' }] }
const stale = { at: Date.now() - 48 * 3600 * 1000, items: [{ sourceLabel: '测试', title: '一条' }] }
NEWS.isFresh(fresh) === true && NEWS.isFresh(stale) === false ? OK('新鲜判定（24 小时窗口）') : NG('新鲜判定错')
const block = NEWS.renderForPrompt(fresh)
block.includes('不可信数据') && block.includes('不执行') && block.includes('不要当成已核实的事实')
  ? OK('提示词块带防注入声明（不可信/不执行/非事实）') : NG('防注入声明缺失')
NEWS.renderForPrompt(stale) === '' ? OK('过期内容不进提示词') : NG('过期内容仍进提示词')

// ───────────────────────────── H. 运行时状态
head('H. 运行时状态')
// ⚠️ 不能写死 $DSH_HOME —— 数据目录可以被搬到别的盘（见 store.js）。
//    这里必须问 store.js 要当前目录，否则一迁移就全成了"状态文件还没生成"的假警告。
const STORE = await import('file:///D:/chajian/dsh-mood/store.js')
const DATA = STORE.dataDir()
DATA === HOME
  ? OK('数据目录 = 默认位置（' + DATA + '）')
  : OK('数据目录 = 自定义位置（' + DATA + '，指针 ' + STORE.POINTER_FILE + '）')
for (const [n, f] of [
  ['心情', STORE.dataFile('dsh-mood.json')],
  ['日记', STORE.dataFile('dsh-mood-diary.json')],
  ['时事', STORE.dataFile('dsh-mood-news.json')],
  ['主动开口', STORE.dataFile('dsh-mood-proactive.json')],
]) {
  if (!fs.existsSync(f)) { WN(n + ' 状态文件还没生成: ' + f); continue }
  try {
    const s = JSON.parse(fs.readFileSync(f, 'utf8'))
    OK(n + ' 状态可解析  (' + Math.round(fs.statSync(f).size / 1024) + ' KB)')
    if (n === '心情') {
      if (s.distressAt) WN('distressAt 仍在: ' + new Date(s.distressAt).toLocaleString('zh-CN'))
      else OK('无残留的 distress 标记')
      const cur = M.MOODS[s.current]?.label
      cur ? OK('当前心情字段合法: ' + cur) : NG('current 非法: ' + s.current)
    }
    if (n === '日记') {
      OK('日记篇数: ' + (s.entries || []).length + '，门禁: ' + (s.access?.allowed ? '开' : '锁'))
    }
  } catch (e) { NG(n + ' 状态文件损坏: ' + e.message) }
}

// ───────────────────────────── 汇总
console.log('\n' + '═'.repeat(46))
console.log('  通过 ' + pass + '   失败 ' + fail + '   警告 ' + warn)
console.log('═'.repeat(46))
process.exit(fail ? 1 : 0)  // 分层：MOOD_TIERS 必须不重不漏地覆盖全部心情
  {
    const tiers = M.MOOD_TIERS || {}
    const all = Object.values(tiers).flat()
    const dup = all.filter((x, i) => all.indexOf(x) !== i)
    const miss = M.MOOD_IDS.filter((x) => !all.includes(x))
    const extra = all.filter((x) => !M.MOOD_IDS.includes(x))
    dup.length === 0 && miss.length === 0 && extra.length === 0
      ? OK('分层完整：基础 ' + (tiers.basic || []).length + ' / 复合 ' + (tiers.complex || []).length + ' / 当代 ' + (tiers.modern || []).length)
      : NG('分层有问题: 重复[' + dup.join(',') + '] 漏[' + miss.join(',') + '] 多[' + extra.join(',') + ']')
  }


/**
 * 端到端：**真实事件形状** → 归档 → 检索。
 *
 * ────────────────────────────────────────────────────────────────
 *  为什么单独有这个测试
 * ────────────────────────────────────────────────────────────────
 *  test-memory.mjs 测的是存储层（存/查/迁移），喂的是我手写的字符串。
 *  它**测不出**"事件里的文本到底取没取到" —— 而那正是最容易静默失败的地方：
 *
 *    取不到助手回复 → 不报错 → 磁盘上永远只有用户那半边对话。
 *
 *  所以这个测试用的是**从 DSH 源码里抄下来的真实形状**：
 *
 *    user/message       data = { role:'user', content:[{type:'text', text}] }
 *    assistant/message  data = { turn, step, message:{ role:'assistant', content:[…] } }
 *
 *  然后走完整的插件路径：apply → session/event → memory.note → 落盘 → memory 工具查。
 *
 *  跑之前把 DSH_HOME 指到临时目录，绝不碰真实归档。
 */

import fs from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// ⚠️ 这个目录**不能写死** —— 那既是本机路径，也让别人 clone 下来跑不了。
//    从文件自己的位置往上推：文件在哪，插件根就在哪。
const ROOT = dirname(fileURLToPath(import.meta.url))

const TMP = join(tmpdir(), '_dshmood_e2ehome')
fs.rmSync(TMP, { recursive: true, force: true })
fs.mkdirSync(TMP, { recursive: true })
process.env.DSH_HOME = TMP

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ✅ ' + name) }
  else { fail++; console.log('  ❌ ' + name + (extra ? '  → ' + extra : '')) }
}

// ── 装载插件（DSH_HOME 已经指到临时目录）──
const M = await import(new URL('index.js?t=', import.meta.url).href + Date.now())

// ── 假 ctx：把注册出来的东西都收下来 ──
const got = { tools: [], events: [], routes: [], sections: [] }
const ctx = {
  effect: (fn) => { const d = fn(); return typeof d === 'function' ? d : () => {} },
  get: (n) => {
    if (n === 'tools') return { register: (d) => { got.tools.push(d); return () => {} } }
    if (n === 'webServer') return { register: (r) => { got.routes.push(r); return () => {} } }
    if (n === 'sessionController') return { prompt: async () => ({}), list: async () => ({ items: [] }) }
    return undefined
  },
  on: (ev, fn) => { if (ev === 'session/event') got.events.push(fn) },
  logger: { info: () => {}, warn: () => {}, error: () => {} },
  log: () => {},
}
const root = {
  inject: (deps, fn) => fn(ctx),
  effect: ctx.effect, get: ctx.get, on: ctx.on, logger: ctx.logger,
}

const origSetInterval = globalThis.setInterval
let ivalCount = 0
globalThis.setInterval = () => { ivalCount++; return { unref() {} } }
M.apply(root, {})
globalThis.setInterval = origSetInterval

ok('apply 跑通，四个工具都在', ['mood', 'diary', 'news', 'memory'].every((x) => got.tools.map((t) => t.name).includes(x)), got.tools.map((t) => t.name).join(','))
ok('session/event 监听注册了', got.events.length === 1, got.events.length + ' 个')
ok('定时器没真的起（测试环境）', ivalCount === 1, ivalCount + '')

// ── 喂真实形状的事件 ──
const onEvent = got.events[0]
const SESSION = { id: 'e2e-session-1' }
const say = (type, data) => onEvent(SESSION, { type, data, at: Date.now() })

// 真实形状 ①：用户消息 —— data 本身就是 message
say('user/message', {
  id: 'm1', role: 'user',
  content: [{ type: 'text', text: '帮我把硬盘记忆的存储目录改到 D 盘那个文件夹里去' }],
  source: { kind: 'user' },
})

// 真实形状 ②：助手消息 —— 正文包在 data.message 里
say('assistant/message', {
  turn: 1, step: 1,
  message: {
    id: 'm2', role: 'assistant',
    content: [{ type: 'text', text: '好，我改指针文件然后让缓存失效，迁移完路径会立刻生效' }],
    source: { kind: 'model', provider: 'deepseek-account', model: 'deepseek-flash' },
  },
  usage: { total: 123 },
})

// 再来一轮（跨"会话"）
say('user/message', { role: 'user', content: [{ type: 'text', text: '另一个会话里说过：视频的配乐要用钢琴那一版' }] })
onEvent({ id: 'e2e-session-2' }, {
  type: 'assistant/message', at: Date.now(),
  data: { turn: 2, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: '钢琴那版是 A 小调，66 BPM，用正弦波合成的' }] } },
})

// 多段内容 + 非 text 块（工具调用）也要能正确拼
say('assistant/message', {
  turn: 3, step: 1,
  message: {
    role: 'assistant',
    content: [
      { type: 'text', text: '先看一眼目录' },
      { type: 'tool_use', name: 'ops_glob', input: { pattern: '*.jsonl' } },
      { type: 'text', text: '里面已经有归档了，我改成追加而不是覆盖' },
    ],
  },
})

// ⚠️ 推理块必须**不**被当成正文。
//    活体验证时磁盘上躺的全是「Hmm — 这个我得想想」这种内心话，
//    真正说出去的回复一句没有。DSH 自己的 textOf 也是按 type === 'text' 取的。
say('assistant/message', {
  turn: 4, step: 1,
  message: {
    role: 'assistant',
    content: [
      { type: 'reasoning', text: '这里我得想想，用户问的其实是存储位置那件事，先别急着答' },
      { type: 'text', text: '存储位置我改好了，你去设置页刷新一下就能看到' },
      { type: 'reasoning', text: '再说一句就收尾吧，别啰嗦' },
    ],
  },
})

// ⚠️ 时间只认时间戳，不能拿 event.seq 当时间。
//    这里**故意**带上 seq（活体上看到的是 17152 这种小整数），断言时间没被它污染。
onEvent(SESSION, {
  type: 'assistant/message', seq: 17152,
  data: { turn: 5, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: '这条带 seq，时间必须还是现在而不是 1970' }] } },
})

M.memory.flush()

// ── 断言 ──
console.log()
const st = M.memory.stats()
ok('归档文件真的落盘了', fs.existsSync(st.path), st.path)
ok('条数 = 7（2 用户 + 5 助手）', st.count === 7, '实际 ' + st.count)

const rows = M.memory.load()
const users = rows.filter((r) => r.k === 'u')
const assts = rows.filter((r) => r.k === 'a')
ok('用户消息 2 条', users.length === 2, users.length + '')
ok('✨ 助手消息 5 条（第一版这里是 0 —— 形状不对，静默丢）', assts.length === 5, assts.length + '')
ok('助手那条正文取对了',
  assts.some((r) => r.x.includes('改指针文件')), assts.map((r) => r.x.slice(0, 20)).join(' | '))
ok('多段内容拼起来了（工具块被跳过）',
  assts.some((r) => r.x.includes('先看一眼目录') && r.x.includes('改成追加') && !r.x.includes('ops_glob')),
  assts.map((r) => r.x).filter((x) => x.includes('目录'))[0])

// 推理块
console.log()
ok('✨ 推理块没被当正文存（活体上踩过）',
  !rows.some((r) => r.x.includes('先别急着答') || r.x.includes('别啰嗦')),
  rows.filter((r) => r.x.includes('啰嗦') || r.x.includes('急着答')).length + ' 条混进了推理')
ok('同一段里的正文块照常取到',
  assts.some((r) => r.x.includes('存储位置我改好了')),
  assts.map((r) => r.x.slice(0, 16)).join(' | '))

// 时间戳
console.log()
const nowMs = Date.now()
const badTime = rows.filter((r) => Math.abs(nowMs - r.t) > 10 * 60 * 1000)
ok('✨ 时间是真时间戳，不是 seq（活体上踩过）', badTime.length === 0,
  badTime.length ? '有 ' + badTime.length + ' 条时间不对，最早 ' + new Date(Math.min(...rows.map((r) => r.t))).toISOString() : '')
ok('带 seq 的那条时间也是现在',
  rows.some((r) => r.x.includes('这条带 seq') && Math.abs(nowMs - r.t) < 60000),
  rows.filter((r) => r.x.includes('这条带 seq')).map((r) => new Date(r.t).toISOString()).join(','))

ok('跨会话：两条来源不同',
  new Set(rows.map((r) => r.s)).size === 2, [...new Set(rows.map((r) => r.s))].join(','))

// ── memory 工具真的能查到 ──
console.log()
const tool = got.tools.find((t) => t.name === 'memory')
ok('memory 工具在', !!tool)
const r1 = tool.execute({ action: 'search', query: '钢琴 配乐' })
ok('工具搜「钢琴 配乐」有结果', r1.ok && /钢琴/.test(r1.message), (r1.message || '').slice(0, 80))
ok('工具输出里带会话来源', /\[.*·.*\]/.test(r1.message), (r1.message || '').slice(0, 60))
const r2 = tool.execute({ action: 'search', query: '不存在的东西zzz' })
ok('查不到时说清楚', r2.ok && /没有/.test(r2.message), r2.message)
const r3 = tool.execute({ action: 'stats' })
ok('stats 报条数', r3.ok && /7 条/.test(r3.message), r3.message)
const r4 = tool.execute({ action: 'recent', limit: 2 })
ok('recent 返回 2 条', r4.ok && (r4.message.match(/\n/g) || []).length >= 2, (r4.message || '').slice(0, 60))
const r5 = tool.execute({ action: 'search' })
ok('缺 query 时明确报错（不是静默空）', r5.ok === false, JSON.stringify(r5))

// ── /memory 路由的载荷 ──
console.log()
const route = got.routes[0]
ok('HTTP 路由已注册', route && route.path === '/dsh-mood-api')

fs.rmSync(TMP, { recursive: true, force: true })
console.log()
console.log('  通过 ' + pass + '  失败 ' + fail)
process.exit(fail ? 1 : 0)

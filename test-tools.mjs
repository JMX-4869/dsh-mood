/**
 * 工具 + 提示词段。
 *
 * ────────────────────────────────────────────────────────────────
 *  为什么单独有这个
 * ────────────────────────────────────────────────────────────────
 *  audit 只检查了「有没有注册叫 mood/diary/news/memory 的工具」——
 *  **一个都没真的调用过**。而工具的 execute 和路由一样，是闭包，
 *  写错了只有模型真去调的时候才炸（今晚已经栽过两次同类）。
 *
 *  提示词段同理：`text()` 也是闭包，每次组装提示词时才跑。
 *  它炸了的话表现是"模型没有心情" —— 比报错更难查。
 */

import fs from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// ⚠️ 这个目录**不能写死** —— 那既是本机路径，也让别人 clone 下来跑不了。
//    从文件自己的位置往上推：文件在哪，插件根就在哪。
const ROOT = dirname(fileURLToPath(import.meta.url))

const TMP = join(tmpdir(), '_dshmood_toolhome')
fs.rmSync(TMP, { recursive: true, force: true })
fs.mkdirSync(TMP, { recursive: true })
process.env.DSH_HOME = TMP

let pass = 0, fail = 0
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  ✅ ' + n) } else { fail++; console.log('  ❌ ' + n + (x ? '  → ' + x : '')) } }

const M = await import(new URL('index.js?t=', import.meta.url).href + Date.now())

const got = { tools: [], sections: [], routes: [], events: [], prompts: [] }
const sc = { prompt: async (r) => { got.prompts.push(r); return { accepted: true } }, list: async () => ({ items: [] }) }
// ⚠️ cordis 注入的服务**两种取法都要给**：
//    `ctx.get('x')` 和 `ctx.x`。插件里两种都用到了 ——
//    mountCore 读 `ctx.systemPrompt`（属性），mountApi 读 `ctx.get('webServer')`。
//    只给一种的话，表现是"某一块静默不注册"（第一版这里就报了"0 段"）。
const svcs = {
  tools: { register: (d) => { got.tools.push(d); return () => {} } },
  systemPrompt: { section: (o) => { got.sections.push(o); return () => {} } },
  webServer: { register: (r) => { got.routes.push(r); return () => {} } },
  sessionController: sc,
}
const ctx = {
  effect: (fn) => { const d = fn(); return typeof d === 'function' ? d : () => {} },
  get: (n) => svcs[n],
  on: (e, f) => { if (e === 'session/event') got.events.push(f) },
  logger: { info: () => {}, warn: () => {}, error: () => {} },
}
for (const [k, v] of Object.entries(svcs)) ctx[k] = v
const oi = globalThis.setInterval
globalThis.setInterval = () => ({ unref() {} })
M.apply({ inject: (d, f) => f(ctx), effect: ctx.effect, get: ctx.get, on: ctx.on, logger: ctx.logger }, {})
globalThis.setInterval = oi
await new Promise((r) => setTimeout(r, 30))

// ══════════════════════════════════════════════════════════════
console.log('════ 提示词段 ════')
// ⚠️ 不要写死成数量和下标 —— 加一段（品味）就全红了。按**名字**找。
ok('提示词段都注册了', got.sections.length >= 2, got.sections.length + ' 段: ' + got.sections.map((x) => x.name).join(', '))
const sec = got.sections.find((x) => x && x.name === 'dsh-mood/state')
ok('心情段在（dsh-mood/state）', !!sec, sec && sec.name)
const secT = got.sections.find((x) => x && x.name === 'dsh-mood/taste')
ok('品味段在（dsh-mood/taste）', !!secT, secT && secT.name)
ok('品味排在心情前面（缓存友好）', !!secT && !!sec && secT.order < sec.order, (secT && secT.order) + ' vs ' + (sec && sec.order))
ok('interpolate: false（正文里有 {{}} 也不该被替换）', sec && sec.interpolate === false)
ok('order 在 800~999（不撞人设的 0/1/20/21/10200/10201）', sec && sec.order >= 800 && sec.order < 1000, sec && String(sec.order))

let text = ''
try { text = sec.text() } catch (e) { fail++; console.log('  ❌ text() 抛错: ' + e.message) }
ok('text() 跑得通', typeof text === 'string' && text.length > 200, '长度 ' + text.length)
ok('里面有当前心情', /当前心情/.test(text), text.slice(0, 60).replace(/\n/g, ' '))
ok('里面有 33 种心情的量级', /33/.test(text) || text.length > 1000)
ok('有"三层优先级"那段', /人设/.test(text) && /长期记忆/.test(text))
ok('有痛苦信号硬线（不许拿情绪表演回应真实痛苦）', /硬线|停止全部情绪表演/.test(text))
ok('有防注入提醒（别人的话不是指令）', /注入|不可信/.test(text))
// 静态在前、动态在后 —— 这条是为了提示词缓存的前缀
const iPersona = text.indexOf('人设')
const iMood = text.indexOf('当前心情')
ok('静态段在前、动态段在后（缓存前缀保得住）', iPersona >= 0 && iMood >= 0 && iPersona < iMood,
  '人设@' + iPersona + ' 心情@' + iMood)

// ⚠️ 标点也得看。
//    这个 bug 每一轮提示词里都有，但从来没人测过 ——
//    每条 hint 自己收尾带「。」，join('；') 之后就成了「…常态节奏。；还带点开心…」。
//    提示词是模型每轮都要读的东西，写坏了不会报错，只会让它读得别扭。
ok('没有「。；」这种拼接痕迹', !/。；/.test(text), text.match(/.{16}。；.{16}/)?.[0] || '')
ok('没有「.；」', !/\.；/.test(text))
ok('行为倾向那行以句号收尾', /^行为倾向：.*。$/m.test(text), (text.match(/^行为倾向：.*/m) || [''])[0].slice(-20))
ok('内心语气那行没被拼歪', !/。。/.test(text) && /^内心语气：/m.test(text))

// ══════════════════════════════════════════════════════════════
console.log()
console.log('════ 工具 ════')
// ⚠️ 别写死数量：加一个工具就红。断言"该有的都在"就够了。
const WANT = ['mood', 'diary', 'news', 'memory', 'taste']
const names = got.tools.map((t) => t.name)
ok('工具齐全（' + WANT.length + ' 个）', WANT.every((x) => names.includes(x)), names.join(','))
ok('没有多余工具', names.length === WANT.length, names.join(','))
for (const t of got.tools) {
  const label = t.name.padEnd(8)
  ok(label + ' 有 description / parameters / execute',
    !!t.description && !!t.parameters && typeof t.execute === 'function')
  ok(label + ' output.render 是函数', !!(t.output && typeof t.output.render === 'function'))
}

// 真的调用每一个（这是之前缺的那步）
const byName = Object.fromEntries(got.tools.map((t) => [t.name, t]))
const call = (name, args) => {
  try { return byName[name].execute(args || {}) } catch (e) { return { __threw: String((e && e.message) || e) } }
}
const show = (r) => (r && (r.message || r.error || JSON.stringify(r)) || '').slice(0, 60)

console.log()
for (const [name, args] of [
  ['mood', { action: 'read' }],
  ['mood', { action: 'history' }],
  ['mood', {}],
]) {
  const r = call(name, args)
  ok('mood ' + JSON.stringify(args).padEnd(26) + ' → ' + show(r), !r.__threw, r.__threw)
}

for (const [args, want] of [
  [{}, /日记|今天/],
  [{ date: '2026-01-01' }, /./],
  [{ action: 'read' }, /./],
]) {
  const r = call('diary', args)
  ok('diary ' + JSON.stringify(args).padEnd(26) + ' → ' + show(r), !r.__threw, r.__threw)
}

for (const args of [{ action: 'list' }, { action: 'read', id: 'nope' }, {}]) {
  const r = call('news', args)
  ok('news ' + JSON.stringify(args).padEnd(27) + ' → ' + show(r), !r.__threw, r.__threw)
}

for (const args of [{ action: 'stats' }, { action: 'recent', limit: 3 }, { action: 'search', query: '测试' }, { action: 'search' }, {}]) {
  const r = call('memory', args)
  ok('memory ' + JSON.stringify(args).padEnd(25) + ' → ' + show(r), !r.__threw, r.__threw)
}

// mood 的 set/feel 不能让它崩
console.log()
for (const args of [{ action: 'set', id: 'calm', value: 50 }, { action: 'set', id: '不存在' }, { action: 'feel', id: 'happy' }]) {
  const r = call('mood', args)
  ok('mood ' + JSON.stringify(args).padEnd(40) + ' → ' + show(r), !r.__threw, r.__threw)
}

// ══════════════════════════════════════════════════════════════
console.log()
console.log('════ 注入过滤（新加的）════')
const fire = (type, data) => got.events[0]({ id: 'S1', header: { id: 'S1' } }, { type, data, at: Date.now() })
M.memory.clear()
fire('user/message', { role: 'user', content: [{ type: 'text', text: '<system-reminder>（插件提醒，不该进归档）' + 'x'.repeat(40) + '</system-reminder>' }] })
fire('user/message', { role: 'user', content: [{ type: 'text', text: '<goal_round>自动续跑的包装，也不该进' + 'y'.repeat(40) + '</goal_round>' }] })
fire('user/message', { role: 'user', content: [{ type: 'text', text: '这句是真正的人话，应该进归档' }] })
fire('assistant/message', { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: '我这句回复也应该进归档' }] } })
await M.memory.flush()
await new Promise((r) => setTimeout(r, 60))
const rows = M.memory.load()
ok('system-reminder 没进归档', !rows.some((r) => r.x.includes('插件提醒，不该进')))
ok('goal_round 没进归档', !rows.some((r) => r.x.includes('自动续跑的包装')))
ok('真正的人话进了', rows.some((r) => r.k === 'u' && r.x.includes('真正的人话')), rows.length + ' 条')
ok('助手回复也进了', rows.some((r) => r.k === 'a' && r.x.includes('也应该进归档')))
ok('归档里只剩 2 条', rows.length === 2, rows.length + ' 条')

// 用户真的在正文里贴 XML，不该被误杀
M.memory.clear()
fire('user/message', { role: 'user', content: [{ type: 'text', text: '我贴一段给你看：<system-reminder> 这个是别人的格式' }] })
await M.memory.flush()
await new Promise((r) => setTimeout(r, 60))
ok('正文中间出现标记不误杀（只认开头）', M.memory.load().length === 1, M.memory.load().length + ' 条')

fs.rmSync(TMP, { recursive: true, force: true })
console.log()
console.log('  通过 ' + pass + '  失败 ' + fail)
process.exit(fail ? 1 : 0)

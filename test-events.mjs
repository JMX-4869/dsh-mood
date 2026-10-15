/**
 * 事件流测试 —— **真的喂 session/event，看插件有没有做出反应**。
 *
 * ────────────────────────────────────────────────────────────────
 *  为什么必须有这个
 * ────────────────────────────────────────────────────────────────
 *  插件的三个主动行为全挂在 `session/event` 上：
 *    · 把对话抄进硬盘记忆
 *    · 心情加减分
 *    · **重启汇报**（回合结束时投一句话）
 *
 *  而**没有一个测试喂过事件**。所以"检测到了重启，但一句话也没说"
 *  这种事，audit（只看文本）、test-api（只调路由）、e2e（只测归档）
 *  全都看不见 —— 只能靠主人在界面上发现。
 *
 *  ⚠️ 这个测试只 apply **一次**。apply 两次会造出两套独立实例
 *     （各自一份 proactive），事件和路由就串不上了 —— 第一版踩过。
 */

import fs from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// ⚠️ 这个目录**不能写死** —— 那既是本机路径，也让别人 clone 下来跑不了。
//    从文件自己的位置往上推：文件在哪，插件根就在哪。
const ROOT = dirname(fileURLToPath(import.meta.url))

const TMP = join(tmpdir(), '_dshmood_evhome')
fs.rmSync(TMP, { recursive: true, force: true })
fs.mkdirSync(TMP, { recursive: true })
process.env.DSH_HOME = TMP

let pass = 0, fail = 0
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  ✅ ' + n) } else { fail++; console.log('  ❌ ' + n + (x ? '  → ' + x : '')) } }

const M = await import(new URL('index.js?t=', import.meta.url).href + Date.now())

// ── 一套 ctx：事件 + 路由 + 工具都在同一个闭包里 ──
const got = { events: [], prompts: [], routes: [] }
const sessionCtl = {
  prompt: async (req) => { got.prompts.push(req); return { accepted: true } },
  list: async () => ({ items: [] }),
}
const ctx = {
  effect: (fn) => { const d = fn(); return typeof d === 'function' ? d : () => {} },
  get: (n) => n === 'tools' ? { register: () => () => {} }
    : n === 'webServer' ? { register: (r) => { got.routes.push(r); return () => {} } }
    : n === 'sessionController' ? sessionCtl
    : undefined,
  on: (ev, fn) => { if (ev === 'session/event') got.events.push(fn) },
  logger: { info: () => {}, warn: () => {}, error: () => {} },
}
const oi = globalThis.setInterval
globalThis.setInterval = () => ({ unref() {} })
M.apply({ inject: (d, f) => f(ctx), effect: ctx.effect, get: ctx.get, on: ctx.on, logger: ctx.logger }, {})
globalThis.setInterval = oi
await new Promise((r) => setTimeout(r, 30))

ok('事件监听注册了（只 1 个）', got.events.length === 1, got.events.length + ' 个')
ok('路由注册了（只 1 个）', got.routes.length === 1, got.routes.length + ' 个')

const fire = (type, data, session, extra) =>
  got.events[0](session || { id: 'sess-A', header: { id: 'sess-A' } }, { type, data, at: Date.now(), ...extra })

function callApi(method, url, body, noHeader) {
  let out = null
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body), 'utf8')]
  // 写操作要求 x-dsh-mood 头（跨站写保护）。
  // ⚠️ 假请求也必须给 headers —— 少了它服务端一读就抛，
  //    表现成一个莫名其妙的业务错误，很难看出真正原因（第一版就是这样）。
  const req = {
    method, url,
    headers: noHeader ? {} : { 'x-dsh-mood': '1' },
    on(ev, fn) { if (ev === 'data') for (const c of chunks) fn(c); if (ev === 'end') fn(); return req },
    destroy() {},
  }
  const res = { writeHead(c) { out = out || { code: c } }, end(s) { out = { code: (out && out.code) || 200, body: s } } }
  got.routes[0].handler(req, res)
  try { return JSON.parse(out.body) } catch { return null }
}

const FILE = 'D:/path/to/data/dsh-mood-proactive.json'
const tick = (ms = 80) => new Promise((r) => setTimeout(r, ms))

const setPending = () => {
  // ⚠️ 必须走**真实路由**。直接写文件改不到活的那份内存对象 ——
  //    第一版就是这么写的，诊断一路说"没有欠着的汇报"，白查半天。
  const r = callApi('POST', '/dsh-mood-api/proactive', { action: 'markRestart' })
  if (!r || r.pendingRestart !== true) throw new Error('markRestart 没生效: ' + JSON.stringify(r))
}

// ── 打开主动开口（走真实路由，验证两边是同一个对象）──
const on = callApi('POST', '/dsh-mood-api/proactive', { enabled: true })
ok('打开主动开口（走真实路由）', on && on.enabled === true, JSON.stringify(on && { e: on.enabled }))

console.log()
console.log('════ 喂一轮完整事件，看有没有投递 ════')
setPending()
got.prompts.length = 0
fire('user/message', { role: 'user', content: [{ type: 'text', text: '帮我把那个东西改一下，改完记得重启' }] })
fire('turn/start', {})
fire('assistant/message', { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: '改好了，重启之后就能生效' }] } })
fire('turn/end', {})
await tick()

ok('✨ 投递了一次（这就是原来漏掉的那句）', got.prompts.length === 1, '投了 ' + got.prompts.length + ' 次')
const req = got.prompts[0]
if (req) {
  ok('投的是插件提醒框，不是伪造用户的话', /不是你发的/.test(req.content[0].text), req.content[0].text.slice(0, 50))
  ok('内容是重启汇报', /刚重启过/.test(req.content[0].text))
  ok('会话 id 取对了', req.sessionId === 'sess-A', req.sessionId)
  ok('requestId 有前缀', /^dsh-mood-boot-/.test(req.requestId), req.requestId)
}

console.log()
console.log('════ 诊断字段 ════')
const st = callApi('GET', '/dsh-mood-api/proactive')
ok('lastReportCheck 有值', !!(st && st.lastReportCheck && st.lastReportCheck.why), JSON.stringify(st && st.lastReportCheck))
// ⚠️ 看的是 lastReportDone，不是 lastReportCheck ——
//    后者是个会被覆盖的字段：投完之后的空跑会把它冲成「没有欠着的汇报」，
//    外面看起来像根本没投过（实测踩到）。
ok('记下了这次成功投递', !!(st && st.lastReportDone && st.lastReportDone.kind === 'restart'), JSON.stringify(st && st.lastReportDone))
ok('pendingRestart 清掉了', st && st.pendingRestart === false)

console.log()
console.log('════ 再喂一轮：不该重复投 ════')
got.prompts.length = 0
fire('user/message', { role: 'user', content: [{ type: 'text', text: '再聊一句看看会不会重复汇报' }] })
fire('turn/end', {})
await tick()
ok('没有再投', got.prompts.length === 0, '又投了 ' + got.prompts.length + ' 次')
const st2 = callApi('GET', '/dsh-mood-api/proactive')
ok('诊断更新成"没有欠着的"', !!(st2 && /没有欠着的/.test(st2.lastReportCheck.why)), st2 && st2.lastReportCheck && st2.lastReportCheck.why)

console.log()
console.log('════ 会话对象只有顶层 id（没有 header）也得能取到 ════')
// ⚠️ 顺序变了：**先**让 sess-B 说话（它成为"当前活跃对话"），**再**挂待办 ——
//    手动挂待办会绑到当前活跃的那条。反过来的话，待办已经绑在 sess-A 上，
//    按新规矩就**不该**投给 sess-B 了（这正是要的效果，不是 bug）。
got.events[0]({ id: 'sess-B' }, { type: 'user/message', at: Date.now(), data: { role: 'user', content: [{ type: 'text', text: '换个会话对象形状' }] } })
setPending()
got.prompts.length = 0
got.events[0]({ id: 'sess-B' }, { type: 'user/message', at: Date.now(), data: { role: 'user', content: [{ type: 'text', text: '换个会话对象形状再来一次' }] } })
got.events[0]({ id: 'sess-B' }, { type: 'turn/end', at: Date.now(), data: {} })
await tick()
ok('没有 header 也能取到 id 并投递', got.prompts.length === 1 && got.prompts[0].sessionId === 'sess-B',
  got.prompts.length + ' 次 / ' + (got.prompts[0] && got.prompts[0].sessionId))

console.log()
console.log('════ 活跃的是别的对话时，绝不"就近投递" ════')
// 待办绑在 sess-B，现在换个对话说话 —— 提醒**不该**跑到那边去
setPending()
got.prompts.length = 0
got.events[0]({ id: 'sess-C' }, { type: 'user/message', at: Date.now(), data: { role: 'user', content: [{ type: 'text', text: '我跑到另一个对话来了' }] } })
got.events[0]({ id: 'sess-C' }, { type: 'turn/end', at: Date.now(), data: {} })
await tick()
ok('没投给 sess-C（提醒不会跟着人跑）', got.prompts.length === 0, '投了 ' + got.prompts.length + ' 次')
const stC = callApi('GET', '/dsh-mood-api/proactive')
ok('诊断说清了原因', !!(stC && /别的对话/.test(stC.lastReportCheck.why)), stC && stC.lastReportCheck && stC.lastReportCheck.why)
ok('待办还留着（没有白丢）', !!(stC && stC.pendingRestart === true))
// 回到绑定的那条 —— 这时候才该投
got.prompts.length = 0
got.events[0]({ id: 'sess-B' }, { type: 'user/message', at: Date.now(), data: { role: 'user', content: [{ type: 'text', text: '回来了' }] } })
got.events[0]({ id: 'sess-B' }, { type: 'turn/end', at: Date.now(), data: {} })
await tick()
ok('回到绑定的对话 → 投出去了', got.prompts.length === 1 && got.prompts[0].sessionId === 'sess-B',
  got.prompts.length + ' 次 / ' + (got.prompts[0] && got.prompts[0].sessionId))

console.log()
console.log('════ 关掉主动开口：不投，而且要说清原因 ════')
callApi('POST', '/dsh-mood-api/proactive', { enabled: false })
setPending()
got.prompts.length = 0
fire('turn/end', {})
await tick()
ok('没投', got.prompts.length === 0)
const st3 = callApi('GET', '/dsh-mood-api/proactive')
ok('诊断说明是"关着"', !!(st3 && /关着/.test(st3.lastReportCheck.why)), st3 && st3.lastReportCheck && st3.lastReportCheck.why)

console.log()
console.log('════ 界面上的「试一次」按钮（走 tryReport）════')
// ⚠️ 上一段把主动开口关掉了 —— 这里得先打开，不然测的是"关着"那条路径
callApi('POST', '/dsh-mood-api/proactive', { enabled: true })
setPending()
got.prompts.length = 0
callApi('POST', '/dsh-mood-api/proactive', { action: 'tryReport' })
await tick(120)   // tryReport 是异步的，不等的话读到的还是旧状态
ok('试一次就能立刻投递（不用等重启）', got.prompts.length === 1, '投了 ' + got.prompts.length + ' 次')
const st4 = callApi('GET', '/dsh-mood-api/proactive')
ok('诊断说已投递', !!(st4 && st4.lastReportCheck && /已投递/.test(st4.lastReportCheck.why)),
  st4 && st4.lastReportCheck && st4.lastReportCheck.why)

console.log()
console.log('════ 归档抓取（顺手一起验）════')
await M.memory.flush()
await new Promise((r) => setTimeout(r, 50))
const rows = M.memory.load()
ok('用户消息进了归档', rows.some((r) => r.k === 'u' && r.x.includes('改一下')), rows.filter((r) => r.k === 'u').length + ' 条用户')
ok('助手回复也进了（两种事件形状都对）', rows.some((r) => r.k === 'a' && r.x.includes('重启之后就能生效')), rows.filter((r) => r.k === 'a').length + ' 条助手')
ok('推理块没混进去', !rows.some((r) => /^Hmm —/.test(r.x)))

fs.rmSync(TMP, { recursive: true, force: true })
console.log()
console.log('  通过 ' + pass + '  失败 ' + fail)
process.exit(fail ? 1 : 0)

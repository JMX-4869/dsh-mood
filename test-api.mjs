/**
 * 真的去调 HTTP 路由。
 *
 * ────────────────────────────────────────────────────────────────
 *  为什么单独有这个测试
 * ────────────────────────────────────────────────────────────────
 *  路由的处理函数是个闭包 —— **只在收到请求时才执行**。所以：
 *
 *    · `node --check` 过（语法没错）
 *    · `apply` 也过（注册本身没抛错）
 *    · 但点一下设置页的按钮就炸
 *
 *  真实事故：改"开关点了没反应"那次，我在 mountApi 里写了 `const p = proactive`，
 *  而 `proactive` 定义在 mountCore 里 —— 跨作用域。表现是整格变成
 *  「读不到数据：proactive is not defined」。
 *
 *  **两个静态检查都抓不到。** 这个测试就是把每个路由真调一遍。
 */

import fs from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// ⚠️ 这个目录**不能写死** —— 那既是本机路径，也让别人 clone 下来跑不了。
//    从文件自己的位置往上推：文件在哪，插件根就在哪。
const ROOT = dirname(fileURLToPath(import.meta.url))

const TMP = join(tmpdir(), '_dshmood_apihome')
fs.rmSync(TMP, { recursive: true, force: true })
fs.mkdirSync(TMP, { recursive: true })
process.env.DSH_HOME = TMP

let pass = 0, fail = 0
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  ✅ ' + n) } else { fail++; console.log('  ❌ ' + n + (x ? '  → ' + x : '')) } }

const M = await import(new URL('index.js?t=', import.meta.url).href + Date.now())

// ── 假 ctx：把路由收下来 ──
const got = { routes: [], tools: [] }
const ctx = {
  effect: (fn) => { const d = fn(); return typeof d === 'function' ? d : () => {} },
  get: (n) => n === 'tools' ? { register: (d) => { got.tools.push(d); return () => {} } }
    : n === 'webServer' ? { register: (r) => { got.routes.push(r); return () => {} } }
    : n === 'sessionController' ? { prompt: async () => ({ accepted: true }), list: async () => ({ items: [] }) }
    : undefined,
  on: () => {}, logger: { info: () => {}, warn: () => {}, error: () => {} },
}
const oi = globalThis.setInterval
globalThis.setInterval = () => ({ unref() {} })
M.apply({ inject: (d, f) => f(ctx), effect: ctx.effect, get: ctx.get, on: ctx.on, logger: ctx.logger }, {})
globalThis.setInterval = oi

const route = got.routes[0]
ok('路由注册了', !!route && route.kind === 'prefix' && route.path === '/dsh-mood-api', JSON.stringify(route && { k: route.kind, p: route.path }))

/** 造一个假请求，真的走一遍 handler */
function call(method, url, body, noHeader) {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body), 'utf8')]
  let out = null
  const req = {
    method, url,
    // 写操作要求 `x-dsh-mood` 头（跨站写保护，见 index.js 里那段注释）。
    // noHeader=true 专门用来**验证它真的会挡** —— 不验的话这层保护可能压根没生效。
    headers: noHeader ? {} : { 'x-dsh-mood': '1' },
    on(ev, fn) {
      if (ev === 'data') for (const c of chunks) fn(c)
      if (ev === 'end') fn()
      return req
    },
    destroy() {},
  }
  const res = {
    writeHead(code) { out = out || { code } },
    end(s) { out = { code: (out && out.code) || 200, body: s } },
  }
  try { route.handler(req, res) } catch (e) { return { code: 500, thrown: String(e && e.message || e) } }
  if (!out) return { code: 0, thrown: 'handler 没调 send（异步的？）' }
  let j = null
  try { j = JSON.parse(out.body) } catch { /* 不是 json */ }
  return { code: out.code, json: j }
}

console.log()
console.log('════ 逐个路由真调一遍（这就是之前缺的那步）════')

const cases = [
  ['GET', '/dsh-mood-api/state', undefined, (j) => j.ok && Array.isArray(j.ranked) && j.persona],
  ['GET', '/dsh-mood-api/proactive', undefined, (j) => j.ok && Array.isArray(j.gates) && Array.isArray(j.slotTable)],
  ['POST', '/dsh-mood-api/proactive', { enabled: true }, (j) => j.ok && j.enabled === true],
  ['POST', '/dsh-mood-api/proactive', { slots: ['am2', 'pm'] }, (j) => j.ok && j.slots.length === 2],
  ['POST', '/dsh-mood-api/proactive', { slots: ['不存在的id'] }, (j) => j.ok && j.slots.length === 0],
  ['POST', '/dsh-mood-api/proactive', { reportRestart: false }, (j) => j.ok && j.reportRestart === false],
  ['GET', '/dsh-mood-api/memory', undefined, (j) => j.ok && j.stats],
  ['POST', '/dsh-mood-api/memory', { action: 'clear' }, (j) => j.ok],
  ['GET', '/dsh-mood-api/news', undefined, (j) => j.ok],
  ['GET', '/dsh-mood-api/diary', undefined, () => true],
  ['GET', '/dsh-mood-api/diary?date=2026-01-01', undefined, () => true],
  ['GET', '/dsh-mood-api/persona', undefined, (j) => j.ok && 'source' in j],
  ['POST', '/dsh-mood-api/persona', { tone: '测试语气' }, (j) => j.ok || j.error],
  ['GET', '/dsh-mood-api/storage', undefined, (j) => j.ok],
  ['GET', '/dsh-mood-api/nope', undefined, () => true],
]
for (const [m, u, b, check] of cases) {
  const r = call(m, u, b)
  const label = (m + ' ' + u.replace('/dsh-mood-api', '')).padEnd(38)
  if (r.thrown) { fail++; console.log('  ❌ ' + label + '抛错: ' + r.thrown) }
  else if (r.code >= 500) { fail++; console.log('  ❌ ' + label + 'HTTP ' + r.code + '  ' + JSON.stringify(r.json).slice(0, 80)) }
  else { ok(label + 'HTTP ' + r.code + (check(r.json) ? '' : '  ⚠️ 载荷形状不对'), check(r.json), JSON.stringify(r.json).slice(0, 80)) }
}

// 关键的回归：开关必须**立刻**生效，不是等重启
console.log()
const on = call('POST', '/dsh-mood-api/proactive', { enabled: true })
ok('打开 → 立刻返回 enabled=true（不是等重启）', on.json && on.json.enabled === true, JSON.stringify(on.json && { e: on.json.enabled }))
const off = call('POST', '/dsh-mood-api/proactive', { enabled: false })
ok('关掉 → 立刻返回 enabled=false', off.json && off.json.enabled === false, JSON.stringify(off.json && { e: off.json.enabled }))

// ── 归档的体积上限 /「只存用户的话」──
// 这两个是**函数式配置**：用户在设置页改完要立刻生效。
// 踩过的坑：选项名写成 userOnly 而调用方传 onlyUser —— 静默失效；
// 以及 memoryCfg 读的是 mountCore 里的 state，模块级看不见 —— 也是静默失效。
console.log()
const lim = call('POST', '/dsh-mood-api/memory', { action: 'limits', maxMB: 3 })
ok('改上限 → 当场返回 3 MB', !!(lim.json && lim.json.ok && Math.round(lim.json.stats.maxBytes / 1048576) === 3), JSON.stringify(lim.json && lim.json.stats && lim.json.stats.maxBytes))
const stLim = call('GET', '/dsh-mood-api/memory')
ok('再读一次还是 3 MB（真的改到活的那份）', !!(stLim.json && Math.round(stLim.json.stats.maxBytes / 1048576) === 3), JSON.stringify(stLim.json && stLim.json.stats && stLim.json.stats.maxBytes))
ok('stats 带占用比/增长估算/丢弃计数', !!(stLim.json && stLim.json.stats && 'usedRatio' in stLim.json.stats && 'perDayBytes' in stLim.json.stats && 'trimmed' in stLim.json.stats))
const ou = call('POST', '/dsh-mood-api/memory', { action: 'limits', onlyUser: true })
ok('打开「只存用户的话」', !!(ou.json && ou.json.ok && ou.json.stats.onlyUser === true))
const back = call('POST', '/dsh-mood-api/memory', { action: 'limits', maxMB: 50, onlyUser: false })
ok('改回默认', !!(back.json && Math.round(back.json.stats.maxBytes / 1048576) === 50 && back.json.stats.onlyUser === false))
const after = call('GET', '/dsh-mood-api/proactive')
ok('再读一次还是 false（真的改到活的那份了）', after.json && after.json.enabled === false, JSON.stringify(after.json && { e: after.json.enabled }))

console.log()
console.log('════ 跨站写保护（CSRF）════')
// ⚠️ 这个接口里是**全部对话原文**，还能一键清空。
//    DSH 只绑 127.0.0.1，跨站读也拿不到响应 —— 但**跨站写**能打进来：
//    页面用 mode:'no-cors' + 字符串 body（→ text/plain → 不触发预检），
//    请求照样到达、副作用照样发生。所以写操作必须要求一个自定义头。
const noHdr = call('POST', '/dsh-mood-api/memory', { action: 'limits', maxMB: 7 }, true)
ok('不带 x-dsh-mood 的 POST 被挡住（403）', noHdr.code === 403, 'HTTP ' + noHdr.code)
const stillLim = call('GET', '/dsh-mood-api/memory')
ok('被挡之后设置**没有被改**', stillLim.json && Math.round(stillLim.json.stats.maxBytes / 1048576) === 50, JSON.stringify(stillLim.json && stillLim.json.stats && stillLim.json.stats.maxBytes))
const noHdrClear = call('POST', '/dsh-mood-api/memory', { action: 'clear' }, true)
ok('不带头的 clear 也挡住了（没清空）', noHdrClear.code === 403, 'HTTP ' + noHdrClear.code)
const getNoHdr = call('GET', '/dsh-mood-api/state', undefined, true)
ok('GET 不要头（读不构成破坏，跨站也读不到响应）', getNoHdr.code === 200, 'HTTP ' + getNoHdr.code)

fs.rmSync(TMP, { recursive: true, force: true })
console.log()
console.log('  通过 ' + pass + '  失败 ' + fail)
process.exit(fail ? 1 : 0)

/**
 * 冒烟测试 —— **每一扇门都去推一下**。
 *
 * 和 `test-*.mjs` 的分工：
 *   · 那些测试是"挑着写的"（谁写谁挑重点，覆盖哪里漏哪里）
 *   · 这个不看覆盖率，就是**把所有对外的东西真跑一遍**：
 *     两段提示词、五个工具、八条 GET 路由、六个数据文件
 *
 * 加功能的时候最有用 —— 它不需要有人记得"给新路由补个测试"。
 *
 * ⚠️ 先把 DSH_HOME 指到临时目录再 import（跟别的测试一样：别碰真数据）。
 *
 *   node smoke.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { dirname } from 'node:path'

const H = path.join(os.tmpdir(), 'dsh-mood-smoke-' + Date.now())
fs.mkdirSync(H, { recursive: true })
process.env.DSH_HOME = H

const here = new URL('./', import.meta.url).href
const M = await import(here + 'index.js?t=' + Date.now())
const Store = await import(here + 'store.js?t=' + Date.now())

const reg = { tools: [], routes: [], sections: [] }
const svcs = {
  tools: { register: (d) => { reg.tools.push(d); return () => {} } },
  systemPrompt: { section: (o) => { reg.sections.push(o); return () => {} } },
  webServer: { register: (r) => { reg.routes.push(r); return () => {} } },
  sessionController: { prompt: async () => ({}), list: async () => ({ items: [] }) },
}
const ctx = {
  effect: (f) => { const d = f(); return typeof d === 'function' ? d : () => {} },
  get: (n) => svcs[n], on: () => {}, logger: {},
}
for (const [k, v] of Object.entries(svcs)) ctx[k] = v
M.apply({ inject: (d, f) => f(ctx), effect: ctx.effect, get: ctx.get, on: ctx.on, logger: ctx.logger }, {})
await new Promise((r) => setTimeout(r, 150))

let pass = 0, fail = 0
const ok = (m) => { pass++; console.log('  ✅ ' + m) }
const bad = (m) => { fail++; console.log('  ❌ ' + m) }

// ── 1. 提示词段 ──
console.log('══ 提示词段 ══')
for (const s of reg.sections) {
  try {
    const t = String(s.text() || '')
    t.length > 100 ? ok(`${s.name} (order ${s.order}) 生成 ${t.length} 字符`)
      : bad(`${s.name} 只生成了 ${t.length} 字符（太短，多半是空的）`)
  } catch (e) { bad(`${s.name} 生成时抛错：${e.message}`) }
}

// ── 2. 工具 ──
console.log('')
console.log('══ 工具 ══')
const run = async (tool, args) => {
  try { return await tool.execute(args) } catch (e) { return { message: 'THREW: ' + e.message } }
}
for (const t of reg.tools) {
  const r = await run(t, { action: 'list' })
  const msg = String((r && r.message) || '')
  const threw = /THREW/.test(msg)
  threw ? bad(`${t.name}.list 抛错：${msg.slice(0, 70)}`)
    : (msg ? ok(`${t.name}.list → ${msg.split('\n')[0].slice(0, 52)}`) : bad(`${t.name}.list 没返回 message`))
  const r2 = await run(t, {})
  const threw2 = /THREW/.test(String((r2 && r2.message) || ''))
  threw2 ? bad(`${t.name} 空参数抛错`) : ok(`${t.name} 空参数不崩`)
  const noDesc = Object.entries(t.parameters || {}).filter(([, v]) => !v || !v.description).map(([k]) => k)
  noDesc.length ? bad(`${t.name} 这些参数没有 description：${noDesc.join(', ')}`)
    : ok(`${t.name} 参数都有说明（${Object.keys(t.parameters || {}).length} 个）`)
}

// ── 3. 路由 ──
console.log('')
console.log('══ 路由（GET 全打一遍）══')
const route = reg.routes.find((r) => r.path === '/dsh-mood-api')
if (!route) { bad('HTTP 路由没注册（设置页会 404）') } else {
  const hit = (method, p, body, withHdr = true) => new Promise((resolve) => {
    const chunks = body ? [Buffer.from(JSON.stringify(body), 'utf8')] : []
    const req = { method, url: p, headers: withHdr ? { 'x-dsh-mood': '1' } : {}, on: (ev, cb) => { if (ev === 'data') for (const c of chunks) cb(c); if (ev === 'end') cb(); return req } }
    let done = false
    const res = { statusCode: 200, setHeader() {}, writeHead(c) { this.statusCode = c }, end(s) { if (done) return; done = true; let j = null; try { j = JSON.parse(String(s)) } catch { /* 非 JSON */ } resolve({ code: this.statusCode, body: j, raw: String(s).slice(0, 60) }) } }
    try { route.handler(req, res, () => {}) } catch (e) { resolve({ code: 0, error: e.message }) }
  })
  // ⚠️ /diary 默认 403 是**故意的**（日记归模型，默认不让看，要它放行）
  const GATED = { '/diary': '日记锁着' }
  for (const p of ['/state', '/proactive', '/memory', '/diary', '/news', '/persona', '/storage', '/taste']) {
    const r = await hit('GET', p)
    if (!r || r.code === 0) bad(`GET ${p} 抛错：${r && r.error}`)
    else if (GATED[p] && r.code === 403) ok(`GET ${p} → 403 ${GATED[p]}（设计如此）`)
    else if (r.code >= 400) bad(`GET ${p} → ${r.code}  ${(r.body && r.body.error) || r.raw}`)
    else if (!r.body || r.body.ok === false) bad(`GET ${p} → ${r.code} ok=false：${r.body && r.body.error}`)
    else ok(`GET ${p} → ${r.code}  ${Object.keys(r.body).slice(0, 5).join(',')}`)
  }
  const unk = await hit('GET', '/nonsense')
  unk.code >= 400 ? ok(`未知路径 → ${unk.code}（挡住了）`) : bad(`未知路径 → ${unk.code}（没挡住）`)
  const noHdr = await hit('POST', '/taste', { action: 'summary', text: 'x' }, false)
  noHdr.body && noHdr.body.ok === false ? ok('跨站写保护还在（不带头被挡）') : bad('跨站写保护没了！')
}

// ── 4. 数据文件登记 ──
console.log('')
console.log('══ 数据文件登记 ══')
for (const n of Store.DATA_FILES) {
  const key = Store.FILE_KEYS[n]
  const label = Store.KEY_LABELS[key] || ''
  const owner = Store.KEY_OWNER[key]
  if (!key || !label || !owner) bad(`${n} 登记不全（key=${key} label=${label} owner=${owner}）`)
  else ok(`${n} → ${label} / 面板 ${owner}`)
}
const status = Store.storageStatus()
status.files.length === Store.DATA_FILES.length
  ? ok(`storageStatus 列了全部 ${status.files.length} 个文件`)
  : bad('storageStatus 少列了文件')

try { fs.rmSync(H, { recursive: true, force: true }) } catch { /* 不管 */ }

console.log('')
console.log('══════════════════════════════════════════════')
console.log(`  冒烟：通过 ${pass}  失败 ${fail}`)
console.log('══════════════════════════════════════════════')
process.exit(fail ? 1 : 0)

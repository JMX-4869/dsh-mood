/**
 * 客户端面板测试 —— **真的把它们渲染出来**。
 *
 * ────────────────────────────────────────────────────────────────
 *  为什么必须是这个
 * ────────────────────────────────────────────────────────────────
 *  `client.js` 1700 行，之前**只测过"加载后 apply 不报错"**。
 *  但 apply 注册的只是**懒渲染函数** —— 面板真正跑起来是在用户点开
 *  设置页那一刻。所以：`h is not defined` → 整格白屏、没有错误边界 →
 *  一个面板崩了整页白，这些在 apply 阶段**全都看不出来**。
 *
 *  唯一能拦住的办法：挂到真 DOM 上渲染，**并且等数据回来之后再渲染一遍**。
 *
 * ────────────────────────────────────────────────────────────────
 *  ⚠️ 数据**必须来自 fixtures/**（真接口抓的快照），不能自己编
 * ────────────────────────────────────────────────────────────────
 *  第一版的桩是我手写的，结果和真接口对不上：
 *    · /memory 的 recent 少了 id / id8
 *    · /state 少了 mixed / unlocked / count / moodLabels
 *    · /storage 的字段名**完全不同**（我编的是 root/humanSize，其实是 dir/home/files）
 *    · /diary 我以为是"返回今天的日记"，其实是**单日查询**，不带 date 直接 400
 *  拿编的桩去测，测的是我脑子里的接口，不是真的那个 —— 白测。
 */

// ⚠️ 这份测试要 jsdom + react（插件本身不依赖它们，只用来在 Node 里渲染设置页）。
//
//    原来这里写死了 `工作区里一份手工装的 node_modules` —— 那是我本机手工装的一份。
//    也就是说：**这个文件在别人机器上一直是坏的**，只是我看不见（我这儿有）。
//    现在按顺序找，找不到就**大声跳过**，不再靠一个属于我的目录。
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// ⚠️ 这个目录**不能写死** —— 那既是本机路径，也让别人 clone 下来跑不了。
//    从文件自己的位置往上推：文件在哪，插件根就在哪。
const ROOT = dirname(fileURLToPath(import.meta.url))

const HERE = dirname(fileURLToPath(import.meta.url))
const FX = join(HERE, 'fixtures')

const _cand = [
  process.env.DSHMOOD_NODE_MODULES,          // 显式给
  join(HERE, 'node_modules'),                // 插件自己的
  join(tmpdir(), '_dshmood_rendertest', 'node_modules'),
].filter(Boolean)
const RT = _cand.find((p) => { try { return fs.existsSync(join(p, 'jsdom')) } catch { return false } })

if (!RT) {
  console.log('')
  console.log('  ⏭️  跳过：没找到 jsdom —— **这份测试这次没跑，不是通过了。**')
  console.log('      它用来在 Node 里渲染设置页（真快照 → 真渲一遍 → 比对）。')
  console.log('      装法（二选一）：')
  console.log('        mkdir -p node_modules && npm i --no-save jsdom react react-dom')
  console.log('        DSHMOOD_NODE_MODULES=/某个/有jsdom的/node_modules node test-client.mjs')
  process.exit(0)
}

const req = createRequire(RT + '/')
const { JSDOM } = req('jsdom')
const React = req('react')
const ReactDOMClient = req('react-dom/client')
const { act } = req('react')

let pass = 0, fail = 0
const ok = (n, c, x = '') => { if (c) { pass++; console.log('  ✅ ' + n) } else { fail++; console.log('  ❌ ' + n + (x ? '  → ' + x : '')) } }

// ── 真快照 ──
if (!fs.existsSync(FX + '/state.json')) {
  console.log('  ❌ 没有 fixtures/ —— 先跑 node test-fixtures.mjs --capture 抓一份')
  process.exit(1)
}
const F = {}
for (const f of fs.readdirSync(FX)) {
  if (f.endsWith('.json') && !f.startsWith('_')) F[f.replace('.json', '')] = JSON.parse(fs.readFileSync(FX + '/' + f, 'utf8'))
}
console.log('  用 fixtures/ 里的 ' + Object.keys(F).length + ' 份真快照')
ok('快照里有 state / memory / news / storage / proactive / diary',
  ['state', 'memory', 'news', 'storage', 'proactive', 'diary'].every((k) => F[k]),
  Object.keys(F).join(','))

const diaryDate = F.state && F.state.diaries && F.state.diaries[0] ? F.state.diaries[0].date : '2000-01-01'

// ── 干净的 DOM ──
const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', {
  url: 'http://127.0.0.1:19387/', pretendToBeVisual: true,
})
global.window = dom.window
global.document = dom.window.document
// ⚠️ Node 24 的 navigator 是只读全局属性，直接赋值会抛
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true, writable: true })
for (const k of ['HTMLElement', 'Element', 'Node', 'MutationObserver', 'Event', 'CustomEvent']) global[k] = dom.window[k]
global.IS_REACT_ACT_ENVIRONMENT = true
global.requestAnimationFrame = (cb) => setTimeout(cb, 0)
global.cancelAnimationFrame = (t) => clearTimeout(t)

// ══════════════════════════════════════════════════════════
//  假后端：**按路径路由到真快照**
// ══════════════════════════════════════════════════════════
let mode = 'ok'   // ok | broken | stale
const EMPTY = {
  state: () => ({ ...F.state, current: null, ranked: [], mixed: [], diaries: [], count: 0, memory: { ...F.state.memory, count: 0, bytes: 0 } }),
  diary: () => ({ ok: true, date: diaryDate, text: '', mood: '', moodLabel: '', edited: false }),
  memory: () => ({ ...F.memory, stats: { ...F.memory.stats, count: 0, bytes: 0 }, recent: [] }),
  'memory-search': () => ({ ok: true, query: 'x', stats: F.memory.stats, hits: [] }),
  news: () => ({ ...F.news, count: 0, sources: [], items: [], report: {} }),
  storage: () => ({ ...F.storage, dirs: {}, files: [], leftovers: [] }),
}
function respond(path) {
  if (mode === 'broken') return { ok: false, status: 500, json: async () => ({ ok: false, error: '服务器炸了（测试造的错误）' }) }
  const [base] = path.split('?')
  let name = base.replace(/^\//, '')
  // 搜索走另一份快照
  if (base === '/memory' && path.includes('query=')) name = 'memory-search'
  // /diary 不带 date → 真接口返回 400
  if (base === '/diary' && !path.includes('date=')) {
    return { ok: false, status: 400, json: async () => F['diary-nodate'] || { ok: false, error: '日期格式要 YYYY-MM-DD' } }
  }
  let data = F[name] || { ok: true }
  if (mode === 'stale' && EMPTY[name]) data = EMPTY[name]()
  return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(data)) }
}
const sentHeaders = []          // 写请求发过的头，最后断言跨站保护头带上了
global.fetch = (u, o) => {
  const path = String(u).replace(/^.*\/dsh-mood-api/, '')
  if (o && o.method === 'POST') {
    sentHeaders.push(Object.assign({}, o.headers || {}))
    const name = path.split('?')[0].replace(/^\//, '')
    const body = o.body ? JSON.parse(o.body) : {}
    if (name === 'memory') return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, stats: F.memory.stats }) })
    if (name === 'proactive') return Promise.resolve({ ok: true, status: 200, json: async () => F.proactive })
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) })
  }
  return Promise.resolve(respond(path))
}
global.window.fetch = global.fetch

// ══════════════════════════════════════════════════════════
//  加载 client.js（window.__ModuleLoader__.load 格式）
// ══════════════════════════════════════════════════════════
const src = fs.readFileSync(join(ROOT, 'client.js'), 'utf8')
let captured = null
dom.window.__ModuleLoader__ = { load: (d) => { captured = d } }
dom.window.eval(src)

ok('用 __ModuleLoader__.load 注册了自己', !!captured)
ok('注册 id 是 dsh-mood（必须和 loader entry 名一致）', captured && captured.id === 'dsh-mood', captured && captured.id)
const mod = captured.factory((name) => {
  if (name === 'react') return React
  throw new Error('客户端不该 require 别的：' + name)
})
ok('factory 返回 apply / inject', typeof mod.apply === 'function' && Array.isArray(mod.inject))

// ── apply ──
const sections = [], disposers = []
const slots = {
  inject: (s, fn) => { if (s === 'settings.section') fn() },
  register: (def, render) => { sections.push({ def, render }); return () => {} },
}
mod.apply({ get: (n) => (n === 'slots' ? slots : undefined), effect: (fn) => { disposers.push(fn()); return () => {} } })
await new Promise((r) => setTimeout(r, 80))

ok('注册了设置页（' + sections.length + ' 个）', sections.length >= 4, sections.map((s) => s.def.id).join(','))
ok('注入了 <style id="dsh-mood-style">', !!dom.window.document.getElementById('dsh-mood-style'))
const cssLen = (dom.window.document.getElementById('dsh-mood-style') || {}).textContent || ''
ok('样式表内容非空（' + cssLen.length + ' 字符）', cssLen.length > 500)
ok('样式表里没有 position:fixed（插件规范禁止）', !/position\s*:\s*fixed/.test(cssLen))
// ⚠️ `body` 必须是**选择器**，不是类名的一部分 ——
//    `.dshmood .locked .lock-body{...}` 里的 body 不算（第一版就误报了）。
ok('样式表里没有 body 选择器（插件规范：不许碰 app root）',
  !/(^|[,}\s])body\s*[{,\s]/m.test(cssLen),
  (cssLen.match(/[^\n]*\bbody\b[^\n]*/) || [''])[0].slice(0, 80))
const ids = sections.map((s) => s.def.id)
ok('外部人设存在时「人设」那格不注册', !ids.includes('persona'), ids.join(','))
ok('记忆/主动/心情/时事都在', ['memory', 'proactive', 'mood', 'news'].every((x) => ids.includes(x)), ids.join(','))

// ══════════════════════════════════════════════════════════
//  渲染
// ══════════════════════════════════════════════════════════
async function renderPanel(render, waitMs = 100) {
  const host = dom.window.document.createElement('div')
  dom.window.document.body.appendChild(host)
  const errs = [], warns = []
  const oldErr = console.error, oldWarn = console.warn
  // ⚠️ 别只 `String(a[0])` —— React 的警告是 `console.error('...%s...', 值)` 这种格式，
  //    丢掉后面的参数就等于**把唯一有用的信息扔了**：
  //    实测报出来只有「Encountered two children with the same key, %s」，
  //    `%s` 原样留着 —— 根本不知道是哪个 key 撞了，只能回去瞎猜。
  //    （和今晚那几个"信号说了不算数"同一族：**仪器把该说的咽了**。）
  const fmt = (a) => a.map((x) => {
    if (typeof x === 'string') return x
    try { return JSON.stringify(x) } catch { return String(x) }
  }).join(' ')
  console.error = (...a) => { errs.push(fmt(a)) }
  console.warn = (...a) => { warns.push(fmt(a)) }
  let root = null, threw = null
  try {
    await act(async () => { root = ReactDOMClient.createRoot(host); root.render(render()) })
    await act(async () => { await new Promise((r) => setTimeout(r, waitMs)) })
  } catch (e) { threw = (e && e.message) || String(e) }
  console.error = oldErr; console.warn = oldWarn
  const html = host.innerHTML
  try { if (root) await act(async () => { root.unmount() }) } catch { /* 不管 */ }
  host.remove()
  return { html, errs: errs.concat(warns), threw }
}
const textOf = (html) => html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

for (const m of ['ok', 'stale', 'broken']) {
  mode = m
  console.log()
  console.log('════ 渲染 · ' + ({ ok: '正常数据（真快照）', stale: '空数据', broken: '接口报错' }[m]) + ' ════')
  for (const s of sections) {
    const label = String(s.def.label || s.def.id)
    const r = await renderPanel(s.render)
    const text = textOf(r.html)
    const clean = !r.threw && r.errs.length === 0 && r.html.length > 20
    if (m === 'broken') {
      // 报错时**必须显示错误**，不能白屏
      ok(label + ' 报错时显示出来了（不是白屏）', !r.threw && text.length > 4, r.threw || JSON.stringify(text.slice(0, 60)))
    } else {
      ok(label + ' 渲染无异常（' + r.html.length + ' 字符 / ' + text.length + ' 字）', clean,
        // ⚠️ 截断别设太短：React 的 key 警告**值在最后面**，140 字符正好把它切掉，
        //    于是每次只看到一条没有值的警告 —— 又一次"仪器把该说的咽了"。
        r.threw ? ('抛出：' + r.threw) : (r.errs.length ? ('React 警告：' + r.errs.slice(0, 2).join(' | ').slice(0, 400)) : 'DOM 太短'))
      ok(label + ' 有可见文字', text.length > 10, JSON.stringify(text.slice(0, 60)))
    }
  }
}

// ── 错误边界 ──
console.log()
console.log('════ 错误边界（面板渲染期抛错时不许白屏）════')
{
  mode = 'ok'
  const oldFetch = global.fetch
  global.fetch = () => { throw new Error('故意炸的（测试用）') }
  let threw = null
  const host = dom.window.document.createElement('div')
  dom.window.document.body.appendChild(host)
  const oldErr = console.error; console.error = () => {}
  try {
    const root = ReactDOMClient.createRoot(host)
    const target = sections.find((s) => s.def.id === 'memory')
    await act(async () => { root.render(target.render()) })
    await act(async () => { await new Promise((r) => setTimeout(r, 60)) })
  } catch (e) { threw = (e && e.message) || String(e) }
  console.error = oldErr
  global.fetch = oldFetch
  const t = textOf(host.innerHTML)
  ok('异常没被抛到 React 外面', !threw, threw || '')
  console.log('     出错时显示：' + JSON.stringify(t.slice(0, 80) || '（空）'))
}

// ── 卸载 ──
console.log()
console.log('════ 交互：点按钮 → 必须带跨站保护头 ════')
// ⚠️ 首屏渲染**一个 POST 都不发**（只 GET），所以光渲染是验不到这个头的。
//    第一版就是这么写的，断言 `sentHeaders.length > 0` 直接暴露它自己是空的。
//    要真验证，得把面板挂上去、**点一个真的按钮**。
{
  mode = 'ok'
  sentHeaders.length = 0
  const mem = sections.find((s) => s.def.id === 'memory')
  const host = dom.window.document.createElement('div')
  dom.window.document.body.appendChild(host)
  const oldErr = console.error; console.error = () => {}
  const root = ReactDOMClient.createRoot(host)
  await act(async () => { root.render(mem.render()) })
  await act(async () => { await new Promise((r) => setTimeout(r, 120)) })

  const btns = [...host.querySelectorAll('button')]
  ok('面板里有按钮可点（' + btns.length + ' 个）', btns.length > 0, btns.map((b) => b.textContent).join(' | ').slice(0, 100))
  const target = btns.find((b) => /只存|清空|打开|关掉/.test(b.textContent || ''))
  ok('找到那个会发 POST 的按钮：' + JSON.stringify(target ? target.textContent : ''), !!target)
  if (target) {
    await act(async () => { target.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })) })
    await act(async () => { await new Promise((r) => setTimeout(r, 150)) })
    ok('点击真的发出了 POST（' + sentHeaders.length + ' 个）', sentHeaders.length > 0)
    ok('每个写请求都带 x-dsh-mood: 1', sentHeaders.length > 0 && sentHeaders.every((h) => h['x-dsh-mood'] === '1'),
      JSON.stringify(sentHeaders.slice(0, 2)))
  }
  console.error = oldErr
  try { await act(async () => { root.unmount() }) } catch { /* 不管 */ }
  host.remove()
}

console.log()
console.log('════ 卸载 ════')
for (const d of disposers) { try { if (typeof d === 'function') d() } catch { /* 不管 */ } }
ok('卸载后样式表被摘掉（不留孤儿 <style>）', !dom.window.document.getElementById('dsh-mood-style'))

console.log()
console.log('════ 写请求必须带跨站保护头 ════')
ok('这次渲染里至少发出过一个 POST（否则这条断言是空的）', sentHeaders.length > 0, sentHeaders.length + '')
ok('每个 POST 都带 x-dsh-mood: 1', sentHeaders.every((h) => h['x-dsh-mood'] === '1'),
  JSON.stringify(sentHeaders.filter((h) => h['x-dsh-mood'] !== '1').slice(0, 2)))

console.log()
console.log('  通过 ' + pass + '  失败 ' + fail)
process.exit(fail ? 1 : 0)

/**
 * 验「-1 = 无上限」。
 * ⚠️ 直接测模块 —— 跑着的插件还是旧代码，走 HTTP 路由测的是旧的。
 * ⚠️ createMemory 的 API 是 note(kind,text,session,ts) / flush()，trim 是内部的（flush 时会自己调）。
 */
import fs from 'node:fs'
import { createMemory, isUnlimited, UNLIMITED, DEFAULT_MAX_BYTES, MIN_CHARS } from './memory.js'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const F = join(tmpdir(), '_dshmood_memtest.jsonl')
const MB = 1024 * 1024
const out = []
const ok = (n, c, e = '') => out.push('  ' + (c ? '✅' : '❌') + ' ' + n + (e ? '  → ' + e : ''))
const LINE = '这是一条测试回复，长度足够越过 MIN_CHARS 的门槛。'.padEnd(MIN_CHARS + 20, '。')

fs.rmSync(F, { force: true })

// ── ① isUnlimited 判断
ok('isUnlimited(-1) 为真', isUnlimited(-1) === true)
ok('isUnlimited(0) 为假（0 走默认，不是无上限）', isUnlimited(0) === false)
ok('isUnlimited(50) 为假', isUnlimited(50) === false)
ok('isUnlimited(undefined) 为假', isUnlimited(undefined) === false)
ok('UNLIMITED === -1', UNLIMITED === -1)

// ── ② 无上限时的 stats
let cfg = () => -1
const m1 = createMemory({ file: () => F, maxBytes: () => cfg() })
for (let i = 0; i < 30; i++) m1.note('a', LINE + i, 's1', Date.now() - i * 1000)
m1.flush()
const s1 = m1.stats()
ok('无上限：stats().maxBytes 报 -1', s1.maxBytes === -1, String(s1.maxBytes))
ok('无上限：unlimited 标记为真', s1.unlimited === true)
ok('无上限：占用比是 0（不参与百分比）', s1.usedRatio === 0, String(s1.usedRatio))
ok('无上限：还能撑报 0 而不是 Infinity', s1.daysLeft === 0, String(s1.daysLeft))
const wire = JSON.parse(JSON.stringify(s1))
ok('**过一遍 JSON 还是 -1**（Infinity 会变成 null）', wire.maxBytes === -1, JSON.stringify(wire.maxBytes))
ok('过 JSON 之后 unlimited 还在', wire.unlimited === true)

// ── ③ 无上限时真的不清理：写到远超默认上限
const big = '长'.repeat(3000)
const before = m1.stats().count
for (let i = 0; i < 300; i++) m1.note('a', big + i, 's1', Date.now())
m1.flush()
const after = m1.stats()
ok('无上限：写到 ' + Math.round(after.bytes / MB * 10) / 10 + ' MB 之后**一条没丢**',
  after.count === before + 300 && after.trimmed === 0,
  '条数 ' + before + ' → ' + after.count + '，累计丢弃 ' + after.trimmed)

// ── ④ 对照组：限 1 MB，看它真的丢
fs.rmSync(F, { force: true })
cfg = () => 1 * MB
const m2 = createMemory({ file: () => F, maxBytes: () => cfg() })
for (let i = 0; i < 600; i++) m2.note('a', big + i, 's1', Date.now())
m2.flush()
const s2 = m2.stats()
ok('对照组（上限 1 MB）：**真的会丢** —— 说明这套确实在管', s2.trimmed > 0, '丢了 ' + s2.trimmed + ' 条')
ok('对照组：体积被压到上限以内', s2.bytes <= 1 * MB, (s2.bytes / 1024).toFixed(0) + ' KB')
ok('对照组 stats().maxBytes 是正数 1 MB', s2.maxBytes === 1 * MB, String(s2.maxBytes))

// ── ⑤ 0 / 垃圾值仍然走默认（别把"没填"也当成无上限）
fs.rmSync(F, { force: true })
for (const [label, v] of [['0', 0], ['NaN', NaN], ['undefined', undefined], ['"abc"', 'abc']]) {
  const m = createMemory({ file: () => F, maxBytes: () => v })
  const s = m.stats()
  ok('填 ' + label + ' 仍然走默认上限（不等于无上限）', s.maxBytes === DEFAULT_MAX_BYTES, String(s.maxBytes))
}

fs.rmSync(F, { force: true })
console.log(out.join('\n'))
const bad = out.filter((x) => x.includes('❌')).length
console.log('')
console.log('  通过 ' + (out.length - bad) + '  失败 ' + bad)
// ⚠️ 必须以退出码收尾 —— 不然这个文件**永远不会失败**（审计专门查这一条）。
process.exit(bad ? 1 : 0)

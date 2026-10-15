import fs from 'node:fs'
import { createMemory, MIN_CHARS, MAX_CHARS } from './memory.js'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// ⚠️ 这个目录**不能写死** —— 那既是本机路径，也让别人 clone 下来跑不了。
//    从文件自己的位置往上推：文件在哪，插件根就在哪。
const ROOT = dirname(fileURLToPath(import.meta.url))

const TMP = join(tmpdir(), '_dshmood_memtest')
fs.rmSync(TMP, { recursive: true, force: true })
fs.mkdirSync(TMP, { recursive: true })

let pass = 0, fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ✅ ' + name) }
  else { fail++; console.log('  ❌ ' + name + (extra ? '  → ' + extra : '')) }
}

// 路径用可变变量 —— 模拟"配置被改掉之后路径跟着变"
let DIR = TMP
const mem = createMemory({ file: () => DIR + '/dsh-mood-memory.jsonl', log: (m) => console.log('    [log] ' + m) })

// ── ① 短句被丢掉 ──
ok('短于 ' + MIN_CHARS + ' 字不收', mem.note('user', '嗯', 'sess1', 1000) === false)
ok('长的收下', mem.note('user', '帮我把那个心情插件的存储位置改到 D 盘去', 'sess1', 1001) === true)

// ── ② 去重（批内 + 跨批）──
mem.note('assistant', '好的，我先把当前目录记下来，再改指针文件。', 'sess1', 1002)
mem.note('assistant', '好的，我先把当前目录记下来，再改指针文件。', 'sess1', 1002)  // 同一 id，同一批
const w1 = mem.flush()
ok('批内去重（3 条只写 2 条）', w1 === 2, '实际写入 ' + w1)

mem.note('assistant', '好的，我先把当前目录记下来，再改指针文件。', 'sess1', 1002)  // 同一 id，跨批
const w2 = mem.flush()
ok('跨批去重（这次写 0 条）', w2 === 0, '实际写入 ' + w2)

ok('文件落盘了', fs.existsSync(DIR + '/dsh-mood-memory.jsonl'))
const lines = fs.readFileSync(DIR + '/dsh-mood-memory.jsonl', 'utf8').trim().split('\n')
ok('文件里 2 行', lines.length === 2, '实际 ' + lines.length)

// ── ③ 中文检索 ──
mem.note('user', '平板上的字太小了，看着费眼睛', 'sess2', 2000)
mem.note('user', '帮我把视频的配乐换成钢琴曲', 'sess3', 2001)
mem.note('assistant', '钢琴那版是 A 小调，66 BPM，用正弦波合成的', 'sess3', 2002)
mem.flush()

const r1 = mem.search('钢琴')
ok('搜「钢琴」能搜到', r1.length >= 2, '命中 ' + r1.length)
ok('第一条和配乐有关', r1.length > 0 && /钢琴|配乐|BPM|小调/.test(r1[0].x), r1[0] && r1[0].x.slice(0, 40))

const r2 = mem.search('平板 字 眼睛')
ok('搜「平板 字 眼睛」命中平板那条', r2.length >= 1 && r2[0].x.includes('平板'), r2[0] && r2[0].x.slice(0, 40))

ok('搜不到就返回空', mem.search('完全不存在的东西xyz').length === 0)

// ── ④ 长度惩罚（两条都过门槛）──
const mem2 = createMemory({ file: () => DIR + '/m2.jsonl' })
mem2.note('user', '存储位置改到别的盘去了', 's', 1000)
mem2.note('user', '存储位置改到别的盘去了然后我又想了想，其实还是不要改比较好，因为'.repeat(6), 's', 1001)
mem2.flush()
const r4 = mem2.search('存储位置')
ok('长度惩罚生效（短的排前面）', r4.length === 2 && r4[0].x.length < r4[1].x.length,
  r4.map((x) => x.x.length).join(' vs '))

// ── ⑤ 跨会话 ──
// 往同一个归档里再塞一条"另一个会话"的话
mem.note('user', '存储位置那件事，另一个会话里也聊过', 'sess9', 3000)
mem.flush()
const r5 = mem.search('存储位置')
ok('检索跨会话（不止一个会话的来源）', new Set(r5.map((x) => x.s)).size >= 2,
  [...new Set(r5.map((x) => x.s))].join(','))

// ── ⑥ 超长截断 ──
const mem3 = createMemory({ file: () => DIR + '/m3.jsonl' })
mem3.note('assistant', 'x'.repeat(MAX_CHARS + 500), 's', 1000)
mem3.flush()
const big = mem3.recent(1)[0]
ok('超长被截断到 ' + MAX_CHARS, big.x.length < MAX_CHARS + 60, '实际 ' + big.x.length)
ok('截断有标记', big.x.includes('[截断]'))

// ── ⑦ 迁移（关键：onMoved 改配置 + 闭包读新路径）──
// ⚠️ 必须在 DIR 还指着**旧**目录的时候调 moveTo —— 否则它算出"原地不动"。
//    （第一版我在调用前就把 DIR 改了，三个断言全挂。）
const NEWDIR = TMP + '/newdir'
const r6 = mem.moveTo(NEWDIR, (d) => { DIR = d })
ok('迁移成功', r6.ok === true, JSON.stringify(r6))
ok('新目录里有文件', fs.existsSync(NEWDIR + '/dsh-mood-memory.jsonl'))
ok('旧目录的文件没了', !fs.existsSync(TMP + '/dsh-mood-memory.jsonl'))
ok('迁移后还能搜到', mem.search('钢琴').length >= 2)
ok('迁移后 stats 的路径是新的', mem.stats().path.includes('newdir'), mem.stats().path)
ok('迁移后 stats 有内容', mem.stats().count > 0, mem.stats().count + '')

// ── ⑧ 迁移不覆盖（目标已有内容）──
const memA = createMemory({ file: () => TMP + '/a.jsonl' })
memA.note('user', '这是 A 目录里的内容啊啊啊', 's', 1000); memA.flush()
fs.mkdirSync(TMP + '/dst', { recursive: true })
fs.writeFileSync(TMP + '/dst/dsh-mood-memory.jsonl',
  JSON.stringify({ id: 'x', t: 999, s: 's', k: 'u', x: '这是目标目录里本来就有的内容' }) + '\n', 'utf8')
let DIRA = TMP + '/dst'
const memA2 = createMemory({ file: () => DIRA + '/dsh-mood-memory.jsonl' })
const r7 = memA.moveTo(TMP + '/dst', (d) => { DIRA = d })
const merged = fs.readFileSync(TMP + '/dst/dsh-mood-memory.jsonl', 'utf8')
ok('迁移不覆盖目标，两边内容都在', merged.includes('A 目录') && merged.includes('目标目录'), r7.ok + '')
ok('合并后能搜到原来两个目录的内容', memA2.search('内容').length === 2, memA2.search('内容').length + '')

// ── ⑨ 坏行不影响整体 ──
fs.writeFileSync(TMP + '/bad.jsonl', 'not json\n{"id":"a","t":1,"s":"s","k":"u","x":"这行是好的内容啊"}\n{oops\n', 'utf8')
const memB = createMemory({ file: () => TMP + '/bad.jsonl' })
ok('坏行被跳过、好行还在', memB.load().length === 1 && memB.search('好的内容').length === 1)

// ── ⑩ stats ──
const st = mem.stats()
ok('stats 有路径和条数', typeof st.path === 'string' && st.count > 0 && st.bytes > 0,
  JSON.stringify({ count: st.count, bytes: st.bytes, sessions: st.sessions }))

// ── ⑪ clear ──
mem.clear()
ok('清空后没有文件', !fs.existsSync(DIR + '/dsh-mood-memory.jsonl'))
ok('清空后搜不到', mem.search('钢琴').length === 0)

fs.rmSync(TMP, { recursive: true, force: true })
console.log()
console.log('  通过 ' + pass + '  失败 ' + fail)
process.exit(fail ? 1 : 0)

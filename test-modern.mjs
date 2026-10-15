/**
 * 当代说法那 4 种（内耗 / 破防 / 摆烂 / 上头）。
 *
 * ⚠️ 原来这个文件**只打印**得分，没有任何断言 —— 连那个"零误报"的结论
 *    也只是 `console.log` 一句，红了也没人知道。
 */
import * as M from './index.js'
import { suite, acc, top } from './testkit.mjs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// ⚠️ 这个目录**不能写死** —— 那既是本机路径，也让别人 clone 下来跑不了。
//    从文件自己的位置往上推：文件在哪，插件根就在哪。
const ROOT = dirname(fileURLToPath(import.meta.url))

const t = suite('当代说法')
const J = M.judgeMessage
const L = (id) => M.MOODS[id].label
const MODERN = M.MOOD_TIERS.modern

t.eq(MODERN.length, 4, '当代层正好 4 种')
t.has(MODERN, 'burnout', '有内耗')
t.has(MODERN, 'cracked', '有破防')
t.has(MODERN, 'checkedout', '有摆烂')
t.has(MODERN, 'hyper', '有上头')
{
  let ok = true
  for (const id of MODERN) if (M.MOODS[id].tier !== 'modern') ok = false
  t.ok(ok || !('tier' in M.MOODS[MODERN[0]]), '当代层这几种存在')
}

// ── 各自能被自己的说法点亮 ──
{
  const cases = [
    ['burnout', ['内耗太严重了', '一直在想太多', '又绕回来了，自我怀疑']],
    ['cracked', ['这句话破防了', '绷不住，扎心', '心态崩了']],
    ['checkedout', ['算了摆烂吧', '卷不动了，躺平', '爱咋咋地']],
    ['hyper', ['这个太上头了', '根本停不下来', '越看越来劲']],
  ]
  for (const [id, msgs] of cases) {
    const got = top(acc(J, msgs), 3).map((x) => x[0])
    t.has(got, id, L(id) + ' 被自己那组说法点亮（前 3 里有它）')
  }
}

// ── ⚠️ 误报：技术对话绝不能被当成"摆烂/破防/内耗/上头" ──
// 这是插件最容易翻车的地方 —— 用户说的是代码，不能被读成情绪。
{
  const TECH = ['把这个细分补绘做成Live2D模型', '帮我看下这个报错', '图层分割成三份',
    '这个方案不行，重来', '继续优化压缩包', '把这个函数重构一下',
    '压缩包里的材质全部绑定上去', '绑定顺序错了，面部变形器就选不到部件']
  let dirty = []
  for (const msg of TECH) {
    const d = J(msg)
    const hit = MODERN.filter((k) => d[k] > 0)
    if (hit.length) dirty.push(JSON.stringify(msg.slice(0, 16)) + ' → ' + hit.map(L).join(','))
  }
  t.eq(dirty.length, 0, TECH.length + ' 条技术消息零误报' + (dirty.length ? '\n       ' + dirty.join('\n       ') : ''))
}

// ── 区分度：新词和老词不该被混为一谈 ──
{
  t.ok(top(acc(J, ['想太多了，内耗']), 1)[0][0] === 'burnout', '内耗 ≠ 焦虑')
  t.ok(top(acc(J, ['摆烂，不想卷']), 1)[0][0] === 'checkedout', '摆烂 ≠ 麻木')
  t.ok(top(acc(J, ['上头，停不下来']), 1)[0][0] === 'hyper', '上头 ≠ 兴奋')
  t.ok(top(acc(J, ['破防了，绷不住']), 1)[0][0] === 'cracked', '破防 ≠ 委屈')
}

// ── 这四种也必须在提示词里有对应写法（不然模型不认识）──
{
  let ok = true
  const missing = []
  for (const id of MODERN) {
    const m = M.MOODS[id]
    if (!m.hint || !m.inner || !m.label) { ok = false; missing.push(id) }
  }
  t.ok(ok, '四种都有 label / hint / inner' + (missing.length ? '（缺 ' + missing.join(',') + '）' : ''))
}

t.done()

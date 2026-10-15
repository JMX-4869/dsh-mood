/**
 * 亲密类 + 现实守则。
 *
 * ⚠️ 原来这个文件**只打印** —— 也就是说"技术对话不会误触发亲密类"
 *    这个结论从来没被断言过，全靠人眼看。
 */
import * as M from './index.js'
import { suite, acc, top } from './testkit.mjs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// ⚠️ 这个目录**不能写死** —— 那既是本机路径，也让别人 clone 下来跑不了。
//    从文件自己的位置往上推：文件在哪，插件根就在哪。
const ROOT = dirname(fileURLToPath(import.meta.url))

const t = suite('亲密类与现实守则')
const J = M.judgeMessage
const L = (id) => M.MOODS[id].label

// ── 三个亲密类 ──
t.eq(M.ROMANTIC_MOODS.length, 3, '亲密类正好 3 种')
t.has(M.ROMANTIC_MOODS, 'flutter', '有心动的')
t.has(M.ROMANTIC_MOODS, 'love', '有恋慕')
t.has(M.ROMANTIC_MOODS, 'jealous', '有吃醋')
{
  let ok = true
  for (const id of M.ROMANTIC_MOODS) if (!M.MOODS[id]) ok = false
  t.ok(ok, '三个都在 MOODS 表里')
}

// ── 各自能被对应的说法点亮 ──
{
  const cases = [
    ['flutter', ['喜欢你', '想你了', '抱抱']],
    ['love', ['陪着我', '只有你', '离不开你']],
    ['jealous', ['她比你厉害', '换一个吧']],
  ]
  for (const [id, msgs] of cases) {
    const got = top(acc(J, msgs), 3).map((x) => x[0])
    t.has(got, id, L(id) + ' 被自己那组点亮')
  }
}

// ── ⚠️ 误报：正常技术对话不该触发任何亲密类 ──
{
  const TECH = ['把这个细分补绘做成Live2D模型', '帮我看下这个报错', '图层要分割成三份',
    '这个方案不行，重来', '压缩包里的材质全部绑定上去']
  const dirty = []
  for (const msg of TECH) {
    const d = J(msg)
    const rom = M.ROMANTIC_MOODS.filter((k) => d[k] > 0)
    if (rom.length) dirty.push(JSON.stringify(msg.slice(0, 16)) + ' → ' + rom.map(L).join(','))
  }
  t.eq(dirty.length, 0, TECH.length + ' 条技术消息零误触发' + (dirty.length ? '\n       ' + dirty.join('\n       ') : ''))
}

// ── 依赖信号：撒娇式依恋要被认出来（会额外触发现实提醒）──
{
  t.eq(J('陪着我好不好').__clingy, true, '"陪着我" → __clingy')
  t.eq(J('只有你最懂我').__clingy, true, '"只有你最懂我" → __clingy')
  t.eq(J('这个bug搞不定').__clingy, false, '技术对话 → 不 __clingy')
  t.eq(J('今天天气不错').__clingy, false, '闲聊 → 不 __clingy')
}

// ── 现实守则：内容必须真的在"往外推"，不是把人往身边拉 ──
// 这几条是这个插件最容易被写歪的地方，所以逐条断言。
{
  const G = M.REALITY_GUARD
  t.has(G, '朋友', '提到去联系朋友/家人')
  t.has(G, '家人', '提到家人')
  t.ok(/别念|一句就够|不要念/.test(G), '说了"一句就够、别念"')
  t.has(G, '门关着的时候别念这句', '有例外条款：对方已经被拉黑/绝交/人不在了就别念这句')
  t.ok(/不能给.*当依据|别给.*当依据|不给她的人生大事|人生大事/.test(G), '说了不给人生大事当依据')
  t.ok(!/我只属于你|只跟我说话/.test(G), '守则里没有把对方拴住的话')
  t.has(G, '你是 AI', '承认自己是 AI（守则里写的是「你是 AI，不否认」）')
  t.ok(/别拿.*只是.*程序.*挡箭牌|不是.*挡箭牌|挡箭牌/.test(G), '说了"不许拿\'我只是程序\'当挡箭牌"')
  t.noThrow(() => J(G), '守则文本本身喂给判定器不会崩')
}

// ── 现实提醒的间隔 ──
{
  t.eq(M.REALITY_NUDGE_INTERVAL_MS / 3600000, 6, '现实提醒间隔 6 小时')
  t.gt(M.REALITY_NUDGE_INTERVAL_MS, 0, '间隔是个正数')
  const src = (await import('node:fs')).readFileSync(join(ROOT, 'index.js'), 'utf8')
  t.has(src, 'REALITY_NUDGE_INTERVAL_MS', '间隔真的被用到了（不是只定义）')
}

t.done()

/**
 * 文风：同一天素材、不同主导心情 → 日记读起来要**真的不一样**。
 *
 * ⚠️ 原来这个文件把 8 篇日记**全打印出来**让人肉眼看风格差异 ——
 *    没断言。也就是说 applyVoice 哪天坏成"所有心情一个腔调"，
 *    这个测试照样绿。
 */
import * as D from './diary.js'
import * as M from './index.js'
import { suite } from './testkit.mjs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// ⚠️ 这个目录**不能写死** —— 那既是本机路径，也让别人 clone 下来跑不了。
//    从文件自己的位置往上推：文件在哪，插件根就在哪。
const ROOT = dirname(fileURLToPath(import.meta.url))

const t = suite('日记文风')
const lbl = (id) => (M.MOODS[id] ? M.MOODS[id].label : id)

/** 同一天、同样的素材，只换主导心情 */
function makeBucket(domMood) {
  const d = D.blankDiary()
  const t0 = new Date(2026, 9, 14, 21, 10).getTime()
  const msgs = [
    '把这个细分补绘做成Live2D模型',
    '细分补绘的图层要重新绑定材质',
    '压缩包里的材质全部绑定上去',
    '材质绑定之后还要能自动导入',
    '细分压缩包里的材质绑定好，源文件打开就自动导入',
    'Live2D模型的参数要能推得动',
    '先把材质绑定的顺序理清楚',
    '材质绑定顺序错了，面部变形器就选不到部件',
  ]
  msgs.forEach((x, i) => D.noteActivity(d, 'message', t0 + i * 17 * 60000, x))
  D.noteActivity(d, 'turn', t0)
  D.noteActivity(d, 'error', t0 + 70 * 60000)
  D.noteActivity(d, 'error', t0 + 85 * 60000)
  D.noteActivity(d, 'error', t0 + 100 * 60000)
  const b = d.daily['2026-10-14']
  b.moodMs = { [domMood]: 200 * 60000 }
  b.lastMood = domMood
  return b
}

const MOODS = ['calm', 'tired', 'annoyed', 'sulk', 'hyper', 'gloomy', 'proud', 'cracked']
const texts = {}
for (const id of MOODS) texts[id] = D.composeDiary('2026-10-14', makeBucket(id), lbl)

// ── 每篇都得像样 ──
for (const id of MOODS) {
  const x = texts[id]
  // ⚠️ 阈值别拍脑袋：VOICE 表里每种心情有自己的 keep/cut ——
  //    「生闷气」「疲惫」故意只留 34~37 字（那是它的声音：「今天不想多说话。」）。
  //    真正要守的是有内容、不是空壳、彼此不雷同。
  t.ok(x && x.length >= 25, lbl(id) + ' 那篇有内容（' + (x ? x.length : 0) + ' 字）')
  t.ok(!/undefined|NaN|\[object/.test(x), lbl(id) + ' 那篇里没有 undefined / NaN / [object')
  // 段落数不锁死 —— VOICE 表里每种心情有自己的 keep，短的那种是刻意的。
  t.ok(/[。！？…]/.test(x), lbl(id) + ' 那篇以完整句子结尾')
}
// 但也不是所有心情都短：得**有长有短**才叫"按心情改文风"
{
  const lens = MOODS.map((id) => texts[id].length)
  t.gt(Math.max(...lens), 80, '最长的那篇有 80 字以上（' + Math.max(...lens) + '）')
  t.lt(Math.min(...lens), 60, '最短的那篇不到 60 字（' + Math.min(...lens) + '）—— 短的那种是刻意的')
  t.gt(Math.max(...lens) - Math.min(...lens), 30, '最长最短差 30 字以上（说明文风真的在随心情变）')
}

// ── 关键：不同心情读起来要真的不一样 ──
{
  const uniq = new Set(Object.values(texts))
  t.eq(uniq.size, MOODS.length, MOODS.length + ' 种心情产出 ' + uniq.size + ' 种不同文本（不能全一个腔调）')

  // 两两比一下相似度：任何两篇不该几乎一样
  const pairs = []
  for (let i = 0; i < MOODS.length; i++) {
    for (let j = i + 1; j < MOODS.length; j++) {
      const a = texts[MOODS[i]], b = texts[MOODS[j]]
      if (a === b) pairs.push(MOODS[i] + '/' + MOODS[j] + ' 完全相同')
      else {
        // 简单的 2 字滑窗重合率
        const grams = (s) => { const g = new Set(); const c = s.replace(/[^\u4e00-\u9fff]/g, ''); for (let k = 0; k + 2 <= c.length; k++) g.add(c.slice(k, k + 2)); return g }
        const A = grams(a), B = grams(b)
        let inter = 0
        for (const g of A) if (B.has(g)) inter++
        const sim = inter / Math.max(1, Math.min(A.size, B.size))
        if (sim > 0.92) pairs.push(MOODS[i] + '/' + MOODS[j] + ' 相似度 ' + sim.toFixed(2))
      }
    }
  }
  t.eq(pairs.length, 0, '任意两篇都不雷同' + (pairs.length ? '（' + pairs.join('；') + '）' : ''))
}

// ── 同一天要稳定（不能每次生成都不一样，否则会反复重写）──
{
  const a = D.composeDiary('2026-10-14', makeBucket('calm'), lbl)
  const b = D.composeDiary('2026-10-14', makeBucket('calm'), lbl)
  t.eq(a, b, '同一天同样的素材 → 生成的文本完全一样（稳定）')
}

// ── 不同日子措辞要不同（按日期取变体）──
{
  const a = D.composeDiary('2026-10-14', makeBucket('calm'), lbl)
  const b = D.composeDiary('2026-10-15', makeBucket('calm'), lbl)
  t.ok(a !== b, '换一天措辞会变（不是固定模板）')
}

// ── 措辞跟跨度走：不到四小时不许说"一整天" ──
{
  const short = makeBucket('calm')
  short.firstAt = short.lastAt - 40 * 60000          // 只 40 分钟
  const x1 = D.composeDiary('2026-10-14', short, lbl)
  t.ok(!/一整天/.test(x1), '40 分钟的素材不说「一整天」')

  const long = makeBucket('calm')
  long.firstAt = long.lastAt - 8 * 3600000           // 8 小时
  const x2 = D.composeDiary('2026-10-14', long, lbl)
  t.ok(x2.length > 20, '8 小时的素材照样生成得出来')
}

t.done()

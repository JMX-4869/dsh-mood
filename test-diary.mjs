/**
 * 日记：生成、幂等、保护手写内容、清理。
 *
 * ⚠️ 原来这个文件**只打印**（"第一次: 新建 / 第二次: 跳过（内容没变，正确）"）——
 *    这几条恰恰是**数据安全**相关的：
 *    · 模型改写过的那篇不能被自动生成覆盖
 *    · 重复 ensure 不能反复重写
 *    · 素材清理不能把还没用上的删掉
 *    全靠人眼看输出守着，不合适。
 */
import * as D from 'file:///D:/chajian/dsh-mood/diary.js'
import { MOODS } from 'file:///D:/chajian/dsh-mood/index.js'
import { suite } from './testkit.mjs'

const t = suite('日记')
const lbl = (id) => (MOODS[id] ? MOODS[id].label : id)
const at = (h, m, day = 13) => new Date(2026, 9, day, h, m, 0)

// ── 到点判定 ──
t.eq(D.DIARY_HOUR, 23, '生成时刻 23 点')
t.eq(D.DIARY_MINUTE, 59, '23:59 生成')
t.eq(D.diaryDue(at(23, 58)), false, '23:58 还没到点')
t.eq(D.diaryDue(at(23, 59)), true, '23:59 到点了')
t.eq(D.diaryDue(at(0, 30, 14)), false, '次日 00:30 不是生成时刻')
t.eq(D.dateKey(at(15, 0)), '2026-10-13', 'dateKey 用本地日期')
t.eq(D.dateKey(at(0, 5)), '2026-10-13', '凌晨也算当天（不是前一天）')

// ── 攒素材 ──
const d = D.blankDiary()
let ts = at(9, 12).getTime()
D.noteActivity(d, 'message', ts)
D.noteMood(d, 'calm', ts)
for (let i = 0; i < 35; i++) {
  ts += 9 * 60 * 1000
  D.noteActivity(d, i % 3 === 0 ? 'turn' : 'message', ts)
  if (i === 12) { D.noteSwitch(d, 'calm', 'curious', ts); D.noteMood(d, 'curious', ts) }
  if (i === 24) { D.noteSwitch(d, 'curious', 'happy', ts); D.noteMood(d, 'happy', ts) }
  if (i === 30) { D.noteActivity(d, 'error', ts); D.noteActivity(d, 'error', ts) }
}
D.noteMood(d, 'happy', ts + 20 * 60 * 1000)

const key = D.dateKey(at(0, 0))
const b = d.daily[key]
t.ok(b, '素材攒到了当天桶里')
t.gt(b.messages, 0, '消息数 > 0（' + b.messages + '）')
t.gt(b.turns, 0, '轮次数 > 0（' + b.turns + '）')
t.eq(b.errors, 2, '报错数记了 2')
t.eq(b.switches.length, 2, '切换记了 2 次')
t.gt(Object.keys(b.moodMs).length, 0, '心情停留时长有记录')
{
  const dom = D.dominantMood(b)
  t.ok(!!MOODS[dom], '主导心情是个合法值：' + lbl(dom))
  // ⚠️ 实测是 calm：noteMood('calm') 在开头就记上了，happy 只在末尾记一次。
  //    旧脚本只打印不断言，我照抄了它没验证过的猜测。
  t.eq(dom, 'calm', '停留最久的是平静（开头就记上、跨度最长）')
}

// ── 合成 ──
{
  const text = D.composeDiary(key, b, lbl)
  t.ok(text && text.length > 40, '合成出正文（' + text.length + ' 字）')
  t.ok(!/undefined|NaN|\[object/.test(text), '正文里没有 undefined / NaN / [object')
  t.ok(text.split('\n\n').filter(Boolean).length >= 2, '分了至少两段')
  t.ok(!/[%％]/.test(text), '正文里没有百分比（数字要软化，不是状态报告）')
}

// ── ensureDiary 幂等 ──
{
  const r1 = D.ensureDiary(d, key, lbl)
  t.ok(r1 && r1.created === true, '第一次是新建')
  const text1 = d.entries.find((e) => e.date === key).text
  const r2 = D.ensureDiary(d, key, lbl)
  t.eq(r2, null, '第二次返回 null（内容没变，不该重写）')
  t.eq(d.entries.length, 1, '还是只有一篇（不会重复插入）')
  t.eq(d.entries.find((e) => e.date === key).text, text1, '正文没被改动')
}

// ── 模型改写过的那篇不能被覆盖（数据安全）──
{
  D.writeDiary(d, key, '今天我改写了这篇日记。', lbl)
  const after = d.entries.find((e) => e.date === key)
  t.has(after, 'edited', '改写后带上了 edited 标记')
  t.ok(after.edited, 'edited 是 true')
  const r = D.ensureDiary(d, key, lbl)
  t.eq(r, null, 'ensureDiary 跳过（不覆盖手写内容）')
  t.eq(d.entries.find((e) => e.date === key).text, '今天我改写了这篇日记。', '手写内容原样保留')
}

// ── 空白的一天 ──
{
  const d2 = D.blankDiary()
  const k2 = '2026-10-12'
  D.dayBucket(d2, k2)
  D.ensureDiary(d2, k2, lbl)
  const e = d2.entries.find((x) => x.date === k2)
  t.ok(e, '空白的一天也会生成条目')
  t.ok(/没人说话|没干什么/.test(e.text), '空白的一天正文说的是"没人说话"：' + JSON.stringify(e.text.slice(0, 30)))
}

// ── 清理：只删老的，不删还新的 ──
{
  const d3 = D.blankDiary()
  for (let i = 0; i < 200; i++) {
    d3.daily['2026-' + String(i).padStart(2, '0') + '-01'] = { messages: 1 }
  }
  const before = Object.keys(d3.daily).length
  const removed = D.pruneDaily(d3, 180)
  const after = Object.keys(d3.daily).length
  t.eq(before, 200, '造了 200 天素材')
  t.eq(after, 180, '清理后剩 180 天')
  t.eq(removed, 20, '清理掉 20 天')
  // 留下的必须是最新的那批（不能把新的删了留老的）
  const kept = Object.keys(d3.daily).sort()
  // 别用字典序取'最新'—— '2026-99-01' 字典序大于 '2026-199-01'（第一版就栽在这）
  t.has(kept, '2026-199-01', '最后造的那天还在')
  t.ok(!kept.includes('2026-00-01'), '最早的那天被删了')
  t.has(kept, '2026-99-01', '中段的那天也在（删的是最旧的 20 天）')
}

// ── 坏输入不崩 ──
{
  t.noThrow(() => D.composeDiary(key, null, lbl), 'composeDiary(null) 不崩')
  t.noThrow(() => D.composeDiary(key, {}, lbl), 'composeDiary({}) 不崩')
  t.noThrow(() => D.pruneDaily(D.blankDiary(), 0), 'pruneDaily(0) 不崩')
  t.noThrow(() => D.dominantMood({}), 'dominantMood({}) 不崩')
}

t.done()

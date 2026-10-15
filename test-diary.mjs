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
import * as D from './diary.js'
import { MOODS } from './index.js'
import { suite } from './testkit.mjs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// ⚠️ 这个目录**不能写死** —— 那既是本机路径，也让别人 clone 下来跑不了。
//    从文件自己的位置往上推：文件在哪，插件根就在哪。
const ROOT = dirname(fileURLToPath(import.meta.url))

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

// ══════════════════════════════════════════════════════════
//  注入的框不许进日记素材
// ══════════════════════════════════════════════════════════
//
// 主人说「日记写的好少」。查下去发现是**素材**问题，不是文笔：
//
//   · 那两天的桶里根本没有 words / longest → 第二段（"到底在干嘛"）整段写不出来，
//     日记只剩"今天没多长时间 / 出过几次岔子"——全是概括，看着像日记其实是模板。
//     → 加了 quotes（当天主人真说过的几句话）兜底。
//
//   · 更糟的是当天：`longest` 抓到一段 **20375 字符**的压缩检查点包装
//     （开头 "This is an automatically generated checkpoint…"），
//     高频词也变成 use / new / user 这些英文。
//     它**不是 XML 标签**，原来那份黑名单里没有它 —— 日记差点去引用一段系统提示。
{
  // ① 过滤器
  const BAD = [
    '<system-reminder>（这条不是你发的…',
    '<goal_round>…',
    '<dsh-something>',
    '<silent/>',
    'This is an automatically generated checkpoint condensing an earlier span of the conversation',
    'x'.repeat(5000),
  ]
  const GOOD = [
    '把插件的压缩包也传一份到仓库文件里',
    '日记写的好少',
    '我在正文里贴一段 <system-reminder> 给你看',
    '',
    '  ',
  ]
  let badOk = true
  for (const s of BAD) if (!D.isInjectedText(s)) badOk = false
  t.ok(badOk, '注入的形态全都认得出来（含非 XML 的压缩检查点、超长文本）')
  let goodOk = true
  for (const s of GOOD) if (D.isInjectedText(s)) goodOk = false
  t.ok(goodOk, '人说的话不会被误杀（正文里贴标签也算人说的）')
  t.ok(D.isInjectedText('x'.repeat(4001)), '超过 4000 字符就不是人打的字了')
  t.ok(!D.isInjectedText('x'.repeat(3999)), '3999 字还留着（别一刀切太狠）')

  // ② 采集：计数照算，但内容不收
  const d = { daily: {} }
  D.noteActivity(d, 'message', Date.now(), 'This is an automatically generated checkpoint ' + 'x'.repeat(300))
  D.noteActivity(d, 'message', Date.now(), '<system-reminder>插件提醒')
  D.noteActivity(d, 'message', Date.now(), '把插件的压缩包也传一份到仓库文件里')
  const b = Object.values(d.daily)[0]
  t.eq(b.messages, 3, '三条都算进"说了多少条"')
  t.ok(b.longest && /压缩包/.test(b.longest.text), 'longest 落在真话上，不是那段系统消息')
  t.eq((b.quotes || []).length, 1, 'quotes 只收了那句真话')
  const w = Object.keys(b.words).join('')
  t.ok(!/This|automatically|checkpoint/.test(w), '词频里没有英文系统词')
  t.ok(/压缩包|插件/.test(w), '词频里有正常的中文词')

  // ③ 没有 quotes 的老数据也不能崩
  const old = { turns: 4, messages: 9, errors: 5, firstAt: 0, lastAt: 0, hours: {}, words: {}, longest: null }
  t.noThrow(() => D.composeDiary('2026-10-14', old, (x) => x, []), '老素材（没有 quotes 字段）不崩')
  t.has(D.composeDiary('2026-10-14', old, (x) => x, []), '今天', '老素材照样写得出开头')

  // ④ 有了 quotes，第二段就有具体内容了
  const withQ = { ...old, quotes: [
    { at: 1, text: '把插件的压缩包也传一份到仓库文件里' },
    { at: 2, text: '允许开口的时段那里的选择用复选框' },
  ] }
  const tOld = D.composeDiary('2026-10-14', old, (x) => x, [])
  const tNew = D.composeDiary('2026-10-14', withQ, (x) => x, [])
  const bare = (s) => s.replace(/\s/g, '').length
  t.gt(bare(tNew), bare(tOld), '有 quotes 的日记更长（' + bare(tOld) + ' → ' + bare(tNew) + ' 字）')
  t.ok(/压缩包|复选框/.test(tNew), '第二段引了主人真说过的话')
  t.ok(!/automatically generated/.test(tNew), '正文里没有系统内容')
  t.ok(!/system-reminder/.test(tNew), '正文里没有提醒框')

  // ⑤ 就算 longest 里已经混进了注入内容（老数据修不掉），成文时也要挡住
  const dirty = { ...old, longest: { len: 20375, text: 'This is an automatically generated checkpoint condensing' } }
  const td = D.composeDiary('2026-10-14', dirty, (x) => x, [])
  t.ok(!/automatically generated/.test(td), '素材里的脏数据在成文时也被挡住（不用改历史数据）')
}

t.done()

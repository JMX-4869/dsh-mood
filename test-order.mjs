/**
 * 日记条目排序。
 *
 * ⚠️ 原来只 `console.log` 三行"是否新→旧: ✅" —— 没有断言。
 *    排序错了（宿主给新→旧，客户端 asc 时要翻）表现是"日记顺序乱"，
 *    属于那种**没人会去看一眼**的问题。
 */
import * as D from './diary.js'
import { suite } from './testkit.mjs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// ⚠️ 这个目录**不能写死** —— 那既是本机路径，也让别人 clone 下来跑不了。
//    从文件自己的位置往上推：文件在哪，插件根就在哪。
const ROOT = dirname(fileURLToPath(import.meta.url))

const t = suite('日记排序')

const d = D.blankDiary()
const DAYS = ['2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13']
for (const k of DAYS) {
  const b = D.dayBucket(d, k)
  b.messages = 5; b.turns = 3
  b.firstAt = new Date(k + 'T09:00:00').getTime()
  b.lastAt = new Date(k + 'T23:00:00').getTime()
  D.ensureDiary(d, k, (id) => id)
}

t.eq(d.entries.length, 5, '造了 5 篇')
{
  const dates = d.entries.map((e) => e.date)
  // 宿主返回的顺序：新 → 旧
  let desc = true
  for (let i = 1; i < dates.length; i++) if (!(dates[i - 1] > dates[i])) desc = false
  t.ok(desc, '宿主返回的是新→旧：' + dates.join(' , '))
  t.eq(dates[0], '2026-10-13', '第一篇是最新的那天')
  t.eq(dates[dates.length - 1], '2026-10-09', '最后一篇是最早的那天')

  const flipped = d.entries.slice().reverse().map((e) => e.date)
  let asc = true
  for (let i = 1; i < flipped.length; i++) if (!(flipped[i - 1] < flipped[i])) asc = false
  t.ok(asc, '客户端翻转后是旧→新：' + flipped.join(' , '))
}

// 每篇都得有正文，不能是空壳
{
  const empties = d.entries.filter((e) => !e.text || e.text.trim().length < 4)
  t.eq(empties.length, 0, '5 篇都有正文' + (empties.length ? '（空的是 ' + empties.map((e) => e.date).join(',') + '）' : ''))
}

// 日期键必须是 YYYY-MM-DD（路由和客户端都按这个正则校验）
{
  const bad = d.entries.map((e) => e.date).filter((x) => !/^\d{4}-\d{2}-\d{2}$/.test(x))
  t.eq(bad.length, 0, '每篇的 date 都是 YYYY-MM-DD' + (bad.length ? '（' + bad.join(',') + '）' : ''))
}

// 同一天重复 ensureDiary 不该多出一篇
{
  const before = d.entries.length
  D.ensureDiary(d, '2026-10-13', (id) => id)
  D.ensureDiary(d, '2026-10-13', (id) => id)
  t.eq(d.entries.length, before, '重复 ensure 同一天不会多出条目')
}

t.done()

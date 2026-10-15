/**
 * 写盘失败**必须出声**。
 *
 * ────────────────────────────────────────────────────────────────
 *  为什么单独测这个
 * ────────────────────────────────────────────────────────────────
 *  排查 24 个空 catch 时发现的：
 *  `saveDiary` / `saveNews` / `saveProactive` 失败时**只 `return false`**，
 *  而调用方（index.js 的 flushAll）写的是 `try { saveDiary(diary) } catch {}` ——
 *  函数内部已经 catch 了，**外层那个 catch 永远不触发**，返回的 false 又被丢掉。
 *  于是"日记/时事/主动开口设置没存上"这件事**在整条链上消失了**。
 *
 *  写盘失败不像读盘失败那样"没有就算了" —— 它是**用户的东西要丢了**。
 *  所以这条用例故意把目标目录弄成不可写，看有没有声音。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { suite } from './testkit.mjs'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

// ⚠️ 这个目录**不能写死** —— 那既是本机路径，也让别人 clone 下来跑不了。
//    从文件自己的位置往上推：文件在哪，插件根就在哪。
const ROOT = dirname(fileURLToPath(import.meta.url))

const t = suite('写盘失败要出声')

const TMP = path.join(os.tmpdir(), 'dsh-mood-savefail-' + Date.now())
fs.mkdirSync(TMP, { recursive: true })
process.env.DSH_HOME = TMP

const D = await import(new URL('diary.js?t=', import.meta.url).href + Date.now())
const N = await import(new URL('news.js?t=', import.meta.url).href + Date.now())
const P = await import(new URL('proactive.js?t=', import.meta.url).href + Date.now())

/** 抓住 console.error 的输出 */
function capture(fn) {
  const out = []
  const old = console.error
  console.error = (...a) => out.push(a.map(String).join(' '))
  try { fn() } finally { console.error = old }
  return out
}

// 正常情况：存得上，返回 true，而且**不该**有噪音
{
  const errs = capture(() => {
    const ok1 = D.saveDiary(D.blankDiary())
    const ok2 = N.saveNews(N.blankNews())
    const ok3 = P.saveProactive(P.blankProactive())
    t.eq(ok1, true, 'saveDiary 正常时返回 true')
    t.eq(ok2, true, 'saveNews 正常时返回 true')
    t.eq(ok3, true, 'saveProactive 正常时返回 true')
  })
  t.eq(errs.length, 0, '正常保存不产生任何错误输出')
  t.ok(fs.existsSync(path.join(TMP, 'dsh-mood-diary.json')), '日记文件真的写出来了')
}

// 制造失败：把目标路径变成一个**目录**，rename 一定失败
{
  const ctl = path.join(TMP, 'dsh-mood-news.json')
  fs.rmSync(ctl, { force: true })
  fs.mkdirSync(ctl, { recursive: true })          // 同名目录 → renameSync(tmp, 目录) 会失败
  const errs = capture(() => {
    const r = N.saveNews(N.blankNews())
    t.eq(r, false, '写不进去时返回 false（调用方能判）')
  })
  t.gt(errs.length, 0, '**而且有声音**（原来这里完全静默）')
  t.ok(/时事缓存保存失败/.test(errs.join(' ')), '输出里说清是哪个文件：' + JSON.stringify((errs[0] || '').slice(0, 60)))
  fs.rmSync(ctl, { recursive: true, force: true })
}

// 三个都必须有声音 —— 一个一个来，别只测一个就当全好
{
  for (const [name, fn, label] of [
    ['diary', () => D.saveDiary(D.blankDiary()), '日记'],
    ['news', () => N.saveNews(N.blankNews()), '时事'],
    ['proactive', () => P.saveProactive(P.blankProactive()), '主动开口'],
  ]) {
    const target = path.join(TMP, 'dsh-mood-' + name + '.json')
    fs.rmSync(target, { force: true, recursive: true })
    fs.mkdirSync(target, { recursive: true })
    const errs = capture(() => { fn() })
    t.gt(errs.length, 0, label + '：写盘失败有声音')
    t.ok(new RegExp(label + '.{0,4}保存失败').test(errs.join(' ')), label + '：说清了是哪个（' + JSON.stringify((errs[0] || '').slice(0, 50)) + '）')
    fs.rmSync(target, { recursive: true, force: true })
  }
}

// 读盘失败**不该**吵：文件不存在是正常情况（还没生成过）
{
  const fresh = path.join(os.tmpdir(), 'dsh-mood-empty-' + Date.now())
  fs.mkdirSync(fresh, { recursive: true })
  process.env.DSH_HOME = fresh
  const errs = capture(() => {
    const d2 = D.loadDiary()
    t.ok(d2 && typeof d2 === 'object', '读不到日记文件时返回空对象（不抛）')
  })
  t.eq(errs.length, 0, '读不到文件不吵（那是正常情况，不是错误）')
  fs.rmSync(fresh, { recursive: true, force: true })
}

fs.rmSync(TMP, { recursive: true, force: true })
t.done()

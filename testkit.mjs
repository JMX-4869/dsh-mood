/**
 * 共用的断言小工具。
 *
 * ────────────────────────────────────────────────────────────────
 *  为什么需要它
 * ────────────────────────────────────────────────────────────────
 *  仓库里有 8 个 `test-*.mjs` **只打印、不断言、永远退出 0**：
 *  test-decay / test-deep / test-diary / test-logic /
 *  test-modern / test-order / test-romance / test-voice
 *
 *  它们检查的内容是**好的**，但形式是"人肉看输出" ——
 *  也就是说：**改了代码之后，它们红不了**。一个永远绿的测试等于没有测试，
 *  而且更坏：它给的是"这块已经验过了"的错觉。
 *
 *  这个文件把"看输出"变成"断言 + 退出码"。用法：
 *
 *    import { suite } from './testkit.mjs'
 *    const t = suite('周期回落')
 *    t.eq(CFG.decayRatio, 0.25, '回落比例是 25%')
 *    t.ok(x > y, '高分要往基线落')
 *    t.done()          // 失败就 process.exit(1)
 */

export function suite(name) {
  let pass = 0
  const fails = []

  const t = {
    /** 断言为真 */
    ok(cond, label, detail) {
      if (cond) { pass++; console.log('  ✅ ' + label) }
      else { fails.push(label); console.log('  ❌ ' + label + (detail !== undefined ? '  → ' + fmt(detail) : '')) }
      return !!cond
    },
    /** 相等 */
    eq(actual, expect, label) {
      const good = Object.is(actual, expect)
      return t.ok(good, label, good ? undefined : '实际 ' + fmt(actual) + '，期望 ' + fmt(expect))
    },
    /** 数值够接近 */
    near(actual, expect, tol, label) {
      const good = Math.abs(Number(actual) - Number(expect)) <= tol
      return t.ok(good, label, good ? undefined : '实际 ' + fmt(actual) + '，期望 ' + fmt(expect) + '±' + tol)
    },
    /** 大于 / 小于 */
    gt(a, b, label) { return t.ok(Number(a) > Number(b), label, fmt(a) + ' > ' + fmt(b) + ' ?') },
    lt(a, b, label) { return t.ok(Number(a) < Number(b), label, fmt(a) + ' < ' + fmt(b) + ' ?') },
    /** 包含（数组用 includes，字符串用 includes，对象看键） */
    has(hay, needle, label) {
      const good = Array.isArray(hay) ? hay.includes(needle)
        : typeof hay === 'string' ? hay.includes(needle)
          : !!hay && Object.prototype.hasOwnProperty.call(hay, needle)
      return t.ok(good, label, good ? undefined : fmt(hay).slice(0, 120) + ' 里没有 ' + fmt(needle))
    },
    /** 抛错（用来验证"坏输入不该崩"的反面：该拦的要拦） */
    throws(fn, label) {
      try { fn(); return t.ok(false, label, '没有抛错') }
      catch { return t.ok(true, label) }
    },
    /** 不抛错（验证坏输入不会崩 —— 比"打印出来看着没事"强） */
    noThrow(fn, label) {
      try { fn(); return t.ok(true, label) }
      catch (e) { return t.ok(false, label, '抛了：' + ((e && e.message) || e)) }
    },
    /** 收尾：打印汇总并设退出码 */
    done() {
      console.log()
      if (fails.length) {
        console.log('  ❌ ' + name + '：通过 ' + pass + '  失败 ' + fails.length)
        for (const f of fails) console.log('       · ' + f)
        process.exit(1)
      }
      console.log('  ' + name + '：通过 ' + pass + '  失败 0')
      return 0
    },
  }
  console.log()
  console.log('  ── ' + name + ' ──')
  return t
}

function fmt(x) {
  try {
    if (typeof x === 'string') return JSON.stringify(x.length > 90 ? x.slice(0, 90) + '…' : x)
    if (typeof x === 'number') return String(Math.round(x * 1000) / 1000)
    return JSON.stringify(x)
  } catch { return String(x) }
}

/** 把一组消息喂给 judgeMessage 再累计 —— 几个测试都用到 */
export function acc(judge, msgs) {
  const a = {}
  for (const m of msgs) {
    const d = judge(m) || {}
    for (const [k, v] of Object.entries(d)) {
      if (k.startsWith('__')) continue
      a[k] = (a[k] || 0) + v
    }
  }
  return a
}

/** 取得分最高的几个 id */
export function top(score, n = 3) {
  return Object.entries(score).sort((x, y) => y[1] - x[1]).slice(0, n)
}

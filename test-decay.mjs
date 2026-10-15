/**
 * 周期回落。
 *
 * ⚠️ 原来这个文件**只在打印**（还自己把回落公式抄了一遍）——
 *    真逻辑改错了它不会红。现在直接测 `_internal.decayValues`（真实现）。
 */
import fs from 'node:fs'
import * as M from './index.js'
import { suite } from './testkit.mjs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// ⚠️ 这个目录**不能写死** —— 那既是本机路径，也让别人 clone 下来跑不了。
//    从文件自己的位置往上推：文件在哪，插件根就在哪。
const ROOT = dirname(fileURLToPath(import.meta.url))

const t = suite('周期回落')
const { CFG, MOODS, MOOD_IDS, blankState, decayValues } = M._internal
const L = (id) => MOODS[id].label
const SRC = fs.readFileSync(join(ROOT, 'index.js'), 'utf8')

// ── 参数 ──
t.eq(CFG.decayRatio, 0.25, '回落比例是 25%')
t.eq(CFG.periodMinMs / 3600000, 3, '周期下限 3 小时')
t.eq(CFG.periodMaxMs / 3600000, 6, '周期上限 6 小时')
t.lt(CFG.periodMinMs, CFG.periodMaxMs, '下限小于上限')

// ── 数学：往基线走，不是"减固定分" ──
{
  const vals = {}
  for (const id of MOOD_IDS) vals[id] = MOODS[id].baseline
  vals.happy = 95          // 远高于基线
  vals.calm = 5            // 远低于基线
  const out = decayValues(vals, { noise: 0 })   // 关掉随机，结果可预期

  const baseHappy = MOODS.happy.baseline
  const baseCalm = MOODS.calm.baseline
  t.near(out.happy, 95 + (baseHappy - 95) * 0.25, 0.001, '高分那项按比例往基线落（不是减固定分）')
  t.near(out.calm, 5 + (baseCalm - 5) * 0.25, 0.001, '低分那项也往基线升')
  t.lt(out.happy, 95, '高的会降')
  t.gt(out.calm, 5, '低的会升')
  t.gt(out.happy, baseHappy + 0.001, '一次回落**不会**直接落到基线（要好几次）')

  let v = { ...vals }
  for (let i = 0; i < 40; i++) v = decayValues(v, { noise: 0 })
  t.near(v.happy, baseHappy, 0.5, '40 次之后基本等于基线')
  t.near(v.calm, baseCalm, 0.5, '40 次之后基本等于基线（低的那项）')
}

// ── 边界：不越界、不 NaN ──
{
  const odd = decayValues({ happy: 1e9, calm: -1e9, tired: NaN, curious: undefined }, { noise: 0 })
  let allOk = true
  for (const id of MOOD_IDS) if (!(Number.isFinite(odd[id]) && odd[id] >= 0 && odd[id] <= 100)) allOk = false
  t.ok(allOk, '怪输入（1e9 / -1e9 / NaN / undefined）之后每一项都还在 0~100 且有限')
}

// ── 纯函数：不改传进去的对象 ──
{
  const before = { happy: 90 }
  const snapshot = JSON.stringify(before)
  decayValues(before, { noise: 0 })
  t.eq(JSON.stringify(before), snapshot, 'decayValues 不改传进来的对象（纯函数）')
}

// ── 随机扰动 ──
{
  const vals = {}
  for (const id of MOOD_IDS) vals[id] = MOODS[id].baseline
  const a = decayValues(vals, { noise: 0 })
  const b = decayValues(vals, { noise: 0 })
  t.eq(JSON.stringify(a), JSON.stringify(b), 'noise=0 时两次结果完全一样（可复现）')

  const seq = [0, 1, 0.5]
  let i = 0
  const r = decayValues(vals, { noise: 3, rand: () => seq[(i++) % seq.length] })
  let inRange = true
  for (const id of MOOD_IDS) if (Math.abs(r[id] - MOODS[id].baseline) > 3.001) inRange = false
  t.ok(inRange, '扰动幅度不超 ±noise')
}

// ── 只有一处实现 ──
{
  t.has(SRC, "bump(st, 'focused'", '干活多会加专注')
  t.has(SRC, "bump(st, 'tired'", '干活多会加累')
  t.has(SRC, "bump(st, 'annoyed'", '工具报错会加烦躁')
  t.has(SRC, 'decayValues(st.values', 'periodic 用的是抽出来的那个纯函数')
  // ⚠️ 数**出现次数**，别用"存在性"—— 那个 for 循环在 decayValues 自己里就有一次（该有）。
  //    第一版写成"存在就算失败"，结果把真实现本身判成了重复实现。
  const decayLoops = (SRC.match(/for \(const id of MOOD_IDS\) \{\s*const base = MOODS\[id\]\.baseline/g) || []).length
  t.eq(decayLoops, 1, '回落公式全仓库只有一份（在 decayValues 里）')
}

// ── 没人说话也会回落（修复前的漏洞：只在收到消息时才判定）──
{
  const s = blankState()
  s.lastPeriodicAt = Date.now() - 5 * 3600 * 1000
  s.nextPeriodicMs = 3 * 3600 * 1000
  t.ok(Date.now() - s.lastPeriodicAt >= s.nextPeriodicMs, '距上次 5 小时 / 周期 3 小时 → 已到期')
  t.has(SRC, 'periodicIfDue', '有心跳用的 periodicIfDue')
  t.has(SRC, 'try { periodicIfDue() }', '心跳里真的调了它')
}

t.done()

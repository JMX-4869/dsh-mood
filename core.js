// 心情核心的**纯数学**：三维判档、心情轴、耐心值。
//
// 为什么单独一个文件：这些都要能被测试直接调。
// 上一版的教训写在 index.js 里 —— 把公式写在闭包里，测试只能抄一份，
// 那测的是副本，改错了也不红。
//
// 移植自 dsh-mood-system 1.1.0 的 `feel` / `patience` 两节（输出温度不要：
// 对方 README 自己写着"没真的改采样温度"，搬过来只是一句空话）。

import { DIMENSIONS, levelOf, promptKeyOf } from './prompts.js'

export { DIMENSIONS, levelOf, promptKeyOf }

/** 出厂参数。面板可改的走 dsh-mood-config.json，这里是不被覆盖时的值。 */
export const CORE_DEFAULTS = {
  thresholds: { high: 50, low: -50 },
  feel: {
    baseline: 0,      // 回落落点
    high: 25,         // ≥ 算「开心」
    low: -25,         // ≤ 算「难过」
    hysteresis: 5,    // 进档/出档差，防边界抖
    decayRatio: 0.25, // 周期判定向基线回落多少
    noise: 3,         // 周期判定的随机扰动 ±
    turnCost: 0.6,    // 判定期间每多一轮，往「累」挪多少
    turnCap: 12,      // 轮次修正上限
    msgCap: 3,        // 单条用户消息最多推动多少
  },
  patience: {
    max: 100,
    recover: 1,       // 每次周期判定恢复多少
    costs: { unreasonable: 15, repeat: 10, attack: 25, perfunctory: 5 },
    roundCap: 40,     // 单轮最多扣多少（防止一次扣穿）
    lowThreshold: 20,
    bands: [
      { min: 85, behavior: '正常，愿意多说，会主动延展' },
      { min: 60, behavior: '略收，解释变短' },
      { min: 30, behavior: '只答核心，不展开' },
      { min: 10, behavior: '一句话，不解释' },
      { min: 0, behavior: '只说「这个我不接」或直接表明不想继续' },
    ],
  },
}

export function clamp100(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return 0
  return Math.max(-100, Math.min(100, n))
}

// ── 心情轴 ───────────────────────────────────────────────────────────

/** 往「开心」推的词（这里的都是**现象**，不是"因为什么"） */
const UP = ['太好了', '终于', '成了', '搞定', '漂亮', '舒服', '谢谢你', '谢谢', '哈哈', '笑死', '行啊', '可以啊', '稳']
/** 往「难过」推的词 */
const DOWN = ['累了', '烦死', '烦', '难受', '崩了', '崩溃', '无语', '算了', '不行了', '看不下去了', '浪费时间', '又炸', '卡死', '气死']

/**
 * 一条用户消息把心情轴推动多少。**上限是 msgCap，且不做词频累加** ——
 * 命中几个词只看"有没有"，不看"几次"。上一版栽过一次：
 * 长文档同时命中十几个词，一条就 +28，而切换余量只有 5。
 */
export function feelNudge(text, cfg = CORE_DEFAULTS.feel) {
  const t = String(text || '')
  if (!t.trim()) return 0
  let score = 0
  for (const w of UP) if (t.includes(w)) score += 1
  for (const w of DOWN) if (t.includes(w)) score -= 1
  if (!score) return 0
  const cap = Number(cfg.msgCap) || 3
  // 平方根压缩：命中 1 个 = 1，4 个 = 2 —— 长消息不再线性占便宜
  const mag = Math.min(cap, Math.sqrt(Math.abs(score)) * cap / 2)
  return (score > 0 ? 1 : -1) * Math.round(mag * 100) / 100
}

/**
 * 周期判定：向基线回落 + 随机扰动 + 这段时间聊得多就往「累」偏一点。
 * `rand` 可注入，测试才可重复。
 */
export function feelStep(value, opts = {}) {
  const cfg = Object.assign({}, CORE_DEFAULTS.feel, opts.cfg || {})
  const rand = opts.rand || Math.random
  const turns = Number(opts.turns) || 0
  const v = Number(value) || 0
  let next = v + (cfg.baseline - v) * cfg.decayRatio + (rand() * 2 - 1) * cfg.noise
  if (turns > 0) next -= Math.min(cfg.turnCap, turns * cfg.turnCost)
  return clamp100(next)
}

/**
 * 档位。带**迟滞**：已经在「开心」里，要掉到 high−hysteresis 以下才出来；
 * 否则 24.9 / 25.1 来回跳，界面会抖。
 */
export function feelBandOf(value, prev = '平', cfg = CORE_DEFAULTS.feel) {
  const v = Number(value) || 0
  const high = Number(cfg.high) || 25
  const low = Number(cfg.low) || -25
  const h = Number(cfg.hysteresis) || 5
  if (prev === '开心') {
    if (v >= high - h) return '开心'
    if (v <= low) return '难过'
    return '平'
  }
  if (prev === '难过') {
    if (v <= low + h) return '难过'
    if (v >= high) return '开心'
    return '平'
  }
  if (v >= high) return '开心'
  if (v <= low) return '难过'
  return '平'
}

// ── 耐心值 ───────────────────────────────────────────────────────────

/** 按事件扣耐心。没配置的事件不扣。 */
export function patienceAfter(patience, event, cfg = CORE_DEFAULTS.patience) {
  const p = Number.isFinite(Number(patience)) ? Number(patience) : cfg.max
  if (!event || event === 'none') return p
  const cost = (cfg.costs && cfg.costs[event]) || 0
  return Math.max(0, Math.min(cfg.max, p - Math.min(cfg.roundCap, cost)))
}

/** 周期恢复。 */
export function patienceRecover(patience, cfg = CORE_DEFAULTS.patience) {
  const p = Number.isFinite(Number(patience)) ? Number(patience) : cfg.max
  return Math.max(0, Math.min(cfg.max, p + (cfg.recover || 1)))
}

/** 耐心值 → 那一档该怎么说话。 */
export function patienceBandOf(patience, cfg = CORE_DEFAULTS.patience) {
  const p = Number(patience)
  const list = cfg.bands || CORE_DEFAULTS.patience.bands
  for (const b of list) if (p >= b.min) return b.behavior
  return list[list.length - 1].behavior
}

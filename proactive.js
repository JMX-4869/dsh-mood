import { dataFile } from './store.js'
/**
 * dsh-mood · 主动开口
 *
 * 为什么要有这个文件：
 *   插件默认只能"被动回应" —— 用户不说话，就没有回合，也就没有助手消息的位置
 *   （`assistant/message` 事件必须挂在 turn/step 上）。所以想主动说话，只有一条官方路：
 *
 *     sessionController.prompt({ requestId, sessionId, mode:'queue', content:[…] })
 *
 *   它的语义是"投递一个 prompt"。**代价是：投进去的那条在记录里属于用户那一侧。**
 *   所以这里绝不伪造用户的话 —— 投的是一条**明确标着"这是插件提醒"的框**，
 *   然后由模型自己决定要不要开口、说什么。它可以选择不说。
 *
 * 安全阀（全都要过，缺一个就不开口）：
 *   · 总开关默认**关**（enabled=false）—— 不打招呼就自己发消息，比不发更糟
 *   · 空闲够久（idleMs，默认 25 分钟）
 *   · 距上次开口够久（minGapMs，默认 45 分钟）
 *   · 一天不超过 maxPerDay 次（默认 6）
 *   · 只在**没有正在跑的回合**时投
 *   · 上次开口之后用户没回过话 —— 那就不追（否则会自说自话）
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs'
import { join, dirname } from 'node:path'
import os from 'node:os'

function dshHome() {
  return process.env.DSH_HOME || join(os.homedir(), '.dsh')
}
// 路径统一走 store.js —— 数据目录可以被搬到别的盘（见 store.js 顶部说明）
export function proactiveFile() { return dataFile('dsh-mood-proactive.json') }

export const DEFAULTS = {
  enabled: false,       // 默认关。要用户明确打开
  idleMs: 25 * 60000,   // 空闲多久才考虑开口
  minGapMs: 45 * 60000, // 两次开口之间至少隔多久
  maxPerDay: 6,         // 一天最多主动几次
  quietFrom: 1,         // 深夜静默：1 点到 7 点不说
  quietTo: 7,
}

export function blankProactive() {
  return { version: 1, cfg: { ...DEFAULTS }, sent: [], lastSpokeAt: 0, awaitingReply: false }
}

export function loadProactive() {
  try {
    if (!existsSync(proactiveFile())) return blankProactive()
    const j = JSON.parse(readFileSync(proactiveFile(), 'utf8'))
    return { ...blankProactive(), ...j, cfg: { ...DEFAULTS, ...(j && j.cfg) } }
  } catch {
    return blankProactive()
  }
}

export function saveProactive(p) {
  try {
    mkdirSync(dirname(proactiveFile()), { recursive: true })
    const tmp = proactiveFile() + '.tmp'
    writeFileSync(tmp, JSON.stringify(p, null, 2), 'utf8')
    renameSync(tmp, proactiveFile())
    return true
  } catch {
    return false
  }
}

const dayKey = (ts) => {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 今天已经主动了几次 */
export function sentToday(p, now) {
  const k = dayKey(now)
  return (p.sent || []).filter((x) => dayKey(x) === k).length
}

/**
 * 现在能不能开口。
 * @returns {{ ok: boolean, reason: string }}
 */
export function canSpeak(p, now, ctx) {
  const c = p.cfg || DEFAULTS
  if (!c.enabled) return { ok: false, reason: '没开（主动开口默认关）' }
  // 正在跑回合 —— 绝不插队
  if (ctx && ctx.busy) return { ok: false, reason: '正在跑回合' }
  // 上次开口之后用户还没回过话：不追，免得自说自话
  if (p.awaitingReply) return { ok: false, reason: '上次开口后用户还没回，不追' }
  const idle = now - (ctx && ctx.lastUserAt ? ctx.lastUserAt : 0)
  if (!ctx || !ctx.lastUserAt) return { ok: false, reason: '还没有过对话' }
  if (idle < c.idleMs) return { ok: false, reason: `空闲不够（${Math.round(idle / 60000)} 分 < ${Math.round(c.idleMs / 60000)} 分）` }
  const gap = now - (p.lastSpokeAt || 0)
  if (p.lastSpokeAt && gap < c.minGapMs) {
    return { ok: false, reason: `距上次开口太近（${Math.round(gap / 60000)} 分 < ${Math.round(c.minGapMs / 60000)} 分）` }
  }
  if (sentToday(p, now) >= c.maxPerDay) return { ok: false, reason: `今天已经主动 ${sentToday(p, now)} 次，到量了` }
  // 深夜静默
  const h = new Date(now).getHours()
  const { quietFrom: a, quietTo: b } = c
  const isQuiet = a < b ? (h >= a && h < b) : (h >= a || h < b)
  if (isQuiet) return { ok: false, reason: `${a}~${b} 点静默` }
  return { ok: true, reason: '可以开口' }
}

/**
 * 要投递的话。
 * **不是伪造用户的话** —— 是一条明确标着"插件提醒"的框，让模型自己决定说不说。
 */
export function buildNudge(idleMs) {
  const mins = Math.max(1, Math.round(idleMs / 60000))
  return [
    '<system-reminder>',
    '（这条不是你发的，是 dsh-mood 插件的空闲提醒。它不进你的"回复"，只是把话筒递给你。）',
    `用户已经 ${mins} 分钟没说话了。**现在轮到你决定要不要开口 —— 不是必须说。**`,
    '',
    '· **有话要说就说。** 刚做完的事有后续、突然想起一件相关的、上一条没说透、',
    '  或者就是想问一句 —— 都可以，直接说，别用"在吗""打扰一下"这种开场。',
    '· **没什么要说的，就只回一个 `<silent/>`**，别的什么都别写。',
    '  **硬找话说比不说话差得多** —— 主动开口的价值在于偶尔真有意思，不在于频率。',
    '· 不要汇报状态、不要总结刚才聊了什么、不要问"还需要我做什么"。',
    '</system-reminder>',
  ].join('\n')
}

/** 记一次开口 */
export function markSpoke(p, now) {
  p.sent = [...(p.sent || []).slice(-200), now]
  p.lastSpokeAt = now
  p.awaitingReply = true
  return p
}

/** 用户回话了 —— 可以再等下一次 */
export function markReplied(p) {
  p.awaitingReply = false
  return p
}

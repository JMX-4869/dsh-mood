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

/**
 * 预设时段 —— 铺满 24 小时，**互不重叠也不留缝**。
 *
 * `kind` 只是给人看的提示（峰 = 一般通勤/活跃高峰，平 = 工作时段，谷 = 人少的时候），
 * **不参与任何判定**。判定只看 `from`/`to`。
 *
 * ⚠️ 用**整点**切，别用半点 —— 判定是按 `getHours()` 取整小时的，
 *    半点边界会让 8:30 落不进 7~9 这一段，出现"哪个时段都不属于"的缝。
 */
export const SLOTS = [
  { id: 'deep', from: 0, to: 7, label: '深夜', kind: '谷' },
  { id: 'am1', from: 7, to: 9, label: '早峰', kind: '峰' },
  { id: 'am2', from: 9, to: 12, label: '上午', kind: '平' },
  { id: 'noon', from: 12, to: 14, label: '午间', kind: '平' },
  { id: 'pm', from: 14, to: 18, label: '下午', kind: '平' },
  { id: 'eve1', from: 18, to: 21, label: '晚峰', kind: '峰' },
  { id: 'eve2', from: 21, to: 24, label: '晚间', kind: '谷' },
]

/** 这个整点落在哪一段（没有就是 null —— 但按时段表铺满了，正常不会） */
export function slotOf(hour) {
  const h = Number(hour)
  if (!Number.isFinite(h)) return null
  return SLOTS.find((s) => h >= s.from && h < s.to) || null
}

/**
 * 这个整点允不允许开口。
 *
 * **空数组 = 全时段允许。** 「不选就全时段」是刻意的默认：
 * 让"没配过"和"想全开"是同一个状态，用户不用先去理解这个功能。
 */
export function slotAllowed(cfg, hour) {
  const ids = cfg && cfg.slots
  if (!Array.isArray(ids) || ids.length === 0) return true
  const s = slotOf(hour)
  return !!s && ids.includes(s.id)
}

export const DEFAULTS = {
  enabled: false,       // 默认关。要用户明确打开
  idleMs: 25 * 60000,   // 空闲多久才考虑开口
  minGapMs: 45 * 60000, // 两次开口之间至少隔多久
  maxPerDay: 6,         // 一天最多主动几次
  quietFrom: 1,         // 深夜静默：1 点到 7 点不说
  quietTo: 7,
  slots: [],            // 允许开口的时段；**空 = 全时段**
  reportRestart: true,  // 宿主重启之后，主动汇报一次"重启后怎么样了"
  warnStale: true,      // 插件文件在本次进程启动后被改过 → 提醒"要重启才生效"
}

export function blankProactive() {
  return {
    version: 1,
    cfg: { ...DEFAULTS },
    sent: [],
    lastSpokeAt: 0,
    awaitingReply: false,
    // ── 重启相关 ──
    //
    // procStart 是**宿主的进程启动时刻**，不是插件的加载时刻。
    // ⚠️ 这个区分是关键：HMR 会把插件重新加载一遍，用插件加载时刻的话
    //    每次热重载都会被误判成"重启过"，然后就没完没了地汇报。
    //    process.uptime() 反推出来的进程启动时刻不受 HMR 影响。
    procStart: 0,
    pendingRestart: false,   // 检测到「这次重启是因为改了东西」→ 等合适的时机汇报
    pendingSince: 0,         // 什么时候挂上的 —— 用来量「从重启到真的说出口」隔了多久
    pendingStale: false,     // 插件文件比进程还新 → 等下一次回合结束时提醒
    /**
     * 这次汇报该投到**哪个对话**。
     *
     * ⚠️ 原来是用「最近一次有动静的 session」（liveSession）—— 主人切过对话，
     *    提醒就跑到别的对话框里去了。那种提醒是**针对这次重启**的，
     *    必须落在"他此刻真的在看的那条对话"里，否则等于白发。
     *
     *    所以：由**主人在某个对话里开口**那一刻绑上，之后只投给那一个。
     */
    reportSid: '',
    reportedAt: 0,
  }
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
  } catch (e) {
    // 和 saveState / saveDiary / saveNews 一个约定：写盘失败必须出声
    try { console.error('[dsh-mood] 主动开口设置保存失败:', (e && e.message) || e) } catch { /* 没办法 */ }
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
  // 允许时段（空 = 全时段）
  // ⚠️ 放在静默之后：静默是硬拦，选了时段也不能覆盖它。
  if (!slotAllowed(c, h)) {
    const s = slotOf(h)
    return { ok: false, reason: `${h} 点这段（${s ? s.label : '未知'}）不在你选的时段里` }
  }
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

// ────────────────────────────────────────────────────────────────
//  重启：认出来 + 汇报
// ────────────────────────────────────────────────────────────────

/**
 * 宿主进程的启动时刻。
 *
 * 用 `process.uptime()` 反推 —— **不用插件自己的加载时刻**。
 * HMR 会把插件重新加载一遍，用加载时刻的话每次热重载都像"重启过"，
 * 然后就不停地汇报。
 */
export function processStart(now = Date.now()) {
  const up = (typeof process !== 'undefined' && typeof process.uptime === 'function')
    ? process.uptime() : 0
  return Math.round(now - up * 1000)
}

/**
 * 挂载时调一次：判断这次是不是"重启"。
 *
 * @returns {{ restarted: boolean, stale: boolean, needed: boolean }}
 *   restarted —— 之前记过 procStart，而且和这次不一样 → 中间宿主重启过
 *   stale     —— 插件文件比进程还新 → 改了要重启才生效
 *   needed    —— 这次重启是**因为改了东西**（上一轮运行期间文件被改过）
 */
export function noteBoot(p, now = Date.now(), newestFileMtime = 0) {
  const ps = processStart(now)
  const prev = p.procStart || 0
  const restarted = !!prev && Math.abs(prev - ps) > 5000
  p.procStart = ps

  // 文件比进程新 → 这次进程启动之后插件被改过。HMR 能重载插件代码，
  // 但**宿主配置和 cordis.patch.yml 不会跟着变** —— 所以"要重启"这话仍然成立。
  const stale = !!newestFileMtime && newestFileMtime > ps + 5000

  /**
   * ⚠️ **只有"因为改了东西才重启"才汇报。**
   *
   * 原来这里是 `if (restarted) pendingRestart = true` —— 只要进程启动时刻变了就挂待办。
   * 后果：主人随手开一下 DSH、或者从任务栏重新打开，都会在几十秒后收到一条
   * "宿主刚重启过，去看一眼现在的实际状态" —— 而他**什么都没让插件改**。
   * 一两次之后这条提醒就跟弹窗广告一样，真改完东西那次反而不当回事了。
   *
   * 判据：**上一轮运行期间**插件文件被改过没有 ——
   *   `newestFileMtime > prev`（prev = 上一次的进程启动时刻）
   * 文件比上一轮进程还新，说明上一轮跑到一半代码变了（或者改完没重启），
   * 那就确实欠一次重启；重启之后才值得说一句。
   * 文件一直比上一次启动还老 → 这轮什么都没改 → **不吭声**。
   *
   * 这条判据还自带"说一次就够"：报完 prev 会跟着推进，同样的文件时间戳不会再触发。
   */
  const needed = restarted && !!prev && newestFileMtime > prev + 5000

  if (needed && p.cfg && p.cfg.reportRestart !== false) {
    // 只在「从没挂过」时记时间 —— 重复挂上不该把起点往后推，否则延迟会越量越小
    if (!p.pendingRestart) p.pendingSince = now
    p.pendingRestart = true
    // 换一次待办就重新挑投递的对话 —— 上一次投过的那条不能再背这口锅
    p.reportSid = ''
    p.reportSidFrom = ''
  }
  if (stale && p.cfg && p.cfg.warnStale !== false) p.pendingStale = true
  return { restarted, stale, needed }
}

/** 要投的重启汇报。说不说仍然由模型自己决定。 */
export function buildRestartNudge(kind = 'restart') {
  if (kind === 'stale') {
    return [
      '<system-reminder>',
      '（这条不是你发的，是 dsh-mood 插件的提醒。它不进你的"回复"，只是把话筒递给你。）',
      '**插件文件在这次 DSH 启动之后被改过了。**',
      '',
      'HMR 会把插件代码重新加载，但**宿主配置（cordis.patch.yml 之类的）不会**。',
      '所以：如果这次改的东西里有需要重启才生效的，它现在还没生效。',
      '',
      '**跟主人说一句。** 说清楚哪些改动已经生效（热重载的）、哪些还等着重启。',
      '别笼统说"要重启一下" —— 主人更想知道的是"现在能用什么、还差什么"。',
      '',
      '没什么要说的就只回一个 `<silent/>`。',
      '</system-reminder>',
    ].join('\n')
  }
  return [
    '<system-reminder>',
    '（这条不是你发的，是 dsh-mood 插件的重启提醒。它不进你的"回复"，只是把话筒递给你。）',
    '**宿主刚重启过。**',
    '',
    '重启前你可能说过"这个改了要重启才生效""重启后再看"之类的话。现在是兑现的时候：',
    '',
    '· 去看一眼**现在的实际状态** —— 该生效的生效了吗？（心情、硬盘记忆、那些配置……）',
    '· **说具体的。** "一切正常"这种话没有信息量 —— 说清楚变成了什么样、和重启前有什么不同。',
    '· 如果发现有没生效或者不对的地方，**直接说**，别粉饰。',
    '',
    '没什么可说的（比如重启跟你无关）就只回一个 `<silent/>`。',
    '</system-reminder>',
  ].join('\n')
}

/** 汇报过了 —— 清掉待办标记 */
export function markReported(p, now = Date.now()) {
  p.pendingRestart = false
  p.pendingStale = false
  p.reportedAt = now
  p.reportSid = ''
  return p
}

/** 用户回话了 —— 可以再等下一次 */
export function markReplied(p) {
  p.awaitingReply = false
  return p
}

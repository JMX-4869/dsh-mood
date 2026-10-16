/**
 * measure.js —— 视频量测（抽帧之前该做的那一步）
 *
 * ══════════════════════════════════════════════════════════════════════
 * 为什么要它
 *
 * 在这之前，抽帧只有一个信号：**场景切换**（`select='gt(scene,·)'`）。
 * 而那个信号在两类素材上是聋的 —— 2026-10-17 那 12 轮实测：
 *   · **低运动**（导视 / 文档 / 静态界面）→ 切点 0 个，而画面其实一直在变
 *     （字幕在跳、图标在动、指针在走 —— 只是没有"切"）
 *   · **高运动**（游戏 / 动画 / 影视）→ 切点几个，而每两帧之间都不一样
 * 两边的结局一样：抽帧退回**按秒均分**。而均分的盲区有多大，**说不清** ——
 * 那是最糟的一点：不是"抽得少"，是**不知道少了什么**。
 *
 * 方法学自 CFITCorporation/video-watch-skill（MIT）。它的判据：
 *   **量测给候选，眼睛给命名。**
 *   ffmpeg 看全部帧（零 token），模型只看几十帧（预算受控），两者靠时间戳缝合。
 *
 * 这个模块只做前半截。它不抽帧、不拼图、不认识画面 ——
 * 它只把"这段时间里发生了什么"变成**可算的数**。
 *
 * ══════════════════════════════════════════════════════════════════════
 * 两个信号，两条 ffmpeg
 *
 * ① **逐帧运动量**：`scale=160:-2, tblend=all_mode=difference, signalstats`
 *    再把 `lavfi.signalstats.YAVG` 打出来 —— 那是**这一帧和上一帧的平均差**（0~255 量级）。
 *    按秒聚合就得到：均值 / p95 / 最大。**最大那个才是"画面内容突变"**（均值会被稀释）。
 * ② **事件**：`scdet` 拿切点、`freezedetect` 拿冻结段、`silencedetect` 拿静音段。
 *
 * ⚠️ 两条口径（学自它，也自己验过）：
 *   · 运动与切点**从第 2 帧起算** —— tblend 是双输入，首帧没有前帧可混合因而不产出；
 *   · 帧数取 ffprobe 的 `nb_frames`（真实帧数），不是元数据条数。
 */
import { spawnSync } from 'node:child_process'
// ⚠️ 只借它一个纯函数（秒+偏移 → 帧号），**不反向依赖** —— frames.js 不 import 这个模块。
import { absoluteFrameIndex } from './frames.js'

/** 逐帧运动量：把 YAVG 从 stderr 里抠出来（那是"和上一帧的平均差"） */
export function measureMotion(videoPath, ffmpegPath, opts = {}) {
  const exe = ffmpegPath
  if (!exe) return { perFrame: [], error: '没找到 ffmpeg' }
  const timeoutMs = Number(opts.timeoutMs) || 300000
  const w = Number(opts.width) || 160
  try {
    const r = spawnSync(exe, [
      '-hide_banner', '-nostats',
      '-i', videoPath,
      '-vf', `scale=${w}:-2,tblend=all_mode=difference,signalstats,metadata=print:key=lavfi.signalstats.YAVG`,
      '-an', '-f', 'null', '-',
    ], { timeout: timeoutMs, windowsHide: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })

    const txt = String((r && r.stderr) || '') + String((r && r.stdout) || '')
    if (r && (r.error || r.signal)) {
      return { perFrame: [], error: '运动量测超时或被中断（视频太长？）' }
    }

    // metadata=print 的输出成对出现：
    //   frame:0    pts:0       pts_time:0
    //   lavfi.signalstats.YAVG=12.345
    const perFrame = []
    let pendingTime = null
    for (const line of txt.split(/\r?\n/)) {
      const mt = line.match(/pts_time:([0-9]+(?:\.[0-9]+)?)/)
      if (mt) { pendingTime = Number(mt[1]); continue }
      const mv = line.match(/lavfi\.signalstats\.YAVG=([0-9.]+)/)
      if (mv && pendingTime !== null) {
        const v = Number(mv[1])
        if (Number.isFinite(v)) perFrame.push({ t: pendingTime, y: v })
        pendingTime = null
      }
    }
    return { perFrame, error: '' }
  } catch (e) {
    return { perFrame: [], error: String((e && e.message) || e) }
  }
}

/** 事件：切点 / 冻结段 / 静音段（三条 ffmpeg，各自很快） */
export function measureEvents(videoPath, ffmpegPath, opts = {}) {
  const exe = ffmpegPath
  const out = { cuts: [], freezes: [], silences: [], errors: [] }
  if (!exe) { out.errors.push('没找到 ffmpeg'); return out }
  const timeoutMs = Number(opts.timeoutMs) || 300000
  const run = (vf, extra) => {
    try {
      const r = spawnSync(exe, ['-hide_banner', '-nostats', '-i', videoPath, '-vf', vf,
        ...(extra || []), '-f', 'null', '-'],
      { timeout: timeoutMs, windowsHide: true, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
      return String((r && r.stderr) || '') + String((r && r.stdout) || '')
    } catch (e) { out.errors.push(String((e && e.message) || e)); return '' }
  }

  // ① 切点：`select='gt(scene,·)' + showinfo`（和 frames.js 同一条，口径统一）
  //
  // ⚠️ 我第一版用的是 `scdet` —— 而**它默认什么都不打**。实测：
  //    单独跑 `-vf scdet=threshold=10`，stderr 里一行 scd 都没有；
  //    挂上 `metadata=print` 才吐 `lavfi.scd.mafd` / `lavfi.scd.score`。
  //    于是我"检到 0 个切点"，而**同一个素材** frames.js 那套检出 11 处 ——
  //    那是**我的解析在骗我**，而它看起来完全正常（"0 个"是个合理的数）。
  const cutTxt = run(`select='gt(scene,0.32)',showinfo`)
  const cuts = []
  for (const m of cutTxt.matchAll(/pts_time:([0-9.]+)/g)) {
    const t = Number(m[1]); if (Number.isFinite(t) && t >= 0) cuts.push(Math.round(t * 100) / 100)
  }
  out.cuts = [...new Set(cuts)].sort((a, b) => a - b)

  // ② 冻结段：freezedetect 打 freeze_start / freeze_end
  const fzTxt = run('freezedetect=n=-60dB:d=0.5')
  let start = null
  for (const line of fzTxt.split(/\r?\n/)) {
    const ms = line.match(/freeze_start:\s*([0-9.]+)/)
    if (ms) { start = Number(ms[1]); continue }
    const me = line.match(/freeze_end:\s*([0-9.]+)/)
    if (me && start !== null) {
      out.freezes.push({ from: start, to: Number(me[1]) }); start = null
    }
  }

  // ③ 静音段：silencedetect（只在真有音轨时才有意义）
  //    ⚠️ 它**不能**走上面那个 run() —— 那个会拼 `-vf <滤镜>`，
  //    而静音是音频滤镜（`-af`），塞给 -vf 会报错。所以单独一次。
  try {
    const r2 = spawnSync(exe, ['-hide_banner', '-nostats', '-i', videoPath, '-af', 'silencedetect=n=-35dB:d=0.6',
      '-vn', '-f', 'null', '-'],
    { timeout: timeoutMs, windowsHide: true, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
    const t2 = String((r2 && r2.stderr) || '')
    let s2 = null
    for (const line of t2.split(/\r?\n/)) {
      const ms = line.match(/silence_start:\s*(-?[0-9.]+)/)
      if (ms) { s2 = Number(ms[1]); continue }
      const me = line.match(/silence_end:\s*([0-9.]+)/)
      if (me && s2 !== null) { out.silences.push({ from: Math.max(0, s2), to: Number(me[1]) }); s2 = null }
    }
  } catch (e) { out.errors.push('静音检测：' + String((e && e.message) || e)) }

  return out
}

/**
 * 量测一份素材。
 * @returns {{ perSec, motion, events, frames, duration, kind, blindSpot, error }}
 */
export function measure(videoPath, ffmpegPath, opts = {}) {
  const m = measureMotion(videoPath, ffmpegPath, opts)
  if (m.error) return { error: m.error, perSec: [], motion: null, events: null }

  const per = m.perFrame
  if (!per.length) return { error: '没量到运动数据（视频可能没有可解的画面）', perSec: [], motion: null, events: null }

  const duration = per[per.length - 1].t || 0
  const secCount = Math.max(1, Math.ceil(duration + 0.001))
  const perSec = []
  for (let s = 0; s < secCount; s++) {
    const inSec = per.filter((p) => p.t >= s && p.t < s + 1).map((p) => p.y)
    if (!inSec.length) { perSec.push({ s, mean: 0, max: 0, n: 0 }); continue }
    const mean = inSec.reduce((a, b) => a + b, 0) / inSec.length
    perSec.push({ s, mean: Math.round(mean * 100) / 100, max: Math.round(Math.max(...inSec) * 100) / 100, n: inSec.length })
  }

  const allY = per.map((p) => p.y)
  const sorted = [...allY].sort((a, b) => a - b)
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]
  const mean = allY.reduce((a, b) => a + b, 0) / allY.length

  const events = measureEvents(videoPath, ffmpegPath, opts)

  // ── 判型：决定后面走哪套采样体制 ──
  // 阈值学自 video-watch（运动均值 < 0.8 且 p95 < 2 = 低运动），但那两个数
  // 是在它自己的 160 宽口径下测的 —— 这里同样 scale=160，所以可比。
  // ⚠️ 这是**别人给的阈值**，而我没有自己的基准；所以它只当提示，不当判决。
  const kind = (mean < 0.8 && p95 < 2) ? 'low' : 'high'

  return {
    error: '',
    duration: Math.round(duration * 100) / 100,
    frames: per.length,
    perSec,
    motion: { mean: Math.round(mean * 100) / 100, p95: Math.round(p95 * 100) / 100, max: Math.round(Math.max(...allY) * 100) / 100 },
    events,
    kind,
    // 活跃秒占比：有多少秒是"真的在动"
    activeSecRatio: Math.round((perSec.filter((x) => x.mean >= 0.8).length / secCount) * 100) / 100,
  }
}

/**
 * 从量测结果定采样计划：**骨架保证盲区上界，事件填剩余预算**。
 *
 * 这是整套东西的核心一句。它替掉的旧逻辑是
 * 「有场景表就走场景、没有就退回均分」—— 那样在两头都不成立：
 * 低运动素材场景表是空的（退回均分），高运动素材场景表太密（挑几个全凭手感）。
 *
 * @param m measure() 的返回
 * @param opts.skeleton 骨架帧数（默认 16）—— 等间隔，决定盲区上界
 * @param opts.max      总预算上限（默认 36）
 * @param opts.burst    每个事件展开几帧（默认 3；高运动素材才用）
 */
export function planFromMeasure(m, opts = {}) {
  if (!m || m.error) return { times: [], reasons: [], error: (m && m.error) || '没有量测数据' }
  const skeleton = Math.max(4, Number(opts.skeleton) || 16)
  const maxTotal = Math.max(skeleton + 2, Number(opts.max) || 36)
  const burst = Math.max(1, Number(opts.burst) || 3)
  const dur = m.duration || 0
  if (!(dur > 0)) return { times: [], reasons: [], error: '时长为 0' }

  const picked = new Map()   // t → reason
  const add = (t, why) => {
    if (!(t >= 0 && t <= dur)) return
    const k = Math.round(t * 100) / 100
    if (!picked.has(k)) picked.set(k, why)
  }

  // ── ① 骨架：等间隔，**它保证"任何 gap 秒里至少有一帧"** ──
  const gap = dur / skeleton
  for (let i = 0; i < skeleton; i++) add(gap * i + gap / 2, `骨架 ${gap.toFixed(2)}s 等间隔`)
  add(0.02, '开头')
  add(Math.max(0, dur - 0.05), '末尾')

  // ── ② 事件：切点 > 内容突变 > 运动峰 > 运动谷 ──
  //    每一类按时间窗轮转取，防偏食（不然事件密的那几秒会吃掉全部预算）
  const budget = maxTotal - picked.size
  if (budget > 0) {
    const evs = []
    for (const t of (m.events && m.events.cuts) || []) evs.push({ t, kind: 0, why: '切点' })
    // 内容突变：用**每秒最大值**排，而不是均值 —— 均值会被稀释（这是它那条实测）
    const secs = [...(m.perSec || [])].sort((a, b) => b.max - a.max)
    const topN = Math.min(secs.length, Math.max(3, Math.round(secs.length * 0.15)))
    for (const s of secs.slice(0, topN)) evs.push({ t: s.s + 0.5, kind: 1, why: `内容突变 YMAX=${s.max}` })
    // 运动谷底：动作落定、状态最清晰的那个点（低运动素材的主信号）
    const lows = [...(m.perSec || [])].sort((a, b) => a.max - b.max).slice(0, Math.max(2, topN >> 1))
    for (const s of lows) evs.push({ t: s.s + 0.5, kind: 3, why: `运动谷底 YMAX=${s.max}` })
    evs.sort((a, b) => a.kind - b.kind || a.t - b.t)

    const perEvent = m.kind === 'high' ? burst : 1
    let used = 0
    for (const e of evs) {
      if (used + perEvent > budget) break
      if (perEvent === 1) { add(e.t, e.why); used++ } else {
        // 成组采样：把事件点前后铺成一小串连续帧（单帧只是冻结瞬间）
        const step = 0.12
        for (let k = 0; k < perEvent; k++) add(e.t + (k - (perEvent >> 1)) * step, `${e.why} 组${k + 1}/${perEvent}`)
        used += perEvent
      }
    }
  }

  const times = [...picked.keys()].sort((a, b) => a - b)
  const fps = Number(opts.fps) || 30
  // ⚠️ 输出形状**和 frames.js 的 planFrames 对齐**（picks:[{sec, offset, index, at}]）——
  //    那样 news.js 那边只换"计划从哪来"，其余一律不动。
  const picks = times.map((t) => {
    const sec = Math.floor(t)
    const off = Math.round((t - sec) * 1000) / 1000
    return { sec, offset: off, index: absoluteFrameIndex(sec, off, fps), at: Math.round(t * 100) / 100 }
  })
  return {
    fps, perSecond: 1, picks, mode: 'measured',
    times,
    reasons: times.map((t) => picked.get(t)),
    blindSpot: Math.round((dur / skeleton) * 100) / 100,
    kind: m.kind,
    note: (m.kind === 'high'
      ? '高运动素材：主信号是运动曲线，事件成组采样'
      : '低运动素材：主信号是内容突变（均值会被稀释），单帧足够')
      + ' · 盲区上界 ' + (Math.round((dur / skeleton) * 100) / 100) + 's',
    error: '',
  }
}

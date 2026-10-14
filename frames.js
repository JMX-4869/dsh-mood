/**
 * 视频抽帧 —— 让模型**真的看一眼**画面，而不是只读字幕。
 *
 * ────────────────────────────────────────────────────────────────
 *  为什么要这个
 * ────────────────────────────────────────────────────────────────
 *  原来读一个视频只有一条路：yt-dlp 取字幕（VTT）→ 文本。
 *  但 bilibili 上大量视频**没有字幕**（图文、短视频、纯音乐、游戏录屏…），
 *  那条路拿到的是空的，最后只能退回页面简介 —— 等于什么都没读。
 *
 *  抽帧是另一条路：把关键画面抽成 PNG，**路径交给模型**，它用 read_image 看。
 *  字幕那路**保留**，两条并存：有字幕读字幕，字幕不行就看画面。
 *
 * ────────────────────────────────────────────────────────────────
 *  那张抽帧表怎么用
 * ────────────────────────────────────────────────────────────────
 *  主人给的表是「每种帧率下，1 秒里抽这 8 帧的话抽第几帧」：
 *
 *      30fps → 1, 5, 9, 13, 16, 20, 24, 28
 *      60fps → 3, 11, 18, 26, 33, 41, 48, 56
 *
 *  它的用处是：**给定"第几秒"，算出确切的帧号**，然后用 ffmpeg 的
 *  `select='eq(n\,帧号)+…'` 精确抓那一帧 —— 而不是让 ffmpeg 自己按
 *  `-ss` 秒数去就近找（那个会落在转场/黑帧上，还慢）。
 *
 *  表里的偏移量是**均匀铺满那一秒**的，所以取前 k 个就是"每秒 k 帧"。
 */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'

// ---------------------------------------------------------------- 表

/**
 * 抽帧表（照抄主人给的那张 CSV，两列都留着）。
 *
 * `frames` =「从 1 开始数」那一列。ffmpeg 的 `n` 是**从 0 开始**的帧序号，
 * 换算在 `absoluteFrameIndex()` 里做（-1），别在这儿混。
 */
export const FRAME_TABLE = [
  { fps: 23.976, total: 24, frames: [2, 5, 8, 11, 14, 17, 20, 23] },
  { fps: 24, total: 24, frames: [2, 5, 8, 11, 14, 17, 20, 23] },
  { fps: 25, total: 25, frames: [2, 5, 8, 11, 15, 18, 21, 24] },
  { fps: 29.97, total: 30, frames: [2, 6, 10, 14, 17, 21, 25, 29] },
  { fps: 30, total: 30, frames: [2, 6, 10, 14, 17, 21, 25, 29] },
  { fps: 48, total: 48, frames: [4, 10, 16, 22, 28, 34, 40, 46] },
  { fps: 50, total: 50, frames: [4, 10, 16, 22, 29, 35, 41, 47] },
  { fps: 59.94, total: 60, frames: [4, 12, 19, 27, 34, 42, 49, 57] },
  { fps: 60, total: 60, frames: [4, 12, 19, 27, 34, 42, 49, 57] },
  { fps: 100, total: 100, frames: [7, 19, 32, 44, 57, 69, 82, 94] },
  { fps: 119.88, total: 120, frames: [8, 23, 38, 53, 68, 83, 98, 113] },
  { fps: 120, total: 120, frames: [8, 23, 38, 53, 68, 83, 98, 113] },
]

/** 找表里最接近的一档（实测帧率经常是 29.97、59.94 这种） */
export function nearestFps(fps) {
  const n = Number(fps)
  if (!Number.isFinite(n) || n <= 0) return FRAME_TABLE.find((r) => r.fps === 30)
  let best = FRAME_TABLE[0]
  let bestD = Infinity
  for (const row of FRAME_TABLE) {
    const d = Math.abs(row.fps - n)
    if (d < bestD) { bestD = d; best = row }
  }
  return best
}

/**
 * 这一秒里要抽的偏移量（表里那一列的前 k 个）。
 * k = 1 就用表的第一个偏移；k 到 8 就用满。
 */
export function frameOffsets(fps, perSecond = 1) {
  const row = nearestFps(fps)
  const k = Math.max(1, Math.min(8, Number(perSecond) || 1))
  return row.frames.slice(0, k)
}

/**
 * 把「第 sec 秒的第 offset 帧」换算成 ffmpeg 的绝对帧号。
 *
 * ⚠️ 表里是**从 1 开始数**的，ffmpeg 的 `n` **从 0 开始** —— 这里减 1。
 *    第一版要是忘了减，整批画面全部往后偏一帧（看着没错，其实是下一帧）。
 */
export function absoluteFrameIndex(sec, offset, fps) {
  const f = Number(fps) || 30
  return Math.max(0, Math.round(Number(sec) * f) + (Number(offset) - 1))
}

// ---------------------------------------------------------------- 计划

/**
 * 给定视频时长，定出"抽哪几帧"。
 *
 * 默认：**最多 16 帧**、每秒 1 帧，秒间隔自动算 ——
 * 一段 3 分钟的视频大约每 11 秒取一帧，够看懂"讲了什么"，又不至于
 * 把 480 张图塞给模型（主人那张表是每秒 8 帧，那是**每 8 帧取第几帧**的
 * 选择表，不是让你每秒真抽 8 张；真按那个抽，3 分钟就是 1440 张）。
 */
export function planFrames(durationSec, opts = {}) {
  const duration = Math.max(0, Number(durationSec) || 0)
  const maxFrames = Math.max(1, Math.min(64, Number(opts.maxFrames) || 16))
  const perSecond = Math.max(1, Math.min(8, Number(opts.perSecond) || 1))
  const fps = Number(opts.fps) || 30

  if (duration <= 0) return { fps, perSecond, everySec: 1, picks: [], note: '拿不到时长' }

  // 每秒抽 perSecond 张 → 每 everySec 秒取一组
  let everySec = Number(opts.everySec)
  if (!Number.isFinite(everySec) || everySec <= 0) {
    const groups = Math.max(1, Math.floor(maxFrames / perSecond))
    everySec = Math.max(1, Math.ceil(duration / groups))
  }

  const offsets = frameOffsets(fps, perSecond)
  const picks = []
  for (let sec = 0; sec < duration && picks.length < maxFrames; sec += everySec) {
    for (const off of offsets) {
      if (picks.length >= maxFrames) break
      if (sec >= duration) break
      picks.push({
        sec,
        offset: off,
        index: absoluteFrameIndex(sec, off, fps),
        at: sec,                       // 展示用：第几秒
      })
    }
  }
  return { fps, perSecond, everySec, picks, note: '' }
}

/** 给 ffmpeg 拼 `select` 表达式 */
export function selectExpr(indices) {
  const uniq = [...new Set(indices.map((n) => Math.max(0, Math.round(n))))]
  if (!uniq.length) return ''
  return uniq.map((n) => "eq(n\\," + n + ")").join('+')
}

// ---------------------------------------------------------------- 工具

/** ffmpeg / ffprobe 可能在哪。**绝对路径优先** —— 插件进程不一定带 PATH。 */
export function mediaToolCandidates(name) {
  const exe = process.platform === 'win32' ? name + '.exe' : name
  const home = process.env.USERPROFILE || process.env.HOME || ''
  const out = []
  if (home) {
    out.push(join(home, '.dsh', 'bin', exe))
    out.push(join(home, 'bin', exe))
  }
  // WinGet 装的那种会放个链接在这
  const local = process.env.LOCALAPPDATA
  if (local) out.push(join(local, 'Microsoft', 'WinGet', 'Links', exe))
  out.push(name)
  return out
}

export function findMediaTool(name) {
  for (const p of mediaToolCandidates(name)) {
    try {
      const r = spawnSync(p, ['-version'], { timeout: 8000, windowsHide: true, encoding: 'utf8' })
      if (r && r.status === 0) return p
    } catch { /* 试下一个 */ }
  }
  return null
}

/** 问 ffprobe：时长 / 帧率 / 分辨率。拿不到就返回 null。 */
export function probe(videoPath, ffprobePath) {
  const exe = ffprobePath || findMediaTool('ffprobe')
  if (!exe) return null
  try {
    const r = spawnSync(exe, [
      '-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height,r_frame_rate:format=duration',
      '-of', 'json', videoPath,
    ], { timeout: 30000, windowsHide: true, encoding: 'utf8' })
    if (!r || r.status !== 0) return null
    const j = JSON.parse(r.stdout || '{}')
    const st = (j.streams && j.streams[0]) || {}
    const dur = Number((j.format && j.format.duration) || 0)
    let fps = 0
    const rate = String(st.r_frame_rate || '')
    const m = rate.match(/^(\d+)\/(\d+)$/)
    if (m && Number(m[2])) fps = Number(m[1]) / Number(m[2])
    return { durationSec: dur, fps: fps || 30, width: st.width || 0, height: st.height || 0 }
  } catch { return null }
}

/**
 * 按计划抽帧。返回写出来的文件路径（按时间顺序）。
 *
 * ⚠️ 抽之前**先清空目录** —— 主人要的"读取完自动删除"就靠这个 +
 *    `sweepOldFrames()` 的时限清理。绝不越攒越多。
 */
export function extractFrames(videoPath, plan, outDir, ffmpegPath) {
  const exe = ffmpegPath || findMediaTool('ffmpeg')
  if (!exe) return { ok: false, files: [], error: '没找到 ffmpeg' }
  if (!plan || !plan.picks || !plan.picks.length) return { ok: false, files: [], error: '没有要抽的帧' }

  mkdirSync(outDir, { recursive: true })
  cleanFrames(outDir)

  const expr = selectExpr(plan.picks.map((p) => p.index))
  if (!expr) return { ok: false, files: [], error: '抽帧表达式是空的' }

  try {
    const r = spawnSync(exe, [
      '-hide_banner', '-loglevel', 'error',
      '-i', videoPath,
      '-vf', 'select=' + expr,
      // ⚠️ 用 `-fps_mode` 不用 `-vsync` —— ffmpeg 9 把 `-vsync` 删了，
      //    带上它就 `Unrecognized option 'vsync'` 直接失败。
      //    passthrough = 抽一张出一张，别补帧。
      '-fps_mode', 'passthrough',
      '-frames:v', String(plan.picks.length),
      join(outDir, 'f%03d.png'),
    ], { timeout: 180000, windowsHide: true, encoding: 'utf8' })
    if (!r || r.status !== 0) {
      return { ok: false, files: [], error: 'ffmpeg 抽帧失败：' + String((r && r.stderr) || '').slice(0, 160) }
    }
  } catch (e) {
    return { ok: false, files: [], error: 'ffmpeg 调用失败：' + ((e && e.message) || e) }
  }

  const files = readdirSync(outDir).filter((f) => /\.png$/i.test(f)).sort().map((f) => join(outDir, f))
  return { ok: files.length > 0, files, error: files.length ? '' : 'ffmpeg 没输出文件' }
}

// ---------------------------------------------------------------- 清理

/**
 * 删掉这一批（或整个目录里的东西）。
 * 主人明确要求："抽帧读取完自动删除"。
 */
export function cleanFrames(dir) {
  let n = 0
  try {
    for (const f of readdirSync(dir)) {
      try { rmSync(join(dir, f), { force: true, recursive: true }); n++ } catch { /* 删不掉就算了 */ }
    }
  } catch { /* 目录不在就是干净的 */ }
  return n
}

/**
 * 时限清理：删掉超过 `maxAgeMs` 没动过的批次目录。
 *
 * 为什么还要这个：清理是"下一次抽帧时顺手做"，但如果主人抽完帧就再也没碰过
 * 这个功能，那一批图会一直躺在磁盘上。所以每次抽帧前再按时间扫一遍。
 */
export function sweepOldFrames(baseDir, maxAgeMs = 2 * 3600 * 1000, now = Date.now()) {
  let removed = 0
  try {
    if (!existsSync(baseDir)) return 0
    for (const d of readdirSync(baseDir)) {
      const p = join(baseDir, d)
      let st = null
      try { st = statSync(p) } catch { continue }
      if (!st.isDirectory()) continue
      if (now - st.mtimeMs > maxAgeMs) {
        try { rmSync(p, { recursive: true, force: true }); removed++ } catch { /* 不管 */ }
      }
    }
  } catch { /* 不管 */ }
  return removed
}

/** 一批帧的目录（固定位置，每次抽都换一个编号，方便整批删） */
export function batchDir(baseDir, stamp = Date.now()) {
  return join(baseDir, 'b' + String(stamp))
}

export function ensureDir(p) {
  mkdirSync(dirname(p), { recursive: true })
  mkdirSync(p, { recursive: true })
  return p
}

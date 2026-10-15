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
  const maxFrames = Math.max(1, Math.floor(Number(opts.maxFrames) || 16))
  const perSecond = Math.max(1, Math.min(8, Number(opts.perSecond) || 1))
  const fps = Number(opts.fps) || 30

  if (duration <= 0) return { fps, perSecond, everySec: 1, picks: [], mode: 'none', note: '拿不到时长' }

  // ── 自适应那条路（默认，只要给了场景表）──
  //
  // ⚠️ 为什么要有它：**固定间隔会错过结构。**
  //    实测：一支 217 秒的 MV，按每 9 秒均分抽 24 帧 ——
  //    每一帧单独看都很好，但**全是同一类东西**（暗色聊天窗 / 一个大衬线词）。
  //    真正的信息在"什么时候换的、换了几次"上，而均分恰好把它抹平了。
  const scenes = Array.isArray(opts.scenes)
    ? opts.scenes.map(Number).filter((t) => Number.isFinite(t) && t >= 0 && t < duration).sort((a, b) => a - b)
    : []
  if (scenes.length >= 2 && !opts.forceEven && !Number.isFinite(Number(opts.everySec))) {
    return planByScenes(duration, scenes, { fps, maxFrames, perSecond })
  }

  // ── 均匀（老行为，留着当后备）──
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
  return {
    fps, perSecond, everySec, picks, mode: 'even',
    // ⚠️ 2026-10-16：这句原来只会说"场景表不够用"，而那是**四条原因里的一条**。
    //    实际最常见的是**用户自己给了 everySec / forceEven** —— 那条路上场景表根本没问题。
    //    说错原因会让我误判工具状态（读成"场景检测坏了"），进而怀疑别的结论。改成说真实那一句。
    note: '（按秒均分：' + (
      Number.isFinite(Number(opts.everySec)) ? '你指定了 everySec'
        : opts.forceEven ? '你指定了 forceEven'
          : scenes.length ? ('场景表只检出 ' + scenes.length + ' 个切换点，不够用')
            : '没检出画面切换'
    ) + '）',
  }
}

/**
 * 按场景切换点排计划（自适应那条路）。
 *
 * 对应主人说的两件事：
 *  · **画面整体性** —— 变化少的视频取出来的帧**本身就少**，不硬凑到 maxFrames
 *  · **信息获取度**     —— 在真正变的地方取；一闪而过的段并掉；超上限时沿时间线均匀挑
 *
 * @param scenes 升序的切换时刻（秒）。**不含 0** —— 开头单独补。
 */
function planByScenes(duration, scenes, { fps, maxFrames, perSecond }) {
  // ① 切换点之后"落稳"一点再取。
  //    ⚠️ 别取切换那一帧本身 —— 那一帧常常正是转场 / 黑场 / 叠化中间态。
  const SETTLE = 0.35
  // ② 短于这个的段并掉：一闪而过的东西多半不含信息，却会白占一格
  const MIN_SCENE = 0.45

  const marks = [0, ...scenes.map((t) => Math.min(duration - 0.05, t + SETTLE))]
    .filter((t) => t >= 0 && t < duration)
    .sort((a, b) => a - b)

  // 一个点属于哪一段 = 它到下一个点的距离。太短的段不要。
  const kept = []
  for (let i = 0; i < marks.length; i++) {
    const next = i + 1 < marks.length ? marks[i + 1] : duration
    // 开头那一帧永远留 —— "开场是什么"是必看信息，哪怕它很短
    if (i === 0 || (next - marks[i]) >= MIN_SCENE) kept.push(marks[i])
  }

  // ★★ 一层**稀疏的均分兜底** —— 这不是"退回均分"，是**并集**。
  //
  //    ⚠️ 为什么必须加：**ffmpeg 的 `scene` 度量只看亮度，对"色相剧变、亮度不变"的切换完全瞎。**
  //       实测（造了个红→绿→蓝的三段视频来试）：
  //         红 (253,0,0) YAVG=81 ／ 绿 (0,127,0) YAVG=81 ／ 蓝 (0,0,254) YAVG=41
  //       红→绿那一下 **scene_score = 0.000000**（阈值降到 0.05 也照样 0），
  //       绿→蓝才有 0.4。
  //       也就是说：**只靠它，会整段整段地漏。**
  //       而"平涂色块之间的切"恰恰是我最常看的那类内容（设计稿、海报轮播、MV 的标题卡）。
  //
  //    所以场景检测负责"在变的地方加密"，均分负责"别整段看不见"，两个取并集。
  const backbone = Math.max(2, Math.ceil(maxFrames / 3))
  for (let i = 0; i < backbone; i++) {
    kept.push((i * duration) / backbone)
  }
  kept.sort((a, b) => a - b)

  // ③ 超上限时**沿时间线均匀地挑**，保住整条时间线的覆盖。
  //    不是挑"变化最大"的那些 —— 那会只看见几个最响的瞬间，看不见片子是怎么走的。
  let use = kept
  if (kept.length > maxFrames) {
    // ⚠️ **沿"时间"均匀取点，再吸附到最近的那个切换点** ——
    //    别写成"从 kept 列表里均匀取"。
    //
    //    踩过：真片上（217 秒那支 MV）阈值 0.32 检出 25 处，
    //    其中 **14 处挤在最后 30 秒**（结尾快切）。从**列表**里均匀取的话，
    //    列表本身就挤，于是 12 张里有 6 张落在最后 —— 越挤的地方被挑中的越多，
    //    整条时间线的前 3/4 反而看不清。
    //    改成从**时间轴**上取点再吸附，就同时保住了"覆盖整条线"和"落在变化上"。
    use = []
    for (let i = 0; i < maxFrames; i++) {
      const target = (i * duration) / Math.max(1, maxFrames)
      let best = kept[0], bestD = Infinity
      for (const t of kept) {
        const d = Math.abs(t - target)
        if (d < bestD) { bestD = d; best = t }
      }
      use.push(best)
    }
    use = [...new Set(use)].sort((a, b) => a - b)
  }

  const picks = []
  // ⚠️ **合并阈值要跟"预算"走，不能写死一个秒数。**
  //
  //    原来写的是 0.4 秒。真片上就露馅了：检出的点里 20s 和 22s 挨着，
  //    吸附之后变成 20.4 和 22.4 —— 两张帧隔 2 秒，**那是同一处变化，白占一格**。
  //    12 张的预算、217 秒的片子，平均一张该管 18 秒；隔 2 秒取两张显然浪费。
  //
  //    用"平均间隔的一半"当门槛：预算越紧、片子越长，就越不允许两张挨着。
  const minGap = duration / Math.max(1, maxFrames) * 0.5
  for (const at of use) {
    if (picks.length >= maxFrames) break
    const prev = picks[picks.length - 1]
    if (prev && at - prev.at < minGap) continue
    picks.push({
      sec: Math.floor(at),
      offset: 0,
      index: Math.max(0, Math.round(at * fps)),   // 这里直接按秒算，不走 absoluteFrameIndex
      at: Math.round(at * 10) / 10,
    })
  }

  const note = kept.length > maxFrames
    ? `（检测到 ${scenes.length} 处画面切换，沿时间线挑了 ${picks.length} 张）`
    : `（按 ${scenes.length} 处画面切换取，取了 ${picks.length} 张）`
  return { fps, perSecond, everySec: 0, picks, mode: 'scene', sceneCount: scenes.length, note }
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
 * 用 ffmpeg 自己找出**画面什么时候变了**（场景切换时刻表）。
 *
 * 原理：`select='gt(scene,阈值)'` 是 ffmpeg 内置的场景变化度量（0~1，越大变得越猛），
 * 后面挂 `showinfo`，它会把每个被选中的帧的 `pts_time` 打到 stderr 上。
 *
 * ────────────────────────────────────────────────────────────────
 *  两个坑，都写在代码里，别"优化"掉
 * ────────────────────────────────────────────────────────────────
 * ① **别加 `-skip_frame nokey`。** 看着很划算（只看关键帧，快得多），
 *    但 `scene` 度量的就是**相邻两帧**的差 —— 只看关键帧的话，
 *    相邻两帧隔了十几秒，分数必然虚高，**等于每个关键帧都算切换点**，整个表就废了。
 * ② 所以走**降采样后全解码**：`scale=160:-2` 把比较那一步压到很小。
 *    代价是仍要解一遍全片 —— 所以**给超时**，超了就返回空表，让上层退回均匀抽帧。
 *
 * @returns {{ times:number[], error:string, note:string }}
 */
export function detectScenes(videoPath, ffmpegPath, opts = {}) {
  const exe = ffmpegPath || findMediaTool('ffmpeg')
  if (!exe) return { times: [], error: '没找到 ffmpeg', note: '' }
  const th = Number.isFinite(Number(opts.threshold)) ? Number(opts.threshold) : 0.32
  const timeoutMs = Number(opts.timeoutMs) || 120000
  try {
    const r = spawnSync(exe, [
      '-hide_banner', '-nostats',
      '-i', videoPath,
      '-vf', `scale=160:-2,select='gt(scene,${th})',showinfo`,
      '-an', '-f', 'null', '-',
    ], { timeout: timeoutMs, windowsHide: true, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
    const txt = String((r && r.stderr) || '') + String((r && r.stdout) || '')
    const times = []
    for (const m of txt.matchAll(/pts_time:([0-9]+(?:\.[0-9]+)?)/g)) {
      const t = Number(m[1])
      if (Number.isFinite(t) && t >= 0) times.push(t)
    }
    const uniq = [...new Set(times.map((t) => Math.round(t * 100) / 100))].sort((a, b) => a - b)
    if (!uniq.length) {
      // 没检出来**不一定是失败**：静止画面 / 单镜头视频本来就该是空的。
      // 但如果是超时被杀的，得说清楚 —— 那两种情况的处理方式不一样。
      const killed = !!(r && (r.error || r.signal))
      return { times: [], error: killed ? '场景检测超时（视频太长）' : '', note: killed ? '' : '没检出画面切换（可能是单镜头 / 静止画面）' }
    }
    return { times: uniq, error: '', note: '' }
  } catch (e) {
    return { times: [], error: String((e && e.message) || e), note: '' }
  }
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
 * 删掉 `baseDir` 底下**除 `keepName` 之外的所有东西**。
 *
 * 这是"抽完、看完就删"的主力：每次抽帧前调一次，
 * 上一批连同临时视频目录一起没了，磁盘上永远只有**当前这一批**。
 *
 * ⚠️ 别拿 `sweepOldFrames(base, 0)` 去凑这个效果 —— 它的判据是 mtime，
 *    而刚建的那批 mtime 就是"现在"，`now - mtime > 0` 会把它自己也算进去。
 *    （写这段的时候差点就这么干了。）
 */
export function cleanExcept(baseDir, keepName) {
  let n = 0
  try {
    if (!existsSync(baseDir)) return 0
    for (const f of readdirSync(baseDir)) {
      if (f === keepName) continue
      try { rmSync(join(baseDir, f), { force: true, recursive: true }); n++ } catch { /* 删不掉就算了 */ }
    }
  } catch { /* 目录不在就是干净的 */ }
  return n
}

/**
 * 时限清理：删掉超过 `maxAgeMs` 没动过的批次目录。
 *
 * 正常情况下靠 `cleanExcept` 就够了。这个留着当**兜底**：
 * 万一某次抽帧中途挂了（进程被杀、磁盘满），会留下没人管的孤儿目录。
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

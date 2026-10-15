/**
 * 视频抽帧。
 *
 * 主人给的那张表是「每种帧率下、1 秒里抽这 8 帧的话抽第几帧」——
 * 这个文件先把**表的用法**钉死，再测计划、表达式、清理。
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

const F = await import(new URL('frames.js?t=', import.meta.url).href + Date.now())
const t = suite('视频抽帧')

// ══════════════════════════════════════════════════════
//  表本身：跟主人给的 CSV 逐行对上
// ══════════════════════════════════════════════════════
{
  // 抄自 一份导出的 CSV 的「从 1 开始数」那一列
  const CSV = {
    23.976: [2, 5, 8, 11, 14, 17, 20, 23],
    24: [2, 5, 8, 11, 14, 17, 20, 23],
    25: [2, 5, 8, 11, 15, 18, 21, 24],
    29.97: [2, 6, 10, 14, 17, 21, 25, 29],
    30: [2, 6, 10, 14, 17, 21, 25, 29],
    48: [4, 10, 16, 22, 28, 34, 40, 46],
    50: [4, 10, 16, 22, 29, 35, 41, 47],
    59.94: [4, 12, 19, 27, 34, 42, 49, 57],
    60: [4, 12, 19, 27, 34, 42, 49, 57],
    100: [7, 19, 32, 44, 57, 69, 82, 94],
    119.88: [8, 23, 38, 53, 68, 83, 98, 113],
    120: [8, 23, 38, 53, 68, 83, 98, 113],
  }
  const rows = Object.keys(CSV)
  t.eq(F.FRAME_TABLE.length, rows.length, '表里有 ' + rows.length + ' 档帧率')
  let bad = []
  for (const k of rows) {
    const row = F.FRAME_TABLE.find((r) => String(r.fps) === k)
    if (!row) { bad.push(k + ' 缺'); continue }
    if (JSON.stringify(row.frames) !== JSON.stringify(CSV[k])) bad.push(k + ' 帧号不符')
  }
  t.eq(bad.length, 0, '每一档的帧号都和 CSV 一致' + (bad.length ? '（' + bad.join('; ') + '）' : ''))
  // 每档 8 个位置，且严格递增、都在那一秒里
  let shapeOk = true
  for (const r of F.FRAME_TABLE) {
    if (r.frames.length !== 8) shapeOk = false
    for (let i = 1; i < r.frames.length; i++) if (r.frames[i] <= r.frames[i - 1]) shapeOk = false
    if (r.frames.some((x) => x < 1 || x > r.total + 1)) shapeOk = false
  }
  t.ok(shapeOk, '每档 8 个位置、严格递增、都落在那一秒里')
}

// ══════════════════════════════════════════════════════
//  帧率归位
// ══════════════════════════════════════════════════════
{
  t.eq(F.nearestFps(30).fps, 30, '30 → 30')
  t.eq(F.nearestFps(29.97).fps, 29.97, '29.97 → 29.97（实测常见）')
  t.eq(F.nearestFps(59.94).fps, 59.94, '59.94 → 59.94')
  t.eq(F.nearestFps(29).fps, 29.97, '29 → 最近的 29.97')
  t.eq(F.nearestFps(31).fps, 30, '31 → 最近的 30')
  t.eq(F.nearestFps(1000).fps, 120, '离谱的值 → 表里最大的那档（不崩）')
  t.eq(F.nearestFps(0).fps, 30, '0 → 兜底 30')
  t.eq(F.nearestFps(NaN).fps, 30, 'NaN → 兜底 30')
  t.eq(F.nearestFps(undefined).fps, 30, 'undefined → 兜底 30')
}

// ══════════════════════════════════════════════════════
//  每秒抽几张
// ══════════════════════════════════════════════════════
{
  t.eq(JSON.stringify(F.frameOffsets(30, 1)), '[2]', '30fps 每秒 1 张 → 取表的第 1 个偏移')
  t.eq(JSON.stringify(F.frameOffsets(30, 3)), '[2,6,10]', '30fps 每秒 3 张 → 取前 3 个')
  t.eq(JSON.stringify(F.frameOffsets(30, 8)), JSON.stringify([2, 6, 10, 14, 17, 21, 25, 29]), '30fps 每秒 8 张 → 用满')
  t.eq(F.frameOffsets(30, 99).length, 8, '要多了也只给 8 个（表就这么长）')
  t.eq(F.frameOffsets(30, 0).length, 1, '要 0 张也给 1 张（不返回空）')
}

// ══════════════════════════════════════════════════════
//  秒 + 偏移 → 绝对帧号
// ══════════════════════════════════════════════════════
{
  // ⚠️ 表里是**从 1 开始数**，ffmpeg 的 n **从 0 开始** → 要减 1
  t.eq(F.absoluteFrameIndex(0, 2, 30), 1, '第 0 秒、表的第 2 帧 → 绝对帧 1（2-1=1）')
  t.eq(F.absoluteFrameIndex(1, 2, 30), 31, '第 1 秒 → 31')
  t.eq(F.absoluteFrameIndex(3, 6, 30), 95, '第 3 秒、偏移 6 → 95')
  t.eq(F.absoluteFrameIndex(0, 1, 30), 0, '偏移 1 → 第 0 帧（不能是负的）')
  t.eq(F.absoluteFrameIndex(2, 4, 25), 53, '25fps 也按实际帧率算')
}

// ══════════════════════════════════════════════════════
//  计划
// ══════════════════════════════════════════════════════
{
  const p = F.planFrames(600, { maxFrames: 12, fps: 30 })
  t.eq(p.picks.length, 12, '10 分钟视频 → 抽满 12 张（封顶）')
  t.ok(p.everySec >= 1, '秒间隔至少 1（' + p.everySec + '）')
  t.ok(p.picks.every((x) => x.index >= 0), '帧号都非负')
  let inc = true
  for (let i = 1; i < p.picks.length; i++) if (p.picks[i].index <= p.picks[i - 1].index) inc = false
  t.ok(inc, '帧号严格递增（时间线不能乱）')

  const short = F.planFrames(10, { maxFrames: 12, fps: 30 })
  t.eq(short.picks.length, 10, '10 秒视频 → 抽 10 张（不够封顶就都抽）')
  t.eq(short.everySec, 1, '短视频每 1 秒取一帧')

  const many = F.planFrames(60, { maxFrames: 6, perSecond: 2, fps: 30 })
  t.eq(many.picks.length, 6, '每秒 2 张 + 封顶 6 → 正好 6')
  t.eq(many.perSecond, 2, 'perSecond 生效')

  const explicit = F.planFrames(1000, { maxFrames: 20, everySec: 100, fps: 30 })
  t.eq(explicit.everySec, 100, '显式 everySec 优先')
  t.eq(explicit.picks.length, 10, '1000 秒每 100 秒一张 → 10 张')

  t.eq(F.planFrames(0).picks.length, 0, '时长为 0 → 没有要抽的帧')
  t.ok(F.planFrames(0).note, '而且给了个说法（拿不到时长）')
  t.noThrow(() => F.planFrames(NaN), 'NaN 时长不崩')
  t.noThrow(() => F.planFrames(600, { maxFrames: -5 }), '负数 maxFrames 不崩')
  // ⚠️ 2026-10-16 改：**上限 64 取消了**。
  //    原来这条断言写的是"maxFrames 有上限（不会一次要几千张）"——那是我自己加的保险，
  //    但主人指出：**稀疏抽帧本身就会丢信息**，98 秒按秒抽该给 98 张，被砍到 63 秒就是"尾巴消失"。
  //    现在改成：给多少就抽多少，**由 maxMinutes 和磁盘兜底**，不再在这里腰斩。
  t.eq(F.planFrames(600, { maxFrames: 9999 }).picks.length > 64, true, 'maxFrames 不再有 64 的上限（给多少抽多少）')

  // ⚠️ 2026-10-16 加：走到"按秒均分"这条路有四种原因，note 必须说对是哪一种。
  //    原来它无论哪种都说"场景表不够用"—— 而最常走这条路的其实是"用户给了 everySec"，
  //    那时场景表可能是好的。说错原因会让我误判工具状态（读成"场景检测坏了"）。
  {
    const n1 = F.planFrames(100, { maxFrames: 50, everySec: 1 }).note || ''
    const n2 = F.planFrames(100, { maxFrames: 50, forceEven: true, scenes: [1, 2, 3] }).note || ''
    const n3 = F.planFrames(100, { maxFrames: 50, scenes: [1] }).note || ''
    const n4 = F.planFrames(100, { maxFrames: 50 }).note || ''
    t.eq(/everySec/.test(n1), true, 'note 说得出"你指定了 everySec"')
    t.eq(/forceEven/.test(n2), true, 'note 说得出"你指定了 forceEven"')
    t.eq(/1 个切换点/.test(n3), true, 'note 说得出场景点具体有几个')
    t.eq(/没检出画面切换/.test(n4), true, 'note 说得出"没检出画面切换"')
    t.eq(/场景表不够用/.test(n1 + n2 + n3 + n4), false, '不再用"场景表不够用"这一句盖所有原因')
  }
}

// ══════════════════════════════════════════════════════
//  自适应抽帧（按画面切换取，而不是按秒均分）
// ══════════════════════════════════════════════════════
{
  const sc = [10, 20, 30, 40, 50, 60, 70, 80, 90, 95]
  const p = F.planFrames(100, { scenes: sc, maxFrames: 24, fps: 30 })
  t.eq(p.mode, 'scene', '给了场景表 → 走自适应')
  t.eq(p.sceneCount, 10, '记下了检测到几处切换')
  t.ok(p.picks.length >= 10, '至少每个切换点一张（' + p.picks.length + '）')
  t.eq(p.picks[0].at, 0, '**第一张永远是开头那一帧**')
  let inc = true
  for (let i = 1; i < p.picks.length; i++) if (p.picks[i].index <= p.picks[i - 1].index) inc = false
  t.ok(inc, '帧号严格递增（时间线不能乱）')

  // 变化少的视频不能硬凑到上限 —— 这正是"整体性"那一条
  //
  // ⚠️ 注意：**不是"取得很少"**。自适应里有一层**稀疏的均分兜底**（见 planByScenes 那段注释：
  //    ffmpeg 的 scene 只看亮度，红切绿那种亮度不变的切换它给 0.0，整段会瞎）。
  //    所以"变化少"的正确含义是"**不硬凑到上限**"，不是"只有两三张"。
  const few = F.planFrames(100, { scenes: [40, 70], maxFrames: 24, fps: 30 })
  t.eq(few.mode, 'scene', '只有两处切换也走自适应')
  t.ok(few.picks.length < 24, '**变化少 → 不硬凑到上限**（取了 ' + few.picks.length + ' / 上限 24）')
  t.ok(few.picks.length < p.picks.length,
    '**变化少的比变化多的取得少**（' + few.picks.length + ' < ' + p.picks.length + '）—— 这是"整体性"那条')
  t.ok(few.picks.every((x) => x.at >= 0 && x.at < 100), '兜底那几张也没跑到片子外面')

  // 切换点比上限多 → 沿时间线均匀挑，保住覆盖
  const manySc = []
  for (let i = 1; i < 200; i++) manySc.push(i * 0.5)
  const cap = F.planFrames(100, { scenes: manySc, maxFrames: 8, fps: 30 })
  t.eq(cap.mode, 'scene', '切换点超多也是自适应')
  t.eq(cap.picks.length, 8, '超上限就收到 8 张')
  t.ok(cap.picks[cap.picks.length - 1].at > 50, '**沿时间线挑**，不是只挑前几个（最后一张在 ' + cap.picks[cap.picks.length - 1].at + ' 秒）')

  // 一闪而过的段要并掉
  const flash = F.planFrames(100, { scenes: [10, 10.1, 10.2, 30], maxFrames: 24, fps: 30 })
  const near10 = flash.picks.filter((x) => x.at > 9 && x.at < 12).length
  t.ok(near10 <= 1, '**重叠/闪过的切换点并成一张**（10 秒附近只留了 ' + near10 + ' 张）')

  // 不传场景表 → 老行为原样保住
  const even = F.planFrames(600, { maxFrames: 12, fps: 30 })
  t.eq(even.mode, 'even', '没场景表 → 退回均分（老行为不变）')

  // 只检出一处切换 → 不够用，退回均分（不然只有 2 张，等于没抽）
  const one = F.planFrames(100, { scenes: [50], maxFrames: 12, fps: 30 })
  t.eq(one.mode, 'even', '**只检出一处切换 → 退回均分**（少于两处不算数）')

  // 显式 everySec 优先 —— 人说了算
  const explicit = F.planFrames(100, { scenes: sc, maxFrames: 24, everySec: 25, fps: 30 })
  t.eq(explicit.mode, 'even', '显式给了 everySec → 听人的，不走自适应')

  // 场景表里有越界的值 → 滤掉，别崩
  t.noThrow(() => F.planFrames(100, { scenes: [-5, 200, NaN, 30, 60], maxFrames: 12 }), '越界/NaN 的场景表不崩')
  const dirty = F.planFrames(100, { scenes: [30, 60], maxFrames: 12, fps: 30 })
  t.ok(dirty.picks.every((x) => x.at >= 0 && x.at < 100), '越界的场景点被滤掉（没有跑到片子外面）')

  // ── 下面两条是**拿真片验出来的**（217 秒那支 MV，阈值 0.32 检出 25 处，其中 14 处挤在最后 30 秒）──
  {
    const real = [20, 22, 71, 74, 79, 79.2, 90, 94, 115, 118, 130, 168, 170, 171, 172, 174, 174.2, 175, 178, 178.2, 179, 186, 190, 193, 197]
    const r = F.planFrames(217, { scenes: real, maxFrames: 12, fps: 30 })
    const ats = r.picks.map((x) => x.at)

    // ① 超上限时要**从时间轴上取点再吸附**，不是"从列表里均匀取"。
    //    列表本身挤的话，从列表取会让越挤的地方占得越多 —— 实测 12 张里 6 张堆在最后 30 秒。
    const tail = ats.filter((x) => x > 160).length
    t.ok(tail <= 4, '**结尾挤的时候不堆在结尾**（最后 30 秒只占 ' + tail + '/12）')
    t.ok(ats.filter((x) => x < 162).length >= 7, '前 3/4 拿得到足够多的帧')

    // ② 两张不能挨着白占格（合并阈值要跟预算走，不能写死 0.4 秒）
    const gaps = ats.slice(1).map((x, i) => x - ats[i])
    t.ok(Math.min(...gaps) >= 8, '**没有两张挨着**（最小间隔 ' + Math.round(Math.min(...gaps)) + 's）')
    t.ok(Math.max(...gaps) <= 45, '最长空档不超过 45 秒（' + Math.round(Math.max(...gaps)) + 's）')
  }
}

// ══════════════════════════════════════════════════════
//  ffmpeg 表达式
// ══════════════════════════════════════════════════════
{
  const e = F.selectExpr([1, 31, 61])
  t.ok(e.includes('eq(n\\,1)'), '表达式里有 eq(n\\,1)')
  t.ok(e.split('+').length === 3, '三个条件用 + 连起来')
  t.eq(F.selectExpr([5, 5, 5]).split('+').length, 1, '重复帧号去重')
  t.eq(F.selectExpr([]), '', '空数组 → 空表达式')
  t.eq(F.selectExpr([-3, 2.7]).split('+').length, 2, '负数和小数都被规整')
  t.ok(!/eq\(n\\,-/.test(F.selectExpr([-1])), '不会出现负帧号')
}

// ══════════════════════════════════════════════════════
//  清理（主人明确要求：读取完自动删除）
// ══════════════════════════════════════════════════════
{
  const TMP = path.join(os.tmpdir(), 'dsh-mood-frames-' + Date.now())
  fs.mkdirSync(TMP, { recursive: true })
  const batch = F.batchDir(TMP, 111)
  fs.mkdirSync(batch, { recursive: true })
  for (let i = 1; i <= 5; i++) fs.writeFileSync(path.join(batch, 'f00' + i + '.png'), 'x')

  t.eq(fs.readdirSync(batch).length, 5, '造了 5 张')
  t.eq(F.cleanFrames(batch), 5, 'cleanFrames 删掉 5 个')
  t.eq(fs.readdirSync(batch).length, 0, '清空了')
  t.eq(F.cleanFrames(batch), 0, '再清一次不报错也不多数')
  t.noThrow(() => F.cleanFrames(path.join(TMP, '不存在的目录')), '清不存在的目录不崩')

  // 时限清理：老的整批删掉，新的留着
  const oldDir = F.batchDir(TMP, 1)
  const newDir = F.batchDir(TMP, Date.now())
  fs.mkdirSync(oldDir, { recursive: true }); fs.writeFileSync(path.join(oldDir, 'a.png'), 'x')
  fs.mkdirSync(newDir, { recursive: true }); fs.writeFileSync(path.join(newDir, 'b.png'), 'x')
  const longAgo = Date.now() - 10 * 3600 * 1000
  fs.utimesSync(oldDir, new Date(longAgo), new Date(longAgo))
  const removed = F.sweepOldFrames(TMP, 2 * 3600 * 1000)
  t.eq(removed, 1, '超时的批次删掉 1 个')
  t.ok(!fs.existsSync(oldDir), '老批次真没了')
  t.ok(fs.existsSync(newDir), '新批次留着（不能把刚抽的删了）')

  // ⚠️ cleanExcept：每次抽帧前"除当前这批外全清" —— 这才是"读取完自动删除"的主力。
  //    原来只调了 sweepOldFrames(2 小时)，也就是**只删超过两小时的**；
  //    而工具输出里我写的是"下一批抽帧时这一批会自动删掉" —— **那句话当时是假的**。
  {
    const D = path.join(TMP, 'ce')
    fs.mkdirSync(path.join(D, 'b1'), { recursive: true })
    fs.mkdirSync(path.join(D, 'b2'), { recursive: true })
    fs.mkdirSync(path.join(D, 'b3'), { recursive: true })
    fs.mkdirSync(path.join(D, '_tmp_video'), { recursive: true })
    for (const [d, f] of [['b1', 'a.png'], ['b2', 'b.png'], ['b3', 'c.png'], ['_tmp_video', 'v.mp4']]) {
      fs.writeFileSync(path.join(D, d, f), 'x')
    }
    t.eq(fs.readdirSync(D).length, 4, '造了 4 个目录')
    t.eq(F.cleanExcept(D, 'b3'), 3, 'cleanExcept 删掉另外 3 个')
    t.eq(fs.readdirSync(D).join(','), 'b3', '只剩当前这批')
    t.ok(fs.existsSync(path.join(D, 'b3', 'c.png')), '当前这批的文件**没被误删**')
    t.ok(!fs.existsSync(path.join(D, '_tmp_video')), '上次的临时视频目录也清了')
    t.noThrow(() => F.cleanExcept(path.join(TMP, '不存在'), 'x'), '清不存在的目录不崩')
    t.eq(F.cleanExcept(D, 'b3'), 0, '已经只剩它了，再清不报错也不多数')
  }

  fs.rmSync(TMP, { recursive: true, force: true })
}

// ══════════════════════════════════════════════════════
//  真实视频：整条链
// ══════════════════════════════════════════════════════
{
  // ⚠️ 原来这里写死了我本机那个介绍片的路径 —— 别人跑必然找不到。
  //    改成从环境变量给：没有就**跳过这一条**，而不是失败。
  const VID = process.env.DSHMOOD_TEST_VIDEO || ''
  const ffmpeg = F.findMediaTool('ffmpeg')
  const ffprobe = F.findMediaTool('ffprobe')
  t.ok(!!ffmpeg, '找得到 ffmpeg（' + String(ffmpeg || '').split(/[\\/]/).pop() + '）')

  if (!process.env.DSHMOOD_TEST_VIDEO) {
    // ⚠️ **跳过必须出声。**
    //    第一版改完是这样：95 条变成 86 条，而汇总照样只说「通过 86 失败 0」——
    //    **9 条断言静悄悄地没有了**，读的人会以为这块全验过了。
    //    这跟我库里那条是同一个病：吞掉的地方，症状会伪装成"数据本来就是这样"。
    console.log('  ⏭️  跳过 9 条：没有设 DSHMOOD_TEST_VIDEO')
    console.log('      那些断言需要一个真视频文件（probe 出的时长/帧率/分辨率、按秒抽帧…）。')
    console.log('      设法： DSHMOOD_TEST_VIDEO=D:\\某个视频.mp4 node test-frames.mjs')
    console.log('      **这不是"验过了"，是"这次没验"。**')
  }
  if (fs.existsSync(VID) && ffmpeg && ffprobe) {
    const info = F.probe(VID, ffprobe)
    t.ok(info && info.durationSec > 0, 'probe 拿得到时长（' + (info && Math.round(info.durationSec)) + ' 秒）')
    t.ok(info && info.fps > 0, 'probe 拿得到帧率（' + (info && info.fps) + '）')
    t.eq(info.width, 1920, 'probe 拿得到分辨率')

    const TMP = path.join(os.tmpdir(), 'dsh-mood-ex-' + Date.now())
    const plan = F.planFrames(info.durationSec, { maxFrames: 4, fps: info.fps })
    const r = F.extractFrames(VID, plan, TMP, ffmpeg)
    t.eq(r.ok, true, 'ffmpeg 抽帧成功' + (r.error ? '（' + r.error + '）' : ''))
    t.eq(r.files.length, 4, '抽出 4 张')
    let sizes = 0
    for (const f of r.files) if (fs.statSync(f).size > 0) sizes++
    t.eq(sizes, 4, '每张都不是空文件')
    // 黑屏的话 PNG 会小得离谱（1920x1080 全黑 ~5KB）
    const tiny = r.files.filter((f) => fs.statSync(f).size < 3000)
    t.eq(tiny.length, 0, '没有"小得离谱"的图（那种多半是黑屏）')
    // 再抽一次：上一批必须被清掉
    const r2 = F.extractFrames(VID, plan, TMP, ffmpeg)
    t.eq(r2.ok, true, '第二次抽也成功')
    t.ok(fs.readdirSync(TMP).length <= 4 + 1, '重抽不会把两批堆在一起（' + fs.readdirSync(TMP).length + ' 个文件）')
    fs.rmSync(TMP, { recursive: true, force: true })
  } else {
    console.log('     （没有现成视频 / 没有 ffmpeg，跳过整链测试）')
  }
}

t.done()

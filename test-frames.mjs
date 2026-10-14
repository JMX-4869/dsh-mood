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

const F = await import('file:///D:/chajian/dsh-mood/frames.js?t=' + Date.now())
const t = suite('视频抽帧')

// ══════════════════════════════════════════════════════
//  表本身：跟主人给的 CSV 逐行对上
// ══════════════════════════════════════════════════════
{
  // 抄自 C:\Users\asus\Downloads\table_20261015.csv 的「从 1 开始数」那一列
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
  t.eq(F.planFrames(600, { maxFrames: 9999 }).picks.length <= 64, true, 'maxFrames 有上限（不会一次要几千张）')
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

  fs.rmSync(TMP, { recursive: true, force: true })
}

// ══════════════════════════════════════════════════════
//  真实视频：整条链
// ══════════════════════════════════════════════════════
{
  const VID = 'D:/DSHzuoye/dsh-mood-promo/dsh-mood-介绍片_动效版.mp4'
  const ffmpeg = F.findMediaTool('ffmpeg')
  const ffprobe = F.findMediaTool('ffprobe')
  t.ok(!!ffmpeg, '找得到 ffmpeg（' + String(ffmpeg || '').split(/[\\/]/).pop() + '）')

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

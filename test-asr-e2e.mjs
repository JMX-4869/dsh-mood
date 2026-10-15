/**
 * 音频层的**端到端**测试 —— 走真的路：
 *   fetchVideoFrames → yt-dlp 下视频 → ffmpeg 抽帧 + 抽音频 → faster-whisper 转写
 *
 * 跟 `test-asr.mjs` 的分工：
 *   test-asr.mjs       离线。测降级、测输出格式、盯那个"一个点的假数字"别回来。
 *   test-asr-e2e.mjs   上线。测**整条路真的能通** —— 而离线测试一个网络字节都不碰，
 *                      所以它**永远证明不了**这一点。
 *
 * ⚠️ 它要网络、要 yt-dlp、要 ffmpeg、要 faster-whisper —— 三十秒起步。
 *    任何一样没有就**跳过并说明**，不算失败（这是"环境不全"，不是"代码坏了"）。
 *
 * 用的那支片子是特意挑的：26 秒、台词我**手工核对过**，
 * 所以断言可以拿"正确答案"去比，而不是拿"上次的输出"去比。
 */
import { fetchVideoFrames } from './news.js'
import { findPython, probeWhisper } from './asr.js'
import { suite } from './testkit.mjs'

const t = suite('音频层 · 端到端（要网络）')

const URL = 'https://www.bilibili.com/video/BV1CLpx6qEM9'
// 这七句是**手工核对过的**（不是"上次的输出"——那种对照只证明代码没变，不证明它对）
const TRUTH = ['我不想干了', '辞职', '外包', '傻乐', '那你不准辞职']

const py = findPython()
const hasWhisper = py ? probeWhisper(py).ok : false
if (!py || !hasWhisper) {
  console.log('  ⏭️  跳过：' + (!py ? '没有 python' : '没装 faster-whisper'))
  console.log('      （这不是失败 —— 是环境不全。装法：py -m pip install faster-whisper）')
  // 只断言到这里：跳过时也必须**说清为什么跳过**
  t.ok(true, '环境不全时明确跳过并说明原因，不谎报通过')
  t.done()
} else {
  const r = await fetchVideoFrames(URL, { audio: true, everySec: 5, maxFrames: 10 })

  t.eq(r.ok, true, '整条路能通（下载 → 抽帧 → 抽音频 → 转写）')
  t.gt(r.files ? r.files.length : 0, 0, '抽出了帧')
  t.ok(r.asr && r.asr.ok, '音频层拿到了结果')

  if (r.asr && r.asr.ok) {
    const text = r.asr.data.segments.map((s) => s.text).join('')
    for (const k of TRUTH) t.ok(text.includes(k), '转写里有「' + k + '」')
    t.eq(r.asr.data.segments.length >= 5, true, '至少切出 5 段（26 秒的片子有 7 句）')

    // 分段时间戳必须是**递增且不重叠**的 —— 这个不用对照就知道对不对
    const segs = r.asr.data.segments
    let mono = true
    for (let i = 1; i < segs.length; i++) if (segs[i].t0 < segs[i - 1].t0 - 0.01) mono = false
    t.ok(mono, '分段的时间是递增的（工具自己就不该乱序）')

    // 那次「那你不准辞职」8.31 秒、0.72 字/秒、句内静音 2.21 秒 —— 是它的特征
    const last = r.asr.data.prosody.rows[r.asr.data.prosody.rows.length - 1]
    t.gt(last.t1 - last.t0, 5, '最后一段比别段长得多（8 秒级）')
    t.lt(last.rate, 2, '最后一段语速明显慢（< 2 字/秒）')

    // 输出里不许出现情绪标签 —— **但只查数据行**。
    //
    // ⚠️ 第一版这条断言是 `!/愤怒|悲伤|…/.test(r.asr.text)`，**它红了** ——
    //    因为输出里有一句声明：「"音高高+语速快"能同时是激动/紧张/愤怒/兴奋」。
    //    那句话**正是在说"这些标签我不贴"**，而断言把它当成了"贴了标签"。
    //    **「提到」和「使用」是两件事** —— 纯字符串匹配分不开，得指定看哪一部分。
    //    （测试自己也会"读最响的那个东西"。）
    const dataLines = r.asr.text.split('\n').filter((l) => /[→]/.test(l) && /\d\.\d\ds/.test(l))
    t.gt(dataLines.length, 3, '找到了数据行（断言有东西可查，不是空集合上永远为真）')
    const dirty = dataLines.filter((l) => /愤怒|悲伤|激动|开心|难过|紧张|兴奋/.test(l))
    t.eq(dirty.length, 0, '数据行里没有情绪标签（只报数，起名归读的人）')
  } else if (r.asr) {
    console.log('  音频层失败：' + r.asr.why)
  }
  t.done()
}

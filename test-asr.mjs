/**
 * asr.js 的测试 —— **离线**：不下载、不转写、不依赖装了 whisper。
 *
 * 重点不是"跑通"（那是 `_t_asr.mjs` 干的），而是：
 *   ① 该降级的时候**有没有降级**，而且降级时**有没有说清装什么**
 *   ② 那个"一个点撑起来的音高数字"**会不会再回来** —— 这是回归测试
 *
 * ② 的来源：第一版里，某一段只有 1 个有效帧，输出照样报「81.2 Hz (-69%)」——
 * 看起来和几百帧撑起来的数字一模一样。而它是错的（那段的真实基频不是 81）。
 * 修法不是平滑，是**把样本数报出来、点太少就不给数**。
 * 这个测试就是盯着它别回来。
 */
import { findPython, probeWhisper, extractAudio, transcribeAndProsody, formatASR, __test } from './asr.js'
import { suite } from './testkit.mjs'

const t = suite('音频层（转写 + 语气四量）')

// ── 1. 探针：找不到就"找不到"，别崩 ──
const py = findPython()
t.ok(py === null || typeof py === 'string', 'findPython 返回字符串或 null，不抛')
if (py) t.ok(py.length > 0, 'findPython 找到的是个非空命令名')

const p1 = probeWhisper(null)
t.eq(p1.ok, false, 'probeWhisper(null) → 不 ok')
t.ok(String(p1.why).includes('python'), 'probeWhisper(null) 的 why 里提到 python（不是空话）')

const p2 = probeWhisper('这个命令根本不存在_zzz')
t.eq(p2.ok, false, 'probeWhisper(假命令) → 不 ok')
t.ok(String(p2.why).length > 0, 'probeWhisper(假命令) 的 why 不为空 —— 别把"失败"报成"没有"')

// ── 2. 抽音频：没 ffmpeg 就说清 ──
const ea = extractAudio('不存在.mp4', null, 'out.wav')
t.eq(ea.ok, false, 'extractAudio(没 ffmpeg) → 不 ok')
t.ok(String(ea.why).includes('ffmpeg'), 'why 里点名 ffmpeg')

// ── 3. 降级路径：一定给出**装什么**，不能只说"失败了" ──
const r1 = await transcribeAndProsody('x.wav', { python: null })
t.eq(r1.ok, false, 'transcribeAndProsody(python=null) → 不 ok')
t.ok(String(r1.install || '').includes('faster-whisper'), '降级时给出了装法（pip install faster-whisper）')
t.ok(String(r1.install || '').includes('hf-mirror'), '装法里提到了 hf-mirror —— 官方 hf.co 国内连不上，不说等于没给')

// python 存在但 whisper 没装时，也要给装法（不能只在"连 python 都没有"时给）
const r2 = await transcribeAndProsody('x.wav', { python: '这个命令根本不存在_zzz', transcribe: true })
t.eq(r2.ok, false, 'python 是假命令 → 不 ok')
t.ok(String(r2.install || '').includes('faster-whisper'), 'python 不通时也给装法')

// ⚠️ **不转写的时候不该检查 whisper，也不该提装法。**
//    因为信号分析只用 numpy —— 没装 whisper 不该挡住它。
const r3 = await transcribeAndProsody('x.wav', { python: '这个命令根本不存在_zzz' })
t.eq(r3.ok, false, '不转写 + python 不通 → 还是不 ok（跑不了 python）')
t.eq(r3.install, undefined, '**不转写时不提"装 whisper"** —— 那是答非所问')

// ── 4. formatASR 的基本行为 ──
t.eq(formatASR(null), '', 'formatASR(null) → 空串')
const empty = formatASR({ segments: [], prosody: {}, transcribe_requested: true })
t.ok(empty.includes('没有识别到语音'), '没有语音时说"没识别到"，不说"读完了"')

const D = {
  segments: [
    { t0: 0.8, t1: 4.8, text: '老大 我不想干了 我要辞职' },
    { t0: 15.8, t1: 24.1, text: '那你不准辞职' },
  ],
  language: 'zh',
  transcribe_requested: true,
  prosody: {
    base_f0: 258.1, f0_valid_ratio: 0.66, talking_ratio: 0.73,
    silences: [[21.2, 22.93], [6.34, 6.81]],
    rows: [
      // 够多帧 → 给数字
      { t0: 0.8, t1: 4.8, text: '老大 我不想干了 我要辞职', rate: 2.75, f0_n: 140, f0_med: 262.0, f0_rel: 0.015, rms_rel: 0.6, sil_in: 0.28 },
      // ⚠️ 只有 1 个有效帧 → **不许给数字**（今晚那个 bug）
      { t0: 4.8, t1: 6.8, text: '怎么了 累了', rate: 2.5, f0_n: 1, f0_med: null, f0_rel: null, rms_rel: 1.38, sil_in: 0.31 },
    ],
  },
}
const out = formatASR(D)
t.ok(out.includes('老大 我不想干了'), '转写内容进来了')
t.ok(out.includes('那你不准辞职'), '第二句也进来了')
t.ok(out.includes('[    0.8 →    4.8]'), '每句带起止时间戳')

// ══ 回归：一个点撑起来的数字不许出现 ══
t.ok(!out.includes('81.2'), '不会出现在任何一段的假音高（这里用 81.2 当哨兵）')
t.ok(out.includes('有效帧仅 1'), '**只有 1 个有效帧的段，报的是"有效帧仅 1"，不是一个 Hz 数字**')
t.ok(out.includes('262'), '够多帧的段照常给数字（别把孩子跟洗澡水一起泼了）')
t.ok(out.includes('更多') || out.includes('别拿音高下结论'), '说了"这一段别拿音高下结论"')
t.ok(out.includes('语速'), '语速那一列还在 —— 音高缺了不代表整段没用')

// 语速和停顿**不依赖基频**，缺音高的段它们照样要有
t.ok(out.includes('2.50字/秒'), '缺音高的段，语速照报')
t.ok(out.includes('0.31s'), '缺音高的段，句内停顿照报')

// ── 5. 不准贴情绪标签这件事，得写在输出里 ──
t.ok(out.includes('不贴情绪标签'), '输出声明了"只报数，不贴情绪标签"')
t.ok(out.includes('激动/紧张/愤怒/兴奋'), '给出了理由（同一个数字对应好几种语气）')
t.ok(out.includes('起名是解读'), '点明了"起名那一步我没做"')

// ── 6. notes 要冒出来，不能吞掉 ──
const withWarn = formatASR({ ...D, notes: ['基频有效率 6.6% 不在合理区间（15%~90%），音高那几列**别信**'] })
t.ok(withWarn.includes('⚠️'), 'notes 带 ⚠️ 前缀出来')
t.ok(withWarn.includes('6.6%'), 'notes 的内容原样出来（不概括、不吞）')
t.eq(formatASR({ segments: [], prosody: {}, notes: [] }).includes('⚠️ 基频'), false, '没有 notes 时不硬造警告')

// ── 6.5 覆盖率：**"12 段"看起来就是"全转完了"，而它可能只覆盖 20%** ──
//
// 这是 0.11.1 修的 bug。现场：
//   一首 242 秒的歌，转写吐出 12 段干净的句子 —— 而它们只到 49.4 秒。
//   **后面 193 秒一个字都没有，而输出里看不出来。**
// 根因：whisper 的 vad_filter 按"像不像人在说话"切，而唱歌带伴奏 → 大批被判成非语音丢掉。
const cov = formatASR({
  segments: [{ t0: 0, t1: 49.4, text: 'Hello world' }],
  language: 'zh', vad: false, transcribe_requested: true,
  coverage: { sec: 49.4, total: 242.2, ratio: 0.204, tail_gap: 192.8 },
})
t.ok(cov.includes('覆盖 49.4 / 242.2 秒'), '报出了覆盖率（分子分母和秒数）')
t.ok(cov.includes('20%'), '报出了百分比')
t.ok(cov.includes('后面还有 192.8 秒没有任何转写'), '**尾部大段空白要单独点名** —— 它比"覆盖率低"更直接')
t.ok(cov.includes('VAD'), '说清了根因（VAD 把大段判成"不是语音"）')
t.ok(cov.includes('丢东西的时候不出声'), '点明了最坑的地方：**丢东西的时候它不出声**')
t.ok(cov.includes('别把这份当成全部内容'), '给了结论性提醒')

// 尾部空白小的时候**不许**硬造警告 —— 那是正常的收尾
const covOk = formatASR({
  segments: [{ t0: 0, t1: 233, text: '輪到你了' }],
  language: 'zh', vad: false, transcribe_requested: true,
  coverage: { sec: 212, total: 242.2, ratio: 0.875, tail_gap: 9.2 },
})
t.ok(!covOk.includes('没有任何转写'), '尾部只空 9 秒时**不报警**（9 秒是正常收尾，不是缺失）')
t.ok(!covOk.includes('覆盖率不到一半'), '覆盖率 88% 时不报"不到一半"')

// 没有 coverage 字段时也不能崩（老数据/别处调用的兼容）
t.noThrow(() => formatASR({ segments: [{ t0: 0, t1: 1, text: 'x' }], prosody: {}, transcribe_requested: true }),
  '没有 coverage 字段 → 不崩')

// ══ 零模型那块（0.12.0 的核心）══
//
// 判据就在这儿：**节拍自相关峰 > 0.5 是音乐，< 0.5 是说话。**
// 实测：242 秒的歌 0.74；26 秒的对白 0.27。中间没有模糊地带。
const music = formatASR({
  transcribe_requested: false,
  signal: { voiced_ratio: 0.95, voiced_n: 32, silence_n: 15,
    longest_silence: { at: 232.86, sec: 9.28 }, syllable_rate: 5.51,
    spectral_centroid: { med: 1305, p10: 666, p90: 2182 },
    beat: { period_sec: 0.39, bpm: 154, acf_peak: 0.74, likely_music: true },
    pitch_jitter: 0.0151 },
})
t.ok(music.includes('音频形状'), 'signal 有内容时报一块「音频形状」')
t.ok(music.includes('没有模型'), '**明确说这一块没有模型** —— 那是它值钱的地方')
t.ok(music.includes('是音乐'), '峰 0.74 → 判"是音乐/有节奏的"')
t.ok(music.includes('0.74'), '报了那个峰的值（不只是结论）')
t.ok(music.includes('音节率 5.51'), '音节率出来了（**不靠转写**）')
t.ok(music.includes('谱亮度'), '谱亮度出来了')
t.ok(music.includes('9.28'), '最长静音出来了')
t.ok(music.includes('这次没跑'), '不转写时明说"这次没跑"，不假装是空的')
t.ok(music.includes('多一个模型'), '说清了不跑的原因（多一个几百 MB 的模型）')

const talk = formatASR({
  transcribe_requested: false,
  signal: { voiced_ratio: 0.73, beat: { period_sec: 0.3, bpm: 200, acf_peak: 0.27, likely_music: false } },
})
t.ok(talk.includes('是说话'), '峰 0.27 → 判"是说话"')

// ⚠️ pitch_jitter 必须是**相对值**。第一版我移植时丢了那个除法，
//    输出 3.97 而文案写着 0.027 —— **数和说明差 100 倍，两处只有一处错。**
t.ok(music.includes('0.0151'), 'pitch_jitter 是相对值（0.0151 量级，不是 3.97 那种）')
t.ok(__test.PY_SCRIPT.includes('/ np.median(fv)'),
  '**脚本里那个除法还在** —— 防我把相对值又写成绝对 Hz')
t.ok(__test.PY_SCRIPT.includes("out['signal']"), 'signal 块是在 python 那边算的（不在 JS 里编）')
t.ok(__test.PY_SCRIPT.includes('acf_peak'), '节拍的峰算出来了')

// ── 6.6 内联脚本里那个开关必须是**活的**（别被写死回去）──
t.ok(__test.PY_SCRIPT.includes("sys.argv[6] == 'vad'"),
  'VAD 是参数控制的（读 argv[4]）—— 不是写死的')
t.ok(!/vad_filter=True/.test(__test.PY_SCRIPT),
  '**没有任何地方写死 vad_filter=True** —— 那正是 0.11.1 修掉的 bug')
t.ok(__test.PY_SCRIPT.includes('vad_filter=vad_on'), '传给 transcribe 的是那个变量')
t.ok(__test.PY_SCRIPT.includes("out['coverage']"),
  '覆盖率在 Python 那边就算好（不在 JS 里编）')
t.ok(__test.PY_SCRIPT.includes('tail_gap'),
  '算了尾部空白 —— 尾部大段空白是比覆盖率更直接的缺失信号')

// ── 7. 内联 Python 脚本里的两个设计决定（写成断言，防止被"优化"掉）──
t.ok(!__test.PY_SCRIPT.includes('decode_audio'),
  '不调 faster-whisper 的 decode_audio —— 它 1.2.1 调的 av.open(metadata_errors=) 跟当前 PyAV 不兼容')
t.ok(__test.PY_SCRIPT.includes('wave.open'), '自己用 wave 读 —— 那条路不依赖 PyAV')
t.ok(__test.PY_SCRIPT.includes('pmr'), '基频用了峰均比过滤，不只是自相关峰值')
t.ok(__test.PY_SCRIPT.includes('prev * 1.75'), '有八度跳变限制（1.75 倍）')
t.ok(__test.PY_SCRIPT.includes('0.15'), '基频有效率的下限是 0.15 —— 太松会漏报（6.6% 那次就没报）')

// ── 8. 坏输入不许崩 ──
t.noThrow(() => formatASR({ segments: [{ t0: 0, t1: 1, text: 'x' }] }), 'segments 有但 prosody 缺 → 不崩')
t.noThrow(() => formatASR({ segments: [], prosody: { rows: [] } }), 'rows 空 → 不崩')
t.noThrow(() => formatASR({ segments: [], prosody: { rows: [{ t0: 0, t1: 0.01, text: '', rate: 0, f0_n: 0, f0_med: null, rms_rel: null, sil_in: 0 }] } }), '全空的一行 → 不崩')

t.done()

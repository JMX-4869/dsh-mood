/**
 * asr.js —— 视频的**音频层**：把画面之外那半条信息捞出来。
 *
 * 为什么要它：
 *   `frames` 只拿到**画面**。而一支片子里说话的内容、以及"怎么说的"，全在音频里。
 *   我吃过两次这个亏 ——
 *     ① 一支 26 秒的短片，我只看画面，读成了"她表情从平静到爆发"；
 *        后来拿到台词才知道最后一句是「那你不准辞职」——**结论完全不同**。
 *     ② 另一支视频，我说"没听到解说词，所以'为什么'这一层没拿到" ——
 *        而字幕就躺在音频里。
 *
 * 打什么：
 *   ① **转写** —— 谁在什么时候说了什么（带时间戳）
 *   ② **语气四量** —— 音高 / 能量 / 语速 / 停顿，**跟台词按时间对齐**
 *
 * ⚠️ 语气**只报数字，不贴情绪标签**。
 *   "音高高 + 语速快"同时能对应激动 / 紧张 / 愤怒 / 兴奋 ——
 *   起名那一步是解读，不是计算。谁算谁贴标签，贴出来的就是编的。
 *
 * 依赖（都是可选的，没有就降级）：
 *   · python（`py` 或 `python`）+ faster-whisper：跑转写
 *   · ffmpeg：抽音频（frames 那边本来就在用）
 *   缺 faster-whisper 时**转写跳过，但不报错** —— 只说清怎么装。
 *
 * 与 frames 的分工：
 *   frames  → 画面（谁在场、动作、界面、字）
 *   asr     → 声音（说了什么、怎么说）
 *   **两条合并才是一条完整的线** —— 都缺一半。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

/** 找 python。Windows 上 `python` 常是应用商店的占位壳 —— `py` 才靠得住。 */
export function findPython() {
  for (const p of ['py', 'python3', 'python']) {
    try {
      const r = spawnSync(p, ['-c', 'print(1)'], { timeout: 8000, windowsHide: true, encoding: 'utf8' })
      if (r.status === 0 && String(r.stdout).trim() === '1') return p
    } catch { /* 试下一个 */ }
  }
  return null
}

/** 装没装 faster-whisper。返回值带**原因**，别只说"没有"。 */
export function probeWhisper(py) {
  if (!py) return { ok: false, why: '没找到 python（试过 py / python3 / python）' }
  try {
    const r = spawnSync(py, ['-c', 'import faster_whisper, ctranslate2; print("ok")'],
      { timeout: 60000, windowsHide: true, encoding: 'utf8' })
    if (r.status === 0 && String(r.stdout).includes('ok')) return { ok: true, why: '' }
    const err = String(r.stderr || '').split('\n').filter(Boolean).slice(-1)[0] || '导入失败'
    return { ok: false, why: err }
  } catch (e) {
    return { ok: false, why: String(e && e.message) }
  }
}

/**
 * 内联的 Python 脚本：**一次进程**把转写 + 语气四量都做完。
 *
 * 两个设计决定值得说：
 *  ① **不走 faster-whisper 的 decode_audio** —— 它 1.2.1 调的
 *     `av.open(..., metadata_errors=...)` 跟当前 PyAV 版本不兼容，会 TypeError。
 *     我们自己用 `wave` 读 16k 单声道 wav，直接喂 ndarray。这条路不依赖 PyAV。
 *  ② 基频**手写自相关**，不引 librosa —— 每一步算的是什么自己清楚，
 *     而且给出来的数字可以被质疑（librosa 的黑盒没法吵）。
 */
const PY_SCRIPT = `
import sys, json, wave
import numpy as np

wav = sys.argv[1]
model_name = sys.argv[2] if len(sys.argv) > 2 else 'small'
lan = sys.argv[3] if len(sys.argv) > 3 and sys.argv[3] else 'zh'
SR = 16000

out = {'ok': True, 'model': model_name, 'segments': [], 'prosody': {}, 'notes': []}

with wave.open(wav, 'rb') as w:
    ch, sw, sr, n = w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()
    raw = w.readframes(n)
if sw != 2:
    print(json.dumps({'ok': False, 'why': 'wav 不是 16-bit PCM'})); sys.exit(0)
a = np.frombuffer(raw, dtype='<i2').astype(np.float32) / 32768.0
if ch > 1:
    a = a.reshape(-1, ch).mean(axis=1)
if sr != SR:
    # ffmpeg 应该已经转成 16k 了；没转就报出来，别悄悄按错的采样率算基频
    print(json.dumps({'ok': False, 'why': 'wav 采样率是 %d，期望 16000' % sr})); sys.exit(0)
out['duration'] = len(a) / SR

# ── 转写（**可选** —— 默认不跑）──
#
# ⚠️ 分界线在这儿，别看错：
#   **信号分析**（下面那段：段落 / 音节 / 音高 / 谱亮度 / 节拍）—— 只用 numpy。
#       **没有模型**：不装、不下载、242 秒的音频几秒钟算完。**这个总是跑。**
#   **转写** —— 要 faster-whisper（几百 MB、要装、慢）。**这才是"多一个模型"，默认不跑。**
#
# 为什么 VAD 默认关（顺手记着）：
#   它按"这里像不像人在说话"切 —— 对说话有用，但唱歌带伴奏会把大段判成"不是语音"丢掉。
#   实测那首 242 秒的歌：开着只转出 49.4 秒（20%），关掉转到 231 秒（88%）。
#   **而且它丢东西的时候不出声** —— 输出照样是一串干净的段落。
want_tr = (len(sys.argv) > 5 and sys.argv[5] == 'transcribe')
vad_on = (len(sys.argv) > 6 and sys.argv[6] == 'vad')
out['transcribe_requested'] = want_tr
if want_tr:
    try:
        from faster_whisper import WhisperModel
        m = WhisperModel(model_name, device='cpu', compute_type='int8')
        segs, info = m.transcribe(a, language=lan, beam_size=5, vad_filter=vad_on)
        out['language'] = info.language
        out['vad'] = vad_on
        out['segments'] = [{'t0': round(s.start, 2), 't1': round(s.end, 2), 'text': s.text.strip()}
                           for s in segs if s.text.strip()]
        # ── 覆盖率：**必须报** ──
        #    "12 段"看起来就是"全转完了"，而它可能只覆盖 20%。
        #    **"我读了 20%"和"我读完了"，在输出里长得一模一样。**
        dur = len(a) / SR
        cov = sum(s['t1'] - s['t0'] for s in out['segments'])
        last = out['segments'][-1]['t1'] if out['segments'] else 0
        out['coverage'] = {
            'sec': round(cov, 1),
            'total': round(dur, 1),
            'ratio': round(cov / dur, 3) if dur else 0,
            'tail_gap': round(dur - last, 1),   # 最后一句之后还剩多少秒没转
        }
    except Exception as e:
        out['notes'].append('转写失败：%s: %s' % (type(e).__name__, e))

# ── 语气四量 ──
FRAME, HOP = int(0.040 * SR), int(0.010 * SR)
nf = 1 + (len(a) - FRAME) // HOP
if nf > 1:
    idx = np.arange(FRAME)[None, :] + HOP * np.arange(nf)[:, None]
    fr = a[idx]
    rms = np.sqrt((fr ** 2).mean(axis=1) + 1e-12)
    loud = rms[rms > rms.max() * 0.02]
    thr = float(np.median(loud)) * 0.15 if len(loud) else float(rms.max()) * 0.05
    talking = rms > thr

    # 基频：去除均值 + 汉宁窗；峰均比 + 八度约束，滤掉摩擦音和倍频错误
    w = (fr - fr.mean(axis=1, keepdims=True)) * np.hanning(FRAME)[None, :]
    lags = np.arange(int(SR / 350), int(SR / 70) + 1)
    f0 = np.full(nf, np.nan)
    prev = np.nan
    for i in range(nf):
        if not talking[i]:
            continue
        v = w[i]
        if float((v ** 2).sum()) < 1e-6:
            continue
        ac = np.array([float((v[:-l] * v[l:]).sum()) for l in lags])
        ac = ac / (ac.max() + 1e-12)
        k = int(np.argmax(ac))
        mask = np.ones_like(ac, dtype=bool)
        mask[max(0, k - 3):k + 4] = False
        pmr = ac[k] / (ac[mask].mean() + 1e-9)
        if ac[k] < 0.5 or pmr < 1.8:
            continue
        f = SR / float(lags[k])
        if not np.isnan(prev) and (f > prev * 1.75 or f < prev * 0.57):
            continue
        f0[i] = f
        prev = f

    valid = ~np.isnan(f0)
    base_f0 = float(np.median(f0[valid])) if valid.any() else None
    valid_ratio = float(valid.mean())
    if valid_ratio < 0.15 or valid_ratio > 0.9:
        # 两端都是病：太低 = 门限过严（很多帧白丢了）；太高 = 摩擦音也被当基频。
        # 0.15 这个下限是实测出来的：6.6% 那版第一段整段没数据，而当时没报警。
        out['notes'].append('基频有效率 %.1f%% 不在合理区间（15%%~90%%），音高那几列**别信**'
                            % (valid_ratio * 100))
    base_rms = float(np.median(rms[talking])) if talking.any() else None

    # 停顿：从**能量**里找。不能从转写分段的时间戳找 —— 那是首尾相接的，永远 0 间隔。
    sil = ~talking
    gaps, i = [], 0
    while i < nf:
        if sil[i]:
            j = i
            while j < nf and sil[j]:
                j += 1
            if (j - i) * HOP / SR >= 0.12:
                gaps.append([round(i * HOP / SR, 2), round(j * HOP / SR, 2)])
            i = j
        else:
            i += 1

    rows = []
    for s in out['segments']:
        i0, i1 = int(s['t0'] * SR / HOP), max(int(s['t1'] * SR / HOP), int(s['t0'] * SR / HOP) + 1)
        seg_f = f0[i0:i1]; seg_f = seg_f[~np.isnan(seg_f)]
        seg_r = rms[i0:i1]; seg_t = talking[i0:i1]
        chars = len([c for c in s['text'] if not c.isspace()])
        span = max(s['t1'] - s['t0'], 0.01)
        # ⚠️ 有效帧太少的段**不给音高数字**。一个点撑起来的中位数，
        #    看起来跟几百帧撑起来的完全一样 —— 而它什么都不是。
        enough = len(seg_f) >= 5
        rows.append(dict(s, **{
            'chars': chars,
            'rate': round(chars / span, 2),
            'f0_n': int(len(seg_f)),
            'f0_med': round(float(np.median(seg_f)), 1) if enough else None,
            'f0_rel': round(float(np.median(seg_f)) / base_f0 - 1, 3) if enough and base_f0 else None,
            'rms_rel': round(float(np.median(rms[i0:i1][seg_t])) / base_rms, 2) if seg_t.any() and base_rms else None,
            'sil_in': round(sum(g1 - g0 for g0, g1 in gaps if g0 >= s['t0'] and g1 <= s['t1']), 2),
        }))
    out['prosody'] = {
        'base_f0': round(base_f0, 1) if base_f0 else None,
        'f0_valid_ratio': round(valid_ratio, 3),
        'talking_ratio': round(float(talking.mean()), 3),
        'silences': gaps,
        'rows': rows,
    }
else:
    out['notes'].append('音频太短，算不出语气')

# ══ 信号分析（**零模型** —— 不依赖转写，永远能算出来）══
#
# 这一段只用 numpy。没有模型、不下载、242 秒的音频几秒钟。
#
# ⚠️ **它和上面那段的区别是关键的：**
#   转写给的是**内容**（说了什么）—— 要一个几百 MB 的模型，还可能骗人（覆盖率）。
#   信号给的是**形状**（多长、多密、多亮、有没有拍）—— **一定拿得到，而且能复核。**
#   缺了内容不算塌，缺了形状才是瞎。
dur = len(a) / SR
sig = {}
if nf > 1:
    # ① 段落：有声 / 静音（用能量包络切，**不需要转写**）
    segs2, i = [], 0
    while i < nf:
        j = i
        while j < nf and talking[j] == talking[i]:
            j += 1
        segs2.append({'voiced': bool(talking[i]), 't0': round(i * HOP / SR, 2),
                      't1': round(j * HOP / SR, 2), 'sec': round((j - i) * HOP / SR, 2)})
        i = j
    # 太短的（<60ms）当抖动，跟邻居合并 —— 不合并的话会切出几百个碎段
    mg = []
    for s in segs2:
        if mg and (s['sec'] < 0.06 or mg[-1]['sec'] < 0.06):
            mg[-1]['t1'] = s['t1']
            mg[-1]['sec'] = round(mg[-1]['t1'] - mg[-1]['t0'], 2)
        else:
            mg.append(s)
    vl = [s for s in mg if s['voiced']]
    sl = [s for s in mg if not s['voiced']]
    sig['voiced_ratio'] = round(float(talking.mean()), 3)
    sig['voiced_n'] = len(vl)
    sig['silence_n'] = len(sl)
    # 段落列表太长就只给统计，别把几百段塞进输出
    sig['segments'] = mg if len(mg) <= 60 else None
    if sl:
        longest = max(sl, key=lambda s: s['sec'])
        sig['longest_silence'] = {'at': longest['t0'], 'sec': longest['sec']}
        sig['silence_total'] = round(sum(s['sec'] for s in sl), 2)

    # ② 音节率：能量包络的峰 —— **不需要转写**
    sm = np.convolve(rms, np.ones(5) / 5, mode='same')
    pk = []
    for k in range(1, nf - 1):
        if not talking[k]:
            continue
        if sm[k] >= sm[k - 1] and sm[k] > sm[k + 1] and sm[k] > thr * 1.5:
            if not pk or (k - pk[-1]) * HOP / SR > 0.08:
                pk.append(k)
    if pk:
        vsec = sum(s['sec'] for s in vl) or 1
        sig['syllable_rate'] = round(len(pk) / vsec, 2)
        b5 = {}
        for k in pk:
            b = int(k * HOP / SR // 5)
            b5[b] = b5.get(b, 0) + 1
        sig['peaks_per_5s'] = [b5.get(b, 0) for b in range(int(dur // 5) + 1)]

    # ③ 谱亮度：频谱重心 —— "闷"还是"亮"
    win2 = np.hanning(FRAME)
    fq = np.fft.rfftfreq(FRAME, 1 / SR)
    ct = []
    for k in range(0, nf, 50):
        if not talking[k]:
            continue
        sp = np.abs(np.fft.rfft(fr[k] * win2))
        if sp.sum() > 1e-6:
            ct.append(float((sp * fq).sum() / sp.sum()))
    if ct:
        c = np.array(ct)
        sig['spectral_centroid'] = {'med': round(float(np.median(c))),
                                    'p10': round(float(np.percentile(c, 10))),
                                    'p90': round(float(np.percentile(c, 90)))}

    # ④ **节拍周期性** —— 这条能把"歌"和"讲话"分开，而且不需要任何模型。
    #    实测：26 秒的对白峰 0.27；242 秒的歌峰 0.74。
    env = sm - sm.mean()
    cut = min(len(env), int(30 * SR / HOP))
    if cut > 100:
        ac2 = np.correlate(env[:cut], env[:cut], mode='full')[cut - 1:]
        ac2 = ac2 / (ac2[0] + 1e-12)
        lo, hi = int(0.3 * SR / HOP), int(3.0 * SR / HOP)
        band = ac2[lo:hi]
        if len(band):
            k2 = int(np.argmax(band)) + lo
            per = k2 * HOP / SR
            sig['beat'] = {'period_sec': round(per, 3), 'bpm': round(60 / per),
                           'acf_peak': round(float(ac2[k2]), 2),
                           'likely_music': bool(ac2[k2] > 0.5)}

    # ⑤ 音高跳动：相邻有效帧的音高差（不靠形容说"起伏大不大"）
    #
    # ⚠️ **必须除一下中位音高** —— 这里是相对值。
    #    第一版我写成绝对 Hz，输出 3.97；而文案里那两条对照（说话 0.027 / 唱歌 0.013）
    #    是相对值。**数和说明差 100 倍，而两处只有一处错** —— 移植的时候丢了一个除法。
    if valid.any():
        fv = f0[valid]
        if len(fv) > 2 and np.median(fv) > 0:
            sig['pitch_jitter'] = round(float(np.median(np.abs(np.diff(fv))) / np.median(fv)), 4)
out['signal'] = sig

print(json.dumps(out, ensure_ascii=False))
`

/**
 * 抽音频为 16k 单声道 wav。
 * @returns {{ok:boolean, path?:string, why?:string}}
 */
export function extractAudio(videoPath, ffmpegPath, outWav) {
  if (!ffmpegPath) return { ok: false, why: '没找到 ffmpeg' }
  try {
    const r = spawnSync(ffmpegPath, ['-y', '-hide_banner', '-loglevel', 'error',
      '-i', videoPath, '-ac', '1', '-ar', '16000', '-vn', outWav],
      { timeout: 600000, windowsHide: true, encoding: 'utf8' })
    if (r.status !== 0 || !existsSync(outWav)) {
      return { ok: false, why: 'ffmpeg 抽音频失败：' + String(r.stderr || '').split('\n').filter(Boolean).slice(-1)[0] }
    }
    return { ok: true, path: outWav }
  } catch (e) {
    return { ok: false, why: String(e && e.message) }
  }
}

/**
 * 转写 + 语气四量。**一次子进程全做完。**
 *
 * @returns {Promise<{ok:boolean, why?:string, install?:string, data?:object}>}
 */
export function transcribeAndProsody(wavPath, opts = {}) {
  return new Promise((resolve) => {
    // ⚠️ 这里原来是 `opts.python || findPython()` —— 而那是**错的写法**：
    //    传 `{ python: null }` 想表达"这台机器没有 python"的人，会得到"自动去找一个"。
    //    一个字面意思是"没有"的值，被当成了"没传"。用 undefined 判才分得开。
    //    （这个是测试逼出来的 —— 两条断言红了，根因在这儿，不在测试。）
    const py = opts.python !== undefined ? opts.python : findPython()
    if (!py) {
      return resolve({
        ok: false, why: '没找到 python',
        // ⚠️ 这里连 hf-mirror 一起说 —— 不是跑题。
        //    装完 python 的下一件事就是装 faster-whisper，而**再下一件事就是下模型**，
        //    那时候照样会撞上 hf.co 在国内连不上。提示给在前面，他才不用撞两次。
        install: '装 Python 3，然后： py -m pip install faster-whisper\n' +
          '（模型走 hf-mirror：设环境变量 HF_ENDPOINT=https://hf-mirror.com ——\n' +
          '  huggingface.co 在国内多半连不上）',
      })
    }
    // ⚠️ **whisper 只在真的要转写的时候才检查。**
    //    信号分析（段落 / 音节 / 音高 / 谱亮度 / 节拍）只用 numpy ——
    //    没有模型、不用装、几秒钟。**没装 whisper 不该挡住它。**
    const wantTr = !!opts.transcribe
    if (wantTr) {
      const probe = probeWhisper(py)
      if (!probe.ok) {
        return resolve({
          ok: false, why: probe.why,
          install: 'py -m pip install faster-whisper\n' +
            '（模型走 hf-mirror：设环境变量 HF_ENDPOINT=https://hf-mirror.com ——\n' +
            '  huggingface.co 在国内多半连不上）',
        })
      }
    }
    const dir = join(tmpdir(), 'dsh-mood-asr')
    try { mkdirSync(dir, { recursive: true }) } catch { /* 已存在 */ }
    const script = join(dir, 'run.py')
    try { writeFileSync(script, PY_SCRIPT, 'utf8') } catch (e) {
      return resolve({ ok: false, why: '写临时脚本失败：' + String(e && e.message) })
    }
    const model = opts.model || 'small'
    const lang = opts.language || 'zh'
    // ⚠️ VAD 默认**关**。开着它对"纯说话"有用（切静音、少幻觉），
    //    但对唱歌/音乐是灾难 —— 实测那首 242 秒的歌：开着只覆盖 49 秒，关掉覆盖到 231 秒。
    const vadArg = opts.vad ? 'vad' : 'off'
    let r
    try {
      r = spawnSync(py, [script, wavPath, model, lang, wantTr ? 'transcribe' : 'no', vadArg], {
        timeout: (opts.timeoutMs || (wantTr ? 1800000 : 300000)),
        windowsHide: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', HF_ENDPOINT: process.env.HF_ENDPOINT || 'https://hf-mirror.com' },
      })
    } catch (e) {
      return resolve({ ok: false, why: '跑 python 失败：' + String(e && e.message) })
    }
    const line = String(r.stdout || '').split('\n').filter((l) => l.trim().startsWith('{')).slice(-1)[0]
    if (!line) {
      const err = String(r.stderr || '').split('\n').filter(Boolean).slice(-3).join(' / ')
      return resolve({ ok: false, why: 'python 没吐出 JSON。' + (err ? ' 最后几行：' + err : '') })
    }
    try {
      const data = JSON.parse(line)
      if (!data.ok) return resolve({ ok: false, why: data.why || '未知' })
      return resolve({ ok: true, data })
    } catch (e) {
      return resolve({ ok: false, why: 'JSON 解析失败：' + String(e && e.message) })
    }
  })
}

/** 把结果拼成**给人看的一段话**。分开报文字和数字 —— 别让数字替文字说话，反之亦然。 */
export function formatASR(data, opts = {}) {
  const L = []
  if (!data) return ''

  // ══ 信号分析（**零模型**）先报 ══
  //
  // 顺序是故意的：**这一块永远拿得到，而转写可能拿不到。**
  // 先报拿得到的那块，读的人才知道"至少这些是真的"。
  const g = data.signal
  if (g && Object.keys(g).length) {
    L.push('**音频形状**（只用信号处理，**没有模型** —— 不装、不下载、几秒钟）：')
    const bits = []
    if (g.voiced_ratio != null) bits.push('有声占 ' + Math.round(g.voiced_ratio * 100) + '%')
    if (g.voiced_n != null) bits.push('有声段 ' + g.voiced_n + ' 个')
    if (g.silence_n != null) bits.push('静音段 ' + g.silence_n + ' 个')
    if (g.longest_silence) bits.push('最长静音 ' + g.longest_silence.sec + ' 秒 @ '
      + g.longest_silence.at + ' 秒')
    if (g.syllable_rate != null) bits.push('**音节率 ' + g.syllable_rate + ' 个/秒**（有声部分）')
    if (bits.length) L.push('  ' + bits.join(' · '))
    if (g.peaks_per_5s && g.peaks_per_5s.length) {
      L.push('  每 5 秒的密度：' + g.peaks_per_5s.join(' '))
    }
    if (g.spectral_centroid) {
      const s = g.spectral_centroid
      L.push('  谱亮度（频谱重心，越高越亮）：中位 ' + s.med + ' Hz（' + s.p10 + ' ~ ' + s.p90 + '）')
    }
    if (g.beat) {
      const b = g.beat
      L.push('  **节拍**：最强周期 ' + b.period_sec + ' 秒（≈ ' + b.bpm + ' BPM）· 自相关峰 **'
        + b.acf_peak + '**')
      L.push('    ' + (b.likely_music
        ? '→ **峰 > 0.5，这段有明显的拍 —— 是音乐/有节奏的，不是纯说话。**'
        : '→ 峰 < 0.5，没有稳定的拍 —— **是说话**（对白实测 0.27，歌实测 0.74）。'))
    }
    if (g.pitch_jitter != null) {
      L.push('  音高跳动（相邻帧差 ÷ 中位音高，相对值）：中位 ' + g.pitch_jitter
        + ' —— 说话的音高乱飘（实测 0.027），**唱歌的反而稳**（实测 0.013）')
    }
    L.push('')
  }

  if (!data.transcribe_requested) {
    L.push('**转写**：这次没跑（那是"多一个模型"：faster-whisper 几百 MB）。')
    L.push('  上面那块形状是**没花代价拿到的**；要文字才需要开 `transcribe`。')
  } else if (!data.segments || !data.segments.length) {
    L.push('**转写**：没有识别到语音（可能是纯音乐/无对白，或者这段真的没人说话）')
  } else {
    // ── 覆盖率摆在段数旁边 ──
    //    "12 段"单独看就是"全转完了"的意思，而它可能只覆盖 20%。
    const c = data.coverage
    L.push('**转写**（' + data.segments.length + ' 段 · 识别语言 ' + (data.language || '?')
      + (c ? ' · **覆盖 ' + c.sec + ' / ' + c.total + ' 秒（' + Math.round(c.ratio * 100) + '%）**' : '')
      + '）：')
    if (c && c.tail_gap > 30) {
      // 尾部大段空白 —— 比"覆盖率低"更直接的信号。
      // 覆盖率低可能只是静音多；而**最后一句之后空出好几分钟**是明确的缺失。
      L.push('  ⚠️ **最后一句停在 ' + (c.total - c.tail_gap) + ' 秒，后面还有 ' + c.tail_gap
        + ' 秒没有任何转写。**')
      L.push('     唱歌 + 伴奏会让语音活动检测（VAD）把大段判成"不是语音"直接丢掉 ——')
      L.push('     **它丢东西的时候不出声**，输出照样是一串干净的段落。')
      L.push('     **别把这份当成全部内容。**（要试：把 `vad` 打开或关掉再跑一次，对比覆盖率。）')
    } else if (c && c.ratio < 0.5) {
      L.push('  ⚠️ 覆盖率不到一半 —— 后面可能还有没转出来的内容，别当成"这就是全部"。')
    }
    for (const s of data.segments) {
      L.push('  [' + s.t0.toFixed(1).padStart(7) + ' → ' + s.t1.toFixed(1).padStart(6) + ']  ' + s.text)
    }
  }
  const p = data.prosody
  if (p && p.rows && p.rows.length) {
    L.push('')
    L.push('**语气四量**（只报数，不贴情绪标签 —— "音高高+语速快"能同时是激动/紧张/愤怒/兴奋）：')
    L.push('  全片基线：音高中位 ' + (p.base_f0 || '?') + ' Hz · 出声帧占比 '
      + (p.talking_ratio != null ? (p.talking_ratio * 100).toFixed(0) + '%' : '?'))
    L.push('')
    L.push('  句          时长    语速        音高(相对全片)      能量     句内停顿')
    L.push('  ' + '-'.repeat(76))
    let thin = 0
    for (const r of p.rows) {
      let f0cell
      if (r.f0_med != null) {
        f0cell = (r.f0_med + ' Hz (' + (r.f0_rel >= 0 ? '+' : '') + (r.f0_rel * 100).toFixed(0) + '%)')
          .padEnd(20)
      } else {
        // 不能只写个「—」—— 要说清为什么没有。是"没采到"还是"采到的点不够撑一个数"，
        // 这两种情况意思完全不同，而看的人有权知道。
        f0cell = ('— (有效帧仅 ' + (r.f0_n || 0) + ')').padEnd(20)
        thin++
      }
      L.push('  ' + r.t0.toFixed(2).padStart(6) + '→' + r.t1.toFixed(2).padEnd(6)
        + ((r.t1 - r.t0).toFixed(2) + 's').padEnd(9)
        + r.rate.toFixed(2).padStart(6) + '字/秒  '
        + f0cell
        + (r.rms_rel != null ? r.rms_rel.toFixed(2) + '×' : '—').padStart(7) + '  '
        + r.sil_in.toFixed(2) + 's')
    }
    if (thin) {
      L.push('')
      L.push('  ⚠️ 有 ' + thin + ' 段音高报不出来 —— **可能是压根没采到基频，也可能是采到的点太少**。')
      L.push('     "有效帧仅 N"里的 N 就是那个数。这一段**别拿音高下结论**，但语速和停顿还是算得出来的。')
    }
    if (p.silences && p.silences.length) {
      const top = p.silences.slice().sort((a, b) => (b[1] - b[0]) - (a[1] - a[0])).slice(0, 3)
      L.push('')
      L.push('  最长的几处静音：' + top.map(([a, b]) => a.toFixed(2) + '→' + b.toFixed(2)
        + '（' + (b - a).toFixed(2) + 's）').join(' · '))
    }
  }
  if (data.notes && data.notes.length) {
    L.push('')
    for (const n of data.notes) L.push('⚠️ ' + n)
  }
  if (opts.showLimit !== false) {
    L.push('')
    // ⚠️ 这句尾注要跟着**这次实际跑了什么**走。
    //    第一版写死成"这是转写 + 数字" —— 而不转写的时候它就是在说假话。
    if (data.transcribe_requested && data.segments && data.segments.length) {
      L.push('⚠️ 这是**转写 + 数字**，不是"我听过了" —— 音质差、方言重、多人抢话时转写会错。')
    } else {
      L.push('⚠️ 这是**逐帧量出来的形状**，不是"我听过了" —— ')
      L.push('   我知道它多密、多亮、有没有拍、停了几次，**但我不知道它说了什么**。')
    }
    L.push('   而"什么语气"这一步我没做：**数字只是数字，起名是解读**。')
  }
  return L.join('\n')
}

export const __test = { PY_SCRIPT }

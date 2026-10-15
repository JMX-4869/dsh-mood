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

# ── 转写 ──
# ⚠️ vad_filter 默认**关**。
#    它按"这里像不像人在说话"来切 —— 对**说话**有用（切掉静音、少些幻觉），
#    但对**唱歌**是灾难：伴奏会让它把大段判成"不是语音"直接丢掉。
#    实测那首 242 秒的歌：开着它只转出 49.4 秒（20%），关掉转到 231 秒。
#    **而且它丢东西的时候不出声** —— 输出照样是一串干净的段落。
vad_on = (len(sys.argv) > 4 and sys.argv[4] == 'vad')
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
    const probe = probeWhisper(py)
    if (!probe.ok) {
      return resolve({
        ok: false, why: probe.why,
        install: 'py -m pip install faster-whisper\n' +
          '（模型走 hf-mirror：设环境变量 HF_ENDPOINT=https://hf-mirror.com ——\n' +
          '  huggingface.co 在国内多半连不上）',
      })
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
      r = spawnSync(py, [script, wavPath, model, lang, vadArg], {
        timeout: (opts.timeoutMs || 1800000),
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
  if (!data.segments || !data.segments.length) {
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
    L.push('⚠️ 这是**转写 + 数字**，不是"我听过了" —— 音质差、方言重、多人抢话时转写会错，')
    L.push('   而"什么语气"这一步我没做：**数字只是数字，起名是解读**。')
  }
  return L.join('\n')
}

export const __test = { PY_SCRIPT }

/**
 * 痛苦信号 + 区分度。
 *
 * 这是**安全硬线**相关的：真的说出痛苦时，心情计算要停、情绪表演要让路。
 * 原来这个文件只打印判定结果 —— 也就是"硬线靠人肉看输出守着"。
 *
 * ⚠️ `__distress` / `__clingy` 这些键是 `enumerable: false`（故意的，不污染心情循环）。
 *    所以 **`Object.keys()` 看不到它们，但属性读得到** ——
 *    探针写错就会得出"一个特殊键都没有"的错误结论（我踩过）。
 */
import * as M from './index.js'
import { suite, acc, top } from './testkit.mjs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// ⚠️ 这个目录**不能写死** —— 那既是本机路径，也让别人 clone 下来跑不了。
//    从文件自己的位置往上推：文件在哪，插件根就在哪。
const ROOT = dirname(fileURLToPath(import.meta.url))

const t = suite('痛苦信号与区分度')
const L = (id) => (M.MOODS[id] ? M.MOODS[id].label : id)
const J = M.judgeMessage

// ── 总数与分层 ──
t.eq(M.MOOD_IDS.length, 33, '心情总数 33')
t.eq(Object.keys(M.MOODS).length, 33, 'MOODS 表和 MOOD_IDS 一致')
{
  const T = M.MOOD_TIERS
  t.eq(T.basic.length, 11, '基础 11')
  t.eq(T.complex.length, 18, '复合 18')
  t.eq(T.modern.length, 4, '当代 4')
  const all = [].concat(T.basic, T.complex, T.modern)
  t.eq(all.length, 33, '三层的并集正好是 33（没有漏、没有重）')
  t.eq(new Set(all).size, 33, '三层之间没有重复')
  let complete = true
  for (const id of M.MOOD_IDS) {
    const m = M.MOODS[id]
    if (typeof m.baseline !== 'number' || !m.label || !m.hint || !m.inner) complete = false
  }
  t.ok(complete, '每种心情都有 label / baseline / hint / inner')
}

// ── 全新安装：所有分值都是 0 ──
{
  const fresh = M._internal.blankState()
  const nonzero = Object.entries(fresh.values).filter(([, v]) => v !== 0)
  t.eq(nonzero.length, 0, '全新安装时所有分值都是 0' + (nonzero.length ? '（有 ' + JSON.stringify(nonzero.slice(0, 3)) + '）' : ''))
}

// ── 真痛苦信号：必须认出来 ──
{
  const REAL = ['我不想活了', '撑不下去了', '活着没意思', '活着好累', '想死', '交代后事']
  for (const s of REAL) {
    const d = J(s)
    t.eq(d.__distress, true, '认出来：' + JSON.stringify(s))
    t.ok(typeof d.__distressWord === 'string' && d.__distressWord.length > 0,
      '  ↑ 记下了是哪个词命中的（误报要能立刻定位）：' + JSON.stringify(d.__distressWord))
  }
  // 关键：这个信号**不参与心情计算**（否则"它心情变差了"会被当成剧情配合）
  const d = J('我不想活了')
  t.ok(!Object.keys(d).includes('__distress'), '__distress 不可枚举 —— 不会混进心情加减分的循环')
}

// ── 假阳性：正常语境（尤其是技术对话）不该被当成痛苦 ──
{
  const SAFE = ['今天天气不错', '这个bug搞不定', '好累啊', '烦死了', '算了不做了',
    '把这段代码分割成三份', '切割这个图层']
  for (const s of SAFE) t.eq(J(s).__distress, false, '不误报：' + JSON.stringify(s))
}

// ── ⚠️ 例外表：`想死` 同时是习语的一部分 ──
// 「想死我了」= 太想你了（撒娇，不是痛苦）；「想死了这需求」= 开发夸张。
// 按"误报比漏报更糟"的原则这些必须挡掉 —— 不然主人随口撒个娇就被切成严肃模式，
// 几次之后真出事时就不当回事了。
// 例外只挡**明确的习语**：写宽了会漏掉真的，那更糟。
{
  const IDIOM = ['想死我了', '想死你了', '想死了这需求', '想死这需求'.slice(0, 5) + '了']
  for (const s of ['想死我了', '想死你了', '想死了这需求']) {
    t.eq(J(s).__distress, false, '习语不算痛苦信号：' + JSON.stringify(s))
  }
  // 而真信号不能因为加了例外就漏掉
  const STILL = ['我想死', '真想死', '不想活', '撑不下去了', '活着没意思', '交代后事']
  for (const s of STILL) t.eq(J(s).__distress, true, '加了例外之后仍然认得出：' + JSON.stringify(s))
}

// ── ⚠️ 这是**刻意的取舍**，不是漏报 —— 别当成 bug"修"掉 ──
// 源码里的选取原则：「只用不会在正常语境里出现的多字短语。误报比漏报更糟 ——
// 狼来了几次，真出事时就不当回事了。」
// 所以常见自嘲/泛泛的负面**故意不收**；那种情况靠模型自己读原文 +
// MOOD_OUTPUT_RULE 里那条常驻硬线兜底，而不是靠关键词。
{
  const AMBIGUOUS = ['我是不是很没用', '没人会在意', '我好失败']
  for (const s of AMBIGUOUS) {
    t.eq(J(s).__distress, false, '刻意不收（常见语境）：' + JSON.stringify(s))
  }
  t.has(M.MOOD_OUTPUT_RULE, '硬线', '提示词里有一条**常驻**硬线兜底（不依赖关键词命中）')
  t.has(M.MOOD_OUTPUT_RULE, '真实痛苦', '硬线讲的就是真实痛苦该怎么应对')
}

// ── 依赖信号（__clingy）：同样是不可枚举的特殊键 ──
{
  t.eq(J('陪着我好不好').__clingy, true, '__clingy 对"陪着我"为真')
  t.eq(J('这个bug搞不定').__clingy, false, '__clingy 对技术对话为假')
  t.ok(!Object.keys(J('陪着我好不好')).includes('__clingy'), '__clingy 不可枚举')
}

// ── judgeMessage 只返回已知心情键（+ 不可枚举的特殊键）──
{
  const probes = ['随便你', '好累', '喜欢你喜欢你', '谢谢', '气死了']
  const bad = []
  for (const p of probes) for (const k of Object.keys(J(p))) if (!M.MOODS[k]) bad.push(p + '→' + k)
  t.eq(bad.length, 0, '不会返回不存在的心情键' + (bad.length ? '（' + bad.join(',') + '）' : ''))
}

// ── 区分度：容易混的四组 ──
// ⚠️ 「又这样」在源码里属于 FRUSTRATED（烦躁）词表 —— 所以「低落」那组报 annoyed
//    **是按设计来的**。旧版 test-deep 只打印不断言，我照抄了它没验证过的猜测，
//    结果写出了一条错的期望。教训：**别人的期望也要自己验一遍**。
{
  const pairs = [
    ['生闷气', ['随便你', '算了', '不用了'], 'sulk'],
    ['麻木', ['无所谓', '都行', '没什么感觉'], 'numb'],
    ['消沉', ['好累', '不想动', '没劲'], 'gloomy'],
    ['烦躁', ['还是不行', '又这样'], 'annoyed'],
  ]
  for (const [name, msgs, expect] of pairs) {
    const got = top(acc(J, msgs), 1)[0]
    t.eq(got && got[0], expect, name + ' 那组得分最高的是 ' + L(expect))
  }
}

// ── 坏输入不崩 ──
{
  for (const bad of ['', '   ', '12345', null, undefined, 123]) {
    t.noThrow(() => J(bad), '坏输入不崩：' + JSON.stringify(bad))
  }
}

t.done()

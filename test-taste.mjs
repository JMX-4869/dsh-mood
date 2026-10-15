/**
 * 品味库。
 *
 * 这个模块和别的不一样：它管的**不是数据，是判断**。
 * 所以测的重点不是"存没存进去"，是这几件：
 *
 *   · 学习 ≠ 模仿 —— 注入里必须说清楚「例子是拿来看你偏在哪的，不是拿来当答案的」
 *   · 三件套的顺序 —— `myRead` 必须在 `reaction` **前面**（反过来就是事后合理化）
 *   · 谁说的分三档 —— 我自己的判断不能和他转述的外来判断混在一起
 *   · 我的猜测必须标着"待确认" —— 不然它会冒充成他的口味
 *
 * ⚠️ 先把 DSH_HOME 指到临时目录再 import —— 不然会动真实数据。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

// ⚠️ 这个目录**不能写死** —— 那既是本机路径，也让别人 clone 下来跑不了。
//    从文件自己的位置往上推：文件在哪，插件根就在哪。
const ROOT = dirname(fileURLToPath(import.meta.url))

const H = path.join(os.tmpdir(), 'dsh-mood-taste-test-' + Date.now())
fs.mkdirSync(H, { recursive: true })
process.env.DSH_HOME = H

const T = await import(new URL('taste.js', import.meta.url).href)
const { suite } = await import('./testkit.mjs')

const t = suite('品味库')

// ────────────────────────────────────────────────
//  空库 / 种子
// ────────────────────────────────────────────────
{
  const b = T.blankTaste()
  const s = T.stats(b)
  t.gt(s.principles, 10, '空库自带 ' + s.principles + ' 条种子原则')
  t.eq(s.byMe, s.principles, '种子全算"我的判断"（by=me）')
  t.eq(s.byOwner, 0, '一开始没有一条是主人亲口的')
  t.eq(s.items, 0, '一开始没有条目')
  t.eq(b.summary, null, '一开始没有摘要')

  // 种子必须每条都带"什么时候不适用"
  const noUnless = b.principles.filter((p) => !p.unless)
  t.eq(noUnless.length, 0, '每条种子都写了「什么时候不适用」（' + b.principles.length + ' 条）')
  // 而且不能是空话
  const shortUnless = b.principles.filter((p) => p.unless && p.unless.length < 8)
  t.eq(shortUnless.length, 0, '「不适用」不是敷衍的几个字')
  const noWhy = b.principles.filter((p) => !p.why)
  t.eq(noWhy.length, 0, '每条种子都写了「为什么」')
}

// ────────────────────────────────────────────────
//  增删改
// ────────────────────────────────────────────────
{
  const x = T.blankTaste()
  const r = T.addPrinciple(x, '标题别压在人脸上', { unless: '人物本来就虚化', by: 'owner' })
  t.eq(r.ok, true, '加原则成功')
  t.eq(r.principle.by, 'owner', '默认算主人亲口的')
  t.eq(T.stats(x).byOwner, 1, '统计里 owner 变 1')

  t.eq(T.addPrinciple(x, '标题别压在人脸上').ok, false, '一模一样的不重复加')
  t.eq(T.addPrinciple(x, '').ok, false, '空的不给加')
  t.eq(T.addPrinciple(x, 'x'.repeat(400)).ok, false, '超长的不给加')

  const r2 = T.addPrinciple(x, '留白要有节奏', { by: 'other', why: 'Claude 看对比图时说的' })
  t.eq(r2.principle.by, 'other', '能标成"外部判断"')
  t.eq(T.stats(x).byOther, 1, '统计里 other 变 1')

  // 改：动过就算他的，但 by 不乱动
  const id = r.principle.id
  T.editPrinciple(x, id, { text: '标题不要压在人脸上' })
  const after = x.principles.find((p) => p.id === id)
  t.eq(after.from, 'user', '改过之后算他认可的（from=user）')
  t.eq(after.by, 'owner', 'by 本来就是他，不变')
  // 把一条"我的"改一下 —— by 应该还是 me
  const mine = x.principles.find((p) => p.by === 'me')
  T.editPrinciple(x, mine.id, { text: mine.text + '（我说了算）' })
  t.eq(x.principles.find((p) => p.id === mine.id).by, 'me', '改我的那条，主意仍然是我的（by=me）')

  T.editPrinciple(x, id, { on: false })
  t.eq(x.principles.find((p) => p.id === id).on, false, '能关掉')
  t.eq(T.stats(x).byOwner, 0, '关掉之后不计入')

  t.eq(T.removePrinciple(x, id).ok, true, '能删')
  t.eq(T.removePrinciple(x, '不存在').ok, false, '删不存在的返回失败不抛')
}

// ────────────────────────────────────────────────
//  条目：学习三件套
// ────────────────────────────────────────────────
{
  const x = T.blankTaste()
  const r = T.addItem(x, {
    ref: '封面.png', kind: 'good', domain: '图像',
    myRead: '第一眼落在左边那两行大字上',
    said: '这个干净，看着不累',
    lesson: '我读的是手法，他说的是感受',
    tags: { color: '近黑 + 单一紫' },
  })
  t.eq(r.ok, true, '加条目成功')
  const it = r.item
  t.eq(it.myRead, '第一眼落在左边那两行大字上', 'myRead 存下来了')
  t.eq(it.said, '这个干净，看着不累', 'said 存下来了')
  t.eq(it.lesson, '我读的是手法，他说的是感受', 'lesson 存下来了')
  t.eq(it.domain, '图像', 'domain 存下来了')
  t.eq(it.tags.color, '近黑 + 单一紫', 'tags 存下来了')
  t.eq(it.confirmed, false, '**默认是待确认** —— 打标是我的判断，不能默认算他的')

  t.eq(T.addItem(x, { ref: '封面.png', kind: 'good' }).ok, false, '同一个 ref + 同一种 kind 不重复')
  t.eq(T.addItem(x, { ref: '封面.png', kind: 'bad' }).ok, true, '但正反例可以各存一条')
  t.eq(T.addItem(x, {}).ok, false, '没 ref 不给加')

  // tags 只认已知维度
  const r3 = T.addItem(x, { ref: 'x.png', tags: { color: '红', 乱写的: '值' } })
  t.eq(r3.item.tags.color, '红', '认识的维度留下')
  t.eq(r3.item.tags['乱写的'], undefined, '不认识的维度丢掉（维度一多摘要就压不住）')

  // 确认
  T.updateItem(x, it.id, { confirmed: true })
  t.eq(x.items.find((y) => y.id === it.id).confirmed, true, '能确认')
  t.eq(T.updateItem(x, it.id, { kind: 'bad' }).item.kind, 'bad', '能改成反例')
  t.eq(T.updateItem(x, '不存在', {}).ok, false, '改不存在的返回失败')
  t.eq(T.removeItem(x, it.id).ok, true, '能删')
}

// ────────────────────────────────────────────────
//  注入渲染 —— 这个模块最要紧的输出
// ────────────────────────────────────────────────
{
  const x = T.blankTaste()
  T.addPrinciple(x, '标题别压在人脸上', { by: 'owner', unless: '人物本来就虚化' })
  T.addPrinciple(x, '留白要有节奏', { by: 'other', why: 'Claude 说的' })
  T.addItem(x, {
    ref: '封面.png', kind: 'good', domain: '图像',
    myRead: '我读的是让开', said: '干净不累', lesson: '落点是感受',
  })

  const p = T.renderForPrompt(x, { maxPrinciples: 2, maxItems: 2 })

  t.has(p, '## 审美档案', '有标题')
  t.has(p, '不能模仿', '说了「可以学习，不能模仿」')
  t.has(p, '先有你自己的第一反应', '说了「先出判断，再对原则」')
  t.has(p, '先说出你自己的读法', '给了三步的顺序')
  t.has(p, '不一致不等于你错', '明说了「不一致不等于你错」')
  t.has(p, '不是给"照抄"用的', '声明了这段是给反馈用的')
  t.ok(!/跟着走/.test(p), '没有"跟着走"这种照抄口径')

  // 顺序：例子在原则**前面**
  // ── 分两份（主人要求的结构）──
  //    顶层只有「你的口味」和「我的品味」；底下那三档（你说的 / 你认可的 /
  //    我自己的）**保留** —— 它们是有用的区别，只是不再当顶层。
  const iTheirs = p.indexOf('## 你的口味')
  const iOurs = p.indexOf('## 我的品味')
  t.gt(iTheirs, 0, '有「你的口味」那一份')
  t.gt(iOurs, 0, '有「我的品味」那一份')
  t.ok(iTheirs < iOurs, '两份的顺序：先你给的，后我自己长的')

  const iEx = p.indexOf('### 例子')
  const iOwner = p.indexOf('### 你说过的话')
  const iOther = p.indexOf('### 你认可的')
  // ⚠️ 别断**具体小节名**。原来断的是 '### 我自己的倾向' ——
  //    后来我把那节拆成「我学到的」+「一开始带的倾向」（因为种子排在前面，
  //    库一大就把学到的全挤掉了），这个断言就假红了一次。
  //    改断**稳定的顶层标题**：意图只是"他的排在前面"。
  const iMine = p.indexOf('## 我的品味')
  t.gt(iEx, 0, '有例子段')
  t.ok(iEx < iOwner, '例子排在原则前面（例子信息量更大）')
  t.ok(iOwner < iOther, '亲口 > 外部')
  t.ok(iOther < iMine, '外部 > 我自己的')
  // 学到的那批必须排在种子前面 —— 不然库一大就被种子挤掉（踩过，见上面那段注释）
  const iLearned = p.indexOf('### 我学到的')
  const iSeed = p.indexOf('一开始带的倾向')
  t.ok(iLearned < 0 || iSeed < 0 || iLearned < iSeed, '「我学到的」排在种子前面')

  // 时事也能补品味（主人原话：「抓取的时事可以补足品味」）
  t.has(p, '时事里也能捡到审美素材', '说了时事可以补品味')

  // 三件套都在，且顺序是 myRead → said → lesson
  const iRead = p.indexOf('我当时读的是')
  const iSaid = p.indexOf('他说：「干净不累」')
  const iLess = p.indexOf('学到')
  t.gt(iRead, 0, '渲染出了我的读法')
  t.gt(iSaid, 0, '渲染出了他说的话')
  t.gt(iLess, 0, '渲染出了学到什么')
  t.ok(iRead < iSaid, '**我的读法排在他说的话前面**（反过来就是事后合理化）')
  t.ok(iSaid < iLess, '反馈在"学到"前面')

  t.has(p, '还没确认', '待确认的条目被标出来了')
  t.has(p, '别当成他的口味', '并且说明了那不代表他')

  // maxPrinciples 支持 0（别用 || 默认值把 0 吃掉）
  const p0 = T.renderForPrompt(x, { maxPrinciples: 0, maxItems: 0 })
  t.ok(!/标题别压在人脸上/.test(p0), 'maxPrinciples=0 时一条原则都不列')
  t.ok(!/封面\.png/.test(p0), 'maxItems=0 时一条例子都不列')

  // 空库也不能崩
  const empty = T.renderForPrompt(T.blankTaste(), {})
  t.has(empty, '## 审美档案', '空库也渲染得出标题')
  // ⚠️ blankTaste 里有 22 条种子，所以它不是空库 —— 真正缺的是「例子」。
  t.ok(!/### 例子/.test(empty), '没有条目时不渲染例子段')
  t.noThrow(() => T.renderForPrompt(null, {}), '传 null 不崩')
  t.has(T.renderForPrompt(null, {}), '## 审美档案', '传 null 也返回可用文本，不是空白')
}

// ────────────────────────────────────────────────
//  摘要
// ────────────────────────────────────────────────
{
  const x = T.blankTaste()
  t.eq(T.summaryStale(x).stale, true, '没写过摘要 → 该写')
  const nowCount = T.stats(x).principlesOn + T.stats(x).items
  t.eq(T.setSummary(x, '主人偏冷调、克制。', nowCount).ok, true, '能写摘要')
  t.eq(T.summaryStale(x).stale, false, '刚写完 → 不急着重写')

  // 库涨三成以上就该重压
  //
  // ⚠️ 这段原来是**因为 bug 才绿的**：加 6 条（22→28）其实没到 30%，
  //    但当年 addPrinciple 里有一句 `t.summary = null`，把摘要清掉了，
  //    于是 summaryStale 返回的是「还没写过摘要」—— **另一个理由**，
  //    而断言只看 `.stale`，看不出来。
  //    后来把那个"清摘要"的 bug 修掉，这条才露馅。
  //
  //    所以现在两件事一起锁：数字真要跨过 30%（22 → 31，阈值 30.6），
  //    而且**理由必须是尺寸**，不能是别的。
  for (let i = 0; i < 9; i++) T.addPrinciple(x, '临时原则 ' + i)
  const sv = T.summaryStale(x)
  t.eq(sv.stale, true, '库涨了三成 → 提示重压')
  t.has(sv.why, '涨到', '理由是"长大了"，不是别的（' + sv.why + '）')
  t.eq(T.summaryStale(x).why.includes('还没写过'), false, '而且摘要还在（别把"没摘要"当成"该重压"）')

  t.eq(T.setSummary(x, '', 1).ok, false, '空摘要不给写')
  t.eq(T.setSummary(x, 'x'.repeat(3000), 1).ok, false, '超长摘要不给写（摘要的意义就是短）')
}

// ────────────────────────────────────────────────
//  老数据 / 存读往返
// ────────────────────────────────────────────────
{
  // 没有 quotes/by/myRead 这些字段的老库
  const old = {
    version: 1,
    principles: [{ id: 'p1', text: '老原则', from: 'seed' }],
    items: [{ id: 'i1', ref: '老条目.png', kind: 'good' }],
  }
  const m = T.migrateTaste(old)
  t.eq(m.principles.length, 1, '老数据的原则留住了')
  t.eq(m.principles[0].by, 'me', '没有 by 的老原则 → 按 from 推成 me')
  t.eq(m.principles[0].on, true, '缺 on 的当打开')
  t.eq(m.items[0].by, 'owner', '没有 by 的老条目 → 当主人亲口的')
  t.eq(m.items[0].myRead, '', '缺 myRead 的补空串（不是 undefined）')
  t.eq(m.summary, null, '缺摘要的补 null')
  t.noThrow(() => T.migrateTaste(null), 'migrate(null) 不崩')
  t.noThrow(() => T.migrateTaste({ principles: 'not an array' }), '字段类型不对也不崩')

  // 存读往返
  const x = T.blankTaste()
  T.addItem(x, { ref: '往返.png', kind: 'good', myRead: '读法', said: '反馈', lesson: '学到', domain: '图像' })
  t.eq(T.saveTaste(x), true, '存盘成功')
  t.ok(fs.existsSync(T.tasteFile()), '文件真写出来了')
  const back = T.loadTaste()
  t.eq(back.items.length, 1, '读回来条目还在')
  t.eq(back.items[0].myRead, '读法', '读回来三件套完整')
  t.eq(back.items[0].lesson, '学到', 'lesson 也在')
  t.eq(back.principles.length, x.principles.length, '原则数量一致')

  // 文件坏了不能崩
  fs.writeFileSync(T.tasteFile(), '{ 这不是 JSON', 'utf8')
  const bad = T.loadTaste()
  t.gt(bad.principles.length, 0, '文件坏了 → 退回空库（种子还在），不崩')
}

// ────────────────────────────────────────────────
//  文本渲染
// ────────────────────────────────────────────────
{
  const x = T.blankTaste()
  const full = T.renderFull(x)
  t.has(full, '品味库', 'renderFull 有标题')
  t.has(full, '种子', '标出了种子那部分')
  t.has(full, '条目', '有条目那节')

  const withItem = T.blankTaste()
  T.addItem(withItem, { ref: 'x.png', kind: 'bad', said: '这个俗', domain: '图像' })
  const f2 = T.renderFull(withItem)
  t.has(f2, 'x.png', 'renderFull 里能看到条目')
  t.has(f2, '这个俗', '也能看到原话')
  t.has(f2, '待确认', '待确认标出来了')
}

// 清理临时 home
try { fs.rmSync(H, { recursive: true, force: true }) } catch { /* 不管 */ }

t.done()

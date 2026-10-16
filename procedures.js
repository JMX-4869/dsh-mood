/**
 * procedures.js —— 经验卡（踩过的坑，按"症状"存，命中才读）
 *
 * ══════════════════════════════════════════════════════════════════════
 * 来源：MiHjy12138/DSH-agent-procedures（⭐12，MIT）的那套机制。
 * 我按 DSH 的形式重写了一遍，**几个刻意的不同**写在下面。
 *
 * ═══ 它解决什么 ═══════════════════════════════════════════════════════
 * Agent 会反复踩同一个坑。而现有的东西都治不了：
 *   · 技能/手册写的是**正向流程** —— 而 agent 的时间大多花在**试错**上
 *   · 记忆/RAG 是**被动**的：你得先知道坑的存在，才能去搜它
 * → 所以：**把坑按"下次会出现的症状"存下来**，症状对上就去读那张。
 *
 * ═══ 三个零件 ═════════════════════════════════════════════════════════
 *   <工作区>/procedures/
 *     INDEX.md          消歧表：只登记**容易混的几对症状**（不逐卡列！）
 *     _inbox.md         一行一个：踩坑当下就记，别等收尾
 *     <分类>-<症状>.md   卡：≤2 KB，六段
 *     _模板.md
 *
 * ⚠️ **为什么索引不逐卡列症状** —— 它的实测（21 张卡规模）：
 *      逐卡列症状的索引      2368 字
 *      卡内「症状」行合计    1712 字   ← 同一批词的真正载体
 *      ls 看卡名              484 字
 *    「逐卡索引 = 症状行的手工副本：同一批词写两遍」——
 *    而它记了一句我认得的话：**「实测里 agent 自己绕过它去 ls —— 它算得比谁都清楚。」**
 *    所以这里跟着它：**症状词归卡（卡名 + 卡首那行），索引只做消歧。**
 *
 * ═══ 和原版的不同（两处）═════════════════════════════════════════════
 * ① **原版挂 `AGENTS.md` 钩子；DSH 这边没有那个文件** —— 所以我用
 *    `systemPrompt.section` 注入那 4 行。⚠️ **但那是每轮都发的**，
 *    所以我把钩子压到最短，而且**把它的 order 排在品味之前**
 *    （它比品味变得还少：品味我每轮在加东西，卡是偶尔才加一张）。
 * ② **原版有个 `procedures-probe.mjs` 去验证"钩子到底生不生效"** ——
 *    那个思路我留着，但我没做脚本：这里把"最近有没有人读过卡"记在
 *    `_reads.json` 里，面板上直接显示。**少一个要维护的文件。**
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync, copyFileSync } from 'node:fs'
import { join, dirname, basename, resolve } from 'node:path'
import { activeSessionsDir, extractSession } from './sidx.js'
import { customDirFor, setDirForKey } from './store.js'
// ⚠️ **转出来** —— index.js 那条 GET 用的是 `PROC.customDirFor(...)`，
//    而它是 store.js 的导出、不是这个模块的。不转的话那条路由永远报
//    「PROC.customDirFor is not a function」，而**别的都正常**（POST 那条就走得通）——
//    于是"验了一个方法"会让人以为整条路由没事。
export { customDirFor }

/**
 * 当前工作区路径。
 *
 * ⚠️ **不用 `process.cwd()`** —— 那是我今晚栽过两次的（宿主是 Electron 起的，
 *    cwd 拿不准）。改用：**扫会话目录，取最近在写的那个会话文件的 header，
 *   它里面的 `cwd` 就是工作区。** 那条路验过了（sidx.js 的 activeSessionsDir）。
 */
export function workspaceDir() {
  try {
    const dir = activeSessionsDir()
    if (!dir) return ''
    let best = '', t = 0
    for (const id of readdirSync(dir)) {
      const f = join(dir, id, 'session.v4.jsonl.zstd')
      if (!existsSync(f)) continue
      try {
        const m = statSync(f).mtimeMs
        if (m > t) { t = m; best = f }
      } catch { /* 读不动就跳过 */ }
    }
    if (!best) return ''
    const { header } = extractSession(best, { maxMsgs: 1 })
    return (header && header.cwd) || ''
  } catch { return '' }
}

export function proceduresDir(ws) {
  // ⚠️ **先问存储配置。** 用户可以在设置页把这一项指到一个固定目录
  //    （那样它就跨工作区共享了 —— 换个工作区也能看到同一批卡）。
  //    没指过才跟随工作区。
  const custom = customDirFor('procedures')
  if (custom) return custom

  // ⚠️ **不能信传进来的 `ws`** —— 我第一版就信了它：
  //    把一行中文当成工作区传进来时，它会 join 出一个假路径，
  //    而 `ensure()` 会**真的去建那个目录**。
  //    （就是刚发生的事：我把 addInbox(line) 写成了漏掉 ws 参数。）
  //    → 不像路径就当没给，回退到自动探测。
  //
  // ⚠️ 而这里的正则和 moveTo 那边是同一个坑：`[\/]` 丢反斜杠，
  //    于是**任何 `D:\...` 都会被判成"不像路径"** —— 而它一直没暴露，
  //    因为调用方总是传工作区或 `0`，坏的那一支永远走不到。
  //    （"永远走不到的分支"不等于"对的分支"。）
  const w = (typeof ws === 'string' && /^[A-Za-z]:[\\/]|^\//.test(ws)) ? ws : workspaceDir()
  return w ? join(w, 'procedures') : ''
}

function ensure(dir) {
  if (!dir) return false
  try { mkdirSync(dir, { recursive: true }); return true } catch { return false }
}

/** 一张卡的骨架（新卡就照这个填） */
export const CARD_TEMPLATE = `# <分类>-<症状>

> **症状**：<下次任务里会出现的、你自己会搜的那句话。用任务里的说法，别用行话>
> **验证**：<怎么确认这次真的成了 —— **别拿"没报错"当成了**>

## 首选
<可直接复制的那一条：命令 / 参数 / 路径。不带解释。>

## 被挡时
<首选被挡时的兜底，1~2 条，按方便程度排。>

## 别做（反面清单）
<试过并且失败的路。**这一段是整张卡最值钱的地方** ——
 技能和手册里没有它的位置，因为那些教的是正向流程。>

## 代价
<上一次踩它花了多少（几步 / 几分钟）—— 有了这个数，下次才知道值不值得先翻卡。>
`

/** 扫卡片：只返回**元信息**（症状行 / 大小 / 改动时间），不返回正文 */
export function listCards(ws) {
  const dir = proceduresDir(ws)
  if (!dir || !existsSync(dir)) return { dir, cards: [], inbox: 0 }
  const cards = []
  let inboxLines = 0
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.md')) continue
    const p = join(dir, name)
    let st
    try { st = statSync(p) } catch { continue }
    if (name === '_inbox.md') {
      try {
        inboxLines = readFileSync(p, 'utf8').split('\n')
          .filter((l) => l.trim() && !l.trim().startsWith('#')).length
      } catch { /* 读不动就算 0 */ }
      continue
    }
    // 只取前 8 行，从里面挖「症状」那一行 —— 那是下次会搜的词
    let trigger = ''
    try {
      const head = readFileSync(p, 'utf8').split('\n').slice(0, 8).join('\n')
      const m = head.match(/^\s*>\s*\*\*症状\*\*[：:]\s*(.+)$/m)
        || head.match(/^\s*>\s*\*\*触发\*\*[：:]\s*(.+)$/m)
      if (m) trigger = m[1].trim()
    } catch { /* 读不动就给空 */ }
    cards.push({
      id: name,
      name: basename(name, '.md'),
      trigger,
      bytes: st.size,
      mtime: st.mtimeMs,
      // ⚠️ 辅助文件不算"卡"：名字带 `_` 的，加上 **INDEX.md**。
      //    我第一版只排了带 `_` 的 —— 于是 INDEX.md 被算成一张卡，
      //    钩子里写着"现在 1 张卡"而那张卡是索引本身。（实测：scaffold 之后卡数 = 2）
      helper: name.startsWith('_') || /^INDEX\.md$/i.test(name),
    })
  }
  cards.sort((a, b) => b.mtime - a.mtime)
  return { dir, cards, inbox: inboxLines }
}

export function readCard(ws, id) {
  const dir = proceduresDir(ws)
  if (!dir) return { ok: false, error: '找不到工作区（procedures 目录不存在）' }
  // ⚠️ 只允许读那个目录底下的 .md —— 别让 id 里带 `..` 跑出目录
  const safe = String(id || '').replace(/[\\/]/g, '')
  if (!safe.endsWith('.md')) return { ok: false, error: '只能读 .md' }
  const p = join(dir, safe)
  if (!existsSync(p)) return { ok: false, error: '没有这个文件：' + safe }
  try { return { ok: true, id: safe, text: readFileSync(p, 'utf8') } } catch (e) {
    return { ok: false, error: String((e && e.message) || e) }
  }
}

export function writeCard(ws, id, text) {
  const dir = proceduresDir(ws)
  if (!dir) return { ok: false, error: '找不到工作区' }
  if (!ensure(dir)) return { ok: false, error: '建不了 procedures 目录' }
  const safe = String(id || '').replace(/[\\/]/g, '').trim()
  if (!safe || !safe.endsWith('.md')) return { ok: false, error: '文件名要以 .md 结尾' }
  if (String(text || '').length > 20000) return { ok: false, error: '太大（卡该 ≤2 KB）' }
  try {
    writeFileSync(join(dir, safe), String(text || ''), 'utf8')
    return { ok: true, id: safe }
  } catch (e) { return { ok: false, error: String((e && e.message) || e) } }
}

export function deleteCard(ws, id) {
  const dir = proceduresDir(ws)
  const safe = String(id || '').replace(/[\\/]/g, '').trim()
  if (!dir || !safe.endsWith('.md')) return { ok: false, error: '文件名不对' }
  if (safe === '_inbox.md') return { ok: false, error: 'inbox 要用清空，不是删' }
  const p = join(dir, safe)
  if (!existsSync(p)) return { ok: false, error: '没有这个文件' }
  try { unlinkSync(p); return { ok: true } } catch (e) { return { ok: false, error: String(e.message || e) } }
}

/** inbox：一行一个。**踩坑的当下就写** —— 那是整套东西最容易失效的一环 */
export function addInbox(ws, line) {
  const dir = proceduresDir(ws)
  if (!dir) return { ok: false, error: '找不到工作区' }
  if (!ensure(dir)) return { ok: false, error: '建不了 procedures 目录' }
  const t = String(line || '').trim()
  if (!t) return { ok: false, error: '空的' }
  const p = join(dir, '_inbox.md')
  try {
    if (!existsSync(p)) {
      writeFileSync(p, '# inbox —— 踩坑当下记一行，别等收尾\n\n', 'utf8')
    }
    writeFileSync(p, '- ' + t.replace(/\s+/g, ' ') + '\n', { flag: 'a' })
    return { ok: true }
  } catch (e) { return { ok: false, error: String(e.message || e) } }
}

export function readInbox(ws) {
  const dir = proceduresDir(ws)
  if (!dir) return { ok: false, error: '找不到工作区' }
  const p = join(dir, '_inbox.md')
  if (!existsSync(p)) return { ok: true, text: '' }
  try { return { ok: true, text: readFileSync(p, 'utf8') } } catch (e) {
    return { ok: false, error: String(e.message || e) }
  }
}

export function clearInbox(ws) {
  const dir = proceduresDir(ws)
  if (!dir) return { ok: false, error: '找不到工作区' }
  try {
    writeFileSync(join(dir, '_inbox.md'), '# inbox —— 踩坑当下记一行，别等收尾\n\n', 'utf8')
    return { ok: true }
  } catch (e) { return { ok: false, error: String(e.message || e) } }
}

/** 建目录 + 放模板 + 放一份空索引（"一键开张"） */
export function scaffold(ws) {
  const dir = proceduresDir(ws)
  if (!dir) return { ok: false, error: '找不到工作区' }
  if (!ensure(dir)) return { ok: false, error: '建不了目录' }
  const wrote = []
  const tpl = join(dir, '_模板.md')
  if (!existsSync(tpl)) { writeFileSync(tpl, CARD_TEMPLATE, 'utf8'); wrote.push('_模板.md') }
  const idx = join(dir, 'INDEX.md')
  if (!existsSync(idx)) {
    writeFileSync(idx, `# 索引 —— **只放容易混的几对症状**，别逐卡列

> ⚠️ 这张表**不随卡数增长**：症状词归卡（卡名 + 卡首那行），
>    这里只回答"两个症状听起来像，我该翻哪张"。
>    （实测：逐卡列症状的索引是症状行的手工副本，同一批词写两遍 ——
>      而 agent 最后会自己绕过它去 \`ls\`。）

| 症状 | 翻哪张 |
| --- | --- |
| （示例）页面返回 200 却只有空壳 | 抓取-网页与分享链接 |
`, 'utf8')
    wrote.push('INDEX.md')
  }
  const inb = join(dir, '_inbox.md')
  if (!existsSync(inb)) { writeFileSync(inb, '# inbox —— 踩坑当下记一行，别等收尾\n\n', 'utf8'); wrote.push('_inbox.md') }
  return { ok: true, dir, wrote }
}

/**
 * 注入用的那一小段 —— **压到最短**。
 *
 * ⚠️ 它是**每轮都发**的，所以每多一个字都是长期成本。
 *    而它要传达的只有三件事：
 *      ① 有这么个文件夹
 *      ② **踩坑的当下**就往 inbox 记一行（别等收尾）
 *      ③ 撞上症状先去搜，别凭记忆答
 */
export function renderHook(ws) {
  const info = listCards(ws)
  const n = info.cards.filter((c) => !c.helper).length
  if (!info.dir || n === 0) return ''   // 一张卡都没有就不占地方
  // ⚠️ 目录**可能是被指到别处的**（设置页里能改存储位置）。
  //    那样"工作区里有 procedures/"就是错的 —— 而模型会照着那句去工作区里搜，
  //    搜不到就以为没有卡。**所以这里说真实路径。**
  const custom = customDirFor('procedures')
  const where = custom ? `\`${custom}\`` : '工作区里的 `procedures/`'
  return [
    '## 经验卡（procedures/）',
    '',
    `${where}（现在 **${n} 张卡**${info.inbox ? ` · inbox ${info.inbox} 行待整理` : ''}）——` +
    '存的是**踩过的坑**，按"下次会出现的症状"命名，**命中才读**。',
    '',
    `· **撞上症状先去搜**，别凭记忆答：拿任务里的说法搜那里的 \`*.md\`，命中哪张读哪张；拿不准就多搜一个词。`,
    `· **踩坑的当下**就往 \`_inbox.md\` 追一行（症状 + 一句话解法）—— **别等收尾，收尾要靠回忆**。记一行也算数。`,
  ].join('\n')
}

/**
 * 把经验卡目录搬到别处（设置页里点"改存储位置"就是走这条）。
 *
 * ⚠️ **旧的目录不删。** 删用户数据这种事不该自动做 ——
 *    搬过去之后旧的那份留着当备份，要清理自己清。
 *    （同理：复制失败就**不写配置**，免得指针指到一个空目录。）
 */
export function moveTo(newDir, ws) {
  const d = String(newDir || '').trim()
  // ⚠️ **空 = 恢复默认（跟随工作区）**，不是"出错"。
  //    面板上那个「恢复默认」按钮就是发一个空 dir 过来。
  //    （我第一版这里直接 return 错误，于是那个按钮永远失败。）
  if (!d) {
    const okDel = setDirForKey('procedures', '')
    return okDel
      ? { ok: true, to: proceduresDir(), note: '改回跟随工作区了' }
      : { ok: false, error: '清配置失败' }
  }
  if (!/^[A-Za-z]:[\\/]|^\//.test(d)) return { ok: false, error: '要绝对路径（相对路径会跟着 cwd 乱跑）' }
  const from = proceduresDir(ws)
  if (!from) return { ok: false, error: '找不到当前目录' }
  if (resolve(from) === resolve(d)) return { ok: false, error: '和现在一样' }

  let copied = 0
  try {
    mkdirSync(d, { recursive: true })
    if (existsSync(from)) {
      for (const name of readdirSync(from)) {
        if (!name.endsWith('.md')) continue
        copyFileSync(join(from, name), join(d, name))
        copied++
      }
    }
  } catch (e) { return { ok: false, error: '复制失败：' + ((e && e.message) || e) } }

  const ok = setDirForKey('procedures', d)
  if (!ok) return { ok: false, error: '写配置失败' }
  return { ok: true, from, to: d, copied, note: '旧目录留着没删（要清自己清）' }
}

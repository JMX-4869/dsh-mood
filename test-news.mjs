/**
 * 时事：解析与正文抽取。
 *
 * 全部是**纯函数**，不发网络请求 —— 测的是"拿到一段 HTML/RSS/JSON 之后
 * 能不能正确变成条目"，那才是最容易出错、也最没人看的部分。
 *
 * ⚠️ 原来**根本没有这个文件**：news.js 660 行、五种解析器（RSS / Atom /
 *    JSON / HTML / VTT），一个测试都没有。而它是唯一一个会**主动往外发请求**
 *    的模块 —— 解析错了的后果不是报错，是"时事那栏里躺着一条胡说八道的东西"。
 */
import * as N from 'file:///D:/chajian/dsh-mood/news.js'
import { suite } from './testkit.mjs'

const t = suite('时事解析')

// ── HTML → 纯文本 ──
{
  t.eq(N.htmlToText('<p>你好</p>'), '你好', '剥标签')
  t.eq(N.htmlToText('<p>a &amp; b</p>'), 'a & b', '实体解码')
  const s = N.htmlToText('<h1>标题</h1><p>正文</p>')
  t.ok(s.includes('标题') && s.includes('正文'), '多块内容都留下')
  const dirty = N.htmlToText('<p>正经内容</p><script>alert(1)</script><style>.x{}</style>')
  t.ok(!dirty.includes('alert') && !dirty.includes('.x{'), 'script / style 整段干掉')
  t.eq(N.htmlToText(''), '', '空输入返回空')
  t.eq(N.htmlToText(null), '', 'null 返回空')
  t.noThrow(() => N.htmlToText('<div>' + 'x'.repeat(200000) + '</div>'), '超长输入不崩')
}

// ── 视频站识别（决定走哪条抓取路）──
{
  t.eq(N.guessMedia('https://youtu.be/abc'), 'video', 'youtu.be → video')
  t.eq(N.guessMedia('https://www.youtube.com/watch?v=1'), 'video', 'youtube.com（带 www）→ video')
  t.eq(N.guessMedia('https://www.bilibili.com/video/BV1xx'), 'video', 'bilibili → video')
  t.eq(N.guessMedia('https://example.com/post'), 'article', '普通网页 → article')
  t.eq(N.guessMedia('不是网址'), 'article', '坏输入 → article（不崩）')
  t.eq(N.guessMedia(''), 'article', '空输入 → article')
  // 注意：这里只有 video / article 两类，没有 image —— 直链图片也归 article，是设计如此
  t.eq(N.guessMedia('https://x.com/a.jpg'), 'article', '直链图片也归 article（只有两类）')
}

// ── 源类型猜测 ──
{
  t.eq(N.guessKind('https://x.com/feed.xml'), 'rss', '.xml → rss')
  t.eq(N.guessKind('https://x.com/rss'), 'rss', '路径里有 rss → rss')
  t.eq(N.guessKind('https://x.com/'), 'auto', '看不出来 → auto')
  t.eq(N.guessKind(''), 'auto', '空 → auto')
}

// ── RSS / Atom ──
{
  const rss = '<?xml version="1.0"?><rss><channel>' +
    '<item><title>标题A</title><link>https://a.com/1</link><description>描述A</description></item>' +
    '<item><title>标题B</title><link>https://a.com/2</link></item>' +
    '</channel></rss>'
  const items = N.parseRss(rss)
  t.eq(items.length, 2, 'RSS 解出 2 条')
  t.eq(items[0].title, '标题A', '标题取对')
  t.eq(items[0].url, 'https://a.com/1', '链接取对')
  t.ok(!Object.keys(items[0]).includes('description'), '正文不混进条目（正文另一条路抓）')

  const atom = '<feed><entry><title>Atom 条目</title><link href="https://b.com/x"/></entry></feed>'
  const ai = N.parseRss(atom)
  t.eq(ai.length, 1, 'Atom 也认（<link href>）')
  t.eq(ai[0].url, 'https://b.com/x', 'Atom 的 href 取对')

  t.eq(N.parseRss('').length, 0, '空输入 → 0 条')
  t.eq(N.parseRss('<html><body>这不是 feed</body></html>').length, 0, 'HTML 不是 feed → 0 条')
  t.noThrow(() => N.parseRss('<rss><channel><item>'), '残缺 XML 不崩')
  t.eq(N.parseRss(rss, 1).length, 1, 'limit 生效')

  // 没有标题的条目要丢掉（标题是唯一必填项）
  const noTitle = N.parseRss('<rss><channel><item><link>https://a.com/1</link></item></channel></rss>')
  t.eq(noTitle.length, 0, '没标题的条目丢掉')
  // 相对链接不能当 url 收进来
  const rel = N.parseRss('<rss><channel><item><title>相对链接的条目</title><link>/a/1</link></item></channel></rss>')
  t.eq(rel.length, 1, '相对链接的条目还是收')
  t.eq(rel[0].url, '', '但 url 留空（不当成可用链接）')
}

// ── 通用 JSON ──
{
  const obj = { items: [{ title: 'JSON 标题', url: 'https://c.com/1' }] }
  t.eq(N.parseJsonAny(obj).length, 1, '对象里找得到 title')
  t.eq(N.parseJsonAny(obj)[0].title, 'JSON 标题', '标题取对')
  t.eq(N.parseJsonAny(obj)[0].url, 'https://c.com/1', 'url 取对')
  t.eq(N.parseJsonAny([{ title: '裸数组里的标题' }]).length, 1, '裸数组也认')

  // ⚠️ 这条以前是坏的：传字符串会**静默返回空**（名字里有 parse，却只认对象）
  t.eq(N.parseJsonAny(JSON.stringify(obj)).length, 1, '传 JSON 字符串也能解析（不再静默返回空）')
  t.eq(N.parseJsonAny('{不是合法 json').length, 0, '坏 JSON 返回空（不崩）')

  const nested = { a: { b: { c: [{ title: '深层标题', link: 'https://d.com/1' }] } } }
  t.eq(N.parseJsonAny(nested).length, 1, '递归找得到深层标题')
  t.eq(N.parseJsonAny(nested)[0].url, 'https://d.com/1', 'link 也能当 url')

  t.eq(N.parseJsonAny({ items: [{ title: '太短' }] }).length, 0, '标题太短（<4 字）的不收')
  t.eq(N.parseJsonAny({ items: [{ title: 'x'.repeat(300) }] }).length, 0, '标题太长（>200）的不收')
  const dup = { items: [{ title: '重复标题' }, { title: '重复标题' }] }
  t.eq(N.parseJsonAny(dup).length, 1, '重复标题去重')
}

// ── VTT 字幕 ──
{
  const vtt = 'WEBVTT\n\n00:00.000 --> 00:02.000\n第一句\n\n00:02.000 --> 00:04.000\n第二句'
  const x = N.vttToText(vtt)
  t.ok(x.includes('第一句') && x.includes('第二句'), '字幕正文都留下')
  t.ok(!x.includes('-->') && !x.includes('WEBVTT'), '时间轴和头部去掉')
  t.eq(N.vttToText(''), '', '空输入返回空')
  t.noThrow(() => N.vttToText('WEBVTT\n\n00:00.000 --> 00:02.000'), '只有时间轴没正文也不崩')
}

// ── 摘要抽取 ──
{
  const long = '第一句。第二句。第三句。第四句。第五句。第六句。第七句。第八句。'
  const cut = N.pickExcerpt(long, 20)
  t.ok(cut.length <= 20 + 6, '截到差不多长（' + cut.length + ' ≤ 26）')
  t.ok(/[。！？…]$/.test(cut) || cut.length <= 20, '尽量在小句边界收尾')
  t.eq(N.pickExcerpt('', 20), '', '空输入返回空')
  t.noThrow(() => N.pickExcerpt(null, 20), 'null 不崩')

  const meta = N.metaDescription('<html><head><meta name="description" content="这是页面描述"></head></html>')
  t.ok(typeof meta === 'string', 'metaDescription 返回字符串')
}

// ── 造源 ──
{
  const s = N.makeSource('https://x.com/feed.xml', '我的源')
  t.eq(s.url, 'https://x.com/feed.xml', 'url 原样')
  t.eq(s.label, '我的源', 'label 用给的')
  t.eq(s.kind, 'rss', 'kind 自动判成 rss')
  t.ok(typeof s.id === 'string' && s.id.length > 0, '有 id')
  t.gt(s.limit, 0, '有 limit')
  const auto = N.makeSource('https://x.com/')
  t.eq(auto.kind, 'auto', '判不出来时 kind = auto')
  t.ok(typeof auto.label === 'string' && auto.label.length > 0, '没给 label 时自己取一个名字')
  t.noThrow(() => N.makeSource(''), '空 url 不崩')
  t.noThrow(() => N.makeSource('不是网址'), '坏 url 不崩')
}

// ── 进提示词：必须有长度上限（这是唯一进模型上下文的地方）──
{
  const n = N.blankNews()
  t.ok(n && typeof n === 'object', 'blankNews 返回对象')
  const text = N.renderForPrompt(n, 12)
  t.ok(typeof text === 'string', 'renderForPrompt 返回字符串')
  t.noThrow(() => N.renderForPrompt(null, 12), 'null 不崩')
  t.noThrow(() => N.renderForPrompt(undefined), 'undefined 不崩')

  // 拿真快照喂一遍（fixtures/news.json 是从跑着的插件上抓的）
  const snap = JSON.parse((await import('node:fs')).readFileSync('D:/chajian/dsh-mood/fixtures/news.json', 'utf8'))
  const out = N.renderForPrompt(snap, 12)
  t.ok(typeof out === 'string', '真快照也能渲染')
  t.ok(out.length <= N.NEWS_PROMPT_MAX * (N.NEWS_TITLE_MAX + 40), '渲染结果有上限（' + out.length + ' 字符）')
  t.noThrow(() => N.renderForPrompt(snap, 0), 'max=0 不崩')
  t.noThrow(() => N.renderForPrompt(snap, 1e9), '超大的 max 不崩')
}

// ── 新鲜度 ──
{
  const now = Date.now()
  // ⚠️ isFresh 不只看时间，还要求**有条目**（抓过但一条都没抓到不算新鲜）。
  //    第一版只给了 at，于是"1 分钟前"被判成不新鲜 —— 那是我的桩不完整。
  const fresh = { at: now - 60000, items: [{ title: '一条' }] }
  const stale = { at: now - 48 * 3600000, items: [{ title: '一条' }] }
  t.eq(N.isFresh(fresh, now), true, '1 分钟前 + 有条目 → 新鲜')
  t.eq(N.isFresh(stale, now), false, '48 小时前算过期')
  t.eq(N.isFresh({ at: now - 60000 }, now), false, '只有时间、一条都没抓到 → 不算新鲜')
  t.eq(N.isFresh({ at: now - 60000, items: [] }, now), false, '空 items → 不算新鲜')
  t.near(N.ageMinutes(fresh, now), 1, 0.2, 'ageMinutes 算得对')
  t.eq(N.NEWS_FRESH_MS / 3600000, 24, '新鲜窗口 24 小时')
  t.noThrow(() => N.isFresh(null, now), 'null 不崩')
  t.noThrow(() => N.ageMinutes({}, now), '空对象不崩')
}

// ── 源列表管理 ──
{
  const n = N.blankNews()
  const before = n.sources.length
  N.addSource(n, 'https://a.com/feed.xml', 'A')
  t.eq(n.sources.length, before + 1, '加源 +1')
  const id = n.sources[n.sources.length - 1].id
  N.removeSource(n, id)
  t.eq(n.sources.length, before, '删源 -1')
  N.removeSource(n, '不存在的 id')
  t.eq(n.sources.length, before, '删不存在的 id 不报错也不减')
  N.addSource(n, 'https://a.com/feed.xml')
  N.addSource(n, 'https://a.com/feed.xml')
  const same = n.sources.filter((s) => s.url === 'https://a.com/feed.xml')
  t.lt(same.length, 3, '同一个网址不会无限重复添加（' + same.length + ' 个）')
}

t.done()

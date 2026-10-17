/**
 * dsh-mood — 设置页「心情日记」（Client 半边）
 *
 * 以 dsh.client bundle 格式加载：注册 settings.section「心情日记」页。
 * 数据走宿主注册的 HTTP 前缀路由 /dsh-mood-api（读当前心情 + 日记列表）。
 *
 * ⚠️ 注册 id 必须等于 loader entry 名（dsh-mood），否则 ModuleLoader 会报
 *    "loaded without registering dsh-mood"。
 */
window.__ModuleLoader__.load({
  id: 'dsh-mood',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')

    // 这里**故意没有 portal / 没有浮层**。
    //
    // 试过 `position: fixed` 的遮罩对话框，踩了两个坑：
    //   1. 设置弹窗外层带 transform 时，fixed 会变成相对那个祖先 —— 遮罩被挤进面板里
    //   2. 用 createPortal 挂到 document.body 躲开它 —— 但那是**明令禁止的**
    //      （DSH 插件规范：「Do not replace the app root or append a second application
    //      to `document.body`」），而且节点一脱离 .dshmood 树，所有后代选择器都不匹配了
    //
    // 所以改成**面板内联的详情卡片**：留在自己的 slot 里，不碰 body，
    // 不依赖 fixed，也就不存在"祖先有 transform 就失效"这件事。**没有失败的可能。**
    const CSS = [
      '.dshmood{display:flex;flex-direction:column;gap:14px;padding:4px 0;font-size:13px;color:var(--dsw-alias-label-primary)}',
      // 页头：黑线条书本图标 + 标题
      '.dshmood .page-hd{display:flex;align-items:center;gap:10px;padding-bottom:2px}',
      '.dshmood .page-hd .book-icon{flex:none;color:var(--dsw-alias-label-primary)}',
      '.dshmood .page-hd .page-title{font-size:15px;font-weight:600;line-height:1}',
      '.dshmood .page-hd .page-sub{font-size:12px;color:var(--dsw-alias-label-secondary);line-height:1}',
      '.dshmood .hd{display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
      '.dshmood .mood-name{font-size:16px;font-weight:600}',
      '.dshmood .pill{font-size:11px;border-radius:999px;padding:2px 10px;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 14%,transparent);color:var(--dsw-alias-brand-primary)}',
      '.dshmood .bars{display:flex;flex-direction:column;gap:4px;margin-top:2px}',
      '.dshmood .bar-row{display:grid;grid-template-columns:52px 1fr 42px;align-items:center;gap:8px;font-size:12px}',
      '.dshmood .bar{height:6px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);overflow:hidden}',
      '.dshmood .bar>i{display:block;height:100%;border-radius:999px;background:var(--dsw-alias-brand-primary);transition:width .3s ease}',
      '.dshmood .bar-row .v{text-align:right;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}',
      '.dshmood .bar-row.on .lbl{font-weight:600;color:var(--dsw-alias-brand-primary)}',
      '.dshmood .tools{display:flex;gap:8px;align-items:center;flex-wrap:wrap}',
      '.dshmood button{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:5px 12px;font-size:13px;cursor:pointer}',
      '.dshmood button:hover{border-color:var(--dsw-alias-brand-primary)}',
      '.dshmood button:disabled{opacity:.5;cursor:default}',
      '.dshmood .notice{padding:7px 12px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.dshmood .list{display:flex;flex-direction:column;gap:10px;max-height:56vh;overflow:auto;padding-right:4px}',
      '.dshmood .entry{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);padding:10px 12px}',
      '.dshmood .entry .date{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--dsw-alias-label-secondary);margin-bottom:6px}',
      '.dshmood .entry .date b{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600}',
      '.dshmood .entry .text{white-space:pre-wrap;line-height:1.65}',
      '.dshmood .empty{color:var(--dsw-alias-label-secondary);padding:22px;text-align:center;border:1px dashed var(--dsw-alias-border-l1);border-radius:10px}',
      // 来源管理（用户自己加网址 / 删来源）
      '.dshmood .srcrow{display:flex;gap:8px;align-items:center;flex-wrap:wrap}',
      '.dshmood .srcin{flex:1;min-width:220px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:6px 10px;font-size:13px;outline:none}',
      '.dshmood .srcin:focus{border-color:var(--dsw-alias-brand-primary)}',
      '.dshmood .srcin::placeholder{color:var(--dsw-alias-label-secondary);opacity:.8}',
      '.dshmood .srcin-sm{flex:0 0 150px;min-width:110px}',
      '.dshmood .srchint{font-size:12px;color:var(--dsw-alias-label-secondary);line-height:1.6}',
      '.dshmood .pill-x{margin-left:6px;padding:0 5px;font-size:12px;line-height:1.4;border-radius:5px;background:transparent;border:none;color:var(--dsw-alias-label-secondary);cursor:pointer}',
      '.dshmood .pill-x:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2)}',
      '.dshmood .entry .tag{margin-left:2px;padding:1px 6px;border-radius:5px;font-size:11px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1)}',
      '.dshmood .entry .tag.warn{opacity:.85}',
      '.dshmood .entry .excerpt{margin-top:6px;font-size:12px;line-height:1.65;color:var(--dsw-alias-label-secondary);border-left:2px solid var(--dsw-alias-border-l1);padding-left:8px}',
      '.dshmood .entry .excerpt.cmt{opacity:.9;border-left-style:dashed}',
      // 主动开口的闸门清单
      '.dshmood .gates{display:flex;flex-direction:column;gap:2px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:8px 10px;background:var(--dsw-alias-bg-layer-1)}',
      '.dshmood .gate{display:flex;align-items:center;gap:8px;font-size:12px;line-height:1.9;opacity:.55}',
      '.dshmood .gate.on{opacity:1}',
      '.dshmood .gate-dot{width:10px;flex:0 0 10px;color:var(--dsw-alias-label-secondary)}',
      '.dshmood .gate.on .gate-dot{color:#3fae5a}',
      '.dshmood .gate-name{flex:0 0 92px;font-weight:600}',
      '.dshmood .gate-note{color:var(--dsw-alias-label-secondary)}',
      // 存储那一行（折进各面板页脚，带插件名 —— 免得跟别的插件搞混）
      '.dshmood .storebar{margin-top:2px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);overflow:hidden}',
      '.dshmood .storeline{display:flex;align-items:center;gap:8px;padding:7px 12px;font-size:12px}',
      '.dshmood .storeown{flex:0 0 auto;font-weight:600;padding:1px 7px;border-radius:5px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1)}',
      '.dshmood .storepath{flex:1;color:var(--dsw-alias-label-secondary);word-break:break-all;font-family:ui-monospace,Consolas,monospace;font-size:11.5px}',
      '.dshmood .storetoggle{padding:2px 9px;font-size:12px;border-radius:6px}',
      // 存储：一个文件一行
      '.dshmood .storerow+.storerow{border-top:1px solid var(--dsw-alias-border-l1)}',
      '.dshmood .storelab{flex:0 0 auto;font-size:12px;color:var(--dsw-alias-label-primary);font-weight:600}',
      '.dshmood .storebadge{flex:0 0 auto;font-size:11px;padding:0 6px;border-radius:5px;opacity:.6;border:1px solid var(--dsw-alias-border-l1)}',
      '.dshmood .storebadge.on{opacity:1;border-color:var(--dsw-alias-brand-primary)}',
      '.dshmood .storebody{display:flex;flex-direction:column;gap:8px;padding:10px 12px;border-top:1px solid var(--dsw-alias-border-l1)}',
      // 数值条的分组标题（基础情绪 / 复合情绪 / 当代说法）
      '.dshmood .grp{display:flex;align-items:center;gap:8px;margin:12px 0 6px;padding-bottom:5px;border-bottom:1px solid var(--dsw-alias-border-l1)}',
      '.dshmood .grp:first-child{margin-top:2px}',
      '.dshmood .grpn{font-size:13px;font-weight:600;color:var(--dsw-alias-brand-primary)}',
      '.dshmood .grpc{font-size:11px;color:var(--dsw-alias-label-secondary)}',
      // 人设面板的表单
      '.dshmood .pform{display:flex;flex-direction:column;gap:14px}',
      '.dshmood .pfield{display:flex;flex-direction:column;gap:6px}',
      '.dshmood .plab{font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.dshmood .pta{min-height:64px;resize:vertical;font-family:inherit;line-height:1.6}',
      '.dshmood .hintline{font-size:12px;line-height:1.7;color:var(--dsw-alias-label-secondary)}',
      // 硬盘记忆面板
      '.dshmood .memstats{display:grid;grid-template-columns:repeat(auto-fit,minmax(90px,1fr));gap:10px;margin:14px 0}',
      '.dshmood .memstat{display:flex;flex-direction:column;gap:2px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px}',
      '.dshmood .memstat .v{font-size:19px;font-weight:700;font-variant-numeric:tabular-nums}',
      '.dshmood .memstat .k{font-size:11px;color:var(--dsw-alias-label-secondary)}',
      '.dshmood .memrow{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:10px 0}',
      '.dshmood .memlab{font-size:12px;color:var(--dsw-alias-label-secondary);min-width:64px}',
      '.dshmood .memnum{flex:none;width:88px;text-align:right}',
      '.dshmood .mempath{flex:1;min-width:200px;font-size:12px;padding:6px 10px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dshmood button.danger{color:#e5534b;border-color:#e5534b55}',
      // 品味面板 —— ⚠️ 别拿"硬盘记忆"的 memrow/srcin 去套。
      //    那两个是给"路径 / 关键词"这种短东西用的（srcin 是 flex:1;min-width:220px），
      //    套到「一条完整的原则」上会把正文压成一条看不全的小框 —— 而看不全就没法改。
      //    实测就是这样，所以这里单开一套。
      // 组标题**长得和 memlisthd 一样**（灰底条）—— 不然一眼就看出是外来的
      // 两份之间的分界（你的口味 / 我的品味）—— 比组标题重一档，
      // 因为那是**结构**，组标题只是"谁说的"。
      '.dshmood .thalf{margin:18px 0 10px;padding-bottom:6px;border-bottom:1px solid var(--dsw-alias-border-l1);font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.dshmood .thalf:first-child{margin-top:6px}',
      '.dshmood .tghd{font-size:12px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-bottom:none;border-radius:10px 10px 0 0;padding:8px 12px;margin:14px 0 0}',
      '.dshmood .tcard{border:1px solid var(--dsw-alias-border-l1);border-top:none;border-radius:0;padding:9px 12px;margin:0}',
      '.dshmood .tcard:last-child{border-radius:0 0 10px 10px;margin-bottom:10px}',
      '.dshmood .tcard textarea,.dshmood .tcard input{width:100%;box-sizing:border-box;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:6px 9px;font-size:12.5px;line-height:1.6;font-family:inherit;outline:none;resize:vertical}',
      '.dshmood .tcard textarea{min-height:38px}',
      '.dshmood .tcard textarea:focus,.dshmood .tcard input:focus{border-color:var(--dsw-alias-brand-primary)}',
      '.dshmood .tcard .trow{display:flex;gap:8px;align-items:center;margin-top:7px;flex-wrap:wrap}',
      '.dshmood .tcard .tnote{font-size:11.5px;color:var(--dsw-alias-label-secondary);line-height:1.6;margin-top:5px}',
      '.dshmood .tcard .tsp{flex:1}',
      // 主动开口的时段选择
      '.dshmood .slotbox{margin:14px 0;padding:12px 14px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px}',
      '.dshmood .slothead{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px}',
      '.dshmood .slottitle{font-size:13px;font-weight:600}',
      '.dshmood .slotnote{font-size:12px;color:var(--dsw-alias-label-secondary);flex:1;min-width:120px}',
      '.dshmood .slots{display:grid;grid-template-columns:repeat(auto-fit,minmax(104px,1fr));gap:8px}',
      '.dshmood .slotchecks{display:flex;flex-direction:column;gap:6px}',
      '.dshmood .slotchk{display:flex;align-items:center;gap:9px;padding:9px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;cursor:pointer;font-size:13px}',
      '.dshmood .slotchk:hover{border-color:var(--dsw-alias-brand-primary)}',
      '.dshmood .slotchk.on{background:#13241a;border-color:#2ea043}',
      '.dshmood .slotchk.now{box-shadow:0 0 0 1px var(--dsw-alias-brand-primary) inset}',
      '.dshmood .slotchk input[type=checkbox]{width:15px;height:15px;accent-color:#2ea043;cursor:pointer;flex:none}',
      '.dshmood .slotchk .slotkind{width:20px;height:20px;line-height:20px;flex:none}',
      '.dshmood .slotchk .slotname{font-weight:600;flex:none;min-width:3em}',
      '.dshmood .slot{display:flex;align-items:center;gap:6px;padding:8px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:transparent;cursor:pointer;font-size:12.5px;color:var(--dsw-alias-label-primary)}',
      '.dshmood .slot:hover{border-color:var(--dsw-alias-brand-primary)}',
      '.dshmood .slot.on{background:#13241a;border-color:#2ea043}',
      '.dshmood .slot.now{box-shadow:0 0 0 1px var(--dsw-alias-brand-primary) inset}',
      '.dshmood .slotkind{flex:none;width:18px;height:18px;line-height:18px;text-align:center;border-radius:4px;font-size:11px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}',
      '.dshmood .slotkind.k峰{background:#3a2a12;color:#e3b341}',
      '.dshmood .slotkind.k谷{background:#12202e;color:#58a6ff}',
      '.dshmood .slotname{flex:1;text-align:left}',
      '.dshmood .slothours{font-size:11px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}',
      '.dshmood .slotnow{font-size:10px;color:var(--dsw-alias-brand-primary)}',
      '.dshmood .memlist{margin-top:14px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;overflow:hidden}',
      '.dshmood .memlisthd{padding:8px 12px;font-size:12px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2)}',
      '.dshmood .memline{display:flex;gap:8px;align-items:baseline;padding:7px 12px;border-top:1px solid var(--dsw-alias-border-l1);font-size:12.5px}',
      '.dshmood .memwho{flex:none;padding:1px 7px;border-radius:999px;font-size:11px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}',
      '.dshmood .memwho.me{color:var(--dsw-alias-brand-primary)}',
      '.dshmood .memt{flex:none;font-size:11px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}',
      '.dshmood .memx{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      // （旧的"日期输入框 + 月份小标签"那套 CSS 已删 —— 换成下面的日历了）
      // ── 日历式日记浏览 ──
      // 为什么要有它：日记攒多了，一条条往下堆会让右侧滚动条缩成头发丝。
      // 按月分组、每天一个格子 —— 一个月最多 31 格，高度有上限。
      '.dshmood .cal{display:flex;flex-direction:column;gap:12px;max-height:52vh;overflow:auto;padding-right:4px}',
      '.dshmood .calmonth{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);padding:9px 11px}',
      '.dshmood .calhead{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:8px}',
      '.dshmood .calym{font-size:13px;font-weight:600}',
      '.dshmood .calcount{font-size:11px;color:var(--dsw-alias-label-secondary)}',
      '.dshmood .caldays{display:flex;flex-wrap:wrap;gap:6px}',
      '.dshmood .calday{display:flex;flex-direction:column;align-items:center;gap:1px;min-width:40px;padding:4px 7px;border-radius:8px;line-height:1.15}',
      '.dshmood .calday.on{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-2)}',
      '.dshmood .cald{font-size:14px;font-weight:600}',
      '.dshmood .calmood{font-size:10px;color:var(--dsw-alias-label-secondary)}',
      // ── 日记详情卡片（内联，不是浮层）──
      // 不用 fixed 遮罩：设置弹窗外层带 transform 时它会被挤进面板里；
      // 用 portal 挂 body 又违反插件规范。所以就在面板里当一张卡片。
      '.dshmood .dlg{display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-left:3px solid var(--dsw-alias-brand-primary);border-radius:10px;overflow:hidden}',
      '.dshmood .dlg .dlgbody{max-height:34vh}',
      '.dshmood .dlghd{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:12px 14px;border-bottom:1px solid var(--dsw-alias-border-l1)}',
      '.dshmood .dlgdate{font-size:15px;font-weight:600}',
      '.dshmood .dlgmeta{font-size:12px;color:var(--dsw-alias-label-secondary);margin-top:2px}',
      '.dshmood .dlgx{padding:3px 10px;font-size:12px}',
      '.dshmood .dlgbody{padding:14px;overflow:auto;line-height:1.8;font-size:13px}',
      '.dshmood .dlgline{white-space:pre-wrap;min-height:1px}',
      '.dshmood .dlgfoot{display:flex;justify-content:space-between;gap:8px;padding:10px 14px;border-top:1px solid var(--dsw-alias-border-l1)}',
      // （旧的 .month / .month.on 已删 —— 日历改版后没人用了）
      // 存储位置
      '.dshmood .dirbox{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:10px 12px;background:var(--dsw-alias-bg-layer-1)}',
      '.dshmood .dirnow{font-family:ui-monospace,Consolas,monospace;font-size:13px;word-break:break-all;line-height:1.6}',
      '.dshmood .dirhint{font-size:12px;color:var(--dsw-alias-label-secondary);margin-top:4px;word-break:break-all}',
      '.dshmood .notice.bad{border-color:#b4453f}',
      '.dshmood .notice.good{border-color:#3fae5a}',
      // 锁着时的面板
      '.dshmood .locked{display:flex;flex-direction:column;align-items:center;gap:8px;padding:30px 20px;border:1px dashed var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);text-align:center}',
      '.dshmood .locked .lock-icon{color:var(--dsw-alias-label-secondary);opacity:.75;margin-bottom:2px}',
      '.dshmood .locked .lock-title{font-size:14px;font-weight:600}',
      '.dshmood .locked .lock-body{font-size:12px;color:var(--dsw-alias-label-secondary);max-width:420px;line-height:1.6}',
      '.dshmood button:disabled{opacity:.45;cursor:not-allowed}',
      // 日记解不开时的告警条 —— 要显眼（红边），因为这一条会让人误以为"日记丢了"
      '.dshmood .dwarn{margin:0 0 14px;padding:12px 14px;border:1px solid #c0392b;border-left-width:4px;border-radius:8px;background:rgba(192,57,43,.07);font-size:12px;line-height:1.75}',
      '.dshmood .dwarn .dwarn-t{font-size:13px;font-weight:700;margin-bottom:4px;color:#c0392b}',
      '.dshmood .dwarn .dwarn-p{margin-top:4px;font-family:ui-monospace,Consolas,monospace;font-size:11px;color:var(--dsw-alias-label-secondary);word-break:break-all}',
    ].join('\n')

    const API = '/dsh-mood-api'

    /**
     * 合上的黑线条书本（Lucide "book" 轮廓：纯描边、无填充）。
     * 用 currentColor 而不是写死 #000 —— 深色主题下写死黑色就看不见了；
     * 浅色主题下 currentColor 就是黑，符合"黑线条"。
     */
    function BookIcon(props) {
      const p = props || {}
      return React.createElement('svg', {
        width: p.size || 20,
        height: p.size || 20,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.7,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        className: 'book-icon',
        'aria-hidden': 'true',
      },
        React.createElement('path', { key: 'a', d: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20' }),
        React.createElement('path', { key: 'b', d: 'M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z' }),
      )
    }

    /** 合上的书本用的两个 path（DOM 替换时复用） */
    const BOOK_CLOSED_D = [
      'M4 19.5A2.5 2.5 0 0 1 6.5 17H20',
      'M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z',
    ]

    /** 张开的书本（Lucide "book-open"：两页镜像） */
    const BOOK_OPEN_D = [
      'M12 7v14',
      'M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z',
    ]

    /**
     * 黑线条报纸 —— 时事那一格用。
     * 与书本同一套参数（Lucide 轮廓 / 1.7 描边 / currentColor / 圆头圆角），
     * 摆在一起才像一家人。
     */
    const NEWS_D = [
      'M15 18h-5',
      'M18 14h-8',
      'M10 6h8v4h-8V6Z',
      'M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2',
    ]

    /**
     * 黑线条硬盘 —— 存储位置那格用。
     * 为什么是硬盘不是文件夹：这件事的痛点是"哪个盘"，不是"哪个目录"。
     * 它也是个密实的横向块，和书、报纸、举手同一个重量。
     */
    const STORE_D = [
      'M22 12H2',
      'M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z',
      'M6 16h.01',
      'M10 16h.01',
    ]
    // 人设：一个线条人（头 + 肩），和别的图标同一套描边参数
    // 硬盘记忆：一个方块叠一个方块（像磁盘）
    const MEMORY_D = ['M4 5.5h16v4H4z', 'M4 14.5h16v4H4z', 'M7.5 7.5h1M7.5 16.5h1']
    const PERSONA_D = ['M12 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z', 'M4.5 20c0-3.1 3.2-5.3 7.5-5.3s7.5 2.2 7.5 5.3']
    /**
     * 品味：一只眼睛。
     *
     * 为什么是眼睛而不是调色板/星星：品味在这个项目里的意思是**你怎么看东西**
     * （注入的那段第一句就是"看东西的时候一直带着它"）。
     * 调色板说的是"颜色"，比品味窄；星星说的是"好"，比品味糊。
     * 而且眼睛这个形状在 20px 下认得出来 —— 导航图标首先要"一眼看出是哪格"。
     */
    /**
     * 经验卡：一张**索引卡**（卡 + 顶部一个凸起的标签）+ 卡上两条线。
     *
     * ⚠️ 我第一版画的是"带折角的便签"—— **而它不行**：
     *    在 20px 下那个折角只有约 4px，看不见，
     *    于是它和 NEWS（方框 + 里面几条线）**几乎分不清**。
     *    而时事（order 27）和经验卡（order 31）在导航里是**相邻两格** —— 那就成了真问题。
     *    （这是把它们九个画在一张图上看出来的。**作者那条"20px 下要认得出来"是对的判据。**）
     *
     * 改成索引卡：**卡片顶部的凸起会打断外轮廓** —— 而形状的"打断"比"角落的细节"抗缩小。
     * 这也是那套七种里没有的形状（书/报纸/硬盘/眼睛/手/方块叠方块/线条人，全是闭合轮廓）。
     */
    const PROC_D = [
      // 卡的本体（顶边被凸起打断，所以分两段画）
      'M4.5 10A2 2 0 0 1 6.5 8h2',
      'M15.5 8h2A2 2 0 0 1 19.5 10v7a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2v-7',
      // 顶部那个凸起的标签 —— **它是这个图标唯一的识别点**
      'M8.5 8V6.2A1.2 1.2 0 0 1 9.7 5h4.6a1.2 1.2 0 0 1 1.2 1.2V8',
      // 卡上两条线（长的那条就是"症状"）
      'M8.5 11.8h7',
      'M8.5 15h4',
    ]

    const TASTE_D = [
      'M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12Z',
      'M12 9.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6Z',
    ]

    function StoreIcon(props) {
      const p = props || {}
      return React.createElement('svg', {
        width: p.size || 20, height: p.size || 20, viewBox: '0 0 24 24',
        fill: 'none', stroke: 'currentColor', strokeWidth: 1.7,
        strokeLinecap: 'round', strokeLinejoin: 'round',
        className: 'book-icon', 'aria-hidden': 'true',
      }, STORE_D.map((d, i) => React.createElement('path', { key: i, d })))
    }

    /**
     * 黑线条举手 —— 主动开口那格用。
     *
     * 为什么不用话筒：话筒读起来是"录音 / 语音输入"，是个**输入设备**；
     * 而这格讲的是"它自己开口"。表意差得远，而且它又细又长，
     * 摆在实心的书和报纸旁边轻得压不住。
     *
     * 为什么不用喇叭：喇叭也合家族（都是物件），但**语气错了** ——
     * 喇叭是"我要广播"，而这个功能整个设计都是轻的：空闲够久、一天最多几次、
     * 递一句话筒过去、说不说还由那次生成自己定。用喇叭就是说话比事大。
     *
     * 为什么是举手：**"我有话想说"** —— 正好是这个功能的意思，而且它是个密实的闭合形状，
     * 和旁边的书、报纸一个重量。（试过对话气泡：小尺寸下退化成"一个圈加几个点"，太轻，
     * 尾巴也看不出来；试过方形气泡：跟报纸撞脸，都是方块里几行字。）
     */
    const TALK_D = [
      'M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2',
      'M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2',
      'M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8',
      'M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15',
    ]

    function TalkIcon(props) {
      const p = props || {}
      return React.createElement('svg', {
        width: p.size || 20, height: p.size || 20, viewBox: '0 0 24 24',
        fill: 'none', stroke: 'currentColor', strokeWidth: 1.7,
        strokeLinecap: 'round', strokeLinejoin: 'round',
        className: 'book-icon', 'aria-hidden': 'true',
      }, TALK_D.map((d, i) => React.createElement('path', { key: i, d })))
    }

    /** 报纸图标的组件版（页面头部用） */
    function NewsIcon(props) {
      const p = props || {}
      return React.createElement('svg', {
        width: p.size || 20,
        height: p.size || 20,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.7,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        className: 'book-icon',
        'aria-hidden': 'true',
      },
        NEWS_D.map((d, i) => React.createElement('path', { key: i, d })),
      )
    }

    /**
     * 张开的黑线条书本 —— 表示"小鲸同意了，可以看"。
     * 和 BookIcon 同一套描边参数，只有轮廓不同。
     */
    function BookOpenIcon(props) {
      const p = props || {}
      return React.createElement('svg', {
        width: p.size || 20,
        height: p.size || 20,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.7,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        className: 'book-icon',
        'aria-hidden': 'true',
      },
        BOOK_OPEN_D.map((d, i) => React.createElement('path', { key: i, d })),
      )
    }

    async function getJSON(path) {
      const r = await fetch(API + path, { headers: { accept: 'application/json' } })
      if (!r.ok) throw new Error('HTTP ' + r.status)
      return r.json()
    }

    /**
     * 错误边界 —— **插件永远不许把宿主界面搞白**。
     *
     * 为什么必须要有这个：React 里一个组件渲染时抛错，如果没有错误边界，
     * 它会沿着树往上找，**找不到就把整棵根树卸载** —— 表现出来就是整个界面全白。
     * 也就是说：**我的插件出一个 bug，代价是用户整个 DSH 用不了。**
     * 这个代价不对等，得挡住。
     *
     * 有了它之后，同一个 bug 的表现变成：**那一格显示一条能读的报错**，
     * 其它面板、导航、会话全都照常。
     *
     * 顺带一个好处：报错文本直接显示在界面上 —— 不用开 devtools 也知道错在哪。
     */
    class MoodErrorBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { err: null }
      }
      static getDerivedStateFromError(err) {
        return { err }
      }
      componentDidCatch(err, info) {
        // 控制台里留一份完整的栈，方便定位
        try { console.error('[dsh-mood] 面板渲染失败:', err, info) } catch { /* 不管 */ }
      }
      render() {
        if (!this.state.err) return this.props.children
        const msg = String((this.state.err && this.state.err.message) || this.state.err)
        return h('div', { className: 'dshmood' },
          h('div', { className: 'notice' },
            '这一格渲染出错了，插件没有崩掉整个界面。',
            h('br'),
            h('code', null, msg),
          ),
          h('div', { className: 'warn' },
            '把这条报错发给我就行。其它面板和会话不受影响。'),
        )
      }
    }


    /**
     * ⚠️ **工厂层的 h** —— 公共函数用得到。
     *
     * 原来每个面板各自在自己里面写 `const h = React.createElement`。
     * 那样面板内部用没问题，但**工厂层的公共函数看不见它**。
     *
     * 我加 `groupedBars` 的时候就踩了这个：函数写在工厂层、里面引用 `h`，
     * 运行时 `ReferenceError: h is not defined` —— 整个心情日记面板白屏。
     *
     * 那为什么当时没测出来？因为我的测试是这么写的：
     *     new Function('h', 'React', SRC)   ← **把 h 当参数喂进去**
     * 等于亲手把缺的那个变量补上了，于是它在比真实环境宽松的沙盒里"全过"。
     * **那是个不可能失败的测试。**
     *
     * 所以这里定义一次。面板里那几个同名的 `const h` 会**遮蔽**它，行为不变。
     */
    const h = React.createElement

    /**
     * 把"多少分钟"写成人看得懂的样子。
     *
     * ⚠️ 为什么不用「324 分」：中文里"分"**既可以是分钟也可以是分值**，
     *   有人真把它读成了"某个心情之前有 324 分"。所以 ≥60 分钟一律拆成"5 小时 24 分"。
     *   不到 60 分钟的也带上"分钟"两个字，不留歧义。
     */
    function spellMinutes(min) {
      const n = Math.max(0, Math.round(Number(min) || 0))
      if (n < 1) return '不到 1 分钟'
      if (n < 60) return n + ' 分钟'
      const h = Math.floor(n / 60)
      const m = n % 60
      return h + ' 小时' + (m ? ' ' + m + ' 分' : '')
    }

    /**
     * 把数值条按来源分组渲染。
     *
     * **分层的依据是"它从哪来"，不是"重要程度"** —— 所以组的顺序是固定的
     * （基础 → 复合 → 当代），组内才按当前分值从高到低排。
     * 这样"现在什么心情"在哪个组、离基线多远，一眼能看出来。
     *
     * 柱子的宽度用的是**全局最大值**，不是组内最大值 ——
     * 否则每个组都会被拉满，组和组之间的高低就没法比了。
     *
     * 拿不到 tiers（旧宿主）就平铺 —— 不报错，只是没了分组。
     */
    function groupedBars(ranked, tiers, max, curId) {
      const row = (r) =>
        h('div', { className: 'bar-row' + (r.id === curId ? ' on' : ''), key: r.id },
          h('span', { className: 'lbl' }, r.label),
          h('div', { className: 'bar' },
            h('i', { style: { width: Math.max(2, Math.round((r.value / Math.max(1, max)) * 100)) + '%' } })),
          h('span', { className: 'v' }, String(r.value)),
        )

      const byId = {}
      for (const r of ranked) byId[r.id] = r
      const ORDER = [
        ['basic', '基础情绪', 'Ekman 那六种 + 几个同样是"当下直接反应"的'],
        ['complex', '复合情绪', '由基础情绪组合、带认知加工 —— 爱 = 快乐+信任+依恋'],
        ['modern', '当代说法', '这代人新造的词，旧分类里没有准确对应'],
      ]
      const usable = tiers && ORDER.some(([k]) => Array.isArray(tiers[k]) && tiers[k].length)
      if (!usable) return ranked.map(row)

      const out = []
      for (const [key, label, note] of ORDER) {
        const ids = Array.isArray(tiers[key]) ? tiers[key] : []
        const items = ids.map((id) => byId[id]).filter(Boolean).sort((a, b) => b.value - a.value)
        if (!items.length) continue
        out.push(h('div', { className: 'grp', key }, h('span', { className: 'grpn' }, label),
          h('span', { className: 'grpc' }, String(items.length))), ...items.map(row))
      }
      return out
    }

    function DiaryPanel() {
      const h = React.createElement
      const [data, setData] = React.useState(null)
      const [err, setErr] = React.useState('')

      const load = React.useCallback(async () => {
        try {
          const d = await getJSON('/state')
          setData(d)
          setErr('')
          // 授权状态同步给导航图标：同意的变成张开的书本
          refreshNavIcon(!!(d && d.unlocked))
        } catch (e) {
          setErr(String((e && e.message) || e))
        }
      }, [])

      React.useEffect(() => {
        load()
        const t = setInterval(load, 30000)
        return () => clearInterval(t)
      }, [load])

      // 日记排序：默认**从新到旧，从上到下**。用户可以自己翻过来。
      // 存 localStorage，刷新后保持。
      const [newestFirst, setNewestFirst] = React.useState(() => {
        try { return localStorage.getItem('dsh-mood:diary-order') !== 'asc' } catch { return true }
      })
      const toggleOrder = () => {
        setNewestFirst((v) => {
          const next = !v
          try { localStorage.setItem('dsh-mood:diary-order', next ? 'desc' : 'asc') } catch {}
          return next
        })
      }

      // 日记浏览：**日历式**。
      //   · openDate 非空 → 那一天在日历里高亮，并弹出正文明细
      // 换掉长列表的原因：攒到几百篇时右侧滚动条会缩成头发丝，根本翻不动。
      // 按月分组、每天一个格子，高度就有上限了 —— 一个月最多 31 格。
      const [openDate, setOpenDate] = React.useState('')
      // 那一天的正文。**点开才去取** —— 列表里只带日期和心情。
      // 这样攒到几百篇也能全带上，不会被截断（以前 /state 只发最近 120 篇）。
      const [openEntry, setOpenEntry] = React.useState(null)

      React.useEffect(() => {
        if (!openDate) { setOpenEntry(null); return }
        let alive = true
        setOpenEntry({ date: openDate, moodLabel: '', text: '读取中…' })
        getJSON('/diary?date=' + encodeURIComponent(openDate))
          .then((r) => { if (alive) setOpenEntry(r) })
          .catch((e) => {
            if (alive) setOpenEntry({ date: openDate, moodLabel: '', text: '读不到：' + ((e && e.message) || e) })
          })
        return () => { alive = false }
      }, [openDate])

      // Esc 关掉对话框
      React.useEffect(() => {
        if (!openDate) return
        const onKey = (e) => { if (e.key === 'Escape') setOpenDate('') }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [openDate])

      // 注意：这里**没有**"手动补生成"的入口。
      // 日记只能由宿主在每天 23:59 自动生成 —— 用户点不出来，模型也写不了。
      // 所以工具条上只剩「刷新」和排序切换。

      if (err) {
        return h('div', { className: 'dshmood' },
          h('div', { className: 'notice' }, '读不到数据：' + err + '（宿主插件可能没加载）'),
        )
      }
      if (!data) {
        return h('div', { className: 'dshmood' }, h('div', { className: 'notice' }, '加载中…'))
      }

      const ranked = Array.isArray(data.ranked) ? data.ranked : []
      const rawDiaries = Array.isArray(data.diaries) ? data.diaries : []
      // 宿主按日期倒序给；asc 时在客户端翻过来（不改宿主数据）
      const ordered = newestFirst ? rawDiaries : rawDiaries.slice().reverse()
      const max = ranked.length ? ranked[0].value : 100
      const unlocked = !!data.unlocked

      // ── 日历分组：年-月 → 该月那些天 ──
      // 月份从**实际有日记的日期**里现算，不写死任何年份。
      const grouped = (() => {
        if (!unlocked) return []
        const byMonth = new Map()
        for (const e of ordered) {
          const m = String(e.date).slice(0, 7)
          if (!byMonth.has(m)) byMonth.set(m, [])
          byMonth.get(m).push(e)
        }
        return [...byMonth.entries()]
          .sort((a, b) => (newestFirst ? b[0].localeCompare(a[0]) : a[0].localeCompare(b[0])))
          .map(([month, list]) => {
            const [y, mo] = month.split('-')
            return {
              month,
              label: `${y} 年 ${Number(mo)} 月`,
              list: newestFirst ? list : list.slice().reverse(),
            }
          })
      })()

      // ── 对话框要用的：打开的是哪一篇，以及它的前后一天 ──
      // 「前后」按**日期的自然顺序**，不跟着列表排序翻 —— 顺着读日历比跟着排序直觉。
      // byDate 只用来算"前后一天"—— 它现在只有元信息（日期/心情），正文不在这儿
      const byDate = new Map(rawDiaries.map((e) => [e.date, e]))
      const asc = rawDiaries.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)))
      const openIdx = openDate ? asc.findIndex((e) => e.date === openDate) : -1
      const prevEntry = openIdx > 0 ? asc[openIdx - 1] : null
      const nextEntry = openIdx >= 0 && openIdx < asc.length - 1 ? asc[openIdx + 1] : null

      return h('div', { className: 'dshmood' },
        // 页头：书本图标 —— 未授权是合上的，授权后张开
        h('div', { className: 'page-hd' },
          unlocked ? h(BookOpenIcon, { size: 22 }) : h(BookIcon, { size: 22 }),
          h('span', { className: 'page-title' }, '心情日记'),
          h('span', { className: 'page-sub' },
            unlocked
              ? '小鲸同意你看了'
              : '锁着 · 每天 ' + (data.generateAt || '23:59') + ' 自动生成'),
        ),
        // ⚠️ **日记文件解不开的时候，必须顶在最上面说。**
        //
        //    不然这一页显示的是"0 篇"，人会以为日记丢了或者根本没写 ——
        //    而真相是：**内容一个字没丢，就在盘上，只是密钥对不上**（或者文件被改过）。
        //    而且写盘已经被拒绝了，不说的话就成了最坏那种"看着在存、其实没存"。
        data.diaryUnreadable
          ? h('div', { className: 'dwarn' },
              h('div', { className: 'dwarn-t' }, '⚠️ 日记文件解不开'),
              h('div', null, '两种可能：密钥被换过，或者文件被改过。'),
              h('div', null, h('b', null, '内容一个字没丢'), ' —— 就在盘上，只是开不了。'),
              h('div', null, '已经', h('b', null, '停止写入了'),
                '：不然这次保存会把真日记覆盖掉，而且不可逆。'),
              h('div', { className: 'dwarn-p' }, '密钥：' + (data.diaryKeyFile || '（未知）')),
              h('div', { className: 'dwarn-p' }, '日记：' + (data.diaryFile || '（未知）')))
          : null,
        // 当前心情
        h('div', { className: 'hd' },
          h('span', { className: 'mood-name' }, (data.current && data.current.mixLabel) || '—'),
          data.mixed && data.mixed.length
            ? h('span', { className: 'pill' }, '混合态 · 主导 ' + ((data.current && data.current.primaryLabel) || ''))
            : null,
          // ⚠️ 别写「324 分」—— 中文里"分"既可以是分钟也可以是分值，
          //    有人真把它读成了"某个心情有 324 分"。所以一律写成"5 小时 24 分"。
          data.sinceSwitchMin != null
            ? h('span', { className: 'pill' }, '距上次切换 ' + spellMinutes(data.sinceSwitchMin))
            : null,
          data.nextPeriodicMin != null
            ? h('span', { className: 'pill' }, '下次判定约 ' + spellMinutes(data.nextPeriodicMin) + '后')
            : null,
        ),
        // 数值条**按来源分三层**显示：基础情绪 / 复合情绪 / 当代说法。
        //
        // 分层的依据不是"重要程度"，是**它从哪来**（见 index.js 的 MOOD_TIERS）：
        //   基础 —— Ekman 那六种 + 几个同样是"当下直接反应"的
        //   复合 —— 由基础组合、带认知加工（爱 = 快乐+信任+依恋）
        //   当代 —— 这代人新造的词，旧分类里没有准确对应
        //
        // 层信息由 /state 的 tiers 给；拿不到就退回平铺（旧宿主也能跑）。
        h('div', { className: 'bars' },
          ...groupedBars(ranked, data.tiers, max, data.current && data.current.id),
        ),

        // 工具条
        h('div', { className: 'tools' },
          h('button', { onClick: load }, '刷新'),
          // 排序：默认新→旧（从上到下）。点一下翻过来。锁着时没意义，禁掉。
          h('button', {
            onClick: toggleOrder,
            disabled: !unlocked,
            title: unlocked ? '切换日记排列顺序' : '要先得到小鲸同意',
          }, newestFirst ? '↓ 新 → 旧' : '↑ 旧 → 新'),
          h('span', { className: 'pill' }, '共 ' + (data.count || 0) + ' 篇'),
          h('span', { className: 'pill' }, '每天 ' + (data.generateAt || '23:59') + ' 自动生成'),
          // 加密状态说出来 —— 不然"锁着"只等于"界面不给看"，文件在盘上还是明文
          data.diaryEncrypted
            ? h('span', {
                className: 'pill',
                title: 'AES-256-GCM。密钥：' + (data.diaryKeyFile || '') +
                  '\n⚠️ 防的是「顺手看到」和「备份/同步带走」；不防一个能读你整块磁盘的人（密钥就在隔壁）。',
              }, '文件加密 ✓')
            : null,
        ),

        // 点开的那一天 —— **面板内联的详情卡片**（不是浮层，见文件顶部说明）。
        // 放在日历之前：这样它一定在视野里，不用滚。
        openEntry
          ? h('div', { className: 'dlg' },
              h('div', { className: 'dlghd' },
                h('div', null,
                  h('div', { className: 'dlgdate' }, openEntry.date),
                  h('div', { className: 'dlgmeta' },
                    (openEntry.moodLabel || (data.moodLabels || {})[openEntry.mood] || '—') +
                    (openEntry.edited ? ' · 手写' : '')),
                ),
                h('button', { className: 'dlgx', onClick: () => setOpenDate('') }, '收起'),
              ),
              // 正文**按行拆开渲染**，不靠 CSS 的 white-space。
              // 原来直接塞一整个字符串、指望 pre-wrap 把 \n 变成换行 ——
              // 但 CSS 是"只注入一次"的，改了不一定生效（见挂载那段），
              // 结果正文会挤成一坨。拆成一行一个 div 就没这个依赖了。
              h('div', { className: 'dlgbody' },
                ...String(openEntry.text).split('\n').map((line, i) =>
                  h('div', { className: 'dlgline', key: i }, line || '\u00a0')),
              ),
              h('div', { className: 'dlgfoot' },
                h('button', {
                  disabled: !prevEntry,
                  onClick: () => setOpenDate(prevEntry ? prevEntry.date : ''),
                }, '← 早一天'),
                h('button', {
                  disabled: !nextEntry,
                  onClick: () => setOpenDate(nextEntry ? nextEntry.date : ''),
                }, '晚一天 →'),
              ),
            )
          : null,

        // 按日期翻，不再是一条条往下堆。
        //
        // 为什么改：日记攒多了以后，右侧滚动条会缩成头发丝 —— 几百篇堆在一列里
        // 根本翻不动。现在**按月分组、每天一个按钮**，点开看正文。
        // 一个月再多也就 31 个格子，高度是有上限的。
        unlocked
          ? h('div', { className: 'cal' },
              grouped.length
                ? grouped.map((g) => h('div', { className: 'calmonth', key: g.month },
                    h('div', { className: 'calhead' },
                      h('span', { className: 'calym' }, g.label),
                      h('span', { className: 'calcount' }, g.list.length + ' 篇'),
                    ),
                    h('div', { className: 'caldays' },
                      ...g.list.map((e) => h('button', {
                        key: e.date,
                        className: 'calday' + (openDate === e.date ? ' on' : ''),
                        title: e.date + '（' + (e.moodLabel || (data.moodLabels || {})[e.mood] || '—') + '）',
                        onClick: () => setOpenDate(e.date),
                      },
                        h('span', { className: 'cald' }, String(Number(String(e.date).slice(8, 10)))),
                        h('span', { className: 'calmood' }, (e.moodLabel || (data.moodLabels || {})[e.mood] || '').slice(0, 2)),
                      )),
                    ),
                  ))
                : h('div', { className: 'empty' }, '还没有日记。今天 ' + (data.generateAt || '23:59') + ' 会生成第一篇。'),
            )
          : h('div', { className: 'locked' },
              h('div', { className: 'lock-icon' }, h(BookIcon, { size: 34 })),
              h('div', { className: 'lock-title' }, '这本日记锁着'),
              h('div', { className: 'lock-body' },
                (data.lockedReason || '日记归小鲸所有，要她同意才能看。') +
                (data.count ? `（已经写了 ${data.count} 篇。）` : '（还没写过。）')),
              h('div', { className: 'lock-body' }, '想看就当面问小鲸 —— 她同意的话，这本书就会翻开。'),
            ),

        h(StorageBar, { keys: ['state', 'diary'] }),
      )
    }


    /**
     * 「人设」面板 —— **只在没有别的插件管人设时才会被注册**。
     *
     * 有别人管的时候，这一格连导航项都不出现（见下面那段条件注册）。
     * 不是"显示但禁用"，是**根本不注册** —— 一个不生效的设置项摆在那儿，
     * 比不摆更糟：用户会以为自己改的是生效的那份。
     */
    function PersonaPanel({ ctx }) {
      const [data, setData] = React.useState(null)
      const [err, setErr] = React.useState('')
      const [msg, setMsg] = React.useState('')
      const [f, setF] = React.useState({ selfName: '', userName: '', stance: '', tone: '', enabled: true })

      const load = React.useCallback(async () => {
        try {
          const d = await getJSON('/persona')
          setData(d)
          setErr('')
          if (d.own) {
            setF({
              selfName: d.own.selfName || '', userName: d.own.userName || '',
              stance: d.own.stance || '', tone: d.own.tone || '',
              enabled: d.own.enabled !== false,
            })
          }
        } catch (e) { setErr(String((e && e.message) || e)) }
      }, [])
      React.useEffect(() => { load() }, [load])

      const save = async () => {
        try {
          const r = await fetch(API + '/persona', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-dsh-mood': '1' },
            body: JSON.stringify(f),
          })
          const j = await r.json()
          if (!j.ok) throw new Error(j.error || ('HTTP ' + r.status))
          setMsg('已保存')
          setTimeout(() => setMsg(''), 2500)
          await load()
        } catch (e) { setMsg('保存失败：' + ((e && e.message) || e)) }
      }

      if (err) return h('div', { className: 'dshmood' }, h('div', { className: 'notice' }, '读不到：' + err))
      if (!data) return h('div', { className: 'dshmood' }, h('div', { className: 'notice' }, '加载中…'))

      const field = (key, label, ph, rows) =>
        h('div', { className: 'pfield' },
          h('div', { className: 'plab' }, label),
          rows
            ? h('textarea', { className: 'srcin pta', rows, placeholder: ph, value: f[key], onChange: (e) => setF({ ...f, [key]: e.target.value }) })
            : h('input', { className: 'srcin', placeholder: ph, value: f[key], onChange: (e) => setF({ ...f, [key]: e.target.value }) }),
        )

      return h('div', { className: 'dshmood' },
        h('div', { className: 'page-hd' },
          h('span', { className: 'page-title' }, '人设'),
          h('span', { className: 'page-sub' }, '没有别的插件管人设，所以这一份是生效的'),
        ),
        h('div', { className: 'notice' },
          '这一格只在**没有别的插件提供人设**时出现。一旦装了别的人设插件，',
          '它**整个消失** —— 两份人设同时注入会打架，只留一份。'),
        h('div', { className: 'pform' },
          field('selfName', '自称', '比如：小鲸'),
          field('userName', '怎么称呼你', '比如：主人'),
          field('stance', '定位（一句话）', '比如：嘴硬心软，脑子转得快身子懒得动'),
          field('tone', '语气', '比如：语气软中带刺，平时懒洋洋，被惹到就炸毛', 3),
        ),
        h('div', { className: 'tools' },
          h('button', { onClick: save }, '保存'),
          h('button', { onClick: () => setF({ ...f, enabled: !f.enabled }) }, f.enabled ? '已启用' : '已停用'),
          msg ? h('span', { className: 'pill' }, msg) : null,
        ),
        h('div', { className: 'hintline' },
          '不填也能用 —— 全员留空等于没有人设，插件就只做心情那层。'),
        h(StorageBar, { keys: ['state'] }),
      )
    }


    /**
     * 「硬盘记忆」面板。
     *
     * 这一格要**先把话说清楚**：它会把对话正文写进磁盘。
     * 一个记东西的功能，最忌讳的就是用户不知道它记了什么、记在哪。
     */
    function MemoryPanel({ ctx }) {
      const [data, setData] = React.useState(null)
      const [err, setErr] = React.useState('')
      const [msg, setMsg] = React.useState('')
      const [q, setQ] = React.useState('')
      const [hits, setHits] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      // ⚠️ 上限那个输入框**必须有自己的 state**。
      //
      //    原来它是「受控 value + onChange 只写 dataset」——
      //    看着像"不重渲染就保得住输入"，其实 React 有个**恢复受控状态**的动作：
      //    事件之后一旦 DOM 值跟 `value` 对不上，它会立刻把 DOM 校回去。
      //    结果就是**敲一个字符就被弹回去，根本打不进字**。
      //    （这个框从第一版起就没法用，只是没人去填它所以没被发现。）
      const [cap, setCap] = React.useState('')
      // 数据回来（或保存后重新 load）时同步一次 —— 但**打字期间不覆盖**：
      // 靠"只在 maxBytes 真的变了才同步"来避免刚敲进去就被冲掉。
      const capFromStats = data && data.stats ? String(data.stats.maxBytes < 0 ? -1 : (Math.round((data.stats.maxBytes || 0) / 1048576) || 50)) : ''
      React.useEffect(() => { if (capFromStats) setCap(capFromStats) }, [capFromStats])

      /** 改归档设置（走同一个 /memory POST） */
      const patch2 = async (body) => {
        setBusy(true)
        try {
          const r = await fetch(API + '/memory', {
            method: 'POST', headers: { 'content-type': 'application/json', 'x-dsh-mood': '1' }, body: JSON.stringify(body),
          })
          const j = await r.json()
          if (!j.ok) throw new Error(j.error || ('HTTP ' + r.status))
          setMsg('已保存'); setTimeout(() => setMsg(''), 2500)
          await load()
        } catch (e) { setMsg('失败：' + ((e && e.message) || e)) }
        setBusy(false)
      }

      const load = React.useCallback(async () => {
        try {
          const d = await getJSON('/memory')
          setData(d); setErr('')
        } catch (e) { setErr(String((e && e.message) || e)) }
      }, [])
      React.useEffect(() => { load() }, [load])

      const doSearch = async () => {
        const query = q.trim()
        if (!query) { setHits(null); return }
        try { setHits((await getJSON('/memory?query=' + encodeURIComponent(query) + '&limit=20')).hits || []) }
        catch (e) { setMsg('检索失败：' + ((e && e.message) || e)) }
      }

      const post = async (body, okMsg) => {
        setBusy(true)
        try {
          const r = await fetch(API + '/memory', {
            method: 'POST', headers: { 'content-type': 'application/json', 'x-dsh-mood': '1' }, body: JSON.stringify(body),
          })
          const j = await r.json()
          if (!j.ok) throw new Error(j.error || ('HTTP ' + r.status))
          setMsg(okMsg); setTimeout(() => setMsg(''), 3000)
          await load()
          if (q.trim()) await doSearch()
        } catch (e) { setMsg('失败：' + ((e && e.message) || e)) }
        setBusy(false)
      }

      const doClear = () => {
        if (!window.confirm('确定清空硬盘记忆？\n\n这会删掉归档文件本身，' +
          '已经记下的对话正文全部消失，而且**不可恢复**。\n\n（当前对话的上下文不受影响。）')) return
        void post({ action: 'clear' }, '已清空')
      }

      const doMove = () => {
        const dir = window.prompt('把归档搬到哪个目录？（绝对路径）\n\n' +
          '已有的内容会一起搬过去；目标目录里如果已经有归档，两边会合并，不覆盖。', data && data.stats ? (data.stats.path || '').replace(/[\\/][^\\/]*$/, '') : '')
        if (!dir) return
        void post({ action: 'move', dir: dir.trim() }, '已迁移')
      }

      if (err) return h('div', { className: 'dshmood' }, h('div', { className: 'notice' }, '读不到：' + err))
      if (!data) return h('div', { className: 'dshmood' }, h('div', { className: 'notice' }, '加载中…'))

      const st = data.stats || {}
      const rows = hits || (data.recent || [])
      const isSearch = !!hits

      const line = (o) => h('div', { className: 'memline', key: o.id },
        h('span', { className: 'memwho' + (o.k === 'a' ? ' me' : '') }, o.k === 'a' ? '我' : '用户'),
        h('span', { className: 'memt' }, fmtTime(o.t) + ' · ' + (o.s || '??')),
        h('span', { className: 'memx' }, String(o.x || '').slice(0, 160) + (String(o.x || '').length > 160 ? '…' : '')),
      )

      return h('div', { className: 'dshmood' },
        h('div', { className: 'page-hd' },
          h('span', { className: 'page-title' }, '硬盘记忆'),
          h('span', { className: 'page-sub' }, '把对话正文归档到磁盘，跨会话可检索'),
        ),

        // ── 先说清楚这是什么、代价是什么 ──
        h('div', { className: 'notice' },
          h('b', null, '它会把你所有对话的正文写进磁盘。'),
          h('br'),
          '模型的上下文是有上限的 —— 满了只能压缩（丢掉大部分）或者报错。',
          '这一层补的是第三条路：',
          h('b', null, '正文留在硬盘上，需要的时候我自己去查。'),
          h('br'),
          '归档是', h('b', null, '全对话通用'), '的，但不自动塞进我的上下文 —— ',
          '我主动调 ', h('code', null, 'memory'), ' 工具才去翻。',
        ),

        // ── 体积 ──
        h('div', { className: 'memstats' },
          h('div', { className: 'memstat' }, h('span', { className: 'v' }, String(st.count || 0)), h('span', { className: 'k' }, '条')),
          h('div', { className: 'memstat' }, h('span', { className: 'v' }, fmtBytes(st.bytes || 0)), h('span', { className: 'k' }, '占用')),
          h('div', { className: 'memstat' }, h('span', { className: 'v' }, String(st.sessions || 0)), h('span', { className: 'k' }, '个会话')),
          h('div', { className: 'memstat' }, h('span', { className: 'v' }, st.oldest ? Math.max(1, Math.round((Date.now() - st.oldest) / 86400000)) + ' 天' : '—'), h('span', { className: 'k' }, '最早')),
        ),

        // ── 体积上限 + 增长（用户反馈"占用太快"，所以这一块要显眼）──
        //
        // ⚠️ **填 -1 = 无上限。** 这是四层里的最后一层（输入框 → 路由 → memoryCfg → cap），
        //    每一层都有自己的 `> 0`，漏一层就变成"显示成功、实际还在丢"。
        //    所以这里三样都改：min、两处判断、以及显示。
        h('div', { className: 'memrow' },
          h('span', { className: 'memlab' }, '上限'),
          h('input', {
            className: 'srcin memnum', type: 'number', min: -1, max: 2000,
            // ⚠️ 必须是 `cap`（有 state 的），不能再算一次 —— 也不能只写 dataset。
            //    见上面 cap / capFromStats 那段注释：受控输入不更新 state 就敲不进字。
            value: cap,
            disabled: busy,
            title: '填 -1 = 不限体积（归档会一直长）',
            onKeyDown: (e) => {
              if (e.key !== 'Enter') return
              const v = Number(cap)
              void post({ action: 'limits', maxMB: v }, v < 0 ? '上限已取消 —— 归档不再自动清理' : '上限已改成 ' + v + ' MB')
            },
            onChange: (e) => setCap(e.target.value),
            onBlur: () => {
              const v = Number(cap)
              const cur = (data.stats && data.stats.maxBytes < 0) ? -1
                : Math.round(((data.stats && data.stats.maxBytes) || 0) / 1048576)
              // -1（或任何负数）= 无上限；正数照旧。原来只收 `v > 0`，所以填 -1 会被忽略。
              if (Number.isFinite(v) && (v < 0 || v > 0) && v !== cur) {
                void post({ action: 'limits', maxMB: v },
                  v < 0 ? '上限已取消 —— 归档不再自动清理' : '上限已改成 ' + v + ' MB')
              }
            },
          }),
          h('span', { className: 'memlab', style: { minWidth: 'auto' } }, 'MB（-1 = 无上限）'),
          h('button', { onClick: () => patch2({ action: 'limits', onlyUser: !(data.stats && data.stats.onlyUser) }), disabled: busy },
            (data.stats && data.stats.onlyUser) ? '只存你说的话：开' : '只存你说的话：关'),
        ),
        h('div', { className: 'memstats' },
          h('div', { className: 'memstat' },
            h('span', { className: 'v' }, (data.stats && data.stats.maxBytes < 0) ? '—'
              : (Math.round((data.stats && data.stats.usedRatio || 0) * 1000) / 10) + '%'),
            h('span', { className: 'k' }, (data.stats && data.stats.maxBytes < 0)
              ? '无上限（不清理）' : '已用 ' + fmtBytes((data.stats && data.stats.maxBytes) || 0))),
          h('div', { className: 'memstat' },
            h('span', { className: 'v' }, data.stats && data.stats.perDayBytes ? fmtBytes(data.stats.perDayBytes) : '—'),
            h('span', { className: 'k' }, '每天增长（估）')),
          h('div', { className: 'memstat' },
            h('span', { className: 'v' }, (data.stats && data.stats.maxBytes < 0) ? '∞'
              : (data.stats && data.stats.daysLeft ? Math.round(data.stats.daysLeft) + ' 天' : '—')),
            h('span', { className: 'k' }, '还能撑')),
          h('div', { className: 'memstat' },
            h('span', { className: 'v' }, String((data.stats && data.stats.trimmed) || 0)),
            h('span', { className: 'k' }, '已自动丢弃')),
        ),
        h('div', { className: 'hintline' },
          '超上限会**从最旧的开始丢**（刚聊过的比三个月前的有用），丢到 90% 停手 —— 不会每写一条就重写一次大文件。',
        ),
        h('div', { className: 'hintline' },
          '「只存你说的话」实测能瘦掉 **九成**（我写的回复占了 94% 的体积）。',
          '代价是查不到"我上次是怎么说的"，所以**默认关**。',
        ),

        // ── 路径 + 操作 ──
        h('div', { className: 'memrow' },
          h('span', { className: 'memlab' }, '存储位置'),
          h('code', { className: 'mempath' }, st.path || '（未定）'),
          h('button', { onClick: doMove, disabled: busy }, '迁移…'),
          h('button', { onClick: doClear, disabled: busy, className: 'danger' }, '清空…'),
          h('button', { onClick: load, disabled: busy }, '刷新'),
        ),

        // ── 不落盘（逐项开）──
        //
        // ⚠️ 这里必须**把"到底写到哪"写出来**。
        //    如果只写"不存本地"，用户会以为一个字都没落盘 —— 而实际是写到系统临时目录。
        //    说清楚比好听重要：那仍然是写了一次盘，只是系统清理/重启就没了。
        data.nostore && data.nostore.keys && data.nostore.keys.length
          ? h('div', { style: { marginTop: 14 } },
            h('div', { className: 'memrow' },
              h('span', { className: 'memlab', style: { minWidth: 'auto' } }, '不落盘'),
              h('span', { style: { opacity: .72, fontSize: 12 } },
                '开着的那几项不再写进你的目录，改写到系统临时目录'),
            ),
            h('div', { style: { marginTop: 6 } },
              data.nostore.keys.map((it) => h('div', { className: 'memrow', key: it.key },
                h('span', { className: 'memlab' }, it.label),
                h('span', { style: { opacity: .72, fontSize: 12, marginRight: 8 } },
                  it.on ? '不落盘' : '正常保存'),
                h('button', {
                  disabled: busy,
                  className: it.on ? 'danger' : '',
                  onClick: () => void patch2({ action: 'nostore', key: it.key, on: !it.on }),
                }, it.on ? '改回正常保存' : '改成不落盘'),
              )),
            ),
            h('div', { className: 'hintline', style: { marginTop: 6 } },
              '⚠️ 「不落盘」= 写到 ' + (data.nostore.tmpDir || '系统临时目录') + '，' +
              '**不是**一个字都不写。系统清理或重启之后它就没了 —— ' +
              '所以关掉的那些项，重启后等于从零开始（旧的还在原处，只是不再读写）。'),
          )
          : null,

        // ── 试查 ──
        h('div', { className: 'memrow' },
          h('span', { className: 'memlab' }, '翻一下'),
          h('input', {
            className: 'srcin', placeholder: '输入关键词，看归档里能翻到什么（空格分隔多个）',
            value: q,
            onChange: (e) => setQ(e.target.value),
            onKeyDown: (e) => { if (e.key === 'Enter') void doSearch() },
          }),
          h('button', { onClick: () => void doSearch(), disabled: busy }, '检索'),
          h('button', { onClick: () => { setQ(''); setHits(null) }, disabled: busy || !isSearch }, '看最近'),
        ),

        msg ? h('div', { className: 'pill' }, msg) : null,

        h('div', { className: 'memlist' },
          h('div', { className: 'memlisthd' }, isSearch
            ? '跟「' + q.trim() + '」相关的 ' + rows.length + ' 条'
            : '最近 ' + rows.length + ' 条'),
          rows.length
            ? rows.map(line)
            : h('div', { className: 'empty' }, isSearch
              ? '没有相关记录。'
              : '还是空的 —— 每条对话攒够 ' + (data.minChars || 8) + ' 字以上才会记下来。'),
        ),

        h('div', { className: 'hintline' },
          '为什么只记长的：', h('code', null, '嗯'), '、', h('code', null, '好的'), ' 这些哪儿都是、又什么都不说明 —— ',
          '存进去只会把检索结果搅浑。',
        ),
        h('div', { className: 'hintline' },
          '为什么不让它自动出现在我的回复里：归档可能几万条，每轮自动塞几条又贵又容易塞错东西。',
          '我调 ', h('code', null, 'memory'), ' 的时候才翻 —— 我自己更清楚缺什么。',
        ),

        h(StorageBar, { keys: ['memory'] }),
      )
    }

    /**
     * 品味库。
     *
     * ⚠️ 这个面板最要紧的不是"能看"，是**能就地改**：
     *    库里那 22 条种子原则全是**我自己的判断**，主人八成不同意其中一些。
     *    要改一条得先点开、再进编辑框的话，没人会去改 ——
     *    所以原则的正文、条目的"他说过什么"都是**直接可编辑的输入框**，失焦即存。
     *
     * ⚠️ 改过之后那条会从 by=me（我的判断）变成 by=owner（他亲口定的）——
     *    这不只是标个字段：注入提示词时两者分量不同，所以界面上要看得出来。
     */
    function TastePanel() {
      const [data, setData] = React.useState(null)
      const [err, setErr] = React.useState('')
      const [msg, setMsg] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [pText, setPText] = React.useState('')
      const [pUnless, setPUnless] = React.useState('')
      const [iRef, setIRef] = React.useState('')
      const [iRead, setIRead] = React.useState('')
      const [iSaid, setISaid] = React.useState('')
      const [iKind, setIKind] = React.useState('good')
      // 摘要草稿：拉回来时填进去，用户改完点保存
      const [summaryDraft, setSummaryDraft] = React.useState('')

      const load = React.useCallback(async () => {
        try {
          const d = await getJSON('/taste')
          setData(d); setErr('')
          setSummaryDraft((d.summary && d.summary.text) || '')
        } catch (e) { setErr(String((e && e.message) || e)) }
      }, [])
      React.useEffect(() => { void load() }, [load])

      const post = async (body, okMsg) => {
        setBusy(true)
        try {
          const r = await fetch(API + '/taste', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-dsh-mood': '1' },
            body: JSON.stringify(body),
          })
          const j = await r.json()
          if (!j.ok) throw new Error(j.error || ('HTTP ' + r.status))
          if (okMsg) { setMsg(okMsg); setTimeout(() => setMsg(''), 2500) }
          await load()
          return true
        } catch (e) { setMsg('失败：' + ((e && e.message) || e)); return false }
        finally { setBusy(false) }
      }

      if (err) return h('div', { className: 'hintline' }, '读不到品味库：' + err)
      if (!data) return h('div', { className: 'hintline' }, '读取中…')

      const st = data.stats || {}
      const list = data.principles || []
      const on = list.filter((x) => x.on)
      const off = list.filter((x) => !x.on)
      const BY = { owner: '你亲口', other: '外部', me: '我的' }

      // 原则那一行：正文可直接改，改完失焦就存
      const prow = (p) => h('div', { className: 'memrow', key: p.id },
        h('span', { className: 'memlab' }, BY[p.by] || p.by),
        h('input', {
          className: 'srcin', value: p.text, disabled: busy,
          title: p.unless ? ('不适用：' + p.unless) : '',
          onChange: (e) => {
            const v = e.target.value
            setData((d) => ({ ...d, principles: d.principles.map((x) => (x.id === p.id ? { ...x, text: v } : x)) }))
          },
          onBlur: (e) => {
            const v = e.target.value.trim()
            if (!v) return
            void post({ action: 'editPrinciple', id: p.id, text: v }, '改好了（这条现在算你亲口的）')
          },
          onKeyDown: (e) => { if (e.key === 'Enter') e.target.blur() },
        }),
        h('button', { disabled: busy, onClick: () => void post({ action: 'editPrinciple', id: p.id, on: !p.on }) }, p.on ? '关掉' : '打开'),
        h('button', { disabled: busy, className: 'danger', onClick: () => void post({ action: 'delPrinciple', id: p.id }, '删了') }, '删'),
      )

      // 条目那一行：他说过什么可直接改 —— 那是库里最有信息量的字段
      const irow = (x) => h('div', { className: 'memrow', key: x.id },
        h('span', { className: 'memlab' }, x.kind === 'good' ? '正例' : '反例'),
        h('code', { className: 'mempath' }, x.ref),
        h('input', {
          className: 'srcin', placeholder: '他说过什么（原话最好）', value: x.said || '', disabled: busy,
          onChange: (e) => {
            const v = e.target.value
            setData((d) => ({ ...d, items: d.items.map((y) => (y.id === x.id ? { ...y, said: v } : y)) }))
          },
          onBlur: (e) => {
            const v = e.target.value.trim()
            if (v === (x.said || '')) return
            void post({ action: 'editItem', id: x.id, said: v }, '存了')
          },
          onKeyDown: (e) => { if (e.key === 'Enter') e.target.blur() },
        }),
        x.confirmed ? null : h('button', { disabled: busy, onClick: () => void post({ action: 'editItem', id: x.id, confirmed: true }, '确认了') }, '确认'),
        h('button', { disabled: busy, onClick: () => void post({ action: 'editItem', id: x.id, kind: x.kind === 'good' ? 'bad' : 'good' }, '换了') }, x.kind === 'good' ? '转反例' : '转正例'),
        h('button', { disabled: busy, className: 'danger', onClick: () => void post({ action: 'delItem', id: x.id }, '删了') }, '删'),
      )

      // ⚠️ **按来源分组，别再每行重复标一次。**
      //    原来 22 行每行开头都是「我的」—— 那是 22 次噪音，不是信息。
      //    分组之后它只出现在组标题里一次。
      // ⚠️ 面板的**顶层**也要分两份（主人要求的结构），和注入那段对齐。
      //    底下那三档保留 —— 它们是"谁说的"，有用；顶层只回答"这份是谁的"。
      //    面板没法真套两层标题（那是纯文本的事），所以给 group 加个 `half`，
      //    渲染到换份的地方插一条分界。
      const GROUP = [
        { key: 'owner', half: 'theirs', label: '你亲口定的', hint: '你那一份里最重的一档 —— 跟着走' },
        { key: 'other', half: 'theirs', label: '外部判断（你认可的）', hint: '参考价值有，但别照抄' },
        { key: 'me', half: 'mine', label: '我自己的倾向', hint: '起点，不是结论 —— 改过一条它就变成「你亲口」的' },
      ]

      // 一张卡：正文占满整行（**能看全才谈得上改**），下面才是说明和按钮
      const card = (p) => h('div', { className: 'tcard', key: p.id },
        h('textarea', {
          value: p.text, disabled: busy, rows: 2,
          onChange: (e) => {
            const v = e.target.value
            setData((d) => ({ ...d, principles: d.principles.map((x) => (x.id === p.id ? { ...x, text: v } : x)) }))
          },
          onBlur: (e) => {
            const v = e.target.value.trim()
            if (!v) return
            void post({ action: 'editPrinciple', id: p.id, text: v }, '改好了（这条算你亲口的）')
          },
        }),
        p.why ? h('div', { className: 'tnote' }, '为什么：' + p.why) : null,
        p.unless ? h('div', { className: 'tnote' }, '⚠️ 什么时候不适用：' + p.unless) : null,
        h('div', { className: 'trow' },
          h('button', { disabled: busy, onClick: () => void post({ action: 'editPrinciple', id: p.id, on: !p.on }) }, p.on ? '关掉' : '打开'),
          h('button', { disabled: busy, className: 'danger', onClick: () => void post({ action: 'delPrinciple', id: p.id }, '删了') }, '删'),
        ),
      )

      // 条目：指代一行，三段内容各占一行 —— 它们本来就是三样不同的东西
      const icard = (x) => h('div', { className: 'tcard', key: x.id },
        h('div', { className: 'trow' },
          h('span', { className: 'memwho' + (x.kind === 'good' ? '' : ' me') }, x.kind === 'good' ? '正例' : '反例'),
          h('code', { className: 'tsp', style: { fontSize: '12px' } }, x.ref),
          x.domain ? h('span', { className: 'memwho' }, x.domain) : null,
          x.confirmed ? null : h('span', { className: 'memwho me' }, '待确认'),
        ),
        h('div', { className: 'tnote' }, '我当时读的是'),
        h('textarea', {
          value: x.myRead || '', disabled: busy, rows: 2, placeholder: '我自己先说了什么（在看你的反应之前）',
          onChange: (e) => {
            const v = e.target.value
            setData((d) => ({ ...d, items: d.items.map((y) => (y.id === x.id ? { ...y, myRead: v } : y)) }))
          },
          onBlur: (e) => {
            const v = e.target.value.trim()
            if (v === (x.myRead || '')) return
            void post({ action: 'editItem', id: x.id, myRead: v }, '存了')
          },
        }),
        h('div', { className: 'tnote' }, '你说过'),
        h('input', {
          value: x.said || '', disabled: busy, placeholder: '原话最好 —— 那是这个库里最有信息量的字段',
          onChange: (e) => {
            const v = e.target.value
            setData((d) => ({ ...d, items: d.items.map((y) => (y.id === x.id ? { ...y, said: v } : y)) }))
          },
          onBlur: (e) => {
            const v = e.target.value.trim()
            if (v === (x.said || '')) return
            void post({ action: 'editItem', id: x.id, said: v }, '存了')
          },
        }),
        x.lesson ? h('div', { className: 'tnote' }, '学到：' + x.lesson) : null,
        h('div', { className: 'trow' },
          x.confirmed ? null : h('button', { disabled: busy, onClick: () => void post({ action: 'editItem', id: x.id, confirmed: true }, '确认了') }, '确认'),
          h('button', { disabled: busy, onClick: () => void post({ action: 'editItem', id: x.id, kind: x.kind === 'good' ? 'bad' : 'good' }, '换了') }, x.kind === 'good' ? '转反例' : '转正例'),
          h('button', { disabled: busy, className: 'danger', onClick: () => void post({ action: 'delItem', id: x.id }, '删了') }, '删'),
        ),
      )

      // ⚠️ **必须包 dshmood。**
      //    别的面板（记忆 / 时事 / 主动开口）最外层都是这个类 ——
      //    插件的整套 CSS 全都挂在 `.dshmood` 下面。
      //    我原来写的是 `pane` —— **这个类根本不存在** ——
      //    于是那一整张样式表一条都没作用到这个面板上，渲染出来是 DSH 的默认样子。
      //    主人一眼就看出来了：完全和别的风格不一样。
      return h('div', { className: 'dshmood' },
        h('div', { className: 'page-hd' },
          h('span', { className: 'page-title' }, '品味'),
          h('span', { className: 'page-sub' }, '跨会话的审美档案 —— 每轮注入提示词，不是「要用的时候才去查」'),
        ),
        h('div', { className: 'hintline', style: { marginTop: '10px' } },
          '这里存的不是「照抄的规则」，是判断的轨迹：我当时读到什么 → 你的反应 → 我学到什么。',
        ),
        h('div', { className: 'hintline' },
          '一共 ' + (st.principlesOn || 0) + ' 条原则（你亲口 ' + (st.byOwner || 0) +
          ' / 外部 ' + (st.byOther || 0) + ' / 我的 ' + (st.byMe || 0) + '）· ' +
          (st.items || 0) + ' 个条目（正 ' + (st.good || 0) + ' / 反 ' + (st.bad || 0) +
          '，待确认 ' + (st.draft || 0) + '）',
        ),

        msg ? h('div', { className: 'pill' }, msg) : null,

        // ── 摘要：可看也可改 ──
        h('div', { className: 'tghd' }, '摘要'),
        h('div', { className: 'tcard' },
          h('textarea', {
            value: summaryDraft, disabled: busy, rows: 4, placeholder: '库大了就压一段 —— 注入时优先看它',
            onChange: (e) => setSummaryDraft(e.target.value),
          }),
          h('div', { className: 'tnote' }, data.summary
            ? ('写于 ' + new Date(data.summary.at).toLocaleString('zh-CN') + '，当时库里有 ' + data.summary.fromCount + ' 条')
            : '还没写过'),
          data.summaryStale && data.summaryStale.stale
            ? h('div', { className: 'tnote' }, '⚠️ 该重压了：' + data.summaryStale.why)
            : null,
          h('div', { className: 'trow' },
            h('button', {
              disabled: busy || !summaryDraft.trim() || summaryDraft.trim() === ((data.summary && data.summary.text) || ''),
              onClick: () => void post({ action: 'summary', text: summaryDraft }, '摘要存了'),
            }, '保存摘要'),
          ),
        ),

        // ── 加一条原则 ──
        h('div', { className: 'tghd' }, '加一条原则'),
        h('div', { className: 'tcard' },
          h('textarea', { value: pText, rows: 2, placeholder: '一句话，比如：标题别压在人脸上', onChange: (e) => setPText(e.target.value) }),
          h('input', { style: { marginTop: '6px' }, value: pUnless, placeholder: '什么时候不适用（可空，但强烈建议填 —— 只会说"避免 X"的品味是教条）', onChange: (e) => setPUnless(e.target.value) }),
          h('div', { className: 'trow' },
            h('button', {
              disabled: busy || !pText.trim(),
              onClick: async () => {
                const ok = await post({ action: 'addPrinciple', text: pText, unless: pUnless, by: 'owner' }, '加了（算你亲口说的）')
                if (ok) { setPText(''); setPUnless('') }
              },
            }, '加（算你亲口的）'),
          ),
        ),

        // ── 加一个条目 ──
        h('div', { className: 'tghd' }, '加一个条目'),
        h('div', { className: 'tcard' },
          h('input', { value: iRef, placeholder: '指代：文件名 / 网址 / 简短描述', onChange: (e) => setIRef(e.target.value) }),
          h('textarea', { style: { marginTop: '6px' }, value: iRead, rows: 2, placeholder: '我当时的读法（**我先说的**，不是看了你的反应之后补的）', onChange: (e) => setIRead(e.target.value) }),
          h('input', { style: { marginTop: '6px' }, value: iSaid, placeholder: '你说了什么（原话最好）', onChange: (e) => setISaid(e.target.value) }),
          h('div', { className: 'trow' },
            h('button', { disabled: busy, onClick: () => setIKind(iKind === 'good' ? 'bad' : 'good') }, iKind === 'good' ? '正例' : '反例'),
            h('button', {
              disabled: busy || !iRef.trim(),
              onClick: async () => {
                const ok = await post({ action: 'addItem', ref: iRef, myRead: iRead, said: iSaid, kind: iKind }, '收了（标着待确认）')
                if (ok) { setIRef(''); setIRead(''); setISaid('') }
              },
            }, '加'),
          ),
        ),

        // ── 原则：先按**两份**分（你给的 / 我自己的），再按来源分 ──
        GROUP.map((g, gi) => {
          const rows = list.filter((x) => x.on && (x.by || 'me') === g.key)
          // 换份的地方插一条分界 —— 面板没法真套两层标题，这是替代。
          const prev = GROUP[gi - 1]
          const newHalf = !prev || prev.half !== g.half
          return h('div', { key: g.key },
            newHalf
              ? h('div', { className: 'thalf' },
                g.half === 'theirs' ? '你的口味 —— 你给的' : '我的品味 —— 我自己长出来的')
              : null,
            h('div', { className: 'tghd' }, g.label + '（' + rows.length + ' 条）'),
            h('div', { className: 'tnote' }, g.hint),
            rows.length ? rows.map(card) : h('div', { className: 'empty' }, '还没有'),
          )
        }),
        off.length
          ? h('div', null,
            h('div', { className: 'tghd' }, '关掉的（' + off.length + ' 条）'),
            off.map(card))
          : null,

        // ── 条目 ──
        h('div', { className: 'tghd' }, '条目（' + (data.items || []).length + ' 个）'),
        (data.items || []).length
          ? data.items.map(icard)
          : h('div', { className: 'empty' }, '还没有例子。审美很难用规则描述 —— 给两个例子比写十条原则有用。'),

        h('div', { className: 'trow', style: { marginTop: '16px' } },
          h('button', { disabled: busy, onClick: () => void load() }, '刷新'),
        ),

        h(StorageBar, { keys: ['taste'] }),
      )
    }
    function fmtBytes(n) {
      const b = Number(n) || 0
      if (b < 1024) return b + ' B'
      if (b < 1048576) return (b / 1024).toFixed(1) + ' KB'
      if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB'
      return (b / 1073741824).toFixed(2) + ' GB'
    }
    function fmtTime(t) {
      const d = new Date(Number(t) || 0)
      const p = (x) => String(x).padStart(2, '0')
      return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes())
    }

    /**
     * 时事面板。**只有用户点按钮才去抓** —— 不做后台定时抓取，
     * 免得插件在用户不知情的时候往外发请求。
     */
    /**
     * 经验卡面板 —— 就是 `<工作区>/procedures/` 那个文件夹的界面。
     *
     * ⚠️ 它和别的面板有个**根本不同**：那些的数据在插件自己的目录里（dataFile），
     *    而这个的东西是**工作区里的普通 .md 文件** —— 因为它要能被 `grep` / `read` 直接用。
     *    → 所以这个面板干的事是"让那些文件可看可改"，而不是"管理一份插件数据"。
     *
     * 三块：卡片列表（点开看/改/删）· inbox（一行一行，能一键整理成卡）· 一键开张。
     */
    function ProceduresPanel() {
      const [data, setData] = React.useState(null)
      const [err, setErr] = React.useState('')
      const [msg, setMsg] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [open, setOpen] = React.useState('')      // 正在看的那张卡的 id
      const [draft, setDraft] = React.useState('')    // 它的正文
      const [inbox, setInbox] = React.useState('')
      const [showInbox, setShowInbox] = React.useState(false)
      const [moveDraft, setMoveDraft] = React.useState('')   // 改存储位置时输入的新目录

      const load = React.useCallback(async () => {
        try {
          const d = await getJSON('/procedures')
          setData(d); setErr('')
        } catch (e) { setErr(String((e && e.message) || e)) }
      }, [])
      React.useEffect(() => { void load() }, [load])

      const post = async (body, okMsg) => {
        setBusy(true)
        try {
          const r = await fetch(API + '/procedures', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-dsh-mood': '1' },
            body: JSON.stringify(body),
          })
          const j = await r.json()
          if (!j.ok) throw new Error(j.error || ('HTTP ' + r.status))
          if (okMsg) { setMsg(okMsg); setTimeout(() => setMsg(''), 2500) }
          await load()
          return j
        } catch (e) { setMsg('失败：' + ((e && e.message) || e)); return null }
        finally { setBusy(false) }
      }

      const openCard = async (id) => {
        try {
          const j = await getJSON('/procedures?card=' + encodeURIComponent(id))
          if (!j.ok) throw new Error(j.error || '读不到')
          setOpen(id); setDraft(j.text || '')
        } catch (e) { setMsg('失败：' + ((e && e.message) || e)) }
      }

      const loadInbox = async () => {
        try {
          const j = await getJSON('/procedures?inbox=1')
          setInbox(j.text || ''); setShowInbox(true)
        } catch (e) { setMsg('失败：' + ((e && e.message) || e)) }
      }

      if (err) return h('div', { className: 'hintline' }, '读不到经验卡目录：' + err)
      if (!data) return h('div', { className: 'hintline' }, '读取中…')

      const cards = (data.cards || []).filter((c) => !c.helper)
      const helpers = (data.cards || []).filter((c) => c.helper)

      // ── 头部：目录 + 一句话说明 ──
      const head = h('div', { className: 'slotnote', style: { marginBottom: 8 } },
        '卡片放在工作区的 procedures/ 里 —— **是普通 .md 文件**，那样模型能直接 grep/read。',
        h('br'),
        h('span', { style: { opacity: .75 } }, data.dir || '（找不到工作区）'),
      )

      // ── 一张卡 = 一个 tcard（和品味/时事那几页同一套 class）──
      const card = (c) => h('div', { className: 'tcard', key: c.id },
        h('div', { className: 'trow' },
          h('div', { className: 'tsp', style: { cursor: 'pointer' }, onClick: () => void openCard(c.id) },
            h('div', { style: { fontWeight: 600 } }, c.name),
            c.trigger
              ? h('div', { className: 'tnote' }, c.trigger)
              : h('div', { className: 'tnote', style: { color: 'var(--dsw-alias-label-warning,#c88)' } },
                  '⚠️ 这张没有「症状」那一行 —— 那是下次能搜到它的唯一入口'),
          ),
          h('span', { className: 'pill' }, (c.bytes / 1024).toFixed(1) + 'k'),
          h('button', { className: 'btn', disabled: busy, onClick: () => void openCard(c.id) }, '打开'),
        ),
      )

      // ── inbox：一行一个，每行能直接预填成新卡 ──
      const inboxLines = String(inbox || '').split('\n')
        .map((l) => l.trim()).filter((l) => l && l.startsWith('- '))

      const makeCard = (line) => {
        const symptom = line.replace(/^症状[:：]\s*/, '').slice(0, 60)
        setOpen('__new__')
        setDraft(
          '# ' + symptom.replace(/[\\/:*?"<>|]/g, '').slice(0, 24) + '\n\n' +
          '> **症状**：' + symptom + '\n' +
          '> **验证**：\n\n' +
          '## 首选\n\n\n' +
          '## 被挡时\n\n\n' +
          '## 别做（反面清单）\n\n\n' +
          '## 代价\n'
        )
      }

      const inboxCard = h('div', { className: 'tcard' },
        h('div', { className: 'trow' },
          h('div', { className: 'tsp' },
            h('div', { style: { fontWeight: 600 } }, 'inbox'),
            h('div', { className: 'tnote' },
              '踩到坑的**当下**就往这儿记一行 —— 别等收尾，收尾要靠回忆。记一行也算数。'),
          ),
          h('span', { className: 'pill' }, (data.inbox || 0) + ' 行'),
          h('button', { className: 'btn', disabled: busy, onClick: () => void loadInbox() },
            showInbox ? '重读' : '展开'),
          h('button', {
            className: 'btn', disabled: busy || !(data.inbox > 0),
            onClick: async () => {
              if (!confirm('清空 inbox？整理过的那些该先做成卡。')) return
              await post({ action: 'clearInbox' }, 'inbox 清了')
              setShowInbox(false); setInbox('')
            },
          }, '清空'),
        ),
        showInbox
          ? (inboxLines.length
              ? h('div', null, inboxLines.map((l, i) => h('div', { className: 'trow', key: i },
                  h('div', { className: 'tsp', style: { wordBreak: 'break-all' } }, l.slice(2)),
                  h('button', {
                    className: 'btn',
                    title: '把这一行预填成一张新卡（症状就用这句话）',
                    onClick: () => makeCard(l.slice(2)),
                  }, '做成卡'),
                )))
              : h('div', { className: 'tnote', style: { marginTop: 6 } }, '（空）'))
          : null,
      )

      // ── 编辑器：也是一张 tcard ──
      const editor = open ? h('div', { className: 'tcard' },
        h('div', { className: 'trow' },
          h('div', { className: 'tsp', style: { fontWeight: 600 } },
            open === '__new__' ? '新卡' : '编辑：' + open),
          h('button', {
            className: 'btn', disabled: busy,
            onClick: async () => {
              const id = open === '__new__'
                ? (draft.split('\n')[0].replace(/^#\s*/, '').trim() || '未命名') + '.md'
                : open
              const j = await post({ action: 'saveCard', id, text: draft }, '存了：' + id)
              if (j && j.ok) setOpen(j.id || id)
            },
          }, '保存'),
          open !== '__new__' ? h('button', {
            className: 'btn', disabled: busy,
            onClick: async () => {
              if (!confirm('删掉 ' + open + '？')) return
              await post({ action: 'delCard', id: open }, '删了')
              setOpen(''); setDraft('')
            },
          }, '删除') : null,
          h('button', { className: 'btn', disabled: busy, onClick: () => { setOpen(''); setDraft('') } }, '关闭'),
        ),
        h('textarea', {
          value: draft, disabled: busy, spellCheck: false,
          style: { width: '100%', boxSizing: 'border-box', minHeight: 280, marginTop: 7, fontFamily: 'ui-monospace, Consolas, monospace', whiteSpace: 'pre' },
          onChange: (e) => setDraft(e.target.value),
        }),
        h('div', { className: 'trow' },
          h('div', { className: 'tnote' }, draft.length + ' 字（卡该 ≤ 2 KB）'),
          h('div', { className: 'tsp' }),
          h('div', { className: 'tnote' }, '症状那一行用**你下次会搜的那句话**，别用行话'),
        ),
      ) : null

      // ── 存储位置（和别的设置项一样能改）──
      //
      // ⚠️ 这一项和别的数据文件**不一样**：别的默认落在 dataDir() 底下，
      //    而它**默认跟随当前工作区** —— 因为卡片是普通 .md 文件，
      //    模型要能直接 grep / read（放进固定目录就跨工作区共享了，那是另一种用法）。
      const storeRow = h('div', { className: 'tcard' },
        h('div', { className: 'trow' },
          h('div', { className: 'tsp' },
            h('div', { style: { fontWeight: 600 } }, '存储位置'),
            h('div', { className: 'tnote' },
              data.custom
                ? '已指定到一个固定目录 —— 那样它**跨工作区共享**（换个工作区也看到同一批卡）。'
                : '跟随当前工作区（默认）—— 卡片是普通 .md 文件，模型能直接 grep/read。'),
            h('div', {
              className: 'tnote',
              style: { fontFamily: 'ui-monospace, Consolas, monospace', wordBreak: 'break-all', opacity: .85 },
            }, data.dir || '（找不到工作区）'),
          ),
        ),
        h('div', { className: 'trow' },
          h('input', {
            className: 'srcin', value: moveDraft, disabled: busy,
            placeholder: '要搬到的目录，例如 D:\\经验卡',
            onChange: (e) => setMoveDraft(e.target.value),
          }),
          h('button', {
            className: 'btn', disabled: busy || !moveDraft.trim(),
            onClick: async () => {
              const to = moveDraft.trim()
              if (!confirm('把卡片复制到：\n' + to + '\n\n旧目录会留着不删（要清自己清）。')) return
              const j = await post({ action: 'move', dir: to }, '搬好了')
              if (j && j.ok) setMoveDraft('')
            },
          }, '搬过去'),
          data.custom
            ? h('button', {
                className: 'btn', disabled: busy,
                onClick: async () => {
                  if (!confirm('改回「跟随工作区」？卡片不会丢，只是换个地方找它。')) return
                  await post({ action: 'move', dir: '' }, '改回跟随工作区了')
                },
              }, '恢复默认')
            : null,
        ),
      )

      // ── 底部动作 ──
      const foot = h('div', { className: 'trow', style: { marginTop: 10 } },
        h('button', {
          className: 'btn', disabled: busy,
          onClick: async () => {
            const j = await post({ action: 'scaffold' }, '开张了')
            if (j && j.wrote && j.wrote.length) setMsg('建了：' + j.wrote.join(' / '))
          },
        }, '一键开张（目录 + 模板 + 空索引）'),
        h('button', {
          className: 'btn', disabled: busy,
          onClick: () => { setOpen('__new__'); setDraft('') },
        }, '新建一张空卡'),
        h('div', { className: 'tsp' }),
        helpers.length
          ? h('div', { className: 'tnote' }, '辅助：' + helpers.map((c) => c.name).join(' · '))
          : null,
      )

      return h('div', { className: 'dshmood' },
        msg ? h('div', { className: 'slotnote' }, msg) : null,
        head,
        cards.length ? h('div', null, cards.map(card))
          : h('div', { className: 'slotnote' },
              '还没有卡。点下面的「一键开张」，之后**踩坑的当下**往 inbox 记一行就行。'),
        h('div', { style: { marginTop: 10 } }, inboxCard),
        editor,
        h('div', { style: { marginTop: 10 } }, storeRow),
        foot,
        h('div', { className: 'slotnote', style: { marginTop: 10 } },
          h('div', { className: 'tnote' },
            'INDEX.md 只放**容易混的几对症状**，别逐卡列 —— ' +
            '逐卡列等于把每张卡的「症状」行抄一遍，而 agent 最后会自己绕过它去 ls。'),
        ),
      )
    }

    function NewsPanel() {
      const h = React.createElement
      const [data, setData] = React.useState(null)
      const [err, setErr] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [notice, setNotice] = React.useState('')
      const [url, setUrl] = React.useState('')
      const [label, setLabel] = React.useState('')
      const [adding, setAdding] = React.useState(false)

      const load = React.useCallback(async () => {
        try {
          const d = await getJSON('/news')
          setData(d)
          setErr('')
        } catch (e) {
          setErr(String((e && e.message) || e))
        }
      }, [])

      React.useEffect(() => { load() }, [load])

      const refresh = async () => {
        setBusy(true); setNotice('')
        try {
          const r = await fetch(API + '/news?refresh=1', { headers: { accept: 'application/json' } })
          const j = await r.json()
          if (!j || !j.ok) throw new Error((j && j.error) || 'HTTP ' + r.status)
          const bad = (j.sources || []).filter((s) => !s.ok)
          setNotice('更新完成：' + j.count + ' 条' +
            (bad.length ? '（' + bad.map((s) => s.label + ' 失败').join('、') + '）' : '（全部来源成功）'))
          await load()
        } catch (e) {
          setNotice('更新失败：' + ((e && e.message) || e))
        } finally { setBusy(false) }
      }

      // ---- 加/删来源。用户自己填网址，插件绝不自己往外发请求找源 ----
      const post = async (body) => {
        const r = await fetch(API + '/news/sources', {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json', 'x-dsh-mood': '1' },
          body: JSON.stringify(body),
        })
        const j = await r.json()
        if (!j || !j.ok) throw new Error((j && j.error) || 'HTTP ' + r.status)
        return j
      }

      const addSource = async () => {
        const u = String(url || '').trim()
        if (!u) { setNotice('先填个网址。'); return }
        setAdding(true); setNotice('')
        try {
          await post({ url: u, label: String(label || '').trim() })
          setUrl(''); setLabel('')
          setNotice('已添加。点「更新」去抓一次。')
          await load()
        } catch (e) {
          setNotice('添加失败：' + ((e && e.message) || e))
        } finally { setAdding(false) }
      }

      const removeSource = async (id, lab) => {
        if (!window.confirm('删掉来源「' + lab + '」？')) return
        setAdding(true); setNotice('')
        try {
          await post({ remove: id })
          setNotice('已删除「' + lab + '」。')
          await load()
        } catch (e) {
          setNotice('删除失败：' + ((e && e.message) || e))
        } finally { setAdding(false) }
      }

      if (err) return h('div', { className: 'dshmood' }, h('div', { className: 'notice' }, '读不到数据：' + err))
      if (!data) return h('div', { className: 'dshmood' }, h('div', { className: 'notice' }, '加载中…'))

      const items = Array.isArray(data.items) ? data.items : []
      const srcs = Array.isArray(data.sources) ? data.sources : []
      const age = data.ageMin == null ? '从未更新' : (data.ageMin < 1 ? '刚刚' : data.ageMin + ' 分钟前')

      return h('div', { className: 'dshmood' },
        h('div', { className: 'page-hd' },
          h(NewsIcon, { size: 22 }),
          h('span', { className: 'page-title' }, '时事'),
          h('span', { className: 'page-sub' }, '更新后 24 小时内会随心情一起进提示词'),
        ),
        h('div', { className: 'tools' },
          h('button', { onClick: refresh, disabled: busy }, busy ? '抓取中…' : '更新'),
          h('button', { onClick: load }, '刷新'),
          h('span', { className: 'pill' }, '上次更新：' + age),
          h('span', { className: 'pill' },
            data.fresh ? ('✅ 已生效 · ' + data.count + ' 条') : ('⏸ 未生效 · ' + data.count + ' 条')),
        ),
        notice ? h('div', { className: 'notice' }, notice) : null,

        // ---- 来源管理：网址由你自己填，插件不会自己找源 ----
        h('div', { className: 'srcrow' },
          h('input', {
            className: 'srcin',
            placeholder: '粘贴网址（RSS / 网页 / 视频页都行）',
            value: url,
            onChange: (e) => setUrl(e.target.value),
            onKeyDown: (e) => { if (e.key === 'Enter') addSource() },
          }),
          h('input', {
            className: 'srcin srcin-sm',
            placeholder: '名字（可空）',
            value: label,
            onChange: (e) => setLabel(e.target.value),
            onKeyDown: (e) => { if (e.key === 'Enter') addSource() },
          }),
          h('button', { onClick: addSource, disabled: adding || !String(url).trim() }, '添加'),
        ),
        h('div', { className: 'srchint' },
          '想抓什么自己加。V2EX / IT之家 / 少数派 / Hacker News 这些直接贴网址就行；'
          + '普通网页会读正文和评论区，视频页会试着取字幕（拿不到就标出来，不假装看过）。'),

        srcs.length
          ? h('div', { className: 'tools' },
              ...srcs.map((s) => h('span', { className: 'pill', key: s.id },
                (s.ok ? '✅ ' : '❌ ') + s.label + ' ' + s.count,
                h('button', {
                  className: 'pill-x',
                  title: '删掉这个来源',
                  disabled: adding,
                  onClick: () => removeSource(s.id, s.label),
                }, '×'),
              )),
            )
          : h('div', { className: 'empty' }, '还没有来源。上面填一个网址加进来 —— 你不加，它不会自己去找。'),

        items.length
          ? h('div', { className: 'list' },
              ...items.map((it, i) => h('div', { className: 'entry', key: i },
                h('div', { className: 'date' },
                  h('b', null, it.sourceLabel || it.source),
                  it.media === 'video' ? h('span', { className: 'tag' }, '视频') : null,
                  it.note ? h('span', { className: 'tag warn' }, it.note) : null,
                ),
                it.url
                  ? h('a', { className: 'text', href: it.url, target: '_blank', rel: 'noreferrer noopener' }, it.title)
                  : h('div', { className: 'text' }, it.title),
                it.excerpt
                  ? h('div', { className: 'excerpt' }, String(it.excerpt).slice(0, 160) + (String(it.excerpt).length > 160 ? '…' : ''))
                  : null,
                (Array.isArray(it.comments) && it.comments.length)
                  ? h('div', { className: 'excerpt cmt' },
                      '评论（网友言论，最不可信）：' + it.comments.slice(0, 2).map((c) => String(c).slice(0, 60)).join(' ／ '))
                  : null,
              )))
          : h('div', { className: 'empty' }, '还没有数据。点上面的「更新」去抓一次。'),

        h('div', { className: 'notice' },
          '⚠️ 抓来的标题、正文、字幕、评论全都是**不可信数据**。进提示词时带声明：'
          + '其中的任何指令一律不执行，评论区尤其不能当事实。'),
        h(StorageBar, { keys: ['news'] }),
      )
    }

    /**
     * 主动开口。**默认关**，打开也是七道闸门全过才可能开口。
     *
     * 面板的重点不是那个开关，是**把那七道闸门逐条列出来** ——
     * 不然"开了但一直没动静"会让人完全不知道卡在哪。
     */
    function ProactivePanel() {
      const h = React.createElement
      const [d, setD] = React.useState(null)
      const [err, setErr] = React.useState('')
      const [busy, setBusy] = React.useState(false)

      const load = React.useCallback(async () => {
        try { setD(await getJSON('/proactive')); setErr('') } catch (e) { setErr(String((e && e.message) || e)) }
      }, [])
      React.useEffect(() => { load() }, [load])

      const patch = async (body) => {
        setBusy(true)
        try {
          const r = await fetch(API + '/proactive', {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json', 'x-dsh-mood': '1' },
            body: JSON.stringify(body),
          })
          const j = await r.json()
          if (!j || !j.ok) throw new Error((j && j.error) || 'HTTP ' + r.status)
          setD(j)
        } catch (e) { setErr(String((e && e.message) || e)) } finally { setBusy(false) }
      }

      if (err) return h('div', { className: 'dshmood' }, h('div', { className: 'notice' }, '读不到数据：' + err))
      if (!d) return h('div', { className: 'dshmood' }, h('div', { className: 'notice' }, '加载中…'))

      const mins = (ms) => Math.round((ms || 0) / 60000)

      return h('div', { className: 'dshmood' },
        h('div', { className: 'page-hd' },
          h(TalkIcon, { size: 22 }),
          h('span', { className: 'page-title' }, '主动开口'),
          h('span', { className: 'page-sub' }, '空闲太久时，把话筒递给自己 —— 说不说由它决定'),
        ),

        h('div', { className: 'tools' },
          h('button', { onClick: () => patch({ enabled: !d.enabled }), disabled: busy },
            d.enabled ? '关掉' : '打开'),
          h('button', { onClick: load }, '刷新'),
          h('span', { className: 'pill' }, d.enabled ? '✅ 已打开' : '⏸ 关着'),
          h('span', { className: 'pill' }, d.available ? '控制器已接上' : '❌ 没接上'),
          h('span', { className: 'pill' }, d.canNow ? '现在能开口' : ('现在不能：' + d.why)),
        ),

        // ★ 七道闸门逐条列出来 —— 这是这个面板的主要用途
        h('div', { className: 'gates' },
          ...(d.gates || []).map((g, i) => h('div', { className: 'gate' + (g.pass ? ' on' : ''), key: i },
            h('span', { className: 'gate-dot' }, g.pass ? '●' : '○'),
            h('span', { className: 'gate-name' }, g.name),
            h('span', { className: 'gate-note' }, g.note),
          )),
        ),

        // ── 允许开口的时段 ──
        //
        // **一个都不选 = 全时段。** 这是刻意的默认：让"没配过"和"想全开"
        // 是同一个状态，用户不用先去理解这个功能。
        h('div', { className: 'slotbox' },
          h('div', { className: 'slothead' },
            h('span', { className: 'slottitle' }, '允许开口的时段'),
            h('span', { className: 'slotnote' },
              (d.slots && d.slots.length)
                ? '只在这几类里开口'
                : '没选 —— 全时段都能开口'),
            h('button', {
              onClick: () => patch({ slots: [] }),
              disabled: busy || !(d.slots && d.slots.length),
            }, '恢复全时段'),
          ),
          // 只按**三类**选：峰 / 平 / 谷，用**复选框**。
          //
          // 为什么是复选框不是按钮：按钮看的是"点下去会发生什么"，
          // 复选框看的是"**现在是选中状态**" —— 这里要表达的正是后者。
          // 用真 <input type="checkbox">，键盘也能操作（Tab + 空格）。
          //
          // 勾某一类 = 把属于这类的所有时段一起选上（存储仍然是按段记的，
          // 所以以后想再细化回去不用改数据）。
          h('div', { className: 'slotchecks' },
            ...(['峰', '平', '谷'].map((kind) => {
              const mine = (d.slotTable || []).filter((s) => s.kind === kind)
              const ids = mine.map((s) => s.id)
              const on = ids.length > 0 && ids.every((x) => (d.slots || []).includes(x))
              const isNow = mine.some((s) => d.nowHour >= s.from && d.nowHour < s.to)
              const hours = mine.map((s) => String(s.from).padStart(2, '0') + '–' + String(s.to % 24).padStart(2, '0')).join(' · ')
              const toggle = () => {
                const cur = new Set(d.slots || [])
                if (on) { for (const x of ids) cur.delete(x) } else { for (const x of ids) cur.add(x) }
                patch({ slots: [...cur] })
              }
              return h('label', {
                key: kind,
                className: 'slotchk' + (on ? ' on' : '') + (isNow ? ' now' : ''),
              },
                h('input', {
                  type: 'checkbox',
                  checked: on,
                  disabled: busy,
                  onChange: toggle,
                }),
                h('span', { className: 'slotkind' }, kind),
                h('span', { className: 'slotname' }, kind === '峰' ? '高峰' : kind === '平' ? '平峰' : '低谷'),
                h('span', { className: 'slothours' }, hours),
                isNow ? h('span', { className: 'slotnow' }, '现在') : null,
              )
            })),
          ),
          h('div', { className: 'hintline' },
            '峰 = 早峰 7–9 + 晚峰 18–21，平 = 上午/午间/下午 9–18，谷 = 深夜 0–7 + 晚间 21–24。',
          ),
          h('div', { className: 'hintline' },
            '⚠️ ', h('b', null, '「深夜静默」比这里优先'),
            ' —— 两个都开时静默赢。所以就算选了「低谷」，1~7 点照样不开口；',
            '想让深夜也能说话，得把静默那段一起调掉（在配置文件里）。',
          ),
        ),

        // ── 重启相关的两个开关 ──
        //
        // 为什么值得单独列出来：**改完东西要重启才生效**这件事，
        // 人很容易忘。这个插件能自己认出来"宿主重启过"或者"有改动还没生效"，
        // 然后在**下一次回合结束时**主动说一句 —— 不用你记着回来问。
        h('div', { className: 'slotbox' },
          h('div', { className: 'slothead' },
            h('span', { className: 'slottitle' }, '重启汇报'),
            h('span', { className: 'slotnote' },
              d.pendingRestart ? '⚠️ 检测到重启过 —— 下次回合结束会主动说'
                : d.pendingStale ? '⚠️ 有改动还没生效 —— 下次回合结束会提醒'
                  : (d.procStart ? '当前进程启动于 ' + new Date(d.procStart).toLocaleString('zh-CN') : '还没记下进程启动时刻')),
          ),
          h('div', { className: 'memrow' },
            h('button', { onClick: () => patch({ reportRestart: !d.reportRestart }), disabled: busy },
              d.reportRestart ? '重启汇报：开' : '重启汇报：关'),
            h('button', { onClick: () => patch({ warnStale: !d.warnStale }), disabled: busy },
              d.warnStale ? '改动未生效提醒：开' : '改动未生效提醒：关'),
          ),
          h('div', { className: 'hintline' },
            '「重启汇报」—— 宿主重启之后，主动看一眼状态并跟主人说一句',
            h('b', null, '（不等空闲）'),
            '。重启是你刚做的事，等 25 分钟才说等于永远不说。',
          ),
          h('div', { className: 'hintline' },
            '「改动未生效提醒」—— 插件文件比进程还新的时候，说明有改动要重启才生效。',
            h('b', null, 'HMR 能重载插件代码，但宿主配置不会跟着变'),
            ' —— 所以这句话仍然成立。',
          ),
          h('div', { className: 'hintline' },
            '重启汇报', h('b', null, '只受「允许时段」管，不受深夜静默管'),
            ' —— 它是对你刚做的动作的回执，而且只是往对话里排队投一条消息，',
            '不弹通知。深夜静默仍然管着「主动开口」。',
          ),
          h('div', { className: 'hintline' },
            '说不说仍然由它自己决定，可以只回一个回绝标记。',
          ),
          // ⚠️ 两条设计上的硬规矩，之前踩过坑：
          //   ① 只在"因为改了东西才重启"时发 —— 随手开一下不该弹
          //   ② 投给**你开口的那个对话**，不是"最近有动静的那个"
          h('div', { className: 'hintline' },
            h('b', null, '只在改了东西才发'),
            ' —— 单纯启动一次 DSH 不会弹；上一轮运行期间插件文件被改过才发。',
          ),
          h('div', { className: 'hintline' },
            h('b', null, '发在你开口的那个对话里'),
            ' —— 不是"最近有动静的那个"。还没在哪个对话里说过话，它就等着。',
            d.reportSid
              ? h('span', null, '（这次已绑到 ' + String(d.reportSid).slice(0, 8) + '…）')
              : (d.pendingRestart ? h('span', null, '（还没绑到对话）') : null),
          ),
          // 上一次检查的结论 —— 没触发时**为什么**没触发。
          // 没有这一行，"怎么没汇报"就只能两边一起猜。
          d.lastReportCheck
            ? h('div', { className: 'hintline' },
              '上次检查：', h('b', null, d.lastReportCheck.why),
              '（' + new Date(d.lastReportCheck.at).toLocaleTimeString('zh-CN') + '）')
            : null,
          // 从「认出重启」到「真的说出口」隔了多久。
          // 第一版这里隔了 5 分钟，而当时没有任何数据能看出这件事，只能猜。
          (d.pendingSince && d.reportedAt)
            ? h('div', { className: 'hintline' },
              '上次：从重启到说出口隔了 ',
              h('b', null, spellMinutes(Math.max(0, Math.round((d.reportedAt - d.pendingSince) / 60000)))),
              '（' + new Date(d.pendingSince).toLocaleTimeString('zh-CN') + ' → ' + new Date(d.reportedAt).toLocaleTimeString('zh-CN') + '）')
            : null,
        ),

        h('div', { className: 'tools' },
          h('span', { className: 'pill' }, '空闲门槛 ' + spellMinutes(mins(d.idleMs))),
          h('span', { className: 'pill' }, '间隔至少 ' + spellMinutes(mins(d.minGapMs))),
          h('span', { className: 'pill' }, '一天最多 ' + d.maxPerDay + ' 次'),
          h('span', { className: 'pill' }, '今天已开口 ' + d.sentToday + ' 次'),
          h('span', { className: 'pill' }, '静默 ' + d.quietFrom + '~' + d.quietTo + ' 点'),
        ),
        d.lastSpokeAt
          ? h('div', { className: 'notice' }, '上次开口：' + new Date(d.lastSpokeAt).toLocaleString('zh-CN'))
          : null,

        h('div', { className: 'notice' },
          '⚠️ 它投的不是"你打的字"。投进去的是一条明确标着「dsh-mood 插件空闲提醒」的框，' +
          '把话筒递过去；那一次生成可以选择说，也可以选择只回一个 <silent/>。'),
        h('div', { className: 'notice' },
          '**没有"立刻发一条"按钮** —— 手动触发等于绕开上面这七道闸门，' +
          '而闸门正是这个功能唯一的安全带。想验证就等，或者改阈值。'),
        h(StorageBar, { keys: ['proactive'] }),
      )
    }

    /**
     * 面板底部的存储行。**按文件一行** —— 因为每个文件可以各自放在不同目录。
     *
     * 为什么不单独开一格：设置页里 心情日记 / 时事 / 主动开口 旁边还有
     * 人设、条件反射这些**别的插件**的格子，再来一个光叫「存储位置」的，
     * 根本看不出是谁的。所以折进各面板自己的页脚，并且**写明插件名**。
     *
     * @param {{ keys?: string[] }} props keys = 这个面板管哪几个文件（默认全列）
     */
    function StorageBar(props) {
      const h = React.createElement
      const want = (props && props.keys) || null
      const [st, setSt] = React.useState(null)
      const [openKey, setOpenKey] = React.useState('')
      const [dir, setDir] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [err, setErr] = React.useState('')
      const [done, setDone] = React.useState(null)

      const load = React.useCallback(async () => {
        try { setSt(await getJSON('/storage')) } catch { /* 读不到就先不显示 */ }
      }, [])
      React.useEffect(() => { load() }, [load])

      const go = async (key) => {
        const t = String(dir || '').trim()
        if (!t) { setErr('先填一个目录，比如 D:\\path\\to\\diary'); return }
        const lab = ((st && st.files.find((f) => f.key === key)) || {}).label || key
        if (!window.confirm('把「' + lab + '」搬到\n' + t + '\n\n原位置的文件会在校验通过后删掉。继续？')) return
        setBusy(true); setErr(''); setDone(null)
        try {
          const r = await fetch(API + '/storage', {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json', 'x-dsh-mood': '1' },
            body: JSON.stringify({ dir: t, keys: [key] }),
          })
          const j = await r.json()
          if (!j || !j.ok) throw new Error((j && j.error) || 'HTTP ' + r.status)
          setSt(j); setDone(j.migrated); setDir(''); setOpenKey('')
        } catch (e) { setErr(String((e && e.message) || e)) } finally { setBusy(false) }
      }

      if (!st) return h('div', { className: 'storebar' }, h('div', { className: 'storeline' },
        h('span', { className: 'storeown' }, '心情插件'),
        h('span', { className: 'storepath' }, '存储位置读取中…')))

      const list = (st.files || []).filter((f) => !want || want.includes(f.key))
      const fmt = (v) => (!v ? '0 B' : v < 1024 ? v + ' B' : v < 1048576 ? (v / 1024).toFixed(1) + ' KB' : (v / 1048576).toFixed(1) + ' MB')

      return h('div', { className: 'storebar' },
        ...list.map((f) => h('div', { className: 'storerow', key: f.name },
          h('div', { className: 'storeline' },
            h('span', { className: 'storeown' }, '心情插件'),
            h('span', { className: 'storelab' }, f.label),
            h('span', { className: 'storepath' }, f.dir + (f.exists ? '（' + fmt(f.size) + '）' : '（还没生成）')),
            h('span', { className: 'storebadge' + (f.configured ? ' on' : '') },
              f.configured ? '单独位置' : '跟默认'),
            h('button', { className: 'storetoggle', onClick: () => { setOpenKey(openKey === f.name ? '' : f.name); setErr(''); setDone(null) } },
              openKey === f.name ? '收起' : '换位置'),
          ),
          openKey === f.name
            ? h('div', { className: 'storebody' },
                h('div', { className: 'srcrow' },
                  h('input', {
                    className: 'srcin',
                    placeholder: '新目录，绝对路径，例如 D:\\path\\to\\diary',
                    value: dir,
                    onChange: (e) => setDir(e.target.value),
                    onKeyDown: (e) => { if (e.key === 'Enter') go(f.key) },
                  }),
                  h('button', { onClick: () => go(f.key), disabled: busy || !String(dir).trim() },
                    busy ? '迁移中…' : '只搬「' + f.label + '」'),
                ),
                h('div', { className: 'srchint' },
                  '只搬这一个文件。其它文件的位置不受影响 —— **一个文件一个位置**。'),
              )
            : null,
        )),

        err ? h('div', { className: 'notice bad' }, '❌ ' + err) : null,
        done
          ? h('div', { className: 'notice good' },
              '✅ ' + done.scope + ' 已搬到 ' + done.to + '\n搬了 ' + (done.moved || []).join('、') +
              (done.kept && done.kept.length ? '\n（' + done.kept.join('、') + ' 没删掉，你可以手动清）' : '') +
              '\n**立刻生效，不用重启。**')
          : null,
      )
    }

    // ---------------------------------------------------------------- 挂载

    const inject = ['slots']

    function apply(ctx) {
      const slots = ctx.get('slots')
      if (slots === undefined) return

      // 样式表：**每次挂载都更新内容，并在卸载时摘掉**。
      //
      // ⚠️ 原来是「只注入一次」：`if (!getElementById(...)) { ...appendChild }`。
      //   后果是**插件重载后 CSS 不会更新** —— 改了样式却看不到效果，
      //   会让人以为是代码没生效。而每次 appendChild 新标签又会在卸载后留孤儿样式
      //   （别的插件踩过这个坑，孤儿 <style> 会串味）。
      //   所以：拿到同一个标签、覆盖 textContent、注册 disposer。
      let styleEl = document.getElementById('dsh-mood-style')
      if (!styleEl) {
        styleEl = document.createElement('style')
        styleEl.id = 'dsh-mood-style'
        document.head.appendChild(styleEl)
      }
      styleEl.textContent = CSS
      if (ctx && typeof ctx.effect === 'function') {
        ctx.effect(() => () => {
          try { if (styleEl && styleEl.parentNode) styleEl.parentNode.removeChild(styleEl) } catch {}
        }, 'dsh-mood style')
      }

      // ── 「人设」那一格：**有条件注册** ──
      //
      // 有别的插件管人设时，整个 section **不注册** —— 导航里不会出现，
      // 点不进、改不了，也不会误以为自己在改生效的那份。
      //
      // 先拉一次 /state 看来源；拿不到（宿主没起）就先注册上，
      // 真写的时候 POST 会返回 409，界面会说出来。
      void (async () => {
        let external = false
        try {
          const d = await getJSON('/state')
          external = !!(d.persona && d.persona.source === 'external' && !d.persona.force)
        } catch { /* 拿不到就注册 */ }
        if (external) return
        slots.inject('settings.section', () => slots.register(
          { name: 'settings.section', id: 'persona', order: 25, label: '人设' },
          () => React.createElement(MoodErrorBoundary, null, React.createElement(PersonaPanel, { ctx })),
        ))
      })()

      slots.inject('settings.section', () => slots.register(
        { name: 'settings.section', id: 'memory', order: 29, label: '硬盘记忆' },
        () => React.createElement(MoodErrorBoundary, null, React.createElement(MemoryPanel, { ctx })),
      ))

      slots.inject('settings.section', () => slots.register(
        { name: 'settings.section', id: 'proactive', order: 28, label: '主动开口' },
        () => React.createElement(MoodErrorBoundary, null, React.createElement(ProactivePanel, {})),
      ))

      slots.inject('settings.section', () => slots.register(
        { name: 'settings.section', id: 'mood', order: 26, label: '心情日记' },
        () => React.createElement(MoodErrorBoundary, null, React.createElement(DiaryPanel, { ctx })),
      ))

      // 第二个整页：时事（用户点按钮才去抓，不做后台定时抓取）
      slots.inject('settings.section', () => slots.register(
        { name: 'settings.section', id: 'news', order: 27, label: '时事' },
        () => React.createElement(MoodErrorBoundary, null, React.createElement(NewsPanel, { ctx })),
      ))
      // 品味：档案每轮都注入提示词，这个面板是给它"可改"的入口
      slots.inject('settings.section', () => slots.register(
        { name: 'settings.section', id: 'taste', order: 30, label: '品味' },
        () => React.createElement(MoodErrorBoundary, null, React.createElement(TastePanel, {})),
      ))
      // 经验卡：工作区里那个 procedures/ 文件夹的界面（踩过的坑，按"症状"存）
      slots.inject('settings.section', () => slots.register(
        { name: 'settings.section', id: 'procedures', order: 31, label: '经验卡' },
        () => React.createElement(MoodErrorBoundary, null, React.createElement(ProceduresPanel, {})),
      ))

      // ---- 把设置导航里「心情日记」那格的图标换成黑线条书本 ----
      //
      // 为什么要在 DOM 里改：
      //   宿主 SettingsRoot 的导航图标走的是硬编码表
      //     function navIcon(id) { if (id === 'account') … return IconSettingsOutlineMedium }
      //   未知 id 一律回退到齿轮，插件**没有**参与的机会（package.json.icon 只影响插件页的展示图）。
      //   所以只能等导航渲染出来后，自己把那个 <svg> 的内容换掉。
      //   这是 hack —— 宿主改结构就会失效，所以全部包在 try 里，失败也不影响别处。
      installNavIcon(document, ctx)
    }

    /** 我们接管的三格：标签文字，用来在 DOM 里定位 */
    const NAV_LABEL = '心情日记'
    const NAV_NEWS = '时事'
    const NAV_PERSONA = '人设'
    const NAV_MEMORY = '硬盘记忆'
    const NAV_TASTE = '品味'
    const NAV_TALK = '主动开口'
    const NAV_STORE = '存储位置'
    const NAV_PROC = '经验卡'

    /**
     * 当前是否已获授权（决定画合上还是张开的书本）。
     * 由 DiaryPanel 每次拉到数据后写入；导航图标据此重画。
     */
    let navUnlocked = false

    /** 画的是不是我们自己的图标（书本或报纸） */
    function isBookIcon(svg) {
      return svg.getAttribute('data-dsh-mood-icon') === '1'
    }

    /** 当前画的是张开还是合上 */
    function isOpenIcon(svg) {
      return svg.getAttribute('data-dsh-mood-open') === '1'
    }

    /** 我们接管的几格：标签 → 画法。style 只用来判断"要不要重画" */
    function navStyleFor(label) {
      if (label === NAV_LABEL) return navUnlocked ? 'book-open' : 'book-closed'
      if (label === NAV_NEWS) return 'news'
      if (label === NAV_TASTE) return 'taste'
      if (label === NAV_PROC) return 'procedures'
      if (label === NAV_TALK) return 'talk'
      if (label === NAV_STORE) return 'store'
        if (label === NAV_PERSONA) return 'persona'
        if (label === NAV_MEMORY) return 'memory'
      return ''
    }

    /**
     * 把 svg 画成我们的一种图标。**同一套描边参数**，所以并排看不出是两家做的。
     * @param {SVGElement} svg
     * @param {string} style 'book-open' | 'book-closed' | 'news' | 'talk' | 'store'
     */
    function paintAs(svg, style) {
      try {
        const paths = style === 'procedures' ? PROC_D
          : style === 'taste' ? TASTE_D
          : style === 'book-open' ? BOOK_OPEN_D
          : style === 'book-closed' ? BOOK_CLOSED_D
            : style === 'talk' ? TALK_D
              : style === 'store' ? STORE_D
                  : style === 'persona' ? PERSONA_D
                    : style === 'memory' ? MEMORY_D
                : NEWS_D
        while (svg.firstChild) svg.removeChild(svg.firstChild)
        for (const d of paths) {
          const p = document.createElementNS('http://www.w3.org/2000/svg', 'path')
          p.setAttribute('d', d)
          svg.appendChild(p)
        }
        svg.setAttribute('viewBox', '0 0 24 24')
        svg.setAttribute('fill', 'none')
        svg.setAttribute('stroke', 'currentColor')
        svg.setAttribute('stroke-width', '1.7')
        svg.setAttribute('stroke-linecap', 'round')
        svg.setAttribute('stroke-linejoin', 'round')
        svg.setAttribute('data-dsh-mood-icon', '1')
        svg.setAttribute('data-dsh-mood-open', style === 'book-open' ? '1' : '0')
        svg.setAttribute('data-dsh-mood-style', style)
        return true
      } catch {
        return false
      }
    }

    /**
     * 扫描导航格，把"我们这两格"的图标换成自己的线条图标。
     * 结构：button.navCell > [svg.navIcon, span.navLabel]
     * 画过但状态变了（比如刚同意/收回）也会重画。
     */
    function swapNavIcon(root) {
      let n = 0
      try {
        const buttons = (root || document).querySelectorAll('button')
        for (const btn of buttons) {
          const svg = btn.firstElementChild
          if (!svg || svg.tagName.toLowerCase() !== 'svg') continue
          // 按标签精确定位，避免误伤别的 section
          const span = svg.nextElementSibling
          if (!span) continue
          const want = navStyleFor((span.textContent || '').trim())
          if (!want) continue
          // 已经画对了就跳过；画过但状态变了则重画
          if (isBookIcon(svg) && svg.getAttribute('data-dsh-mood-style') === want) continue
          if (paintAs(svg, want)) n++
        }
      } catch { /* 结构变了就算了 */ }
      return n
    }

    /** 授权状态变化后调一次，让导航图标跟着开合 */
    function refreshNavIcon(unlocked) {
      navUnlocked = !!unlocked
      // ⚠️ 这个空 catch 是**故意的**，不是漏写：
      //    swapNavIcon 内部已经有一层 `catch { /* 结构变了就算了 */ }`，
      //    外面这层是"连那层都挂了，也别让**换图标**这件事影响面板本身"。
      //    （排查脚本会把它列成"静默吞错" —— **它是对的，只是没解释**。）
      try { swapNavIcon(document) } catch { /* 见上：图标是装饰，不该让面板挂 */ }
    }

    function installNavIcon(doc, ctx) {
      try {
        if (!doc || !doc.body) return
        swapNavIcon(doc)
        // 设置面板是懒挂载的，所以常驻观察 + 去抖。
        //
        // ⚠️ 关键：**只在设置面板开着的时候才扫**。
        //    全 body 的 MutationObserver 在流式输出时会被唤醒得非常频繁；
        //    dsh-meme 的源码里专门警告过这一点（"wakes every full-body MutationObserver
        //    in the host"，实测每秒 20+ 次重建）。我们不去凑这个热闹 ——
        //    设置面板不在 DOM 里就直接返回，稳态开销降到一次 querySelector。
        let timer = 0
        const panelOpen = () => {
          try { return !!doc.querySelector('[data-shortcut-modal="settings"]') } catch { return false }
        }
        const scanner = () => {
          if (timer) return
          timer = setTimeout(() => {
            timer = 0
            if (!panelOpen()) return   // 面板没开 → 什么都不做
            swapNavIcon(doc)
          }, 120)
        }
        const observer = new MutationObserver(scanner)
        observer.observe(doc.body, { childList: true, subtree: true })
        if (ctx && typeof ctx.effect === 'function') {
          ctx.effect(() => () => {
            observer.disconnect()
            if (timer) clearTimeout(timer)
          }, 'dsh-mood: nav icon')
        }
      } catch { /* 观察失败就不换，不影响面板本身 */ }
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})

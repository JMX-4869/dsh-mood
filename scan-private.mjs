/**
 * scan-private.mjs —— 打包/提交前的自制扫描：**这台机器上的东西，别跑进公开仓库。**
 *
 * ────────────────────────────────────────────────────────────────
 *  为什么是这个设计
 * ────────────────────────────────────────────────────────────────
 *  起因：我在同一个晚上犯了**三次**同样的错 —— 一边把真路径脱敏，
 *  一边在 CHANGELOG 和注释里又把它抄回去（0.9.2 的提交信息原话就是
 *  「CHANGELOG 里我又把真路径抄了一遍——改成占位」）。
 *
 *  前两次我靠"加词表"解决，而词表治不了：
 *    · 词能穷举，而**我抄的方式每次不一样**
 *    · 更根本的：**词表里得写着那个值** —— 扫描器自己就带着它
 *
 *  所以这一版换了两个判据：
 *
 *  ① **扫"真的存在吗"，不扫"长什么样"。**
 *     `D:/work/_rendertest/node_modules` 和 `C:\Users\<你>\.dsh` 长得一样，
 *     但**前者在这台机器上真的存在，后者不存在**。这一个测试就分开了
 *     "我抄的真路径"和"文档里的示例路径"。
 *
 *  ② **扫描器自己不带真值 —— 全部现推。**
 *     · 工作区名 ← process.cwd() 的 basename
 *     · 数据目录 ← 从 store.json 读出来
 *     · 插件目录 ← import.meta.url
 *     一个都不写死。**不然它自己就是最大的违规源。**
 *
 *  ③ 想加"值"级别的关键词（账号名、作品名）走环境变量
 *     `DSHMOOD_PRIVATE_WORDS=a,b,c` —— 那些推不出来，但也不该进仓库。
 *
 *  用法：
 *    node scan-private.mjs            # 扫，有问题就退出码 1
 *    node scan-private.mjs --json     # 机器可读
 *
 *  ⚠️ 它跑在 `npm test` 的最前面 —— **不是我"记得跑"，是每次都会跑。**
 *     今晚那条唯一没封住的错，就栽在"提交完才想起来扫"。
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, dirname, basename, relative, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = HERE

// ── 跳过这些：二进制、图、以及扫描器自己 ──
// （自己不扫自己 —— 它里面故意有"形似路径"的**示例**，那正是它的测试素材）
const SKIP_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.zip',
  '.woff', '.woff2', '.ttf', '.mp3', '.mp4', '.pdf', '.exe', '.dll'])
const SKIP_NAME = new Set(['scan-private.mjs'])
const SKIP_DIR = new Set(['.git', 'node_modules'])

// ── 自己推：这台机器上"不该出现在公开仓库里"的东西 ──
function selfDerived() {
  const out = { paths: new Set(), words: new Set() }

  // ① 工作区：现在跑在哪、以及常见的那几个
  for (const p of [process.cwd(), HERE]) {
    const b = basename(p)
    if (b && b.length >= 3 && !['dsh-mood', 'resources', 'app', 'src'].includes(b)) out.words.add(b)
  }

  // ② 数据目录：从 store.json 的指针读
  const home = process.env.DSH_HOME || join(process.env.USERPROFILE || process.env.HOME || '', '.dsh')
  for (const cand of [join(home, 'dsh-mood-store.json'), join(home, 'profiles', 'desktop', 'dsh-mood-store.json')]) {
    try {
      const j = JSON.parse(readFileSync(cand, 'utf8'))
      if (j && j.dir) {
        out.paths.add(String(j.dir))
        // 数据目录的**上一级**也值得防（那个名字通常比目录名更私人）
        const up = dirname(String(j.dir))
        if (up && basename(up).length >= 3) out.words.add(basename(up))
        if (basename(String(j.dir)).length >= 3) out.words.add(basename(String(j.dir)))
      }
    } catch { /* 没有就算了 */ }
  }

  // ③ 环境变量里手工加的那些（账号名、作品名 —— 推不出来的）
  for (const w of String(process.env.DSHMOOD_PRIVATE_WORDS || '').split(',')) {
    const t = w.trim()
    if (t.length >= 2) out.words.add(t)
  }
  return out
}

// ── 形似绝对路径的串（不改写自己：这些规则里没有任何真值）──
// ⚠️ 字符类里**不能排除 `<` `>`** —— 第一版排除了，于是
//    `C:\Users\<你>\.dsh` 只匹配到 `C:\Users\`，而**那一段是真的存在的** →
//    占位符过滤没触发，误报。**排除掉的字符，正好是判"这是占位符"要看的那个。**
const PATH_RE = /(?:[A-Za-z]:[\\/]|\/(?:home|Users|mnt|media)\/)[^\s"'`)\]|]{2,200}/g

function walk(dir, acc = []) {
  let ents
  try { ents = readdirSync(dir, { withFileTypes: true }) } catch { return acc }
  for (const e of ents) {
    if (e.isDirectory()) {
      if (SKIP_DIR.has(e.name)) continue
      walk(join(dir, e.name), acc)
    } else if (e.isFile()) {
      if (SKIP_NAME.has(e.name)) continue
      if (SKIP_EXT.has(extname(e.name).toLowerCase())) continue
      if (e.name.endsWith('.zip')) continue
      acc.push(join(dir, e.name))
    }
  }
  return acc
}

const SELF = selfDerived()
const found = []
let scanned = 0

for (const f of walk(ROOT)) {
  let text
  try { text = readFileSync(f, 'utf8') } catch { continue }
  scanned++
  const rel = relative(ROOT, f)
  const lines = text.split('\n')

  lines.forEach((line, i) => {
    // ① 形似路径 → **逐个测存在性**
    for (const m of line.match(PATH_RE) || []) {
      const clean = m.replace(/[.,;：:]+$/, '')
      // ⚠️ 带占位符的**放过** —— 那是文档该有的写法，不是泄漏。
      //    `<你>` / `<用户名>` / `$HOME` 这类，形状像路径但**在这台机器上不存在**，
      //    本来就会被下面的存在性检查放过；这里再明说一次，是因为
      //    `C:\Users\<你>\.dsh` 里的 `C:\Users\` **是真的存在的** ——
      //    光靠存在性会误报，得先看"里面有没有占位符"。
      if (/<[^<>]{1,20}>/.test(clean)) continue
      let real = false
      try { real = existsSync(clean) } catch { real = false }
      if (real) {
        found.push({ file: rel, line: i + 1, kind: '存在的本机路径', hit: clean, text: line.trim().slice(0, 120) })
      }
    }
    // ② 自己推出来的词
    for (const w of SELF.words) {
      if (w && line.includes(w)) {
        found.push({ file: rel, line: i + 1, kind: '本机名词「' + w + '」', hit: w, text: line.trim().slice(0, 120) })
      }
    }
  })
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ scanned, found }, null, 1))
} else {
  console.log('')
  console.log('  ── 扫了 ' + scanned + ' 个文件 ──')
  console.log('  ── 自己推出来的：' + [...SELF.words].join(' / ') + ' ──')
  console.log('  ── 本机路径 ' + SELF.paths.size + ' 条（只用来做存在性判据）──')
  console.log('')
  if (!found.length) {
    console.log('  ✅ 0 处')
  } else {
    // 同一个文件同一行的重复只报一次
    const seen = new Set()
    for (const x of found) {
      const k = x.file + ':' + x.line + ':' + x.kind
      if (seen.has(k)) continue
      seen.add(k)
      console.log('  ⚠️ ' + x.file + ':' + x.line + '  **' + x.kind + '**')
      console.log('       ' + x.text)
    }
    console.log('')
    console.log('  ' + seen.size + ' 处。**改掉再打包** —— 别提交完才想起来扫。')
    console.log('  （文档里的示例路径请写成带占位符的形状，比如 <盘>:\\<目录>\\ —— 那样不存在，就放过了）')
  }
}
process.exit(found.length ? 1 : 0)

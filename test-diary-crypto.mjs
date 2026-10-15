/**
 * 日记加密 —— 在一份**拷贝**上测，不动真文件。
 *
 * 覆盖四件事：
 *   ① 明文旧文件能读（迁移路径）
 *   ② 存一次之后盘上不再是明文（真加密，不是换个后缀）
 *   ③ 再读回来内容一致
 *   ④ **解不开的时候拒绝写**（这是最要紧的一条：不然一次写就把真日记覆盖掉，不可逆）
 */
import fs from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { dirname } from 'node:path'

const TMP = path.join(tmpdir(), '_dshmood_diarytest')
fs.rmSync(TMP, { recursive: true, force: true })
fs.mkdirSync(TMP, { recursive: true })
process.env.DSH_HOME = TMP

const D = await import('./diary.js?t=' + Date.now())
const MB = 1
const out = []
const ok = (n, c, e = '') => out.push('  ' + (c ? '✅' : '❌') + ' ' + n + (e ? '  → ' + e : ''))

// ⚠️ dataFile 可能把文件放到 DSH_HOME 的某个子目录 —— 问它，别猜
const df = D.diaryFile()
const kf = D.diaryKeyFile()
ok('diaryFile 在临时目录里', df.startsWith(TMP.replace(/\//g, path.sep)) || df.startsWith(TMP), df)

// ── ① 明文旧文件
const PLAIN = {
  version: 1,
  entries: [
    { date: '2026-10-14', text: '今天好奇心有点重。', mood: 'curious', createdAt: 1, edited: false },
    { date: '2026-10-15', text: '专注混着焦虑、疲惫。', mood: 'focused', createdAt: 2, edited: false },
  ],
  daily: { '2026-10-14': { messages: 3, turns: 2, words: { 设计: 2 } } },
  access: { allowed: true, at: 1, note: '' },
}
fs.mkdirSync(path.dirname(df), { recursive: true })
fs.writeFileSync(df, JSON.stringify(PLAIN, null, 2), 'utf8')

const d1 = D.loadDiary()
ok('① 明文旧文件读得出来（迁移路径）', !!d1 && d1.entries.length === 2, d1 ? d1.entries.length + ' 篇' : 'null')

// ── ② 存一次 → 盘上变成密文
const saved = D.saveDiary(d1)
ok('② 保存成功', saved === true)
const raw = fs.readFileSync(df)
ok('② 盘上认得出是加密的（有魔数）', D.isEncryptedDiary(raw) === true)
ok('② **盘上搜不到明文了**（"今天好奇心"）', raw.toString('utf8').indexOf('今天好奇心') === -1)
ok('② 也不像个 JSON（首字符不是 {）', raw.subarray(0, 1).toString() !== '{', JSON.stringify(raw.subarray(0, 12).toString()))
ok('② 密钥文件生成了', fs.existsSync(kf))
ok('② 密钥是 32 字节', Buffer.from(fs.readFileSync(kf, 'utf8').trim(), 'base64').length === 32)

// ── ③ 读回来一致
const d2 = D.loadDiary()
ok('③ 读回来还是 2 篇', !!d2 && d2.entries.length === 2)
ok('③ 正文一模一样', !!d2 && d2.entries[0].text === PLAIN.entries[0].text && d2.entries[1].text === PLAIN.entries[1].text)
ok('③ 素材桶也回来了', !!d2 && d2.daily['2026-10-14'].messages === 3)

// ── ④ 解不开时必须拒绝写
// ④-a 换个密钥
const goodKey = fs.readFileSync(kf, 'utf8')
fs.writeFileSync(kf, Buffer.from('x'.repeat(32)).toString('base64'), 'utf8')
const dBad = D.loadDiary()
ok('④a 换密钥后 loadDiary 返回 null（**不是空日记**）', dBad === null, String(dBad))
const refuse = D.saveDiary(D.blankDiary())
ok('④a **拒绝覆盖**（saveDiary 返回 false）', refuse === false, String(refuse))
ok('④a 盘上的文件**没被动过**（还是原来那些字节）', fs.readFileSync(df).equals(raw))
fs.writeFileSync(kf, goodKey, 'utf8')
ok('④a 换回密钥之后又能读了', !!D.loadDiary())

// ④-b 文件被改坏一个字节（GCM 的完整性校验该拦住）
const r2 = fs.readFileSync(df)
r2[r2.length - 1] ^= 0xff
fs.writeFileSync(df, r2)
ok('④b 密文被改过一个字节 → 解密失败', D.loadDiary() === null)
ok('④b 也拒绝覆盖', D.saveDiary(D.blankDiary()) === false)
ok('④b 文件仍然没被动过', fs.readFileSync(df).equals(r2))

// ── ⑤ 空库 / 不存在的文件，不该出岔子
fs.rmSync(df, { force: true })
fs.rmSync(kf, { force: true })
const blank = D.loadDiary()
ok('⑤ 文件不存在 → 空日记（不报错）', blank.entries.length === 0)
ok('⑤ 空库能存下去', D.saveDiary(blank) === true)
ok('⑤ 存完读回来还是空', D.loadDiary().entries.length === 0)
ok('⑤ 空库时也生成了新密钥', fs.existsSync(kf))

fs.rmSync(TMP, { recursive: true, force: true })
console.log(out.join('\n'))
const bad = out.filter((x) => x.includes('❌')).length
console.log('')
console.log('  通过 ' + (out.length - bad) + '  失败 ' + bad)
process.exit(bad ? 1 : 0)

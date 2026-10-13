import * as D from 'file:///D:/chajian/dsh-mood/diary.js'
import * as M from 'file:///D:/chajian/dsh-mood/index.js'

const lbl = (id) => (M.MOODS[id] ? M.MOODS[id].label : id)

// 造一份"同一天，但主导心情不同"的素材，看文风差别
function makeBucket(domMood) {
  const d = D.blankDiary()
  const t0 = new Date(2026, 9, 14, 21, 10).getTime()
  const msgs = [
    '把这个细分补绘做成Live2D模型',
    '细分补绘的图层要重新绑定材质',
    '压缩包里的材质全部绑定上去',
    '材质绑定之后还要能自动导入',
    '细分压缩包里的材质绑定好，源文件打开就自动导入',
    'Live2D模型的参数要能推得动',
    '先把材质绑定的顺序理清楚',
    '材质绑定顺序错了，面部变形器就选不到部件',
  ]
  msgs.forEach((t, i) => D.noteActivity(d, 'message', t0 + i * 17 * 60000, t))
  D.noteActivity(d, 'turn', t0)
  D.noteActivity(d, 'error', t0 + 70 * 60000)
  D.noteActivity(d, 'error', t0 + 85 * 60000)
  D.noteActivity(d, 'error', t0 + 100 * 60000)
  const b = d.daily['2026-10-14']
  // 让指定心情占满
  b.moodMs = { [domMood]: 200 * 60000 }
  b.lastMood = domMood
  return b
}

for (const id of ['calm', 'tired', 'annoyed', 'sulk', 'hyper', 'gloomy', 'proud', 'cracked']) {
  const b = makeBucket(id)
  console.log('┌─ 心情 = ' + lbl(id) + ' ─────────────────────')
  const t = D.composeDiary('2026-10-14', b, lbl)
  console.log(t.split('\n').map((l) => '│ ' + l).join('\n'))
  console.log('└' + '─'.repeat(38))
  console.log()
}

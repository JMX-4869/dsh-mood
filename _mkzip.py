# -*- coding: utf-8 -*-
"""按 package.json 的 files 白名单重打 dsh-mood-pack.zip。

为什么按白名单而不是"压全部"：白名单是**发布契约** ——
npm pack / pnpm pack 走的也是它。zip 和 tgz 必须装同样的东西，
否则"我本机能跑、别人装上不行"这种事还会再来一次（0.14.5 就是这么翻车的）。
"""
import io
import json
import os
import zipfile

SRC = r'D:\chajian\dsh-mood'
BS = chr(92)   # 反斜杠，不写字面量，免得被任何一层转义吃掉

pkg = json.load(io.open(os.path.join(SRC, 'package.json'), encoding='utf-8'))
names = []
missing = []
for n in pkg['files']:
    p = os.path.join(SRC, n.replace('/', os.sep))
    if os.path.isdir(p):
        for dp, _, fs in os.walk(p):
            for f in fs:
                names.append(os.path.relpath(os.path.join(dp, f), SRC))
    elif os.path.isfile(p):
        names.append(n)
    else:
        missing.append(n)

# ⚠️ npm pack 会自动补这几个，而手写 zip 不会 —— 少了 package.json，
#    解出来的目录在 DSH 眼里根本不是个包（读不到版本和入口）。
for auto in ('package.json', 'README.md', 'LICENSE'):
    p = os.path.join(SRC, auto)
    if os.path.isfile(p) and auto not in names:
        names.append(auto)

out = os.path.join(SRC, 'dsh-mood-pack.zip')
tmp = out + '.new'
with zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for n in sorted(set(names)):
        zi = zipfile.ZipInfo(n.replace(BS, '/'))
        zi.compress_type = zipfile.ZIP_DEFLATED
        zi.external_attr = 0o644 << 16
        with io.open(os.path.join(SRC, n), 'rb') as fh:
            z.writestr(zi, fh.read())
os.replace(tmp, out)

uniq = set(names)
js = sorted(n for n in uniq if n.endswith('.js'))
print('    zip: %d 个文件（%d 个 js），%d 字节' % (len(uniq), len(js), os.path.getsize(out)))
if missing:
    print('    白名单里有但不存在：' + ', '.join(missing))
key = ('asr.js', 'measure.js', 'procedures.js', 'sidx.js')
for f in key:
    print('    %s %s' % ('OK ' if f in js else 'MISSING', f))

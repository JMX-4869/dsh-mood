# -*- coding: utf-8 -*-
"""算出「被 import 的本地模块」和 package.json 的 files 白名单之间的差集。

为什么要有这个检查：files 白名单漏一个被 import 的模块，
装出来的包就是**缺件的** —— 而本机因为一直用 cp / 直接解 tarball，
永远看不出来。2026-10-17 就是这么栽的：measure.js / procedures.js /
sidx.js / asr.js 都不在 files 里，而 index.js 和 news.js 直接 import 它们。
"""
import io
import json
import os
import re
import sys

SRC = r'D:\chajian\dsh-mood'
SKIP_DIRS = {'node_modules', '.git', 'fixtures', 'docs', '_sb', '_g', '_e', '_sandbox'}

BS = chr(92)   # 反斜杠，不写字面量，免得被任何一层转义吃掉
def norm(p):
    return p.replace(BS, '/')

pkg = json.load(io.open(os.path.join(SRC, 'package.json'), encoding='utf-8'))
files = set(pkg.get('files') or [])

# 扫所有 .js/.mjs 里的相对 import / export-from
need = {}
pat = re.compile(r"""(?:import|export)[^'"\n]*?from\s*(['"])(\.[^'"]+)\1""")
for dirpath, dirs, names in os.walk(SRC):
    dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
    for n in names:
        if not n.endswith(('.js', '.mjs')):
            continue
        p = os.path.join(dirpath, n)
        try:
            s = io.open(p, encoding='utf-8').read()
        except Exception:
            continue
        for m in pat.finditer(s):
            tgt = os.path.normpath(os.path.join(os.path.dirname(p), m.group(2)))
            base = norm(os.path.relpath(tgt, SRC))
            need.setdefault(base, set()).add(norm(os.path.relpath(p, SRC)))

print('  == 1. 被 import 的本地模块（%d 个）==' % len(need))
missing = []
for b in sorted(need):
    ok = b in files or any(b == f or b.startswith(f.rstrip('/') + '/') for f in files)
    if not ok:
        missing.append(b)
    who = ', '.join(sorted(need[b]))
    print('    %s %-20s <- %s' % ('OK ' if ok else 'MISSING', b, who[:46]))

print()
print('  == 2. files 白名单漏掉的（%d 个）==' % len(missing))
for b in missing:
    p = os.path.join(SRC, b.replace('/', os.sep))
    print('    %s %s' % ('漏' if os.path.exists(p) else '（本来就不存在）', b))

# 还有 .mjs 脚本：不是 import 来的，但测试/工具要用
print()
print('  == 3. files 里现有哪些 js / mjs ==')
in_files = sorted(x for x in files if x.endswith(('.js', '.mjs')))
print('    ' + ' '.join(in_files))

sys.exit(0 if not missing else 2)

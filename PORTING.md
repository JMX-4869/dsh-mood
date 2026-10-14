# 移植说明（给别的平台用）

> 这个插件是**为 DeepSeek Harness 写的**，不能直接挂到别的 AI 上。
> 但**大部分代码可以原样搬** —— 这份文档说明哪些能搬、怎么搬、要换掉什么。
>
> 下面的每个数字和签名都是**从代码里扫出来的**，不是估的。

---

## 一、结论：分三层看

| 层 | 文件 | 大小 | DSH 依赖 | 怎么办 |
|---|---|---|---|---|
| **逻辑** | `store.js` `diary.js` `news.js` `proactive.js` `memory.js` | 91 KB | **0 处** | **原样搬，一行不改** |
| 逻辑（边缘） | `sessions.js` | 7 KB | 2 处 | 改两行 |
| **接线** | `index.js` | 99 KB | 25 处 | 照着重写 |
| **界面** | `client.js` | 71 KB | 44 处 | 重写 |

**没有任何外部依赖**：

```json
"dependencies": {}
```

唯一一个是 `peerDependencies` 里的 `@deepseek-ai/dsh-tools`，**而且只有 `index.js` 用**（就是那个 `defineTool`——声明工具名/参数/输出的一个小包装）。**换成任何平台，这就是一个几十行的小垫片。**

---

## 二、已验证：那 5 个模块真的能脱离 DSH 跑

把 `store.js` / `diary.js` / `news.js` / `proactive.js` / `memory.js`（**91 KB**）拷到一个**空目录**
（没有 `dsh-mood`、没有 `@deepseek-ai`、没有 `package.json`），然后：

```
✅ 5 个全部 import 成功
✅ memory    写入 + 检索跑通
✅ store     路径解析跑通
✅ diary     构造 + 日期工具跑通
✅ proactive 时段判定 / 进程启动时刻跑通
✅ news      正文提取跑通（<script> 被扒掉）
```

**不是"理论上能" —— 是真跑过。**

---

## 三、接口清单（照实抄）

### `store.js`（完全独立）

```
dshHome()                       数据目录（读 $DSH_HOME，没有就用 ~/.dsh）
POINTER_FILE                    位置指针文件
DATA_FILES / FILE_KEYS / KEY_LABELS / KEY_OWNER
readStoreConfig() / readStoreDir() / writeStoreConfig(cfg)
dirForKey(key) / dataDir() / resolveDataDir() / invalidateDataDir()
dataFile(name)                  ★ 所有数据文件的路径都走这个
isCustom() / storageStatus()
humanSize(n) / migrateStorage(targetDir, keys)
```

**搬的时候注意**：数据目录是按文件单独记的（`dirs: { diary: "D:\\日记" }`），
所以 **别直接拼路径**（`路径工具(dataDir(), name)` 那种写法）—— 那会忽略"只把日记搬到别处"这种配置。
一律走 `dataFile(name)`。

### `diary.js` → 依赖 `./store.js`

```
diaryFile() / DIARY_HOUR / DIARY_MINUTE
dateKey(d) / yesterdayKey(now) / diaryDue(now, h, m)
blankDiary() / loadDiary() / saveDiary(d) / writeDiary(d, key, text, moodLabel)
setAccess(d, allowed, note) / canRead(d)
dayBucket(d, key) / words(text) / topWords(bucket, n) / busiestHour(bucket)
noteMood / noteSwitch / noteActivity / dominantMood(bucket)
applyVoice(text, mood) / composeDiary(...) / ensureDiary(...) / pruneDaily(d, keepDays)
```

### `news.js` → 依赖 `./store.js`

```
newsFile() / NEWS_FRESH_MS / NEWS_PROMPT_MAX / NEWS_TITLE_MAX
clean(s)                        去空白/实体，供上面几个函数用
DETAIL_CHARS / DETAIL_MAX_ITEMS / DETAIL_PROMPT_CHARS
guessMedia(url) / htmlToText(html) / pickExcerpt(...) / metaDescription(html)
fetchDetail(item) / enrichItems(items, max) / pickComments(html, max)
ytDlpCandidates() / findYtDlp() / vttToText(vtt) / fetchVideoTranscript(url, maxChars)
parseRss(text, limit) / parseJsonAny(json, limit) / guessKind(url) / makeSource(url, label)
PRESETS / fetchOne(src) / refreshNews(sources, now)
blankNews() / migrateNews(n) / loadNews() / saveNews(n)
addSource / removeSource / isFresh(n, now) / ageMinutes(n, now) / renderForPrompt(n, max)
```

### `proactive.js` → 依赖 `./store.js`

```
proactiveFile() / DEFAULTS / blankProactive() / loadProactive() / saveProactive(p)
SLOTS / slotOf(hour) / slotAllowed(cfg, hour)
sentToday(p, now) / canSpeak(p, now, env)      env = { lastUserAt, busy }（只是参数名）
buildNudge(idleMs) / markSpoke(p, now) / markReplied(p)
processStart(now) / noteBoot(p, now, newestFileMtime)     ← 重启检测
buildRestartNudge(kind) / markReported(p, now)
```

`processStart()` 用 `process.uptime()` 反推进程启动时刻 —— **不要换成"插件加载时刻"**，
热重载会被误判成重启。

### `memory.js`（完全独立）

```
createMemory({ file, log, maxBytes, onlyUser }) → {
  note(kind, text, sessionId, ts)   kind: 'user' | 'assistant'
  flush() / search(query, limit) / recent(n) / stats()
  clear() / moveTo(newDir, onMoved) / load() / path()
}
MIN_CHARS(8) / MAX_CHARS(8000) / DEFAULT_LIMIT(8) / DEFAULT_MAX_BYTES(50 MB)
```

**`maxBytes` 和 `onlyUser` 要传函数**，别传死值 —— 用户在设置页改完必须立刻生效，
传死值的话得重载插件（这个坑在 proactive 那边栽过：改的是副本）。

**路径要传函数**（`file: () => ...`）不要传字符串 —— 用户迁移之后要立刻走新路径。
`moveTo` 的 `onMoved` 回调里必须写配置 + 让缓存失效，**只搬文件是不够的**。

### `sessions.js`（完全独立）

```
words(text) / topWords(bag, n) / scanDay(sessionCtl, dayKey)
```

这个要用宿主的"读会话记录"能力 —— 换平台时改成你自己的。

---

## 四、宿主必须提供的四样东西

接线层（`index.js`）要的就是这四件。**缺一个就有功能不工作**（而且是静默的）：

```
tools.register(def)                        声明工具（记忆、心情、日记、时事）
systemPrompt.section({name, order, interpolate, text})
                                           往系统提示词里插一段
webServer.register({kind, path, handler})  设置页要的 HTTP 接口
sessionController.prompt({sessionId, mode, content})
                                           主动开口：往会话里投一条
```

外加一个**事件流**：每收到用户消息 / 助手回复 / 回合结束就回调一次
（`session/event` 的等价物）。**归档、心情判定、重启汇报全挂在这上面。**

---

## 五、几个踩过的坑，搬的时候别再踩

这些在源码注释里都写了，这里挑最容易忽略的：

1. **注入的框不是对话。** `<system-reminder>` / `<goal_round>` 这类东西走的是
   user/message 事件 —— 不挡的话会被当成"用户说的话"存进归档，检索时返回一堆
   机器生成的提醒。**只认开头**，别全文匹配（用户真在正文里贴 XML 是另一回事）。

2. **内容块要挑类型。** 助手消息的 `content[]` 里除了 `{type:'text'}` 还有推理块。
   不挑的话归档里躺的全是内心话，真正的回复一句没有 —— 而且**不报错**。

3. **两种消息形状不一样。** 用户消息的 data 就是消息本身；
   助手消息包了一层（`{turn, step, message:{...}}`）。取错是静默丢数据。

4. **时间用时间戳，别用序号。** 有的平台事件里带 `seq`（会话内序号，小整数），
   拿它当时间戳会让所有记录变成 1970。

5. **静默 return 要留诊断。** "检测到了但什么都没发生"这类 bug 从外面完全看不出来，
   只能靠用户来问。给每一道 `return` 记一句"为什么没触发"，透到界面上。

6. **别赌字段名。** 会话对象里的 id 有 `header.id` / `id` / `sessionId` 三种可能，
   只试一个的话猜错就是静默失效。

7. **归档必须有体积上限。** 没有上限的东西就是会一直涨 ——
   实测一场重度使用 1 小时 98 条 / 51 KB（约 530 B/条），
   外推每天 1.2 MB、每月 35 MB、每年 0.4 GB。
   数字不吓人，但"装完就不管、三年后打开一个 1 GB 的文件"是错的。
   做法：超上限就**从最旧的开始丢**（刚聊过的比三个月前的有用），丢到 90% 停手
   （别每写一条就重写一次大文件）。

8. **模块级的函数看不见宿主闭包里的变量。**
   这是最阴的一类：`memoryCfg()` / `personaSource()` / `readPersona()` 写在模块级，
   而 `state` 定义在挂载函数**里面**。写 `typeof state !== 'undefined'` 看着像在防，
   其实**永远拿到 undefined** —— 于是静默退回默认值。
   症状：接口返回 `ok: true`、配置文件也写对了，就是读不回来。
   做法：模块级留一个 `liveState`，在挂载时赋值，模块级函数一律走它。

---

## 六、界面那层

`client.js` 用的是 DSH 的 slot 系统 + React，**没打算做成通用的**。
换平台时照着自己的 UI 写；后端所有数据都能从 `/state`（心情/分层/归档统计）
和 `/proactive`（闸门/时段/重启状态）这两个接口拿到。

---

## 七、许可证

MIT。**搬吧，改吧，不用问。**

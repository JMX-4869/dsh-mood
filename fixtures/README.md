# fixtures —— 从**真实接口**抓的快照

这些不是手写的，是 `test-fixtures.mjs` 通过 curl 从跑着的插件上抓下来的。

**为什么不手写：** 第一版 `test-client.mjs` 的桩是我自己编的，结果和真接口对不上 ——
`/memory` 的 recent 少了 `id`/`id8`、`/state` 少了 `mixed`/`unlocked`/`count`、
`/storage` 的字段名**完全不同**、`/diary` 我以为是"返回今天的日记"其实是**单日查询**。
拿编的桩去测，测的是我脑子里的那个接口，不是真的那个。

`_shape.json` 是每个接口的字段清单。`test-fixtures.mjs` 会重新抓一遍和它比 ——
接口改了字段、或者这些快照过期了，都会报出来。

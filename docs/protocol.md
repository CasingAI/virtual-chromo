# virtual-chromo postMessage 协议

virtual-chromo 作为 iframe 嵌入外层「浏览器壳」项目，双方通过 `window.postMessage` 通信。

消息格式统一为数组：`[command, payload?]`

## 安全

- iframe 端可通过 `VirtualChromoBridge.init(allowedOrigins)` 限制允许的来源；默认不限制。
- 父项目应校验 `event.source === iframe.contentWindow`。
- 生产环境建议双方使用明确 origin，避免 `*`。
- **父项目必须与 Worker 不同源**。若父页面与 Worker 在同一域名下，Service Worker 会接管整个站点，导致父页面本身也被代理。

## 浏览状态（单用户）

单 Chromo 实例：全局 cookie jar、按 siteOrigin 隔离的 storage、全局 DevTools hot cache（method+URL+TTL）。

### URL 约定

- Viewer：`https://<worker>/viewer` 或 `/`
- 新标签空白页：`https://<worker>/blank.html`（viewer 在无导航时自动加载；上报 `VC_NAVIGATED { url: '' }`，父级地址栏保持空）
- 代理页：`https://<worker>/-----https://example.com/`
- 旧书签 `/s/<id>/-----…` 仍可解码，但新导航不再生成 `/s/`

### `VC_CLEAR_STATE`

父 → iframe：清空全局 cookie + storage + hot/archive/url-cache。  
iframe → 父：`VC_CLEAR_STATE_DONE`（**等 SW 完成后再回**；payload 可含 `id` / `ok`）。

### Application（存储管理，build `20260728-v17`+）

RPC 均带 `id`，结果为 `*_RESULT`：`{ id, ok, value? | error? }`。

| 命令 | 说明 |
|------|------|
| `VC_COOKIE_LIST` / `DELETE` / `CLEAR` / `CLEAR_ALL` | 全局 cookie jar（含 httpOnly）；DELETE `{ cookieId }`；CLEAR **必须** `{ domain }`；CLEAR_ALL 无参清空全部 |
| `VC_STORAGE_LIST` / `SET` / `REMOVE` / `CLEAR` | `{ type: 'local'\|'session' }`；读写当前页 content 的 Storage hook |
| `VC_IDB_LIST` / `DELETE` / `STORES` / `GET_ALL` | 当前页 IndexedDB（浅表预览） |
| `VC_SITE_CACHE_LIST` / `KEYS` / `DELETE` | 站点 Cache Storage（前缀隔离后的逻辑名） |
| `VC_NETWORK_CACHE_STATS` / `LIST` / `CLEAR` / `CLEAR_ALL` | LIST hot 含 `method`/`url`；CLEAR **必须** `{ origin }`（仅清该站 Hot）；CLEAR_ALL `{ layer: 'hot'\|'archive'\|'all' }` |
| `VC_SW_INFO` | Viewer 代理 SW 状态；`siteServiceWorkerBlocked: true`（站点 SW 注册被禁用） |

### `VC_READY`

payload：`{ version, build }`（**不再含 sessionId**）

> **Breaking（build `20260728-v12`）**：`VC_SESSION_*`（`VC_SESSION_CREATE` / `DESTROY` / `LIST` 及对应事件）已移除。

## 父 → iframe（命令）

### `VC_NAVIGATE`

跳转到指定 URL。

```javascript
iframe.contentWindow.postMessage(['VC_NAVIGATE', { url: 'https://example.com' }], '*')
// POST 表单整页导航（application/x-www-form-urlencoded）：
iframe.contentWindow.postMessage(['VC_NAVIGATE', {
  url: 'https://example.com/results.html',
  method: 'POST',
  body: 'field1=value1&field2=value2',
}], '*')
```

`url` 可带或不带协议；无协议时自动补 `https://`。`method` 省略或为 `GET` 时等价于设置 `#content` iframe 的 `src`；`method: 'POST'` 且带 `body` 时，viewer 向 content iframe 提交隐藏表单（target=`vc-content`）。

### `VC_BACK`

内层浏览上下文后退。

```javascript
iframe.contentWindow.postMessage(['VC_BACK'], '*')
```

### `VC_FORWARD`

内层浏览上下文前进。

```javascript
iframe.contentWindow.postMessage(['VC_FORWARD'], '*')
```

### `VC_RELOAD`

刷新当前页面。

```javascript
iframe.contentWindow.postMessage(['VC_RELOAD'], '*')
```

### `VC_STOP`

停止当前页面加载（等价于浏览器停止按钮 / `window.stop()`），并上报 `VC_LOADING(false)`。

```javascript
iframe.contentWindow.postMessage(['VC_STOP'], '*')
```

### `VC_PING`

健康检查。

```javascript
iframe.contentWindow.postMessage(['VC_PING'], '*')
```

### RPC 接入规范

带 `id` 的请求-响应命令（`VC_EVAL` 及后续的 `VC_CLICK`、`VC_FILL` 等）在协议层是 **postMessage 一来一回**，但**父项目业务代码不应直接裸发 postMessage**。

父项目必须：

1. **封装为 Promise**，用 `await`（或 `.then()`）等待对应的 `VC_*_RESULT`
2. **设置超时**（建议默认 **30 000 ms**），超时后移除 `message` 监听并 reject，避免 listener 泄漏
3. **校验 `event.source === iframe.contentWindow`**，且仅处理匹配 `id` 的响应
4. **每个并发请求使用唯一 `id`**（推荐 `crypto.randomUUID()`）

底层 postMessage 形态（仅供 SDK / helper 内部使用）：

```javascript
iframe.contentWindow.postMessage(['VC_EVAL', {
  id: 'req-1',           // 必填
  code: 'document.title' // 必填
}], targetOrigin)
```

### `VC_EVAL` — 通用原语（读 + 写）

`VC_EVAL` 对应 Playwright 的 `page.evaluate()`，是 virtual-chromo **唯一需要在子页面内完成任意 DOM/JS 操作的通用入口**。

它既用于**执行动作**，也用于**获取信息**——二者同等重要。子页面里原生 JS 已经具备 querySelector、读属性、填表、点击、等待等全部能力；父项目（尤其是 **AI Agent**）应优先通过 `await vcEval(...)` 直接写 JS，而不是假设必须调用 `VC_CLICK`、`VC_QUERY` 等语义化命令。

| 场景 | 应用 eval 读信息 | 用 eval 执行操作 |
|------|------------------|------------------|
| 读标题 / URL | `document.title` | — |
| 读元素文本 | `document.querySelector('h1')?.textContent` | — |
| 批量采集 | `[...document.querySelectorAll('a')].map(a => ({ href: a.href, text: a.textContent }))` | — |
| 读表单状态 | `document.querySelector('#email')?.value` | — |
| 点击 | — | 监听 `VC_CLICK`；SPA 路由跟 `VC_HISTORY`；整页换址由父级 `VC_NAVIGATE` |
| 填表 | — | `const el = document.querySelector('#email'); el.value = 'a@b.c'; el.dispatchEvent(new Event('input', { bubbles: true }))` |
| 等待元素 | `new Promise(r => { const t = setInterval(() => { if (document.querySelector('.ready')) { clearInterval(t); r(true) } }, 100) })` | — |

**设计原则**：

- **Eval-first**：子页面内能写成 JS 的事，都用 `VC_EVAL`；不必等或依赖 `VC_CLICK` / `VC_FILL` / `VC_QUERY` 等语义 API。
- **语义 API 是可选糖**：上述命令是为人类可读 SDK、固定契约或跨语言绑定准备的便利层；协议实现它们时内部也可复用 eval。AI 集成方可以只实现 `vcEval()` + 导航命令即可覆盖绝大部分自动化。
- **返回值须可 JSON 序列化**：eval 中应 `return` 普通对象、数组、字符串、数字、布尔值；不要 return DOM 节点（会得到 `{ __vc: 'unserializable' }`）。需要 DOM 信息时在子页面内提取字段再 return。
- **被动导航（build `20260727-v15`+）**：子页面**不能**自主换页。点击、`location.assign`、`window.open` 等只上报 `VC_CLICK` / `VC_LOCATION`；**唯一**换页入口是父级 `VC_NAVIGATE`（及 `VC_BACK` / `VC_FORWARD` / `VC_RELOAD`）。`VC_EVAL` 内改 location / `.click()` 同样只上报。

在当前已加载的**内层子页面**中执行 JavaScript，并异步返回 `VC_EVAL_RESULT`。

说明：

- **执行包装（build `20260728-v9`+）**：优先按表达式模式包装为 `(async () => { return (code); })()`，若抛出 `SyntaxError` 则回退到语句模式 `(async () => { code })()`。因此：
  - 支持类似 Chrome 的顶层 `await`
  - 单表达式（如 `1+1`、`document.title`）会作为返回值回传
  - 多语句需自行 `return` 最后一式，或写成表达式
- 若返回值是 `Promise`，会等待 resolve 后再回传
- 返回值经 JSON 序列化；无法序列化的类型会包装为 `{ __vc: ... }`（如 `undefined` / `function` / `unserializable`）
- 子页面尚未加载完成时返回 `EVAL_NO_CONTENT`

**推荐用法**（父项目侧 helper + `await`）：

```javascript
const DEFAULT_RPC_TIMEOUT = 30_000

function vcEval(iframe, code, { timeout = DEFAULT_RPC_TIMEOUT, targetOrigin = '*' } = {}) {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID()
    let settled = false

    function finish(fn, arg) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      window.removeEventListener('message', onMessage)
      fn(arg)
    }

    const timer = setTimeout(() => {
      finish(reject, Object.assign(new Error('VC_EVAL timed out'), {
        code: 'EVAL_TIMEOUT',
        id,
        timeout,
      }))
    }, timeout)

    function onMessage(event) {
      if (event.source !== iframe.contentWindow) return
      if (!Array.isArray(event.data)) return
      const [cmd, payload] = event.data
      if (cmd !== 'VC_EVAL_RESULT' || payload.id !== id) return
      if (payload.ok) finish(resolve, payload.value)
      else finish(reject, Object.assign(new Error(payload.error.message), payload.error))
    }

    window.addEventListener('message', onMessage)
    iframe.contentWindow.postMessage(['VC_EVAL', { id, code }], targetOrigin)
  })
}

// 读信息
const title = await vcEval(iframe, 'document.title')
const links = await vcEval(iframe, `[...document.querySelectorAll('a')].map(a => ({ href: a.href, text: a.textContent.trim() }))`)

// 写操作
await vcEval(iframe, `document.querySelector('#submit')?.click()`)

// 复杂逻辑（读 + 写 + 等待）
await vcEval(iframe, `
  const btn = document.querySelector('#login')
  if (!btn) throw new Error('login button not found')
  btn.click()
  return document.title
`, { timeout: 10_000 })
```

### `VC_CONSOLE_READ`

拉取子页面 console 历史（Promise + 超时，见 [RPC 接入规范](#rpc-接入规范)）。

```javascript
// 仅返回 after UUID 之后的条目
await vcRpc('VC_CONSOLE_READ_RESULT', 'VC_CONSOLE_READ', {
  after: lastSeenConsoleId,
  limit: 100,
})
```

### `VC_NETWORK_READ`

拉取 Service Worker 代理的网络请求历史（Promise + 超时，见 [RPC 接入规范](#rpc-接入规范)）。

```javascript
await vcRpc('VC_NETWORK_READ_RESULT', 'VC_NETWORK_READ', {
  after: lastSeenNetworkId,
  limit: 100,
})
```

### `VC_NETWORK_OPTIONS`

配置 Network 缓存行为。`devtoolsId` 仅用于将 **Disable cache** 开关绑定到父页面 tab；热缓存本身为**全局**（method + URL + Cache-Control TTL），不按 session 分区。

```javascript
iframe.contentWindow.postMessage(['VC_NETWORK_OPTIONS', {
  devtoolsId: 'parent-tab-uuid',
  disableCache: true,
}], '*')
```

- `disableCache: true`：跳过热缓存，且 SW 出站 `fetch` 使用 `cache: 'no-store'`
- `disableCache: false`：允许热缓存复用（按 `method + url`，含 Cache-Control TTL；跨 reload 仍可命中未过期条目）
- 未传 `devtoolsId` 时 bridge 使用随机 id，并在 `VC_READY` 后注册到 SW

> Application 存储管理 API（build `20260728-v17`+）：见上文 `VC_COOKIE_*` / `VC_STORAGE_*` / `VC_IDB_*` / `VC_SITE_CACHE_*` / `VC_NETWORK_CACHE_*` / `VC_SW_INFO`。全局清除仍可用 `VC_CLEAR_STATE`。

### `VC_DEBUG_PANEL`

控制 viewer 外壳内置调试面板（绿色「调」浮钮）的显示（build `20260728-v20`+）。

```javascript
iframe.contentWindow.postMessage(['VC_DEBUG_PANEL', { enabled: true }], '*')
```

- `enabled: true`：显示浮钮；可展开日志 / 通讯 / 网络 / 导航 / 状态
- `enabled: false`：隐藏浮钮与已展开面板
- **默认**：嵌入父 iframe（Chromo）时关闭；独立打开 `viewer.html` 时开启（便于开发）
- 隐藏时仍会采集 bridge 内部日志（`vlog` / `vmsg`），仅不渲染 UI
- 与 `VC_DEBUG_OPTIONS`（导航探针）独立；Chromo「扩展」页勾选「Chromo 调试面板」后发送本命令

### `VC_DEBUG_OPTIONS`

导航探针（build `20260728-v19`+）。开启后**抑制**向父窗口上报 `VC_CLICK` / `VC_LOCATION` / `VC_HISTORY`，改为采集调用栈并在 viewer 调试面板「导航」tab 展示；同时发出只读观测事件 `VC_DEBUG_NAV`。

```javascript
iframe.contentWindow.postMessage(['VC_DEBUG_OPTIONS', {
  navProbe: true,
  frameBustGuard: false, // optional; default true
}], '*')
```

- `navProbe: true`：切断父侧自动开 Tab / 自动 `VC_NAVIGATE` 的反馈环；用于排查站点脚本在加载时调用 `window.open` / 改 `location` 等
- `navProbe: false`：恢复正常 `VC_*` 上报
- `frameBustGuard`（build `20260728-v24`+，默认 `true`）：viewer 吞掉同 Tab `open(_top|_self|_parent)`（同 URL noop / 不同 URL 在 viewer 内导航）。设为 `false` 时照常上报 `VC_LOCATION`，便于 A/B 验证 jsfilter AST（阶段 2）
- 也可在 viewer「调」→「导航」本地开关（与本命令同源状态）

**父应用不得根据 `VC_DEBUG_NAV` 执行 `createTab` / `VC_NAVIGATE`。**

### `VC_NETWORK_BODY_READ`

按 network entry UUID 读取**不可变**响应快照（archive 层，与 URL 无关）。

```javascript
await vcRpc('VC_NETWORK_BODY_READ_RESULT', 'VC_NETWORK_BODY_READ', {
  id: 'rpc-1',
  entryId: 'network-entry-uuid',
})
```

成功时 `value` 含 `headers`、`body`（文本前缀或兼容 base64）、`encoding`（`'text'` | `'base64'`）、`status`、`truncated?`。archive/hot **无单条体积上限**（越大越应缓存）；热缓存有全局总配额 LRU。`VC_NETWORK_BODY_READ` 从 Cache **流式读取**至约 64KB 显示前缀，`truncated: true` 表示预览截断（完整内容仍在 Cache）。**图片等二进制预览**继续用本 API（`encoding: 'base64'`）；大文本预览请用下方 `VC_NETWORK_BODY_READ_LINES`。

### `VC_NETWORK_BODY_READ_LINES`

按 network entry UUID **按需读取文本响应的行范围**（0-based 行号）。每次成功响应均含 `totalLines`，供 Monaco / 虚拟列表做滚动占位；协议不暴露 Cache 存储细节。

```javascript
await vcRpc('VC_NETWORK_BODY_READ_LINES_RESULT', 'VC_NETWORK_BODY_READ_LINES', {
  id: 'rpc-1',
  entryId: 'network-entry-uuid',
  fromLine: 0,       // 可选，默认 0；0-based inclusive
  toLine: 80,        // 可选，默认 min(fromLine + 500, totalLines)；0-based exclusive
  metaOnly: false,   // 可选；true 时只返回元信息，lines 为 []
})
```

成功时 `value` 含：

| 字段 | 说明 |
|------|------|
| `headers` | 响应头（同 `VC_NETWORK_BODY_READ`） |
| `status` | HTTP 状态码 |
| `totalLines` | 正文按 `\n` 拆分后的总行数（空 body 为 1） |
| `fromLine` | 实际返回区间起点（clamp 后，0-based inclusive） |
| `toLine` | 实际返回区间终点（clamp 后，0-based exclusive） |
| `lines` | `string[]`，每项为单行文本（不含行尾 `\n`；`\r\n` 已归一） |
| `contentType?` | Content-Type MIME 部分 |
| `charset?` | Content-Type charset |
| `rangeClamped?` | 请求区间或单行长度被服务端截断 |

**行号约定**：`fromLine` 0-based inclusive；`toLine` 0-based exclusive（等同 `lines.slice(fromLine, toLine)`）。单次最多返回 **500 行**；单行最多 **65536** 字符；单次 payload 软上限约 **512KB** UTF-16。

**错误码**：`NETWORK_BODY_BAD_REQUEST`、`NETWORK_BODY_NOT_FOUND`、`NETWORK_BODY_NOT_TEXT`（二进制，请改用 `VC_NETWORK_BODY_READ`）、`NETWORK_BODY_BAD_RANGE`、`NETWORK_BODY_READ_FAILED`、`NETWORK_BODY_TIMEOUT`。

**文本判定**（SW 内部，不暴露给协议）：`text/*`、`application/json|javascript|xml|xhtml+xml`、`image/svg+xml`；`application/octet-stream` 在前 8KB 无 `\0` 且 UTF-8 合法时视为文本。

## iframe → 父（事件）

### 页面生命周期

内层 `#content` 浏览上下文的状态由下列事件描述；父项目应用其驱动地址栏、loading 指示器、自动化「等待加载完成」等逻辑。

| 阶段 | 事件 | payload 要点 | 状态 |
|------|------|--------------|------|
| 即将开始加载 | `VC_NAVIGATING` | `{ url }` | 已有 |
| 正在加载 | `VC_LOADING` | `{ loading: true, url? }` | 已有 |
| 加载完成 | `VC_NAVIGATED` | `{ url, title, canGoBack, canGoForward }` | 已有 |
| 加载结束 | `VC_LOADING` | `{ loading: false }` | 已有（常与 `VC_NAVIGATED` 连续触发） |
| 加载失败 | `VC_LOAD_FAILED` | `{ url, message?, code?, networkCount?, latestNetworkId? }` | 已有 |

典型成功序列（**仅父级下发 `VC_NAVIGATE` 等命令时**）：

```
VC_NAVIGATING → VC_LOADING(true) → VC_NAVIGATED → VC_LOADING(false)
```

子页面内点击链接、改 `location` **不会**触发上述整页加载序列；分别上报 `VC_CLICK` / `VC_LOCATION` / `VC_HISTORY`（SPA 页内路由）。父级对整页换址再发 `VC_NAVIGATE`。

### `VC_READY`

Service Worker 注册完成，bridge 可接收导航命令。

**注意**：SW 更新、iframe 刷新时可能**再次**收到 `VC_READY`。父项目不应在每次 `VC_READY` 里自动 `VC_NAVIGATE`（否则会覆盖用户正在浏览的页面）。仅在首次就绪时导航，或完全由用户/业务逻辑决定首页 URL。

```javascript
// ['VC_READY', { version: '1.3.0', build: '20260728-v12' }]
```

### `VC_NAVIGATING`

开始导航到新 URL。

```javascript
// ['VC_NAVIGATING', { url: 'https://example.com' }]
```

### `VC_NAVIGATED`

内层 iframe 加载完成。

```javascript
// ['VC_NAVIGATED', {
//   url: 'https://example.com',
//   title: 'Example Domain',
//   canGoBack: true,
//   canGoForward: false
// }]
```

**仅**父级下发 `VC_NAVIGATE`（或 `VC_BACK` / `VC_FORWARD` / `VC_RELOAD`）并完成加载后上报。子页点击 / 改 location **不会**触发本事件。

### `VC_CLICK`

子页面发生点击（真鼠标或 `element.click()`）。纯事件，父级无需回复；**不会**因此导航或开浏览器 tab。

```javascript
// ['VC_CLICK', {
//   ts: 1730000000000,
//   tagName: 'A',
//   href: 'https://example.com/path',
//   target: '_blank',
//   text: 'More information...',
// }]
```

### `VC_LOCATION`

子页面试图改地址（`location.assign`、`href=`、`window.open`、`reload`、表单 `submit` 等）。只上报，**不执行**。

```javascript
// ['VC_LOCATION', {
//   ts: 1730000000000,
//   method: 'assign',       // 'assign' | 'replace' | 'reload' | 'open' | 'submit' | ...
//   httpMethod: 'post',     // 仅 method==='submit' 时可选：'get' | 'post'
//   url: 'https://example.com/page#section',
//   formBody: 'a=1&b=2',    // POST urlencoded 字段（method==='submit' && httpMethod==='post'）
//   formEnctype: 'application/x-www-form-urlencoded',
//   formFiles: true,        // 含已选 file input 时；父级应拒绝或提示不支持
// }]
```

`method: 'submit'` 且 `httpMethod: 'post'` 时，父级应发 `VC_NAVIGATE { url, method:'POST', body: formBody }`，**不要**用无 body 的 GET 导航。

**Hash 路由**（build `20260728-v11`+）：子页 `location.hash` / 同文档 `#anchor` 点击在页内完成，上报 `VC_HISTORY { method:'hash'|... }`；父级只同步地址栏，勿 `VC_NAVIGATE`。

### `VC_HISTORY`

子页面 **页内路由**（SPA）：`history.pushState` / `replaceState` / 浏览器 `popstate`（含后退/前进触发的路由变化）。**不**整页 reload；父级无需回复。

与 `VC_NAVIGATED` 的区别：`VC_NAVIGATED` 表示内层 iframe **主文档**加载完成；`VC_HISTORY` 表示**同一文档**内 URL 变化（React Router、Vue Router history 模式等）。

```javascript
// ['VC_HISTORY', {
//   ts: 1730000000000,
//   method: 'pushState',   // 'pushState' | 'replaceState' | 'popstate' | 'hash' | 'href' | ...
//   url: 'https://example.com/about',
//   title: 'About',
//   state: { ... },        // history.state；不可序列化时为 { __vc: 'unserializable' }
// }]
```

**父级处理建议**：

| 事件 | 建议 |
|------|------|
| `VC_CLICK` | 记录点击意图；**不要**默认对有 `href` 的链接立刻 `VC_NAVIGATE` |
| `VC_HISTORY` | 更新地址栏 / 会话状态；表示 SPA 已在页内完成路由 |
| `VC_LOCATION` | 子页想**整页**换地址；再决定是否 `VC_NAVIGATE`。`method:'open'` 且 `target` 为 `_top`/`_self`/`_parent` 表示同上下文导航，**不是**新标签；同 URL 常为 iframe 破框，应忽略或同 Tab 刷新（build `20260728-v22`+ viewer 会在 bridge 侧吞掉同 URL 破框）。build `20260728-v23`+ 另通过 jsfilter AST（`jsfilter_frame_spoof`）改写常见 `top`/`self` 检测以减少破框触发 |

典型 SPA 点击 `<Link href="/about">`：`VC_CLICK` → 子页 `pushState` → `VC_HISTORY`（父级只同步 URL，不 reload）。

### `VC_DEBUG_NAV`

仅在 `navProbe: true`（`VC_DEBUG_OPTIONS` 或 viewer「导航探针」）时发出。payload 与被抑制的导航意图对应，并附带过滤后的 `stack: string[]`。

```javascript
// ['VC_DEBUG_NAV', {
//   kind: 'LOCATION' | 'CLICK' | 'HISTORY',
//   ts: 1730000000000,
//   method: 'open',
//   url: 'https://www.bilibili.com/',
//   target: '_blank',
//   tagName: 'A',
//   stack: ['at ...', '...'],
// }]
```

用于 DevTools / 调试面板展示触发来源；**禁止**据此开 App 标签或整页导航。

### `VC_LOADING`

加载状态变化（见 [页面生命周期](#页面生命周期)）。

```javascript
// ['VC_LOADING', { loading: true, url: 'https://example.com' }]
// ['VC_LOADING', { loading: false }]
```

### `VC_LOAD_FAILED`

内层 iframe 主文档加载失败。

```javascript
// ['VC_LOAD_FAILED', {
//   url: 'https://example.com',
//   message: '...',
//   code: 'LOAD_NETWORK_ERROR',
//   networkCount: 3,           // optional: bridge networkBuffer size at failure
//   latestNetworkId: 'uuid-…', // optional: newest network entry id, or null
// }]
```

`networkCount` / `latestNetworkId` 为诊断字段：父级若 UI 列表为空但 `networkCount > 0`，应立刻用 `VC_NETWORK_READ`（**不传 `after`**）全量回补。加载失败路径不会触发 `VC_NAVIGATED`，父级须在 `VC_LOAD_FAILED` 上主动拉取网络。

### `VC_CONSOLE_UPDATED`

子页面 console ring buffer 有**新条目**。**不包含日志正文**，仅通知上级来拉取；便于父级 DevTools 实时刷新。

```javascript
// ['VC_CONSOLE_UPDATED', { latestId: 'uuid-of-newest-entry', count: 3 }]
// count：自上次通知以来新增条数（可选）
```

收到后调用 `VC_CONSOLE_READ`，传入 `after` 指向上次已读 UUID。

### `VC_NETWORK_UPDATED`

Service Worker 网络 ring buffer 有新条目或既有条目状态更新（如 `pending → done`）。payload 可携带完整 `entry`，父级应 **按 id upsert**；也可再调 `VC_NETWORK_READ` 增量拉取。

```javascript
// ['VC_NETWORK_UPDATED', {
//   latestId: 'uuid-of-newest-entry',
//   count: 3,
//   entry: { id, ts, method, url, status, type, size, duration, failed, bypass, pending, hasBody, fromCache, devtoolsId, requestHeaders, referrer, referrerPolicy, timing, source, sourceHost, errorCode, errorText, proxyUrl }
// }]
```

`pending: true` 表示请求仍在进行（例如 HTML 仍卡在页面初始化握手）；完成后会再推一条同 id、`pending: false` 的更新。

### `VC_ERROR`

错误信息。

```javascript
// ['VC_ERROR', { message: '...', code: 'BAD_URL' }]
```

常见 `code`：

| code | 含义 |
|------|------|
| `NO_IFRAME` | 内层 iframe 未找到 |
| `BAD_URL` | 导航 URL 无效 |
| `INSECURE` | 非 HTTPS 环境 |
| `NO_SW` | 浏览器不支持 Service Worker |
| `SW_REGISTER_FAILED` | SW 注册失败 |
| `HISTORY_ERROR` | 历史导航失败 |
| `RELOAD_ERROR` | 刷新失败 |
| `EVAL_BAD_REQUEST` | `VC_EVAL` 缺少 `id` |
| `EVAL_BAD_CODE` | `VC_EVAL` 缺少合法 `code` |
| `EVAL_NO_FRAME` | 内层 iframe 不存在 |
| `EVAL_NO_CONTENT` | 子页面尚未加载 |
| `EVAL_ACCESS_DENIED` | 无法访问子页面（跨域等） |
| `EVAL_RUNTIME` | 子页面内执行报错 |
| `EVAL_TIMEOUT` | 父项目侧 RPC 超时（未收到 `VC_EVAL_RESULT`） |
| `SCREENSHOT_BAD_REQUEST` | `VC_SCREENSHOT` 缺少 `id` |
| `SCREENSHOT_NO_CONTENT` | 子页面尚未加载 |
| `SCREENSHOT_ACCESS_DENIED` | 无法访问子页面（跨域等） |
| `SCREENSHOT_FAILED` | DOM rasterize / canvas 异常 |
| `SCREENSHOT_TIMEOUT` | 父项目侧 RPC 超时（未收到 `VC_SCREENSHOT_RESULT`） |
| `LOAD_NETWORK_ERROR` | 内层 iframe 网络/文档加载失败（见 `VC_LOAD_FAILED`） |
| `CONSOLE_BAD_REQUEST` | `VC_CONSOLE_READ` 缺少 `id` |
| `NETWORK_BAD_REQUEST` | `VC_NETWORK_READ` 缺少 `id` |

### `VC_CONSOLE_READ` / `VC_CONSOLE_READ_RESULT`

拉取子页面 console 历史。日志在 [`public/inject.js`](../public/inject.js) 中 hook 并经 `_VC_INJECT` 写入 bridge 缓冲，**每条独立 UUID**。

```javascript
// 父 → iframe
// ['VC_CONSOLE_READ', {
//   id: 'req-1',
//   after: 'uuid-last-seen',  // 可选；只返回该 UUID 之后的条目
//   limit: 100                // 可选，默认有上限
// }]

// iframe → 父
// ['VC_CONSOLE_READ_RESULT', {
//   id: 'req-1',
//   ok: true,
//   value: {
//     entries: [
//       { id: 'uuid-1', level: 'log', args: ['hello'], ts: 1710000000000, url: '...' },
//     ],
//     latestId: 'uuid-1'
//   }
// }]
```

**DevTools 式实时 UI**：监听 `VC_CONSOLE_UPDATED` → 用 `after: lastSeenId` 调 `VC_CONSOLE_READ` 增量追加。

### `VC_NETWORK_READ` / `VC_NETWORK_READ_RESULT`

拉取 SW 代理的网络请求历史。请求在 [`public/jsproxy-src/network-log.js`](../public/jsproxy-src/network-log.js) 于 `network.launch` / passthrough 路径记录，经 SW → bridge 缓冲，**每条独立 UUID**。

```javascript
// 父 → iframe
// ['VC_NETWORK_READ', {
//   id: 'req-1',
//   after: 'uuid-last-seen',
//   limit: 100
// }]

// iframe → 父
// ['VC_NETWORK_READ_RESULT', {
//   id: 'req-1',
//   ok: true,
//   value: {
//     entries: [
//       {
//         id: 'uuid-1',
//         ts: 1710000000000,
//         method: 'GET',
//         url: 'https://example.com/',
//         status: 200,
//         type: 'document',
//         size: 1256,
//         duration: 45,
//         failed: false,
//         bypass: false,
//         pending: false,
//         hasBody: true,
//         fromCache: false,
//         devtoolsId: 'parent-tab-uuid',
//         requestHeaders: { accept: '*/*' },
//         requestHeadersTruncated: false,
//         referrer: 'https://example.com/',
//         referrerPolicy: 'strict-origin-when-cross-origin',
//         timing: {
//           queuedAt: 1710000000000,
//           startedAt: 1710000000010,
//           responseAt: 1710000000040,
//           finishedAt: 1710000000045,
//           queueing: 10,
//           waiting: 30,
//           download: 5,
//         },
//       },
//     ],
//     latestId: 'uuid-1'
//   }
// }]
```

entry 字段：`id`, `ts`, `method`, `url`（解码后的目标 URL）, `status`, `type`（`req.destination`）, `size`, `duration`（ms）, `failed`, `bypass`（passthrough 直连）, `pending`（进行中）, `hasBody`（archive 是否存了 body）, `fromCache`（是否来自热缓存）, `devtoolsId`（父 tab Disable-cache 绑定键，不参与 hot key）, `requestHeaders`（请求头对象，序列化软上限约 32KB）, `requestHeadersTruncated`, `referrer`, `referrerPolicy`, `timing`（SW 内 queueing / waiting / download 近似值）, `source`（资源供给渠道：`cache` / `bypass` / `direct` / `cdn` / `proxy` / `native`）, `sourceHost`（`proxy` 时的网关主机名）, `errorCode`（机器可读失败码，如 `ERR_PROXY_FETCH_FAILED` / `ERR_PROXY_BODY_UNUSABLE` / `ERR_PROXY_NETWORK` / `ERR_ABORTED` / `GATEWAY_*` / `HTTP_404`）, `errorText`（人类可读失败原因，代理失败时含网关 host 与底层 message）, `proxyUrl`（代理失败时 SW 尝试的网关 URL，约 512 字符截断）, `initiatorKind`（`fetch` / `xhr` / `import` / `parser` / `other`）, `initiatorChain`（从文档根到资源的 URL 链）, `initiatorStack`（清洗后的 JS 栈帧，Parser 为空）, `initiatorScriptUrl`（调用方脚本 URL）。

`after` 游标：若 UUID 仍在 bridge `networkBuffer` 中，只返回其后的增量；若找不到（客户端清空列表、buffer 轮转等），**从 buffer 头部全量重发**（客户端按 id upsert）。省略 `after` 等价于全量拉取（受 `limit` 限制）。

viewer 与 SW 通过 `PAGE_BUILD_GET { reqId }` / `SW_BUILD_REPLY { reqId, vc_build, vc_version }` 交换 build；不一致时：

- **空白页 / 尚未导航**（`currentContentUrl` 为空且 content 为 blank）：静默 `skipWaiting` + `location.reload()`，**不**上报 `VC_ERROR`、**不**显示 Fatal UI（最多 3 次，超出后仍 Fatal）
- **已加载真实页面**：bridge 进入 Fatal 状态并上报 `VC_ERROR { code: 'VERSION_MISMATCH' }`

响应头与 body 仍通过 `VC_NETWORK_BODY_READ`（二进制/小文本前缀）或 `VC_NETWORK_BODY_READ_LINES`（大文本按行）单独拉取。Initiator：页面侧 hook fetch/XHR，jsfilter 将 `import(` 改写为 `__vcImport(`；经 `PAGE_NETWORK_INITIATOR_TIP` + 请求头 `X-VC-Initiator-Id`（上游剥离）关联到 entry。Parser / 静态 import / passthrough 脚本仅有 referrer 链（见 [KNOWN-ISSUES.md](KNOWN-ISSUES.md)）。

**source 取值**（替代 Chrome Remote Address，标明响应从哪来）：

| source | 含义 |
|--------|------|
| `cache` | DevTools 热缓存命中 |
| `bypass` | Passthrough（如 Turnstile 厂商直连） |
| `direct` | CORS 白名单主机直连 |
| `cdn` | jsDelivr 静态 CDN |
| `proxy` | 经加速网关代理（可带 `sourceHost`） |
| `native` | 非 HTTP 协议原生 fetch |

**timing 字段**（毫秒时间戳与相对时长）：

| 字段 | 含义 |
|------|------|
| `queuedAt` | pending 记录时刻（通常等于 `ts`） |
| `startedAt` | 开始上游 fetch 前 |
| `responseAt` | 收到上游 Response 对象 |
| `finishedAt` | body 流结束 / 写 archive 完成 |
| `queueing` | `startedAt - queuedAt` |
| `waiting` | `responseAt - startedAt`（近似 TTFB） |
| `download` | `finishedAt - responseAt` |

不含 DNS / SSL / Stalled / Proxy negotiation（SW 代理层无 Chrome Resource Timing 同级 API）。

**缓存架构**（SW Cache API）：

| 层 | Key | 用途 |
|----|-----|------|
| archive | `entryId` | DevTools 回看，不可变 |
| hot | `method + url`（URL 经 `normalizeHotUrl`）+ Cache-Control TTL | 全局可复用热缓存；`devtoolsId` 仅控制 Disable Cache 是否跳过 get/put |

仅当无**未过期** hot 条目时 miss；有 fresh 条目才 `fromCache` / `source: cache`。Redirect 链用**原始请求 URL** 作为 hot key，不随 301/302 landing URL 分裂。`hotStored` 字段表示本次是否成功写入热缓存。清空用 `VC_CLEAR_STATE`（全局 cookie / storage / hot / archive / url-cache）；**不再**有 destroy session 清 hot。

### `VC_NETWORK_HOT_PROBE` / `VC_NETWORK_HOT_PROBE_RESULT`

探测 SW 热缓存中是否已有某 URL 条目（诊断用）：

```javascript
await vcRpc('VC_NETWORK_HOT_PROBE_RESULT', 'VC_NETWORK_HOT_PROBE', {
  id: 'rpc-1',
  method: 'GET',
  url: 'https://example.com/a.js',
})
// value: { exists: true|false, fresh: true|false, expiresAt?: number }
```

**DevTools 式实时 UI**：监听 `VC_NETWORK_UPDATED`（优先用 payload.entry upsert）→ 必要时用 `after: lastSeenId` 调 `VC_NETWORK_READ` 增量拉取。若 `after` 游标在 bridge buffer 中找不到（客户端清空 / buffer 轮转），bridge **全量重发**当前窗口（客户端按 id upsert，不会重复）。`VC_LOAD_FAILED` 时父级应再做一次不带 `after` 的全量拉取。

### `VC_SCREENSHOT` / `VC_SCREENSHOT_RESULT`

对**内层 `#content` 网页**截图（默认可视区域 viewport，对齐 Playwright `page.screenshot()`），以 **Base64** 回传。实现使用 [`public/vendor/modern-screenshot.js`](../public/vendor/modern-screenshot.js) 在 viewer 同域读取 `contentDocument` 后 rasterize。

**父 → iframe**

```javascript
// ['VC_SCREENSHOT', {
//   id: 'req-1',           // 必填
//   format: 'jpeg',        // 'jpeg' | 'png'，默认 jpeg
//   quality: 0.72,         // jpeg only，0–1
//   fullPage: false,       // true = 整页 scroll 高度
//   scale: 1,              // 1–2，默认 min(devicePixelRatio, 2)
// }]
```

**iframe → 父（成功）**

```javascript
// ['VC_SCREENSHOT_RESULT', {
//   id: 'req-1',
//   ok: true,
//   value: {
//     mime: 'image/jpeg',
//     encoding: 'base64',
//     data: '<raw base64，无 data: 前缀>',
//     dataUrl: 'data:image/jpeg;base64,...',
//     width: 1200,
//     height: 800,
//   }
// }]
```

**iframe → 父（失败）**

```javascript
// ['VC_SCREENSHOT_RESULT', {
//   id: 'req-1',
//   ok: false,
//   error: { message: '...', code: 'SCREENSHOT_FAILED' }
// }]
```

推荐父项目侧超时 **60 000 ms**（rasterize 慢于 eval）。Vision / 多模态模型可直接使用 `value.dataUrl` 或 `data:image/jpeg;base64,` + `value.data`。

**推荐用法**（Promise + 超时）：

```javascript
function vcScreenshot(iframe, options = {}, { timeout = 60_000, targetOrigin = '*' } = {}) {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID()
    let settled = false
    function finish(fn, arg) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      window.removeEventListener('message', onMessage)
      fn(arg)
    }
    const timer = setTimeout(() => {
      finish(reject, Object.assign(new Error('VC_SCREENSHOT timed out'), {
        code: 'SCREENSHOT_TIMEOUT',
        id,
        timeout,
      }))
    }, timeout)
    function onMessage(event) {
      if (event.source !== iframe.contentWindow) return
      if (!Array.isArray(event.data)) return
      const [cmd, payload] = event.data
      if (cmd !== 'VC_SCREENSHOT_RESULT' || payload.id !== id) return
      if (payload.ok) finish(resolve, payload.value)
      else finish(reject, Object.assign(new Error(payload.error.message), payload.error))
    }
    window.addEventListener('message', onMessage)
    iframe.contentWindow.postMessage(['VC_SCREENSHOT', { id, ...options }], targetOrigin)
  })
}
```

注入方式：[`public/conf.js`](../public/conf.js) 的 `inject_html` 使用 **Worker 绝对 URL**（prepended HTML 含 `<base href="目标站">`，相对路径会解析错）。版本：`VC_VERSION` / `VC_BUILD`；inject 启动日志 `[virtual-chromo] inject.js v...`；内层 iframe 可查 `window.__vcInjected`。

### 内部通道：`_VC_INJECT` / `__vcOnInjectConsole`（不对外）

`inject.js` → `bridge.js`：优先调用 viewer 上的 `__vcOnInjectConsole(entry)` / `__vcOnInjectClick` / `__vcOnInjectLocation` / `__vcOnInjectHistory`（绕过 jsproxy 对 `postMessage` 的 hook）；回退 `['_VC_INJECT', kind, payload]`（kind 为 `CONSOLE` | `CLICK` | `LOCATION` | `HISTORY`）。**父项目不应监听或发送**；对外分别对应 `VC_CONSOLE_*`、`VC_CLICK`、`VC_LOCATION`、`VC_HISTORY`。

### 子页面内：原生 dialog 处理

不向上级发送 dialog 事件。代理注入层替换 `alert` / `confirm` / `prompt`：

- `alert` → noop
- `confirm` → 返回 `false`
- `prompt` → 返回 `null`
- 每次调用 `console.warn('[virtual-chromo] native dialog skipped:', ...)`
- **`beforeunload` 不拦截**（保留调试与 SW 刷新行为）。已在 [`public/inject.js`](../public/inject.js) 实现。

### `VC_EVAL_RESULT`

`VC_EVAL` 的响应。

```javascript
// 成功
// ['VC_EVAL_RESULT', { id: 'req-1', ok: true, value: 'Example Domain' }]

// 失败
// ['VC_EVAL_RESULT', {
//   id: 'req-1',
//   ok: false,
//   error: { message: '...', code: 'EVAL_RUNTIME', stack?: '...' }
// }]
```

特殊返回值包装：

| value | 含义 |
|-------|------|
| `{ __vc: 'undefined' }` | 表达式结果为 `undefined` |
| `{ __vc: 'function', name: '...' }` | 函数 |
| `{ __vc: 'bigint', value: '...' }` | BigInt |
| `{ __vc: 'unserializable', ... }` | 无法 JSON 序列化（如 DOM 节点） |

### `VC_PONG`

响应 `VC_PING`。

```javascript
// ['VC_PONG']
```

## 推荐接入流程

1. 父页面嵌入 `<iframe src="https://your-worker.workers.dev/viewer">`
2. 监听 `message`，等待 `VC_READY`（标记 bridge 可接收命令）
3. 由用户操作或业务逻辑发送 `VC_NAVIGATE`（不要在每次 `VC_READY` 里硬编码首页）
4. 监听页面生命周期：`VC_NAVIGATING` / `VC_LOADING` / `VC_NAVIGATED` / `VC_LOAD_FAILED`
5. 子页面内的**读信息、操作 DOM、等待逻辑**优先通过 `vcEval()`（Promise + 超时）执行
6. Console：监听 `VC_CONSOLE_UPDATED`，用 `VC_CONSOLE_READ` + `after` UUID 增量拉取
7. Network：监听 `VC_NETWORK_UPDATED`，用 `VC_NETWORK_READ` + `after` UUID 增量拉取；`VC_LOAD_FAILED` 时用不带 `after` 的全量拉取回补
8. 截图：用 `vcScreenshot()` 获取子页面 Base64 图像（供 vision / 调试）
9. 用户点击后退/前进/刷新时发送对应命令

## 嵌入示例

```html
<iframe
  id="chromo"
  src="https://your-worker.workers.dev/viewer"
  sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
  style="width:100%;height:100%;border:none"
></iframe>
```

```javascript
const iframe = document.getElementById('chromo')
let chromoReady = false

window.addEventListener('message', (event) => {
  if (event.source !== iframe.contentWindow) return
  const [cmd, payload] = event.data

  switch (cmd) {
    case 'VC_READY':
      chromoReady = true
      // 导航由地址栏 / 业务决定，勿在每次 VC_READY 里强制跳转
      break
    case 'VC_NAVIGATED':
      console.log(payload.url, payload.title)
      break
    case 'VC_ERROR':
      console.error(payload.code, payload.message)
      break
  }
})

function goto(url) {
  if (!chromoReady) return
  iframe.contentWindow.postMessage(['VC_NAVIGATE', { url }], '*')
}
```

# virtual-chromo postMessage 协议

virtual-chromo 作为 iframe 嵌入外层「浏览器壳」项目，双方通过 `window.postMessage` 通信。

消息格式统一为数组：`[command, payload?]`

## 安全

- iframe 端可通过 `VirtualChromoBridge.init(allowedOrigins)` 限制允许的来源；默认不限制。
- 父项目应校验 `event.source === iframe.contentWindow`。
- 生产环境建议双方使用明确 origin，避免 `*`。
- **父项目必须与 Worker 不同源**。若父页面与 Worker 在同一域名下，Service Worker 会接管整个站点，导致父页面本身也被代理。

## 父 → iframe（命令）

### `VC_NAVIGATE`

跳转到指定 URL。

```javascript
iframe.contentWindow.postMessage(['VC_NAVIGATE', { url: 'https://example.com' }], '*')
```

`url` 可带或不带协议；无协议时自动补 `https://`。

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
| 点击 | — | `document.querySelector('#login')?.click()` |
| 填表 | — | `const el = document.querySelector('#email'); el.value = 'a@b.c'; el.dispatchEvent(new Event('input', { bubbles: true }))` |
| 等待元素 | `new Promise(r => { const t = setInterval(() => { if (document.querySelector('.ready')) { clearInterval(t); r(true) } }, 100) })` | — |

**设计原则**：

- **Eval-first**：子页面内能写成 JS 的事，都用 `VC_EVAL`；不必等或依赖 `VC_CLICK` / `VC_FILL` / `VC_QUERY` 等语义 API。
- **语义 API 是可选糖**：上述命令是为人类可读 SDK、固定契约或跨语言绑定准备的便利层；协议实现它们时内部也可复用 eval。AI 集成方可以只实现 `vcEval()` + 导航命令即可覆盖绝大部分自动化。
- **返回值须可 JSON 序列化**：eval 中应 `return` 普通对象、数组、字符串、数字、布尔值；不要 return DOM 节点（会得到 `{ __vc: 'unserializable' }`）。需要 DOM 信息时在子页面内提取字段再 return。
- **仍建议保留专用命令的场景**：`VC_NAVIGATE` 等导航（操作 viewer 外壳）；页面生命周期事件（#15–#17、#32）；`VC_CONSOLE_READ` / `VC_CONSOLE_UPDATED`；`VC_SCREENSHOT` 标为待实现，细节后议。

在当前已加载的**内层子页面**中执行 JavaScript，并异步返回 `VC_EVAL_RESULT`。

说明：

- 代码通过子页面 `window.eval()` 执行，可写表达式或多行语句
- 若返回值是 `Promise`，会等待 resolve 后再回传
- 返回值经 JSON 序列化；无法序列化的类型会包装为 `{ __vc: ... }`
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

## iframe → 父（事件）

### 页面生命周期

内层 `#content` 浏览上下文的状态由下列事件描述；父项目应用其驱动地址栏、loading 指示器、自动化「等待加载完成」等逻辑。

| 阶段 | 事件 | payload 要点 | 状态 |
|------|------|--------------|------|
| 即将开始加载 | `VC_NAVIGATING` | `{ url }` | 已有 |
| 正在加载 | `VC_LOADING` | `{ loading: true, url? }` | 已有 |
| 加载完成 | `VC_NAVIGATED` | `{ url, title, canGoBack, canGoForward }` | 已有 |
| 加载结束 | `VC_LOADING` | `{ loading: false }` | 已有（常与 `VC_NAVIGATED` 连续触发） |
| 加载失败 | `VC_LOAD_FAILED` | `{ url, message?, code? }` | 已有 |

典型成功序列：

```
VC_NAVIGATING → VC_LOADING(true) → VC_NAVIGATED → VC_LOADING(false)
```

用户点击页面内链、后退/前进触发的导航同样走上述序列。失败时发 `VC_LOAD_FAILED`（必要时另附 `VC_ERROR`）。

### `VC_READY`

Service Worker 注册完成，可接收导航命令。

```javascript
// ['VC_READY', { version: '1.0.0' }]
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

用户点击页面内链接触发的跳转也会上报此事件。

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
//   code: 'LOAD_NETWORK_ERROR'
// }]
```

### `VC_CONSOLE_UPDATED`

子页面 console ring buffer 有**新条目**。**不包含日志正文**，仅通知上级来拉取；便于父级 DevTools 实时刷新。

```javascript
// ['VC_CONSOLE_UPDATED', { latestId: 'uuid-of-newest-entry', count: 3 }]
// count：自上次通知以来新增条数（可选）
```

收到后调用 `VC_CONSOLE_READ`，传入 `after` 指向上次已读 UUID。

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
| `LOAD_NETWORK_ERROR` | 内层 iframe 网络/文档加载失败（见 `VC_LOAD_FAILED`） |
| `CONSOLE_BAD_REQUEST` | `VC_CONSOLE_READ` 缺少 `id` |

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

注入方式：[`public/conf.js`](../public/conf.js) 的 `inject_html` 经 jsproxy 插入代理 HTML（helper 之后、页面脚本之前）。实现见 [`public/inject.js`](../public/inject.js)。

### 内部通道：`_VC_INJECT`（不对外）

`inject.js` → `bridge.js` 使用 `['_VC_INJECT', 'CONSOLE', entry]`。**父项目不应监听或发送此消息**；对外仅 `VC_CONSOLE_UPDATED` + `VC_CONSOLE_READ`。

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

1. 父页面嵌入 `<iframe src="https://your-worker.workers.dev/viewer.html">`
2. 监听 `message`，等待 `VC_READY`
3. 发送 `VC_NAVIGATE` 加载首页
4. 监听页面生命周期：`VC_NAVIGATING` / `VC_LOADING` / `VC_NAVIGATED` / `VC_LOAD_FAILED`
5. 子页面内的**读信息、操作 DOM、等待逻辑**优先通过 `vcEval()`（Promise + 超时）执行
6. Console：监听 `VC_CONSOLE_UPDATED`，用 `VC_CONSOLE_READ` + `after` UUID 增量拉取
7. 用户点击后退/前进/刷新时发送对应命令

## 嵌入示例

```html
<iframe
  id="chromo"
  src="https://your-worker.workers.dev/viewer.html"
  sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
  style="width:100%;height:100%;border:none"
></iframe>
```

```javascript
const iframe = document.getElementById('chromo')

window.addEventListener('message', (event) => {
  if (event.source !== iframe.contentWindow) return
  const [cmd, payload] = event.data

  switch (cmd) {
    case 'VC_READY':
      iframe.contentWindow.postMessage(
        ['VC_NAVIGATE', { url: 'https://example.com' }],
        '*'
      )
      break
    case 'VC_NAVIGATED':
      console.log(payload.url, payload.title)
      break
    case 'VC_ERROR':
      console.error(payload.code, payload.message)
      break
  }
})
```

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

### `VC_EVAL`

在当前已加载的**内层子页面**中执行 JavaScript，并异步返回结果。

```javascript
iframe.contentWindow.postMessage(['VC_EVAL', {
  id: 'req-1',           // 必填，父页面生成的请求 ID，用于匹配响应
  code: 'document.title' // 必填，在子页面 global 作用域下执行的 JS 代码
}], '*')
```

说明：

- 代码通过子页面 `window.eval()` 执行，可写表达式或多行语句
- 若返回值是 `Promise`，会等待 resolve 后再回传
- 返回值经 JSON 序列化；无法序列化的类型会包装为 `{ __vc: ... }`
- 子页面尚未加载完成时返回 `EVAL_NO_CONTENT`

父页面辅助函数示例：

```javascript
function vcEval(iframe, code) {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID()
    function onMessage(event) {
      if (event.source !== iframe.contentWindow) return
      if (!Array.isArray(event.data)) return
      const [cmd, payload] = event.data
      if (cmd !== 'VC_EVAL_RESULT' || payload.id !== id) return
      window.removeEventListener('message', onMessage)
      if (payload.ok) resolve(payload.value)
      else reject(Object.assign(new Error(payload.error.message), payload.error))
    }
    window.addEventListener('message', onMessage)
    iframe.contentWindow.postMessage(['VC_EVAL', { id, code }], '*')
  })
}

// 用法
const title = await vcEval(iframe, 'document.title')
const html = await vcEval(iframe, 'document.body.innerHTML.slice(0, 200)')
```

## iframe → 父（事件）

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

加载状态变化。

```javascript
// ['VC_LOADING', { loading: true }]
// ['VC_LOADING', { loading: false }]
```

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
4. 监听 `VC_NAVIGATED` 更新地址栏与导航按钮状态
5. 需要操作子页面 DOM/JS 时，发送 `VC_EVAL` 并等待 `VC_EVAL_RESULT`
6. 用户点击后退/前进/刷新时发送对应命令

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

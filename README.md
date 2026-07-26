# virtual-chromo

基于 [jsproxy](https://github.com/EtherDream/jsproxy) 的 iframe WebView 反向代理，部署在 Cloudflare Worker 上。外层父项目通过 postMessage 控制导航，组件本身不提供地址栏或站点列表。

## 架构

- **Worker**（`src/worker/index.js`）：`/http/` 代理 API + `public/` 静态资源
- **viewer.html**：iframe 外壳，注册 Service Worker，内层 `#content` iframe 加载代理页面
- **bridge.js**：与父项目的 postMessage 协议（见 [docs/protocol.md](docs/protocol.md)）

## 开发

```bash
npm install
npm run dev
```

Worker 默认运行在 `http://localhost:8787`。

### 本地测试父项目 Demo

父项目必须与 Worker **不同源**（否则 Service Worker 会接管整个域名）。推荐：

```bash
# 终端 1：Worker
npm run dev

# 终端 2：父项目 Demo（8788 端口）
cd docs && python3 -m http.server 8788
```

打开 `http://localhost:8788/parent-demo.html`。

## 部署

在 `wrangler.toml` 中设置 Cloudflare `account_id`，然后：

```bash
npm run deploy
```

部署后 iframe 地址：`https://<your-worker>.workers.dev/viewer.html`

## 父项目接入

```html
<iframe
  id="chromo"
  src="https://your-worker.workers.dev/viewer.html"
  sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
  style="width:100%;height:100%;border:none"
></iframe>
```

```javascript
iframe.contentWindow.postMessage(['VC_NAVIGATE', { url: 'https://example.com' }], '*')
```

完整协议见 [docs/protocol.md](docs/protocol.md)（含 `VC_EVAL` 在子页面执行 JS），示例见 [docs/parent-demo.html](docs/parent-demo.html)。

## 注意事项

- 首次打开 `viewer.html` 会安装 Service Worker 并自动刷新一次
- 父项目页面不要与 Worker 部署在同一域名根路径下
- 继承 jsproxy CF Worker 版限制：无 WebSocket 代理、无外链白名单

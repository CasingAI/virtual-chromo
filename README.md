# virtual-chromo

基于 [jsproxy](https://github.com/EtherDream/jsproxy) 的 iframe WebView 反向代理，部署在 Cloudflare Worker 上。外层父项目通过 postMessage 控制导航，组件本身不提供地址栏或站点列表。

**目标**：对外像一个 [Playwright](https://playwright.dev/) 控制的浏览器——父项目不能直接访问 iframe 内 DOM，但通过协议可以导航、执行脚本、操作页面。完整路线图见 **[PLAN.md](PLAN.md)**。

## Roadmap

- [x] Worker 代理 + iframe 外壳 + 基础 postMessage 导航
- [x] `VC_EVAL`：在子页面远程执行 JS 并取回结果
- [ ] 端到端验证（跨源父项目 + Worker 分源部署）
- [ ] Playwright 式语义命令（click / fill / waitFor / query，**可选**；eval 原语优先）
- [x] 页面加载失败事件 `VC_LOAD_FAILED`
- [x] Console：`VC_CONSOLE_UPDATED` + `VC_CONSOLE_READ`（UUID 增量）
- [x] `public/inject.js`（console hook、dialog noop）
- [ ] screenshot（**待实现**，细节后议）
- [ ] 父项目 Page SDK（`createChromoPage(iframe)`）
- [ ] 用可读源码替换 jsproxy 压缩 `bundle.js`
- [ ] 生产加固（origin 白名单、SSRF 防护、WebSocket）

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

部署后 iframe 地址：`https://<your-worker>.workers.dev/`（**不要用** `/viewer.html`，SW 激活后会误路由）

## 父项目接入

```html
<iframe
  id="chromo"
  src="https://your-worker.workers.dev/"
  sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
  style="width:100%;height:100%;border:none"
></iframe>
```

```javascript
iframe.contentWindow.postMessage(['VC_NAVIGATE', { url: 'https://example.com' }], '*')
```

完整协议见 [docs/protocol.md](docs/protocol.md)（含 `VC_EVAL` 在子页面执行 JS），示例见 [docs/parent-demo.html](docs/parent-demo.html)。已知限制见 [docs/KNOWN-ISSUES.md](docs/KNOWN-ISSUES.md)。

## 注意事项

- 首次打开 iframe 入口（`/`）会安装 Service Worker 并自动刷新一次
- 父项目页面不要与 Worker 部署在同一域名根路径下
- 继承 jsproxy CF Worker 版限制：无 WebSocket 代理、无外链白名单

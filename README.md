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
- [x] **被动 WebView**（build `20260727-v15`+）：子页不自主换页；`VC_CLICK` / `VC_LOCATION` 上报意图，父级 `VC_NAVIGATE` 为唯一整页换址入口
- [x] **SPA 页内路由**（build `20260727-v16`+）：`pushState` / `replaceState` / `popstate` 上报 `VC_HISTORY`
- [x] **Session / BrowserContext**（build `20260727-v17`+）：`/s/<sessionId>/` 路由、cookie/storage 按 session 隔离、多 tab 共享、`VC_SESSION_*` 协议
- [ ] screenshot（**待实现**，细节后议）
- [ ] 父项目 Page SDK（`createChromoPage(iframe)`）
- [ ] 用可读源码替换 jsproxy 压缩 `bundle.js`
- [ ] 生产加固（origin 白名单、SSRF 防护、WebSocket）

## 架构

- **Worker**（`src/worker/index.js`）：`/http/` 代理 API + `public/` 静态资源
- **viewer.html**：iframe 外壳，注册 Service Worker，内层 `#content` iframe 加载代理页面
- **bridge.js**：与父项目的 postMessage 协议（见 [docs/protocol.md](docs/protocol.md)）
- **被动 WebView**：子页点击 / 改 location 只上报（`VC_CLICK` / `VC_LOCATION` / `VC_HISTORY`），不自主导航；整页换址仅由父级 `VC_NAVIGATE` 触发
- **Session（BrowserContext）**：每个 `sessionId` 独立 cookie / storage；URL 前缀 `/s/<sessionId>/`；同一 session 多 tab 共享登录态（见 [docs/protocol.md#sessionbrowsercontext](docs/protocol.md)）
- **bundle.built.js**：jsproxy 源码构建产物（Service Worker 运行时加载；见 [jsproxy-src/](public/jsproxy-src/)）
  - [bundle.formatted.js](public/bundle.formatted.js) — beautify 副本（`npm run format:bundle`）
  - [bundle.reconstructed.js](public/bundle.reconstructed.js) — 还原可读源码（变量名、模块结构；`npm run reconstruct:bundle`）

## 开发

```bash
npm install
npm run dev
```

Worker 默认运行在 `http://localhost:8787`。

### 用源码构建 bundle 做功能测试

`bundle.reconstructed.js` **不能直接运行**（ES modules 拼接版，仅供阅读）。要实际替换运行时 bundle：

```bash
npm run build:bundle          # 从 public/jsproxy-src 打包 → public/bundle.built.js
```

在 `public/sw.js` 里切换一行：

```javascript
const VC_BUNDLE = 'bundle.built.js'  // 测试自研构建
// const VC_BUNDLE = 'bundle.js'     // 默认：上游压缩版
```

改 bundle 后 bump `VC_BUILD`（`sw.js` 与 `conf.js` 同步），硬刷新或清 SW 缓存后再测。

本地已验证：`bundle.built.js` 可正常代理 example.com（导航 + 页面渲染）。


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

部署后 iframe 入口：`https://<your-worker>.workers.dev/s/<sessionId>/`

- **推荐**：父项目为每个 BrowserContext 生成 UUID，iframe `src` 指向 `/s/<uuid>/`
- **Legacy**：根路径 `/` 归入 `default` session（与 `/s/…` 状态不互通，deprecated）

## 父项目接入

每个 iframe 对应一个 **session**（Playwright 的 `BrowserContext`）。不同 session 之间 cookie / storage 隔离；同一 session 内开多个 iframe 则共享登录态。

```html
<iframe
  id="chromo"
  src="https://your-worker.workers.dev/s/YOUR-SESSION-UUID/"
  sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
  style="width:100%;height:100%;border:none"
></iframe>
```

也可先嵌入任意入口，再由 iframe 内创建 session 并跳转：

```javascript
// 创建 session（iframe 会导航到 /s/<id>/ 并上报 VC_SESSION_CREATED）
iframe.contentWindow.postMessage(['VC_SESSION_CREATE', {}], '*')

// 监听就绪后导航
window.addEventListener('message', (event) => {
  if (event.source !== iframe.contentWindow) return
  if (event.data[0] === 'VC_READY') {
    iframe.contentWindow.postMessage(['VC_NAVIGATE', { url: 'https://example.com' }], '*')
  }
})

// 销毁 BrowserContext（清空该 session 全部 cookie / storage）
iframe.contentWindow.postMessage(['VC_SESSION_DESTROY', { sessionId: 'YOUR-SESSION-UUID' }], '*')
```

`VC_NAVIGATE` 等命令不变；bridge 会自动把代理路径写成 `/s/<sessionId>/-----https://…`。

**导航事件分工**（SPA 站点必读）：

| 事件 | 含义 | 父级建议 |
|------|------|----------|
| `VC_CLICK` | 子页发生点击 | 记录意图；不要默认对有 `href` 的链接立刻 navigate |
| `VC_HISTORY` | SPA 页内路由（pushState / popstate） | 同步地址栏，不要 reload |
| `VC_LOCATION` | 子页想整页换址 | 再决定是否 `VC_NAVIGATE` |

完整协议见 [docs/protocol.md](docs/protocol.md)（含 `VC_EVAL` 在子页面执行 JS），示例见 [docs/parent-demo.html](docs/parent-demo.html)。已知限制见 [docs/KNOWN-ISSUES.md](docs/KNOWN-ISSUES.md)。

## 注意事项

- 首次打开 viewer 入口会安装 Service Worker 并可能自动刷新一次（`/s/<sessionId>/` 或 legacy `/`）
- 父项目页面不要与 Worker 部署在同一域名根路径下
- 关 tab **不会**清 session；要 wipe 状态请发 `VC_SESSION_DESTROY`
- 同一 session 可开多个 iframe tab，cookie / localStorage 会同步；不同 session 互不影响
- 继承 jsproxy CF Worker 版限制：无 WebSocket 代理、无外链白名单

## License

本项目采用 [MIT](LICENSE) 许可证。核心代理代码来自 [EtherDream/jsproxy](https://github.com/EtherDream/jsproxy) 与 [jsproxy-browser](https://github.com/EtherDream/jsproxy-browser)（同为 MIT），归属说明见 [THIRD-PARTY.md](THIRD-PARTY.md)。

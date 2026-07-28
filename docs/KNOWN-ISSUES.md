# 已知问题与自动化备忘

记录 virtual-chromo 在代理沙箱、eval 自动化下的已知限制与推荐做法。  
版本号见 `public/conf.js`（`VC_VERSION` / `VC_BUILD`），`VC_READY` 与 inject 启动日志也会打印 build。

---

## Session 隔离（BrowserContext，build `20260727-v17`+）

### 语义

- **sessionId** = Playwright `BrowserContext`：cookie / localStorage / IndexedDB / Cache 按 session 隔离
- **同一 session 多 tab**：共享登录态；cookie 与 localStorage 跨 tab 同步（`StorageEvent`）
- **关 tab**：状态保留；仅 `VC_SESSION_DESTROY` 或 idle GC（无 client 超过 1h）清空
- **URL**：`/s/<sessionId>/` 与 `/s/<sessionId>/-----https://…`

### 实现要点

- 源码：[`public/jsproxy-src/session.js`](../public/jsproxy-src/session.js)、[`cookie.js`](../public/jsproxy-src/cookie.js)、[`storage.js`](../public/jsproxy-src/storage.js)
- 父项目开 tab：每个 iframe `src="https://worker/s/<uuid>/"`，或发 `VC_SESSION_CREATE`
- **不要**依赖多 Worker 部署做隔离

### 已知限制

- 站点 **IndexedDB 跨 tab 实时一致**与 Chrome 仍有差距（仅库名按 session 前缀隔离）
- legacy 根路径 `/` 使用 `default` session，与 `/s/…` 不互通

---

## inject.js 未加载

### 现象

- 内层 content iframe 里 `window.__vcInjected === undefined`
- DevTools 能看到 `console.log`，但无 `VC_CONSOLE_UPDATED` / console 上报
- 代理页 Network 里看不到 `/inject.js`

### 根因（已修）

jsproxy 在代理 HTML 首部插入 `<base href="目标站真实 URL">`。  
若 `inject_html` 使用相对路径 `<script src="/inject.js">`，浏览器会解析为 **目标站的** `/inject.js`，而非 Worker 上的脚本。

### 修复

[`public/conf.js`](../public/conf.js) 使用 **Worker 绝对 URL**：

```javascript
inject_html: '<script src="' + self.location.origin + '/inject.js?b=' + VC_BUILD + '"><\/script>'
```

### 自检

在内层 **content iframe**（不是 viewer 外壳）Console：

```javascript
window.__vcInjected          // true
window.__vcInjectVersion     // e.g. "1.3.0"
console // 应有 [virtual-chromo] inject.js v... 启动日志
```

viewer 外壳里的 `[jsproxy] shell page inited` **不代表** inject 已加载；inject 只在 **代理页** 内执行。

---

## Console 有输出但无 `VC_CONSOLE_UPDATED`

### 现象

- `VC_EVAL` 成功，DevTools 能看到 `console.log`
- bridge 调试面板「通讯」里没有 `VC_CONSOLE_UPDATED`

### 根因

jsproxy [`page.js`](../public/jsproxy-src/page.js) ~367 行 hook 了 `Window.prototype.postMessage`：调用 `parent.postMessage` 时可能把消息发往错误的 `top.__get_srcWin()` 窗口，导致 `_VC_INJECT` 到不了 bridge。

### 修复（build `20260727-v4`+）

1. [`public/inject.js`](../public/inject.js) 优先调用 `window.parent.__vcOnInjectConsole(entry)`（同源直连，绕过 postMessage hook）
2. [`public/bridge.js`](../public/bridge.js) 暴露 `window.__vcOnInjectConsole`；页面 load 后若未检测到 inject 会尝试重新加载 `/inject.js`

### 自检

调试面板「通讯」里 eval 后应出现 `-> 上报 VC_CONSOLE_UPDATED`；父项目监听该事件并用 `VC_CONSOLE_READ` 增量拉取。

---

## 被动导航（build `20260727-v15`+）

virtual-chromo 作为**被动 WebView**：子页面**不能**自主换页、不能开真浏览器 tab。

| 子页行为 | 结果 |
|----------|------|
| 真鼠标点 `<a href>` | `VC_CLICK` + `preventDefault` |
| `element.click()` / `location.assign` / `window.open` | `VC_CLICK` 或 `VC_LOCATION`，不跳转 |
| `VC_EVAL` 内上述操作 | 同上（eval 也不能偷偷导航） |
| 父级 `VC_NAVIGATE` | 唯一换页入口 |

父级（Chromo / AI）收到 `VC_CLICK` / `VC_LOCATION` 后自行决定是否 `VC_NAVIGATE`、开 App 内标签或忽略。

实现：`public/inject.js`（真鼠标 capture）、[`public/jsproxy-src/page.js`](../public/jsproxy-src/page.js)（程序化 click / open / submit、History API 上报）、[`public/jsproxy-src/fakeloc.js`](../public/jsproxy-src/fakeloc.js)（location 写入拦截）。

---

## SPA 页内路由（build `20260727-v16`+）

| 子页行为 | 结果 |
|----------|------|
| 真鼠标点 `<Link>` + `pushState` | `VC_CLICK` → 页内路由 → `VC_HISTORY` |
| `history.pushState` / `replaceState` | 正常执行 + `VC_HISTORY` |
| 浏览器后退/前进（popstate） | `VC_HISTORY` |
| Hash 路由（`#/page` + `location.hash`） | ❌ hash 写入被拦截，仍不可用 |
| 父级对每个 `VC_CLICK` 自动 `VC_NAVIGATE` | ❌ 会破坏 SPA，应改听 `VC_HISTORY` |

父级收到 `VC_HISTORY` 后更新地址栏即可，**不要**再 `VC_NAVIGATE`（除非确需整页 reload）。

---

## 点击未被拦截 / 调试面板无 `VC_CLICK`

### 现象

- 点链接在外部浏览器 tab 打开，或 iframe 直接跳到非代理 URL
- viewer 调试面板「通讯」里没有 `VC_CLICK`，「日志」里也没有 `content click:`

### 常见原因

| 原因 | 说明 |
|------|------|
| **旧 SW / 旧 bundle 缓存** | 硬刷新 viewer，或 DevTools → Application → Service Workers → Unregister |
| **SW 未就绪就导航**（build `< v20`） | `VC_NAVIGATE` 在 SW 安装前设置 `#content.src`，`adjustNav` 可能误跳 Google 搜索；v20+ bridge 会排队到 `swDidReady` |
| **点击发生在嵌套 iframe 内** | 仅代理页**顶层 document**（及同源子 frame）会拦截；跨域 iframe 内无法 hook |
| **仅依赖 inject.js**（build `< v19`） | inject 未加载则完全无拦截；v19+ 在 `page.js` / bundle 侧也有 capture |
| **sandbox `allow-popups`**（已修 v19+） | 会允许 `target=_blank` 开真 tab；viewer 已去掉该权限 |

### 自检（在内层 **content iframe** Console）

```javascript
window.__vcInjected          // true
window.__vcInjectBuild       // 应为当前 VC_BUILD，如 "20260727-v19"
document.__vcPassiveNavInstalled  // true（v19+ bundle 侧 capture 已装）
```

调试面板「日志」里点击链接应出现 `content click: A https://...`；「通讯」里应出现 `→ 上级 VC_CLICK`。

---

| 组件 | 能看到什么 |
|------|------------|
| Chrome DevTools（content iframe） | 原生 console 输出 |
| bridge 内置 Debug Panel（vcd） | **仅 viewer 外壳** 的 console，**不含**子页面 |
| `VC_CONSOLE_UPDATED` + `VC_CONSOLE_READ` | 子页面经 inject hook 的上报（父项目/DevTools 面板需自己监听） |

---

## VC_SCREENSHOT（build `20260727-v29`+）

**能力**：父项目发 `VC_SCREENSHOT`，viewer 在同域读取 `#content` 文档，用 `modern-screenshot` rasterize 后以 Base64 回传（`value.dataUrl` 可直接给 vision 模型）。

**已知限制**：

| 场景 | 表现 |
|------|------|
| 内容逃出代理（跨域） | `SCREENSHOT_ACCESS_DENIED`，无法读 `contentDocument` |
| 复杂 CSS / 跨域直连资源 | 局部空白或样式偏差（与 dom-to-image 类库相同） |
| `fullPage: true` 超长页 | 长边 cap 8192px，防 OOM |
| 验证码 / canvas 背景图 | 一般可渲染；依赖资源是否可被同源或 CORS fetch |

---

## Cloudflare Turnstile / CAPTCHA（已知限制，不再继续修）

**结论：virtual-chromo 可加载 Turnstile 前端（api.js + widget iframe），但无法可靠完成 Cloudflare 服务端验证。**  
第三方站点基本不可用；自有站点可在 Turnstile widget 白名单中加入 Worker 域名后**偶尔**改善，仍不保证。

### reCAPTCHA iframe `src` 写成 `google.com/-----https://google.com/...`（build `< v22`）

**现象**：`recaptcha-demo.appspot.com` 等页里 reCAPTCHA iframe 空白；DevTools 里 `src` 为  
`https://www.google.com/-----https://www.google.com/recaptcha/api2/anchor?...`

**根因**：Session 改造后 [`urlx.encUrlObj`](../public/jsproxy-src/urlx.js) 误用**目标站** `urlObj.origin` 拼代理前缀，应使用 Worker / 当前页 origin。

**修复**：build `20260727-v22`+ 改为用 `path.ROOT` / `location.origin` 作为 proxy origin；`v23`+ 页内编码改回优先 `path.PREFIX`（带 `/s/{id}/`）。

### reCAPTCHA 被当成代理子页（build `< v23`）

**现象**：Console 出现 `[jsproxy] child page inited. .../-----https://www.google.com/recaptcha/...`，页面提示  
`Could not connect to the reCAPTCHA service`。

**根因**：iframe/fetch 被改写成 Worker 代理 URL，jsproxy 在 Google iframe 里初始化，origin/postMessage 全错。

**修复（v23+，对齐 Turnstile）**：
- iframe `src` / fetch / XHR：`www.google.com/recaptcha`、`www.gstatic.com/recaptcha`、`recaptcha.net` **直连不代理**
- CSP `frame-src` 放行上述域名
- `MessageEvent.origin` / `postMessage` 保留 Google origin

**仍可能失败（v23 实测）**：widget iframe 已直连 Google，Console 不再有 `child page inited` / `Could not connect`；但 Google 仍报  
「网站密钥的网域无效 / Invalid domain for site key」——浏览器真实父 origin 是 Worker 域名，不在 site key 白名单。属已知 CAPTCHA 限制，客户端无法可靠绕过。

### 典型现象

| 阶段 | 表现 |
|------|------|
| 早期 | `api.js` 403；或 CSP 拦截 iframe（`frame-src` 无 `challenges.cloudflare.com`） |
| 中期 | CORS preflight 失败；`postMessage` origin 被伪装成目标站 |
| 当前（v13+） | Widget 能渲染，但 iframe 内 **「无法连接到网站」**；Network 里 `POST .../cdn-cgi/challenge-platform/.../fo/...` → **400** |

### 根因（架构性，非小 bug）

Turnstile 绑定**真实嵌入上下文**（页面 origin、iframe 父子关系、浏览器指纹、widget 白名单）。  
virtual-chromo 为：

```
父应用 → viewer (Worker) → 代理页 (/-----https://目标站/) → Turnstile iframe (challenges.cloudflare.com)
```

浏览器真实 origin 为 **Worker 域名**，与目标站、Turnstile 白名单不一致；challenge 提交在 Cloudflare **服务端**被拒（400），客户端 patch 无法绕过。

### 已做缓解（build `20260727-v7` … `v13`，源码在 `public/jsproxy-src/`）

| 改动 | 文件 | 作用 |
|------|------|------|
| Turnstile 域名 SW 策略 | [`sw.js`](../public/jsproxy-src/sw.js) | `api.js` 透传 + jsfilter；iframe 透传；其余走 Worker 并补 CORS；跳过 Turnstile HTML 注入 |
| `frame-src` 放行 | [`inject.js`](../public/jsproxy-src/inject.js) | CSP 允许 `challenges.cloudflare.com` 等 iframe |
| iframe `src` 不代理 | [`page.js`](../public/jsproxy-src/page.js) | Turnstile iframe 直连 Cloudflare |
| `api.js` patch | [`sw.js`](../public/jsproxy-src/sw.js) | 透传拉取后对 `location` → `__location`（配合 fakeloc） |
| `fetch` Request 克隆 | [`client.js`](../public/jsproxy-src/client.js) | 避免 `new Request(url, req)` 静默失败 |
| MessageEvent / postMessage | [`page.js`](../public/jsproxy-src/page.js) | Turnstile 相关 origin 不伪装、postMessage 不劫持 |
| 工具函数 | [`urlx.js`](../public/jsproxy-src/urlx.js) | `isTurnstileHost` / `isTurnstileApiJsUrl` |

**刻意不再继续**：服务端 `fo/` 400、widget「无法连接到网站」、第三方站 token 校验——无可靠客户端解法。

### 推荐做法

| 场景 | 建议 |
|------|------|
| 浏览带 Turnstile 的**别人站点** | 接受限制；或换 **Playwright/Puppeteer** 真浏览器 |
| **自有**站 + 必须测 Turnstile | Dashboard → Turnstile widget → Allowed hostnames 加 Worker 域名与父应用 origin；仍可能失败 |
| 自动化 / AI | 避开 Turnstile 页面；不要假设 widget 可点通 |

### 相关代码（站点侧加载方式，供分析）

目标站通常动态插入：

```javascript
script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=__onTurnstileLoad&render=explicit'
```

Widget 本体为 **iframe** 加载 `cdn-cgi/challenge-platform/.../compact?lang=auto`，不是页面侧 `fetch`。

---

## Network DevTools 能力边界

instant-app Network 详情抽屉对齐 Chrome DevTools 结构（Headers / Preview / Response / Initiator / Timing），但底层是 **Service Worker 代理**，不是浏览器原生 Network 面板。

### 已支持

- 请求列表：method、URL、status、type、size、duration、pending、fromCache、bypass
- **Request Headers**（随 entry 上报；序列化软上限约 32KB）
- **Response Headers + Body**（`VC_NETWORK_BODY_READ`，archive 按 entryId；存储无单条上限；读出为流式前缀约 64KB）
- **Referrer / Referrer Policy**
- **基础 Timing**：queueing / waiting(TTFB 近似) / download（SW 内打点）
- **Server-Timing** 响应头解析（UI）
- Preview：JSON 格式化、文本；图片/音视频等二进制占位不渲染
- **Served from**：标明 cache / bypass / direct / cdn / proxy / native；未命中热缓存时旁有 **?** 条件诊断表
- **失败原因**：`errorCode` / `errorText`（代理失败、网关错误、HTTP 4xx/5xx）

### DevTools 热缓存（build `20260728-v7`+）

- 热缓存 key：`sessionId + method + url`（**session 级持久**，跨页面 reload；URL 经 normalize；存于 Cache Storage `vc-net-hot`）
- Redirect 不分裂 key：put/get 使用用户**原始请求 URL**
- `devtoolsId` **仅**绑定 Disable cache 开关（跳过 get/put），**不参与** hot key；get/put 门闩改为 `sid && !disableCache`
- 仅 **GET、Disable cache 关闭、经 proxy 通路** 时写入（**无单条 body 体积上限**）；**首次 GET 只写入不命中**，同 session 再次请求同 URL 才显示 `DevTools memory cache`
- 热缓存 session 总配额约 50MB，LRU 淘汰旧条目
- entry 字段 `hotStored`：本次是否成功写入热缓存
- `VC_NETWORK_HOT_PROBE`：诊断表可探测「SW 中是否已有该 URL」
- Served from「?」诊断：区分「满足写入条件」与「本次命中」；Network 列表内重复 URL 仅供参考；首次写入 miss 为灰色说明
- 响应头 **Cache-Control** 管浏览器 HTTP 缓存；**Served from 不反映** disk/memory cache
- 清除：`VC_SESSION_DESTROY` → `destroySessionCaches`；显式管理 API（`VC_NETWORK_CACHE_STATS` / `CLEAR` / `LIST`）见下方长期 TODO

### Viewer 版本守护（build `20260728-v4`+）

[`public/viewer.html`](../public/viewer.html) + [`public/bridge.js`](../public/bridge.js)：

- **不再**周期性 `fetch('/bridge.js')` 或 `reg.update()` 轮询
- bridge 在 `swDidReady` / `controllerchange` 时向 SW 查询 `VC_BUILD`；不一致则进入 **Fatal 崩溃页**（说明 +「重新加载」按钮），并 `VC_ERROR { code: 'VERSION_MISMATCH' }`
- SW 更新仍走 `skipWaiting` + activate；激活后由 Fatal 页提示用户手动重载，不自动 silent reload

### 无法实现或仅占位

| Chrome 能力 | 原因 | UI 行为 |
|-------------|------|---------|
| Remote Address | JS/SW 不暴露真实 TCP 远端 IP | 改为 **Served from**（cache / bypass / direct / cdn / proxy） |
| 完整 Initiator 调用链（import 树） | 需 inject 侧采集调用栈并上报；当前无埋点 | 仅 referrer / 页面 URL → 资源 |
| DNS / SSL / Stalled / Proxy negotiation | 无 Chrome Resource Timing 同级 API | Timing 仅 SW 三段 |
| Connection reuse / priority | 无 API | 不展示 |
| Cookies 独立面板 | 未解析 Set-Cookie 树 | 可在 Response Headers 看原始头 |
| WS 帧级详情 | 按 HTTP 记录，无帧协议 | 无 Frames Tab |
| 超大文本整页展示 | 避免整包过桥 | Response 流式读 Cache 前缀（约 64KB）+ truncated 提示 |
| 浏览器 HTTP disk/memory cache 状态 | 未接 Resource Timing | Served from「?」中说明 |

### 自检

1. 部署含新 `bundle.built.js` / `bridge.js` 的 Worker（`20260728-v7`+）
2. Network 点选请求：Headers 三区（General / Response / Request）可见
3. 选中 hasBody 请求：Response/Preview **不应**永久「加载响应中…」（页面仍在加载其他资源时亦然）
4. 同 session 刷新后同 URL：第二次应出现 `cache` badge / `DevTools memory cache`
5. 首次 GET 未命中时点 Served from 旁 **?**：写入条件绿、`热缓存命中` 为灰色「本次写入」；可看到「SW 中已有该 URL 条目」
6. Chromo 打开 2 分钟：Network **不应**周期性出现 `GET /bridge.js`
7. Timing：pending → done 后有条形图；热缓存命中 waiting/download 接近 0
8. 失败请求：列表 `(failed)` 或状态码；详情有 Failure reason / errorCode
9. 模拟 bridge/SW build 不一致：出现 Fatal 页，点「重新加载」后恢复

---

## 长期修复方向（PLAN 阶段 3）

- [x] 用 `jsproxy-src` + `bundle.built.js` 替换黑盒 `bundle.js`（进行中）
- [x] 修复 `HTMLElement.prototype.click` connected 分支（v14+）
- [ ] Debug Panel 可选接入 `consoleBuffer` 显示子页日志
- [ ] **Network 缓存存储管理 API**（对齐 `PAGE_STORAGE_*`）：`VC_NETWORK_CACHE_STATS`（hot/archive 条目数与字节）、`VC_NETWORK_CACHE_CLEAR`（`layer: hot|archive|all`）、`VC_NETWORK_CACHE_LIST`（调试列出 hot key）；bridge 转发；instant-app 设置/存储页挂入口

上游遗留耦合（jsDelivr 预缓存、多节点路由、Google 默认搜索等）的完整清单与处置优先级见 **[jsproxy-legacy-decoupling.md](jsproxy-legacy-decoupling.md)**。

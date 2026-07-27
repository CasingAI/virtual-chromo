# 已知问题与自动化备忘

记录 virtual-chromo 在代理沙箱、eval 自动化下的已知限制与推荐做法。  
版本号见 `public/conf.js`（`VC_VERSION` / `VC_BUILD`），`VC_READY` 与 inject 启动日志也会打印 build。

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

## `element.click()` 无效（上游 jsproxy 遗留，已在 bundle.built 修复）

### 现象（build `20260727-v13` 及更早 `bundle.js` / 未修复的 `bundle.built.js`）

`VC_EVAL` 里 `a.click()` / `button.click()` 无反应；包括 example.com 在内的多站复现；真实鼠标点击正常。

### 根因

jsproxy [`page.js`](../public/jsproxy-src/page.js) hook 了 `HTMLElement.prototype.click`：元素已在 DOM 中（`isConnected`）时 **未调用原始 click**（上游实现疏漏）。  
鼠标点击走 Pointer/Click 事件链，不经过该 hook。

### 修复（build `20260727-v14`+，`bundle.built.js`）

connected 分支改为 `return apply(oldFn, this, arguments)`，与 detached 分支一样透传原生 click。改后执行 `npm run build:bundle` 并 bump `VC_BUILD`。

### 若仍无效时的替代

| 场景 | 做法 |
|------|------|
| 普通 `<a href>` 导航 | `location.assign(a.href)` 或 **`VC_NAVIGATE`** |
| div/button/空 `<a>` + JS | `el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))` |

### 如何确认仍在代理内

```javascript
location.pathname.includes('/-----')
// 或监听 VC_NAVIGATED / readContentState
```

bridge 有 `recoverEscapedContent()`：内层 iframe 若跳到无 `/-----` 的外链，会尝试拉回代理。

---

## 动态 / 非 `<a>` 的「链接」

| 实现方式 | 说明 |
|----------|------|
| JS 动态插入 `<a href>` | href setter + MutationObserver 一般会改写成代理 URL |
| 空 `<a>`、`href="#"` + click 处理器 | 无 href 可 assign；用 `dispatchEvent('click')` 或解析 handler / data 属性 |
| div/button 里 `location.href = url` | 页面 `location` 为 jsproxy 的 `__location`，通常会改写成代理 URL |
| SPA `pushState` | bundle 有 hook；复杂路由需触发站点自己的逻辑或 `VC_NAVIGATE` |

**AI 不应假设所有可点元素都是 `<a>`**；优先探测 URL，有则 `VC_NAVIGATE`，无则 `dispatchEvent('click')`。

---

## Console 上报与 Debug Panel

| 组件 | 能看到什么 |
|------|------------|
| Chrome DevTools（content iframe） | 原生 console 输出 |
| bridge 内置 Debug Panel（vcd） | **仅 viewer 外壳** 的 console，**不含**子页面 |
| `VC_CONSOLE_UPDATED` + `VC_CONSOLE_READ` | 子页面经 inject hook 的上报（父项目/DevTools 面板需自己监听） |

---

## Cloudflare Turnstile / CAPTCHA（已知限制，不再继续修）

**结论：virtual-chromo 可加载 Turnstile 前端（api.js + widget iframe），但无法可靠完成 Cloudflare 服务端验证。**  
第三方站点基本不可用；自有站点可在 Turnstile widget 白名单中加入 Worker 域名后**偶尔**改善，仍不保证。

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

## 长期修复方向（PLAN 阶段 3）

- [x] 用 `jsproxy-src` + `bundle.built.js` 替换黑盒 `bundle.js`（进行中）
- [x] 修复 `HTMLElement.prototype.click` connected 分支（v14+）
- [ ] Debug Panel 可选接入 `consoleBuffer` 显示子页日志

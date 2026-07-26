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

## `element.click()` 无效，鼠标点击有效

### 现象

`VC_EVAL` 里 `a.click()` / `button.click()` 无反应；包括 example.com 在内的多站复现；真实鼠标点击正常。

### 根因

jsproxy [`public/bundle.js`](../public/bundle.js) hook 了 `HTMLElement.prototype.click`：元素已在 DOM 中（`isConnected`）时，**未调用原始 click**，导致程序化 `.click()` 失效。  
鼠标点击走 Pointer/Click 事件链，不经过该 hook。

### 推荐替代

| 场景 | 做法 |
|------|------|
| 普通 `<a href>` 导航 | `location.assign(a.href)`（href 已被 jsproxy 改写成 `/-----...`） |
| 父项目侧最稳 | eval 读出真实 URL → **`VC_NAVIGATE`**（bridge 强制 `toProxyPath`） |
| div/button/空 `<a>` + JS | `el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))` |
| 避免 | `element.click()` |

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

## 长期修复方向（PLAN 阶段 3）

- 用可读源码替换 `bundle.js`，修复 `HTMLElement.prototype.click` hook
- 或将 inject 中 patch 回正确的 `click` 行为
- Debug Panel 可选接入 `consoleBuffer` 显示子页日志

/**
 * virtual-chromo postMessage bridge
 * Connects the outer parent shell with the inner proxied browsing context.
 * Includes a built-in debug panel (VConsole-like, no third-party deps).
 */
;(function () {
  'use strict'

  const VERSION = '1.3.0'
  const BUILD = '20260728-v25'
  /** New-tab start page (Worker static asset); not a proxied site. */
  const BLANK_PATH = '/blank.html'
  const PROXY_PREFIX = '/-----'
  const MSG_SW_NETWORK_PUSH = 305
  const MSG_PAGE_NETWORK_OPTS = 306
  const MSG_PAGE_NETWORK_BODY_READ = 307
  const MSG_SW_NETWORK_BODY_REPLY = 308
  const MSG_PAGE_NETWORK_ARCHIVE_DROP = 309
  const MSG_PAGE_BUILD_GET = 310
  const MSG_SW_BUILD_REPLY = 311
  const MSG_PAGE_NETWORK_HOT_PROBE = 312
  const MSG_SW_NETWORK_HOT_PROBE_REPLY = 313
  const MSG_PAGE_NETWORK_INITIATOR_TIP = 314
  const MSG_PAGE_NETWORK_BODY_READ_LINES = 315
  const MSG_SW_NETWORK_BODY_LINES_REPLY = 316
  const MSG_PAGE_CLEAR_STATE = 320
  const MSG_SW_CLEAR_STATE = 321
  const MSG_PAGE_COOKIE_LIST = 322
  const MSG_SW_COOKIE_LIST_REPLY = 323
  const MSG_PAGE_COOKIE_DELETE = 324
  const MSG_SW_COOKIE_DELETE_REPLY = 325
  const MSG_PAGE_COOKIE_CLEAR = 326
  const MSG_SW_COOKIE_CLEAR_REPLY = 327
  const MSG_PAGE_NETWORK_CACHE_STATS = 328
  const MSG_SW_NETWORK_CACHE_STATS_REPLY = 329
  const MSG_PAGE_NETWORK_CACHE_LIST = 330
  const MSG_SW_NETWORK_CACHE_LIST_REPLY = 331
  const MSG_PAGE_NETWORK_CACHE_CLEAR = 332
  const MSG_SW_NETWORK_CACHE_CLEAR_REPLY = 333
  const MSG_PAGE_COOKIE_CLEAR_ALL = 334
  const MSG_SW_COOKIE_CLEAR_ALL_REPLY = 335
  const MSG_PAGE_NETWORK_CACHE_CLEAR_ALL = 336
  const MSG_SW_NETWORK_CACHE_CLEAR_ALL_REPLY = 337
  const MAX_CONSOLE_ENTRIES = 500
  const DEFAULT_CONSOLE_READ_LIMIT = 100
  const MAX_CONSOLE_READ_LIMIT = 500
  const MAX_NETWORK_ENTRIES = 500
  const DEFAULT_NETWORK_READ_LIMIT = 100
  const MAX_NETWORK_READ_LIMIT = 500
  const MAX_SCREENSHOT_CANVAS = 8192
  const DEFAULT_SCREENSHOT_QUALITY = 0.72
  const LOAD_ERROR_MARKERS = ['virtual-chromo error', 'virtual-chromo error:']

  // ---------------------------------------------------------------------------
  // DebugPanel (internal, CSS prefix: vcd-)
  // ---------------------------------------------------------------------------
  const DebugPanel = (function () {
    const MAX_LOGS = 500
    const MAX_MESSAGES = 300
    const MAX_NETWORK = 500
    const MAX_NAV = 300

    /** @type {{ level: string, args: string[], at: number }[]} */
    const logs = []

    /** @type {{ direction: string, cmd: string, payload: string, at: number, meta?: string }[]} */
    const messages = []

    /** @type {{ id: string, method: string, url: string, status: number, type: string, size: number, duration: number, failed: boolean, bypass: boolean, ts: number }[]} */
    const networkEntries = []

    /** @type {{ kind: string, method?: string, url?: string, href?: string, target?: string, tagName?: string, stack?: string[], ts: number, at: number }[]} */
    const navEntries = []

    /** @type {(() => Record<string, unknown>) | null} */
    let stateProvider = null

    /** @type {((enabled: boolean) => void) | null} */
    let navProbeSetter = null

    /** @type {(() => boolean) | null} */
    let navProbeGetter = null

    /** @type {((enabled: boolean) => void) | null} */
    let frameBustGuardSetter = null

    /** @type {(() => boolean) | null} */
    let frameBustGuardGetter = null

    /** @type {boolean} */
    let panelOpen = false

    /** @type {boolean} */
    let uiVisible = window.parent === window

    /** @type {string} */
    let versionLabel = ''

    /**
     * @param {string} version
     * @param {string} [build]
     */
    function setVersionLabel(version, build) {
      versionLabel = 'v' + version + (build ? ' · ' + build : '')
    }

    /** @type {string} */
    let activeTab = 'log'

    /** @type {HTMLElement | null} */
    let root = null

    /** @type {HTMLElement | null} */
    let panel = null

    /** @type {HTMLElement | null} */
    let logList = null

    /** @type {HTMLElement | null} */
    let msgList = null

    /** @type {HTMLElement | null} */
    let stateView = null

    /** @type {HTMLElement | null} */
    let networkList = null

    /** @type {HTMLElement | null} */
    let navPane = null

    /** @type {HTMLInputElement | null} */
    let navProbeCheck = null

    /** @type {HTMLInputElement | null} */
    let frameBustGuardCheck = null

    /** @type {HTMLElement | null} */
    let navList = null

    /**
     * @param {unknown} value
     */
    function stringify(value) {
      if (value === undefined) {
        return 'undefined'
      }
      if (typeof value === 'string') {
        return value
      }
      try {
        return JSON.stringify(value, null, 2)
      } catch {
        return String(value)
      }
    }

    /**
     * @param {unknown[]} args
     */
    function formatArgs(args) {
      return args.map(stringify)
    }

    /**
     * @param {string} level
     * @param {unknown[]} args
     */
    function addLog(level, args) {
      logs.push({ level, args: formatArgs(args), at: Date.now() })
      if (logs.length > MAX_LOGS) {
        logs.shift()
      }
      if (panelOpen && activeTab === 'log') {
        renderLogs()
      }
      updateBadge()
    }

    /**
     * @param {string} direction
     * @param {string} cmd
     * @param {unknown} [payload]
     * @param {Record<string, unknown>} [meta]
     */
    function addMessage(direction, cmd, payload, meta) {
      messages.push({
        direction,
        cmd,
        payload: payload === undefined ? '' : stringify(payload),
        at: Date.now(),
        meta: meta ? stringify(meta) : '',
      })
      if (messages.length > MAX_MESSAGES) {
        messages.shift()
      }
      if (panelOpen && activeTab === 'msg') {
        renderMessages()
      }
      updateBadge()
    }

    /**
     * @param {number} ts
     */
    function formatTime(ts) {
      const d = new Date(ts)
      const p = (n) => String(n).padStart(2, '0')
      return (
        p(d.getHours()) +
        ':' +
        p(d.getMinutes()) +
        ':' +
        p(d.getSeconds()) +
        '.' +
        String(d.getMilliseconds()).padStart(3, '0')
      )
    }

    function renderLogs() {
      if (!logList) {
        return
      }
      logList.innerHTML = ''
      const frag = document.createDocumentFragment()
      for (const item of logs) {
        const row = document.createElement('div')
        row.className = 'vcd-log vcd-log--' + item.level
        row.textContent =
          '[' + formatTime(item.at) + '] [' + item.level + '] ' + item.args.join(' ')
        frag.appendChild(row)
      }
      if (!logs.length) {
        const empty = document.createElement('div')
        empty.className = 'vcd-empty'
        empty.textContent = '暂无日志'
        frag.appendChild(empty)
      }
      logList.appendChild(frag)
      logList.scrollTop = logList.scrollHeight
    }

    function renderMessages() {
      if (!msgList) {
        return
      }
      msgList.innerHTML = ''
      const frag = document.createDocumentFragment()
      for (const item of messages) {
        const row = document.createElement('div')
        row.className = 'vcd-msg vcd-msg--' + item.direction
        const head = document.createElement('div')
        head.className = 'vcd-msg__head'
        head.textContent =
          '[' +
          formatTime(item.at) +
          '] ' +
          (item.direction === 'in' ? '← 上级' : '→ 上级') +
          ' ' +
          item.cmd
        row.appendChild(head)
        if (item.payload) {
          const body = document.createElement('pre')
          body.className = 'vcd-msg__body'
          body.textContent = item.payload
          row.appendChild(body)
        }
        if (item.meta) {
          const metaEl = document.createElement('pre')
          metaEl.className = 'vcd-msg__meta'
          metaEl.textContent = item.meta
          row.appendChild(metaEl)
        }
        frag.appendChild(row)
      }
      if (!messages.length) {
        const empty = document.createElement('div')
        empty.className = 'vcd-empty'
        empty.textContent = '暂无通讯记录'
        frag.appendChild(empty)
      }
      msgList.appendChild(frag)
      msgList.scrollTop = msgList.scrollHeight
    }

    /**
     * @param {{ id: string, method: string, url: string, status: number, type: string, size: number, duration: number, failed: boolean, bypass: boolean, pending?: boolean, ts: number }} entry
     */
    function addNetwork(entry) {
      const idx = networkEntries.findIndex((item) => item.id === entry.id)
      if (idx >= 0) {
        networkEntries[idx] = entry
      } else {
        networkEntries.push(entry)
        if (networkEntries.length > MAX_NETWORK) {
          networkEntries.shift()
        }
      }
      if (panelOpen && activeTab === 'network') {
        renderNetwork()
      }
    }

    function renderNetwork() {
      if (!networkList) {
        return
      }
      networkList.innerHTML = ''
      const frag = document.createDocumentFragment()
      for (const item of networkEntries) {
        const row = document.createElement('div')
        let cls = 'vcd-net'
        if (item.failed) {
          cls += ' vcd-net--fail'
        }
        if (item.bypass) {
          cls += ' vcd-net--bypass'
        }
        if (item.pending) {
          cls += ' vcd-net--pending'
        }
        row.className = cls
        const head =
          (item.method || 'GET') +
          ' ' +
          (item.pending ? '(pending)' : item.status || '-') +
          ' ' +
          (item.type || '') +
          ' ' +
          (item.duration || 0) +
          'ms' +
          (item.bypass ? ' [bypass]' : '') +
          (item.fromCache ? ' [cache]' : '') +
          (item.hasBody ? '' : '')
        const headEl = document.createElement('div')
        headEl.className = 'vcd-net__head'
        headEl.textContent = head
        const urlEl = document.createElement('div')
        urlEl.className = 'vcd-net__url'
        urlEl.textContent = item.url || ''
        row.appendChild(headEl)
        row.appendChild(urlEl)
        frag.appendChild(row)
      }
      if (!networkEntries.length) {
        const empty = document.createElement('div')
        empty.className = 'vcd-empty'
        empty.textContent = '暂无网络请求'
        frag.appendChild(empty)
      }
      networkList.appendChild(frag)
      networkList.scrollTop = networkList.scrollHeight
    }

    /**
     * @param {{ kind: string, method?: string, url?: string, href?: string, target?: string, tagName?: string, stack?: string[], ts?: number }} entry
     */
    function addNav(entry) {
      const at = typeof entry.ts === 'number' ? entry.ts : Date.now()
      navEntries.push({
        kind: entry.kind || '?',
        method: entry.method,
        url: entry.url,
        href: entry.href,
        target: entry.target,
        tagName: entry.tagName,
        stack: Array.isArray(entry.stack) ? entry.stack.slice() : [],
        ts: at,
        at: at,
      })
      if (navEntries.length > MAX_NAV) {
        navEntries.shift()
      }
      if (panelOpen && activeTab === 'nav') {
        renderNav()
      }
      updateBadge()
    }

    function syncNavProbeCheck() {
      if (!navProbeCheck) {
        return
      }
      const on = navProbeGetter ? !!navProbeGetter() : false
      navProbeCheck.checked = on
    }

    function syncFrameBustGuardCheck() {
      if (!frameBustGuardCheck) {
        return
      }
      const on = frameBustGuardGetter ? !!frameBustGuardGetter() : true
      frameBustGuardCheck.checked = on
    }

    function renderNav() {
      if (!navList) {
        return
      }
      syncNavProbeCheck()
      syncFrameBustGuardCheck()
      navList.innerHTML = ''
      const frag = document.createDocumentFragment()
      for (let i = navEntries.length - 1; i >= 0; i--) {
        const item = navEntries[i]
        const row = document.createElement('div')
        row.className = 'vcd-nav'
        const head = document.createElement('div')
        head.className = 'vcd-nav__head'
        const dest = item.url || item.href || ''
        head.textContent =
          '[' +
          formatTime(item.at) +
          '] ' +
          item.kind +
          (item.method ? ' · ' + item.method : '') +
          (item.tagName ? ' · ' + item.tagName : '') +
          (item.target ? ' target=' + item.target : '')
        row.appendChild(head)
        if (dest) {
          const urlEl = document.createElement('div')
          urlEl.className = 'vcd-nav__url'
          urlEl.textContent = dest
          row.appendChild(urlEl)
        }
        if (item.stack && item.stack.length) {
          const details = document.createElement('details')
          details.className = 'vcd-nav__stack'
          const summary = document.createElement('summary')
          summary.textContent = 'stack (' + item.stack.length + ')'
          details.appendChild(summary)
          const pre = document.createElement('pre')
          pre.textContent = item.stack.join('\n')
          details.appendChild(pre)
          row.appendChild(details)
        } else {
          const emptyStack = document.createElement('div')
          emptyStack.className = 'vcd-nav__nostack'
          emptyStack.textContent = '(无 stack)'
          row.appendChild(emptyStack)
        }
        frag.appendChild(row)
      }
      if (!navEntries.length) {
        const empty = document.createElement('div')
        empty.className = 'vcd-empty'
        empty.textContent = '开启导航探针后，被拦截的 VC_CLICK / LOCATION / HISTORY 会显示在此'
        frag.appendChild(empty)
      }
      navList.appendChild(frag)
    }

    function renderState() {
      if (!stateView) {
        return
      }
      const data = stateProvider ? stateProvider() : {}
      const lines = [
        ['viewer URL', location.href],
        ['Service Worker', navigator.serviceWorker?.controller ? 'active' : 'inactive'],
        ['bridge ready', data.swReady ? 'yes' : 'no'],
        ['bridge version', data.version || '-'],
        ['content URL', data.contentUrl || '-'],
        ['content title', data.contentTitle || '-'],
        ['proxy path', data.proxyPath || '-'],
        ['loading', data.loading ? 'yes' : 'no'],
        ['parent', data.parentOrigin || '(embedded)'],
        ['allowed origins', data.allowedOrigins || '(all)'],
        ['can go back', data.canGoBack ? 'yes' : 'no'],
        ['can go forward', data.canGoForward ? 'yes' : 'no'],
        ['navProbe', data.navProbe ? 'on' : 'off'],
      ]

      let html = '<div class="vcd-state-grid">'
      for (const [key, value] of lines) {
        html +=
          '<div class="vcd-state__key">' +
          escapeHtml(key) +
          '</div><div class="vcd-state__val">' +
          escapeHtml(String(value)) +
          '</div>'
      }
      html += '</div>'

      const history = Array.isArray(data.history) ? data.history : []
      html += '<div class="vcd-state__section">导航历史</div>'
      if (!history.length) {
        html += '<div class="vcd-empty">暂无历史</div>'
      } else {
        html += '<div class="vcd-history">'
        for (let i = history.length - 1; i >= 0; i--) {
          const item = history[i]
          html +=
            '<div class="vcd-history__item"><div class="vcd-history__meta">[' +
            escapeHtml(formatTime(item.at)) +
            '] ' +
            escapeHtml(item.action || '') +
            '</div><div class="vcd-history__url">' +
            escapeHtml(item.url || '-') +
            '</div>' +
            (item.title
              ? '<div class="vcd-history__title">' + escapeHtml(item.title) + '</div>'
              : '') +
            '</div>'
        }
        html += '</div>'
      }

      stateView.innerHTML = html
    }

    /**
     * @param {string} text
     */
    function escapeHtml(text) {
      return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
    }

    function updateBadge() {
      if (!root) {
        return
      }
      const badge = root.querySelector('.vcd-badge')
      if (!badge) {
        return
      }
      const warnCount = logs.filter((l) => l.level === 'error' || l.level === 'warn').length
      const probeOn = navProbeGetter ? !!navProbeGetter() : false
      const count = warnCount + (probeOn ? navEntries.length : 0)
      badge.textContent = count > 0 ? String(count) : ''
      badge.hidden = count === 0
    }

    /**
     * @param {string} tab
     */
    function switchTab(tab) {
      activeTab = tab
      if (!panel) {
        return
      }
      panel.querySelectorAll('.vcd-tab').forEach((el) => {
        el.classList.toggle('is-active', el.getAttribute('data-tab') === tab)
      })
      panel.querySelectorAll('.vcd-pane').forEach((el) => {
        el.hidden = el.getAttribute('data-pane') !== tab
      })
      if (tab === 'log') {
        renderLogs()
      } else if (tab === 'msg') {
        renderMessages()
      } else if (tab === 'state') {
        renderState()
      } else if (tab === 'network') {
        renderNetwork()
      } else if (tab === 'nav') {
        renderNav()
      }
    }

    function setPanelOpen(open) {
      panelOpen = !!open
      if (!panel || !root) {
        return
      }
      if (panelOpen) {
        panel.removeAttribute('hidden')
      } else {
        panel.setAttribute('hidden', '')
      }
      panel.classList.toggle('vcd-panel--open', panelOpen)
      root.classList.toggle('vcd-root--open', panelOpen)
      const switchBtn = root.querySelector('.vcd-switch')
      if (switchBtn) {
        switchBtn.setAttribute('aria-expanded', panelOpen ? 'true' : 'false')
        const verSuffix = versionLabel ? ' · ' + versionLabel : ''
        switchBtn.title = panelOpen ? '收起调试面板' + verSuffix : '打开调试面板' + verSuffix
      }
      if (panelOpen) {
        switchTab(activeTab)
      }
    }

    function togglePanel() {
      setPanelOpen(!panelOpen)
    }

    function hookConsole() {
      const levels = ['log', 'info', 'warn', 'error', 'debug']
      for (const level of levels) {
        const original = console[level]
        if (typeof original !== 'function') {
          continue
        }
        console[level] = function () {
          addLog(level, Array.from(arguments))
          return original.apply(console, arguments)
        }
      }

      window.addEventListener('error', function (event) {
        addLog('error', [
          event.message,
          event.filename + ':' + event.lineno + ':' + event.colno,
        ])
      })

      window.addEventListener('unhandledrejection', function (event) {
        addLog('error', ['Unhandled rejection', event.reason])
      })
    }

    function buildUi() {
      root = document.createElement('div')
      root.id = 'vcd-root'
      root.className = 'vcd-root'
      root.innerHTML =
        '<button type="button" class="vcd-switch" aria-label="打开调试面板" aria-expanded="false" title="打开调试面板">' +
        '调<span class="vcd-badge" hidden></span></button>' +
        '<div class="vcd-panel" hidden>' +
        '<div class="vcd-panel__head">' +
        '<div class="vcd-panel__title-wrap">' +
        '<span class="vcd-panel__title">virtual-chromo</span>' +
        (versionLabel
          ? '<span class="vcd-panel__ver">' + escapeHtml(versionLabel) + '</span>'
          : '') +
        '</div>' +
        '<div class="vcd-panel__actions">' +
        '<button type="button" class="vcd-btn" data-action="clear" title="清空当前页">清空</button>' +
        '<button type="button" class="vcd-btn vcd-btn--close" data-action="close" title="关闭" aria-label="关闭">×</button>' +
        '</div></div>' +
        '<div class="vcd-tabs">' +
        '<button type="button" class="vcd-tab is-active" data-tab="log">日志</button>' +
        '<button type="button" class="vcd-tab" data-tab="msg">通讯</button>' +
        '<button type="button" class="vcd-tab" data-tab="network">网络</button>' +
        '<button type="button" class="vcd-tab" data-tab="nav">导航</button>' +
        '<button type="button" class="vcd-tab" data-tab="state">状态</button>' +
        '</div>' +
        '<div class="vcd-body">' +
        '<div class="vcd-pane" data-pane="log"></div>' +
        '<div class="vcd-pane" data-pane="msg" hidden></div>' +
        '<div class="vcd-pane" data-pane="network" hidden></div>' +
        '<div class="vcd-pane" data-pane="nav" hidden>' +
        '<div class="vcd-nav-toolbar">' +
        '<label class="vcd-nav-toggle"><input type="checkbox" class="vcd-nav-probe" /> 导航探针</label>' +
        '<span class="vcd-nav-hint">开启后不上报 VC_CLICK/LOCATION/HISTORY，在此显示触发栈</span>' +
        '<label class="vcd-nav-toggle"><input type="checkbox" class="vcd-frame-bust" checked /> 吞破框 open(_top)</label>' +
        '<span class="vcd-nav-hint">默认开：同 URL 的 open(_top/_self/_parent) 不上报。关：照常 VC_LOCATION，便于测 AST</span>' +
        '</div>' +
        '<div class="vcd-nav-list"></div>' +
        '</div>' +
        '<div class="vcd-pane" data-pane="state" hidden></div>' +
        '</div></div>'

      const style = document.createElement('style')
      style.textContent =
        '.vcd-root{position:fixed;left:10px;bottom:10px;z-index:2147483646;font:11px/1.4 ui-sans-serif,system-ui,sans-serif;color:#e8e8e8;pointer-events:none}' +
        '.vcd-root[hidden]{display:none!important}' +
        '.vcd-root *{box-sizing:border-box}' +
        '.vcd-switch{pointer-events:auto;width:36px;height:36px;padding:0;border:0;border-radius:18px;background:#2f9e44;color:#fff;font-size:12px;font-weight:700;box-shadow:0 2px 10px rgba(0,0,0,.35);cursor:pointer;position:relative}' +
        '.vcd-switch:active{transform:scale(.96)}' +
        '.vcd-badge{position:absolute;top:-3px;right:-3px;min-width:14px;height:14px;padding:0 3px;border-radius:7px;background:#e03131;color:#fff;font-size:9px;line-height:14px;text-align:center}' +
        /* hidden must win over display:flex — this was why close did nothing */
        '.vcd-panel{pointer-events:auto;position:absolute;left:0;bottom:44px;width:min(92vw,360px);height:min(56vh,420px);display:none;flex-direction:column;border-radius:8px;overflow:hidden;background:#1a1b1e;border:1px solid #343a40;box-shadow:0 6px 22px rgba(0,0,0,.4)}' +
        '.vcd-panel.vcd-panel--open,.vcd-panel:not([hidden]){display:flex}' +
        '.vcd-panel[hidden]{display:none!important}' +
        '.vcd-panel__head{display:flex;align-items:center;justify-content:space-between;padding:6px 8px;background:#25262b;border-bottom:1px solid #343a40}' +
        '.vcd-panel__title-wrap{display:flex;flex-direction:column;gap:1px;min-width:0}' +
        '.vcd-panel__title{font-weight:600;font-size:11px;color:#ced4da}' +
        '.vcd-panel__ver{font-size:10px;font-weight:400;color:#868e96;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}' +
        '.vcd-panel__actions{display:flex;gap:4px;align-items:center}' +
        '.vcd-btn{border:0;border-radius:4px;padding:3px 8px;background:#373a40;color:#dee2e6;cursor:pointer;font:inherit}' +
        '.vcd-btn:hover{background:#495057}' +
        '.vcd-btn--close{width:24px;height:24px;padding:0;font-size:16px;line-height:24px;font-weight:500}' +
        '.vcd-tabs{display:flex;background:#1a1b1e;border-bottom:1px solid #343a40}' +
        '.vcd-tab{flex:1;border:0;background:transparent;color:#868e96;padding:7px 2px;cursor:pointer;font:inherit;font-size:10px}' +
        '.vcd-tab.is-active{color:#69db7c;box-shadow:inset 0 -2px 0 #2f9e44}' +
        '.vcd-body{flex:1;overflow:auto;background:#111214;min-height:0}' +
        '.vcd-pane{min-height:100%}' +
        '.vcd-log,.vcd-msg{padding:6px 8px;border-bottom:1px solid #212529;word-break:break-word;white-space:pre-wrap}' +
        '.vcd-log--error,.vcd-log--warn{color:#ff6b6b}' +
        '.vcd-log--info{color:#74c0fc}' +
        '.vcd-log--debug{color:#868e96}' +
        '.vcd-msg--in{border-left:2px solid #51cf66}' +
        '.vcd-msg--out{border-left:2px solid #339af0}' +
        '.vcd-msg__head{font-weight:600;margin-bottom:2px}' +
        '.vcd-msg__body,.vcd-msg__meta{margin:0;padding:4px 6px;background:#1a1b1e;border-radius:4px;font:inherit;color:#ced4da;overflow:auto;max-height:120px}' +
        '.vcd-msg__meta{margin-top:3px;color:#868e96}' +
        '.vcd-empty{padding:12px;color:#868e96;text-align:center}' +
        '.vcd-state-grid{display:grid;grid-template-columns:96px 1fr;gap:4px 8px;padding:8px}' +
        '.vcd-state__key{color:#868e96}' +
        '.vcd-state__val{word-break:break-all;color:#f1f3f5}' +
        '.vcd-state__section{padding:8px 8px 2px;font-weight:600;color:#adb5bd}' +
        '.vcd-history{padding:0 8px 8px}' +
        '.vcd-history__item{padding:6px 0;border-bottom:1px solid #212529}' +
        '.vcd-history__meta{color:#868e96;font-size:10px}' +
        '.vcd-history__url{color:#74c0fc;word-break:break-all}' +
        '.vcd-history__title{color:#ced4da;margin-top:1px}' +
        '.vcd-net{padding:5px 8px;border-bottom:1px solid #212529;font:10px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace}' +
        '.vcd-net--fail .vcd-net__head{color:#ff6b6b}' +
        '.vcd-net--bypass{border-left:2px solid #f59f00}' +
        '.vcd-net__head{color:#69db7c;font-weight:600}' +
        '.vcd-net__url{color:#adb5bd;word-break:break-all;margin-top:2px}' +
        '.vcd-nav-toolbar{padding:8px;border-bottom:1px solid #212529;display:flex;flex-direction:column;gap:4px;position:sticky;top:0;background:#111214;z-index:1}' +
        '.vcd-nav-toggle{display:flex;align-items:center;gap:6px;color:#e8e8e8;font-weight:600;cursor:pointer}' +
        '.vcd-nav-hint{color:#868e96;font-size:10px;line-height:1.35}' +
        '.vcd-nav{padding:6px 8px;border-bottom:1px solid #212529;border-left:2px solid #fcc419}' +
        '.vcd-nav__head{color:#fcc419;font-weight:600;word-break:break-word}' +
        '.vcd-nav__url{color:#74c0fc;word-break:break-all;margin-top:2px;font:10px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace}' +
        '.vcd-nav__nostack{color:#868e96;margin-top:2px;font-size:10px}' +
        '.vcd-nav__stack{margin-top:4px;color:#adb5bd}' +
        '.vcd-nav__stack summary{cursor:pointer;color:#ced4da}' +
        '.vcd-nav__stack pre{margin:4px 0 0;padding:4px 6px;background:#1a1b1e;border-radius:4px;overflow:auto;max-height:140px;white-space:pre-wrap;word-break:break-all;font:10px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace;color:#ced4da}'

      document.head.appendChild(style)
      document.body.appendChild(root)
      if (!uiVisible) {
        root.setAttribute('hidden', '')
      }

      panel = root.querySelector('.vcd-panel')
      logList = root.querySelector('[data-pane="log"]')
      msgList = root.querySelector('[data-pane="msg"]')
      networkList = root.querySelector('[data-pane="network"]')
      navPane = root.querySelector('[data-pane="nav"]')
      navProbeCheck = root.querySelector('.vcd-nav-probe')
      frameBustGuardCheck = root.querySelector('.vcd-frame-bust')
      navList = root.querySelector('.vcd-nav-list')
      stateView = root.querySelector('[data-pane="state"]')

      const switchBtn = root.querySelector('.vcd-switch')
      if (switchBtn && versionLabel) {
        switchBtn.title = 'virtual-chromo ' + versionLabel
      }

      switchBtn.addEventListener('click', function (e) {
        e.preventDefault()
        e.stopPropagation()
        togglePanel()
      })
      root.querySelector('[data-action="close"]').addEventListener('click', function (e) {
        e.preventDefault()
        e.stopPropagation()
        setPanelOpen(false)
      })
      root.querySelector('[data-action="clear"]').addEventListener('click', function (e) {
        e.preventDefault()
        e.stopPropagation()
        if (activeTab === 'log') {
          logs.length = 0
          renderLogs()
        } else if (activeTab === 'msg') {
          messages.length = 0
          renderMessages()
        } else if (activeTab === 'network') {
          networkEntries.length = 0
          renderNetwork()
        } else if (activeTab === 'nav') {
          navEntries.length = 0
          renderNav()
        } else if (activeTab === 'state') {
          // state is live snapshot; clearing history is more useful
          renderState()
        }
        updateBadge()
      })

      if (navProbeCheck) {
        navProbeCheck.addEventListener('change', function () {
          if (navProbeSetter) {
            navProbeSetter(!!navProbeCheck.checked)
          }
          updateBadge()
        })
      }

      if (frameBustGuardCheck) {
        frameBustGuardCheck.addEventListener('change', function () {
          if (frameBustGuardSetter) {
            frameBustGuardSetter(!!frameBustGuardCheck.checked)
          }
          updateBadge()
        })
      }

      root.querySelectorAll('.vcd-tab').forEach((btn) => {
        btn.addEventListener('click', function (e) {
          e.preventDefault()
          e.stopPropagation()
          switchTab(btn.getAttribute('data-tab') || 'log')
        })
      })
    }

    /**
     * @param {{ version?: string, build?: string }} [options]
     */
    function init(options) {
      options = options || {}
      if (options.version) {
        setVersionLabel(options.version, options.build)
      }
      if (root) {
        return
      }
      buildUi()
      hookConsole()
      addLog('debug', ['debug panel ready', versionLabel || ''])
    }

    /**
     * Show/hide the floating debug UI. Logging still works when hidden.
     * @param {boolean} enabled
     */
    function setVisible(enabled) {
      uiVisible = !!enabled
      if (!root) {
        return
      }
      if (uiVisible) {
        root.removeAttribute('hidden')
      } else {
        if (panelOpen) {
          setPanelOpen(false)
        }
        root.setAttribute('hidden', '')
      }
    }

    /**
     * @param {() => Record<string, unknown>} fn
     */
    function setStateProvider(fn) {
      stateProvider = fn
    }

    /**
     * @param {(enabled: boolean) => void} setter
     * @param {() => boolean} getter
     */
    function setNavProbeHandlers(setter, getter) {
      navProbeSetter = setter
      navProbeGetter = getter
      syncNavProbeCheck()
    }

    /**
     * @param {(enabled: boolean) => void} setter
     * @param {() => boolean} getter
     */
    function setFrameBustGuardHandlers(setter, getter) {
      frameBustGuardSetter = setter
      frameBustGuardGetter = getter
      syncFrameBustGuardCheck()
    }

    function syncNavProbeUi() {
      syncNavProbeCheck()
      syncFrameBustGuardCheck()
      updateBadge()
      if (panelOpen && activeTab === 'nav') {
        renderNav()
      }
      if (panelOpen && activeTab === 'state') {
        renderState()
      }
    }

    return {
      init,
      setVisible,
      log: function () {
        addLog('log', Array.from(arguments))
      },
      info: function () {
        addLog('info', Array.from(arguments))
      },
      warn: function () {
        addLog('warn', Array.from(arguments))
      },
      error: function () {
        addLog('error', Array.from(arguments))
      },
      message: addMessage,
      network: addNetwork,
      nav: addNav,
      setStateProvider,
      setNavProbeHandlers,
      setFrameBustGuardHandlers,
      syncNavProbeUi,
    }
  })()

  // ---------------------------------------------------------------------------
  // Bridge
  // ---------------------------------------------------------------------------

  /**
   * Clear SW-side state (and local network buffer). Payload: {} or { id? }.
   * Waits for SW_CLEAR_STATE before VC_CLEAR_STATE_DONE.
   * @param {unknown} [payload]
   */
  function clearStateViaSw(payload) {
    networkBuffer.length = 0
    networkPendingNotifyCount = 0
    const data = payload && typeof payload === 'object' ? payload : {}
    const reqId =
      typeof data.id === 'string' && data.id ? data.id : 'clear-' + Date.now()
    /** @type {Record<string, unknown>} */
    const msg = { id: reqId }

    let settled = false
    function done(ok, error) {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      navigator.serviceWorker.removeEventListener('message', onReply)
      postToParent('VC_CLEAR_STATE_DONE', ok === false
        ? { id: reqId, ok: false, error: error || { message: 'clear failed' } }
        : { id: reqId, ok: true })
    }

    /**
     * @param {MessageEvent} event
     */
    function onReply(event) {
      if (!Array.isArray(event.data) || event.data[0] !== MSG_SW_CLEAR_STATE) {
        return
      }
      const p = event.data[1] && typeof event.data[1] === 'object' ? event.data[1] : {}
      // Accept broadcast {} or targeted { done, id }
      if (p.id && p.id !== reqId && p.done !== true && Object.keys(p).length > 0) {
        // unrelated
      }
      if (p.ok === false) {
        done(false, p.error || { message: String(p.error || 'clear failed') })
        return
      }
      done(true)
    }

    const timer = setTimeout(function () {
      done(false, { message: 'VC_CLEAR_STATE timed out', code: 'CLEAR_TIMEOUT' })
    }, 15000)

    navigator.serviceWorker.addEventListener('message', onReply)
    navigator.serviceWorker.ready.then(function () {
      const ctl = navigator.serviceWorker.controller
      if (!ctl) {
        done(false, { message: 'service worker not ready', code: 'NO_SW' })
        return
      }
      ctl.postMessage([MSG_PAGE_CLEAR_STATE, msg])
    })
  }

  /** @type {Map<string, (payload: object) => void>} */
  const swAppWaiters = new Map()

  /**
   * @param {number} replyCmd
   * @param {number} pageCmd
   * @param {Record<string, unknown>} payload
   * @param {string} resultCmd
   * @param {number} [timeoutMs]
   */
  function swAppRpc(replyCmd, pageCmd, payload, resultCmd, timeoutMs) {
    const id = typeof payload.id === 'string' ? payload.id : ''
    function replyError(message, code) {
      if (id) {
        swAppWaiters.delete(id)
      }
      postToParent(resultCmd, {
        id: id,
        ok: false,
        error: { message: message, code: code },
      })
    }
    if (!id) {
      emitError(resultCmd + ' requires payload.id', 'APP_BAD_REQUEST')
      return
    }
    navigator.serviceWorker.ready.then(function () {
      const ctl = navigator.serviceWorker.controller
      if (!ctl) {
        replyError('service worker not ready', 'NO_SW')
        return
      }
      const timeoutId = setTimeout(function () {
        if (!swAppWaiters.has(id)) {
          return
        }
        swAppWaiters.delete(id)
        replyError(resultCmd + ' timed out', 'APP_TIMEOUT')
      }, timeoutMs || 15000)
      swAppWaiters.set(id, function (swPayload) {
        clearTimeout(timeoutId)
        swAppWaiters.delete(id)
        const swData = swPayload && typeof swPayload === 'object' ? swPayload : {}
        if (!swData.ok) {
          postToParent(resultCmd, {
            id: id,
            ok: false,
            error: swData.error || { message: 'failed', code: 'APP_FAILED' },
          })
          return
        }
        postToParent(resultCmd, {
          id: id,
          ok: true,
          value: swData.value,
        })
      })
      ctl.postMessage([pageCmd, payload])
    })
  }

  /**
   * @param {number} replyCmd
   * @param {object} payload
   */
  function settleSwAppWaiter(replyCmd, payload) {
    const data = payload && typeof payload === 'object' ? payload : {}
    const id = typeof data.id === 'string' ? data.id : ''
    if (!id || !swAppWaiters.has(id)) {
      return
    }
    const resolve = swAppWaiters.get(id)
    if (typeof resolve === 'function') {
      resolve(data)
    }
  }

  /** @type {string[]|null} */
  let allowedOrigins = null

  /** @type {HTMLIFrameElement|null} */
  let contentFrame = null

  /** @type {boolean} */
  let swReady = false

  /** @type {boolean} */
  let fatal = false

  /** VERSION_MISMATCH silent recover attempts while still on blank / no page. */
  const MAX_SILENT_VERSION_RECOVER = 3
  const SILENT_VER_STORAGE_KEY = '_vc_silent_ver'

  /**
   * @returns {number}
   */
  function readSilentVersionRecoverAttempts() {
    try {
      return Math.max(0, +sessionStorage.getItem(SILENT_VER_STORAGE_KEY) || 0)
    } catch {
      return 0
    }
  }

  /**
   * @param {number} n
   */
  function writeSilentVersionRecoverAttempts(n) {
    try {
      if (n <= 0) {
        sessionStorage.removeItem(SILENT_VER_STORAGE_KEY)
      } else {
        sessionStorage.setItem(SILENT_VER_STORAGE_KEY, String(n))
      }
    } catch {
      // ignore
    }
  }

  /** @type {{ url: string, method?: string, body?: string }|null} */
  let pendingNavigateRequest = null

  /** Last known real URL for the content iframe (used when cross-origin blocks location access). */
  /** @type {string} */
  let currentContentUrl = ''

  /** @type {boolean} */
  let loading = false

  /** @type {ReturnType<typeof setTimeout>|null} */
  let loadingWatchdogTimer = null

  /** @type {ReturnType<typeof setTimeout>|null} */
  let swReadyWaitTimer = null

  const LOADING_WATCHDOG_MS = 60000
  const SW_READY_WAIT_MS = 15000

  function clearLoadingWatchdog() {
    if (loadingWatchdogTimer) {
      clearTimeout(loadingWatchdogTimer)
      loadingWatchdogTimer = null
    }
  }

  function clearSwReadyWait() {
    if (swReadyWaitTimer) {
      clearTimeout(swReadyWaitTimer)
      swReadyWaitTimer = null
    }
  }

  function scheduleSwReadyWait() {
    clearSwReadyWait()
    swReadyWaitTimer = setTimeout(function () {
      swReadyWaitTimer = null
      if (swReady || !pendingNavigateRequest) {
        return
      }
      const req = pendingNavigateRequest
      pendingNavigateRequest = null
      emitLoadFailed(req.url, 'Service Worker 未就绪（加载超时）', 'SW_NOT_READY')
    }, SW_READY_WAIT_MS)
  }

  function scheduleLoadingWatchdog() {
    clearLoadingWatchdog()
    loadingWatchdogTimer = setTimeout(function () {
      loadingWatchdogTimer = null
      if (!loading) {
        return
      }
      emitLoadFailed(
        currentContentUrl || '',
        '页面加载超时（' + Math.round(LOADING_WATCHDOG_MS / 1000) + 's）',
        'LOAD_TIMEOUT',
      )
    }, LOADING_WATCHDOG_MS)
  }

  /** @type {{ action: string, url: string, title: string, at: number }[]} */
  const navHistory = []

  /** @type {{ id: string, level: string, args: string[], ts: number, url: string }[]} */
  const consoleBuffer = []

  /** @type {number} */
  let consolePendingNotifyCount = 0

  /** @type {{ id: string, ts: number, method: string, url: string, status: number, type: string, size: number, duration: number, failed: boolean, bypass: boolean }[]} */
  const networkBuffer = []

  /** @type {number} */
  let networkPendingNotifyCount = 0

  /** @type {string} */
  let networkDevtoolsId = ''

  /** @type {boolean} */
  let networkDisableCache = false

  /** @type {boolean} */
  let navProbe = false

  /**
   * When true (default), open(_, '_top'|'_self'|'_parent') is consumed in the
   * viewer instead of being posted as VC_LOCATION. Turn off to A/B-test AST
   * frame spoof (stage 2).
   * @type {boolean}
   */
  let frameBustGuard = true

  function syncDebugOpts() {
    window.__vcDebugOpts = {
      navProbe: !!navProbe,
      frameBustGuard: !!frameBustGuard,
    }
  }

  /**
   * @param {boolean} enabled
   * @param {{ silent?: boolean }} [opts]
   */
  function setNavProbe(enabled, opts) {
    navProbe = !!enabled
    syncDebugOpts()
    DebugPanel.syncNavProbeUi()
    if (!(opts && opts.silent)) {
      vlog('info', ['navProbe:', navProbe ? 'on' : 'off'])
    }
  }

  /**
   * @param {boolean} enabled
   * @param {{ silent?: boolean }} [opts]
   */
  function setFrameBustGuard(enabled, opts) {
    frameBustGuard = !!enabled
    syncDebugOpts()
    DebugPanel.syncNavProbeUi()
    if (!(opts && opts.silent)) {
      vlog('info', ['frameBustGuard:', frameBustGuard ? 'on' : 'off'])
    }
  }

  /**
   * @param {string} level
   * @param {unknown[]} args
   */
  function vlog(level, args) {
    const fn = DebugPanel[level]
    if (typeof fn === 'function') {
      fn.apply(DebugPanel, args)
    }
  }

  /**
   * @param {string} direction
   * @param {string} cmd
   * @param {unknown} [payload]
   * @param {Record<string, unknown>} [meta]
   */
  function vmsg(direction, cmd, payload, meta) {
    DebugPanel.message(direction, cmd, payload, meta)
  }

  /**
   * @param {string} action
   * @param {string} [url]
   * @param {string} [title]
   */
  function recordHistory(action, url, title) {
    navHistory.push({
      action,
      url: url || currentContentUrl || '',
      title: title || '',
      at: Date.now(),
    })
    if (navHistory.length > 100) {
      navHistory.shift()
    }
    vlog('info', ['history:', action, url || currentContentUrl || ''])
  }

  /**
   * @returns {Record<string, unknown>}
   */
  function getDebugState() {
    const state = readContentState()
    return {
      version: VERSION,
      build: BUILD,
      swReady,
      fatal,
      loading,
      contentUrl: state.url || currentContentUrl || '',
      contentTitle: state.title || '',
      proxyPath: contentFrame?.src || '',
      canGoBack: state.canGoBack,
      canGoForward: state.canGoForward,
      allowedOrigins:
        allowedOrigins && allowedOrigins.length ? allowedOrigins.join(', ') : '(all)',
      parentOrigin: window.parent === window ? '(top)' : '(embedded)',
      networkDisableCache: networkDisableCache,
      networkDevtoolsId: networkDevtoolsId || ensureNetworkDevtoolsId(),
      navProbe: navProbe,
      frameBustGuard: frameBustGuard,
      history: navHistory.slice(),
    }
  }

  /**
   * @param {string[]|undefined} origins
   */
  function init(origins) {
    allowedOrigins = origins && origins.length ? origins.slice() : null
    contentFrame = document.getElementById('content')
    if (!contentFrame) {
      emitError('content iframe not found', 'NO_IFRAME')
      return
    }
    if (!contentFrame.name) {
      contentFrame.name = 'vc-content'
    }

    window.__vcOnInjectConsole = ingestInjectConsoleEntry
    window.__vcOnInjectClick = ingestInjectClick
    window.__vcOnInjectLocation = ingestInjectLocation
    window.__vcOnInjectHistory = ingestInjectHistory
    syncDebugOpts()

    window.addEventListener('message', onParentMessage)
    window.addEventListener('message', onInjectMessage)
    navigator.serviceWorker.addEventListener('message', onServiceWorkerMessage)
    contentFrame.addEventListener('load', onContentLoad)
    contentFrame.addEventListener('error', onContentError)

    DebugPanel.setStateProvider(getDebugState)
    DebugPanel.setNavProbeHandlers(
      function (enabled) {
        setNavProbe(enabled)
      },
      function () {
        return navProbe
      },
    )
    DebugPanel.setFrameBustGuardHandlers(
      function (enabled) {
        setFrameBustGuard(enabled)
      },
      function () {
        return frameBustGuard
      },
    )
    DebugPanel.init({ version: VERSION, build: BUILD })
    syncDebugOpts()
    ensureNetworkDevtoolsId()

    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (!navigator.serviceWorker.controller) {
        return
      }
      void assertBuildCompatible()
    })

    if (swReady) {
      postNetworkOptsToSw()
      flushReadyAfterVersionCheck()
    }
  }

  function flushReadyAfterVersionCheck() {
    void assertBuildCompatible().then(function (ok) {
      if (!ok) {
        return
      }
      emitReady()
      const queued = pendingNavigateRequest
      pendingNavigateRequest = null
      if (queued) {
        vlog('info', ['flushing queued navigate:', queued.url])
        applyNavigateRequest(queued)
        return
      }
      if (!currentContentUrl) {
        showBlankPage()
      }
    })
  }

  /** Load the new-tab blank page into #content (no proxy, address bar stays empty). */
  function showBlankPage() {
    if (!contentFrame || fatal) {
      return
    }
    try {
      const blankHref = new URL(BLANK_PATH, location.href).href
      const src = contentFrame.getAttribute('src') || ''
      if (
        src.includes('/blank.html') ||
        /(^|\/)blank(?:\.html)?(?:\?|#|$)/.test(src)
      ) {
        return
      }
      try {
        const win = contentFrame.contentWindow
        const path = win && win.location && win.location.pathname
        if (path === '/blank' || path === '/blank.html') {
          return
        }
      } catch {
        // ignore cross-origin / unloaded
      }
      contentFrame.src = blankHref
    } catch (err) {
      vlog('warn', ['showBlankPage failed', err])
    }
  }

  function swDidReady() {
    swReady = true
    clearSwReadyWait()
    vlog('info', ['service worker ready'])
    postNetworkOptsToSw()
    flushReadyAfterVersionCheck()
  }

  /** @type {Promise<string|null>|null} */
  let buildQueryInFlight = null
  /** @type {number} */
  let buildQuerySeq = 0

  /**
   * @returns {Promise<string|null>} vc_build string, null if unavailable/timeout, undefined sentinel via empty string handled upstream
   */
  function querySwBuild() {
    if (buildQueryInFlight) {
      return buildQueryInFlight
    }
    buildQueryInFlight = new Promise(function (resolve) {
      const ctl = navigator.serviceWorker.controller
      if (!ctl) {
        resolve(null)
        return
      }
      const reqId = 'bq-' + (++buildQuerySeq) + '-' + Date.now()
      let settled = false
      const timer = setTimeout(function () {
        if (settled) {
          return
        }
        settled = true
        navigator.serviceWorker.removeEventListener('message', onReply)
        vlog('warn', ['SW build query timed out'])
        resolve(null)
      }, 3000)
      /**
       * @param {MessageEvent} event
       */
      function onReply(event) {
        if (!Array.isArray(event.data) || event.data[0] !== MSG_SW_BUILD_REPLY) {
          return
        }
        const payload = event.data[1] && typeof event.data[1] === 'object' ? event.data[1] : {}
        if (payload.reqId !== reqId) {
          return
        }
        if (settled) {
          return
        }
        settled = true
        clearTimeout(timer)
        navigator.serviceWorker.removeEventListener('message', onReply)
        resolve(typeof payload.vc_build === 'string' ? payload.vc_build : '')
      }
      navigator.serviceWorker.addEventListener('message', onReply)
      ctl.postMessage([MSG_PAGE_BUILD_GET, { reqId: reqId }])
    }).finally(function () {
      buildQueryInFlight = null
    })
    return buildQueryInFlight
  }

  /**
   * True when no real site has been navigated yet (new tab / blank start page).
   * @returns {boolean}
   */
  function isIdleBlankState() {
    if (currentContentUrl) {
      return false
    }
    if (!contentFrame) {
      return true
    }
    if (isBlankContentFrame()) {
      return true
    }
    const src = contentFrame.getAttribute('src') || contentFrame.src || ''
    return !src || src === 'about:blank'
  }

  /**
   * Soft-reload viewer after SW update without notifying the parent (blank tab only).
   * @param {{ code?: string, message?: string, bridgeBuild?: string, swBuild?: string }} info
   */
  function silentRecoverVersionMismatch(info) {
    const attempts = readSilentVersionRecoverAttempts() + 1
    writeSilentVersionRecoverAttempts(attempts)
    vlog('warn', [
      'version mismatch on blank; silent recover',
      attempts + '/' + MAX_SILENT_VERSION_RECOVER,
      'bridge:',
      info.bridgeBuild || BUILD,
      'SW:',
      info.swBuild || '(unknown)',
    ])
    if (attempts > MAX_SILENT_VERSION_RECOVER) {
      enterFatalState(info, { force: true })
      return
    }
    emitLoading(false)
    if (typeof window.__vcShowBoot === 'function') {
      window.__vcShowBoot('正在更新代理…')
    }
    const finish = function () {
      location.reload()
    }
    navigator.serviceWorker
      .getRegistration()
      .then(function (reg) {
        if (!reg) {
          return
        }
        if (reg.waiting) {
          reg.waiting.postMessage({ type: 'SKIP_WAITING' })
        }
        return reg.update().then(function () {
          if (reg.waiting) {
            reg.waiting.postMessage({ type: 'SKIP_WAITING' })
          }
        })
      })
      .catch(function () {
        // still reload
      })
      .then(finish)
  }

  /**
   * @param {{ code?: string, message?: string, bridgeBuild?: string, swBuild?: string }} info
   * @param {{ force?: boolean }} [opts]
   */
  function enterFatalState(info, opts) {
    if (fatal) {
      return
    }
    const code = (info && info.code) || 'VERSION_MISMATCH'
    const force = opts && opts.force
    if (!force && code === 'VERSION_MISMATCH' && isIdleBlankState()) {
      silentRecoverVersionMismatch(info || {})
      return
    }
    fatal = true
    const bridgeBuild = (info && info.bridgeBuild) || BUILD
    const swBuild = (info && info.swBuild) || ''
    const message =
      (info && info.message) ||
      ('版本不匹配：bridge ' + bridgeBuild + ' vs SW ' + (swBuild || '(unknown)'))
    vlog('error', [message, code])
    currentContentUrl = ''
    emitLoading(false)
    if (contentFrame) {
      try {
        contentFrame.src = 'about:blank'
      } catch (err) {
        // ignore
      }
    }
    postToParent('VC_ERROR', {
      message: message,
      code: code,
      bridgeBuild: bridgeBuild,
      swBuild: swBuild,
    })
    if (typeof window.__vcShowFatal === 'function') {
      window.__vcShowFatal({
        title: '此页面已停止运行',
        message: message,
        bridgeBuild: bridgeBuild,
        swBuild: swBuild,
        code: code,
      })
    }
  }

  /**
   * @returns {Promise<boolean>} true if compatible
   */
  function assertBuildCompatible() {
    if (fatal) {
      return Promise.resolve(false)
    }
    return querySwBuild().then(function (swBuild) {
      if (fatal) {
        return false
      }
      if (swBuild == null) {
        // No controller / timeout — do not fatal on transient miss
        return true
      }
      if (!swBuild) {
        vlog('warn', ['SW vc_build empty; skipping version check'])
        return true
      }
      if (swBuild === BUILD) {
        writeSilentVersionRecoverAttempts(0)
        return true
      }
      enterFatalState({
        code: 'VERSION_MISMATCH',
        message:
          'bridge 与 Service Worker 版本不一致，无法继续可靠代理。\nbridge: ' +
          BUILD +
          '\nSW: ' +
          swBuild,
        bridgeBuild: BUILD,
        swBuild: swBuild,
      })
      return false
    })
  }

  /**
   * @param {MessageEvent} event
   */
  function onServiceWorkerMessage(event) {
    if (!Array.isArray(event.data)) {
      return
    }
    const [cmd, payload] = event.data
    if (cmd === MSG_SW_NETWORK_PUSH && payload && typeof payload === 'object') {
      appendNetworkEntry(payload)
    }
    if (cmd === MSG_SW_NETWORK_BODY_REPLY && payload && typeof payload === 'object') {
      handleNetworkBodyReply(payload)
    }
    if (cmd === MSG_SW_NETWORK_BODY_LINES_REPLY && payload && typeof payload === 'object') {
      handleNetworkBodyLinesReply(payload)
    }
    if (cmd === MSG_SW_NETWORK_HOT_PROBE_REPLY && payload && typeof payload === 'object') {
      handleNetworkHotProbeReply(payload)
    }
    if (cmd === MSG_SW_COOKIE_LIST_REPLY && payload && typeof payload === 'object') {
      settleSwAppWaiter(MSG_SW_COOKIE_LIST_REPLY, payload)
    }
    if (cmd === MSG_SW_COOKIE_DELETE_REPLY && payload && typeof payload === 'object') {
      settleSwAppWaiter(MSG_SW_COOKIE_DELETE_REPLY, payload)
    }
    if (cmd === MSG_SW_COOKIE_CLEAR_REPLY && payload && typeof payload === 'object') {
      settleSwAppWaiter(MSG_SW_COOKIE_CLEAR_REPLY, payload)
    }
    if (cmd === MSG_SW_COOKIE_CLEAR_ALL_REPLY && payload && typeof payload === 'object') {
      settleSwAppWaiter(MSG_SW_COOKIE_CLEAR_ALL_REPLY, payload)
    }
    if (cmd === MSG_SW_NETWORK_CACHE_STATS_REPLY && payload && typeof payload === 'object') {
      settleSwAppWaiter(MSG_SW_NETWORK_CACHE_STATS_REPLY, payload)
    }
    if (cmd === MSG_SW_NETWORK_CACHE_LIST_REPLY && payload && typeof payload === 'object') {
      settleSwAppWaiter(MSG_SW_NETWORK_CACHE_LIST_REPLY, payload)
    }
    if (cmd === MSG_SW_NETWORK_CACHE_CLEAR_REPLY && payload && typeof payload === 'object') {
      settleSwAppWaiter(MSG_SW_NETWORK_CACHE_CLEAR_REPLY, payload)
    }
    if (cmd === MSG_SW_NETWORK_CACHE_CLEAR_ALL_REPLY && payload && typeof payload === 'object') {
      settleSwAppWaiter(MSG_SW_NETWORK_CACHE_CLEAR_ALL_REPLY, payload)
    }
  }

  /**
   * @param {MessageEvent} event
   */
  function onParentMessage(event) {
    if (event.source !== window.parent) {
      return
    }
    if (!isOriginAllowed(event.origin)) {
      vmsg('in', '(blocked)', event.data, { origin: event.origin })
      return
    }
    if (!Array.isArray(event.data) || typeof event.data[0] !== 'string') {
      return
    }

    const [cmd, payload] = event.data
    vmsg('in', cmd, payload, { origin: event.origin })

    if (fatal && cmd !== 'VC_PING' && cmd !== 'VC_RELOAD') {
      if (cmd === 'VC_EVAL' || cmd === 'VC_CONSOLE_READ' || cmd === 'VC_NETWORK_READ' ||
          cmd === 'VC_NETWORK_BODY_READ' || cmd === 'VC_NETWORK_BODY_READ_LINES' ||
          cmd === 'VC_NETWORK_HOT_PROBE' || cmd === 'VC_SCREENSHOT' ||
          cmd === 'VC_COOKIE_LIST' || cmd === 'VC_COOKIE_DELETE' || cmd === 'VC_COOKIE_CLEAR' ||
          cmd === 'VC_COOKIE_CLEAR_ALL' ||
          cmd === 'VC_STORAGE_LIST' || cmd === 'VC_STORAGE_SET' || cmd === 'VC_STORAGE_REMOVE' ||
          cmd === 'VC_STORAGE_CLEAR' || cmd === 'VC_SW_INFO' ||
          cmd === 'VC_NETWORK_CACHE_STATS' || cmd === 'VC_NETWORK_CACHE_LIST' ||
          cmd === 'VC_NETWORK_CACHE_CLEAR' || cmd === 'VC_NETWORK_CACHE_CLEAR_ALL' ||
          cmd === 'VC_IDB_LIST' || cmd === 'VC_IDB_DELETE' || cmd === 'VC_IDB_STORES' ||
          cmd === 'VC_IDB_GET_ALL' ||
          cmd === 'VC_SITE_CACHE_LIST' || cmd === 'VC_SITE_CACHE_KEYS' ||
          cmd === 'VC_SITE_CACHE_DELETE' || cmd === 'VC_CLEAR_STATE') {
        const data = payload && typeof payload === 'object' ? payload : {}
        const id = typeof data.id === 'string' ? data.id : ''
        const resultCmd =
          cmd === 'VC_EVAL' ? 'VC_EVAL_RESULT'
            : cmd === 'VC_CONSOLE_READ' ? 'VC_CONSOLE_READ_RESULT'
              : cmd === 'VC_NETWORK_READ' ? 'VC_NETWORK_READ_RESULT'
                : cmd === 'VC_NETWORK_BODY_READ' ? 'VC_NETWORK_BODY_READ_RESULT'
                  : cmd === 'VC_NETWORK_BODY_READ_LINES' ? 'VC_NETWORK_BODY_READ_LINES_RESULT'
                    : cmd === 'VC_NETWORK_HOT_PROBE' ? 'VC_NETWORK_HOT_PROBE_RESULT'
                      : cmd === 'VC_CLEAR_STATE' ? 'VC_CLEAR_STATE_DONE'
                        : cmd + '_RESULT'
        if (id) {
          postToParent(resultCmd, {
            id: id,
            ok: false,
            error: { message: 'viewer stopped: version mismatch', code: 'VERSION_MISMATCH' },
          })
        }
      }
      emitLoading(false)
      emitError('viewer stopped: version mismatch', 'VERSION_MISMATCH')
      return
    }

    switch (cmd) {
      case 'VC_NAVIGATE':
        navigate(payload)
        break
      case 'VC_BACK':
        historyStep(-1)
        break
      case 'VC_FORWARD':
        historyStep(1)
        break
      case 'VC_RELOAD':
        if (fatal) {
          recoverFromFatal()
        } else {
          reloadContent()
        }
        break
      case 'VC_STOP':
        stopContent()
        break
      case 'VC_PING':
        postToParent('VC_PONG')
        break
      case 'VC_EVAL':
        evalInContent(payload)
        break
      case 'VC_SCREENSHOT':
        captureScreenshot(payload)
        break
      case 'VC_CONSOLE_READ':
        readConsoleHistory(payload)
        break
      case 'VC_NETWORK_READ':
        readNetworkHistory(payload)
        break
      case 'VC_NETWORK_OPTIONS':
        applyNetworkOptions(payload)
        break
      case 'VC_DEBUG_OPTIONS':
        applyDebugOptions(payload)
        break
      case 'VC_DEBUG_PANEL':
        applyDebugPanelOptions(payload)
        break
      case 'VC_NETWORK_BODY_READ':
        readNetworkBody(payload)
        break
      case 'VC_NETWORK_BODY_READ_LINES':
        readNetworkBodyLines(payload)
        break
      case 'VC_NETWORK_HOT_PROBE':
        probeNetworkHot(payload)
        break
      case 'VC_CLEAR_STATE':
        clearStateViaSw(payload)
        break
      case 'VC_COOKIE_LIST':
        swAppRpc(MSG_SW_COOKIE_LIST_REPLY, MSG_PAGE_COOKIE_LIST, payload && typeof payload === 'object' ? payload : {}, 'VC_COOKIE_LIST_RESULT')
        break
      case 'VC_COOKIE_DELETE':
        swAppRpc(MSG_SW_COOKIE_DELETE_REPLY, MSG_PAGE_COOKIE_DELETE, payload && typeof payload === 'object' ? payload : {}, 'VC_COOKIE_DELETE_RESULT')
        break
      case 'VC_COOKIE_CLEAR':
        swAppRpc(MSG_SW_COOKIE_CLEAR_REPLY, MSG_PAGE_COOKIE_CLEAR, payload && typeof payload === 'object' ? payload : {}, 'VC_COOKIE_CLEAR_RESULT')
        break
      case 'VC_COOKIE_CLEAR_ALL':
        swAppRpc(MSG_SW_COOKIE_CLEAR_ALL_REPLY, MSG_PAGE_COOKIE_CLEAR_ALL, payload && typeof payload === 'object' ? payload : {}, 'VC_COOKIE_CLEAR_ALL_RESULT')
        break
      case 'VC_NETWORK_CACHE_STATS':
        swAppRpc(MSG_SW_NETWORK_CACHE_STATS_REPLY, MSG_PAGE_NETWORK_CACHE_STATS, payload && typeof payload === 'object' ? payload : {}, 'VC_NETWORK_CACHE_STATS_RESULT')
        break
      case 'VC_NETWORK_CACHE_LIST':
        swAppRpc(MSG_SW_NETWORK_CACHE_LIST_REPLY, MSG_PAGE_NETWORK_CACHE_LIST, payload && typeof payload === 'object' ? payload : {}, 'VC_NETWORK_CACHE_LIST_RESULT')
        break
      case 'VC_NETWORK_CACHE_CLEAR':
        swAppRpc(MSG_SW_NETWORK_CACHE_CLEAR_REPLY, MSG_PAGE_NETWORK_CACHE_CLEAR, payload && typeof payload === 'object' ? payload : {}, 'VC_NETWORK_CACHE_CLEAR_RESULT')
        break
      case 'VC_NETWORK_CACHE_CLEAR_ALL':
        swAppRpc(MSG_SW_NETWORK_CACHE_CLEAR_ALL_REPLY, MSG_PAGE_NETWORK_CACHE_CLEAR_ALL, payload && typeof payload === 'object' ? payload : {}, 'VC_NETWORK_CACHE_CLEAR_ALL_RESULT')
        break
      case 'VC_STORAGE_LIST':
        handleStorageList(payload)
        break
      case 'VC_STORAGE_SET':
        handleStorageSet(payload)
        break
      case 'VC_STORAGE_REMOVE':
        handleStorageRemove(payload)
        break
      case 'VC_STORAGE_CLEAR':
        handleStorageClear(payload)
        break
      case 'VC_SW_INFO':
        handleSwInfo(payload)
        break
      case 'VC_IDB_LIST':
        handleIdbList(payload)
        break
      case 'VC_IDB_DELETE':
        handleIdbDelete(payload)
        break
      case 'VC_IDB_STORES':
        handleIdbStores(payload)
        break
      case 'VC_IDB_GET_ALL':
        handleIdbGetAll(payload)
        break
      case 'VC_SITE_CACHE_LIST':
        handleSiteCacheList(payload)
        break
      case 'VC_SITE_CACHE_KEYS':
        handleSiteCacheKeys(payload)
        break
      case 'VC_SITE_CACHE_DELETE':
        handleSiteCacheDelete(payload)
        break
      default:
        break
    }
  }

  /**
   * @param {string} url
   */
  function applyNavigateGet(url) {
    if (!contentFrame) {
      return
    }
    currentContentUrl = url
    recordHistory('navigate', url)
    clearConsoleBufferForNavigation()
    emitNavigating(url)
    emitLoading(true)
    contentFrame.src = toProxyUrl(url)
  }

  /**
   * @param {string} url
   * @param {string} body application/x-www-form-urlencoded
   */
  function applyNavigatePost(url, body) {
    if (!contentFrame) {
      return
    }
    currentContentUrl = url
    recordHistory('navigate:post', url)
    clearConsoleBufferForNavigation()
    emitNavigating(url)
    emitLoading(true)

    const proxyUrl = toProxyUrl(url)
    const form = document.createElement('form')
    form.method = 'POST'
    form.action = proxyUrl
    form.target = contentFrame.name || 'vc-content'
    form.style.display = 'none'
    form.acceptCharset = 'UTF-8'

    const params = new URLSearchParams(body)
    params.forEach(function (value, key) {
      const input = document.createElement('input')
      input.type = 'hidden'
      input.name = key
      input.value = value
      form.appendChild(input)
    })

    document.body.appendChild(form)
    form.submit()
    document.body.removeChild(form)
  }

  /**
   * @param {{ url: string, method?: string, body?: string }} request
   */
  function applyNavigateRequest(request) {
    const method = request.method ? String(request.method).toUpperCase() : 'GET'
    if (method === 'POST' && typeof request.body === 'string') {
      applyNavigatePost(request.url, request.body)
      return
    }
    applyNavigateGet(request.url)
  }

  /**
   * @param {string} url
   */
  function applyNavigate(url) {
    applyNavigateGet(url)
  }

  /**
   * @param {unknown} payload
   */
  function navigate(payload) {
    if (fatal) {
      emitLoading(false)
      emitError('viewer stopped: version mismatch', 'VERSION_MISMATCH')
      return
    }
    if (!contentFrame) {
      return
    }
    const url = payload && typeof payload === 'object' && payload.url
      ? normalizeUrl(String(payload.url))
      : null

    if (!url) {
      emitError('invalid navigate url', 'BAD_URL')
      return
    }

    const method =
      payload && typeof payload === 'object' && payload.method
        ? String(payload.method).toUpperCase()
        : 'GET'
    const body =
      payload && typeof payload === 'object' && typeof payload.body === 'string'
        ? payload.body
        : undefined

    /** @type {{ url: string, method?: string, body?: string }} */
    const request = { url }
    if (method === 'POST' && body !== undefined) {
      request.method = 'POST'
      request.body = body
    }

    if (!swReady) {
      pendingNavigateRequest = request
      vlog('info', ['navigate queued (SW not ready):', url])
      emitNavigating(url)
      emitLoading(true)
      scheduleSwReadyWait()
      return
    }

    clearSwReadyWait()
    pendingNavigateRequest = null
    applyNavigateRequest(request)
  }

  /**
   * @param {number} delta
   */
  function historyStep(delta) {
    if (!contentFrame) {
      return
    }
    try {
      const win = contentFrame.contentWindow
      if (!win) {
        return
      }
      if (delta < 0) {
        win.history.back()
      } else {
        win.history.forward()
      }
    } catch (err) {
      emitError(
        err instanceof Error ? err.message : 'history navigation failed',
        'HISTORY_ERROR'
      )
    }
  }

  /**
   * Fatal recover: update viewer SW then reload this viewer document
   * (not Instant OS). Mirrors viewer.html #fatal-reload.
   */
  function recoverFromFatal() {
    function reloadViewer() {
      location.reload()
    }
    if (!navigator.serviceWorker || !navigator.serviceWorker.getRegistration) {
      reloadViewer()
      return
    }
    navigator.serviceWorker
      .getRegistration()
      .then(function (reg) {
        if (!reg) {
          return
        }
        if (reg.waiting) {
          reg.waiting.postMessage({ type: 'SKIP_WAITING' })
        }
        return reg.update().then(function () {
          if (reg.waiting) {
            reg.waiting.postMessage({ type: 'SKIP_WAITING' })
          }
        })
      })
      .catch(function () {
        // ignore — still reload below
      })
      .then(reloadViewer)
  }

  function reloadContent() {
    if (!contentFrame) {
      return
    }
    const navUrl = currentContentUrl || ''
    clearConsoleBufferForNavigation()
    if (navUrl) {
      emitNavigating(navUrl)
    }
    emitLoading(true)

    // Same-origin: delegate to the iframe's own reload.
    try {
      const win = contentFrame.contentWindow
      if (win) {
        void win.location.href
        win.location.reload()
        return
      }
    } catch {
      // Cross-origin (e.g. proxied page escaped to a real URL): fall through.
    }

    // Re-assign proxy src from last known URL or the iframe's current src attribute.
    const proxySrc =
      (currentContentUrl && toProxyUrl(currentContentUrl)) ||
      contentFrame.getAttribute('src') ||
      contentFrame.src

    if (!proxySrc) {
      emitError('no page to reload', 'RELOAD_ERROR')
      emitLoading(false)
      return
    }

    contentFrame.src = proxySrc
  }

  function stopContent() {
    if (!contentFrame) {
      emitLoading(false)
      return
    }
    try {
      const win = contentFrame.contentWindow
      if (win && typeof win.stop === 'function') {
        win.stop()
      }
    } catch {
      // Cross-origin escape: still clear loading UI.
    }
    emitLoading(false)
  }

  /**
   * Eval code in the content page context (Chrome-like REPL).
   * Prefer expression mode: `(async () => { return (code); })()`
   * Fall back to statement mode on SyntaxError: `(async () => { code })()`
   * Enables top-level await and expression return values.
   *
   * @param {Window} win
   * @param {string} code
   * @returns {unknown}
   */
  function evalInPageContext(win, code) {
    const trimmed = String(code)
    try {
      return win.eval('(async () => { return (\n' + trimmed + '\n); })()')
    } catch (err) {
      const isSyntax =
        (err && typeof err === 'object' && /** @type {{ name?: string }} */ (err).name === 'SyntaxError') ||
        err instanceof SyntaxError
      if (!isSyntax) {
        throw err
      }
      return win.eval('(async () => {\n' + trimmed + '\n})()')
    }
  }

  /**
   * @param {unknown} payload
   */
  async function evalInContent(payload) {
    const data = payload && typeof payload === 'object' ? payload : {}
    const id = typeof data.id === 'string' ? data.id : ''
    const code = typeof data.code === 'string' ? data.code : null

    function replyError(message, code, stack) {
      postToParent('VC_EVAL_RESULT', {
        id,
        ok: false,
        error: { message, code, stack },
      })
    }

    if (!id) {
      emitError('VC_EVAL requires payload.id', 'EVAL_BAD_REQUEST')
      return
    }
    if (code === null) {
      replyError('VC_EVAL requires payload.code string', 'EVAL_BAD_CODE')
      return
    }
    if (!contentFrame) {
      replyError('content iframe not found', 'EVAL_NO_FRAME')
      return
    }

    if (!readContentState().url && !currentContentUrl) {
      replyError('no page loaded in content iframe', 'EVAL_NO_CONTENT')
      return
    }

    /** @type {Window|null} */
    let win = null
    try {
      win = contentFrame.contentWindow
      if (!win) {
        throw new Error('content window unavailable')
      }
      void win.document
    } catch (err) {
      replyError(
        err instanceof Error ? err.message : 'cannot access content window',
        'EVAL_ACCESS_DENIED'
      )
      return
    }

    try {
      const raw = evalInPageContext(win, code)
      const value = await resolveMaybePromise(raw)
      postToParent('VC_EVAL_RESULT', {
        id,
        ok: true,
        value: serializeValue(value),
      })
    } catch (err) {
      replyError(
        err instanceof Error ? err.message : String(err),
        'EVAL_RUNTIME',
        err instanceof Error ? err.stack : undefined
      )
    }
  }

  /** @type {Promise<void>|null} */
  let mScreenshotLib = null

  /** @type {WeakMap<Window, Promise<void>>} */
  const mContentScreenshotLib = new WeakMap()

  /**
   * Load modern-screenshot once (public/vendor/modern-screenshot.js).
   * @returns {Promise<void>}
   */
  function loadScreenshotLib() {
    if (mScreenshotLib) {
      return mScreenshotLib
    }
    if (self.modernScreenshot && typeof self.modernScreenshot.domToCanvas === 'function') {
      mScreenshotLib = Promise.resolve()
      return mScreenshotLib
    }
    mScreenshotLib = new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = '/vendor/modern-screenshot.js?b=' + BUILD
      script.onload = function () {
        if (self.modernScreenshot && typeof self.modernScreenshot.domToCanvas === 'function') {
          resolve()
        } else {
          mScreenshotLib = null
          reject(new Error('modern-screenshot loaded but API missing'))
        }
      }
      script.onerror = function () {
        mScreenshotLib = null
        reject(new Error('failed to load modern-screenshot.js'))
      }
      document.head.appendChild(script)
    })
    return mScreenshotLib
  }

  /**
   * 在 #content iframe 内加载 modern-screenshot（与页面同文档，样式表才能正确 rasterize）。
   * @param {Window} contentWin
   * @returns {Promise<void>}
   */
  function loadScreenshotLibInContent(contentWin) {
    if (
      contentWin.modernScreenshot &&
      typeof contentWin.modernScreenshot.domToCanvas === 'function'
    ) {
      return Promise.resolve()
    }
    mContentScreenshotLib.delete(contentWin)

    const promise = (async () => {
      await loadScreenshotLib()
      const res = await fetch(window.location.origin + '/vendor/modern-screenshot.js?b=' + BUILD, {
        cache: 'force-cache',
      })
      if (!res.ok) {
        throw new Error('fetch modern-screenshot.js failed: ' + res.status)
      }
      const code = await res.text()
      contentWin.eval(code)
      if (
        !contentWin.modernScreenshot ||
        typeof contentWin.modernScreenshot.domToCanvas !== 'function'
      ) {
        throw new Error('modern-screenshot eval in content but API missing')
      }
    })().catch((err) => {
      mContentScreenshotLib.delete(contentWin)
      throw err
    })
    mContentScreenshotLib.set(contentWin, promise)
    return promise
  }

  function isElementNode(node) {
    return !!(node && node.nodeType === 1)
  }

  function isHtmlElementNode(node) {
    // 不能用 instanceof HTMLElement：viewer/content 不同 realm，会恒为 false
    return isElementNode(node) && typeof node.style === 'object' && node.style !== null
  }

  function isHtmlImageNode(node) {
    return isElementNode(node) && String(node.tagName).toUpperCase() === 'IMG'
  }

  /**
   * modern-screenshot 拉取跨域 CSS 背景图会 CORS 失败；在 content 上下文走代理同源 fetch。
   * @param {Window} contentWin
   */
  function toProxiedAssetUrl(contentWin, absoluteUrl) {
    const normalized = absoluteUrl
      .replace(/^https?:\/\//i, 'https://')
      .replace(/\?/g, '%3F')
      .replace(/#/g, '%23')
    const href = contentWin.location.href
    const marker = href.indexOf(PROXY_PREFIX)
    if (marker !== -1) {
      return href.slice(0, marker + PROXY_PREFIX.length) + normalized
    }
    return toProxyUrl(absoluteUrl)
  }

  /**
   * @param {string} cssValue
   * @param {Window} contentWin
   */
  function rewriteCssUrlList(cssValue, contentWin) {
    if (!cssValue || !cssValue.includes('url(')) {
      return cssValue
    }
    return cssValue.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (_match, quote, raw) => {
      const trimmed = raw.trim()
      try {
        const parsed = new URL(trimmed, contentWin.document.baseURI || contentWin.location.href)
        if (
          (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
          parsed.origin !== contentWin.location.origin
        ) {
          return 'url(' + quote + toProxiedAssetUrl(contentWin, parsed.href) + quote + ')'
        }
        return 'url(' + quote + parsed.href + quote + ')'
      } catch {
        return 'url(' + quote + trimmed + quote + ')'
      }
    })
  }

  /**
   * 克隆 DOM 中跨域 background-image / img src 改写成 content 同源代理 URL。
   * @param {Node} root
   * @param {Window} contentWin
   */
  function rewriteScreenshotCloneUrls(root, contentWin) {
    if (!isElementNode(root)) {
      return
    }
    /** @type {Element[]} */
    const nodes = root.querySelectorAll ? [root, ...root.querySelectorAll('*')] : [root]
    for (const node of nodes) {
      if (!isHtmlElementNode(node)) {
        continue
      }
      if (node.style.backgroundImage) {
        node.style.backgroundImage = rewriteCssUrlList(node.style.backgroundImage, contentWin)
      }
      if (node.tagName === 'IMG') {
        const src = node.getAttribute('src')
        if (!src || src.startsWith('data:')) {
          continue
        }
        try {
          const parsed = new URL(src, contentWin.document.baseURI || contentWin.location.href)
          if (
            (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
            parsed.origin !== contentWin.location.origin
          ) {
            node.setAttribute('src', toProxiedAssetUrl(contentWin, parsed.href))
          }
        } catch {
          /* keep */
        }
      }
    }
  }

  /**
   * 拉取截图资源：交给 content 的 fetch hook 做代理（不要先拼 /-----，否则偶发异常）。
   * @param {Window} contentWin
   * @param {string} absoluteUrl
   */
  async function fetchScreenshotAsset(contentWin, absoluteUrl) {
    let target = absoluteUrl
    try {
      const parsed = new URL(absoluteUrl)
      // 已是代理 URL 则原样；否则用目标站绝对地址，由 jsproxy fetch hook 编码
      if (!parsed.pathname.includes(PROXY_PREFIX) && !parsed.href.includes(PROXY_PREFIX)) {
        target = parsed.href
      }
    } catch {
      /* keep */
    }
    const response = await contentWin.fetch(target, {
      credentials: 'include',
      cache: 'force-cache',
    })
    if (!response.ok) {
      throw new Error('asset fetch ' + response.status)
    }
    return await response.blob()
  }

  /**
   * 截图前把 img / background-image 固化成 data:（截图后恢复）。
   * 解决：<base href> 把资源解析到目标站，显示正常，但 rasterize 时易裂图/空白。
   * @param {Document} doc
   * @param {Window} contentWin
   * @param {Element} [scope]
   */
  async function materializeDomMedia(doc, contentWin, scope) {
    /** @type {(() => void)[]} */
    const restores = []
    const root = isElementNode(scope) ? scope : doc.documentElement
    /** @type {Map<string, string>} */
    const cache = new Map()

    async function toDataUrl(absolute) {
      const hit = cache.get(absolute)
      if (hit) {
        return hit
      }
      const blob = await fetchScreenshotAsset(contentWin, absolute)
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result || ''))
        reader.onerror = () => reject(reader.error || new Error('FileReader failed'))
        reader.readAsDataURL(blob)
      })
      cache.set(absolute, dataUrl)
      return dataUrl
    }

    function resolveAssetUrl(raw) {
      const trimmed = String(raw || '').trim()
      if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('blob:')) {
        return null
      }
      try {
        return new URL(trimmed, contentWin.document.baseURI || contentWin.location.href).href
      } catch {
        return null
      }
    }

    // 1) <img src>
    const imgs = root.querySelectorAll ? root.querySelectorAll('img') : []
    for (const img of imgs) {
      if (!isHtmlImageNode(img)) {
        continue
      }
      if (img.hasAttribute('data-vc-shot-tile')) {
        continue
      }
      const raw = img.getAttribute('src') || ''
      const absolute = resolveAssetUrl(raw)
      if (!absolute) {
        continue
      }
      try {
        const dataUrl = await toDataUrl(absolute)
        const prev = img.getAttribute('src')
        restores.push(() => {
          if (prev == null) {
            img.removeAttribute('src')
          } else {
            img.setAttribute('src', prev)
          }
        })
        img.setAttribute('src', dataUrl)
      } catch (err) {
        vlog('warn', ['img materialize failed', absolute.slice(0, 80), err])
      }
    }

    // 2) CSS background-image（含验证码 tile）
    const nodes = root.querySelectorAll ? [root, ...root.querySelectorAll('*')] : []
    for (const el of nodes) {
      if (!isHtmlElementNode(el)) {
        continue
      }
      let bg = el.style.backgroundImage
      if (!bg || bg === 'none') {
        continue
      }
      if (!bg.includes('url(') || bg.includes('data:')) {
        continue
      }

      const isAnomalyTile = /\banomaly-modal__image\b/.test(el.className || '')
      const match = bg.match(/url\(\s*(['"]?)([^'")]+)\1\s*\)/i)
      if (!match) {
        continue
      }
      const absolute = resolveAssetUrl(match[2])
      if (!absolute) {
        continue
      }

      try {
        const dataUrl = await toDataUrl(absolute)
        if (isAnomalyTile) {
          const prevBg = el.style.backgroundImage
          const prevPos = el.style.position
          const img = doc.createElement('img')
          img.setAttribute('data-vc-shot-tile', '1')
          img.src = dataUrl
          img.alt = ''
          img.style.cssText =
            'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;pointer-events:none;'
          if (!prevPos) {
            el.style.position = 'relative'
          }
          el.style.backgroundImage = 'none'
          el.appendChild(img)
          restores.push(() => {
            img.remove()
            el.style.backgroundImage = prevBg
            if (!prevPos) {
              el.style.position = ''
            }
          })
        } else {
          const prevBg = el.style.backgroundImage
          restores.push(() => {
            el.style.backgroundImage = prevBg
          })
          el.style.backgroundImage = 'url("' + dataUrl + '")'
        }
      } catch (err) {
        vlog('warn', ['bg materialize failed', absolute.slice(0, 80), err])
      }
    }

    vlog('info', ['screenshot media materialized', cache.size + ' assets'])
    return function restoreDomMedia() {
      for (let i = restores.length - 1; i >= 0; i--) {
        try {
          restores[i]()
        } catch {
          /* ignore */
        }
      }
    }
  }

  /**
   * DDG SERP 等大 DOM 上对 documentElement rasterize 会得到空白；
   * 可见的验证码/对话框层单独截则正常。
   * @param {Document} doc
   * @param {Window} contentWin
   * @returns {Element}
   */
  function pickScreenshotRoot(doc, contentWin) {
    const candidates = [
      '.anomaly-modal__modal',
      '.anomaly-modal__mask',
      '[role="dialog"]',
      '[aria-modal="true"]',
    ]
    const vw = contentWin.innerWidth || 0
    const vh = contentWin.innerHeight || 0
    for (const sel of candidates) {
      /** @type {Element|null} */
      let el = null
      try {
        el = doc.querySelector(sel)
      } catch {
        continue
      }
      if (!el || !isHtmlElementNode(el)) {
        continue
      }
      try {
        const style = contentWin.getComputedStyle(el)
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
          continue
        }
        const rect = el.getBoundingClientRect()
        if (rect.width < 80 || rect.height < 80) {
          continue
        }
        // 覆盖大半视口，或至少是明确的验证码层
        if (
          sel.indexOf('anomaly') !== -1 ||
          (rect.width >= vw * 0.4 && rect.height >= vh * 0.4)
        ) {
          return el
        }
      } catch {
        continue
      }
    }
    return doc.documentElement
  }

  function createProxiedScreenshotFetch(contentWin) {
    return async function proxiedScreenshotFetch(url) {
      let absolute = url
      try {
        absolute = new URL(url, contentWin.document.baseURI || contentWin.location.href).href
      } catch {
        /* keep raw */
      }
      // 不要预先拼 /-----：content fetch 已被 jsproxy hook，会自行编码
      const blob = await fetchScreenshotAsset(contentWin, absolute)
      return blob
    }
  }

  /**
   * @param {unknown} payload
   */
  async function captureScreenshot(payload) {
    const data = payload && typeof payload === 'object' ? payload : {}
    const id = typeof data.id === 'string' ? data.id : ''

    function replyError(message, code) {
      postToParent('VC_SCREENSHOT_RESULT', {
        id,
        ok: false,
        error: { message, code },
      })
    }

    if (!id) {
      emitError('VC_SCREENSHOT requires payload.id', 'SCREENSHOT_BAD_REQUEST')
      replyError('payload.id is required', 'SCREENSHOT_BAD_REQUEST')
      return
    }
    if (!contentFrame) {
      replyError('content iframe not found', 'SCREENSHOT_NO_CONTENT')
      return
    }

    /** @type {Window|null} */
    let win = null
    /** @type {Document|null} */
    let doc = null
    try {
      win = contentFrame.contentWindow
      if (!win) {
        throw new Error('content window unavailable')
      }
      doc = win.document
      void doc
    } catch (err) {
      replyError(
        err instanceof Error ? err.message : 'cannot access content window',
        'SCREENSHOT_ACCESS_DENIED',
      )
      return
    }

    if (!readContentState().url && !currentContentUrl) {
      replyError('no page loaded in content iframe', 'SCREENSHOT_NO_CONTENT')
      return
    }

    const format = data.format === 'png' ? 'png' : 'jpeg'
    const quality =
      typeof data.quality === 'number'
        ? Math.min(1, Math.max(0, data.quality))
        : DEFAULT_SCREENSHOT_QUALITY
    const fullPage = Boolean(data.fullPage)
    const scale =
      typeof data.scale === 'number'
        ? Math.min(2, Math.max(0.25, data.scale))
        : Math.min(win.devicePixelRatio || 1, 2)

    try {
      await loadScreenshotLib()
      /** @type {typeof self.modernScreenshot|null} */
      let ms = null
      try {
        await loadScreenshotLibInContent(win)
        if (win.modernScreenshot && typeof win.modernScreenshot.domToCanvas === 'function') {
          ms = win.modernScreenshot
        }
      } catch (contentLibErr) {
        vlog('warn', ['content modern-screenshot unavailable, using iframe capture:', contentLibErr])
      }
      if (!ms) {
        ms = self.modernScreenshot
      }
      if (!ms || typeof ms.domToCanvas !== 'function') {
        throw new Error('modern-screenshot unavailable')
      }

      /** 无法在 content 注入库时，改对 #content iframe 元素截图（保留浏览器真实绘制） */
      const useIframeCapture = ms === self.modernScreenshot
      const captureRoot = useIframeCapture ? contentFrame : pickScreenshotRoot(doc, win)
      const el = captureRoot
      const body = useIframeCapture ? null : doc.body
      const scrollX = useIframeCapture || captureRoot !== doc.documentElement ? 0 : win.scrollX || 0
      const scrollY = useIframeCapture || captureRoot !== doc.documentElement ? 0 : win.scrollY || 0
      const viewportW =
        contentFrame.clientWidth ||
        win.innerWidth ||
        (isHtmlElementNode(el) ? el.clientWidth : 0)
      const viewportH =
        contentFrame.clientHeight ||
        win.innerHeight ||
        (isHtmlElementNode(el) ? el.clientHeight : 0)

      const rootW =
        captureRoot !== doc.documentElement && isElementNode(el)
          ? Math.ceil(el.getBoundingClientRect().width) || viewportW
          : viewportW
      const rootH =
        captureRoot !== doc.documentElement && isElementNode(el)
          ? Math.ceil(el.getBoundingClientRect().height) || viewportH
          : viewportH

      const scrollW = useIframeCapture
        ? viewportW
        : captureRoot !== doc.documentElement
          ? rootW
          : Math.max(el.scrollWidth, body ? body.scrollWidth : 0, viewportW)
      const scrollH = useIframeCapture
        ? viewportH
        : captureRoot !== doc.documentElement
          ? rootH
          : Math.max(el.scrollHeight, body ? body.scrollHeight : 0, viewportH)

      let width = fullPage ? scrollW : viewportW
      let height = fullPage ? scrollH : viewportH
      const captureFocused =
        !useIframeCapture && captureRoot !== doc.documentElement
      if (captureFocused) {
        width = rootW
        height = rootH
      }
      width = Math.min(Math.max(1, Math.floor(width)), MAX_SCREENSHOT_CANVAS)
      height = Math.min(Math.max(1, Math.floor(height)), MAX_SCREENSHOT_CANVAS)

      const mime = format === 'png' ? 'image/png' : 'image/jpeg'
      const screenshotFetch = createProxiedScreenshotFetch(win)
      const rasterBase = {
        scale,
        quality,
        type: mime,
        maximumCanvasSize: MAX_SCREENSHOT_CANVAS,
        backgroundColor: '#ffffff',
        fetchFn: screenshotFetch,
        timeout: 30000,
        onCloneNode: (cloned) => {
          rewriteScreenshotCloneUrls(cloned, win)
        },
      }

      if (ms.waitUntilLoad && !useIframeCapture) {
        await ms.waitUntilLoad(body || el, { timeout: 15000 })
      }

      const restoreBackgrounds = useIframeCapture
        ? function noopRestoreBackgrounds() {}
        : await materializeDomMedia(
            doc,
            win,
            captureFocused ? captureRoot : doc.documentElement,
          )

      vlog('info', [
        'screenshot root:',
        captureFocused
          ? captureRoot.className || captureRoot.tagName
          : useIframeCapture
            ? 'iframe'
            : 'documentElement',
        width + 'x' + height,
        'scale=' + scale,
      ])

      /** @type {HTMLCanvasElement} */
      let canvas
      try {
      // 对话框/验证码层：按节点自身尺寸截；整页才走 scroll crop
      if (useIframeCapture || fullPage || captureFocused) {
        canvas = await ms.domToCanvas(el, {
          ...rasterBase,
          width,
          height,
        })
      } else {
        const fullW = Math.min(Math.max(1, Math.floor(scrollW)), MAX_SCREENSHOT_CANVAS)
        const fullH = Math.min(Math.max(1, Math.floor(scrollH)), MAX_SCREENSHOT_CANVAS)
        const fullCanvas = await ms.domToCanvas(el, {
          ...rasterBase,
          width: fullW,
          height: fullH,
        })
        canvas = win.document.createElement('canvas')
        const cropW = Math.min(Math.floor(viewportW * scale), MAX_SCREENSHOT_CANVAS)
        const cropH = Math.min(Math.floor(viewportH * scale), MAX_SCREENSHOT_CANVAS)
        canvas.width = Math.max(1, cropW)
        canvas.height = Math.max(1, cropH)
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          throw new Error('canvas 2d context unavailable')
        }
        const sx = Math.min(Math.floor(scrollX * scale), fullCanvas.width - 1)
        const sy = Math.min(Math.floor(scrollY * scale), fullCanvas.height - 1)
        ctx.drawImage(
          fullCanvas,
          sx,
          sy,
          canvas.width,
          canvas.height,
          0,
          0,
          canvas.width,
          canvas.height,
        )
      }
      } finally {
        restoreBackgrounds()
      }

      const dataUrl = canvas.toDataURL(mime, quality)
      const comma = dataUrl.indexOf(',')
      const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : ''

      postToParent('VC_SCREENSHOT_RESULT', {
        id,
        ok: true,
        value: {
          mime,
          encoding: 'base64',
          data: base64,
          dataUrl,
          width: canvas.width,
          height: canvas.height,
        },
      })
    } catch (err) {
      replyError(
        err instanceof Error ? err.message : String(err),
        'SCREENSHOT_FAILED',
      )
    }
  }

  /**
   * @param {unknown} value
   */
  async function resolveMaybePromise(value) {
    if (value && typeof /** @type {{ then?: unknown }} */ (value).then === 'function') {
      return /** @type {Promise<unknown>} */ (value)
    }
    return value
  }

  /**
   * @param {unknown} value
   */
  function serializeValue(value) {
    if (value === undefined) {
      return { __vc: 'undefined' }
    }
    if (value === null) {
      return null
    }
    if (typeof value === 'function') {
      return { __vc: 'function', name: value.name || 'anonymous' }
    }
    if (typeof value === 'symbol') {
      return { __vc: 'symbol', value: String(value) }
    }
    if (typeof value === 'bigint') {
      return { __vc: 'bigint', value: value.toString() }
    }
    if (value instanceof Error) {
      return {
        __vc: 'error',
        name: value.name,
        message: value.message,
        stack: value.stack,
      }
    }
    try {
      JSON.stringify(value)
      return value
    } catch {
      return {
        __vc: 'unserializable',
        type: typeof value,
        string: String(value),
      }
    }
  }

  /**
   * @param {Window|null} source
   */
  function isFromContentFrame(source) {
    if (!contentFrame || !source) {
      return false
    }
    try {
      const win = contentFrame.contentWindow
      if (!win) {
        return false
      }
      if (source === win) {
        return true
      }
      for (let i = 0; i < win.frames.length; i++) {
        if (win.frames[i] === source) {
          return true
        }
      }
    } catch {
      return false
    }
    return false
  }

  /**
   * @param {unknown} payload
   */
  function ingestInjectConsoleEntry(payload) {
    if (!payload || typeof payload !== 'object') {
      return
    }
    const entry = /** @type {{ id?: string, level?: string, args?: unknown, ts?: number, url?: string }} */ (
      payload
    )
    if (typeof entry.id !== 'string' || !entry.id) {
      return
    }

    appendConsoleEntry({
      id: entry.id,
      level: typeof entry.level === 'string' ? entry.level : 'log',
      args: Array.isArray(entry.args) ? entry.args.map(String) : [String(entry.args)],
      ts: typeof entry.ts === 'number' ? entry.ts : Date.now(),
      url: typeof entry.url === 'string' ? entry.url : '',
    })
  }

  /**
   * @param {unknown} payload
   */
  function ingestInjectClick(payload) {
    if (!payload || typeof payload !== 'object') {
      return
    }
    const data = /** @type {{ ts?: number, tagName?: string, href?: string, target?: string, text?: string, id?: string, className?: string, stack?: string[] }} */ (
      payload
    )
    vlog('info', [
      'content click:',
      data.tagName || '?',
      data.href || data.text || '',
    ])
    if (navProbe) {
      emitDebugNav('CLICK', {
        ts: typeof data.ts === 'number' ? data.ts : Date.now(),
        tagName: typeof data.tagName === 'string' ? data.tagName : '',
        href: typeof data.href === 'string' ? data.href : undefined,
        target: typeof data.target === 'string' ? data.target : undefined,
        text: typeof data.text === 'string' ? data.text : undefined,
        stack: Array.isArray(data.stack) ? data.stack : [],
      })
      return
    }
    postToParent('VC_CLICK', {
      ts: typeof data.ts === 'number' ? data.ts : Date.now(),
      tagName: typeof data.tagName === 'string' ? data.tagName : '',
      href: typeof data.href === 'string' ? data.href : undefined,
      target: typeof data.target === 'string' ? data.target : undefined,
      text: typeof data.text === 'string' ? data.text : undefined,
      id: typeof data.id === 'string' ? data.id : undefined,
      className: typeof data.className === 'string' ? data.className : undefined,
    })
  }

  /**
   * Normalize a navigation URL for same-page comparisons (trailing slash, etc.).
   * @param {string} url
   * @returns {string}
   */
  function canonicalNavUrl(url) {
    const raw = String(url || '').trim()
    if (!raw) {
      return ''
    }
    try {
      const u = new URL(raw)
      let path = u.pathname
      if (path.length > 1 && path.endsWith('/')) {
        path = path.slice(0, -1)
      }
      return u.origin + path + u.search + u.hash
    } catch {
      return raw
    }
  }

  /**
   * @param {string} a
   * @param {string} b
   * @returns {boolean}
   */
  function urlsNavEquivalent(a, b) {
    const ca = canonicalNavUrl(a)
    const cb = canonicalNavUrl(b)
    return Boolean(ca && cb && ca === cb)
  }

  /**
   * window.open targets that mean same browsing context, not a new tab.
   * @param {string|undefined} target
   * @returns {boolean}
   */
  function isSameTabOpenTarget(target) {
    const t = String(target || '').toLowerCase()
    return t === '_top' || t === '_self' || t === '_parent'
  }

  /** @type {{ key: string, at: number }} */
  let lastPostedLocation = { key: '', at: 0 }
  const LOCATION_DEDUP_MS = 2000

  /**
   * @param {Record<string, unknown>} out
   * @returns {string}
   */
  function locationPostKey(out) {
    return [
      String(out.method || ''),
      String(out.target || ''),
      canonicalNavUrl(String(out.url || '')),
    ].join('|')
  }

  /**
   * @param {unknown} payload
   */
  function ingestInjectLocation(payload) {
    if (!payload || typeof payload !== 'object') {
      return
    }
    const data =
      /** @type {{ ts?: number, method?: string, httpMethod?: string, url?: string, target?: string, formBody?: string, formEnctype?: string, formFiles?: boolean, stack?: string[] }} */ (
        payload
      )
    const httpMethod =
      typeof data.httpMethod === 'string' ? data.httpMethod.toLowerCase() : undefined
    /** @type {Record<string, unknown>} */
    const out = {
      ts: typeof data.ts === 'number' ? data.ts : Date.now(),
      method: typeof data.method === 'string' ? data.method : 'unknown',
      httpMethod:
        httpMethod === 'get' || httpMethod === 'post' ? httpMethod : undefined,
      url: typeof data.url === 'string' ? data.url : '',
      target: typeof data.target === 'string' ? data.target : undefined,
    }
    if (typeof data.formBody === 'string') {
      out.formBody = data.formBody
    }
    if (typeof data.formEnctype === 'string') {
      out.formEnctype = data.formEnctype
    }
    if (data.formFiles === true) {
      out.formFiles = true
    }
    if (navProbe) {
      emitDebugNav('LOCATION', {
        ts: out.ts,
        method: out.method,
        url: out.url,
        target: out.target,
        stack: Array.isArray(data.stack) ? data.stack : [],
      })
      return
    }

    const method = String(out.method || '')
    const target = typeof out.target === 'string' ? out.target : ''
    const url = typeof out.url === 'string' ? out.url : ''

    // Frame-bust: open(_, '_top'|'_self'|'_parent') is never "open a new tab".
    // Guarding is optional so AST frame-spoof (stage 2) can be A/B tested.
    if (frameBustGuard && method === 'open' && isSameTabOpenTarget(target)) {
      if (!url || urlsNavEquivalent(url, currentContentUrl)) {
        vlog('info', ['frame-bust open consumed:', url || '(empty)', 'target=' + target])
        return
      }
      vlog('info', ['same-tab open → navigate:', url])
      navigate({ url: url })
      return
    }

    const postKey = locationPostKey(out)
    const now = Date.now()
    if (
      lastPostedLocation.key === postKey &&
      now - lastPostedLocation.at < LOCATION_DEDUP_MS
    ) {
      vlog('info', ['duplicate VC_LOCATION suppressed:', postKey])
      return
    }
    lastPostedLocation = { key: postKey, at: now }
    postToParent('VC_LOCATION', out)
  }

  /**
   * @param {unknown} payload
   */
  function ingestInjectHistory(payload) {
    if (!payload || typeof payload !== 'object') {
      return
    }
    const data = /** @type {{ ts?: number, method?: string, url?: string, title?: string, state?: unknown, stack?: string[] }} */ (
      payload
    )
    const url = typeof data.url === 'string' ? data.url : ''
    const method = typeof data.method === 'string' ? data.method : 'unknown'
    const title = typeof data.title === 'string' ? data.title : ''

    if (url) {
      currentContentUrl = url
      recordHistory('spa:' + method, url, title)
    }

    if (navProbe) {
      emitDebugNav('HISTORY', {
        ts: typeof data.ts === 'number' ? data.ts : Date.now(),
        method: method,
        url: url,
        title: title || undefined,
        stack: Array.isArray(data.stack) ? data.stack : [],
      })
      return
    }

    postToParent('VC_HISTORY', {
      ts: typeof data.ts === 'number' ? data.ts : Date.now(),
      method,
      url,
      title: title || undefined,
      state: data.state === undefined ? undefined : data.state,
    })
  }

  /**
   * @param {MessageEvent} event
   */
  function onInjectMessage(event) {
    if (!isFromContentFrame(event.source)) {
      return
    }
    if (!Array.isArray(event.data) || event.data[0] !== '_VC_INJECT') {
      return
    }

    const kind = event.data[1]
    const payload = event.data[2]
    if (kind === 'CONSOLE') {
      ingestInjectConsoleEntry(payload)
      return
    }
    if (kind === 'CLICK') {
      ingestInjectClick(payload)
      return
    }
    if (kind === 'LOCATION') {
      ingestInjectLocation(payload)
      return
    }
    if (kind === 'HISTORY') {
      ingestInjectHistory(payload)
    }
  }

  function ensureConsoleHook() {
    if (!contentFrame) {
      return
    }
    /** @type {Window|null} */
    let win = null
    try {
      win = contentFrame.contentWindow
      if (!win || win.__vcInjected) {
        return
      }
    } catch {
      return
    }

    vlog('warn', ['inject.js not detected after load; reloading inject.js'])
    try {
      const doc = win.document
      if (!doc) {
        return
      }
      const script = doc.createElement('script')
      script.src = location.origin + '/inject.js?b=' + BUILD
      ;(doc.head || doc.documentElement).appendChild(script)
    } catch (err) {
      vlog('error', [
        'inject.js reload failed:',
        err instanceof Error ? err.message : String(err),
      ])
    }
  }

  /**
   * @param {{ id: string, level: string, args: string[], ts: number, url: string }} entry
   */
  function appendConsoleEntry(entry) {
    consoleBuffer.push(entry)
    if (consoleBuffer.length > MAX_CONSOLE_ENTRIES) {
      consoleBuffer.shift()
    }
    consolePendingNotifyCount += 1
    flushConsoleNotify(entry.id)
  }

  /** Drop page console ring on document navigation/reload (Chromo「保留日志」只保留已拉取副本). */
  function clearConsoleBufferForNavigation() {
    if (consoleBuffer.length === 0 && consolePendingNotifyCount === 0) {
      return
    }
    consoleBuffer.length = 0
    consolePendingNotifyCount = 0
  }

  /**
   * @param {string} latestId
   */
  function flushConsoleNotify(latestId) {
    const count = consolePendingNotifyCount
    consolePendingNotifyCount = 0
    postToParent('VC_CONSOLE_UPDATED', { latestId, count })
  }

  /**
   * @param {unknown} payload
   */
  function readConsoleHistory(payload) {
    const data = payload && typeof payload === 'object' ? payload : {}
    const id = typeof data.id === 'string' ? data.id : ''

    function replyError(message, code) {
      postToParent('VC_CONSOLE_READ_RESULT', {
        id,
        ok: false,
        error: { message, code },
      })
    }

    if (!id) {
      emitError('VC_CONSOLE_READ requires payload.id', 'CONSOLE_BAD_REQUEST')
      return
    }

    let limit = DEFAULT_CONSOLE_READ_LIMIT
    if (typeof data.limit === 'number' && data.limit > 0) {
      limit = Math.min(Math.floor(data.limit), MAX_CONSOLE_READ_LIMIT)
    }

    const after = typeof data.after === 'string' ? data.after : ''
    let startIndex = 0
    if (after) {
      const idx = consoleBuffer.findIndex((entry) => entry.id === after)
      // Cursor missing (buffer rotated): do not resend the whole buffer — empty delta.
      startIndex = idx >= 0 ? idx + 1 : consoleBuffer.length
    }

    const entries = consoleBuffer.slice(startIndex, startIndex + limit)
    const latestId =
      consoleBuffer.length > 0 ? consoleBuffer[consoleBuffer.length - 1].id : after || null

    postToParent('VC_CONSOLE_READ_RESULT', {
      id,
      ok: true,
      value: {
        entries,
        latestId,
      },
    })
  }

  function ensureNetworkDevtoolsId() {
    if (networkDevtoolsId) {
      return networkDevtoolsId
    }
    try {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        networkDevtoolsId = crypto.randomUUID()
        return networkDevtoolsId
      }
    } catch {
      // ignore
    }
    networkDevtoolsId = String(Date.now()) + '-' + Math.random().toString(16).slice(2)
    return networkDevtoolsId
  }

  function postNetworkOptsToSw() {
    const devtoolsId = ensureNetworkDevtoolsId()
    navigator.serviceWorker.ready.then(function () {
      const ctl = navigator.serviceWorker.controller
      if (!ctl) {
        return
      }
      ctl.postMessage([
        MSG_PAGE_NETWORK_OPTS,
        {
          devtoolsId: devtoolsId,
          disableCache: networkDisableCache,
        },
      ])
    })
  }

  /**
   * @param {unknown} payload
   */
  function applyNetworkOptions(payload) {
    const data = payload && typeof payload === 'object' ? payload : {}
    if (typeof data.devtoolsId === 'string' && data.devtoolsId) {
      networkDevtoolsId = data.devtoolsId
    } else {
      ensureNetworkDevtoolsId()
    }
    if (typeof data.disableCache === 'boolean') {
      networkDisableCache = data.disableCache
    }
    postNetworkOptsToSw()
  }

  /**
   * @param {unknown} payload
   */
  function applyDebugOptions(payload) {
    const data = payload && typeof payload === 'object' ? payload : {}
    if (typeof data.navProbe === 'boolean') {
      setNavProbe(data.navProbe)
    }
    if (typeof data.frameBustGuard === 'boolean') {
      setFrameBustGuard(data.frameBustGuard)
    }
  }

  /**
   * Show/hide the viewer floating DebugPanel (green 「调」 button).
   * Default: hidden when embedded in a parent iframe; visible as top window.
   * @param {unknown} payload
   */
  function applyDebugPanelOptions(payload) {
    const data = payload && typeof payload === 'object' ? payload : {}
    if (typeof data.enabled === 'boolean') {
      DebugPanel.setVisible(data.enabled)
    }
  }

  /**
   * @param {string} kind
   * @param {Record<string, unknown>} data
   */
  function emitDebugNav(kind, data) {
    /** @type {Record<string, unknown>} */
    const out = {
      kind: kind,
      ts: typeof data.ts === 'number' ? data.ts : Date.now(),
    }
    if (typeof data.method === 'string') {
      out.method = data.method
    }
    if (typeof data.url === 'string') {
      out.url = data.url
    }
    if (typeof data.href === 'string') {
      out.href = data.href
    }
    if (typeof data.target === 'string') {
      out.target = data.target
    }
    if (typeof data.tagName === 'string') {
      out.tagName = data.tagName
    }
    if (typeof data.text === 'string') {
      out.text = data.text
    }
    if (typeof data.title === 'string') {
      out.title = data.title
    }
    if (Array.isArray(data.stack)) {
      out.stack = data.stack.filter(function (line) {
        return typeof line === 'string'
      })
    }
    DebugPanel.nav({
      kind: kind,
      method: typeof out.method === 'string' ? out.method : undefined,
      url: typeof out.url === 'string' ? out.url : undefined,
      href: typeof out.href === 'string' ? out.href : undefined,
      target: typeof out.target === 'string' ? out.target : undefined,
      tagName: typeof out.tagName === 'string' ? out.tagName : undefined,
      stack: Array.isArray(out.stack) ? /** @type {string[]} */ (out.stack) : [],
      ts: /** @type {number} */ (out.ts),
    })
    postToParent('VC_DEBUG_NAV', out)
  }

  function dropArchiveEntry(entryId) {
    if (!entryId) {
      return
    }
    navigator.serviceWorker.ready.then(function () {
      const ctl = navigator.serviceWorker.controller
      if (!ctl) {
        return
      }
      ctl.postMessage([MSG_PAGE_NETWORK_ARCHIVE_DROP, { entryId: entryId }])
    })
  }

  /** @type {Map<string, (payload: unknown) => void>} */
  const networkBodyWaiters = new Map()

  /**
   * @param {unknown} payload
   */
  function handleNetworkBodyReply(payload) {
    const data = payload && typeof payload === 'object' ? payload : {}
    const id = typeof data.id === 'string' ? data.id : ''
    if (!id || !networkBodyWaiters.has(id)) {
      return
    }
    const resolve = networkBodyWaiters.get(id)
    networkBodyWaiters.delete(id)
    if (typeof resolve === 'function') {
      resolve(data)
    }
  }

  /**
   * @param {unknown} payload
   */
  function readNetworkBody(payload) {
    const data = payload && typeof payload === 'object' ? payload : {}
    const id = typeof data.id === 'string' ? data.id : ''
    const entryId = typeof data.entryId === 'string' ? data.entryId : ''

    function replyError(message, code) {
      if (networkBodyWaiters.has(id)) {
        networkBodyWaiters.delete(id)
      }
      postToParent('VC_NETWORK_BODY_READ_RESULT', {
        id: id,
        ok: false,
        error: { message: message, code: code },
      })
    }

    if (!id || !entryId) {
      emitError('VC_NETWORK_BODY_READ requires id and entryId', 'NETWORK_BODY_BAD_REQUEST')
      return
    }

    navigator.serviceWorker.ready.then(function () {
      const ctl = navigator.serviceWorker.controller
      if (!ctl) {
        replyError('service worker not ready', 'NO_SW')
        return
      }

      const timeoutId = setTimeout(function () {
        if (!networkBodyWaiters.has(id)) {
          return
        }
        networkBodyWaiters.delete(id)
        replyError('body read timed out', 'NETWORK_BODY_TIMEOUT')
      }, 30000)

      networkBodyWaiters.set(id, function (swPayload) {
        clearTimeout(timeoutId)
        networkBodyWaiters.delete(id)
        const swData = swPayload && typeof swPayload === 'object' ? swPayload : {}
        if (!swData.ok) {
          postToParent('VC_NETWORK_BODY_READ_RESULT', {
            id: id,
            ok: false,
            error: swData.error || { message: 'read failed', code: 'NETWORK_BODY_READ_FAILED' },
          })
          return
        }

        const value = swData.value && typeof swData.value === 'object' ? swData.value : {}
        const body = value.body
        let encoding = 'base64'
        let encodedBody = ''

        if (body instanceof ArrayBuffer) {
          const bytes = new Uint8Array(body)
          let binary = ''
          for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i])
          }
          encodedBody = btoa(binary)
        } else if (typeof body === 'string') {
          encoding = 'text'
          encodedBody = body
        }

        postToParent('VC_NETWORK_BODY_READ_RESULT', {
          id: id,
          ok: true,
          value: {
            headers: value.headers || {},
            body: encodedBody,
            encoding: encoding,
            truncated: !!value.truncated,
            status: typeof value.status === 'number' ? value.status : 0,
          },
        })
      })

      ctl.postMessage([
        MSG_PAGE_NETWORK_BODY_READ,
        {
          id: id,
          entryId: entryId,
        },
      ])
    })
  }

  /** @type {Map<string, (payload: unknown) => void>} */
  const networkBodyLinesWaiters = new Map()

  /**
   * @param {unknown} payload
   */
  function handleNetworkBodyLinesReply(payload) {
    const data = payload && typeof payload === 'object' ? payload : {}
    const id = typeof data.id === 'string' ? data.id : ''
    if (!id || !networkBodyLinesWaiters.has(id)) {
      return
    }
    const resolve = networkBodyLinesWaiters.get(id)
    networkBodyLinesWaiters.delete(id)
    if (typeof resolve === 'function') {
      resolve(data)
    }
  }

  /**
   * @param {unknown} payload
   */
  function readNetworkBodyLines(payload) {
    const data = payload && typeof payload === 'object' ? payload : {}
    const id = typeof data.id === 'string' ? data.id : ''
    const entryId = typeof data.entryId === 'string' ? data.entryId : ''
    const fromLine = typeof data.fromLine === 'number' ? data.fromLine : undefined
    const toLine = typeof data.toLine === 'number' ? data.toLine : undefined
    const metaOnly = !!data.metaOnly

    function replyError(message, code) {
      if (networkBodyLinesWaiters.has(id)) {
        networkBodyLinesWaiters.delete(id)
      }
      postToParent('VC_NETWORK_BODY_READ_LINES_RESULT', {
        id: id,
        ok: false,
        error: { message: message, code: code },
      })
    }

    if (!id || !entryId) {
      emitError('VC_NETWORK_BODY_READ_LINES requires id and entryId', 'NETWORK_BODY_BAD_REQUEST')
      return
    }

    navigator.serviceWorker.ready.then(function () {
      const ctl = navigator.serviceWorker.controller
      if (!ctl) {
        replyError('service worker not ready', 'NO_SW')
        return
      }

      const timeoutId = setTimeout(function () {
        if (!networkBodyLinesWaiters.has(id)) {
          return
        }
        networkBodyLinesWaiters.delete(id)
        replyError('body lines read timed out', 'NETWORK_BODY_TIMEOUT')
      }, 30000)

      networkBodyLinesWaiters.set(id, function (swPayload) {
        clearTimeout(timeoutId)
        networkBodyLinesWaiters.delete(id)
        const swData = swPayload && typeof swPayload === 'object' ? swPayload : {}
        if (!swData.ok) {
          postToParent('VC_NETWORK_BODY_READ_LINES_RESULT', {
            id: id,
            ok: false,
            error: swData.error || { message: 'read failed', code: 'NETWORK_BODY_READ_FAILED' },
          })
          return
        }

        const value = swData.value && typeof swData.value === 'object' ? swData.value : {}
        postToParent('VC_NETWORK_BODY_READ_LINES_RESULT', {
          id: id,
          ok: true,
          value: {
            headers: value.headers || {},
            status: typeof value.status === 'number' ? value.status : 0,
            totalLines: typeof value.totalLines === 'number' ? value.totalLines : 0,
            fromLine: typeof value.fromLine === 'number' ? value.fromLine : 0,
            toLine: typeof value.toLine === 'number' ? value.toLine : 0,
            lines: Array.isArray(value.lines) ? value.lines : [],
            contentType: typeof value.contentType === 'string' ? value.contentType : undefined,
            charset: typeof value.charset === 'string' ? value.charset : undefined,
            rangeClamped: !!value.rangeClamped,
          },
        })
      })

      /** @type {Record<string, unknown>} */
      const msg = {
        id: id,
        entryId: entryId,
      }
      if (typeof fromLine === 'number') {
        msg.fromLine = fromLine
      }
      if (typeof toLine === 'number') {
        msg.toLine = toLine
      }
      if (metaOnly) {
        msg.metaOnly = true
      }

      ctl.postMessage([MSG_PAGE_NETWORK_BODY_READ_LINES, msg])
    })
  }

  /** @type {Map<string, (payload: unknown) => void>} */
  const networkHotProbeWaiters = new Map()

  /**
   * @param {unknown} payload
   */
  function handleNetworkHotProbeReply(payload) {
    const data = payload && typeof payload === 'object' ? payload : {}
    const id = typeof data.id === 'string' ? data.id : ''
    if (!id || !networkHotProbeWaiters.has(id)) {
      return
    }
    const resolve = networkHotProbeWaiters.get(id)
    networkHotProbeWaiters.delete(id)
    if (typeof resolve === 'function') {
      resolve(data)
    }
  }

  /**
   * @param {unknown} payload
   */
  function probeNetworkHot(payload) {
    const data = payload && typeof payload === 'object' ? payload : {}
    const id = typeof data.id === 'string' ? data.id : ''
    const method = typeof data.method === 'string' ? data.method : 'GET'
    const url = typeof data.url === 'string' ? data.url : ''

    function replyError(message, code) {
      if (networkHotProbeWaiters.has(id)) {
        networkHotProbeWaiters.delete(id)
      }
      postToParent('VC_NETWORK_HOT_PROBE_RESULT', {
        id: id,
        ok: false,
        error: { message: message, code: code },
      })
    }

    if (!id || !url) {
      emitError('VC_NETWORK_HOT_PROBE requires id and url', 'HOT_PROBE_BAD_REQUEST')
      return
    }

    navigator.serviceWorker.ready.then(function () {
      const ctl = navigator.serviceWorker.controller
      if (!ctl) {
        replyError('service worker not ready', 'NO_SW')
        return
      }

      const timeoutId = setTimeout(function () {
        if (!networkHotProbeWaiters.has(id)) {
          return
        }
        networkHotProbeWaiters.delete(id)
        replyError('hot probe timed out', 'HOT_PROBE_TIMEOUT')
      }, 10000)

      networkHotProbeWaiters.set(id, function (swPayload) {
        clearTimeout(timeoutId)
        networkHotProbeWaiters.delete(id)
        const swData = swPayload && typeof swPayload === 'object' ? swPayload : {}
        if (!swData.ok) {
          postToParent('VC_NETWORK_HOT_PROBE_RESULT', {
            id: id,
            ok: false,
            error: swData.error || { message: 'probe failed', code: 'HOT_PROBE_FAILED' },
          })
          return
        }
        const value = swData.value && typeof swData.value === 'object' ? swData.value : {}
        postToParent('VC_NETWORK_HOT_PROBE_RESULT', {
          id: id,
          ok: true,
          value: {
            exists: !!value.exists,
            fresh: value.fresh !== undefined ? !!value.fresh : !!value.exists,
            expiresAt: typeof value.expiresAt === 'number' ? value.expiresAt : undefined,
          },
        })
      })

      ctl.postMessage([
        MSG_PAGE_NETWORK_HOT_PROBE,
        {
          id: id,
          method: method,
          url: url,
        },
      ])
    })
  }

  /**
   * @returns {{ win: Window, origin: string } | { error: string, code: string }}
   */
  function requireContentWin() {
    if (!contentFrame) {
      return { error: 'content iframe not found', code: 'NO_FRAME' }
    }
    try {
      const win = contentFrame.contentWindow
      if (!win) {
        return { error: 'content window unavailable', code: 'NO_WINDOW' }
      }
      void win.document
      let origin = ''
      try {
        origin = win.location.origin || ''
      } catch (_) {
        origin = ''
      }
      if (!origin || origin === 'null') {
        const state = readContentState()
        if (state.url) {
          try {
            origin = new URL(state.url).origin
          } catch (_) {
            // ignore
          }
        }
      }
      return { win: win, origin: origin }
    } catch (err) {
      return {
        error: err instanceof Error ? err.message : 'cannot access content window',
        code: 'ACCESS_DENIED',
      }
    }
  }

  /**
   * @param {string} resultCmd
   * @param {unknown} payload
   * @param {(ctx: { win: Window, origin: string, data: Record<string, unknown>, id: string }) => unknown | Promise<unknown>} fn
   */
  function withContentRpc(resultCmd, payload, fn) {
    const data = payload && typeof payload === 'object' ? /** @type {Record<string, unknown>} */ (payload) : {}
    const id = typeof data.id === 'string' ? data.id : ''
    function replyError(message, code) {
      postToParent(resultCmd, { id: id, ok: false, error: { message: message, code: code } })
    }
    if (!id) {
      emitError(resultCmd + ' requires payload.id', 'APP_BAD_REQUEST')
      return
    }
    const ctx = requireContentWin()
    if ('error' in ctx) {
      replyError(ctx.error, ctx.code)
      return
    }
    Promise.resolve()
      .then(function () {
        return fn({ win: ctx.win, origin: ctx.origin, data: data, id: id })
      })
      .then(function (value) {
        postToParent(resultCmd, { id: id, ok: true, value: value })
      })
      .catch(function (err) {
        replyError(err instanceof Error ? err.message : String(err), 'APP_RUNTIME')
      })
  }

  /** @param {unknown} payload */
  function handleStorageList(payload) {
    withContentRpc('VC_STORAGE_LIST_RESULT', payload, function (ctx) {
      const type = ctx.data.type === 'session' ? 'session' : 'local'
      const store = type === 'session' ? ctx.win.sessionStorage : ctx.win.localStorage
      /** @type {{ key: string, value: string }[]} */
      const entries = []
      for (let i = 0; i < store.length; i++) {
        const key = store.key(i)
        if (key == null) {
          continue
        }
        entries.push({ key: key, value: store.getItem(key) || '' })
      }
      return { type: type, origin: ctx.origin, entries: entries }
    })
  }

  /** @param {unknown} payload */
  function handleStorageSet(payload) {
    withContentRpc('VC_STORAGE_SET_RESULT', payload, function (ctx) {
      const type = ctx.data.type === 'session' ? 'session' : 'local'
      const key = typeof ctx.data.key === 'string' ? ctx.data.key : ''
      const value = ctx.data.value == null ? '' : String(ctx.data.value)
      if (!key) {
        throw Object.assign(new Error('key required'), { code: 'BAD_KEY' })
      }
      const store = type === 'session' ? ctx.win.sessionStorage : ctx.win.localStorage
      store.setItem(key, value)
      return { type: type, key: key }
    })
  }

  /** @param {unknown} payload */
  function handleStorageRemove(payload) {
    withContentRpc('VC_STORAGE_REMOVE_RESULT', payload, function (ctx) {
      const type = ctx.data.type === 'session' ? 'session' : 'local'
      const key = typeof ctx.data.key === 'string' ? ctx.data.key : ''
      if (!key) {
        throw Object.assign(new Error('key required'), { code: 'BAD_KEY' })
      }
      const store = type === 'session' ? ctx.win.sessionStorage : ctx.win.localStorage
      store.removeItem(key)
      return { type: type, key: key }
    })
  }

  /** @param {unknown} payload */
  function handleStorageClear(payload) {
    withContentRpc('VC_STORAGE_CLEAR_RESULT', payload, function (ctx) {
      const type = ctx.data.type === 'session' ? 'session' : 'local'
      const store = type === 'session' ? ctx.win.sessionStorage : ctx.win.localStorage
      store.clear()
      return { type: type, origin: ctx.origin }
    })
  }

  /** @param {unknown} payload */
  function handleSwInfo(payload) {
    const data = payload && typeof payload === 'object' ? payload : {}
    const id = typeof data.id === 'string' ? data.id : ''
    if (!id) {
      emitError('VC_SW_INFO requires payload.id', 'APP_BAD_REQUEST')
      return
    }
    const ctl = navigator.serviceWorker.controller
    const scriptURL = ctl && ctl.scriptURL ? ctl.scriptURL : ''
    const state = ctl && ctl.state ? ctl.state : 'none'
    postToParent('VC_SW_INFO_RESULT', {
      id: id,
      ok: true,
      value: {
        scriptURL: scriptURL,
        state: state,
        build: BUILD,
        version: VERSION,
        controlled: !!ctl,
        siteServiceWorkerBlocked: true,
      },
    })
  }

  /** @param {unknown} payload */
  function handleIdbList(payload) {
    withContentRpc('VC_IDB_LIST_RESULT', payload, async function (ctx) {
      if (!ctx.win.indexedDB || typeof ctx.win.indexedDB.databases !== 'function') {
        return { databases: [] }
      }
      const dbs = await ctx.win.indexedDB.databases()
      return {
        databases: (dbs || []).map(function (d) {
          return { name: d.name || '', version: d.version || 0 }
        }),
      }
    })
  }

  /** @param {unknown} payload */
  function handleIdbDelete(payload) {
    withContentRpc('VC_IDB_DELETE_RESULT', payload, function (ctx) {
      const name = typeof ctx.data.name === 'string' ? ctx.data.name : ''
      if (!name) {
        throw Object.assign(new Error('name required'), { code: 'BAD_NAME' })
      }
      return new Promise(function (resolve, reject) {
        const req = ctx.win.indexedDB.deleteDatabase(name)
        req.onsuccess = function () {
          resolve({ name: name })
        }
        req.onerror = function () {
          reject(req.error || new Error('deleteDatabase failed'))
        }
        req.onblocked = function () {
          resolve({ name: name, blocked: true })
        }
      })
    })
  }

  /** @param {unknown} payload */
  function handleIdbStores(payload) {
    withContentRpc('VC_IDB_STORES_RESULT', payload, function (ctx) {
      const name = typeof ctx.data.name === 'string' ? ctx.data.name : ''
      if (!name) {
        throw Object.assign(new Error('name required'), { code: 'BAD_NAME' })
      }
      return new Promise(function (resolve, reject) {
        const req = ctx.win.indexedDB.open(name)
        req.onerror = function () {
          reject(req.error || new Error('open failed'))
        }
        req.onsuccess = function () {
          const db = req.result
          try {
            const names = [...db.objectStoreNames]
            if (names.length === 0) {
              db.close()
              resolve({ name: name, version: db.version, stores: [] })
              return
            }
            const tx = db.transaction(names, 'readonly')
            /** @type {{ name: string, count: number }[]} */
            const stores = []
            let pending = names.length
            names.forEach(function (storeName) {
              const store = tx.objectStore(storeName)
              const countReq = store.count()
              countReq.onsuccess = function () {
                stores.push({ name: storeName, count: countReq.result | 0 })
                pending -= 1
                if (pending === 0) {
                  db.close()
                  resolve({ name: name, version: db.version, stores: stores })
                }
              }
              countReq.onerror = function () {
                stores.push({ name: storeName, count: -1 })
                pending -= 1
                if (pending === 0) {
                  db.close()
                  resolve({ name: name, version: db.version, stores: stores })
                }
              }
            })
          } catch (err) {
            try {
              db.close()
            } catch (_) {}
            reject(err)
          }
        }
      })
    })
  }

  /**
   * @param {unknown} value
   * @param {number} [maxLen]
   */
  function serializeIdbValue(value, maxLen) {
    const limit = maxLen || 8000
    try {
      if (value === undefined) {
        return { type: 'undefined', preview: 'undefined' }
      }
      if (value === null) {
        return { type: 'null', preview: 'null' }
      }
      if (typeof value === 'string') {
        const truncated = value.length > limit
        return {
          type: 'string',
          preview: truncated ? value.slice(0, limit) + '…' : value,
          truncated: truncated,
        }
      }
      if (typeof value === 'number' || typeof value === 'boolean') {
        return { type: typeof value, preview: String(value) }
      }
      if (typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer) {
        return { type: 'ArrayBuffer', preview: 'ArrayBuffer(' + value.byteLength + ')' }
      }
      const json = JSON.stringify(value)
      if (typeof json === 'string') {
        const truncated = json.length > limit
        return {
          type: 'json',
          preview: truncated ? json.slice(0, limit) + '…' : json,
          truncated: truncated,
        }
      }
      return { type: typeof value, preview: Object.prototype.toString.call(value) }
    } catch (_) {
      return { type: 'unserializable', preview: Object.prototype.toString.call(value) }
    }
  }

  /** @param {unknown} payload */
  function handleIdbGetAll(payload) {
    withContentRpc('VC_IDB_GET_ALL_RESULT', payload, function (ctx) {
      const name = typeof ctx.data.name === 'string' ? ctx.data.name : ''
      const storeName = typeof ctx.data.store === 'string' ? ctx.data.store : ''
      const limit = typeof ctx.data.limit === 'number' ? Math.min(500, Math.max(1, ctx.data.limit)) : 100
      if (!name || !storeName) {
        throw Object.assign(new Error('name and store required'), { code: 'BAD_ARGS' })
      }
      return new Promise(function (resolve, reject) {
        const req = ctx.win.indexedDB.open(name)
        req.onerror = function () {
          reject(req.error || new Error('open failed'))
        }
        req.onsuccess = function () {
          const db = req.result
          try {
            const tx = db.transaction(storeName, 'readonly')
            const store = tx.objectStore(storeName)
            const keyPath = store.keyPath
            const getAllReq =
              typeof store.getAll === 'function' ? store.getAll(undefined, limit) : null
            if (!getAllReq) {
              db.close()
              resolve({ name: name, store: storeName, keyPath: keyPath, entries: [], truncated: true })
              return
            }
            getAllReq.onsuccess = function () {
              const values = getAllReq.result || []
              /** @type {{ key: unknown, value: object }[]} */
              const entries = []
              // Also pull keys if possible
              const keysReq = typeof store.getAllKeys === 'function' ? store.getAllKeys(undefined, limit) : null
              function finish(keys) {
                for (let i = 0; i < values.length; i++) {
                  entries.push({
                    key: keys && keys[i] !== undefined ? keys[i] : i,
                    value: serializeIdbValue(values[i]),
                  })
                }
                db.close()
                resolve({
                  name: name,
                  store: storeName,
                  keyPath: keyPath,
                  entries: entries,
                  truncated: values.length >= limit,
                })
              }
              if (keysReq) {
                keysReq.onsuccess = function () {
                  finish(keysReq.result || [])
                }
                keysReq.onerror = function () {
                  finish(null)
                }
              } else {
                finish(null)
              }
            }
            getAllReq.onerror = function () {
              db.close()
              reject(getAllReq.error || new Error('getAll failed'))
            }
          } catch (err) {
            try {
              db.close()
            } catch (_) {}
            reject(err)
          }
        }
      })
    })
  }

  /** @param {unknown} payload */
  function handleSiteCacheList(payload) {
    withContentRpc('VC_SITE_CACHE_LIST_RESULT', payload, async function (ctx) {
      if (!ctx.win.caches) {
        return { caches: [] }
      }
      const keys = await ctx.win.caches.keys()
      return { caches: keys }
    })
  }

  /** @param {unknown} payload */
  function handleSiteCacheKeys(payload) {
    withContentRpc('VC_SITE_CACHE_KEYS_RESULT', payload, async function (ctx) {
      const cacheName = typeof ctx.data.cache === 'string' ? ctx.data.cache : ''
      const limit = typeof ctx.data.limit === 'number' ? Math.min(500, Math.max(1, ctx.data.limit)) : 200
      if (!cacheName) {
        throw Object.assign(new Error('cache required'), { code: 'BAD_CACHE' })
      }
      const cache = await ctx.win.caches.open(cacheName)
      const reqs = await cache.keys()
      /** @type {string[]} */
      const urls = []
      for (let i = 0; i < reqs.length && urls.length < limit; i++) {
        urls.push(reqs[i].url)
      }
      return { cache: cacheName, urls: urls, truncated: reqs.length > limit }
    })
  }

  /** @param {unknown} payload */
  function handleSiteCacheDelete(payload) {
    withContentRpc('VC_SITE_CACHE_DELETE_RESULT', payload, async function (ctx) {
      const cacheName = typeof ctx.data.cache === 'string' ? ctx.data.cache : ''
      const url = typeof ctx.data.url === 'string' ? ctx.data.url : ''
      if (!cacheName) {
        throw Object.assign(new Error('cache required'), { code: 'BAD_CACHE' })
      }
      if (url) {
        const cache = await ctx.win.caches.open(cacheName)
        const deleted = await cache.delete(url)
        return { cache: cacheName, url: url, deleted: deleted }
      }
      const deleted = await ctx.win.caches.delete(cacheName)
      return { cache: cacheName, deleted: deleted }
    })
  }

  /**
   * @param {{ id?: string, ts?: number, method?: string, url?: string, status?: number, type?: string, size?: number, duration?: number, failed?: boolean, bypass?: boolean, pending?: boolean, hasBody?: boolean, hotStored?: boolean, fromCache?: boolean, devtoolsId?: string, requestHeaders?: Record<string, string>, requestHeadersTruncated?: boolean, referrer?: string, referrerPolicy?: string, timing?: object, source?: string, sourceHost?: string, errorCode?: string, errorText?: string, initiatorKind?: string, initiatorChain?: string[], initiatorStack?: string[], initiatorScriptUrl?: string }} raw
   */
  function appendNetworkEntry(raw) {
    const id = typeof raw.id === 'string' ? raw.id : String(Date.now())
    const entry = {
      id: id,
      ts: typeof raw.ts === 'number' ? raw.ts : Date.now(),
      method: typeof raw.method === 'string' ? raw.method : 'GET',
      url: typeof raw.url === 'string' ? raw.url : '',
      status: typeof raw.status === 'number' ? raw.status : 0,
      type: typeof raw.type === 'string' ? raw.type : '',
      size: typeof raw.size === 'number' ? raw.size : 0,
      duration: typeof raw.duration === 'number' ? raw.duration : 0,
      failed: !!raw.failed,
      bypass: !!raw.bypass,
      pending: !!raw.pending,
      hasBody: !!raw.hasBody,
      hotStored: !!raw.hotStored,
      fromCache: !!raw.fromCache,
      devtoolsId: typeof raw.devtoolsId === 'string' ? raw.devtoolsId : '',
      requestHeaders:
        raw.requestHeaders && typeof raw.requestHeaders === 'object' ? raw.requestHeaders : undefined,
      requestHeadersTruncated: !!raw.requestHeadersTruncated,
      referrer: typeof raw.referrer === 'string' ? raw.referrer : '',
      referrerPolicy: typeof raw.referrerPolicy === 'string' ? raw.referrerPolicy : '',
      timing: raw.timing && typeof raw.timing === 'object' ? raw.timing : undefined,
      source: typeof raw.source === 'string' ? raw.source : '',
      sourceHost: typeof raw.sourceHost === 'string' ? raw.sourceHost : '',
      errorCode: typeof raw.errorCode === 'string' ? raw.errorCode : '',
      errorText: typeof raw.errorText === 'string' ? raw.errorText : '',
      initiatorKind: typeof raw.initiatorKind === 'string' ? raw.initiatorKind : '',
      initiatorChain: Array.isArray(raw.initiatorChain)
        ? raw.initiatorChain.filter((u) => typeof u === 'string')
        : undefined,
      initiatorStack: Array.isArray(raw.initiatorStack)
        ? raw.initiatorStack.filter((u) => typeof u === 'string')
        : undefined,
      initiatorScriptUrl:
        typeof raw.initiatorScriptUrl === 'string' ? raw.initiatorScriptUrl : '',
    }
    const existing = networkBuffer.findIndex((item) => item.id === id)
    if (existing >= 0) {
      networkBuffer[existing] = entry
    } else {
      networkBuffer.push(entry)
      if (networkBuffer.length > MAX_NETWORK_ENTRIES) {
        const removed = networkBuffer.shift()
        if (removed && removed.id) {
          dropArchiveEntry(removed.id)
        }
      }
      networkPendingNotifyCount += 1
    }
    DebugPanel.network(entry)
    flushNetworkNotify(entry)
  }

  /**
   * @param {{ id: string, pending?: boolean }} entry
   */
  function flushNetworkNotify(entry) {
    const count = networkPendingNotifyCount
    networkPendingNotifyCount = 0
    postToParent('VC_NETWORK_UPDATED', {
      latestId: entry.id,
      count,
      entry,
    })
  }

  /**
   * @param {unknown} payload
   */
  function readNetworkHistory(payload) {
    const data = payload && typeof payload === 'object' ? payload : {}
    const id = typeof data.id === 'string' ? data.id : ''

    function replyError(message, code) {
      postToParent('VC_NETWORK_READ_RESULT', {
        id,
        ok: false,
        error: { message, code },
      })
    }

    if (!id) {
      emitError('VC_NETWORK_READ requires payload.id', 'NETWORK_BAD_REQUEST')
      return
    }

    let limit = DEFAULT_NETWORK_READ_LIMIT
    if (typeof data.limit === 'number' && data.limit > 0) {
      limit = Math.min(Math.floor(data.limit), MAX_NETWORK_READ_LIMIT)
    }

    const after = typeof data.after === 'string' ? data.after : ''
    let startIndex = 0
    if (after) {
      const idx = networkBuffer.findIndex((entry) => entry.id === after)
      // Cursor missing (buffer rotated): do not resend the whole buffer — empty delta.
      startIndex = idx >= 0 ? idx + 1 : networkBuffer.length
    }

    const entries = networkBuffer.slice(startIndex, startIndex + limit)
    const latestId =
      networkBuffer.length > 0 ? networkBuffer[networkBuffer.length - 1].id : after || null

    postToParent('VC_NETWORK_READ_RESULT', {
      id,
      ok: true,
      value: {
        entries,
        latestId,
      },
    })
  }

  function onContentError() {
    if (fatal) {
      return
    }
    // 跨域逃跑时部分浏览器会打 error；优先拉回代理，而不是直接报失败
    if (recoverEscapedContent()) {
      return
    }
    emitLoadFailed(
      currentContentUrl || '',
      'content iframe failed to load',
      'LOAD_NETWORK_ERROR',
    )
  }

  /**
   * @returns {boolean}
   */
  function isBlankContentFrame() {
    if (!contentFrame) {
      return false
    }
    try {
      const win = contentFrame.contentWindow
      if (!win) {
        return false
      }
      const href = win.location.href
      const path = win.location.pathname || ''
      return (
        href === 'about:blank' ||
        path === '/blank' ||
        path === '/blank.html' ||
        path.endsWith('/blank') ||
        path.endsWith('/blank.html')
      )
    } catch {
      const src = contentFrame.getAttribute('src') || contentFrame.src || ''
      return (
        src === 'about:blank' ||
        src.includes('/blank.html') ||
        /\/blank(?:\?|#|$)/.test(src)
      )
    }
  }

  /**
   * @returns {boolean}
   */
  function detectLoadFailure() {
    if (fatal || !contentFrame) {
      return false
    }

    if (isBlankContentFrame()) {
      return false
    }

    let doc = null
    try {
      doc = contentFrame.contentDocument
    } catch {
      // 跨域 = 已逃出代理；交给 recoverEscapedContent，不当作网络失败
      return false
    }

    if (!doc) {
      return Boolean(currentContentUrl)
    }

    const state = readContentState()
    const bodyText = (doc.body && doc.body.textContent) || ''
    const title = doc.title || ''
    const haystack = (title + '\n' + bodyText).toLowerCase()

    for (let i = 0; i < LOAD_ERROR_MARKERS.length; i++) {
      if (haystack.includes(LOAD_ERROR_MARKERS[i])) {
        return true
      }
    }

    if (currentContentUrl && !state.url) {
      return true
    }

    return false
  }

  /**
   * @param {string} url
   * @param {string} message
   * @param {string} code
   */
  function emitLoadFailed(url, message, code) {
    loading = false
    postToParent('VC_LOAD_FAILED', { url, message, code })
    postToParent('VC_LOADING', { loading: false, url: url || currentContentUrl || undefined })
  }

  function onContentLoad() {
    if (fatal) {
      emitLoading(false)
      return
    }

    if (isBlankContentFrame()) {
      // Start page: keep logical URL empty so parent omnibox stays blank.
      currentContentUrl = ''
      emitLoading(false)
      let title = '新标签页'
      try {
        const doc = contentFrame && contentFrame.contentDocument
        if (doc && doc.title) {
          title = doc.title
        }
      } catch {
        // ignore
      }
      postToParent('VC_NAVIGATED', {
        url: '',
        title: title,
        canGoBack: false,
        canGoForward: false,
      })
      return
    }

    if (recoverEscapedContent()) {
      return
    }

    if (detectLoadFailure()) {
      let message = 'page failed to load'
      try {
        const doc = contentFrame && contentFrame.contentDocument
        const bodyText = doc && doc.body ? doc.body.textContent.trim() : ''
        if (bodyText) {
          message = bodyText.slice(0, 500)
        }
      } catch {
        // ignore
      }
      emitLoadFailed(currentContentUrl || '', message, 'LOAD_NETWORK_ERROR')
      return
    }

    emitLoading(false)
    const state = readContentState()
    if (state.url) {
      currentContentUrl = state.url
      recordHistory('loaded', state.url, state.title)
      postToParent('VC_NAVIGATED', state)
    }
    ensureConsoleHook()
    postNetworkOptsToSw()
  }

  /**
   * If the content iframe navigated to a real external URL (proxy bypass),
   * rewrite it back through the /----- proxy path.
   * @returns {boolean}
   */
  /** @type {{ url: string, count: number, at: number }} */
  let recoverGuard = { url: '', count: 0, at: 0 }

  function recoverEscapedContent() {
    if (!contentFrame) {
      return false
    }

    const escapedUrl = readEscapedExternalUrl()
    if (!escapedUrl) {
      return false
    }

    const now = Date.now()
    if (recoverGuard.url === escapedUrl && now - recoverGuard.at < 4000) {
      recoverGuard.count += 1
      if (recoverGuard.count >= 2) {
        // chrome-error / failed nav → recover → fail again = infinite flicker
        emitLoadFailed(
          escapedUrl,
          '页面反复加载失败（上游拒绝或错误页循环）。若来自 POST 表单，请确认父级已用 VC_NAVIGATE { method:"POST", body } 导航。',
          'LOAD_RECOVER_LOOP',
        )
        emitLoading(false)
        return true
      }
    } else {
      recoverGuard = { url: escapedUrl, count: 1, at: now }
    }

    currentContentUrl = escapedUrl
    recordHistory('recover', escapedUrl)
    clearConsoleBufferForNavigation()
    emitNavigating(escapedUrl)
    emitLoading(true)
    contentFrame.src = toProxyUrl(escapedUrl)
    return true
  }

  /**
   * Live location may differ from the src attribute (attribute often stays on the
   * original proxy URL after a client-side escape).
   * @returns {string|null}
   */
  function readEscapedExternalUrl() {
    if (!contentFrame) {
      return null
    }

    // Cross-origin ⇒ definitely escaped; cannot read href — re-proxy last intent.
    try {
      void contentFrame.contentDocument
    } catch {
      return currentContentUrl || null
    }

    try {
      const win = contentFrame.contentWindow
      if (win) {
        const href = win.location.href
        if (href && href !== 'about:blank') {
          const live = new URL(href)
          if (live.origin !== window.location.origin) {
            return live.href
          }
        }
      }
    } catch {
      return currentContentUrl || null
    }

    const rawSrc = contentFrame.getAttribute('src') || contentFrame.src || ''
    if (!rawSrc || rawSrc.includes(PROXY_PREFIX)) {
      return null
    }

    let url
    try {
      url = new URL(rawSrc, window.location.origin)
    } catch {
      return null
    }

    if (url.origin === window.location.origin) {
      return null
    }

    return url.href
  }

  /**
   * @returns {{ url: string, title: string, canGoBack: boolean, canGoForward: boolean }}
   */
  function readContentState() {
    const fallback = {
      url: '',
      title: '',
      canGoBack: false,
      canGoForward: false,
    }

    if (!contentFrame) {
      return fallback
    }

    try {
      const win = contentFrame.contentWindow
      const doc = contentFrame.contentDocument
      if (!win || !doc) {
        return fallback
      }

      const url = fromProxyPath(win.location.pathname + win.location.search + win.location.hash)
      return {
        url,
        title: doc.title || '',
        canGoBack: win.history.length > 1,
        canGoForward: false,
      }
    } catch {
      return fallback
    }
  }

  /**
   * @param {string} input
   */
  function normalizeUrl(input) {
    const trimmed = input.trim()
    if (!trimmed) {
      return null
    }
    if (/^https?:\/\//i.test(trimmed)) {
      return trimmed
    }
    return 'https://' + trimmed.replace(/^\/+/, '')
  }

  /**
   * @param {string} url
   */
  function toProxyPath(url) {
    // Encode ?/# so they stay in pathname (browser otherwise steals them as proxy search/hash).
    const normalized = url
      .replace(/^https?:\/\//i, 'https://')
      .replace(/\?/g, '%3F')
      .replace(/#/g, '%23')
    return PROXY_PREFIX + normalized
  }

  /**
   * Absolute proxy URL for #content.
   * @param {string} url
   */
  function toProxyUrl(url) {
    return new URL(toProxyPath(url), location.href).href
  }

  /**
   * Decode proxy pathname to real URL. Accepts /-----... and legacy /s/<id>/-----...
   * @param {string} path
   */
  function fromProxyPath(path) {
    if (
      !path ||
      path === '/' ||
      path === '/viewer.html' ||
      path === '/viewer' ||
      path === '/blank' ||
      path === '/blank.html' ||
      path.startsWith('/blank?') ||
      path.startsWith('/blank.html?')
    ) {
      return ''
    }
    // Legacy bookmarks: /s/<sessionId>/-----https://...
    const sessionMatch = path.match(/^\/s\/[^/]+(\/+.*)$/)
    const rest = sessionMatch ? sessionMatch[1] : path
    const stripped = rest.replace(/^\/-+/, '')
    if (!stripped) {
      return ''
    }
    let target = stripped
    if (!/^https?:\/\//i.test(target)) {
      target = 'https://' + target
    }
    return target.replace(/%3F/gi, '?').replace(/%23/gi, '#')
  }

  /**
   * @param {string} origin
   */
  function isOriginAllowed(origin) {
    if (!allowedOrigins || allowedOrigins.length === 0) {
      return true
    }
    return allowedOrigins.includes(origin)
  }

  /**
   * @param {string} cmd
   * @param {unknown} [payload]
   */
  function postToParent(cmd, payload) {
    const msg = payload === undefined ? [cmd] : [cmd, payload]
    vmsg('out', cmd, payload)
    window.parent.postMessage(msg, '*')
  }

  function emitReady() {
    postToParent('VC_READY', { version: VERSION, build: BUILD })
    vlog('info', ['virtual-chromo bridge v' + VERSION + ' (build ' + BUILD + ')'])
  }

  /**
   * @param {string} url
   */
  function emitNavigating(url) {
    postToParent('VC_NAVIGATING', { url })
  }

  /**
   * @param {boolean} nextLoading
   */
  function emitLoading(nextLoading) {
    loading = nextLoading
    if (nextLoading) {
      scheduleLoadingWatchdog()
    } else {
      clearLoadingWatchdog()
    }
    postToParent('VC_LOADING', {
      loading: nextLoading,
      url: currentContentUrl || undefined,
    })
  }

  /**
   * @param {string} message
   * @param {string} [code]
   */
  function emitError(message, code) {
    postToParent('VC_ERROR', { message, code })
  }

  window.VirtualChromoBridge = {
    init,
    swDidReady,
    emitError,
    enterFatalState,
  }
})()

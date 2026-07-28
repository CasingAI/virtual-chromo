/**
 * virtual-chromo postMessage bridge
 * Connects the outer parent shell with the inner proxied browsing context.
 * Includes a built-in debug panel (VConsole-like, no third-party deps).
 */
;(function () {
  'use strict'

  const VERSION = '1.3.0'
  const BUILD = '20260728-v7'
  const PROXY_PREFIX = '/-----'
  const MSG_BRIDGE_DESTROY = 302
  const MSG_SESSION_LIST = 303
  const MSG_SW_SESSION_LIST = 304
  const MSG_SW_NETWORK_PUSH = 305
  const MSG_PAGE_NETWORK_OPTS = 306
  const MSG_PAGE_NETWORK_BODY_READ = 307
  const MSG_SW_NETWORK_BODY_REPLY = 308
  const MSG_PAGE_NETWORK_ARCHIVE_DROP = 309
  const MSG_PAGE_BUILD_GET = 310
  const MSG_SW_BUILD_REPLY = 311
  const MSG_PAGE_NETWORK_HOT_PROBE = 312
  const MSG_SW_NETWORK_HOT_PROBE_REPLY = 313
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

    /** @type {{ level: string, args: string[], at: number }[]} */
    const logs = []

    /** @type {{ direction: string, cmd: string, payload: string, at: number, meta?: string }[]} */
    const messages = []

    /** @type {{ id: string, method: string, url: string, status: number, type: string, size: number, duration: number, failed: boolean, bypass: boolean, ts: number }[]} */
    const networkEntries = []

    /** @type {(() => Record<string, unknown>) | null} */
    let stateProvider = null

    /** @type {boolean} */
    let panelOpen = false

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
      const count = logs.filter((l) => l.level === 'error' || l.level === 'warn').length
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
        '<button type="button" class="vcd-tab" data-tab="state">状态</button>' +
        '</div>' +
        '<div class="vcd-body">' +
        '<div class="vcd-pane" data-pane="log"></div>' +
        '<div class="vcd-pane" data-pane="msg" hidden></div>' +
        '<div class="vcd-pane" data-pane="network" hidden></div>' +
        '<div class="vcd-pane" data-pane="state" hidden></div>' +
        '</div></div>'

      const style = document.createElement('style')
      style.textContent =
        '.vcd-root{position:fixed;right:10px;bottom:10px;z-index:2147483646;font:11px/1.4 ui-sans-serif,system-ui,sans-serif;color:#e8e8e8;pointer-events:none}' +
        '.vcd-root *{box-sizing:border-box}' +
        '.vcd-switch{pointer-events:auto;width:36px;height:36px;padding:0;border:0;border-radius:18px;background:#2f9e44;color:#fff;font-size:12px;font-weight:700;box-shadow:0 2px 10px rgba(0,0,0,.35);cursor:pointer;position:relative}' +
        '.vcd-switch:active{transform:scale(.96)}' +
        '.vcd-badge{position:absolute;top:-3px;right:-3px;min-width:14px;height:14px;padding:0 3px;border-radius:7px;background:#e03131;color:#fff;font-size:9px;line-height:14px;text-align:center}' +
        /* hidden must win over display:flex — this was why close did nothing */
        '.vcd-panel{pointer-events:auto;position:absolute;right:0;bottom:44px;width:min(88vw,320px);height:min(52vh,380px);display:none;flex-direction:column;border-radius:8px;overflow:hidden;background:#1a1b1e;border:1px solid #343a40;box-shadow:0 6px 22px rgba(0,0,0,.4)}' +
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
        '.vcd-tab{flex:1;border:0;background:transparent;color:#868e96;padding:7px 4px;cursor:pointer;font:inherit}' +
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
        '.vcd-net__url{color:#adb5bd;word-break:break-all;margin-top:2px}'

      document.head.appendChild(style)
      document.body.appendChild(root)

      panel = root.querySelector('.vcd-panel')
      logList = root.querySelector('[data-pane="log"]')
      msgList = root.querySelector('[data-pane="msg"]')
      networkList = root.querySelector('[data-pane="network"]')
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
        } else if (activeTab === 'state') {
          // state is live snapshot; clearing history is more useful
          renderState()
        }
        updateBadge()
      })

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
      addLog('info', ['debug panel ready', versionLabel || ''])
    }

    /**
     * @param {() => Record<string, unknown>} fn
     */
    function setStateProvider(fn) {
      stateProvider = fn
    }

    return {
      init,
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
      setStateProvider,
    }
  })()

  // ---------------------------------------------------------------------------
  // Bridge
  // ---------------------------------------------------------------------------

  /** @type {string} */
  let sessionId = parseSessionIdFromLocation()

  /**
   * @returns {string}
   */
  function parseSessionIdFromLocation() {
    const m = location.pathname.match(/^\/s\/([^/]+)/)
    return m ? m[1] : 'default'
  }

  /**
   * @param {string} id
   */
  function destroySessionViaSw(id) {
    const sid = id || sessionId
    navigator.serviceWorker.ready.then(function () {
      const ctl = navigator.serviceWorker.controller
      if (ctl) {
        ctl.postMessage([MSG_BRIDGE_DESTROY, { sessionId: sid }])
      }
    })
  }

  /**
   * @param {unknown} payload
   */
  function createSession(payload) {
    const req = payload && typeof payload === 'object' ? payload : {}
    let id = typeof req.sessionId === 'string' && req.sessionId.trim()
      ? req.sessionId.trim()
      : null
    if (!id) {
      id = typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : 's' + Date.now().toString(36)
    }
    if (!/^[\w-]{1,128}$/.test(id)) {
      emitError('invalid sessionId', 'SESSION_BAD_ID')
      return
    }
    postToParent('VC_SESSION_CREATED', { sessionId: id })
    if (id !== sessionId) {
      location.href = '/s/' + encodeURIComponent(id) + '/'
    }
  }

  /**
   * @param {unknown} payload
   */
  function destroySession(payload) {
    const req = payload && typeof payload === 'object' ? payload : {}
    const id = typeof req.sessionId === 'string' && req.sessionId
      ? req.sessionId
      : sessionId
    destroySessionViaSw(id)
    networkBuffer.length = 0
    networkPendingNotifyCount = 0
    postToParent('VC_SESSION_DESTROYED', { sessionId: id })
  }

  function listSessions() {
    navigator.serviceWorker.ready.then(function () {
      const ctl = navigator.serviceWorker.controller
      if (!ctl) {
        postToParent('VC_SESSION_LIST_RESULT', { sessions: [{ sessionId, clientCount: 1 }] })
        return
      }
      function onList(event) {
        if (!Array.isArray(event.data) || event.data[0] !== MSG_SW_SESSION_LIST) {
          return
        }
        navigator.serviceWorker.removeEventListener('message', onList)
        postToParent('VC_SESSION_LIST_RESULT', { sessions: event.data[1] })
      }
      navigator.serviceWorker.addEventListener('message', onList)
      ctl.postMessage([MSG_SESSION_LIST])
    })
  }

  /** @type {string[]|null} */
  let allowedOrigins = null

  /** @type {HTMLIFrameElement|null} */
  let contentFrame = null

  /** @type {boolean} */
  let swReady = false

  /** @type {boolean} */
  let fatal = false

  /** @type {string|null} */
  let pendingNavigateUrl = null

  /** Last known real URL for the content iframe (used when cross-origin blocks location access). */
  /** @type {string} */
  let currentContentUrl = ''

  /** @type {boolean} */
  let loading = false

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
      sessionId,
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

    window.__vcOnInjectConsole = ingestInjectConsoleEntry
    window.__vcOnInjectClick = ingestInjectClick
    window.__vcOnInjectLocation = ingestInjectLocation
    window.__vcOnInjectHistory = ingestInjectHistory

    window.addEventListener('message', onParentMessage)
    window.addEventListener('message', onInjectMessage)
    navigator.serviceWorker.addEventListener('message', onServiceWorkerMessage)
    contentFrame.addEventListener('load', onContentLoad)
    contentFrame.addEventListener('error', onContentError)

    DebugPanel.setStateProvider(getDebugState)
    DebugPanel.init({ version: VERSION, build: BUILD })
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
      const queued = pendingNavigateUrl
      pendingNavigateUrl = null
      if (queued) {
        vlog('info', ['flushing queued navigate:', queued])
        applyNavigate(queued)
      }
    })
  }

  function swDidReady() {
    swReady = true
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
   * @param {{ code?: string, message?: string, bridgeBuild?: string, swBuild?: string }} info
   */
  function enterFatalState(info) {
    if (fatal) {
      return
    }
    fatal = true
    const bridgeBuild = info.bridgeBuild || BUILD
    const swBuild = info.swBuild || ''
    const message =
      info.message ||
      ('版本不匹配：bridge ' + bridgeBuild + ' vs SW ' + (swBuild || '(unknown)'))
    const code = info.code || 'VERSION_MISMATCH'
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

  const MSG_SW_SESSION_DESTROY = 300

  /**
   * @param {MessageEvent} event
   */
  function onServiceWorkerMessage(event) {
    if (!Array.isArray(event.data)) {
      return
    }
    const [cmd, payload] = event.data
    if (cmd === MSG_SW_SESSION_DESTROY && payload && payload.sessionId) {
      postToParent('VC_SESSION_GONE', { sessionId: payload.sessionId })
    }
    if (cmd === MSG_SW_NETWORK_PUSH && payload && typeof payload === 'object') {
      appendNetworkEntry(payload)
    }
    if (cmd === MSG_SW_NETWORK_BODY_REPLY && payload && typeof payload === 'object') {
      handleNetworkBodyReply(payload)
    }
    if (cmd === MSG_SW_NETWORK_HOT_PROBE_REPLY && payload && typeof payload === 'object') {
      handleNetworkHotProbeReply(payload)
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
          cmd === 'VC_NETWORK_BODY_READ' || cmd === 'VC_NETWORK_HOT_PROBE' || cmd === 'VC_SCREENSHOT') {
        const data = payload && typeof payload === 'object' ? payload : {}
        const id = typeof data.id === 'string' ? data.id : ''
        const resultCmd =
          cmd === 'VC_EVAL' ? 'VC_EVAL_RESULT'
            : cmd === 'VC_CONSOLE_READ' ? 'VC_CONSOLE_READ_RESULT'
              : cmd === 'VC_NETWORK_READ' ? 'VC_NETWORK_READ_RESULT'
                : cmd === 'VC_NETWORK_BODY_READ' ? 'VC_NETWORK_BODY_READ_RESULT'
                  : cmd === 'VC_NETWORK_HOT_PROBE' ? 'VC_NETWORK_HOT_PROBE_RESULT'
                    : 'VC_SCREENSHOT_RESULT'
        if (id) {
          postToParent(resultCmd, {
            id: id,
            ok: false,
            error: { message: 'viewer stopped: version mismatch', code: 'VERSION_MISMATCH' },
          })
        }
      }
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
        reloadContent()
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
      case 'VC_NETWORK_BODY_READ':
        readNetworkBody(payload)
        break
      case 'VC_NETWORK_HOT_PROBE':
        probeNetworkHot(payload)
        break
      case 'VC_SESSION_CREATE':
        createSession(payload)
        break
      case 'VC_SESSION_DESTROY':
        destroySession(payload)
        break
      case 'VC_SESSION_LIST':
        listSessions()
        break
      default:
        break
    }
  }

  /**
   * @param {string} url
   */
  function applyNavigate(url) {
    if (!contentFrame) {
      return
    }
    currentContentUrl = url
    recordHistory('navigate', url)
    emitNavigating(url)
    emitLoading(true)
    contentFrame.src = toProxyUrl(url)
  }

  /**
   * @param {unknown} payload
   */
  function navigate(payload) {
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

    if (!swReady) {
      pendingNavigateUrl = url
      vlog('info', ['navigate queued (SW not ready):', url])
      emitNavigating(url)
      emitLoading(true)
      return
    }

    pendingNavigateUrl = null
    applyNavigate(url)
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

  function reloadContent() {
    if (!contentFrame) {
      return
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
      const raw = win.eval(code)
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
    const data = /** @type {{ ts?: number, tagName?: string, href?: string, target?: string, text?: string, id?: string, className?: string }} */ (
      payload
    )
    vlog('info', [
      'content click:',
      data.tagName || '?',
      data.href || data.text || '',
    ])
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
   * @param {unknown} payload
   */
  function ingestInjectLocation(payload) {
    if (!payload || typeof payload !== 'object') {
      return
    }
    const data = /** @type {{ ts?: number, method?: string, url?: string, target?: string }} */ (
      payload
    )
    postToParent('VC_LOCATION', {
      ts: typeof data.ts === 'number' ? data.ts : Date.now(),
      method: typeof data.method === 'string' ? data.method : 'unknown',
      url: typeof data.url === 'string' ? data.url : '',
      target: typeof data.target === 'string' ? data.target : undefined,
    })
  }

  /**
   * @param {unknown} payload
   */
  function ingestInjectHistory(payload) {
    if (!payload || typeof payload !== 'object') {
      return
    }
    const data = /** @type {{ ts?: number, method?: string, url?: string, title?: string, state?: unknown }} */ (
      payload
    )
    const url = typeof data.url === 'string' ? data.url : ''
    const method = typeof data.method === 'string' ? data.method : 'unknown'
    const title = typeof data.title === 'string' ? data.title : ''

    if (url) {
      currentContentUrl = url
      recordHistory('spa:' + method, url, title)
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
      startIndex = idx >= 0 ? idx + 1 : 0
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
    // Align with instant-app: hot-cache key uses sessionId as devtoolsId.
    // Avoid random UUID before VC_NETWORK_OPTIONS arrives (race → never hit).
    if (sessionId && sessionId !== 'default') {
      networkDevtoolsId = sessionId
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
          sessionId: sessionId,
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
          sessionId: sessionId,
        },
      ])
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
          value: { exists: !!value.exists },
        })
      })

      ctl.postMessage([
        MSG_PAGE_NETWORK_HOT_PROBE,
        {
          id: id,
          method: method,
          url: url,
          sessionId: sessionId,
        },
      ])
    })
  }

  /**
   * @param {{ id?: string, ts?: number, method?: string, url?: string, status?: number, type?: string, size?: number, duration?: number, failed?: boolean, bypass?: boolean, pending?: boolean, hasBody?: boolean, hotStored?: boolean, fromCache?: boolean, devtoolsId?: string, requestHeaders?: Record<string, string>, requestHeadersTruncated?: boolean, referrer?: string, referrerPolicy?: string, timing?: object, source?: string, sourceHost?: string, errorCode?: string, errorText?: string }} raw
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
      startIndex = idx >= 0 ? idx + 1 : 0
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
      return href === 'about:blank' || href.endsWith('/blank')
    } catch {
      const src = contentFrame.getAttribute('src') || contentFrame.src || ''
      return src === 'about:blank'
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
  function recoverEscapedContent() {
    if (!contentFrame) {
      return false
    }

    const escapedUrl = readEscapedExternalUrl()
    if (!escapedUrl) {
      return false
    }

    currentContentUrl = escapedUrl
    recordHistory('recover', escapedUrl)
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
    if (sessionId === 'default') {
      return PROXY_PREFIX + normalized
    }
    return '/s/' + encodeURIComponent(sessionId) + PROXY_PREFIX + normalized
  }

  /**
   * Absolute proxy URL for #content (avoids relative-path resolution bugs under /s/<id>/).
   * @param {string} url
   */
  function toProxyUrl(url) {
    return new URL(toProxyPath(url), location.href).href
  }

  /**
   * @param {string} path
   */
  function fromProxyPath(path) {
    if (!path || path === '/' || path === '/viewer.html' || path === '/viewer') {
      return ''
    }
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
    postToParent('VC_READY', { version: VERSION, build: BUILD, sessionId })
    vlog('info', ['virtual-chromo bridge v' + VERSION + ' (build ' + BUILD + ', session ' + sessionId + ')'])
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

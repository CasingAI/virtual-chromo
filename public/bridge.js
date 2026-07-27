/**
 * virtual-chromo postMessage bridge
 * Connects the outer parent shell with the inner proxied browsing context.
 * Includes a built-in debug panel (VConsole-like, no third-party deps).
 */
;(function () {
  'use strict'

  const VERSION = '1.3.0'
  const BUILD = '20260727-v29'
  const PROXY_PREFIX = '/-----'
  const MSG_BRIDGE_DESTROY = 302
  const MSG_SESSION_LIST = 303
  const MSG_SW_SESSION_LIST = 304
  const MAX_CONSOLE_ENTRIES = 500
  const DEFAULT_CONSOLE_READ_LIMIT = 100
  const MAX_CONSOLE_READ_LIMIT = 500
  const MAX_SCREENSHOT_CANVAS = 8192
  const DEFAULT_SCREENSHOT_QUALITY = 0.72
  const LOAD_ERROR_MARKERS = ['virtual-chromo error', 'virtual-chromo error:']

  // ---------------------------------------------------------------------------
  // DebugPanel (internal, CSS prefix: vcd-)
  // ---------------------------------------------------------------------------
  const DebugPanel = (function () {
    const MAX_LOGS = 500
    const MAX_MESSAGES = 300

    /** @type {{ level: string, args: string[], at: number }[]} */
    const logs = []

    /** @type {{ direction: string, cmd: string, payload: string, at: number, meta?: string }[]} */
    const messages = []

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

    function installBeforeUnload() {
      window.addEventListener('beforeunload', function (event) {
        // Allow programmatic reloads (e.g. Service Worker update).
        try {
          if (sessionStorage.getItem('_vc_allow_unload') === '1') {
            sessionStorage.removeItem('_vc_allow_unload')
            return
          }
        } catch (err) {
          // ignore
        }
        event.preventDefault()
        event.returnValue = ''
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
        '<button type="button" class="vcd-tab" data-tab="state">状态</button>' +
        '</div>' +
        '<div class="vcd-body">' +
        '<div class="vcd-pane" data-pane="log"></div>' +
        '<div class="vcd-pane" data-pane="msg" hidden></div>' +
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
        '.vcd-history__title{color:#ced4da;margin-top:1px}'

      document.head.appendChild(style)
      document.body.appendChild(root)

      panel = root.querySelector('.vcd-panel')
      logList = root.querySelector('[data-pane="log"]')
      msgList = root.querySelector('[data-pane="msg"]')
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
     * @param {{ beforeUnload?: boolean, version?: string, build?: string }} [options]
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
      if (options.beforeUnload !== false) {
        installBeforeUnload()
      }
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
      loading,
      contentUrl: state.url || currentContentUrl || '',
      contentTitle: state.title || '',
      proxyPath: contentFrame?.src || '',
      canGoBack: state.canGoBack,
      canGoForward: state.canGoForward,
      allowedOrigins:
        allowedOrigins && allowedOrigins.length ? allowedOrigins.join(', ') : '(all)',
      parentOrigin: window.parent === window ? '(top)' : '(embedded)',
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
    DebugPanel.init({ beforeUnload: true, version: VERSION, build: BUILD })

    if (swReady) {
      emitReady()
    }
  }

  function swDidReady() {
    swReady = true
    vlog('info', ['service worker ready'])
    emitReady()
    const queued = pendingNavigateUrl
    pendingNavigateUrl = null
    if (queued) {
      vlog('info', ['flushing queued navigate:', queued])
      applyNavigate(queued)
    }
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
      const ms = self.modernScreenshot
      const el = doc.documentElement
      const body = doc.body
      const scrollX = win.scrollX || 0
      const scrollY = win.scrollY || 0
      const viewportW = contentFrame.clientWidth || win.innerWidth || el.clientWidth
      const viewportH = contentFrame.clientHeight || win.innerHeight || el.clientHeight

      const scrollW = Math.max(el.scrollWidth, body ? body.scrollWidth : 0, viewportW)
      const scrollH = Math.max(el.scrollHeight, body ? body.scrollHeight : 0, viewportH)

      let width = fullPage ? scrollW : viewportW
      let height = fullPage ? scrollH : viewportH
      width = Math.min(Math.max(1, Math.floor(width)), MAX_SCREENSHOT_CANVAS)
      height = Math.min(Math.max(1, Math.floor(height)), MAX_SCREENSHOT_CANVAS)

      const mime = format === 'png' ? 'image/png' : 'image/jpeg'
      const rasterOpts = {
        width,
        height,
        scale,
        quality,
        type: mime,
        maximumCanvasSize: MAX_SCREENSHOT_CANVAS,
        backgroundColor: '#ffffff',
      }

      /** @type {HTMLCanvasElement} */
      let canvas
      if (fullPage) {
        canvas = await ms.domToCanvas(el, rasterOpts)
      } else {
        const fullW = Math.min(Math.max(1, Math.floor(scrollW)), MAX_SCREENSHOT_CANVAS)
        const fullH = Math.min(Math.max(1, Math.floor(scrollH)), MAX_SCREENSHOT_CANVAS)
        const fullCanvas = await ms.domToCanvas(el, {
          width: fullW,
          height: fullH,
          scale,
          quality,
          type: mime,
          maximumCanvasSize: MAX_SCREENSHOT_CANVAS,
          backgroundColor: '#ffffff',
        })
        canvas = document.createElement('canvas')
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

  function onContentError() {
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
  function detectLoadFailure() {
    if (!contentFrame) {
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
  }
})()

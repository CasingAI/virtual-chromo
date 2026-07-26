/**
 * virtual-chromo postMessage bridge
 * Connects the outer parent shell with the inner proxied browsing context.
 */
;(function () {
  'use strict'

  const VERSION = '1.1.0'
  const PROXY_PREFIX = '/-----'

  /** @type {string[]|null} */
  let allowedOrigins = null

  /** @type {HTMLIFrameElement|null} */
  let contentFrame = null

  /** @type {boolean} */
  let swReady = false

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

    window.addEventListener('message', onParentMessage)
    contentFrame.addEventListener('load', onContentLoad)

    if (swReady) {
      emitReady()
    }
  }

  function swDidReady() {
    swReady = true
    emitReady()
  }

  /**
   * @param {MessageEvent} event
   */
  function onParentMessage(event) {
    if (event.source !== window.parent) {
      return
    }
    if (!isOriginAllowed(event.origin)) {
      return
    }
    if (!Array.isArray(event.data) || typeof event.data[0] !== 'string') {
      return
    }

    const [cmd, payload] = event.data

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
      default:
        break
    }
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

    emitNavigating(url)
    emitLoading(true)
    contentFrame.src = toProxyPath(url)
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
    try {
      emitLoading(true)
      contentFrame.contentWindow?.location.reload()
    } catch (err) {
      emitError(
        err instanceof Error ? err.message : 'reload failed',
        'RELOAD_ERROR'
      )
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

    if (!readContentState().url) {
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

  function onContentLoad() {
    emitLoading(false)
    const state = readContentState()
    if (state.url) {
      postToParent('VC_NAVIGATED', state)
    }
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
    return PROXY_PREFIX + url.replace(/^https?:\/\//i, 'https://')
  }

  /**
   * @param {string} path
   */
  function fromProxyPath(path) {
    if (!path || path === '/' || path === '/viewer.html') {
      return ''
    }
    const stripped = path.replace(/^\/-+/, '')
    if (!stripped) {
      return ''
    }
    if (/^https?:\/\//i.test(stripped)) {
      return stripped
    }
    return 'https://' + stripped
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
    window.parent.postMessage(msg, '*')
  }

  function emitReady() {
    postToParent('VC_READY', { version: VERSION })
  }

  /**
   * @param {string} url
   */
  function emitNavigating(url) {
    postToParent('VC_NAVIGATING', { url })
  }

  /**
   * @param {boolean} loading
   */
  function emitLoading(loading) {
    postToParent('VC_LOADING', { loading })
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

/**
 * virtual-chromo postMessage bridge
 * Connects the outer parent shell with the inner proxied browsing context.
 */
;(function () {
  'use strict'

  const VERSION = '1.0.0'
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

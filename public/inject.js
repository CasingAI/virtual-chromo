/**
 * virtual-chromo injected script — runs in proxied page context (via conf inject_html).
 * Hooks console, noop native dialogs, forwards entries to viewer bridge via postMessage.
 * Keep VC_VERSION / VC_BUILD in sync with public/conf.js and public/sw.js.
 */
;(function () {
  'use strict'

  var VC_VERSION = '1.3.0'
  var VC_BUILD = '20260728-v11'

  if (window.__vcInjected) {
    return
  }
  window.__vcInjected = true
  window.__vcInjectVersion = VC_VERSION
  window.__vcInjectBuild = VC_BUILD

  var CHANNEL = '_VC_INJECT'
  var DIALOG_TAG = '[virtual-chromo] native dialog skipped:'

  /**
   * @param {unknown} value
   */
  function stringifyArg(value) {
    if (value === undefined) {
      return 'undefined'
    }
    if (typeof value === 'string') {
      return value
    }
    if (value instanceof Error) {
      return value.stack || value.message
    }
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }

  /**
   * @param {unknown[]} args
   */
  function formatArgs(args) {
    return Array.prototype.map.call(args, stringifyArg)
  }

  function makeEntryId() {
    try {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID()
      }
    } catch {
      // ignore
    }
    return String(Date.now()) + '-' + Math.random().toString(16).slice(2)
  }

  /**
   * @param {string} level
   * @param {unknown[]} args
   */
  function forwardConsole(level, args) {
    var entry = {
      id: makeEntryId(),
      level: level,
      args: formatArgs(args),
      ts: Date.now(),
      url: location.href,
    }

    try {
      var bridge = window.parent
      if (bridge && typeof bridge.__vcOnInjectConsole === 'function') {
        bridge.__vcOnInjectConsole(entry)
        return
      }
    } catch {
      // ignore cross-origin direct calls
    }

    try {
      window.parent.postMessage([CHANNEL, 'CONSOLE', entry], '*')
    } catch {
      // ignore cross-origin postMessage failures
    }
  }

  var levels = ['log', 'info', 'warn', 'error', 'debug']
  for (var i = 0; i < levels.length; i++) {
    ;(function (level) {
      var original = console[level]
      if (typeof original !== 'function') {
        return
      }
      console[level] = function () {
        forwardConsole(level, Array.prototype.slice.call(arguments))
        return original.apply(console, arguments)
      }
    })(levels[i])
  }

  window.addEventListener('error', function (event) {
    forwardConsole('error', [
      event.message,
      (event.filename || '') + ':' + (event.lineno || 0) + ':' + (event.colno || 0),
    ])
  })

  window.addEventListener('unhandledrejection', function (event) {
    forwardConsole('error', ['Unhandled rejection', event.reason])
  })

  window.alert = function (message) {
    forwardConsole('warn', [DIALOG_TAG, 'alert', String(message)])
  }

  window.confirm = function (message) {
    forwardConsole('warn', [DIALOG_TAG, 'confirm', String(message)])
    return false
  }

  window.prompt = function (message, defaultValue) {
    forwardConsole('warn', [
      DIALOG_TAG,
      'prompt',
      String(message),
      defaultValue === undefined ? '' : String(defaultValue),
    ])
    return null
  }

  function forwardInject(kind, payload) {
    var handlerName =
      kind === 'CLICK'
        ? '__vcOnInjectClick'
        : kind === 'LOCATION'
          ? '__vcOnInjectLocation'
          : kind === 'HISTORY'
            ? '__vcOnInjectHistory'
            : null
    if (handlerName) {
      var w = window
      while (w) {
        try {
          if (typeof w[handlerName] === 'function') {
            w[handlerName](payload)
            return
          }
          if (w === w.top) {
            break
          }
          w = w.parent
        } catch {
          break
        }
      }
    }
    try {
      window.parent.postMessage([CHANNEL, kind, payload], '*')
    } catch {
      // ignore
    }
  }

  window.__vcReportClick = function (payload) {
    forwardInject('CLICK', payload)
  }

  window.__vcReportLocation = function (payload) {
    forwardInject('LOCATION', payload)
  }

  window.__vcReportHistory = function (payload) {
    forwardInject('HISTORY', payload)
  }

  function buildClickPayload(el) {
    var tag = el.tagName || ''
    var payload = {
      ts: Date.now(),
      tagName: tag,
      id: el.id || '',
      className: typeof el.className === 'string' ? el.className : '',
      text: String(el.innerText || el.textContent || '')
        .trim()
        .slice(0, 200),
    }
    if (tag === 'A' || tag === 'AREA') {
      payload.href = el.href || ''
      payload.target = el.target || ''
    }
    return payload
  }

  function isNavigationalLink(el) {
    if (!el || !el.href) {
      return false
    }
    var href = String(el.href)
    if (!href || href === '#' || href.indexOf('javascript:') === 0) {
      return false
    }
    return true
  }

  document.addEventListener(
    'click',
    function (event) {
      if (document.__vcPassiveNavInstalled) {
        return
      }
      if (!event.isTrusted) {
        return
      }
      var raw = event.target
      if (!raw || raw.nodeType !== 1) {
        return
      }
      var el = raw
      var link = el.closest ? el.closest('a[href],area[href]') : null
      forwardInject('CLICK', buildClickPayload(link || el))
      if (link && isNavigationalLink(link)) {
        event.preventDefault()
      }
    },
    true,
  )

  function buildFormSubmitUrl(form) {
    var action = ''
    try {
      action = form.action || location.href
    } catch (err) {
      action = location.href
    }
    var method = String(form.method || 'get').toLowerCase()
    if (method !== 'get') {
      return action
    }
    try {
      var url = new URL(action, location.href)
      var params = new URLSearchParams()
      var fd = new FormData(form)
      fd.forEach(function (value, key) {
        if (!key) {
          return
        }
        if (typeof value === 'string') {
          params.append(key, value)
        }
      })
      var qs = params.toString()
      url.search = qs ? '?' + qs : ''
      return url.href
    } catch (err2) {
      return action
    }
  }

  document.addEventListener(
    'submit',
    function (event) {
      var form = event.target
      if (!form || form.tagName !== 'FORM') {
        return
      }
      event.preventDefault()
      var httpMethod = String(form.method || 'get').toLowerCase()
      if (httpMethod !== 'get' && httpMethod !== 'post') {
        httpMethod = 'get'
      }
      forwardInject('LOCATION', {
        ts: Date.now(),
        method: 'submit',
        httpMethod: httpMethod,
        url: buildFormSubmitUrl(form),
      })
    },
    true,
  )

  console.info(
    '[virtual-chromo] inject.js v' + VC_VERSION + ' (build ' + VC_BUILD + ')',
  )
})()

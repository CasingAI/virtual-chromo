/**
 * virtual-chromo injected script — runs in proxied page context (via conf inject_html).
 * Hooks console, noop native dialogs, forwards entries to viewer bridge via postMessage.
 * Keep VC_VERSION / VC_BUILD in sync with public/conf.js and public/sw.js.
 */
;(function () {
  'use strict'

  var VC_VERSION = '1.3.0'
  var VC_BUILD = '20260727-v3'

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

  /**
   * @param {string} level
   * @param {unknown[]} args
   */
  function forwardConsole(level, args) {
    try {
      window.parent.postMessage(
        [
          CHANNEL,
          'CONSOLE',
          {
            id: crypto.randomUUID(),
            level: level,
            args: formatArgs(args),
            ts: Date.now(),
            url: location.href,
          },
        ],
        '*',
      )
    } catch {
      // ignore cross-origin postMessage failures
    }
  }

  var levels = ['log', 'info', 'warn', 'error', 'debug']
  for (var i = 0; i < levels.length; i++) {
    var level = levels[i]
    var original = console[level]
    if (typeof original !== 'function') {
      continue
    }
    console[level] = function () {
      forwardConsole(level, Array.prototype.slice.call(arguments))
      return original.apply(console, arguments)
    }
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

  console.info(
    '[virtual-chromo] inject.js v' + VC_VERSION + ' (build ' + VC_BUILD + ')',
  )
})()

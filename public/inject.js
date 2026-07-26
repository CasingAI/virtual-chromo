/**
 * virtual-chromo injected script — runs in proxied page context (via conf inject_html).
 * Hooks console, noop native dialogs, forwards entries to viewer bridge via postMessage.
 */
;(function () {
  'use strict'

  if (window.__vcInjected) {
    return
  }
  window.__vcInjected = true

  const CHANNEL = '_VC_INJECT'
  const DIALOG_TAG = '[virtual-chromo] native dialog skipped:'

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

  const levels = ['log', 'info', 'warn', 'error', 'debug']
  for (let i = 0; i < levels.length; i++) {
    const level = levels[i]
    const original = console[level]
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
})()

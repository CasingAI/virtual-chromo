/**
 * virtual-chromo passive navigation — report page intents to bridge (no navigation).
 */
import {captureStack} from './vc-stack.js'

const CHANNEL = '_VC_INJECT'

const BRIDGE_HANDLERS = {
  CLICK: '__vcOnInjectClick',
  LOCATION: '__vcOnInjectLocation',
  HISTORY: '__vcOnInjectHistory',
}

/**
 * @param {string} kind
 */
function findBridgeWindow(kind) {
  const handlerName = BRIDGE_HANDLERS[kind]
  if (!handlerName || typeof window === 'undefined') {
    return null
  }
  /** @type {Window | null} */
  let w = window
  while (w) {
    try {
      if (typeof w[handlerName] === 'function') {
        return w
      }
      if (w === w.top) {
        break
      }
      w = w.parent
    } catch {
      break
    }
  }
  return null
}

/**
 * @param {Window | null} bridge
 * @returns {boolean}
 */
function isNavProbe(bridge) {
  try {
    if (bridge && bridge.__vcDebugOpts && bridge.__vcDebugOpts.navProbe === true) {
      return true
    }
  } catch {
    // ignore
  }
  try {
    let w = typeof window !== 'undefined' ? window : null
    while (w) {
      if (w.__vcDebugOpts && w.__vcDebugOpts.navProbe === true) {
        return true
      }
      if (w === w.top) {
        break
      }
      w = w.parent
    }
  } catch {
    // ignore
  }
  return false
}

/**
 * @param {string} kind
 * @param {Record<string, unknown>} payload
 */
function forward(kind, payload) {
  const handlerName = BRIDGE_HANDLERS[kind]
  const bridge = findBridgeWindow(kind)
  /** @type {Record<string, unknown>} */
  let out = payload
  if (isNavProbe(bridge)) {
    out = Object.assign({}, payload, { stack: captureStack() })
  }
  if (bridge && handlerName) {
    try {
      bridge[handlerName](out)
      return
    } catch {
      // fall through
    }
  }

  const win = typeof window !== 'undefined' ? window : self
  const reportFn =
    kind === 'CLICK'
      ? win.__vcReportClick
      : kind === 'LOCATION'
        ? win.__vcReportLocation
        : kind === 'HISTORY'
          ? win.__vcReportHistory
          : null
  if (typeof reportFn === 'function') {
    try {
      reportFn(out)
      return
    } catch {
      // fall through
    }
  }

  try {
    win.parent.postMessage([CHANNEL, kind, out], '*')
  } catch {
    // ignore
  }
}

/**
 * @param {Record<string, unknown>} payload
 */
export function reportClick(payload) {
  forward('CLICK', payload)
}

/**
 * @param {Record<string, unknown>} payload
 */
export function reportLocation(payload) {
  forward('LOCATION', payload)
}

/**
 * Same document when origin, pathname, and search match (hash may differ).
 * @param {string} targetHref
 * @param {string} currentHref
 */
export function isSameDocumentUrl(targetHref, currentHref) {
  try {
    const target = new URL(targetHref, currentHref)
    const current = new URL(currentHref)
    return (
      target.origin === current.origin &&
      target.pathname === current.pathname &&
      target.search === current.search
    )
  } catch {
    return false
  }
}

/**
 * @param {HTMLFormElement} form
 */
function formHasFileInput(form) {
  try {
    const inputs = form.querySelectorAll('input[type=file]')
    for (let i = 0; i < inputs.length; i++) {
      const input = inputs[i]
      if (input.files && input.files.length > 0) {
        return true
      }
    }
  } catch {
    // ignore
  }
  return false
}

/**
 * @param {HTMLFormElement} form
 * @returns {string|null}
 */
function serializeUrlEncodedForm(form) {
  try {
    const enctype = String(form.enctype || 'application/x-www-form-urlencoded').toLowerCase()
    if (enctype !== 'application/x-www-form-urlencoded') {
      return null
    }
    const params = new URLSearchParams()
    const fd = new FormData(form)
    fd.forEach((value, key) => {
      if (!key) {
        return
      }
      if (typeof value === 'string') {
        params.append(key, value)
      }
    })
    return params.toString()
  } catch {
    return null
  }
}

/**
 * Build the URL a GET form would navigate to (action + successful controls).
 * POST forms return the action URL only; use buildFormSubmitPayload for body.
 * @param {HTMLFormElement} form
 * @param {string=} fallbackHref
 */
export function buildFormSubmitUrl(form, fallbackHref) {
  let action = ''
  try {
    action = form.action || fallbackHref || ''
  } catch {
    action = fallbackHref || ''
  }
  if (!action) {
    return ''
  }

  const method = String(form.method || 'get').toLowerCase()
  if (method !== 'get') {
    try {
      return new URL(action, fallbackHref || action).href
    } catch {
      return action
    }
  }

  try {
    const url = new URL(action, fallbackHref || action)
    const params = new URLSearchParams()
    const fd = new FormData(form)
    fd.forEach((value, key) => {
      if (!key) {
        return
      }
      if (typeof value === 'string') {
        params.append(key, value)
      }
      // File values are not representable in a GET query; skip
    })
    const qs = params.toString()
    url.search = qs ? '?' + qs : ''
    return url.href
  } catch {
    return action
  }
}

/**
 * @param {HTMLFormElement} form
 * @param {string=} fallbackHref
 */
export function buildFormSubmitPayload(form, fallbackHref) {
  let httpMethod = String(form.method || 'get').toLowerCase()
  if (httpMethod !== 'get' && httpMethod !== 'post') {
    httpMethod = 'get'
  }

  const url = buildFormSubmitUrl(form, fallbackHref)

  /** @type {Record<string, unknown>} */
  const payload = {
    ts: Date.now(),
    method: 'submit',
    httpMethod,
    url,
  }

  if (httpMethod === 'post') {
    if (formHasFileInput(form)) {
      payload.formFiles = true
    } else {
      const body = serializeUrlEncodedForm(form)
      if (body !== null) {
        payload.formBody = body
        payload.formEnctype = 'application/x-www-form-urlencoded'
      }
    }
  }

  return payload
}

/**
 * @param {Record<string, unknown>} payload
 */
export function reportHistory(payload) {
  forward('HISTORY', payload)
}

/**
 * @param {Element | null | undefined} el
 */
export function isInsideVConsole(el) {
  return !!(el && el.closest && el.closest('#__vconsole'))
}

/**
 * Anchors without an href attribute are not links; jsproxy's href hook turns "" into the page URL.
 * @param {Element} el
 */
export function anchorHasHref(el) {
  return typeof el.hasAttribute === 'function' && el.hasAttribute('href')
}

/**
 * @param {Element} el
 */
export function buildClickPayload(el) {
  const tag = el.tagName || ''
  /** @type {Record<string, unknown>} */
  const payload = {
    ts: Date.now(),
    tagName: tag,
    id: el.id || '',
    className: typeof el.className === 'string' ? el.className : '',
    text: String(el.innerText || el.textContent || '')
      .trim()
      .slice(0, 200),
  }
  if ((tag === 'A' || tag === 'AREA') && anchorHasHref(el)) {
    /** @type {HTMLAnchorElement} */
    const link = el
    payload.href = link.href || ''
    payload.target = link.target || ''
  }
  return payload
}

/**
 * @param {Element} el
 * @param {Window} view
 */
export function dispatchSyntheticClick(el, view) {
  el.dispatchEvent(
    new MouseEvent('click', { bubbles: true, cancelable: true, view: view }),
  )
}

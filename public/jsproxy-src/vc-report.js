/**
 * virtual-chromo passive navigation — report page intents to bridge (no navigation).
 */
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
 * @param {string} kind
 * @param {Record<string, unknown>} payload
 */
function forward(kind, payload) {
  const handlerName = BRIDGE_HANDLERS[kind]
  const bridge = findBridgeWindow(kind)
  if (bridge && handlerName) {
    try {
      bridge[handlerName](payload)
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
      reportFn(payload)
      return
    } catch {
      // fall through
    }
  }

  try {
    win.parent.postMessage([CHANNEL, kind, payload], '*')
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
 * Build the URL a GET form would navigate to (action + successful controls).
 * POST forms still return the action URL only (body not representable in VC_LOCATION).
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
    return action
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

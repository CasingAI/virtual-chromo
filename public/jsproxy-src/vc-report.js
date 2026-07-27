/**
 * virtual-chromo passive navigation — report page intents to bridge (no navigation).
 */
const CHANNEL = '_VC_INJECT'

/**
 * @param {string} kind
 * @param {Record<string, unknown>} payload
 */
function forward(kind, payload) {
  const win = typeof window !== 'undefined' ? window : self
  const fn =
    kind === 'CLICK'
      ? win.__vcReportClick
      : kind === 'LOCATION'
        ? win.__vcReportLocation
        : null
  if (typeof fn === 'function') {
    try {
      fn(payload)
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
  if (tag === 'A' || tag === 'AREA') {
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

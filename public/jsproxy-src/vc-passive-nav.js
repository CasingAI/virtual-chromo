/**
 * virtual-chromo passive navigation — trusted pointer capture (bundle-side).
 * Runs from page.js so clicks are intercepted even if inject.js fails to load.
 */
import * as vcReport from './vc-report.js'

/** @type {WeakSet<Document>} */
const installedDocs = new WeakSet()

/**
 * @param {string | null | undefined} href
 */
function isNavigationalHref(href) {
  if (!href) {
    return false
  }
  const s = String(href)
  if (!s || s === '#' || s.startsWith('javascript:')) {
    return false
  }
  return true
}

/**
 * @param {Event} event
 */
function onTrustedPointer(event) {
  if (!event.isTrusted) {
    return
  }
  const raw = event.target
  if (!raw || raw.nodeType !== 1) {
    return
  }
  /** @type {Element} */
  const el = raw
  if (vcReport.isInsideVConsole(el)) {
    return
  }
  const link = el.closest ? el.closest('a[href],area[href]') : null
  vcReport.reportClick(vcReport.buildClickPayload(link || el))
  if (link && vcReport.anchorHasHref(link) && isNavigationalHref(link.href)) {
    event.preventDefault()
  }
}

/**
 * @param {Document} doc
 */
export function installTrustedClickCapture(doc) {
  if (!doc || installedDocs.has(doc)) {
    return
  }
  installedDocs.add(doc)
  doc.__vcPassiveNavInstalled = true
  doc.addEventListener('click', onTrustedPointer, true)
  doc.addEventListener('auxclick', onTrustedPointer, true)
}

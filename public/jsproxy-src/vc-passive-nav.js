/**
 * virtual-chromo passive navigation — trusted pointer capture (bundle-side).
 * Runs from page.js so clicks are intercepted even if inject.js fails to load.
 */
import * as urlx from './urlx.js'
import * as vcReport from './vc-report.js'

/** @type {WeakSet<Document>} */
const installedDocs = new WeakSet()

/**
 * @param {HTMLAnchorElement | HTMLAreaElement} link
 */
function shouldPreventLinkNavigation(link) {
  if (!link || !vcReport.anchorHasHref(link)) {
    return false
  }
  const href = link.href
  if (!href || href === '#' || href.startsWith('javascript:')) {
    return false
  }
  try {
    const current = urlx.decUrlObj(location)
    if (vcReport.isSameDocumentUrl(href, current)) {
      return false
    }
  } catch {
    // fall through
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
  if (link && shouldPreventLinkNavigation(link)) {
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

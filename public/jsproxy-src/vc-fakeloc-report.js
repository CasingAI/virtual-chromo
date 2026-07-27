import * as urlx from './urlx.js'
import * as vcReport from './vc-report.js'

/**
 * @param {Location | { href: string }} loc
 */
function getRealHref(loc) {
  return urlx.decUrlObj(new URL(loc.href))
}

/**
 * @param {string} method
 * @param {string} url
 */
export function reportNav(method, url) {
  vcReport.reportLocation({
    ts: Date.now(),
    method,
    url,
  })
}

/**
 * @param {string} method
 * @param {string} val
 * @param {Location} locObj fake location (for encUrlStrRel base)
 * @param {Location} rawLoc browser location
 */
export function reportNavFromInput(method, val, locObj, rawLoc) {
  try {
    const enc = urlx.encUrlStrRel(val, locObj)
    reportNav(method, urlx.decUrlStrAbs(enc))
  } catch {
    reportNav(method, String(val))
  }
}

/**
 * @param {string} method
 * @param {URL} urlObj
 */
export function reportNavFromUrlObj(method, urlObj) {
  reportNav(method, urlObj.href)
}

/**
 * @param {Location} rawLoc
 */
export function reportCurrent(method, rawLoc) {
  reportNav(method, getRealHref(rawLoc))
}

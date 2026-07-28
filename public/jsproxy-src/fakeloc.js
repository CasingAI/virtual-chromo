import * as urlx from "./urlx";
import * as navReport from './vc-fakeloc-report.js'
import * as vcReport from './vc-report.js'

const {
  defineProperty,
  setPrototypeOf,
} = Object


function setup(obj, fakeLoc) {
  defineProperty(obj, '__location', {
    get() {
      return fakeLoc
    },
    set(val) {
      console.log('[jsproxy] %s set location: %s', obj, val)
      navReport.reportNavFromInput('href', val, fakeLoc, fakeLoc)
    }
  })
}


/**
 * @param {Window} global  WindowOrWorkerGlobalScope
 */
export function createFakeLoc(global) {
  const location = global.location
  let ancestorOrigins

  /**
   * @param {Location | URL} loc 
   */
  function getPageUrlObj(loc) {
    return new URL(urlx.decUrlObj(loc))
  }

  function getDecodedHref() {
    return getPageUrlObj(location).href
  }

  /**
   * Apply hash / same-document URL changes locally (no full navigation).
   * @param {string} method
   * @param {string} nextHref decoded absolute URL
   * @returns {boolean}
   */
  function applySameDocumentNavigation(method, nextHref) {
    const currentHref = getDecodedHref()
    let nextUrlObj
    try {
      nextUrlObj = new URL(nextHref, currentHref)
    } catch {
      return false
    }
    if (!vcReport.isSameDocumentUrl(nextUrlObj.href, currentHref)) {
      return false
    }

    const enc = urlx.encUrlObj(nextUrlObj)
    const prevHash = new URL(currentHref).hash
    try {
      global.history.replaceState(global.history.state, '', enc)
    } catch {
      try {
        location.href = enc
      } catch {
        return false
      }
    }

    if (prevHash !== nextUrlObj.hash) {
      try {
        global.dispatchEvent(
          new HashChangeEvent('hashchange', {
            oldURL: currentHref,
            newURL: nextUrlObj.href,
          }),
        )
      } catch {
        // ignore
      }
    }

    vcReport.reportHistory({
      ts: Date.now(),
      method,
      url: nextUrlObj.href,
      title: global.document && global.document.title ? global.document.title : '',
    })
    return true
  }

  /**
   * @param {string} method
   * @param {string} val
   * @returns {boolean}
   */
  function trySameDocumentFromInput(method, val) {
    try {
      const enc = urlx.encUrlStrRel(val, locObj)
      const decoded = urlx.decUrlStrAbs(enc)
      return applySameDocumentNavigation(method, decoded)
    } catch {
      return false
    }
  }


  // 不缓存 location 属性，因为 beforeunload 事件会影响赋值
  const locObj = {
    get href() {
      return getPageUrlObj(location).href
    },

    get protocol() {
      return getPageUrlObj(location).protocol
    },

    get host() {
      return getPageUrlObj(location).host
    },

    get hostname() {
      return getPageUrlObj(location).hostname
    },

    get port() {
      return getPageUrlObj(location).port
    },

    get pathname() {
      return getPageUrlObj(location).pathname
    },

    get search() {
      return getPageUrlObj(location).search
    },

    get hash() {
      return getPageUrlObj(location).hash
    },

    get origin() {
      return getPageUrlObj(location).origin
    },

    toString() {
      return this.href
    },

    toLocaleString() {
      return this.href
    },

    get ancestorOrigins() {
      if (!ancestorOrigins) {
        ancestorOrigins = []

        let p = global
        while ((p = p.parent) !== top) {
          const u = getPageUrlObj(p.location)
          ancestorOrigins.unshift(u.origin)
        }
      }
      return ancestorOrigins
    },

    set href(val) {
      console.log('[jsproxy] set location.href:', val)
      if (trySameDocumentFromInput('href', val)) {
        return
      }
      navReport.reportNavFromInput('href', val, locObj, location)
    },

    set protocol(val) {
      console.log('[jsproxy] set location.protocol:', val)
      const urlObj = getPageUrlObj(location)
      urlObj.protocol = val
      navReport.reportNavFromUrlObj('protocol', urlObj)
    },

    set host(val) {
      console.log('[jsproxy] set location.host:', val)
      const urlObj = getPageUrlObj(location)
      urlObj.host = val
      navReport.reportNavFromUrlObj('host', urlObj)
    },

    set hostname(val) {
      console.log('[jsproxy] set location.hostname:', val)
      const urlObj = getPageUrlObj(location)
      urlObj.hostname = val
      navReport.reportNavFromUrlObj('hostname', urlObj)
    },

    set port(val) {
      console.log('[jsproxy] set location.port:', val)
      const urlObj = getPageUrlObj(location)
      urlObj.port = val
      navReport.reportNavFromUrlObj('port', urlObj)
    },

    set pathname(val) {
      console.log('[jsproxy] set location.pathname:', val)
      const urlObj = getPageUrlObj(location)
      urlObj.pathname = val
      navReport.reportNavFromUrlObj('pathname', urlObj)
    },

    set search(val) {
      console.log('[jsproxy] set location.search:', val)
      const urlObj = getPageUrlObj(location)
      urlObj.search = val
      navReport.reportNavFromUrlObj('search', urlObj)
    },

    set hash(val) {
      console.log('[jsproxy] set location.hash:', val)
      const next = new URL(getDecodedHref())
      let hash = String(val)
      if (hash && !hash.startsWith('#')) {
        hash = '#' + hash
      }
      next.hash = hash
      applySameDocumentNavigation('hash', next.href)
    },

    reload() {
      console.warn('[jsproxy] location.reload (report only)')
      navReport.reportCurrent('reload', location)
    },

    replace(val) {
      console.warn('[jsproxy] location.replace:', val)
      if (val) {
        if (trySameDocumentFromInput('replace', val)) {
          return
        }
        navReport.reportNavFromInput('replace', val, locObj, location)
      } else {
        navReport.reportCurrent('replace', location)
      }
    },

    assign(val) {
      console.warn('[jsproxy] location.assign:', val)
      if (val) {
        if (trySameDocumentFromInput('assign', val)) {
          return
        }
        navReport.reportNavFromInput('assign', val, locObj, location)
      } else {
        navReport.reportCurrent('assign', location)
      }
    },
  }

  const locProto = location.constructor.prototype
  const fakeLoc = setPrototypeOf(locObj, locProto)
  setup(global, fakeLoc)

  const Document = global['Document']
  if (Document) {
    setup(Document.prototype, fakeLoc)
  }

  return fakeLoc
}

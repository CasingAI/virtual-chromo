import * as urlx from "./urlx";
import * as navReport from './vc-fakeloc-report.js'

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
      const urlObj = getPageUrlObj(location)
      urlObj.hash = val
      navReport.reportNavFromUrlObj('hash', urlObj)
    },

    reload() {
      console.warn('[jsproxy] location.reload (report only)')
      navReport.reportCurrent('reload', location)
    },

    replace(val) {
      console.warn('[jsproxy] location.replace:', val)
      if (val) {
        navReport.reportNavFromInput('replace', val, locObj, location)
      } else {
        navReport.reportCurrent('replace', location)
      }
    },

    assign(val) {
      console.warn('[jsproxy] location.assign:', val)
      if (val) {
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

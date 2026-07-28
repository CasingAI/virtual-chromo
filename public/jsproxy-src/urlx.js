import * as util from './util.js'
import * as env from './env.js'
import * as path from './path.js'
import * as tld from './tld.js'


const PREFIX = path.PREFIX
const PREFIX_LEN = PREFIX.length
const PROXY_MARKER = '/-----'

/**
 * Keep target ?/# inside the proxy pathname. Otherwise the browser treats them as
 * the Worker URL's own search/hash and decUrlObj(pathname) drops them — e.g.
 * /-----https://duckduckgo.com/?q=x  →  fetches https://duckduckgo.com/
 * @param {string} url
 */
export function encodeProxyTarget(url) {
  return String(url).replace(/\?/g, '%3F').replace(/#/g, '%23')
}

/**
 * @param {string} raw target slice after /-----
 */
export function decodeProxyTarget(raw) {
  return String(raw).replace(/%3F/gi, '?').replace(/%23/gi, '#')
}

/**
 * @param {string} url 
 */
export function isHttpProto(url) {
  return /^https?:/.test(url)
}


/** @param {string} host */
export function isTurnstileHost(host) {
  return host === 'challenges.cloudflare.com' ||
    host.endsWith('.challenges.cloudflare.com')
}


/** @param {string} host */
export function isRecaptchaHost(host) {
  return host === 'www.google.com' ||
    host === 'google.com' ||
    host === 'www.gstatic.com' ||
    host === 'gstatic.com' ||
    host === 'www.recaptcha.net' ||
    host === 'recaptcha.net'
}


/**
 * CAPTCHA vendor origins that must keep real MessageEvent.origin / postMessage target.
 * @param {string} host
 */
export function isCaptchaVendorHost(host) {
  return isTurnstileHost(host) || isRecaptchaHost(host)
}


/**
 * @param {string} urlStr request or decoded URL
 */
export function isTurnstileApiJsUrl(urlStr) {
  const target = decUrlStrAbs(urlStr)
  const urlObj = newUrl(target)
  if (!urlObj || !isTurnstileHost(urlObj.hostname)) {
    return false
  }
  return /\/turnstile\/.*\/api\.js$/i.test(urlObj.pathname)
}


/**
 * Google reCAPTCHA / enterprise widget & api assets.
 * @param {string} url
 * @param {string=} baseUrl
 */
export function isRecaptchaUrl(url, baseUrl) {
  const urlObj = newUrl(url, baseUrl)
  if (!urlObj || !isRecaptchaHost(urlObj.hostname)) {
    return false
  }
  const host = urlObj.hostname
  const pathName = urlObj.pathname
  if (host === 'www.google.com' || host === 'google.com') {
    return pathName.includes('/recaptcha')
  }
  if (host === 'www.gstatic.com' || host === 'gstatic.com') {
    return pathName.includes('/recaptcha')
  }
  return true
}


/**
 * @param {string} url
 * @param {string=} baseUrl
 */
export function isTurnstileAbsoluteUrl(url, baseUrl) {
  const urlObj = newUrl(url, baseUrl)
  return urlObj ? isTurnstileHost(urlObj.hostname) : false
}


/**
 * iframe/script src that must stay on the real vendor origin (not proxied).
 * @param {string} url
 * @param {string=} baseUrl
 */
export function isCaptchaPassthroughUrl(url, baseUrl) {
  return isTurnstileAbsoluteUrl(url, baseUrl) || isRecaptchaUrl(url, baseUrl)
}


/**
 * @param {string} url 
 */
function isInternalUrl(url) {
  return !isHttpProto(url) || url.startsWith(PREFIX) || url.includes(PROXY_MARKER)
}


/**
 * @param {string} url 
 * @param {string | URL=} baseUrl 
 */
export function newUrl(url, baseUrl) {
  try {
    return baseUrl
      ? new URL(url, baseUrl)
      : new URL(url)
  } catch (err) {
  }
}


/**
 * Always `{origin}/-----` (no /s/<sessionId>/).
 * @param {string=} origin
 */
export function getProxyPrefix(origin) {
  let proxyOrigin = origin || ''
  if (!proxyOrigin) {
    try {
      if (path.ROOT && /^https?:/i.test(path.ROOT)) {
        proxyOrigin = new URL(path.ROOT).origin
      }
    } catch {
      // ignore
    }
  }
  if (!proxyOrigin) {
    try {
      proxyOrigin = self.location.origin
    } catch {
      proxyOrigin = ''
    }
  }
  return `${proxyOrigin}/-----`
}


/**
 * @param {URL | Location} urlObj
 */
export function encUrlObj(urlObj) {
  const fullUrl = urlObj.href
  if (isInternalUrl(fullUrl)) {
    return fullUrl
  }
  const embedded = encodeProxyTarget(fullUrl)

  // Page context: path.PREFIX already includes /----- from real location.
  if (!env.isSwEnv() && PREFIX) {
    return PREFIX + embedded
  }

  return getProxyPrefix() + embedded
}

const IS_SW = env.isSwEnv()
const IS_WORKER = env.isWorkerEnv()
const WORKER_URL = IS_WORKER && decUrlStrAbs(location.href)

/**
 * @param {string} url 
 * @param {*} relObj 
 */
export function encUrlStrRel(url, relObj) {
  let baseUrl

  if (IS_SW) {
    baseUrl = relObj
  } else if (IS_WORKER) {
    baseUrl = WORKER_URL
  } else {
    const {doc} = env.get(relObj)
    baseUrl = doc.baseURI
  }

  const urlObj = newUrl(url, baseUrl)
  if (!urlObj) {
    return url
  }
  return encUrlObj(urlObj)
}


/**
 * @param {string} url 
 */
export function encUrlStrAbs(url) {
  const urlObj = newUrl(url)
  if (!urlObj) {
    return url
  }
  return encUrlObj(urlObj)
}


/**
 * @param {URL | Location} urlObj 
 */
export function decUrlObj(urlObj) {
  const fullUrl = urlObj.href
  let target = ''
  if (fullUrl.startsWith(PREFIX)) {
    target = fullUrl.substr(PREFIX_LEN)
  } else {
    const idx = fullUrl.indexOf(PROXY_MARKER)
    if (idx === -1) {
      // Legacy /s/<id>/----- embeds: still decode for old bookmarks
      const legacy = fullUrl.match(/\/s\/[^/]+(\/-----.+)$/)
      if (legacy) {
        const rest = legacy[1]
        const mIdx = rest.indexOf(PROXY_MARKER)
        target = rest.substr(mIdx + PROXY_MARKER.length)
      } else {
        return fullUrl
      }
    } else {
      target = fullUrl.substr(idx + PROXY_MARKER.length)
    }
  }

  target = decodeProxyTarget(target)

  if (urlObj.search && target.indexOf('?') === -1) {
    target += urlObj.search
  }
  if (urlObj.hash && target.indexOf('#') === -1) {
    target += urlObj.hash
  }
  return target
}


/**
 * @param {string} url 
 * @param {*} relObj 
 */
export function decUrlStrRel(url, relObj) {
  let baseUrl

  if (IS_WORKER) {
    baseUrl = WORKER_URL
  } else {
    const {doc} = env.get(relObj)
    baseUrl = doc.baseURI
  }

  const urlObj = newUrl(url, baseUrl)
  if (!urlObj) {
    return url
  }
  return decUrlObj(urlObj)
}


/**
 * @param {string} url 
 */
export function decUrlStrAbs(url) {
  const urlObj = newUrl(url)
  if (!urlObj) {
    return url
  }
  return decUrlObj(urlObj)
}



/**
 * @param {string} url 
 */
export function delHash(url) {
  const p = url.indexOf('#')
  return (p === -1) ? url : url.substr(0, p)
}


/**
 * @param {string} url 
 */
export function delScheme(url) {
  const p = url.indexOf('://')
  return (p === -1) ? url : url.substr(p + 3)
}


/**
 * @param {string} val 
 */
export function replaceHttpRefresh(val, relObj) {
  return val.replace(/(;\s*url=)(.+)/i, (_, $1, url) => {
    return $1 + encUrlStrRel(url, relObj)
  })
}


/**
 * URL 导航调整
 */
const DEFAULT_ALIAS = {
  'www.google.com': ['google', 'gg', 'g'],
  'www.youtube.com': ['youtube', 'yt', 'y'],
  'www.wikipedia.org': ['wikipedia', 'wiki', 'wk', 'w'],
  'www.facebook.com': ['facebook', 'fb', 'f'],
  'twitter.com': ['twitter', 'tw', 't'],
}

const DEFAULT_SEARCH = 'https://www.google.com/search?q=%s'

/** @type {Map<string, string>} */
let aliasDomainMap

/**
 * @param {string} alias 
 */
function getAliasUrl(alias) {
  if (!aliasDomainMap) {
    aliasDomainMap = new Map()
    for (const [domain, aliasArr] of Object.entries(DEFAULT_ALIAS)) {
      for (const v of aliasArr) {
        aliasDomainMap.set(v, domain)
      }
    }
  }
  
  const domain = aliasDomainMap.get(alias)
  if (domain) {
    return 'https://' + domain + '/'
  }
}


/**
 * @param {string} part 
 */
function padUrl(part) {
  const urlStr = isHttpProto(part) ? part : `http://${part}`
  const urlObj = newUrl(urlStr)
  if (!urlObj) {
    return
  }
  const {hostname} = urlObj

  if (!hostname.includes('.')) {
    return
  }

  if (!tld.getTld(hostname)) {
    return
  }

  if (util.isIPv4(hostname) && !urlStr.includes(hostname)) {
    return
  }

  return urlObj.href
}


/**
 * @param {string} urlStr
 */
export function adjustNav(urlStr) {
  let origin = ''
  try {
    origin = new URL(urlStr).origin
  } catch {
    try {
      origin = self.location.origin
    } catch {
      origin = ''
    }
  }
  const prefix = getProxyPrefix(origin)

  let pathname = '/'
  try {
    pathname = new URL(urlStr).pathname
  } catch {
    // ignore
  }

  // Viewer home paths
  if (
    pathname === '/' ||
    pathname === '' ||
    pathname === '/index.html' ||
    pathname === '/viewer' ||
    pathname === '/viewer.html'
  ) {
    return
  }

  // Strip legacy /s/<id>/ if present
  const legacyShell = pathname.match(/^\/s\/[^/]+(\/.*)?$/)
  const restPath = legacyShell ? (legacyShell[1] || '/') : pathname

  if (
    restPath === '/' ||
    restPath === '' ||
    restPath === '/index.html' ||
    restPath === '/viewer' ||
    restPath === '/viewer.html'
  ) {
    return
  }

  const rawUrlStr = restPath.startsWith(PROXY_MARKER)
    ? restPath.substr(PROXY_MARKER.length)
    : restPath.replace(/^\/-+/, '')
  const rawUrlObj = newUrl(rawUrlStr)

  if (rawUrlObj) {
    const m = rawUrlStr.match(/\/-----(https?:\/\/.+)$/)
    if (m) {
      return prefix + m[1]
    }
    if (isHttpProto(rawUrlObj.protocol) &&
        prefix + encodeProxyTarget(rawUrlObj.href) === urlStr
    ) {
      return
    }
  }

  const part = restPath.replace(/^\/+/, '').replace(/^-+/, '')

  if (/^s\/[^/]+\/?$/.test(part)) {
    return
  }

  const ret = getAliasUrl(part) || padUrl(part)
  if (ret) {
    return prefix + encodeProxyTarget(ret)
  }

  if (!part) {
    return
  }

  const keyword = part.replace(/&/g, '%26')
  return prefix + encodeProxyTarget(DEFAULT_SEARCH.replace('%s', keyword))
}

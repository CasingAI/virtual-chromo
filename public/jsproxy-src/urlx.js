import * as util from './util.js'
import * as env from './env.js'
import * as path from './path.js'
import * as session from './session.js'
import * as tld from './tld.js'


const PREFIX = path.PREFIX
const PREFIX_LEN = PREFIX.length
const ROOT_LEN = path.ROOT.length
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
  const path = urlObj.pathname
  if (host === 'www.google.com' || host === 'google.com') {
    return path.includes('/recaptcha')
  }
  if (host === 'www.gstatic.com' || host === 'gstatic.com') {
    return path.includes('/recaptcha')
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
    // [safari] baseUrl 不能为空
    return baseUrl
      ? new URL(url, baseUrl)
      : new URL(url)
  } catch (err) {
  }
}


/**
 * @param {string} urlStr
 */
function applySessionFromUrl(urlStr) {
  const parsed = session.parseSessionFromUrl(urlStr)
  session.setCurrentSessionId(parsed.sessionId)
  return parsed
}


/**
 * @param {URL | Location} urlObj
 * @param {string=} sessionId
 */
export function encUrlObj(urlObj, sessionId) {
  const fullUrl = urlObj.href
  if (isInternalUrl(fullUrl)) {
    return fullUrl
  }
  const sid = sessionId || session.getCurrentSessionId()
  const embedded = encodeProxyTarget(fullUrl)

  // Page context: path.PREFIX already includes /s/{sessionId}/ from real location.
  // Do NOT use urlObj.origin (target site) — that produced google.com/-----https://...
  if (!sessionId && !env.isSwEnv() && PREFIX) {
    return PREFIX + embedded
  }

  let proxyOrigin = ''
  try {
    if (path.ROOT && /^https?:/i.test(path.ROOT)) {
      proxyOrigin = new URL(path.ROOT).origin
    }
  } catch {
    // ignore
  }
  if (!proxyOrigin) {
    try {
      proxyOrigin = self.location.origin
    } catch {
      proxyOrigin = ''
    }
  }
  return session.getProxyPrefix(proxyOrigin, sid) + embedded
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
    const parsed = session.parseSessionFromUrl(fullUrl)
    session.setCurrentSessionId(parsed.sessionId)
    const idx = parsed.restPath.indexOf(PROXY_MARKER)
    if (idx === -1) {
      return fullUrl
    }
    target = parsed.restPath.substr(idx + PROXY_MARKER.length)
  }

  target = decodeProxyTarget(target)

  // Legacy / unescaped embeds: browser moved ?query onto the proxy URL.
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
  const parsed = applySessionFromUrl(urlStr)
  const prefix = session.getProxyPrefix(parsed.origin, parsed.sessionId)

  if (session.isViewerHomePath(parsed.restPath)) {
    return
  }

  const rawUrlStr = parsed.restPath.startsWith(PROXY_MARKER)
    ? parsed.restPath.substr(PROXY_MARKER.length)
    : parsed.restPath.replace(/^\/-+/, '')
  const rawUrlObj = newUrl(rawUrlStr)

  if (rawUrlObj) {
    const m = rawUrlStr.match(/\/-----(https?:\/\/.+)$/)
    if (m) {
      return prefix + m[1]
    }
    if (isHttpProto(rawUrlObj.protocol) &&
        prefix + rawUrlObj.href === urlStr
    ) {
      return
    }
  }

  const part = parsed.restPath.replace(/^\/+/, '').replace(/^-+/, '')

  // Mis-encoded session shell paths must not become Google search queries.
  if (/^s\/[^/]+\/?$/.test(part)) {
    return
  }

  const ret = getAliasUrl(part) || padUrl(part)
  if (ret) {
    return prefix + ret
  }

  if (!part) {
    return
  }

  const keyword = part.replace(/&/g, '%26')
  return prefix + DEFAULT_SEARCH.replace('%s', keyword)
}

/**
 * HTTP cacheability / freshness helpers for DevTools hot cache
 * and legacy proxy url-cache routing.
 */

const STATIC_EXT_RE =
  /\.(?:js|mjs|cjs|css|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|otf|eot|mp4|webm|mp3|wav|ogg|map)(?:$|\?)/i

/** Heuristic TTL for cacheable static assets without Cache-Control (ms). */
export const HEURISTIC_STATIC_TTL_MS = 5 * 60 * 1000

/**
 * @param {Headers|Record<string, string>|null|undefined} headers
 * @returns {{ maxAgeSec: number, noStore: boolean, noCache: boolean, isPublic: boolean, isPrivate: boolean }}
 */
export function parseResCache(headers) {
  const get = (name) => {
    if (!headers) {
      return null
    }
    if (typeof headers.get === 'function') {
      return headers.get(name)
    }
    const lower = name.toLowerCase()
    for (const k of Object.keys(headers)) {
      if (k.toLowerCase() === lower) {
        return headers[k]
      }
    }
    return null
  }

  const cacheStr = get('cache-control') || ''
  let maxAgeSec = 0
  let noStore = false
  let noCache = false
  let isPublic = false
  let isPrivate = false

  if (cacheStr) {
    if (/no-store/i.test(cacheStr)) {
      noStore = true
    }
    if (/no-cache/i.test(cacheStr)) {
      noCache = true
    }
    if (/(?:^|,)\s*public\b/i.test(cacheStr)) {
      isPublic = true
    }
    if (/(?:^|,)\s*private\b/i.test(cacheStr)) {
      isPrivate = true
    }
    const m = cacheStr.match(/(?:^|,\s*)max-age=["']?(\d+)/i)
    if (m) {
      maxAgeSec = +m[1]
    }
  }

  if (!maxAgeSec && !noStore) {
    const expires = get('expires')
    if (expires) {
      const ts = Date.parse(expires)
      if (ts > 0) {
        maxAgeSec = Math.max(0, Math.floor((ts - Date.now()) / 1000))
      }
    }
  }

  return { maxAgeSec, noStore, noCache, isPublic, isPrivate }
}

/**
 * @param {Headers|Record<string, string>|null|undefined} headers
 * @param {string} name
 */
function headerHas(headers, name) {
  if (!headers) {
    return false
  }
  if (typeof headers.get === 'function') {
    const v = headers.get(name)
    return !!(v && String(v).trim())
  }
  const lower = name.toLowerCase()
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() === lower && headers[k]) {
      return true
    }
  }
  return false
}

/**
 * @param {string} method
 * @param {number} status
 * @param {Headers|Record<string, string>|null|undefined} reqHeaders
 * @param {Headers|Record<string, string>|null|undefined} resHeaders
 * @returns {{ ok: boolean, reason?: string }}
 */
export function isCacheable(method, status, reqHeaders, resHeaders) {
  if (String(method || 'GET').toUpperCase() !== 'GET') {
    return { ok: false, reason: 'method' }
  }
  if (typeof status !== 'number' || status < 200 || status >= 300) {
    return { ok: false, reason: 'status' }
  }
  const policy = parseResCache(resHeaders)
  if (policy.noStore) {
    return { ok: false, reason: 'no-store' }
  }
  if (policy.noCache) {
    return { ok: false, reason: 'no-cache' }
  }
  if (headerHas(reqHeaders, 'authorization')) {
    return { ok: false, reason: 'auth' }
  }
  if (headerHas(resHeaders, 'set-cookie') || headerHas(resHeaders, 'set-cookie2')) {
    return { ok: false, reason: 'set-cookie' }
  }
  if (headerHas(reqHeaders, 'cookie') && !policy.isPublic) {
    return { ok: false, reason: 'cookie' }
  }
  return { ok: true }
}

/**
 * @param {Headers|Record<string, string>|null|undefined} resHeaders
 * @param {number} storedAtMs
 * @param {string=} url
 * @returns {number} expiresAt epoch ms
 */
export function computeExpiresAt(resHeaders, storedAtMs, url) {
  const at = typeof storedAtMs === 'number' ? storedAtMs : Date.now()
  const policy = parseResCache(resHeaders)
  if (policy.noStore || policy.noCache) {
    return at
  }
  if (policy.maxAgeSec > 0) {
    return at + policy.maxAgeSec * 1000
  }
  if (url && STATIC_EXT_RE.test(url)) {
    return at + HEURISTIC_STATIC_TTL_MS
  }
  // HTML / API without explicit freshness: do not reuse.
  return at
}

/**
 * @param {number} expiresAtMs
 * @param {number=} nowMs
 */
export function isFresh(expiresAtMs, nowMs) {
  const now = typeof nowMs === 'number' ? nowMs : Date.now()
  return typeof expiresAtMs === 'number' && expiresAtMs > now
}

/**
 * Legacy helper for network.js url-cache node routing.
 * Returns max-age seconds, -1 for no-cache, 0 if unknown.
 * @param {Headers} header
 */
export function parseResCacheSeconds(header) {
  const policy = parseResCache(header)
  if (policy.noCache || policy.noStore) {
    return -1
  }
  return policy.maxAgeSec > 0 ? policy.maxAgeSec : 0
}

/** @typedef {{ sessionId: string, restPath: string, origin: string }} ParsedSessionUrl */

export const DEFAULT_SESSION = 'default'

/** @type {string} */
let mCurrentSessionId = DEFAULT_SESSION

/** @type {Map<string, { clientIds: Set<string>, lastTouch: number }>} */
const mRegistry = new Map()

const IDLE_GC_MS = 1000 * 60 * 60
const IDLE_GC_INTERVAL_MS = 1000 * 60 * 5

const SESSION_PATH_RE = /^\/s\/([^/]+)(\/.*)?$/


/**
 * @param {string} pathname
 */
export function parseSessionFromPathname(pathname) {
  const m = pathname.match(SESSION_PATH_RE)
  if (m) {
    return {
      sessionId: m[1],
      restPath: m[2] || '/',
    }
  }
  return {
    sessionId: DEFAULT_SESSION,
    restPath: pathname,
  }
}


/**
 * @param {string} urlStr
 * @returns {ParsedSessionUrl}
 */
export function parseSessionFromUrl(urlStr) {
  try {
    const urlObj = new URL(urlStr)
    const { sessionId, restPath } = parseSessionFromPathname(urlObj.pathname)
    return {
      sessionId,
      restPath,
      origin: urlObj.origin,
    }
  } catch {
    return {
      sessionId: DEFAULT_SESSION,
      restPath: '/',
      origin: '',
    }
  }
}


/**
 * @param {string} sessionId
 */
export function sessionPathPrefix(sessionId) {
  return `/s/${sessionId}/`
}


/**
 * @param {string} origin
 * @param {string} sessionId
 * @param {string=} rest
 */
export function buildSessionUrl(origin, sessionId, rest) {
  const tail = rest || ''
  const normalized = tail.startsWith('/') ? tail.slice(1) : tail
  return `${origin}${sessionPathPrefix(sessionId)}${normalized}`
}


/**
 * @param {string} sessionId
 */
export function setCurrentSessionId(sessionId) {
  mCurrentSessionId = sessionId || DEFAULT_SESSION
}


export function getCurrentSessionId() {
  return mCurrentSessionId
}


/**
 * @param {string} origin
 * @param {string=} sessionId
 */
export function getProxyPrefix(origin, sessionId) {
  const sid = sessionId || mCurrentSessionId
  if (sid === DEFAULT_SESSION) {
    return `${origin}/-----`
  }
  return `${origin}${sessionPathPrefix(sid)}-----`
}


/**
 * @param {string} sessionId
 * @param {string=} clientId
 */
export function touchSession(sessionId, clientId) {
  const sid = sessionId || DEFAULT_SESSION
  let entry = mRegistry.get(sid)
  if (!entry) {
    entry = { clientIds: new Set(), lastTouch: Date.now() }
    mRegistry.set(sid, entry)
  }
  entry.lastTouch = Date.now()
  if (clientId) {
    entry.clientIds.add(clientId)
  }
}


/**
 * @param {string} sessionId
 * @param {string} clientId
 */
export function detachClient(sessionId, clientId) {
  const entry = mRegistry.get(sessionId)
  if (!entry) {
    return
  }
  entry.clientIds.delete(clientId)
}


/**
 * @param {string} sessionId
 */
export function removeSessionRegistry(sessionId) {
  mRegistry.delete(sessionId)
}


/**
 * @returns {{ sessionId: string, clientCount: number, lastTouch: number }[]}
 */
export function listSessions() {
  const ret = []
  for (const [sessionId, entry] of mRegistry.entries()) {
    ret.push({
      sessionId,
      clientCount: entry.clientIds.size,
      lastTouch: entry.lastTouch,
    })
  }
  return ret
}


/**
 * @param {string} restPath
 */
export function isViewerHomePath(restPath) {
  return (
    restPath === '/' ||
    restPath === '' ||
    restPath === '/index.html' ||
    restPath === '/viewer' ||
    restPath === '/viewer.html'
  )
}


/**
 * @param {string} pathname
 */
export function isLegacyRootPath(pathname) {
  return (
    pathname === '/' ||
    pathname === '/index.html' ||
    pathname === '/viewer' ||
    pathname === '/viewer.html'
  )
}


/** @type {(() => Promise<void>) | null} */
let mDestroyHandler = null


/**
 * @param {() => Promise<void>} fn
 */
export function setDestroyHandler(fn) {
  mDestroyHandler = fn
}


/**
 * @param {string} sessionId
 */
export async function destroySession(sessionId) {
  if (mDestroyHandler) {
    await mDestroyHandler(sessionId)
  }
  removeSessionRegistry(sessionId)
}


let mGcStarted = false

export function startIdleGc() {
  if (mGcStarted) {
    return
  }
  mGcStarted = true
  setInterval(() => {
    const now = Date.now()
    for (const [sessionId, entry] of mRegistry.entries()) {
      if (sessionId === DEFAULT_SESSION) {
        continue
      }
      if (entry.clientIds.size === 0 && now - entry.lastTouch > IDLE_GC_MS) {
        destroySession(sessionId)
      }
    }
  }, IDLE_GC_INTERVAL_MS)
}


/**
 * @param {string=} sessionId
 */
export function createSessionId(sessionId) {
  if (sessionId && /^[\w-]{1,128}$/.test(sessionId)) {
    return sessionId
  }
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
}

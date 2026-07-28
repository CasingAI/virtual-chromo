import * as util from './util.js'

const ARCHIVE_CACHE = 'vc-net-archive'
const HOT_CACHE = 'vc-net-hot'
const VC_ORIGIN = 'https://__vc__'

/**
 * Max bytes streamed from archive for DevTools Response/Preview.
 * Storage itself has no per-entry size cap; hot cache uses HOT_QUOTA_BYTES LRU.
 * @type {number}
 */
export const BODY_DISPLAY_MAX_BYTES = 64 * 1024

/** @deprecated Use BODY_DISPLAY_MAX_BYTES. Kept as alias for older call sites during transition. */
export const MAX_BODY_BYTES = BODY_DISPLAY_MAX_BYTES

/** Hot cache soft quota (bytes). */
const HOT_QUOTA_BYTES = 50 * 1024 * 1024

/**
 * @typedef {{ devtoolsId: string, disableCache: boolean, sessionId: string, at: number }} DevtoolsOpts
 */

/** @type {Map<string, DevtoolsOpts>} */
const mClientOpts = new Map()

/** @type {Map<string, DevtoolsOpts>} */
const mSessionFallback = new Map()

/** @type {Map<string, { size: number, at: number }>} */
const mHotIndex = new Map()

/**
 * @param {string} sessionId
 * @param {string} entryId
 */
export function archiveRequestUrl(sessionId, entryId) {
  return `${VC_ORIGIN}/archive/${encodeURIComponent(sessionId)}/${encodeURIComponent(entryId)}`
}

/**
 * @param {string} url
 */
export function normalizeHotUrl(url) {
  try {
    return new URL(url).href
  } catch {
    return url
  }
}

/**
 * Session-scoped hot cache key (devtoolsId is NOT part of the key;
 * it only controls Disable cache via resolveContext).
 *
 * @param {string} sessionId
 * @param {string} method
 * @param {string} url
 */
export function hotRequestUrl(sessionId, method, url) {
  const normalized = normalizeHotUrl(url)
  const hash = util.strHash(`${method}\0${normalized}`)
  const hashHex = util.numToHex(hash, 8)
  return `${VC_ORIGIN}/hot/${encodeURIComponent(sessionId)}/${hashHex}`
}

/**
 * Legacy hot key that included devtoolsId (pre v5/v6). Used for migration reads only.
 *
 * @param {string} sessionId
 * @param {string} devtoolsId
 * @param {string} method
 * @param {string} url
 */
export function hotRequestUrlLegacy(sessionId, devtoolsId, method, url) {
  const normalized = normalizeHotUrl(url)
  const hash = util.strHash(`${method}\0${normalized}`)
  const hashHex = util.numToHex(hash, 8)
  return `${VC_ORIGIN}/hot/${encodeURIComponent(sessionId)}/${encodeURIComponent(devtoolsId)}/${hashHex}`
}

/**
 * @param {string} clientId
 * @param {{ devtoolsId: string, disableCache?: boolean, sessionId: string }} opts
 */
export function registerClientOpts(clientId, opts) {
  if (!clientId || !opts.devtoolsId) {
    return
  }
  const rec = {
    devtoolsId: opts.devtoolsId,
    disableCache: !!opts.disableCache,
    sessionId: opts.sessionId,
    at: Date.now(),
  }
  mClientOpts.set(clientId, rec)
  mSessionFallback.set(opts.sessionId, rec)
}

/**
 * @param {string} clientId
 * @param {string} devtoolsId
 */
export function bindClientDevtools(clientId, devtoolsId) {
  if (!clientId || !devtoolsId) {
    return
  }
  for (const rec of mClientOpts.values()) {
    if (rec.devtoolsId === devtoolsId) {
      mClientOpts.set(clientId, {
        devtoolsId: rec.devtoolsId,
        disableCache: rec.disableCache,
        sessionId: rec.sessionId,
        at: Date.now(),
      })
      return
    }
  }
}

/**
 * @param {string} clientId
 * @param {string} sessionId
 * @returns {DevtoolsOpts|null}
 */
export function resolveContext(clientId, sessionId) {
  if (clientId && mClientOpts.has(clientId)) {
    return mClientOpts.get(clientId) || null
  }
  const fallback = mSessionFallback.get(sessionId)
  if (fallback) {
    if (clientId) {
      mClientOpts.set(clientId, {
        devtoolsId: fallback.devtoolsId,
        disableCache: fallback.disableCache,
        sessionId: fallback.sessionId,
        at: Date.now(),
      })
    }
    return fallback
  }
  // Before PAGE_NETWORK_OPTS arrives, provisional opts so first-paint GETs
  // still resolve disableCache=false under the same session namespace.
  if (sessionId && sessionId !== 'default') {
    const provisional = {
      devtoolsId: sessionId,
      disableCache: false,
      sessionId: sessionId,
      at: Date.now(),
    }
    mSessionFallback.set(sessionId, provisional)
    if (clientId) {
      mClientOpts.set(clientId, provisional)
    }
    return provisional
  }
  return null
}

/**
 * Whether a captured body size is eligible for archive/hot storage.
 * No per-entry byte cap — larger responses should still be cached.
 * @param {number} size
 */
export function shouldStoreBody(size) {
  return typeof size === 'number' && size >= 0 && Number.isFinite(size)
}

/**
 * @param {Response} res
 * @returns {Promise<number>} byte length, or -1 if unreadable
 */
async function responseByteLength(res) {
  try {
    const buf = await res.clone().arrayBuffer()
    return buf.byteLength
  } catch {
    return -1
  }
}

/**
 * Stream-read a cached Response body up to BODY_DISPLAY_MAX_BYTES for DevTools UI.
 * @param {Response} res
 * @returns {Promise<{ text: string, truncated: boolean, bytesRead: number, headers: Record<string, string>, status: number }>}
 */
export async function readBodyDisplayPrefix(res) {
  const headers = headersToObject(res.headers)
  const status = res.status
  if (!res.body) {
    return { text: '', truncated: false, bytesRead: 0, headers, status }
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: false })
  /** @type {Uint8Array[]} */
  const chunks = []
  let bytesRead = 0
  let truncated = false

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      if (!value || !value.byteLength) {
        continue
      }
      if (bytesRead >= BODY_DISPLAY_MAX_BYTES) {
        truncated = true
        break
      }
      const remaining = BODY_DISPLAY_MAX_BYTES - bytesRead
      if (value.byteLength <= remaining) {
        chunks.push(value)
        bytesRead += value.byteLength
      } else {
        chunks.push(value.subarray(0, remaining))
        bytesRead += remaining
        truncated = true
        break
      }
    }
  } finally {
    try {
      await reader.cancel()
    } catch {
      // ignore
    }
  }

  let total = 0
  for (const chunk of chunks) {
    total += chunk.byteLength
  }
  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  const text = decoder.decode(merged)
  return { text, truncated, bytesRead, headers, status }
}

/**
 * @param {string} sessionId
 * @param {string} entryId
 * @param {Response} res
 * @returns {Promise<boolean>}
 */
export async function putArchive(sessionId, entryId, res) {
  try {
    const cache = await caches.open(ARCHIVE_CACHE)
    const req = new Request(archiveRequestUrl(sessionId, entryId))
    await cache.put(req, res.clone())
    return true
  } catch (err) {
    console.warn('[vc] archive put fail:', err)
    return false
  }
}

/**
 * @param {string} sessionId
 * @param {string} entryId
 * @returns {Promise<Response|null>}
 */
export async function getArchive(sessionId, entryId) {
  try {
    const cache = await caches.open(ARCHIVE_CACHE)
    const req = new Request(archiveRequestUrl(sessionId, entryId))
    return await cache.match(req)
  } catch (err) {
    console.warn('[vc] archive get fail:', err)
    return null
  }
}

/**
 * @param {string} sessionId
 * @param {string} entryId
 */
export async function dropArchive(sessionId, entryId) {
  try {
    const cache = await caches.open(ARCHIVE_CACHE)
    await cache.delete(new Request(archiveRequestUrl(sessionId, entryId)))
  } catch (err) {
    console.warn('[vc] archive drop fail:', err)
  }
}

/**
 * @param {string} hotUrl
 */
async function evictHotUrl(hotUrl) {
  try {
    const cache = await caches.open(HOT_CACHE)
    await cache.delete(new Request(hotUrl))
  } catch {
    // ignore
  }
  mHotIndex.delete(hotUrl)
}

async function ensureHotQuota(nextSize) {
  let total = 0
  for (const meta of mHotIndex.values()) {
    total += meta.size
  }
  while (total + nextSize > HOT_QUOTA_BYTES && mHotIndex.size > 0) {
    let oldestUrl = ''
    let oldestAt = Infinity
    for (const [url, meta] of mHotIndex.entries()) {
      if (meta.at < oldestAt) {
        oldestAt = meta.at
        oldestUrl = url
      }
    }
    if (!oldestUrl) {
      break
    }
    const meta = mHotIndex.get(oldestUrl)
    total -= meta ? meta.size : 0
    await evictHotUrl(oldestUrl)
  }
}

/**
 * @param {string} sessionId
 * @param {string} method
 * @param {string} url
 * @param {Response} res
 * @returns {Promise<boolean>}
 */
export async function putHot(sessionId, method, url, res) {
  const size = await responseByteLength(res)
  if (!shouldStoreBody(size)) {
    return false
  }
  const hotUrl = hotRequestUrl(sessionId, method, url)
  try {
    await ensureHotQuota(size)
    const cache = await caches.open(HOT_CACHE)
    await cache.put(new Request(hotUrl), res.clone())
    mHotIndex.set(hotUrl, { size, at: Date.now() })
    return true
  } catch (err) {
    console.warn('[vc] hot put fail:', err)
    return false
  }
}

/**
 * @param {string} sessionId
 * @param {string} method
 * @param {string} url
 * @param {string=} legacyDevtoolsId
 * @returns {Promise<Response|null>}
 */
export async function getHot(sessionId, method, url, legacyDevtoolsId) {
  try {
    const hotUrl = hotRequestUrl(sessionId, method, url)
    const cache = await caches.open(HOT_CACHE)
    let res = await cache.match(new Request(hotUrl))
    if (!res && legacyDevtoolsId) {
      const legacyUrl = hotRequestUrlLegacy(sessionId, legacyDevtoolsId, method, url)
      res = await cache.match(new Request(legacyUrl))
      if (res) {
        // Migrate to session-scoped key for subsequent hits.
        try {
          const size = await responseByteLength(res)
          if (shouldStoreBody(size)) {
            await ensureHotQuota(size)
            await cache.put(new Request(hotUrl), res.clone())
            mHotIndex.set(hotUrl, { size, at: Date.now() })
            await cache.delete(new Request(legacyUrl))
            mHotIndex.delete(legacyUrl)
          }
        } catch {
          // ignore migrate failures; still return legacy hit
        }
      }
    }
    if (res) {
      const meta = mHotIndex.get(hotUrl)
      if (meta) {
        meta.at = Date.now()
      }
    }
    return res
  } catch (err) {
    console.warn('[vc] hot get fail:', err)
    return null
  }
}

/**
 * @param {string} sessionId
 * @param {string} method
 * @param {string} url
 * @returns {Promise<boolean>}
 */
export async function hasHot(sessionId, method, url) {
  try {
    const hotUrl = hotRequestUrl(sessionId, method, url)
    const cache = await caches.open(HOT_CACHE)
    const res = await cache.match(new Request(hotUrl))
    return !!res
  } catch {
    return false
  }
}

/**
 * @param {string} sessionId
 */
export async function destroySessionCaches(sessionId) {
  const prefixArchive = `${VC_ORIGIN}/archive/${encodeURIComponent(sessionId)}/`
  const prefixHot = `${VC_ORIGIN}/hot/${encodeURIComponent(sessionId)}/`

  for (const clientId of [...mClientOpts.keys()]) {
    const rec = mClientOpts.get(clientId)
    if (rec && rec.sessionId === sessionId) {
      mClientOpts.delete(clientId)
    }
  }
  mSessionFallback.delete(sessionId)

  for (const name of [ARCHIVE_CACHE, HOT_CACHE]) {
    try {
      const cache = await caches.open(name)
      const keys = await cache.keys()
      for (const req of keys) {
        if (req.url.startsWith(prefixArchive) || req.url.startsWith(prefixHot)) {
          await cache.delete(req)
        }
      }
    } catch (err) {
      console.warn('[vc] destroy session cache fail:', err)
    }
  }

  for (const url of [...mHotIndex.keys()]) {
    if (url.startsWith(prefixHot)) {
      mHotIndex.delete(url)
    }
  }
}

/**
 * @param {Headers} headers
 * @returns {Record<string, string>}
 */
export function headersToObject(headers) {
  /** @type {Record<string, string>} */
  const obj = {}
  headers.forEach((val, key) => {
    obj[key] = val
  })
  return obj
}

/**
 * Wrap a body stream: count bytes, optionally accumulate for archive/hot storage.
 *
 * @param {ReadableStream|null|undefined} body
 * @param {(size: number, chunks: Uint8Array[]) => void} onComplete
 * @returns {ReadableStream|null|undefined}
 */
export function tapBodyCapture(body, onComplete) {
  if (!body) {
    onComplete(0, [])
    return body
  }

  /** @type {Uint8Array[]} */
  const chunks = []
  let size = 0
  let reported = false

  const report = () => {
    if (reported) {
      return
    }
    reported = true
    try {
      onComplete(size, chunks)
    } catch {
      // ignore
    }
  }

  const reader = body.getReader()
  return new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read()
        if (done) {
          report()
          controller.close()
          return
        }
        if (value) {
          size += value.byteLength
          chunks.push(value)
        }
        controller.enqueue(value)
      } catch (err) {
        report()
        controller.error(err)
      }
    },
    cancel(reason) {
      report()
      return reader.cancel(reason)
    },
  })
}

/**
 * @param {ResponseInit} resOpt
 * @param {Uint8Array[]} chunks
 * @returns {Response}
 */
export function responseFromChunks(resOpt, chunks) {
  const body = util.concatBufs(chunks)
  return new Response(body, resOpt)
}

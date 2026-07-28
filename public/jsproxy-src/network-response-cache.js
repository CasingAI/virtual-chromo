import * as util from './util.js'
import * as httpCache from './http-cache-policy.js'

const ARCHIVE_CACHE = 'vc-net-archive'
const HOT_CACHE = 'vc-net-hot'
const VC_ORIGIN = 'https://__vc__'

const HDR_STORED_AT = 'x-vc-hot-stored-at'
const HDR_EXPIRES_AT = 'x-vc-hot-expires-at'
const HDR_METHOD = 'x-vc-hot-method'
const HDR_URL = 'x-vc-hot-url'

/**
 * Max bytes streamed from archive for DevTools Response/Preview.
 * @type {number}
 */
export const BODY_DISPLAY_MAX_BYTES = 64 * 1024

/** @deprecated Use BODY_DISPLAY_MAX_BYTES. */
export const MAX_BODY_BYTES = BODY_DISPLAY_MAX_BYTES

/** Hot cache soft quota (bytes). */
const HOT_QUOTA_BYTES = 50 * 1024 * 1024

/** Max lines returned per VC_NETWORK_BODY_READ_LINES request. */
export const MAX_LINES_PER_REQUEST = 500

/** Max decoded characters per line (postMessage safety). */
export const MAX_LINE_CHARS = 65536

/** Soft UTF-16 char budget per lines response payload. */
const MAX_RESPONSE_CHARS_SOFT = 512 * 1024

/** In-memory text line index LRU capacity. */
const TEXT_LINE_INDEX_LRU = 32

/** Sample size for application/octet-stream text heuristic. */
const OCTET_STREAM_TEXT_PROBE_BYTES = 8 * 1024

/**
 * @typedef {{
 *   totalLines: number,
 *   lineStarts: number[],
 *   bodyBytes: Uint8Array,
 *   charset?: string,
 *   contentType?: string,
 *   headers: Record<string, string>,
 *   status: number,
 *   at: number,
 * }} TextLineIndex
 */

/** @type {Map<string, TextLineIndex>} */
const mTextLineIndex = new Map()

/**
 * @param {string} entryId
 */
function textLineIndexKey(entryId) {
  return entryId
}

/**
 * @param {string} key
 * @param {TextLineIndex} index
 */
function touchTextLineIndex(key, index) {
  mTextLineIndex.delete(key)
  index.at = Date.now()
  mTextLineIndex.set(key, index)
  while (mTextLineIndex.size > TEXT_LINE_INDEX_LRU) {
    const oldestKey = mTextLineIndex.keys().next().value
    if (oldestKey) {
      mTextLineIndex.delete(oldestKey)
    } else {
      break
    }
  }
}

/**
 * @param {string} entryId
 */
export function dropTextLineIndex(entryId) {
  mTextLineIndex.delete(textLineIndexKey(entryId))
}

export function clearTextLineIndexes() {
  mTextLineIndex.clear()
}

/**
 * @param {Headers|Record<string, string>} headers
 * @returns {{ contentType?: string, charset?: string }}
 */
export function parseContentTypeMeta(headers) {
  let ctVal = ''
  if (headers && typeof headers.forEach === 'function') {
    headers.forEach((val, key) => {
      if (key.toLowerCase() === 'content-type') {
        ctVal = val
      }
    })
  } else if (headers && typeof headers === 'object') {
    for (const [key, val] of Object.entries(headers)) {
      if (key.toLowerCase() === 'content-type' && typeof val === 'string') {
        ctVal = val
      }
    }
  }
  const match = ctVal.toLocaleLowerCase().match(/([^;]*)(?:.*?charset=['"]?([^'";]+))?/)
  const contentType = match && match[1] ? match[1].trim() : undefined
  const charset = match && match[2] ? match[2].trim() : undefined
  return { contentType, charset }
}

/**
 * @param {string|undefined} contentType
 */
export function isTextLikeContentType(contentType) {
  if (!contentType) {
    return true
  }
  const mime = contentType.toLocaleLowerCase().trim()
  if (mime.startsWith('text/')) {
    return true
  }
  if (
    mime === 'application/json' ||
    mime === 'application/javascript' ||
    mime === 'application/x-javascript' ||
    mime === 'application/xml' ||
    mime === 'application/xhtml+xml' ||
    mime === 'image/svg+xml'
  ) {
    return true
  }
  if (mime === 'application/octet-stream') {
    return null
  }
  return false
}

/**
 * @param {Uint8Array} sample
 */
function isUtf8TextSample(sample) {
  if (!sample || !sample.byteLength) {
    return true
  }
  for (let i = 0; i < sample.byteLength; i++) {
    if (sample[i] === 0) {
      return false
    }
  }
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(sample)
    return true
  } catch {
    return false
  }
}

/**
 * @param {Response} res
 * @returns {Promise<boolean>}
 */
export async function isTextLikeResponse(res) {
  const { contentType } = parseContentTypeMeta(res.headers)
  const verdict = isTextLikeContentType(contentType)
  if (verdict === true) {
    return true
  }
  if (verdict === false) {
    return false
  }
  if (!res.body) {
    return true
  }
  const reader = res.clone().body.getReader()
  /** @type {Uint8Array[]} */
  const chunks = []
  let bytesRead = 0
  try {
    while (bytesRead < OCTET_STREAM_TEXT_PROBE_BYTES) {
      const { done, value } = await reader.read()
      if (done || !value || !value.byteLength) {
        break
      }
      const remaining = OCTET_STREAM_TEXT_PROBE_BYTES - bytesRead
      if (value.byteLength <= remaining) {
        chunks.push(value)
        bytesRead += value.byteLength
      } else {
        chunks.push(value.subarray(0, remaining))
        bytesRead += remaining
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
  return isUtf8TextSample(merged)
}

/**
 * @param {Response} res
 * @returns {Promise<TextLineIndex>}
 */
export async function buildTextLineIndex(res) {
  const headers = headersToObject(res.headers)
  const status = res.status
  const { contentType, charset } = parseContentTypeMeta(res.headers)
  const decoderCharset = charset || 'utf-8'

  /** @type {Uint8Array[]} */
  const chunks = []
  let totalBytes = 0

  if (res.body) {
    const reader = res.body.getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          break
        }
        if (value && value.byteLength) {
          chunks.push(value)
          totalBytes += value.byteLength
        }
      }
    } finally {
      try {
        await reader.cancel()
      } catch {
        // ignore
      }
    }
  }

  const bodyBytes = util.concatBufs(chunks)
  /** @type {number[]} */
  const lineStarts = [0]
  for (let i = 0; i < bodyBytes.byteLength; i++) {
    if (bodyBytes[i] === 0x0a) {
      lineStarts.push(i + 1)
    }
  }

  return {
    totalLines: Math.max(1, lineStarts.length),
    lineStarts,
    bodyBytes,
    charset: decoderCharset,
    contentType,
    headers,
    status,
    at: Date.now(),
  }
}

/**
 * @param {TextLineIndex} index
 * @param {number} fromLine
 * @param {number} toLine
 * @param {boolean} metaOnly
 * @returns {{ lines: string[], fromLine: number, toLine: number, rangeClamped: boolean }}
 */
export function readTextLineRange(index, fromLine, toLine, metaOnly) {
  const totalLines = index.totalLines
  let rangeClamped = false
  let startLine = typeof fromLine === 'number' && Number.isFinite(fromLine) ? Math.floor(fromLine) : 0
  let endLine = typeof toLine === 'number' && Number.isFinite(toLine)
    ? Math.floor(toLine)
    : Math.min(startLine + MAX_LINES_PER_REQUEST, totalLines)

  if (startLine < 0) {
    startLine = 0
    rangeClamped = true
  }
  if (startLine >= totalLines) {
    startLine = totalLines
    endLine = totalLines
  }
  if (endLine <= startLine && !metaOnly) {
    return { lines: [], fromLine: startLine, toLine: startLine, rangeClamped }
  }
  if (endLine > totalLines) {
    endLine = totalLines
    rangeClamped = true
  }
  if (endLine - startLine > MAX_LINES_PER_REQUEST) {
    endLine = startLine + MAX_LINES_PER_REQUEST
    rangeClamped = true
  }

  if (metaOnly) {
    return { lines: [], fromLine: startLine, toLine: endLine, rangeClamped }
  }

  const decoder = new TextDecoder(index.charset || 'utf-8', { fatal: false })
  /** @type {string[]} */
  const lines = []
  let charBudget = MAX_RESPONSE_CHARS_SOFT

  for (let lineNo = startLine; lineNo < endLine; lineNo++) {
    const startByte = index.lineStarts[lineNo] ?? 0
    let endByte = lineNo + 1 < index.lineStarts.length
      ? index.lineStarts[lineNo + 1] - 1
      : index.bodyBytes.byteLength
    if (endByte > startByte && index.bodyBytes[endByte - 1] === 0x0d) {
      endByte -= 1
    }
    let text = endByte > startByte
      ? decoder.decode(index.bodyBytes.subarray(startByte, endByte))
      : ''
    if (text.length > MAX_LINE_CHARS) {
      text = text.slice(0, MAX_LINE_CHARS)
      rangeClamped = true
    }
    charBudget -= text.length
    if (charBudget < 0) {
      rangeClamped = true
      break
    }
    lines.push(text)
  }

  const actualEndLine = startLine + lines.length
  if (actualEndLine < endLine) {
    rangeClamped = true
  }

  return {
    lines,
    fromLine: startLine,
    toLine: actualEndLine,
    rangeClamped,
  }
}

/**
 * @param {string} entryId
 * @param {Response} res
 * @returns {Promise<TextLineIndex>}
 */
export async function getOrBuildTextLineIndex(entryId, res) {
  const key = textLineIndexKey(entryId)
  const cached = mTextLineIndex.get(key)
  if (cached) {
    touchTextLineIndex(key, cached)
    return cached
  }
  const index = await buildTextLineIndex(res.clone())
  touchTextLineIndex(key, index)
  return index
}

/**
 * @typedef {{ devtoolsId: string, disableCache: boolean, at: number }} DevtoolsOpts
 */

/** @type {Map<string, DevtoolsOpts>} */
const mClientOpts = new Map()

/** @type {DevtoolsOpts|null} */
let mGlobalOpts = null

/** @type {Map<string, { size: number, at: number, expiresAt: number, method?: string, url?: string }>} */
const mHotIndex = new Map()

/**
 * @param {string} entryId
 */
export function archiveRequestUrl(entryId) {
  return `${VC_ORIGIN}/archive/${encodeURIComponent(entryId)}`
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
 * Global hot cache key: method + url (no session).
 * @param {string} method
 * @param {string} url
 */
export function hotRequestUrl(method, url) {
  const normalized = normalizeHotUrl(url)
  const hash = util.strHash(`${method}\0${normalized}`)
  const hashHex = util.numToHex(hash, 8)
  return `${VC_ORIGIN}/hot/${hashHex}`
}

/**
 * Legacy session-scoped hot key (migration reads only).
 * @param {string} sessionId
 * @param {string} method
 * @param {string} url
 */
export function hotRequestUrlLegacy(sessionId, method, url) {
  const normalized = normalizeHotUrl(url)
  const hash = util.strHash(`${method}\0${normalized}`)
  const hashHex = util.numToHex(hash, 8)
  return `${VC_ORIGIN}/hot/${encodeURIComponent(sessionId)}/${hashHex}`
}

/**
 * Legacy hot key that included devtoolsId.
 * @param {string} sessionId
 * @param {string} devtoolsId
 * @param {string} method
 * @param {string} url
 */
export function hotRequestUrlLegacyDevtools(sessionId, devtoolsId, method, url) {
  const normalized = normalizeHotUrl(url)
  const hash = util.strHash(`${method}\0${normalized}`)
  const hashHex = util.numToHex(hash, 8)
  return `${VC_ORIGIN}/hot/${encodeURIComponent(sessionId)}/${encodeURIComponent(devtoolsId)}/${hashHex}`
}

/**
 * @param {string} clientId
 * @param {{ devtoolsId: string, disableCache?: boolean }} opts
 */
export function registerClientOpts(clientId, opts) {
  if (!clientId || !opts.devtoolsId) {
    return
  }
  const rec = {
    devtoolsId: opts.devtoolsId,
    disableCache: !!opts.disableCache,
    at: Date.now(),
  }
  mClientOpts.set(clientId, rec)
  mGlobalOpts = rec
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
        at: Date.now(),
      })
      mGlobalOpts = mClientOpts.get(clientId) || mGlobalOpts
      return
    }
  }
}

/**
 * @param {string} clientId
 * @returns {DevtoolsOpts|null}
 */
export function resolveContext(clientId) {
  if (clientId && mClientOpts.has(clientId)) {
    return mClientOpts.get(clientId) || null
  }
  if (mGlobalOpts) {
    if (clientId) {
      mClientOpts.set(clientId, {
        devtoolsId: mGlobalOpts.devtoolsId,
        disableCache: mGlobalOpts.disableCache,
        at: Date.now(),
      })
    }
    return mGlobalOpts
  }
  const provisional = {
    devtoolsId: 'global',
    disableCache: false,
    at: Date.now(),
  }
  mGlobalOpts = provisional
  if (clientId) {
    mClientOpts.set(clientId, provisional)
  }
  return provisional
}

/**
 * @param {number} size
 */
export function shouldStoreBody(size) {
  return typeof size === 'number' && size >= 0 && Number.isFinite(size)
}

/**
 * @param {Response} res
 * @returns {Promise<number>}
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
 * @param {Response} res
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
 * @param {string} entryId
 * @param {Response} res
 * @returns {Promise<boolean>}
 */
export async function putArchive(entryId, res) {
  try {
    const cache = await caches.open(ARCHIVE_CACHE)
    const req = new Request(archiveRequestUrl(entryId))
    await cache.put(req, res.clone())
    return true
  } catch (err) {
    console.warn('[vc] archive put fail:', err)
    return false
  }
}

/**
 * @param {string} entryId
 * @returns {Promise<Response|null>}
 */
export async function getArchive(entryId) {
  try {
    const cache = await caches.open(ARCHIVE_CACHE)
    const req = new Request(archiveRequestUrl(entryId))
    return await cache.match(req)
  } catch (err) {
    console.warn('[vc] archive get fail:', err)
    return null
  }
}

/**
 * @param {string} entryId
 */
export async function dropArchive(entryId) {
  try {
    dropTextLineIndex(entryId)
    const cache = await caches.open(ARCHIVE_CACHE)
    await cache.delete(new Request(archiveRequestUrl(entryId)))
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
 * Strip internal hot metadata headers before returning to content.
 * @param {Response} res
 * @returns {Response}
 */
function stripHotMeta(res) {
  const headers = new Headers(res.headers)
  headers.delete(HDR_STORED_AT)
  headers.delete(HDR_EXPIRES_AT)
  headers.delete(HDR_METHOD)
  headers.delete(HDR_URL)
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  })
}

/**
 * @param {Response} res
 * @returns {{ storedAt: number, expiresAt: number, method: string, url: string }}
 */
function readHotMeta(res) {
  const storedAt = parseInt(res.headers.get(HDR_STORED_AT) || '', 10)
  const expiresAt = parseInt(res.headers.get(HDR_EXPIRES_AT) || '', 10)
  const method = (res.headers.get(HDR_METHOD) || '').trim()
  const url = (res.headers.get(HDR_URL) || '').trim()
  return {
    storedAt: Number.isFinite(storedAt) ? storedAt : 0,
    expiresAt: Number.isFinite(expiresAt) ? expiresAt : 0,
    method,
    url,
  }
}

/**
 * @param {string} origin
 * @param {string} entryUrl
 */
function hotUrlMatchesOrigin(origin, entryUrl) {
  if (!origin || !entryUrl) {
    return false
  }
  try {
    return new URL(entryUrl).origin === origin
  } catch {
    return false
  }
}

/**
 * @param {string} method
 * @param {string} url
 * @param {Response} res
 * @param {{ reqHeaders?: Headers|Record<string, string> }=} opts
 * @returns {Promise<boolean>}
 */
export async function putHot(method, url, res, opts) {
  const reqHeaders = opts && opts.reqHeaders
  const check = httpCache.isCacheable(method, res.status, reqHeaders, res.headers)
  if (!check.ok) {
    return false
  }
  const size = await responseByteLength(res)
  if (!shouldStoreBody(size)) {
    return false
  }
  const storedAt = Date.now()
  const expiresAt = httpCache.computeExpiresAt(res.headers, storedAt, url)
  if (!httpCache.isFresh(expiresAt, storedAt + 1)) {
    return false
  }
  const hotUrl = hotRequestUrl(method, url)
  try {
    await ensureHotQuota(size)
    const headers = new Headers(res.headers)
    headers.set(HDR_STORED_AT, String(storedAt))
    headers.set(HDR_EXPIRES_AT, String(expiresAt))
    headers.set(HDR_METHOD, String(method || 'GET').toUpperCase())
    headers.set(HDR_URL, String(url || ''))
    const toStore = new Response(res.clone().body, {
      status: res.status,
      statusText: res.statusText,
      headers,
    })
    const cache = await caches.open(HOT_CACHE)
    await cache.put(new Request(hotUrl), toStore)
    mHotIndex.set(hotUrl, { size, at: storedAt, expiresAt, method: String(method || 'GET').toUpperCase(), url: String(url || '') })
    return true
  } catch (err) {
    console.warn('[vc] hot put fail:', err)
    return false
  }
}

/**
 * @param {string} method
 * @param {string} url
 * @param {{ legacySessionId?: string, legacyDevtoolsId?: string }=} migrate
 * @returns {Promise<Response|null>}
 */
export async function getHot(method, url, migrate) {
  try {
    const hotUrl = hotRequestUrl(method, url)
    const cache = await caches.open(HOT_CACHE)
    let res = await cache.match(new Request(hotUrl))

    if (!res && migrate && migrate.legacySessionId) {
      const legacyUrl = hotRequestUrlLegacy(migrate.legacySessionId, method, url)
      res = await cache.match(new Request(legacyUrl))
      if (!res && migrate.legacyDevtoolsId) {
        const legacyDev = hotRequestUrlLegacyDevtools(
          migrate.legacySessionId,
          migrate.legacyDevtoolsId,
          method,
          url,
        )
        res = await cache.match(new Request(legacyDev))
        if (res) {
          await cache.delete(new Request(legacyDev))
        }
      }
      if (res) {
        try {
          const size = await responseByteLength(res)
          if (shouldStoreBody(size)) {
            await ensureHotQuota(size)
            const meta = readHotMeta(res)
            const storedAt = meta.storedAt || Date.now()
            const expiresAt =
              meta.expiresAt ||
              httpCache.computeExpiresAt(res.headers, storedAt, url)
            const headers = new Headers(res.headers)
            headers.set(HDR_STORED_AT, String(storedAt))
            headers.set(HDR_EXPIRES_AT, String(expiresAt))
            headers.set(HDR_METHOD, String(method || 'GET').toUpperCase())
            headers.set(HDR_URL, String(url || ''))
            await cache.put(
              new Request(hotUrl),
              new Response(res.clone().body, {
                status: res.status,
                statusText: res.statusText,
                headers,
              }),
            )
            mHotIndex.set(hotUrl, {
              size,
              at: storedAt,
              expiresAt,
              method: String(method || 'GET').toUpperCase(),
              url: String(url || ''),
            })
            await cache.delete(new Request(legacyUrl))
            mHotIndex.delete(legacyUrl)
            res = await cache.match(new Request(hotUrl))
          }
        } catch {
          // ignore migrate failures
        }
      }
    }

    if (!res) {
      return null
    }

    const meta = readHotMeta(res)
    let expiresAt = meta.expiresAt
    if (!expiresAt) {
      expiresAt = httpCache.computeExpiresAt(res.headers, meta.storedAt || Date.now(), url)
    }
    if (!httpCache.isFresh(expiresAt)) {
      await evictHotUrl(hotUrl)
      return null
    }

    const indexed = mHotIndex.get(hotUrl)
    if (indexed) {
      indexed.at = Date.now()
      indexed.expiresAt = expiresAt
    }

    return stripHotMeta(res)
  } catch (err) {
    console.warn('[vc] hot get fail:', err)
    return null
  }
}

/**
 * @param {string} method
 * @param {string} url
 * @returns {Promise<{ exists: boolean, fresh: boolean, expiresAt?: number }>}
 */
export async function probeHot(method, url) {
  try {
    const hotUrl = hotRequestUrl(method, url)
    const cache = await caches.open(HOT_CACHE)
    const res = await cache.match(new Request(hotUrl))
    if (!res) {
      return { exists: false, fresh: false }
    }
    const meta = readHotMeta(res)
    const expiresAt =
      meta.expiresAt ||
      httpCache.computeExpiresAt(res.headers, meta.storedAt || Date.now(), url)
    const fresh = httpCache.isFresh(expiresAt)
    if (!fresh) {
      await evictHotUrl(hotUrl)
      return { exists: false, fresh: false, expiresAt }
    }
    return { exists: true, fresh: true, expiresAt }
  } catch {
    return { exists: false, fresh: false }
  }
}

/**
 * @param {string} method
 * @param {string} url
 * @returns {Promise<boolean>}
 */
export async function hasHot(method, url) {
  const r = await probeHot(method, url)
  return r.exists && r.fresh
}

/**
 * Rebuild mHotIndex from Cache Storage and drop expired entries.
 */
export async function rebuildHotIndex() {
  mHotIndex.clear()
  try {
    const cache = await caches.open(HOT_CACHE)
    const keys = await cache.keys()
    for (const req of keys) {
      const res = await cache.match(req)
      if (!res) {
        continue
      }
      const meta = readHotMeta(res)
      const expiresAt = meta.expiresAt || 0
      if (expiresAt && !httpCache.isFresh(expiresAt)) {
        await cache.delete(req)
        continue
      }
      const size = await responseByteLength(res)
      if (!shouldStoreBody(size)) {
        continue
      }
      mHotIndex.set(req.url, {
        size,
        at: meta.storedAt || Date.now(),
        expiresAt: expiresAt || Date.now() + HEURISTIC_FALLBACK,
        method: meta.method || '',
        url: meta.url || '',
      })
    }
  } catch (err) {
    console.warn('[vc] rebuild hot index fail:', err)
  }
}

const HEURISTIC_FALLBACK = 5 * 60 * 1000

/**
 * Clear all archive + hot network caches.
 */
export async function clearAllNetworkCaches() {
  mClientOpts.clear()
  mGlobalOpts = null
  mHotIndex.clear()
  clearTextLineIndexes()
  for (const name of [ARCHIVE_CACHE, HOT_CACHE]) {
    try {
      await caches.delete(name)
    } catch (err) {
      console.warn('[vc] clear network cache fail:', err)
    }
  }
}

/**
 * Clear hot cache entries whose stored URL matches origin. Origin is required.
 * @param {string} origin
 */
export async function clearHotByOrigin(origin) {
  const trimmed = typeof origin === 'string' ? origin.trim() : ''
  if (!trimmed) {
    throw Object.assign(new Error('origin required'), { code: 'ORIGIN_REQUIRED' })
  }
  await rebuildHotIndex()
  try {
    const cache = await caches.open(HOT_CACHE)
    const keys = await cache.keys()
    for (const req of keys) {
      const indexed = mHotIndex.get(req.url)
      let entryUrl = indexed && indexed.url ? indexed.url : ''
      if (!entryUrl) {
        const res = await cache.match(req)
        if (res) {
          entryUrl = readHotMeta(res).url || ''
        }
      }
      if (hotUrlMatchesOrigin(trimmed, entryUrl)) {
        await evictHotUrl(req.url)
      }
    }
  } catch (err) {
    console.warn('[vc] clear hot by origin fail:', err)
    throw err
  }
}

/**
 * Clear an entire network-cache layer (or all). Does not accept origin scoping.
 * @param {'hot'|'archive'|'all'} layer
 */
export async function clearNetworkCacheLayer(layer) {
  if (layer === 'all') {
    await clearAllNetworkCaches()
    return
  }
  if (layer === 'hot') {
    mHotIndex.clear()
    try {
      await caches.delete(HOT_CACHE)
    } catch (err) {
      console.warn('[vc] clear hot cache fail:', err)
    }
    return
  }
  if (layer === 'archive') {
    clearTextLineIndexes()
    try {
      await caches.delete(ARCHIVE_CACHE)
    } catch (err) {
      console.warn('[vc] clear archive cache fail:', err)
    }
  }
}

/**
 * @returns {Promise<{
 *   hot: { entries: number, bytes: number },
 *   archive: { entries: number, bytes: number }
 * }>}
 */
export async function getNetworkCacheStats() {
  await rebuildHotIndex()
  let hotBytes = 0
  for (const meta of mHotIndex.values()) {
    hotBytes += meta.size || 0
  }
  let archiveEntries = 0
  let archiveBytes = 0
  try {
    const cache = await caches.open(ARCHIVE_CACHE)
    const keys = await cache.keys()
    archiveEntries = keys.length
    for (const req of keys) {
      const res = await cache.match(req)
      if (res) {
        archiveBytes += await responseByteLength(res)
      }
    }
  } catch (err) {
    console.warn('[vc] archive stats fail:', err)
  }
  return {
    hot: { entries: mHotIndex.size, bytes: hotBytes },
    archive: { entries: archiveEntries, bytes: archiveBytes },
  }
}

/**
 * @param {'hot'|'archive'} layer
 * @param {number} [limit]
 * @returns {Promise<object[]>}
 */
export async function listNetworkCache(layer, limit = 200) {
  const max = Math.max(1, Math.min(1000, limit | 0 || 200))
  if (layer === 'hot') {
    await rebuildHotIndex()
    /** @type {{ key: string, size: number, storedAt: number, expiresAt: number, fresh: boolean, method?: string, url?: string }[]} */
    const rows = []
    try {
      const cache = await caches.open(HOT_CACHE)
      const keys = await cache.keys()
      for (const req of keys) {
        if (rows.length >= max) {
          break
        }
        const meta = mHotIndex.get(req.url)
        const expiresAt = meta?.expiresAt || 0
        let method = meta?.method || ''
        let url = meta?.url || ''
        if (!method || !url) {
          const res = await cache.match(req)
          if (res) {
            const hdr = readHotMeta(res)
            method = method || hdr.method || ''
            url = url || hdr.url || ''
          }
        }
        rows.push({
          key: req.url,
          size: meta?.size || 0,
          storedAt: meta?.at || 0,
          expiresAt,
          fresh: expiresAt ? httpCache.isFresh(expiresAt) : false,
          method: method || undefined,
          url: url || undefined,
        })
      }
    } catch (err) {
      console.warn('[vc] list hot fail:', err)
    }
    return rows
  }

  /** @type {{ key: string, entryId: string, size: number }[]} */
  const rows = []
  try {
    const cache = await caches.open(ARCHIVE_CACHE)
    const keys = await cache.keys()
    for (const req of keys) {
      if (rows.length >= max) {
        break
      }
      const m = /\/archive\/([^/?#]+)/.exec(req.url)
      const entryId = m ? decodeURIComponent(m[1]) : ''
      const res = await cache.match(req)
      const size = res ? await responseByteLength(res) : 0
      rows.push({ key: req.url, entryId, size })
    }
  } catch (err) {
    console.warn('[vc] list archive fail:', err)
  }
  return rows
}

/**
 * @deprecated use clearAllNetworkCaches
 * @param {string=} _sessionId
 */
export async function destroySessionCaches(_sessionId) {
  await clearAllNetworkCaches()
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

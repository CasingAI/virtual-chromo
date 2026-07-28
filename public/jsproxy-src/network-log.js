/** @type {((entry: object) => void) | null} */
let emitter = null

/** Soft limit for serialized request headers (bytes of JSON). */
const MAX_REQUEST_HEADERS_BYTES = 32 * 1024

/**
 * @param {(entry: object) => void} fn
 */
export function setEmitter(fn) {
  emitter = fn
}

export function makeId() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch {
    // ignore
  }
  return String(Date.now()) + '-' + Math.random().toString(16).slice(2)
}

/**
 * @param {Headers|null|undefined} headers
 * @returns {{ headers: Record<string, string>, truncated: boolean }}
 */
export function extractRequestHeaders(headers) {
  /** @type {Record<string, string>} */
  const obj = {}
  if (!headers || typeof headers.forEach !== 'function') {
    return { headers: obj, truncated: false }
  }
  headers.forEach((val, key) => {
    obj[key] = val
  })
  try {
    const json = JSON.stringify(obj)
    if (json.length <= MAX_REQUEST_HEADERS_BYTES) {
      return { headers: obj, truncated: false }
    }
    /** @type {Record<string, string>} */
    const trimmed = {}
    let size = 2
    for (const [key, val] of Object.entries(obj)) {
      const piece = JSON.stringify(key) + ':' + JSON.stringify(val) + ','
      if (size + piece.length > MAX_REQUEST_HEADERS_BYTES) {
        return { headers: trimmed, truncated: true }
      }
      trimmed[key] = val
      size += piece.length
    }
    return { headers: trimmed, truncated: true }
  } catch {
    return { headers: obj, truncated: false }
  }
}

/**
 * @param {number} queuedAt
 * @param {{ startedAt?: number, responseAt?: number, finishedAt?: number }} [marks]
 */
export function buildTiming(queuedAt, marks) {
  const startedAt = marks && typeof marks.startedAt === 'number' ? marks.startedAt : undefined
  const responseAt = marks && typeof marks.responseAt === 'number' ? marks.responseAt : undefined
  const finishedAt = marks && typeof marks.finishedAt === 'number' ? marks.finishedAt : undefined
  /** @type {Record<string, number>} */
  const timing = { queuedAt }
  if (startedAt !== undefined) {
    timing.startedAt = startedAt
    timing.queueing = Math.max(0, startedAt - queuedAt)
  }
  if (responseAt !== undefined) {
    timing.responseAt = responseAt
    if (startedAt !== undefined) {
      timing.waiting = Math.max(0, responseAt - startedAt)
    }
  }
  if (finishedAt !== undefined) {
    timing.finishedAt = finishedAt
    if (responseAt !== undefined) {
      timing.download = Math.max(0, finishedAt - responseAt)
    } else if (startedAt !== undefined) {
      timing.download = Math.max(0, finishedAt - startedAt)
    }
  }
  return timing
}

/**
 * Wrap a body stream and count transferred bytes.
 * Calls onSize once when the stream completes or is cancelled.
 *
 * @param {ReadableStream|null|undefined} body
 * @param {(size: number) => void} onSize
 * @returns {ReadableStream|null}
 */
export function tapBodySize(body, onSize) {
  if (!body) {
    try {
      onSize(0)
    } catch {
      // ignore
    }
    return null
  }

  let size = 0
  let reported = false
  const report = () => {
    if (reported) {
      return
    }
    reported = true
    try {
      onSize(size)
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
 * @param {Request} req
 * @param {URL} urlObj
 * @param {Response|null|undefined} res
 * @param {number} startMs
 * @param {{
 *   failed?: boolean,
 *   bypass?: boolean,
 *   pending?: boolean,
 *   id?: string,
 *   sessionId?: string,
 *   size?: number,
 *   hasBody?: boolean,
 *   fromCache?: boolean,
 *   devtoolsId?: string,
 *   timing?: object,
 *   requestHeaders?: Record<string, string>,
 *   requestHeadersTruncated?: boolean,
 *   referrer?: string,
 *   referrerPolicy?: string,
 *   source?: string,
 *   sourceHost?: string,
 *   errorCode?: string,
 *   errorText?: string,
 * }} [meta]
 */
export function record(req, urlObj, res, startMs, meta) {
  if (!emitter) {
    return
  }

  const pending = !!(meta && meta.pending)
  const status = res ? res.status || 0 : 0
  const size = meta && typeof meta.size === 'number' && meta.size >= 0 ? meta.size : 0

  const failed = !pending && ((meta && meta.failed) || !res || status >= 400)

  const hdr = extractRequestHeaders(req && req.headers)
  const requestHeaders =
    meta && meta.requestHeaders && typeof meta.requestHeaders === 'object'
      ? meta.requestHeaders
      : hdr.headers
  const requestHeadersTruncated =
    meta && typeof meta.requestHeadersTruncated === 'boolean'
      ? meta.requestHeadersTruncated
      : hdr.truncated

  const referrer =
    meta && typeof meta.referrer === 'string'
      ? meta.referrer
      : req && typeof req.referrer === 'string'
        ? req.referrer
        : ''
  const referrerPolicy =
    meta && typeof meta.referrerPolicy === 'string'
      ? meta.referrerPolicy
      : req && typeof req.referrerPolicy === 'string'
        ? req.referrerPolicy
        : ''

  const timing =
    meta && meta.timing && typeof meta.timing === 'object'
      ? meta.timing
      : buildTiming(startMs)

  let source = meta && typeof meta.source === 'string' ? meta.source : ''
  if (!source) {
    if (meta && meta.fromCache) {
      source = 'cache'
    } else if (meta && meta.bypass) {
      source = 'bypass'
    } else if (!pending) {
      source = 'proxy'
    }
  }
  const sourceHost =
    meta && typeof meta.sourceHost === 'string' ? meta.sourceHost : ''

  let errorCode =
    meta && typeof meta.errorCode === 'string' && meta.errorCode ? meta.errorCode : ''
  let errorText =
    meta && typeof meta.errorText === 'string' && meta.errorText ? meta.errorText : ''
  if (failed && !errorCode) {
    if (!res || status === 0) {
      errorCode = 'ERR_FAILED'
      errorText = errorText || 'Request failed'
    } else if (status >= 400) {
      errorCode = 'HTTP_' + status
      const statusText = res && typeof res.statusText === 'string' ? res.statusText : ''
      errorText = errorText || statusText || ('HTTP ' + status)
    }
  }

  emitter({
    id: (meta && meta.id) || makeId(),
    ts: startMs,
    method: req.method || 'GET',
    url: urlObj ? urlObj.href : '',
    status: pending ? 0 : status,
    type: req.destination || '',
    size: pending ? 0 : size,
    duration: Date.now() - startMs,
    failed: !!failed,
    bypass: !!(meta && meta.bypass),
    pending,
    sessionId: meta && meta.sessionId ? meta.sessionId : undefined,
    hasBody: !!(meta && meta.hasBody),
    fromCache: !!(meta && meta.fromCache),
    devtoolsId: meta && meta.devtoolsId ? meta.devtoolsId : undefined,
    requestHeaders,
    requestHeadersTruncated: !!requestHeadersTruncated,
    referrer,
    referrerPolicy,
    timing,
    source: source || undefined,
    sourceHost: sourceHost || undefined,
    errorCode: errorCode || undefined,
    errorText: errorText || undefined,
  })
}

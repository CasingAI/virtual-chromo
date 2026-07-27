/** @type {((entry: object) => void) | null} */
let emitter = null

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
  })
}

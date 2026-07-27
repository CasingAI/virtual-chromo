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
 * }} [meta]
 */
export function record(req, urlObj, res, startMs, meta) {
  if (!emitter) {
    return
  }

  const pending = !!(meta && meta.pending)
  const status = res ? res.status || 0 : 0
  let size = 0
  if (res && res.headers) {
    const cl = res.headers.get('content-length')
    if (cl) {
      const n = parseInt(cl, 10)
      if (!isNaN(n)) {
        size = n
      }
    }
  }

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

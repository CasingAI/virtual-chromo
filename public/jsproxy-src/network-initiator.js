/** Initiator tip cache + chain helpers for Network DevTools. */

const TIP_TTL_MS = 30 * 1000
const TIP_MAX = 200
const STACK_MAX_FRAMES = 20
const CHAIN_MAX_HOPS = 8

/** @type {Map<string, Map<string, object>>} sessionId → tipId → tip */
const tipsBySession = new Map()

/** @type {Map<string, Map<string, string>>} sessionId → tipId order (LRU) via insertion */
const tipOrderBySession = new Map()

/** @type {Map<string, Map<string, string>>} sessionId → resourceUrl → referrer */
const referrerBySession = new Map()

/** @type {Map<string, Map<string, string>>} sessionId → resourceUrl → latest tipId */
const tipIdByUrl = new Map()

/**
 * @param {string} sessionId
 * @returns {Map<string, object>}
 */
function tipsMap(sessionId) {
  const sid = sessionId || 'default'
  let m = tipsBySession.get(sid)
  if (!m) {
    m = new Map()
    tipsBySession.set(sid, m)
  }
  return m
}

/**
 * @param {string} sessionId
 * @returns {Map<string, string>}
 */
function referrerMap(sessionId) {
  const sid = sessionId || 'default'
  let m = referrerBySession.get(sid)
  if (!m) {
    m = new Map()
    referrerBySession.set(sid, m)
  }
  return m
}

/**
 * @param {string} sessionId
 * @returns {Map<string, string>}
 */
function urlTipMap(sessionId) {
  const sid = sessionId || 'default'
  let m = tipIdByUrl.get(sid)
  if (!m) {
    m = new Map()
    tipIdByUrl.set(sid, m)
  }
  return m
}

/**
 * @param {string} sessionId
 * @param {Map<string, object>} tips
 */
function evictIfNeeded(sessionId, tips) {
  while (tips.size > TIP_MAX) {
    const oldest = tips.keys().next().value
    if (oldest === undefined) {
      break
    }
    const old = tips.get(oldest)
    tips.delete(oldest)
    if (old && typeof old.url === 'string') {
      const byUrl = urlTipMap(sessionId)
      if (byUrl.get(old.url) === oldest) {
        byUrl.delete(old.url)
      }
    }
  }
}

/**
 * Drop expired tips for a session.
 * @param {string} sessionId
 * @param {Map<string, object>} tips
 */
function purgeExpired(sessionId, tips) {
  const now = Date.now()
  for (const [id, tip] of tips) {
    const ts = tip && typeof tip.ts === 'number' ? tip.ts : 0
    if (now - ts > TIP_TTL_MS) {
      tips.delete(id)
      if (tip && typeof tip.url === 'string') {
        const byUrl = urlTipMap(sessionId)
        if (byUrl.get(tip.url) === id) {
          byUrl.delete(tip.url)
        }
      }
    }
  }
}

/**
 * @param {string} sessionId
 * @param {object} tip
 */
export function registerTip(sessionId, tip) {
  if (!tip || typeof tip !== 'object') {
    return
  }
  const id = typeof tip.id === 'string' ? tip.id : ''
  if (!id) {
    return
  }
  const tips = tipsMap(sessionId)
  purgeExpired(sessionId, tips)
  const entry = {
    id,
    kind: typeof tip.kind === 'string' ? tip.kind : 'other',
    method: typeof tip.method === 'string' ? tip.method : 'GET',
    url: typeof tip.url === 'string' ? tip.url : '',
    stack: Array.isArray(tip.stack) ? tip.stack.slice(0, STACK_MAX_FRAMES) : [],
    scriptUrl: typeof tip.scriptUrl === 'string' ? tip.scriptUrl : '',
    ts: typeof tip.ts === 'number' ? tip.ts : Date.now(),
  }
  // Re-insert for LRU (delete then set keeps insertion order in Map)
  if (tips.has(id)) {
    tips.delete(id)
  }
  tips.set(id, entry)
  if (entry.url) {
    urlTipMap(sessionId).set(entry.url, id)
  }
  evictIfNeeded(sessionId, tips)
}

/**
 * @param {string} sessionId
 * @param {string} tipId
 * @returns {object|null}
 */
export function consumeTip(sessionId, tipId) {
  if (!tipId) {
    return null
  }
  const tips = tipsMap(sessionId)
  purgeExpired(sessionId, tips)
  const tip = tips.get(tipId)
  if (!tip) {
    return null
  }
  tips.delete(tipId)
  if (tip.url) {
    const byUrl = urlTipMap(sessionId)
    if (byUrl.get(tip.url) === tipId) {
      byUrl.delete(tip.url)
    }
  }
  return tip
}

/**
 * Fallback when no X-VC-Initiator-Id header (e.g. dynamic import()).
 * @param {string} sessionId
 * @param {string} url
 * @returns {object|null}
 */
export function consumeTipByUrl(sessionId, url) {
  if (!url) {
    return null
  }
  const tipId = urlTipMap(sessionId).get(url)
  if (!tipId) {
    return null
  }
  return consumeTip(sessionId, tipId)
}

/**
 * Remember referrer for a resource URL so Parser chains can walk upward.
 * @param {string} sessionId
 * @param {string} url
 * @param {string} referrer
 */
export function rememberReferrer(sessionId, url, referrer) {
  if (!url || !referrer || referrer === 'about:client' || referrer === url) {
    return
  }
  referrerMap(sessionId).set(url, referrer)
}

/**
 * @param {string} raw
 * @returns {string[]}
 */
export function sanitizeStack(raw) {
  if (!raw || typeof raw !== 'string') {
    return []
  }
  const lines = raw.split('\n')
  /** @type {string[]} */
  const out = []
  const skipRe =
    /(?:virtual-chromo|jsproxy|inject\.js|bundle\.built|__vcImport|network-initiator|chrome-extension:)/i
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim()
    if (!line || line.indexOf('Error') === 0) {
      continue
    }
    if (skipRe.test(line)) {
      continue
    }
    out.push(line)
    if (out.length >= STACK_MAX_FRAMES) {
      break
    }
  }
  return out
}

/**
 * Infer script URL from stack frames (first http(s) URL).
 * @param {string[]} frames
 * @returns {string}
 */
export function inferScriptUrl(frames) {
  if (!Array.isArray(frames)) {
    return ''
  }
  for (let i = 0; i < frames.length; i++) {
    const m = String(frames[i]).match(/https?:\/\/[^\s)\]]+/i)
    if (m) {
      return m[0].replace(/:\d+:\d+$/, '')
    }
  }
  return ''
}

/**
 * Dedup consecutive / exact duplicates while preserving order.
 * @param {string[]} urls
 * @returns {string[]}
 */
function dedupeChain(urls) {
  /** @type {string[]} */
  const out = []
  const seen = new Set()
  for (let i = 0; i < urls.length; i++) {
    const u = urls[i]
    if (!u || seen.has(u)) {
      continue
    }
    seen.add(u)
    out.push(u)
  }
  return out
}

/**
 * Walk known referrers upward from `referrer`, then append current url.
 * @param {{
 *   url: string,
 *   referrer?: string,
 *   pageUrl?: string,
 *   scriptUrl?: string,
 * }} opts
 * @returns {string[]}
 */
export function buildReferrerChain(opts) {
  const url = opts && opts.url ? opts.url : ''
  const pageUrl = opts && opts.pageUrl ? opts.pageUrl : ''
  const referrer = opts && opts.referrer && opts.referrer !== 'about:client' ? opts.referrer : ''
  const scriptUrl = opts && opts.scriptUrl ? opts.scriptUrl : ''
  const sessionId = opts && typeof opts.sessionId === 'string' ? opts.sessionId : ''
  const map = sessionId ? referrerMap(sessionId) : null

  /** @type {string[]} */
  const hops = []
  let cur = referrer || scriptUrl || ''
  let guard = 0
  while (cur && guard < CHAIN_MAX_HOPS) {
    hops.unshift(cur)
    const next = map ? map.get(cur) : ''
    if (!next || next === cur || hops.indexOf(next) >= 0) {
      break
    }
    cur = next
    guard++
  }

  /** @type {string[]} */
  const chain = []
  if (pageUrl) {
    chain.push(pageUrl)
  }
  for (let i = 0; i < hops.length; i++) {
    chain.push(hops[i])
  }
  if (scriptUrl && chain.indexOf(scriptUrl) < 0) {
    chain.push(scriptUrl)
  }
  if (url) {
    chain.push(url)
  }
  return dedupeChain(chain)
}

/**
 * Resolve initiator meta for a network record.
 * @param {{
 *   sessionId: string,
 *   tipId?: string,
 *   url: string,
 *   referrer?: string,
 *   pageUrl?: string,
 *   destination?: string,
 * }} opts
 */
export function resolveInitiator(opts) {
  const sessionId = opts.sessionId || 'default'
  const tipId = opts.tipId || ''
  let tip = tipId ? consumeTip(sessionId, tipId) : null
  if (!tip) {
    tip = consumeTipByUrl(sessionId, opts.url)
  }

  const referrer = opts.referrer || ''
  rememberReferrer(sessionId, opts.url, referrer)

  if (tip) {
    const scriptUrl = tip.scriptUrl || inferScriptUrl(tip.stack) || ''
    const chain = buildReferrerChain({
      url: opts.url,
      referrer,
      pageUrl: opts.pageUrl || '',
      scriptUrl,
      sessionId,
    })
    return {
      initiatorKind: tip.kind || 'other',
      initiatorChain: chain,
      initiatorStack: Array.isArray(tip.stack) ? tip.stack : [],
      initiatorScriptUrl: scriptUrl || undefined,
    }
  }

  // Parser / unknown: no JS stack
  const kind =
    opts.destination === 'document' || opts.destination === ''
      ? 'other'
      : 'parser'
  return {
    initiatorKind: kind,
    initiatorChain: buildReferrerChain({
      url: opts.url,
      referrer,
      pageUrl: opts.pageUrl || '',
      sessionId,
    }),
    initiatorStack: [],
    initiatorScriptUrl: undefined,
  }
}

export const INITIATOR_HEADER = 'x-vc-initiator-id'

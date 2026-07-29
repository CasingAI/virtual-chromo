/** Initiator tip cache + chain helpers for Network DevTools. */

import {filterStackFrames, STACK_MAX_FRAMES} from './vc-stack.js'

const TIP_TTL_MS = 30 * 1000
const TIP_MAX = 200
const CHAIN_MAX_HOPS = 8

/** @type {Map<string, object>} tipId → tip */
const tips = new Map()

/** @type {Map<string, string>} resourceUrl → referrer */
const referrerMap = new Map()

/** @type {Map<string, string>} resourceUrl → latest tipId */
const tipIdByUrl = new Map()

/**
 * @param {Map<string, object>} tipMap
 */
function evictIfNeeded(tipMap) {
  while (tipMap.size > TIP_MAX) {
    const oldest = tipMap.keys().next().value
    if (oldest === undefined) {
      break
    }
    const old = tipMap.get(oldest)
    tipMap.delete(oldest)
    if (old && typeof old.url === 'string') {
      if (tipIdByUrl.get(old.url) === oldest) {
        tipIdByUrl.delete(old.url)
      }
    }
  }
}

/**
 * Drop expired tips.
 * @param {Map<string, object>} tipMap
 */
function purgeExpired(tipMap) {
  const now = Date.now()
  for (const [id, tip] of tipMap) {
    const ts = tip && typeof tip.ts === 'number' ? tip.ts : 0
    if (now - ts > TIP_TTL_MS) {
      tipMap.delete(id)
      if (tip && typeof tip.url === 'string') {
        if (tipIdByUrl.get(tip.url) === id) {
          tipIdByUrl.delete(tip.url)
        }
      }
    }
  }
}

/**
 * @param {object} tip
 */
export function registerTip(tip) {
  if (!tip || typeof tip !== 'object') {
    return
  }
  const id = typeof tip.id === 'string' ? tip.id : ''
  if (!id) {
    return
  }
  purgeExpired(tips)
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
    tipIdByUrl.set(entry.url, id)
  }
  evictIfNeeded(tips)
}

/**
 * @param {string} tipId
 * @returns {object|null}
 */
export function consumeTip(tipId) {
  if (!tipId) {
    return null
  }
  purgeExpired(tips)
  const tip = tips.get(tipId)
  if (!tip) {
    return null
  }
  tips.delete(tipId)
  if (tip.url) {
    if (tipIdByUrl.get(tip.url) === tipId) {
      tipIdByUrl.delete(tip.url)
    }
  }
  return tip
}

/**
 * Fallback when no X-VC-Initiator-Id header (e.g. dynamic import()).
 * @param {string} url
 * @returns {object|null}
 */
export function consumeTipByUrl(url) {
  if (!url) {
    return null
  }
  const tipId = tipIdByUrl.get(url)
  if (!tipId) {
    return null
  }
  return consumeTip(tipId)
}

/**
 * Remember referrer for a resource URL so Parser chains can walk upward.
 * @param {string} url
 * @param {string} referrer
 */
export function rememberReferrer(url, referrer) {
  if (!url || !referrer || referrer === 'about:client' || referrer === url) {
    return
  }
  referrerMap.set(url, referrer)
}

/**
 * @param {string} raw
 * @returns {string[]}
 */
export function sanitizeStack(raw) {
  return filterStackFrames(raw, STACK_MAX_FRAMES)
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

  /** @type {string[]} */
  const hops = []
  let cur = referrer || scriptUrl || ''
  let guard = 0
  while (cur && guard < CHAIN_MAX_HOPS) {
    hops.unshift(cur)
    const next = referrerMap.get(cur)
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
 *   tipId?: string,
 *   url: string,
 *   referrer?: string,
 *   pageUrl?: string,
 *   destination?: string,
 * }} opts
 */
export function resolveInitiator(opts) {
  const tipId = opts.tipId || ''
  let tip = tipId ? consumeTip(tipId) : null
  if (!tip) {
    tip = consumeTipByUrl(opts.url)
  }

  const referrer = opts.referrer || ''
  rememberReferrer(opts.url, referrer)

  if (tip) {
    const scriptUrl = tip.scriptUrl || inferScriptUrl(tip.stack) || ''
    const chain = buildReferrerChain({
      url: opts.url,
      referrer,
      pageUrl: opts.pageUrl || '',
      scriptUrl,
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
    }),
    initiatorStack: [],
    initiatorScriptUrl: undefined,
  }
}

export const INITIATOR_HEADER = 'x-vc-initiator-id'

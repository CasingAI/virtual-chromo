/**
 * Shared call-stack capture for Network initiator tips and navigation probe.
 * Filters virtual-chromo / jsproxy / inject frames so site scripts surface first.
 */

/** Keep in sync with captureNavStack() in public/inject.js */
export const STACK_SKIP_RE =
  /(?:virtual-chromo|jsproxy|inject\.js|bundle\.built|bundle\.js|vc-report|vc-stack|vc-passive-nav|vc-fakeloc|__vcImport|client\.js|__sys__|helper\.js|bridge\.js|network-initiator|chrome-extension:)/i

export const STACK_MAX_FRAMES = 20

/**
 * @param {string} raw
 * @param {number} [maxFrames]
 * @returns {string[]}
 */
export function filterStackFrames(raw, maxFrames = STACK_MAX_FRAMES) {
  if (!raw || typeof raw !== 'string') {
    return []
  }
  const lines = raw.split('\n')
  /** @type {string[]} */
  const out = []
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim()
    if (!line || line.indexOf('Error') === 0) {
      continue
    }
    if (STACK_SKIP_RE.test(line)) {
      continue
    }
    out.push(line)
    if (out.length >= maxFrames) {
      break
    }
  }
  return out
}

/**
 * @returns {string[]}
 */
export function captureStack() {
  try {
    return filterStackFrames(new Error().stack || '')
  } catch {
    return []
  }
}

/**
 * @param {string[]} frames
 * @param {Window|WorkerGlobalScope} global
 * @returns {string}
 */
export function inferScriptUrl(frames, global) {
  for (let i = 0; i < frames.length; i++) {
    const m = String(frames[i]).match(/https?:\/\/[^\s)\]]+/i)
    if (m) {
      return m[0].replace(/:\d+:\d+$/, '')
    }
  }
  try {
    const doc = global.document
    if (doc && doc.currentScript && doc.currentScript.src) {
      return String(doc.currentScript.src)
    }
  } catch {
    // ignore
  }
  return ''
}

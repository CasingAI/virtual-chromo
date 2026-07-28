/**
 * Shared call-stack capture for Network initiator tips and navigation probe.
 * Filters virtual-chromo / jsproxy / inject frames so site scripts surface first.
 */

/**
 * @returns {string[]}
 */
export function captureStack() {
  let raw = ''
  try {
    raw = new Error().stack || ''
  } catch {
    return []
  }
  const lines = raw.split('\n')
  /** @type {string[]} */
  const out = []
  const skipRe =
    /(?:virtual-chromo|jsproxy|inject\.js|bundle\.built|vc-report|vc-stack|vc-passive-nav|vc-fakeloc|__vcImport|client\.js|chrome-extension:)/i
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim()
    if (!line || line.indexOf('Error') === 0) {
      continue
    }
    if (skipRe.test(line)) {
      continue
    }
    out.push(line)
    if (out.length >= 20) {
      break
    }
  }
  return out
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

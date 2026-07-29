import * as util from './util.js'
import * as route from './route.js'
import {transformFrameSpoof} from './jsfilter-frame.js'


/**
 * @returns {boolean}
 */
function isFrameSpoofEnabled() {
  try {
    const conf = route.getConf && route.getConf()
    if (conf && conf.jsfilter_frame_spoof === false) {
      return false
    }
  } catch {
    // conf not ready — default on
  }
  return true
}

/**
 * @param {string} code
 * @param {{ frameSpoof?: boolean }} [opts]
 */
export function parseStr(code, opts = {}) {
  let out = code
  let match = false

  if (opts.frameSpoof !== false && isFrameSpoofEnabled()) {
    try {
      const astOut = transformFrameSpoof(out)
      if (astOut) {
        out = astOut
        match = true
      }
    } catch {
      // parse/transform failure → keep original for regex path
    }
  }

  out = out.replace(/(\b)location(\b)/g, (_, $1, $2) => {
    match = true
    return $1 + '__location' + $2
  })
  out = out.replace(/postMessage\s*\(/g, s => {
    match = true
    return s + `...(self.__set_srcWin?__set_srcWin():[]), `
  })
  // Dynamic import() → __vcImport( for Initiator stack capture.
  // Avoid import.meta / static import by requiring word-boundary and no leading dot.
  out = out.replace(/(^|[^\.\w$])import\s*\(/g, (_, prefix) => {
    match = true
    return prefix + '__vcImport('
  })
  if (match) {
    return out
  }
  return null
}

/**
 * @param {Uint8Array} buf
 * @param {string} charset
 * @param {{ frameSpoof?: boolean }} [opts]
 */
export function parseBin(buf, charset, opts = {}) {
  const str = util.bytesToStr(buf, charset)
  const ret = parseStr(str, opts)
  if (ret !== null) {
    return util.strToBytes(ret)
  }
  if (charset && !util.isUtf8(charset)) {
    return util.strToBytes(str)
  }
  return null
}

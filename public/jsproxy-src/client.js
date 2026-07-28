import * as urlx from './urlx.js'
import * as route from './route.js'
import * as env from './env.js'
import * as hook from './hook.js'
import {createFakeLoc} from './fakeloc.js'
import {createStorage, setStorageMessenger, handleStoragePush, clearAllStorage} from './storage.js'
import {captureStack, inferScriptUrl} from './vc-stack.js'


const {
  apply,
  construct,
} = Reflect

const INITIATOR_HEADER = 'X-VC-Initiator-Id'

/** @type {((tip: object) => void) | null} */
let initiatorReporter = null

/**
 * @param {(tip: object) => void} fn
 */
export function setInitiatorReporter(fn) {
  initiatorReporter = typeof fn === 'function' ? fn : null
}

function makeTipId() {
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
 * Decode target URL so tip matches SW entry.url.
 * @param {string} url
 * @returns {string}
 */
function tipTargetUrl(url) {
  if (!url) {
    return ''
  }
  try {
    const decoded = urlx.decUrlStrAbs(url)
    if (decoded) {
      return decoded
    }
  } catch {
    // ignore
  }
  try {
    return new URL(url, typeof location !== 'undefined' ? location.href : undefined).href
  } catch {
    return String(url)
  }
}

/**
 * @param {HeadersInit|undefined} headers
 * @param {string} id
 * @returns {Headers}
 */
function withInitiatorHeader(headers, id) {
  const h = new Headers(headers || undefined)
  h.set(INITIATOR_HEADER, id)
  return h
}

/**
 * @param {{
 *   kind: string,
 *   method?: string,
 *   url: string,
 *   tipId?: string,
 * }} opts
 * @param {Window|WorkerGlobalScope} global
 * @returns {string} tip id
 */
function reportInitiator(opts, global) {
  const id = opts.tipId || makeTipId()
  if (!initiatorReporter) {
    return id
  }
  const stack = captureStack()
  const scriptUrl = inferScriptUrl(stack, global)
  try {
    initiatorReporter({
      id,
      kind: opts.kind,
      method: opts.method || 'GET',
      url: tipTargetUrl(opts.url),
      stack,
      scriptUrl: tipTargetUrl(scriptUrl) || scriptUrl,
      ts: Date.now(),
    })
  } catch {
    // ignore
  }
  return id
}


/**
 * Hook 页面和 Worker 相同的 API
 * 
 * @param {Window} global WindowOrWorkerGlobalScope
 * @param {string} origin 
 */
export function init(global, origin) {
  createStorage(global, origin)

  // Dynamic import() helper — jsfilter rewrites `import(` → `__vcImport(`
  try {
    global.__vcImport = function (specifier) {
      const spec = String(specifier)
      let absUrl = spec
      try {
        absUrl = new URL(spec, typeof location !== 'undefined' ? location.href : undefined).href
      } catch {
        absUrl = spec
      }
      reportInitiator({ kind: 'import', method: 'GET', url: absUrl }, global)
      // webpackIgnore: keep native dynamic import (do not rewrite to chunk loader)
      return import(/* webpackIgnore: true */ specifier)
    }
  } catch {
    // ignore non-extensible globals
  }

  // hook Location API
  const fakeLoc = createFakeLoc(global)

  // hook Performance API
  const perfProto = global['PerformanceEntry'].prototype
  hook.prop(perfProto, 'name',
    getter => function() {
      const val = getter.call(this)
      if (/^https?:/.test(val)) {
        return urlx.decUrlStrAbs(val)
      }
      return val
    }
  )


  // hook AJAX API
  const xhrProto = global['XMLHttpRequest'].prototype
  hook.func(xhrProto, 'open', oldFn => function(_0, url) {
    const method = arguments[0] ? String(arguments[0]).toUpperCase() : 'GET'
    const rawUrl = url ? String(url) : ''
    if (rawUrl && !urlx.isCaptchaPassthroughUrl(rawUrl)) {
      arguments[1] = urlx.encUrlStrRel(url, this)
      const tipId = reportInitiator({
        kind: 'xhr',
        method,
        url: rawUrl,
      }, global)
      this.__vcInitiatorId = tipId
    } else {
      this.__vcInitiatorId = ''
    }
    const ret = apply(oldFn, this, arguments)
    if (this.__vcInitiatorId) {
      try {
        this.setRequestHeader(INITIATOR_HEADER, this.__vcInitiatorId)
      } catch {
        // Headers may not be writable until after open in some browsers; send hook retries.
      }
    }
    return ret
  })

  hook.func(xhrProto, 'send', oldFn => function() {
    if (this.__vcInitiatorId) {
      try {
        this.setRequestHeader(INITIATOR_HEADER, this.__vcInitiatorId)
      } catch {
        // already set or not allowed
      }
    }
    return apply(oldFn, this, arguments)
  })

  hook.prop(xhrProto, 'responseURL',
    getter => function(oldFn) {
      const val = getter.call(this)
      return urlx.decUrlStrRel(val, this)
    }
  )


  hook.func(global, 'fetch', oldFn => function(input, init) {
    if (!input) {
      return apply(oldFn, this, arguments)
    }
    const url = typeof input === 'string' ? input : input.url
    if (!url) {
      return apply(oldFn, this, arguments)
    }
    if (urlx.isCaptchaPassthroughUrl(url)) {
      return apply(oldFn, this, arguments)
    }

    const method =
      (init && init.method) ||
      (typeof input !== 'string' && input.method) ||
      'GET'
    const tipId = reportInitiator({
      kind: 'fetch',
      method: String(method).toUpperCase(),
      url,
    }, global)

    const newUrl = urlx.encUrlStrAbs(url)
    const targetUrl = newUrl === url ? url : newUrl

    if (typeof input === 'string') {
      const headers = withInitiatorHeader(init && init.headers, tipId)
      const nextInit = init ? { ...init, headers } : { headers }
      return apply(oldFn, this, [targetUrl, nextInit])
    }

    /** @type {RequestInit} */
    const reqInit = {
      method: input.method,
      headers: input.headers,
      credentials: input.credentials,
      cache: input.cache,
      redirect: input.redirect,
      referrer: input.referrer,
      referrerPolicy: input.referrerPolicy,
      integrity: input.integrity,
      keepalive: input.keepalive,
      signal: input.signal,
      ...init,
    }
    if (input.mode !== 'navigate') {
      reqInit.mode = input.mode
    }
    if (input.method !== 'GET' && input.method !== 'HEAD') {
      reqInit.body = input.body
    }
    reqInit.headers = withInitiatorHeader(reqInit.headers, tipId)
    return apply(oldFn, this, [targetUrl, reqInit])
  })


  hook.func(global, 'WebSocket', oldFn => function(url) {
    const urlObj = urlx.newUrl(url)
    if (urlObj) {
      const {ori} = env.get(this)
      if (ori) {
        const args = {
          'origin': ori.origin,
        }
        arguments[0] = route.genWsUrl(urlObj, args)
      }
    }
    return construct(oldFn, arguments)
  })

  /**
   * @param {string} type 
   */
  function hookWorker(type) {
    hook.func(global, type, oldFn => function(url) {
      if (url) {
        console.log('[jsproxy] new %s: %s', type, url)
        arguments[0] = urlx.encUrlStrRel(url, this)
      }
      return construct(oldFn, arguments)
    })
  }
  
  hookWorker('Worker')
  hookWorker('SharedWorker')


  hook.func(global, 'importScripts', oldFn => function(...args) {
    const urls = args.map(urlx.encUrlStrRel)
    console.log('[jsproxy] importScripts:', urls)
    return apply(oldFn, this, urls)
  })
}

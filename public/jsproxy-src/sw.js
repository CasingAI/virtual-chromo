import * as path from './path.js'
import * as route from './route.js'
import * as urlx from './urlx.js'
import * as util from './util.js'
import * as cookie from './cookie.js'
import * as network from './network.js'
import * as networkLog from './network-log.js'
import * as netCache from './network-response-cache.js'
import * as fetchCtx from './network-fetch-context.js'
import * as MSG from './msg.js'
import * as jsfilter from './jsfilter.js'
import * as inject from './inject.js'
import * as session from './session.js'
import * as sessionStorage from './session-storage.js'
import {Signal} from './signal.js'
import {Database} from './database.js'


const CONF_UPDATE_TIMER = 1000 * 60 * 5

let mConf
const MAX_REDIR = 5

/** @type {ServiceWorkerGlobalScope} */
// @ts-ignore
const global = self
const clients = global.clients

let mUrlHandler


/**
 * @param {*} target 
 * @param {number} cmd 
 * @param {*=} val 
 */
function sendMsg(target, cmd, val) {
  if (target) {
    target.postMessage([cmd, val])
  } else {
    console.warn('invalid target', cmd, val)
  }
}


// 也可以用 clientId 关联，但兼容性不高
let pageCounter = 0

/** @type {Map<number, [Signal, number]>} */
const pageWaitMap = new Map()

function genPageId() {
  return ++pageCounter
}

/** Soft deadline if PAGE_INIT_BEG never arrives (e.g. no JS). */
const PAGE_WAIT_SOFT_MS = 2000
/** Hard deadline after PAGE_INIT_BEG — must never hang the HTML stream forever. */
const PAGE_WAIT_HARD_MS = 8000

/**
 * @param {number} pageId
 */
function pageWait(pageId) {
  const s = new Signal()
  let settled = false

  /**
   * @param {boolean} ok
   */
  function finish(ok) {
    if (settled) {
      return
    }
    settled = true
    const arr = pageWaitMap.get(pageId)
    if (arr) {
      clearTimeout(arr[1])
      pageWaitMap.delete(pageId)
    }
    s.notify(ok)
  }

  // 有些页面不会执行 JS（例如查看源文件），导致永久等待
  const timer = setTimeout(() => finish(false), PAGE_WAIT_SOFT_MS)
  pageWaitMap.set(pageId, [s, timer, finish])
  return s.wait()
}

/**
 * @param {number} id
 * @param {boolean} isDone
 */
function pageNotify(id, isDone) {
  const arr = pageWaitMap.get(id)
  if (!arr) {
    console.warn('[jsproxy] unknown page id:', id)
    return
  }
  const [, timer, finish] = arr
  if (isDone) {
    finish(true)
    return
  }
  // PAGE_INIT_BEG: extend deadline, but never clear it entirely (nested iframe
  // can miss SW_INFO_PUSH and would otherwise white-screen forever).
  clearTimeout(timer)
  const hardTimer = setTimeout(() => finish(false), PAGE_WAIT_HARD_MS)
  pageWaitMap.set(id, [arr[0], hardTimer, finish])
}


function makeHtmlRes(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
    }
  })
}


/**
 * @param {Response} res
 * @param {ResponseInit} resOpt
 * @param {URL} urlObj
 * @param {(() => void)=} onReady
 */
function processHtml(res, resOpt, urlObj, onReady, onComplete) {
  const reader = res.body.getReader()
  let injected = false
  let size = 0
  /** @type {Uint8Array[]} */
  const chunks = []

  const stream = new ReadableStream({
    async pull(controller) {
      if (!injected) {
        injected = true

        const pageId = genPageId()
        const buf = inject.getHtmlCode(urlObj, pageId)
        size += buf.byteLength
        if (size <= netCache.MAX_BODY_BYTES) {
          chunks.push(new Uint8Array(buf))
        }
        controller.enqueue(buf)

        const done = await pageWait(pageId)
        if (!done) {
          console.warn('[jsproxy] page wait timeout. id: %d url: %s',
            pageId, urlObj.href)
        }
        if (onReady) {
          onReady()
        }
      }
      const r = await reader.read()
      if (r.done) {
        if (onComplete) {
          onComplete(size, chunks)
        }
        controller.close()
      } else {
        size += r.value.byteLength
        if (size <= netCache.MAX_BODY_BYTES) {
          chunks.push(r.value)
        }
        controller.enqueue(r.value)
      }
    }
  })
  return new Response(stream, resOpt)
}


/**
 * @param {ArrayBuffer} buf 
 * @param {string} charset 
 */
function processJs(buf, charset) {
  const u8 = new Uint8Array(buf)
  const ret = jsfilter.parseBin(u8, charset) || u8
  return util.concatBufs([inject.getWorkerCode(), ret])
}


/**
 * @param {*} cmd
 * @param {*} msg
 * @param {string=} srcId
 * @param {string=} sessionId
 */
async function sendMsgToPages(cmd, msg, srcId, sessionId) {
  const pages = await clients.matchAll({type: 'window'})
  const sid = sessionId || session.getCurrentSessionId()

  // Deliver to every window client in this session (viewer shell + nested
  // content). Filtering to top-level broke cookie/storage sync and Network
  // pushes when virtual-chromo is embedded as a nested iframe.
  for (const page of pages) {
    if (srcId && page.id === srcId) {
      continue
    }
    const pageSession = session.parseSessionFromUrl(page.url).sessionId
    if (pageSession !== sid) {
      continue
    }
    sendMsg(page, cmd, msg)
  }
}


/** @type Map<string, string> */
const mIdUrlMap = new Map()

/**
 * @param {string} id 
 */
async function getUrlByClientId(id) {
  const client = await clients.get(id)
  if (!client) {
    return
  }
  const urlStr = urlx.decUrlStrAbs(client.url)
  mIdUrlMap.set(id, urlStr)
  return urlStr
}


/**
 * @param {string} jsonStr
 * @param {number} status
 * @param {URL} urlObj
 * @returns {{ code: string, text: string, html: string }}
 */
function describeGatewayError(jsonStr, status, urlObj) {
  let text = ''
  let code = 'GATEWAY_ERROR'
  let msg = ''
  let addr = ''
  let url = ''
  try {
    const parsed = JSON.parse(jsonStr)
    msg = typeof parsed.msg === 'string' ? parsed.msg : ''
    addr = typeof parsed.addr === 'string' ? parsed.addr : ''
    url = typeof parsed.url === 'string' ? parsed.url : ''
  } catch (err) {
    return {
      code: 'GATEWAY_PARSE_ERROR',
      text: '网关错误信息无法解析',
      html: '网关错误信息无法解析',
    }
  }

  if (msg) {
    code = 'GATEWAY_' + msg
  } else {
    code = 'GATEWAY_HTTP_' + status
  }

  switch (status) {
  case 204:
    switch (msg) {
    case 'ORIGIN_NOT_ALLOWED':
      text = '当前域名不在服务器外链白名单'
      break
    case 'CIRCULAR_DEPENDENCY':
      text = '当前请求出现循环代理'
      break
    case 'SITE_MOVE':
      text = '当前站点移动到: ' + url
      break
    default:
      text = msg || '网关拒绝请求'
    }
    break
  case 500:
    text = '代理服务器内部错误'
    break
  case 502:
    if (addr) {
      text = '代理服务器无法连接网站 ' + urlObj.origin + ' (' + addr + ')'
    } else {
      text = '代理服务器无法解析域名 ' + urlObj.host
    }
    break
  case 504:
    text = '代理服务器连接网站超时 ' + urlObj.origin
    if (addr) {
      text += ' (' + addr + ')'
    }
    break
  default:
    text = msg || ('网关错误 HTTP ' + status)
  }

  let html = text
  if (status === 204 && msg === 'SITE_MOVE' && url) {
    html = '当前站点移动到: <a href="' + url + '">' + url + '</a>'
  }
  return { code, text, html }
}

/**
 * @param {string} jsonStr
 * @param {number} status
 * @param {URL} urlObj
 */
function parseGatewayError(jsonStr, status, urlObj) {
  const info = describeGatewayError(jsonStr, status, urlObj)
  return makeHtmlRes(info.html)
}


/**
 * @param {Request} req 
 * @param {URL} urlObj
 * @param {URL} cliUrlObj 
 * @param {number} redirNum
 * @returns {Promise<Response>}
 */
networkLog.setEmitter(function (entry) {
  const sid = (entry && entry.sessionId) || session.getCurrentSessionId()
  sendMsgToPages(MSG.SW_NETWORK_PUSH, entry, undefined, sid)
})


/**
 * @param {Request} req
 * @param {URL} urlObj
 * @param {URL} cliUrlObj
 * @param {number} redirNum
 * @param {string=} sessionId
 * @param {string=} clientId
 * @returns {Promise<Response>}
 */
async function forward(req, urlObj, cliUrlObj, redirNum, sessionId, clientId) {
  const sid = sessionId || session.getCurrentSessionId()
  const isTurnstile = isPassthroughHost(urlObj.hostname)
  const startMs = Date.now()
  const entryId = networkLog.makeId()
  const devtoolsCtx = netCache.resolveContext(clientId || '', sid)
  const devtoolsId = devtoolsCtx ? devtoolsCtx.devtoolsId : ''
  const disableCache = devtoolsCtx ? devtoolsCtx.disableCache : false
  /** @type {{ startedAt?: number, responseAt?: number, finishedAt?: number }} */
  const timingMarks = {}

  /**
   * @param {{ finishedAt?: number }} [extra]
   */
  const currentTiming = (extra) => networkLog.buildTiming(startMs, {
    ...timingMarks,
    ...(extra || {}),
  })

  fetchCtx.setFetchContext({ disableCache })
  try {
    networkLog.record(req, urlObj, null, startMs, {
      pending: true,
      id: entryId,
      sessionId: sid,
      devtoolsId,
      timing: currentTiming(),
    })

    if (!disableCache && devtoolsId && req.method === 'GET') {
      const hot = await netCache.getHot(sid, devtoolsId, req.method, urlObj.href)
      if (hot) {
        const now = Date.now()
        timingMarks.startedAt = now
        timingMarks.responseAt = now
        const buf = await hot.arrayBuffer()
        const chunks = [new Uint8Array(buf)]
        const resOpt = {
          status: hot.status,
          headers: hot.headers,
        }
        await storeNetworkResponse(req, urlObj, startMs, entryId, sid, devtoolsId, disableCache, resOpt, chunks, {
          fromCache: true,
          source: 'cache',
          timing: currentTiming({ finishedAt: Date.now() }),
        })
        return netCache.responseFromChunks(resOpt, chunks)
      }
    }

    timingMarks.startedAt = Date.now()
    const r = await network.launch(req, urlObj, cliUrlObj)
    if (!r) {
      networkLog.record(req, urlObj, null, startMs, {
        failed: true,
        id: entryId,
        sessionId: sid,
        devtoolsId,
        errorCode: 'ERR_PROXY_FETCH_FAILED',
        errorText: '无法连接代理网关',
        timing: currentTiming({ finishedAt: Date.now() }),
      })
      if (isTurnstile) {
        return new Response('load fail', {
          status: 502,
          headers: {
            'access-control-allow-origin': '*',
            'content-type': 'text/plain',
          },
        })
      }
      return makeHtmlRes('load fail')
    }
    timingMarks.responseAt = Date.now()
    let {
      res, status, headers, cookies
    } = r
    const launchSource = typeof r.source === 'string' ? r.source : 'proxy'
    const launchSourceHost = typeof r.sourceHost === 'string' ? r.sourceHost : ''

    if (cookies) {
      sendMsgToPages(MSG.SW_COOKIE_PUSH, cookies, undefined, sid)
    }

    if (!status) {
      status = res.status || 200
    }

    let headersMutable = true
    if (!headers) {
      headers = res.headers
      headersMutable = false
    }

    /**
     * @param {string} k
     * @param {string} v
     */
    const setHeader = (k, v) => {
      if (!headersMutable) {
        headers = new Headers(headers)
        headersMutable = true
      }
      headers.set(k, v)
    }

    const gwErr = headers.get('gateway-err--')
    if (gwErr) {
      const gwInfo = describeGatewayError(gwErr, status, urlObj)
      networkLog.record(req, urlObj, res, startMs, {
        failed: true,
        id: entryId,
        sessionId: sid,
        devtoolsId,
        source: launchSource,
        sourceHost: launchSourceHost,
        errorCode: gwInfo.code,
        errorText: gwInfo.text,
        timing: currentTiming({ finishedAt: Date.now() }),
      })
      return parseGatewayError(gwErr, status, urlObj)
    }

    /** @type {ResponseInit} */
    const resOpt = {status, headers}

    /**
     * @param {Uint8Array[]} chunks
     * @param {{ fromCache?: boolean, failed?: boolean }} [extra]
     */
    const storeAndFinish = async (chunks, extra) => {
      await storeNetworkResponse(
        req, urlObj, startMs, entryId, sid, devtoolsId, disableCache, resOpt, chunks, {
          ...(extra || {}),
          source: launchSource,
          sourceHost: launchSourceHost,
          timing: currentTiming({ finishedAt: Date.now() }),
        },
      )
    }

    /**
     * @param {{ size?: number, failed?: boolean, hasBody?: boolean, fromCache?: boolean }} [extra]
     */
    const finishEntry = (extra) => {
      networkLog.record(req, urlObj, res, startMs, {
        id: entryId,
        sessionId: sid,
        devtoolsId,
        source: launchSource,
        sourceHost: launchSourceHost,
        timing: currentTiming({ finishedAt: Date.now() }),
        ...(extra || {}),
      })
    }

    /**
     * @param {ReadableStream|null|undefined} body
     * @returns {ReadableStream|null|undefined}
     */
    const bodyWithCapture = (body) => {
      if (!body) {
        void storeAndFinish([])
        return body
      }
      return netCache.tapBodyCapture(body, (size, chunks) => {
        void storeAndFinish(chunks)
      })
    }

    if (status === 101 ||
        status === 204 ||
        status === 205 ||
        status === 304
    ) {
      finishEntry({ size: 0 })
      return new Response(null, resOpt)
    }

    if (status === 301 ||
        status === 302 ||
        status === 303 ||
        status === 307 ||
        status === 308
    ) {
      const locStr = headers.get('location')
      const locObj = locStr && urlx.newUrl(locStr, urlObj)
      if (locObj) {
        if (req.redirect === 'follow') {
          finishEntry({ size: 0 })
          if (++redirNum === MAX_REDIR) {
            return makeHtmlRes('重定向过多', 500)
          }
          return forward(req, locObj, cliUrlObj, redirNum, sid, clientId)
        }
        setHeader('location', urlx.encUrlObj(locObj))
      }

      finishEntry({ size: 0 })
      return new Response(null, resOpt)
    }

    const ctVal = headers.get('content-type') || ''
    const [, mime, charset] = ctVal
      .toLocaleLowerCase()
      .match(/([^;]*)(?:.*?charset=['"]?([^'"]+))?/) || []


    const type = req.destination
    if (type === 'script' ||
        type === 'worker' ||
        type === 'sharedworker'
    ) {
      const buf = await res.arrayBuffer()
      const ret = processJs(buf, charset)

      setHeader('content-type', 'text/javascript')
      const chunks = [new Uint8Array(ret)]
      await storeAndFinish(chunks)
      return new Response(ret, resOpt)
    }

    if (req.mode === 'navigate' && mime === 'text/html') {
      if (isTurnstile) {
        applyTurnstileCorsHeaders(setHeader)
        finishEntry()
        return new Response(bodyWithCapture(res.body), resOpt)
      }
      return processHtml(
        res,
        resOpt,
        urlObj,
        () => {
          finishEntry()
        },
        (size, chunks) => {
          void storeAndFinish(chunks)
        },
      )
    }

    if (isTurnstile) {
      applyTurnstileCorsHeaders(setHeader)
    }
    finishEntry()
    return new Response(bodyWithCapture(res.body), resOpt)
  } finally {
    fetchCtx.resetFetchContext()
  }
}


/**
 * @param {Request} req
 * @param {URL} urlObj
 * @param {number} startMs
 * @param {string} entryId
 * @param {string} sid
 * @param {string} devtoolsId
 * @param {boolean} disableCache
 * @param {ResponseInit} resOpt
 * @param {Uint8Array[]} chunks
 * @param {{ fromCache?: boolean, failed?: boolean, bypass?: boolean, timing?: object, source?: string, sourceHost?: string }} [extra]
 */
async function storeNetworkResponse(req, urlObj, startMs, entryId, sid, devtoolsId, disableCache, resOpt, chunks, extra) {
  const size = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  let hasBody = false
  if (netCache.shouldStoreBody(size) && chunks.length) {
    const snapshot = netCache.responseFromChunks(resOpt, chunks)
    hasBody = await netCache.putArchive(sid, entryId, snapshot)
    if (!disableCache && devtoolsId && req.method === 'GET' && !(extra && extra.fromCache)) {
      await netCache.putHot(sid, devtoolsId, req.method, urlObj.href, snapshot)
    }
  }
  let source = extra && typeof extra.source === 'string' ? extra.source : ''
  if (!source) {
    if (extra && extra.fromCache) {
      source = 'cache'
    } else if (extra && extra.bypass) {
      source = 'bypass'
    } else {
      source = 'proxy'
    }
  }
  networkLog.record(req, urlObj, {
    status: resOpt.status || 200,
    statusText: typeof resOpt.statusText === 'string' ? resOpt.statusText : '',
  }, startMs, {
    id: entryId,
    sessionId: sid,
    devtoolsId,
    size,
    hasBody,
    bypass: !!(extra && extra.bypass),
    fromCache: !!(extra && extra.fromCache),
    failed: !!(extra && extra.failed),
    source,
    sourceHost: extra && typeof extra.sourceHost === 'string' ? extra.sourceHost : '',
    timing: extra && extra.timing
      ? extra.timing
      : networkLog.buildTiming(startMs, { finishedAt: Date.now() }),
  })
}


/**
 * @param {FetchEvent} e
 * @param {URL} urlObj
 * @param {string=} sessionId
 */
async function proxy(e, urlObj, sessionId) {
  const id = e.clientId
  const sid = sessionId || session.getCurrentSessionId()
  const devtoolsCtx = netCache.resolveContext(id || '', sid)
  if (e.resultingClientId && devtoolsCtx) {
    netCache.bindClientDevtools(e.resultingClientId, devtoolsCtx.devtoolsId)
  }
  let cliUrlStr
  if (id) {
    cliUrlStr = mIdUrlMap.get(id) || await getUrlByClientId(id)
  }
  if (!cliUrlStr) {
    cliUrlStr = urlObj.href
  }
  const cliUrlObj = new URL(cliUrlStr)

  try {
    return await forward(e.request, urlObj, cliUrlObj, 0, sid, id)
  } catch (err) {
    console.error(err)
    return makeHtmlRes('前端脚本错误<br><pre>' + err.stack + '</pre>', 500)
  }
}

/** @type {Database} */
let mDB

/** @type {Promise<void>|null} */
let mDBInit = null

/**
 * Serialize IDB open across concurrent fetch events.
 * Assigning mDB before await open() used to let later fetches skip init while
 * network/cookie still had no DB → TypeError: Cannot read properties of undefined (reading 'get').
 */
function initDB() {
  if (mDBInit) {
    return mDBInit
  }
  mDBInit = (async () => {
    const db = new Database('.sys')
    await db.open({
      'url-cache': {
        keyPath: 'url'
      },
      'cookie': {
        keyPath: 'id'
      },
      'web-storage': {
        keyPath: 'id'
      }
    })

    mDB = db
    await network.setDB(mDB)
    await cookie.setDB(mDB)
    await sessionStorage.setDB(mDB)

    session.setDestroyHandler(async sessionId => {
      await cookie.destroySession(sessionId)
      await sessionStorage.destroySession(sessionId)
      await network.destroySessionCache(sessionId)
      await netCache.destroySessionCaches(sessionId)
      sendMsgToPages(MSG.SW_SESSION_DESTROY, { sessionId }, undefined, sessionId)
    })
    session.startIdleGc()
  })().catch(err => {
    mDBInit = null
    throw err
  })
  return mDBInit
}


/** @param {string} host */
function isPassthroughHost(host) {
  return urlx.isTurnstileHost(host)
}


/**
 * Direct vendor CAPTCHA assets (Turnstile + reCAPTCHA) — skip proxy rewrite.
 * @param {string} targetUrlStr
 */
function isCaptchaPassthroughTarget(targetUrlStr) {
  return urlx.isTurnstileAbsoluteUrl(targetUrlStr) || urlx.isRecaptchaUrl(targetUrlStr)
}


/**
 * Direct fetch for CAPTCHA scripts/iframes (skip Worker proxy rewrite).
 * @param {Request} req
 * @param {string} targetUrlStr
 */
function shouldPassthroughCaptcha(req, targetUrlStr) {
  if (!isCaptchaPassthroughTarget(targetUrlStr)) {
    return false
  }
  if (req.destination === 'script') {
    return true
  }
  if (
    req.mode === 'navigate' &&
    (req.destination === 'iframe' || req.destination === '')
  ) {
    return true
  }
  // reCAPTCHA also uses fetch/XHR to google.com/recaptcha/*
  if (urlx.isRecaptchaUrl(targetUrlStr)) {
    return true
  }
  return false
}


/** @param {Request} req */
function turnstilePreflightResponse(req) {
  const allowHeaders = req.headers.get('Access-Control-Request-Headers') || '*'
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS',
      'access-control-allow-headers': allowHeaders,
      'access-control-max-age': '86400',
    },
  })
}


/** @param {(k: string, v: string) => void} setHeader */
function applyTurnstileCorsHeaders(setHeader) {
  setHeader('access-control-allow-origin', '*')
  setHeader('access-control-expose-headers', '*')
}


/**
 * Passthrough fetch: keep browser headers, skip proxy rewrite and processJs inject.
 * @param {Request} req
 * @param {string} urlStr
 * @param {string} targetUrlStr
 */
function passthroughFetchRaw(req, urlStr, targetUrlStr) {
  const cacheMode = fetchCtx.getFetchContext().disableCache
    ? 'no-store'
    : req.cache
  if (urlStr === targetUrlStr) {
    if (cacheMode === req.cache) {
      return fetch(req)
    }
    return fetch(new Request(req, { cache: cacheMode }))
  }
  /** @type {RequestInit} */
  const init = {
    method: req.method,
    headers: req.headers,
    credentials: req.credentials,
    cache: cacheMode,
    redirect: req.redirect,
    referrer: req.referrer,
    referrerPolicy: req.referrerPolicy,
    integrity: req.integrity,
    keepalive: req.keepalive,
    signal: req.signal,
  }
  if (req.mode !== 'navigate') {
    init.mode = req.mode
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = req.body
  }
  return fetch(targetUrlStr, init)
}


/**
 * @param {Request} req
 * @param {string} urlStr
 * @param {string} targetUrlStr
 * @param {string=} clientId
 */
async function passthroughFetch(req, urlStr, targetUrlStr, clientId) {
  const urlObj = urlx.newUrl(targetUrlStr) || new URL(targetUrlStr)
  const sid = session.getCurrentSessionId()
  const devtoolsCtx = netCache.resolveContext(clientId || '', sid)
  const devtoolsId = devtoolsCtx ? devtoolsCtx.devtoolsId : ''
  const disableCache = devtoolsCtx ? devtoolsCtx.disableCache : false
  const startMs = Date.now()
  const entryId = networkLog.makeId()
  /** @type {{ startedAt?: number, responseAt?: number, finishedAt?: number }} */
  const timingMarks = {}

  /**
   * @param {{ finishedAt?: number }} [extra]
   */
  const currentTiming = (extra) => networkLog.buildTiming(startMs, {
    ...timingMarks,
    ...(extra || {}),
  })

  fetchCtx.setFetchContext({ disableCache })
  try {
    networkLog.record(req, urlObj, null, startMs, {
      pending: true,
      bypass: true,
      id: entryId,
      sessionId: sid,
      devtoolsId,
      timing: currentTiming(),
    })

    if (!disableCache && devtoolsId && req.method === 'GET') {
      const hot = await netCache.getHot(sid, devtoolsId, req.method, urlObj.href)
      if (hot) {
        const now = Date.now()
        timingMarks.startedAt = now
        timingMarks.responseAt = now
        const buf = await hot.arrayBuffer()
        const chunks = [new Uint8Array(buf)]
        const resOpt = {
          status: hot.status,
          headers: hot.headers,
        }
        await storeNetworkResponse(req, urlObj, startMs, entryId, sid, devtoolsId, disableCache, resOpt, chunks, {
          fromCache: true,
          bypass: true,
          source: 'cache',
          timing: currentTiming({ finishedAt: Date.now() }),
        })
        return netCache.responseFromChunks(resOpt, chunks)
      }
    }

    timingMarks.startedAt = Date.now()
    let res
    try {
      res = await passthroughFetchRaw(req, urlStr, targetUrlStr)
    } catch (err) {
      const isAbort = err && (err.name === 'AbortError' || err.code === 20)
      networkLog.record(req, urlObj, null, startMs, {
        failed: true,
        bypass: true,
        id: entryId,
        sessionId: sid,
        devtoolsId,
        source: 'bypass',
        errorCode: isAbort
          ? 'ERR_ABORTED'
          : 'ERR_' + ((err && err.name) || 'FETCH_FAILED'),
        errorText: isAbort
          ? '(canceled)'
          : String((err && err.message) || err || 'fetch failed').slice(0, 200),
        timing: currentTiming({ finishedAt: Date.now() }),
      })
      throw err
    }
    timingMarks.responseAt = Date.now()

    /**
     * @param {{ size?: number }} [extra]
     */
    const finishEntry = (extra) => {
      networkLog.record(req, urlObj, res, startMs, {
        bypass: true,
        id: entryId,
        sessionId: sid,
        devtoolsId,
        source: 'bypass',
        timing: currentTiming({ finishedAt: Date.now() }),
        ...(extra || {}),
      })
    }

    const resOpt = {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    }

    if (!res.body) {
      await storeNetworkResponse(req, urlObj, startMs, entryId, sid, devtoolsId, disableCache, resOpt, [], {
        bypass: true,
        source: 'bypass',
        timing: currentTiming({ finishedAt: Date.now() }),
      })
      return res
    }

    finishEntry()
    const body = netCache.tapBodyCapture(res.body, (size, chunks) => {
      void storeNetworkResponse(req, urlObj, startMs, entryId, sid, devtoolsId, disableCache, resOpt, chunks, {
        bypass: true,
        source: 'bypass',
        timing: currentTiming({ finishedAt: Date.now() }),
      })
    })
    return new Response(body, resOpt)
  } finally {
    fetchCtx.resetFetchContext()
  }
}


/**
 * Fetch Turnstile api.js directly, patch location -> __location for fakeloc.
 * @param {Request} req
 * @param {string} urlStr
 * @param {string} targetUrlStr
 */
async function passthroughTurnstileScript(req, urlStr, targetUrlStr, clientId) {
  const res = await passthroughFetch(req, urlStr, targetUrlStr, clientId)
  if (res.status !== 200) {
    return res
  }
  const buf = await res.arrayBuffer()
  const ct = res.headers.get('content-type') || ''
  const charsetMatch = ct.match(/charset=['"]?([^'";]+)/i)
  const charset = charsetMatch ? charsetMatch[1] : undefined
  const patched = jsfilter.parseBin(new Uint8Array(buf), charset) || new Uint8Array(buf)
  const headers = new Headers(res.headers)
  headers.set('content-type', 'text/javascript; charset=utf-8')
  return new Response(patched, {
    status: res.status,
    statusText: res.statusText,
    headers,
  })
}


/**
 * @param {FetchEvent} e 
 */
async function onFetch(e) {
  if (!mConf) {
    await initConf()
  }
  await initDB()
  const req = e.request
  const urlStr = urlx.delHash(req.url)
  const parsed = session.parseSessionFromUrl(urlStr)
  session.setCurrentSessionId(parsed.sessionId)
  session.touchSession(parsed.sessionId, e.clientId)

  const origin = parsed.origin || new URL(urlStr).origin
  const sessionRoot = session.buildSessionUrl(origin, parsed.sessionId, '')
  const sessionHome = sessionRoot + 'index.html'

  if (
    session.isViewerHomePath(parsed.restPath) ||
    urlStr === sessionRoot.replace(/\/$/, '') ||
    urlStr === sessionHome ||
    (parsed.sessionId === session.DEFAULT_SESSION && session.isLegacyRootPath(parsed.restPath))
  ) {
    let indexPath = mConf.assets_cdn + mConf.index_path
    if (!mConf.index_path) {
      indexPath = mConf.assets_cdn + 'index_v3.html'
    }
    const res = await fetch(indexPath)
    return makeHtmlRes(res.body)
  }

  const legacyConf = origin + '/conf.js'
  const legacyIcon = origin + '/favicon.ico'
  if (
    urlStr === legacyConf ||
    urlStr === legacyIcon ||
    urlStr.endsWith('/conf.js') && parsed.restPath === '/conf.js' ||
    urlStr.endsWith('/favicon.ico') && parsed.restPath === '/favicon.ico'
  ) {
    return fetch(origin + parsed.restPath)
  }

  if (parsed.restPath.startsWith('/vendor/')) {
    return fetch(mConf.assets_cdn + parsed.restPath.slice(1))
  }

  if (parsed.restPath === path.HELPER.replace(path.ROOT, '/') ||
      urlStr.endsWith('__sys__/helper.js')) {
    return fetch(self['__FILE__'])
  }

  const assetsSuffix = '__sys__/assets/'
  const assetsIdx = parsed.restPath.indexOf(assetsSuffix)
  if (assetsIdx !== -1) {
    const filePath = parsed.restPath.substr(assetsIdx + assetsSuffix.length)
    return fetch(mConf.assets_cdn + filePath)
  }

  if (req.mode === 'navigate') {
    const newUrl = urlx.adjustNav(urlStr)
    if (newUrl) {
      return Response.redirect(newUrl, 301)
    }
  }

  let targetUrlStr = urlx.decUrlStrAbs(urlStr)

  const passthroughObj = urlx.newUrl(targetUrlStr)
  if (passthroughObj && isCaptchaPassthroughTarget(targetUrlStr)) {
    if (req.method === 'OPTIONS') {
      return turnstilePreflightResponse(req)
    }
    if (req.destination === 'script' && urlx.isTurnstileApiJsUrl(urlStr)) {
      return passthroughTurnstileScript(req, urlStr, targetUrlStr, e.clientId)
    }
    if (shouldPassthroughCaptcha(req, targetUrlStr)) {
      return passthroughFetch(req, urlStr, targetUrlStr, e.clientId)
    }
  } else if (passthroughObj && isPassthroughHost(passthroughObj.hostname)) {
    // Turnstile non-asset requests: still allow CORS preflight helper path below via forward()
    if (req.method === 'OPTIONS') {
      return turnstilePreflightResponse(req)
    }
  }

  const handler = mUrlHandler[targetUrlStr]
  if (handler) {
    const {
      redir,
      content,
      replace,
    } = handler

    if (redir) {
      const redirPrefix = session.getProxyPrefix(origin, parsed.sessionId)
      return Response.redirect(redirPrefix + redir)
    }
    if (content) {
      return makeHtmlRes(content)
    }
    if (replace) {
      targetUrlStr = replace
    }
  }

  const targetUrlObj = urlx.newUrl(targetUrlStr)

  if (targetUrlObj) {
    return proxy(e, targetUrlObj, parsed.sessionId)
  }
  return makeHtmlRes('invalid url: ' + targetUrlStr, 500)
}


function parseUrlHandler(handler) {
  const map = {}
  if (!handler) {
    return map
  }
  for (const [match, rule] of Object.entries(handler)) {
    // TODO: 支持通配符和正则
    map[match] = rule
  }
  return map
}

// TODO: 逻辑优化
function updateConf(conf, force) {
  if (!force && mConf) {
    if (conf.ver <= mConf.ver) {
      return
    }
    if (conf.node_map[mConf.node_default]) {
      conf.node_default = mConf.node_default
    } else {
      console.warn('default node %s -> %s',
        mConf.node_default, conf.node_default)
    }
    sendMsgToPages(MSG.SW_CONF_CHANGE, mConf)
  }
  inject.setConf(conf)
  route.setConf(conf)
  network.setConf(conf)

  mUrlHandler = parseUrlHandler(conf.url_handler)
  /*await*/ saveConf(conf)

  mConf = conf
}


async function readConf() {
  const cache = await caches.open('.sys')
  const req = new Request('/conf.json')
  const res = await cache.match(req)
  if (res) {
    return res.json()
  }
}

async function saveConf(conf) {
  const json = JSON.stringify(conf)
  const cache = await caches.open('.sys')
  const req = new Request('/conf.json')
  const res = new Response(json);
  return cache.put(req, res)
}

async function loadConf() {
  const res = await fetch('conf.js')
  const txt = await res.text()
  self['jsproxy_config'] = updateConf
  Function(txt)()
}


/** @type {Signal[]} */
let mConfInitQueue

async function initConf() {
  if (mConfInitQueue) {
    const s = new Signal()
    mConfInitQueue.push(s)
    return s.wait()
  }
  mConfInitQueue = []

  let conf
  try {
    conf = await readConf()
  } catch (err) {
    console.warn('load conf fail:', err)
  }
  if (!conf) {
    conf = self['__CONF__']
  }
  if (conf) {
    updateConf(conf)
  } else {
    conf = await loadConf()
  }

  // 定期更新配置
  setInterval(loadConf, CONF_UPDATE_TIMER)

  mConfInitQueue.forEach(s => s.notify())
  mConfInitQueue = null
}


global.addEventListener('fetch', e => {
  e.respondWith(onFetch(e))
})


global.addEventListener('message', e => {
  const [cmd, val] = e.data
  const src = e.source
  const srcUrl = src && src.url ? src.url : ''
  const srcSession = session.parseSessionFromUrl(srcUrl).sessionId
  session.setCurrentSessionId(srcSession)
  session.touchSession(srcSession, src && src.id)

  switch (cmd) {
  case MSG.PAGE_COOKIE_PUSH:
    cookie.set(val, srcSession)
    sendMsgToPages(MSG.SW_COOKIE_PUSH, [val], src.id, srcSession)
    break

  case MSG.PAGE_INFO_PULL:
    sendMsg(src, MSG.SW_INFO_PUSH, {
      cookies: cookie.getNonHttpOnlyItems(srcSession),
      conf: mConf,
      sessionId: srcSession,
    })
    break

  case MSG.PAGE_STORAGE_GET:
    break

  case MSG.PAGE_STORAGE_SET: {
    const { siteOrigin, key, value, oldValue } = val
    sessionStorage.setItem(srcSession, siteOrigin, key, value).then(() => {
      sendMsgToPages(MSG.SW_STORAGE_PUSH, {
        siteOrigin, key, value, oldValue,
      }, src.id, srcSession)
    })
    break
  }

  case MSG.PAGE_STORAGE_REMOVE: {
    const { siteOrigin, key, oldValue } = val
    sessionStorage.removeItem(srcSession, siteOrigin, key).then(() => {
      sendMsgToPages(MSG.SW_STORAGE_PUSH, {
        siteOrigin, key, value: null, oldValue,
      }, src.id, srcSession)
    })
    break
  }

  case MSG.PAGE_STORAGE_CLEAR: {
    const { siteOrigin } = val
    sessionStorage.clear(srcSession, siteOrigin).then(() => {
      sendMsgToPages(MSG.SW_STORAGE_PUSH, {
        siteOrigin, clear: true,
      }, src.id, srcSession)
    })
    break
  }

  case MSG.PAGE_BRIDGE_SESSION_DESTROY:
    session.destroySession(val.sessionId)
    break

  case MSG.PAGE_SESSION_LIST:
    sendMsg(src, MSG.SW_SESSION_LIST, session.listSessions())
    break

  case MSG.PAGE_INIT_BEG:
    pageNotify(val, false)
    break

  case MSG.PAGE_INIT_END:
    pageNotify(val, true)
    break

  case MSG.PAGE_CONF_GET:
    if (mConf) {
      sendMsg(src, MSG.SW_CONF_RETURN, mConf)
    } else {
      initConf().then(_ => {
        sendMsg(src, MSG.SW_CONF_RETURN, mConf)
      })
    }
    break

  case MSG.PAGE_CONF_SET:
    updateConf(val, true)
    sendMsgToPages(MSG.SW_CONF_CHANGE, mConf)
    break

  case MSG.PAGE_RELOAD_CONF:
    loadConf()
    break

  case MSG.PAGE_READY_CHECK:
    sendMsg(src, MSG.SW_READY)
    loadConf()
    break

  case MSG.PAGE_BUILD_GET:
    sendMsg(src, MSG.SW_BUILD_REPLY, {
      reqId: val && typeof val.reqId === 'string' ? val.reqId : '',
      vc_build: (typeof self.VC_BUILD === 'string' && self.VC_BUILD)
        || (mConf && mConf.vc_build)
        || '',
      vc_version: (typeof self.VC_VERSION === 'string' && self.VC_VERSION)
        || (mConf && mConf.vc_version)
        || '',
    })
    break

  case MSG.PAGE_NETWORK_OPTS: {
  const srcUrl = src && src.url ? src.url : ''
  const srcSession = session.parseSessionFromUrl(srcUrl).sessionId
  const payloadSession =
    val && typeof val.sessionId === 'string' && val.sessionId ? val.sessionId : srcSession
  const devtoolsId = val && typeof val.devtoolsId === 'string' ? val.devtoolsId : ''
  if (devtoolsId && src && src.id) {
    netCache.registerClientOpts(src.id, {
      devtoolsId,
      disableCache: !!(val && val.disableCache),
      sessionId: payloadSession || srcSession,
    })
  }
  break
  }

  case MSG.PAGE_NETWORK_BODY_READ: {
  const srcUrl = src && src.url ? src.url : ''
  const srcSession = session.parseSessionFromUrl(srcUrl).sessionId
  const entryId = val && typeof val.entryId === 'string' ? val.entryId : ''
  const rpcId = val && typeof val.id === 'string' ? val.id : ''
  if (!entryId || !rpcId) {
    sendMsg(src, MSG.SW_NETWORK_BODY_REPLY, {
      id: rpcId,
      ok: false,
      error: { message: 'entryId and id required', code: 'NETWORK_BODY_BAD_REQUEST' },
    })
    break
  }
  netCache.getArchive(srcSession, entryId).then(async (res) => {
    if (!res) {
      sendMsg(src, MSG.SW_NETWORK_BODY_REPLY, {
        id: rpcId,
        ok: false,
        error: { message: 'body not found', code: 'NETWORK_BODY_NOT_FOUND' },
      })
      return
    }
    const buf = await res.arrayBuffer()
    const truncated = buf.byteLength > netCache.MAX_BODY_BYTES
    sendMsg(src, MSG.SW_NETWORK_BODY_REPLY, {
      id: rpcId,
      ok: true,
      value: {
        headers: netCache.headersToObject(res.headers),
        body: buf,
        truncated,
        status: res.status,
      },
    })
  }).catch((err) => {
    sendMsg(src, MSG.SW_NETWORK_BODY_REPLY, {
      id: rpcId,
      ok: false,
      error: { message: String(err), code: 'NETWORK_BODY_READ_FAILED' },
    })
  })
  break
  }

  case MSG.PAGE_NETWORK_ARCHIVE_DROP: {
  const dropSession = session.parseSessionFromUrl(src && src.url ? src.url : '').sessionId
  const entryId = val && typeof val.entryId === 'string' ? val.entryId : ''
  if (entryId) {
    netCache.dropArchive(dropSession, entryId)
  }
  break
  }
  }
})


global.addEventListener('install', e => {
  console.log('oninstall:', e)
  e.waitUntil(global.skipWaiting())
})


global.addEventListener('activate', e => {
  console.log('onactivate:', e)
  sendMsgToPages(MSG.SW_READY, 1)

  e.waitUntil(clients.claim())
})


console.log('[jsproxy] sw inited')

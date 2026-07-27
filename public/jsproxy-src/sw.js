import * as path from './path.js'
import * as route from './route.js'
import * as urlx from './urlx.js'
import * as util from './util.js'
import * as cookie from './cookie.js'
import * as network from './network.js'
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

/**
 * @param {number} pageId 
 */
function pageWait(pageId) {
  const s = new Signal()
  // 设置最大等待时间
  // 有些页面不会执行 JS（例如查看源文件），导致永久等待
  const timer = setTimeout(_ => {
    pageWaitMap.delete(pageId)
    s.notify(false)
  }, 2000)

  pageWaitMap.set(pageId, [s, timer])
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
  const [s, timer] = arr
  if (isDone) {
    pageWaitMap.delete(id)
    s.notify(true)
  } else {
    // 页面已开始初始化，关闭定时器
    clearTimeout(timer)
  }
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
 */
function processHtml(res, resOpt, urlObj) {
  const reader = res.body.getReader()
  let injected = false

  const stream = new ReadableStream({
    async pull(controller) {
      if (!injected) {
        injected = true

        // 注入页面顶部的代码
        const pageId = genPageId()
        const buf = inject.getHtmlCode(urlObj, pageId)
        controller.enqueue(buf)

        // 留一些时间给页面做异步初始化
        const done = await pageWait(pageId)
        if (!done) {
          console.warn('[jsproxy] page wait timeout. id: %d url: %s',
            pageId, urlObj.href)
        }
      }
      const r = await reader.read()
      if (r.done) {
        controller.close()
      } else {
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

  for (const page of pages) {
    if (page.frameType !== 'top-level') {
      continue
    }
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
 */
function parseGatewayError(jsonStr, status, urlObj) {
  let ret = ''
  const {
    msg, addr, url
  } = JSON.parse(jsonStr)

  switch (status) {
  case 204:
    switch (msg) {
    case 'ORIGIN_NOT_ALLOWED':
      ret = '当前域名不在服务器外链白名单'
      break
    case 'CIRCULAR_DEPENDENCY':
      ret = '当前请求出现循环代理'
      break
    case 'SITE_MOVE':
      ret = `当前站点移动到: <a href="${url}">${url}</a>`
      break
    }
    break
  case 500:
    ret = '代理服务器内部错误'
    break
  case 502:
    if (addr) {
      ret = `代理服务器无法连接网站 ${urlObj.origin} (${addr})`
    } else {
      ret = `代理服务器无法解析域名 ${urlObj.host}`
    }
    break
  case 504:
    ret = `代理服务器连接网站超时 ${urlObj.origin}`
    if (addr) {
      ret += ` (${addr})`
    }
    break
  }
  return makeHtmlRes(ret)
}


/**
 * @param {Request} req 
 * @param {URL} urlObj
 * @param {URL} cliUrlObj 
 * @param {number} redirNum
 * @returns {Promise<Response>}
 */
async function forward(req, urlObj, cliUrlObj, redirNum) {
  const isTurnstile = isPassthroughHost(urlObj.hostname)
  const r = await network.launch(req, urlObj, cliUrlObj)
  if (!r) {
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
  let {
    res, status, headers, cookies
  } = r

  if (cookies) {
    sendMsgToPages(MSG.SW_COOKIE_PUSH, cookies, undefined, session.getCurrentSessionId())
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

  // 网关错误
  const gwErr = headers.get('gateway-err--')
  if (gwErr) {
    return parseGatewayError(gwErr, status, urlObj)
  }

  /** @type {ResponseInit} */
  const resOpt = {status, headers}

  // 空响应
  // https://fetch.spec.whatwg.org/#statuses
  if (status === 101 ||
      status === 204 ||
      status === 205 ||
      status === 304
  ) {
    return new Response(null, resOpt)
  }

  // 处理重定向
  if (status === 301 ||
      status === 302 ||
      status === 303 ||
      status === 307 ||
      status === 308
  ) {
    const locStr = headers.get('location')
    const locObj = locStr && urlx.newUrl(locStr, urlObj)
    if (locObj) {
      // 跟随模式，返回最终数据
      if (req.redirect === 'follow') {
        if (++redirNum === MAX_REDIR) {
          return makeHtmlRes('重定向过多', 500)
        }
        return forward(req, locObj, cliUrlObj, redirNum)
      }
      // 不跟随模式（例如页面跳转），返回 30X 状态
      setHeader('location', urlx.encUrlObj(locObj))
    }

    // firefox, safari 保留内容会提示页面损坏
    return new Response(null, resOpt)
  }

  //
  // 提取 mime 和 charset（不存在则为 undefined）
  // 可能存在多个段，并且值可能包含引号。例如：
  // content-type: text/html; ...; charset="gbk"
  //
  const ctVal = headers.get('content-type') || ''
  const [, mime, charset] = ctVal
    .toLocaleLowerCase()
    .match(/([^;]*)(?:.*?charset=['"]?([^'"]+))?/)


  const type = req.destination
  if (type === 'script' ||
      type === 'worker' ||
      type === 'sharedworker'
  ) {
    const buf = await res.arrayBuffer()
    const ret = processJs(buf, charset)

    setHeader('content-type', 'text/javascript')
    return new Response(ret, resOpt)
  }

  if (req.mode === 'navigate' && mime === 'text/html') {
    if (isTurnstile) {
      applyTurnstileCorsHeaders(setHeader)
      return new Response(res.body, resOpt)
    }
    return processHtml(res, resOpt, urlObj)
  }

  if (isTurnstile) {
    applyTurnstileCorsHeaders(setHeader)
  }
  return new Response(res.body, resOpt)
}


async function proxy(e, urlObj) {
  // 使用 e.resultingClientId 有问题
  const id = e.clientId
  let cliUrlStr
  if (id) {
    cliUrlStr = mIdUrlMap.get(id) || await getUrlByClientId(id)
  }
  if (!cliUrlStr) {
    cliUrlStr = urlObj.href
  }
  const cliUrlObj = new URL(cliUrlStr)

  try {
    return await forward(e.request, urlObj, cliUrlObj, 0)
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
function passthroughFetch(req, urlStr, targetUrlStr) {
  if (urlStr === targetUrlStr) {
    return fetch(req)
  }
  // RequestInit cannot copy mode "navigate" (iframe / document loads).
  /** @type {RequestInit} */
  const init = {
    method: req.method,
    headers: req.headers,
    credentials: req.credentials,
    cache: req.cache,
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
 * Fetch Turnstile api.js directly, patch location -> __location for fakeloc.
 * @param {Request} req
 * @param {string} urlStr
 * @param {string} targetUrlStr
 */
async function passthroughTurnstileScript(req, urlStr, targetUrlStr) {
  const res = await passthroughFetch(req, urlStr, targetUrlStr)
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
      return passthroughTurnstileScript(req, urlStr, targetUrlStr)
    }
    if (shouldPassthroughCaptcha(req, targetUrlStr)) {
      return passthroughFetch(req, urlStr, targetUrlStr)
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
    return proxy(e, targetUrlObj)
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

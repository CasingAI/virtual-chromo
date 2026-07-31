'use strict'

const JS_VER = 11
const MAX_RETRY = 1

const PREFLIGHT_ALLOW_METHODS =
  'GET,POST,PUT,PATCH,TRACE,DELETE,HEAD,OPTIONS'

/** 预检未声明具体头时的兜底；含 Authorization / X-Api-Key（AI、语音、GitHub） */
const PREFLIGHT_ALLOW_HEADERS_FALLBACK =
  'authorization,content-type,x-api-key,x-requested-with,accept,accept-language'

/**
 * CORS 预检：回显 Access-Control-Request-Headers，否则浏览器会拒绝 Authorization 等非简单头。
 * @param {Request} req
 */
function preflightResponse(req) {
  const requested = req.headers.get('access-control-request-headers')
  return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': PREFLIGHT_ALLOW_METHODS,
      'access-control-allow-headers':
        requested && requested.trim()
          ? requested
          : PREFLIGHT_ALLOW_HEADERS_FALLBACK,
      'access-control-max-age': '1728000',
    },
  })
}

/**
 * @param {any} body
 * @param {number} status
 * @param {Record<string, string>} headers
 */
function makeRes(body, status = 200, headers = {}) {
  headers['--ver'] = String(JS_VER)
  headers['access-control-allow-origin'] = '*'
  return new Response(body, { status, headers })
}

/**
 * @param {string} urlStr
 */
function newUrl(urlStr) {
  try {
    return new URL(urlStr)
  } catch {
    return null
  }
}

export default {
  /**
   * @param {Request} request
   * @param {{ ASSETS: Fetcher }} env
   */
  async fetch(request, env) {
    try {
      return await fetchHandler(request, env)
    } catch (err) {
      const message = err instanceof Error ? err.stack || err.message : String(err)
      return makeRes('virtual-chromo error:\n' + message, 502)
    }
  },
}

const PROXY_PATH_PREFIX = '/-----'

/**
 * Host-side CORS relay for Instant OS `proxiedFetch`.
 * Path: `{origin}/-----{absoluteTargetUrl}`
 * Viewer SW still intercepts same-origin `/-----` and routes via `/http/`;
 * cross-origin host fetches hit this Worker path directly.
 *
 * @param {Request} req
 * @param {string} pathname
 */
async function hostCorsRelay(req, pathname) {
  const marker = pathname.indexOf(PROXY_PATH_PREFIX)
  if (marker === -1) {
    return makeRes('missing proxy prefix', 400)
  }

  if (req.method === 'OPTIONS') {
    return preflightResponse(req)
  }

  const rawTarget = pathname.slice(marker + PROXY_PATH_PREFIX.length)
  if (!rawTarget) {
    return makeRes('missing proxy target', 400)
  }

  const urlStr = rawTarget.replace(/^(https?):\/+/, '$1://')
  const targetUrl = newUrl(urlStr)
  if (!targetUrl) {
    return makeRes('invalid proxy url: ' + urlStr, 403)
  }
  if (targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') {
    return makeRes('only http/https targets are allowed', 403)
  }

  const hopByHop = new Set([
    'connection',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailers',
    'transfer-encoding',
    'upgrade',
    'host',
    'origin',
    'referer',
  ])

  const fwdHeaders = new Headers()
  for (const [k, v] of req.headers.entries()) {
    if (hopByHop.has(k.toLowerCase())) continue
    if (k.toLowerCase().startsWith('sec-fetch-')) continue
    fwdHeaders.set(k, v)
  }

  /** @type {RequestInit} */
  const reqInit = {
    method: req.method,
    headers: fwdHeaders,
    redirect: 'follow',
  }

  if (req.method !== 'GET' && req.method !== 'HEAD' && !req.bodyUsed) {
    reqInit.body = await req.arrayBuffer()
  }

  let upstream
  try {
    upstream = await fetch(targetUrl.href, reqInit)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return makeRes('proxy fetch failed: ' + message, 502)
  }

  const resHeaders = new Headers()
  const passThrough = [
    'content-type',
    'content-length',
    'content-encoding',
    'cache-control',
    'expires',
    'last-modified',
    'etag',
  ]
  for (const name of passThrough) {
    const value = upstream.headers.get(name)
    if (value != null) {
      resHeaders.set(name, value)
    }
  }
  resHeaders.set('access-control-allow-origin', '*')
  resHeaders.set('access-control-expose-headers', '*')
  resHeaders.set('--ver', String(JS_VER))

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: resHeaders,
  })
}

/**
 * @param {Request} request
 * @param {{ ASSETS: Fetcher }} env
 */
async function fetchHandler(request, env) {
  const urlObj = new URL(request.url)

  if (
    urlObj.protocol === 'http:' &&
    urlObj.hostname !== 'localhost' &&
    urlObj.hostname !== '127.0.0.1'
  ) {
    urlObj.protocol = 'https:'
    return makeRes('', 301, {
      'strict-transport-security': 'max-age=99999999; includeSubDomains; preload',
      location: urlObj.href,
    })
  }

  // Host CORS relay (Instant OS proxiedFetch). Must run before ASSETS fallback.
  if (urlObj.pathname.includes(PROXY_PATH_PREFIX)) {
    return hostCorsRelay(request, urlObj.pathname + urlObj.search)
  }

  if (urlObj.pathname.startsWith('/http/')) {
    return httpHandler(
      request,
      urlObj.pathname.slice('/http/'.length) + urlObj.search,
    )
  }

  // Legacy bookmarks /s/<id>/ → viewer
  if (/^\/s\/[^/]+\/?$/.test(urlObj.pathname)) {
    return withNoStore(
      await env.ASSETS.fetch(
        new Request(new URL('/viewer', urlObj.origin), request),
      ),
    )
  }

  switch (urlObj.pathname) {
    case '/http':
      return makeRes('请更新 Worker 到最新版本!')
    case '/ws':
      return makeRes('not support', 400)
    case '/works':
      return makeRes('it works')
    case '/':
    case '/index.html':
    case '/viewer.html':
    case '/viewer':
      return withNoStore(
        await env.ASSETS.fetch(
          new Request(new URL('/viewer', urlObj.origin), request),
        ),
      )
    case '/blank.html':
    case '/blank':
      return withNoStore(
        await env.ASSETS.fetch(
          new Request(new URL('/blank.html', urlObj.origin), request),
        ),
      )
    case '/bridge.js':
    case '/inject.js':
    case '/sw.js':
    case '/bundle.js':
    case '/bundle.built.js':
    case '/conf.js':
      return withNoStore(await env.ASSETS.fetch(request))
    default:
      return env.ASSETS.fetch(request)
  }
}

/**
 * @param {Response} res
 */
function withNoStore(res) {
  const headers = new Headers(res.headers)
  headers.set('cache-control', 'no-store, no-cache, must-revalidate')
  headers.set('pragma', 'no-cache')
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  })
}

/**
 * @param {Request} req
 * @param {string} pathname
 */
async function httpHandler(req, pathname) {
  const reqHdrRaw = req.headers
  if (reqHdrRaw.has('x-jsproxy')) {
    return Response.error()
  }

  if (req.method === 'OPTIONS') {
    return preflightResponse(req)
  }

  let acehOld = false
  let rawLen = ''

  const reqHdrNew = new Headers(reqHdrRaw)
  reqHdrNew.set('x-jsproxy', '1')

  const refer = reqHdrNew.get('referer')
  if (!refer) {
    return makeRes('missing referer', 403)
  }

  const qIndex = refer.indexOf('?')
  if (qIndex === -1) {
    return makeRes('missing params', 403)
  }

  const query = refer.slice(qIndex + 1)
  if (!query) {
    return makeRes('missing params', 403)
  }

  const param = new URLSearchParams(query)

  for (const [k, v] of param.entries()) {
    if (k.startsWith('--')) {
      switch (k.slice(2)) {
        case 'aceh':
          acehOld = true
          break
        case 'raw-info': {
          const parts = v.split('|')
          rawLen = parts[1] || ''
          break
        }
      }
    } else if (v) {
      reqHdrNew.set(k, v)
    } else {
      reqHdrNew.delete(k)
    }
  }

  if (!param.has('referer')) {
    reqHdrNew.delete('referer')
  }

  // Avoid 304 responses with empty bodies breaking iframe document loads.
  reqHdrNew.delete('if-none-match')
  reqHdrNew.delete('if-modified-since')
  reqHdrNew.delete('if-unmodified-since')
  reqHdrNew.delete('if-match')
  reqHdrNew.delete('if-range')

  const urlStr = pathname.replace(/^(https?):\/+/, '$1://')
  const targetUrl = newUrl(urlStr)
  if (!targetUrl) {
    return makeRes('invalid proxy url: ' + urlStr, 403)
  }

  /** @type {RequestInit} */
  const reqInit = {
    method: req.method,
    headers: reqHdrNew,
    redirect: 'manual',
  }

  // Buffer body: avoid duplex requirement when forwarding ReadableStream
  // to upstream (undici / Cloudflare Workers).
  if (req.method !== 'GET' && req.method !== 'HEAD' && !req.bodyUsed) {
    reqInit.body = await req.arrayBuffer()
  }

  return proxy(targetUrl, reqInit, acehOld, rawLen, 0)
}

/**
 * @param {URL} urlObj
 * @param {RequestInit} reqInit
 * @param {boolean} acehOld
 * @param {string} rawLen
 * @param {number} retryTimes
 */
async function proxy(urlObj, reqInit, acehOld, rawLen, retryTimes) {
  const res = await fetch(urlObj.href, reqInit)

  if (res.status === 304 && retryTimes < MAX_RETRY) {
    const retryHeaders = new Headers(reqInit.headers)
    retryHeaders.delete('if-none-match')
    retryHeaders.delete('if-modified-since')
    retryHeaders.delete('if-unmodified-since')
    retryHeaders.delete('if-match')
    retryHeaders.delete('if-range')
    return proxy(
      urlObj,
      { ...reqInit, headers: retryHeaders },
      acehOld,
      rawLen,
      retryTimes + 1,
    )
  }

  const resHdrOld = res.headers
  const resHdrNew = new Headers(resHdrOld)

  let expose = '*'

  for (const [k, v] of resHdrOld.entries()) {
    if (
      k === 'access-control-allow-origin' ||
      k === 'access-control-expose-headers' ||
      k === 'location' ||
      k === 'set-cookie'
    ) {
      const x = '--' + k
      resHdrNew.set(x, v)
      if (acehOld) {
        expose += ',' + x
      }
      resHdrNew.delete(k)
    } else if (
      acehOld &&
      k !== 'cache-control' &&
      k !== 'content-language' &&
      k !== 'content-type' &&
      k !== 'expires' &&
      k !== 'last-modified' &&
      k !== 'pragma'
    ) {
      expose += ',' + k
    }
  }

  if (acehOld) {
    expose += ',--s'
    resHdrNew.set('--t', '1')
  }

  if (rawLen) {
    const newLen = resHdrOld.get('content-length') || ''
    const badLen = rawLen !== newLen

    if (badLen) {
      if (retryTimes < MAX_RETRY) {
        const redirected = await parseYtVideoRedir(urlObj, newLen, res)
        if (redirected) {
          return proxy(redirected, reqInit, acehOld, rawLen, retryTimes + 1)
        }
      }
      return makeRes(res.body, 400, {
        '--error': `bad len: ${newLen}, except: ${rawLen}`,
        'access-control-expose-headers': '--error',
      })
    }

    if (retryTimes > 1) {
      resHdrNew.set('--retry', String(retryTimes))
    }
  }

  let status = res.status

  resHdrNew.set('access-control-expose-headers', expose)
  resHdrNew.set('access-control-allow-origin', '*')
  resHdrNew.set('--s', String(status))
  resHdrNew.set('--ver', String(JS_VER))

  resHdrNew.delete('content-security-policy')
  resHdrNew.delete('content-security-policy-report-only')
  resHdrNew.delete('clear-site-data')
  resHdrNew.delete('x-frame-options')
  resHdrNew.delete('permissions-policy')
  resHdrNew.delete('cross-origin-opener-policy')
  resHdrNew.delete('cross-origin-embedder-policy')
  resHdrNew.delete('cross-origin-resource-policy')
  resHdrNew.delete('etag')

  if (
    status === 301 ||
    status === 302 ||
    status === 303 ||
    status === 307 ||
    status === 308
  ) {
    status += 10
  }

  return new Response(res.body, {
    status,
    headers: resHdrNew,
  })
}

/**
 * @param {URL} urlObj
 */
function isYtUrl(urlObj) {
  return (
    urlObj.host.endsWith('.googlevideo.com') &&
    urlObj.pathname.startsWith('/videoplayback')
  )
}

/**
 * @param {URL} urlObj
 * @param {string} newLen
 * @param {Response} res
 */
async function parseYtVideoRedir(urlObj, newLen, res) {
  if (Number(newLen) > 2000) {
    return null
  }
  if (!isYtUrl(urlObj)) {
    return null
  }
  try {
    const data = await res.text()
    const next = new URL(data)
    return isYtUrl(next) ? next : null
  } catch {
    return null
  }
}

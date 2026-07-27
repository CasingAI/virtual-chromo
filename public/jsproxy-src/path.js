
export const ROOT = getRootPath()
export const HOME = ROOT + 'index.html'
export const CONF = ROOT + 'conf.js'
export const ICON = ROOT + 'favicon.ico'
export const HELPER = ROOT + '__sys__/helper.js'
export const ASSETS = ROOT + '__sys__/assets/'
export const PREFIX = ROOT + '-----'


function getRootPath() {
  //
  // 如果运行在代理页面，当前路径：
  //   https://example.com/path/to/-----url
  //   https://example.com/s/{sessionId}/-----url
  // 如果运行在 SW，当前路径：
  //   https://example.com/path/to/sw.js
  // 如果运行在 Worker，当前路径：
  //   __PATH__
  // 返回：
  //   https://example.com/path/to/
  //
  /** @type {string} */
  const envPath = self['__PATH__']
  if (envPath) {
    return envPath
  }
  let url = location.href

  const proxyPos = url.indexOf('/-----http')
  if (proxyPos !== -1) {
    return url.substr(0, proxyPos).replace(/\/*$/, '/')
  }

  const sessionShell = url.match(/^(https?:\/\/[^/?#]+(\/s\/[^/?#]+))\/?([?#]|$)/)
  if (sessionShell) {
    return sessionShell[1] + '/'
  }

  const pos = url.indexOf('/-----http')
  if (pos === -1) {
    url = url.replace(/[^/]+$/, '')
  } else {
    url = url.substr(0, pos)
  }
  return url.replace(/\/*$/, '/')
}

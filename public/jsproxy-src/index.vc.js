/**
 * virtual-chromo 定制版 index.js（对应 bundle webpack module 13）
 *
 * 与上游 jsproxy-browser index.js 的差异：
 * - 顶层判定：允许 viewer 外壳 iframe（parent 无 __init__ 时也视为 shell 页）
 * - 子 frame 初始化：调用 parent.__init__ 而非 top.__init__
 * - 日志：[jsproxy] shell page inited（非 top page inited）
 */
import * as env from './env.js'

function isShellPage(win) {
  try {
    if (win === top) return true
  } catch (_) {}
  try {
    if (win !== win.parent && typeof win.parent.__init__ === 'function') return false
  } catch (_) {}
  return true
}

function pageEnv(win) {
  env.setEnvType(env.ENV_PAGE)

  if (isShellPage(win)) {
    win.__init__ = function (childWin) {
      page.init(childWin)
      console.log('[jsproxy] child page inited.', childWin.location.href)
    }

    let lastSrcWin
    win.__set_srcWin = function (obj) {
      lastSrcWin = obj || win
      return []
    }
    win.__get_srcWin = function () {
      const ret = lastSrcWin
      lastSrcWin = null
      return ret
    }

    const page = require('./page.js')
    page.init(win)

    console.log('[jsproxy] shell page inited')
  } else {
    const parent = win.parent
    parent.__init__(win)
    win.__set_srcWin = function () {
      return parent.__set_srcWin(win)
    }
  }
}

function swEnv() {
  env.setEnvType(env.ENV_SW)
  require('./sw.js')
}

function workerEnv(global) {
  env.setEnvType(env.ENV_WORKER)
  require('./client.js').init(global, location.origin)
  global.__set_srcWin = function () {
    return []
  }
}

function main(global) {
  if ('onclick' in global) {
    pageEnv(global)
  } else if ('onfetch' in global) {
    swEnv()
  } else {
    workerEnv(global)
  }
}

main(self)

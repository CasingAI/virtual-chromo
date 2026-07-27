import * as MSG from './msg.js'
import * as route from './route.js'
import * as util from './util.js'
import * as urlx from './urlx.js'
import * as hook from './hook.js'
import * as cookie from './cookie.js'
import * as jsfilter from './jsfilter.js'
import * as env from './env.js'
import * as client from './client.js'
import * as vcReport from './vc-report.js'


const {
  apply,
} = Reflect


function initDoc(win, domHook) {
  const document = win.document

  const headElem = document.head
  const baseElemList = document.getElementsByTagName('base')
  const baseElem = baseElemList[0]
  
  document.__baseElem = baseElem

  //
  // 监控元素创建和删除
  //
  const nodeSet = new WeakSet()

  function onNodeAdd(node) {
    if (nodeSet.has(node)) {
      return
    }
    nodeSet.add(node)
    
    const nodes = node.childNodes
    for (let i = 0, n = nodes.length; i < n; i++) {
      onNodeAdd(nodes[i])
    }
    domHook.addNode(node)
  }


  function onNodeDel(node) {
    nodeSet.delete(node)

    const nodes = node.childNodes
    for (let i = 0, n = nodes.length; i < n; i++) {
      onNodeDel(nodes[i])
    }
    domHook.delNode(node)

    // TODO: 逻辑优化
    if (node === baseElem) {
      // 默认的 <base> 元素可能会被删除，需要及时补上
      headElem.insertBefore(baseElem, headElem.firstChild)
      console.warn('[jsproxy] base elem restored')
    }
  }

  /**
   * @param {MutationRecord[]} mutations 
   */
  function parseMutations(mutations) {
    mutations.forEach(mutation => {
      mutation.addedNodes.forEach(onNodeAdd)
      mutation.removedNodes.forEach(onNodeDel)
    })
  }

  const observer = new win.MutationObserver(parseMutations)
  observer.observe(document, {
    childList: true,
    subtree: true,
  })
}


/**
 * Hook 页面 API
 * 
 * @param {Window} win 
 */
export function init(win) {
  if (!win) {
    return
  }
  try {
    win['x']
  } catch (err) {
    // TODO: 不应该出现
    console.warn('not same origin')
    return
  }

  const document = win.document

  // 该 window 之前已初始化过，现在只需更新 document。
  // 例如 iframe 加载完成之前，读取 contentWindow 得到的是空白页，
  // 加载完成后，document 对象会变化，但 window 上的属性仍保留。
  const info = env.get(win['Math'])
  if (info) {
    const {doc, domHook} = info
    if (doc !== document) {
      // 加载完成后，初始化实际页面的 document
      initDoc(win, domHook)
      info[1] = document
    }
    return
  }


  const {
    location,
    navigator,
  } = win


  // 源路径（空白页继承上级页面）
  const oriUrlObj = new URL(document.baseURI)

  const domHook = hook.createDomHook(win)

  // 关联当前页面上下文信息
  env.add(win, {
    loc: location,
    doc: document,
    ori: oriUrlObj,
    domHook,
  })

  // hook 页面和 Worker 相同的 API
  client.init(win, oriUrlObj.origin)

  // 首次安装 document
  // 如果访问加载中的页面，返回 about:blank 空白页
  initDoc(win, domHook)


  const sw = navigator.serviceWorker
  const swCtl = sw.controller

  function sendMsgToSw(cmd, val) {
    swCtl && swCtl.postMessage([cmd, val])
  }


  // TODO: 这部分逻辑需要优化
  let readyCallback

  function pageAsyncInit() {
    const curScript = document.currentScript
    if (!curScript) {
      return
    }
    // curScript.remove()

    const pageId = +curScript.dataset['id']
    // console.log('PAGE wait id:', pageId)

    if (!pageId) {
      console.warn('[jsproxy] missing page id')
      return
    }

    readyCallback = function() {
      sendMsgToSw(MSG.PAGE_INIT_END, pageId)
    }

    sendMsgToSw(MSG.PAGE_INIT_BEG, pageId)

    // do async init
    // if (win === top) {
      sendMsgToSw(MSG.PAGE_INFO_PULL)
    // } else {
    //   readyCallback()
    // }
  }
  pageAsyncInit()


  sw.addEventListener('message', e => {
    const [cmd, val] = e.data
    switch (cmd) {
    case MSG.SW_COOKIE_PUSH:
      // console.log('PAGE MSG.SW_COOKIE_PUSH:', val)
      val.forEach(cookie.set)
      break

    case MSG.SW_INFO_PUSH:
      // console.log('PAGE MSG.SW_INFO_PUSH:', val)
      val.cookies.forEach(cookie.set)
      route.setConf(val.conf)
      readyCallback()
      break

    case MSG.SW_CONF_CHANGE:
      route.setConf(val)
      break
    }
    e.stopImmediatePropagation()
  }, true)

  sw.startMessages && sw.startMessages()

  //
  // hook ServiceWorker
  //
  const swProto = win['ServiceWorkerContainer'].prototype
  if (swProto) {
    hook.func(swProto, 'register', oldFn => function() {
      console.warn('access serviceWorker.register blocked')
      return new Promise(function() {})
    })
    hook.func(swProto, 'getRegistration', oldFn => function() {
      console.warn('access serviceWorker.getRegistration blocked')
      return new Promise(function() {})
    })
    hook.func(swProto, 'getRegistrations', oldFn => function() {
      console.warn('access serviceWorker.getRegistrations blocked')
      return new Promise(function() {})
    })
  }

  /**
   * @param {History} historyObj
   * @param {string} method
   * @param {string} [title]
   */
  function reportHistoryChange(historyObj, method, title) {
    const info = env.get(historyObj)
    if (!info) {
      return
    }
    const {loc, doc} = info
    /** @type {unknown} */
    let state = null
    try {
      state = historyObj.state
      if (state !== undefined && state !== null) {
        JSON.stringify(state)
      }
    } catch {
      state = { __vc: 'unserializable' }
    }
    vcReport.reportHistory({
      ts: Date.now(),
      method,
      url: urlx.decUrlObj(loc),
      title: title || (doc ? doc.title : ''),
      state: state === undefined ? null : state,
    })
  }

  /**
   * History API
   * @param {string} name 
   */
  function hookHistory(name) {
    const proto = win['History'].prototype

    hook.func(proto, name, oldFn =>
    /**
     * @param {*} data 
     * @param {string} title 
     * @param {string} url 相对或绝对路径
     */
    function(data, title, url) {
      console.log('[jsproxy] history.%s: %s', name, url)

      const {loc, doc} = env.get(this)
      if (doc && url) {
        const dstUrlObj = urlx.newUrl(url, doc.baseURI)
        if (dstUrlObj) {
          // 当前页面 URL
          const srcUrlStr = urlx.decUrlObj(loc)
          const srcUrlObj = new URL(srcUrlStr)

          if (srcUrlObj.origin !== dstUrlObj.origin) {
            throw Error(`\
Failed to execute '${name}' on 'History': \
A history state object with URL '${url}' \
cannot be created in a document with \
origin '${srcUrlObj.origin}' and URL '${srcUrlStr}'.`
            )
          }
          arguments[2] = urlx.encUrlObj(dstUrlObj)
        }
      }
      const ret = apply(oldFn, this, arguments)
      reportHistoryChange(this, name, typeof title === 'string' ? title : '')
      return ret
    })
  }
  hookHistory('pushState')
  hookHistory('replaceState')

  win.addEventListener('popstate', function () {
    reportHistoryChange(win.history, 'popstate', win.document.title)
  })

  //
  // virtual-chromo: passive navigation — report clicks, never native navigate
  //
  hook.func(win, 'open', _oldFn => function(url, target) {
    let dest = ''
    try {
      dest = url ? urlx.decUrlStrRel(String(url), location.href) : String(location.href)
    } catch {
      dest = url ? String(url) : ''
    }
    vcReport.reportLocation({
      ts: Date.now(),
      method: 'open',
      url: dest,
      target: target ? String(target) : '',
    })
    return null
  })

  //
  // hook window.frames[...]
  //
  const frames = win.frames

  // @ts-ignore
  win.frames = new Proxy(frames, {
    get(_, key) {
      if (typeof key === 'number') {
        console.log('get frames index:', key)
        const win = frames[key]
        init(win)
        return win
      } else {
        return frames[key]
      }
    }
  })

  //
  hook.func(navigator, 'registerProtocolHandler', oldFn => function(_0, url, _1) {
    console.log('registerProtocolHandler:', arguments)
    return apply(oldFn, this, arguments)
  })


  //
  // hook document.domain
  //
  const docProto = win['Document'].prototype
  let domain = oriUrlObj.hostname

  hook.prop(docProto, 'domain',
    getter => function() {
      return domain
    },
    setter => function(val) {
      console.log('[jsproxy] set document.domain:', val)
      domain = val
      // TODO:
      setter.call(this, location.hostname)
    }
  )

  //
  // hook document.cookie
  //
  hook.prop(docProto, 'cookie',
    getter => function() {
      // console.log('[jsproxy] get document.cookie')
      const {ori} = env.get(this)
      return cookie.query(ori)
    },
    setter => function(val) {
      // console.log('[jsproxy] set document.cookie:', val)
      const {ori} = env.get(this)
      const item = cookie.parse(val, ori, Date.now())
      if (item) {
        cookie.set(item)
        sendMsgToSw(MSG.PAGE_COOKIE_PUSH, item)
      }
    }
  )

  // hook uri api
  function getUriHook(getter) {
    return function() {
      const val = getter.call(this)
      return val && urlx.decUrlStrAbs(val)
    }
  }

  hook.prop(docProto, 'referrer', getUriHook)
  hook.prop(docProto, 'URL', getUriHook)
  hook.prop(docProto, 'documentURI', getUriHook)

  const nodeProto = win['Node'].prototype
  hook.prop(nodeProto, 'baseURI', getUriHook)


  // hook Message API
  const msgEventProto = win['MessageEvent'].prototype
  hook.prop(msgEventProto, 'origin',
    getter => function() {
      const realOrigin = getter.call(this)
      try {
        if (urlx.isTurnstileHost(new URL(realOrigin).hostname)) {
          return realOrigin
        }
      } catch {
        // ignore invalid origin strings
      }
      const {ori} = env.get(this)
      return ori.origin
    }
  )


  hook.func(win, 'postMessage', oldFn => function(msg, origin) {
    if (origin && origin !== '*') {
      try {
        if (urlx.isTurnstileHost(new URL(origin).hostname)) {
          return apply(oldFn, this, arguments)
        }
      } catch {
        // ignore invalid targetOrigin strings
      }
    }
    const srcWin = top['__get_srcWin']() || this
    if (origin && origin !== '*') {
      arguments[1] = '*'
    }
    return apply(oldFn, srcWin, arguments)
  })


  //
  // hook <meta>
  //
  const metaProto = win['HTMLMetaElement'].prototype

  domHook.attr('META', metaProto,
  {
    name: 'http-equiv',
    onget(val) {
      // TODO: 
      return val
    },
    onset(val) {
      let newVal

      switch (val.toLowerCase()) {
      case 'refresh':
        newVal = urlx.replaceHttpRefresh(this.content, this)
        if (newVal !== val) {
          console.warn('[jsproxy] meta redir')
          this.content = newVal
        }
        break
      case 'content-security-policy':
        console.warn('[jsproxy] meta csp removed')
        this.remove()
        break
      case 'content-type':
        this.remove()
        break
      }
      return val
    }
  },
  {
    name: 'charset',
    onget(val) {
      return val
    },
    onset(val) {
      return 'utf-8'
    }
  }
  )

  //
  // hook 元素的 URL 属性，JS 读取时伪装成原始值
  //
  function hookAttr(tag, proto, name) {
    domHook.attr(tag, proto, {
      name,
      onget(val) {
        if (val === null) {
          return ''
        }
        return urlx.decUrlStrRel(val, this)
      },
      onset(val) {
        if (val === '') {
          return val
        }
        return urlx.encUrlStrRel(val, this)
      }
    })
  }

  function hookFrameSrc(tag, proto) {
    domHook.attr(tag, proto, {
      name: 'src',
      onget(val) {
        if (val === null) {
          return ''
        }
        const {doc} = env.get(this)
        if (urlx.isTurnstileAbsoluteUrl(val, doc.baseURI)) {
          return val
        }
        return urlx.decUrlStrRel(val, this)
      },
      onset(val) {
        if (val === '') {
          return val
        }
        const {doc} = env.get(this)
        if (urlx.isTurnstileAbsoluteUrl(val, doc.baseURI)) {
          return val
        }
        return urlx.encUrlStrRel(val, this)
      }
    })
  }

  const anchorProto = win['HTMLAnchorElement'].prototype
  hookAttr('A', anchorProto, 'href')

  const areaProto = win['HTMLAreaElement'].prototype
  hookAttr('AREA', areaProto, 'href')

  const formProto = win['HTMLFormElement'].prototype
  hookAttr('FORM', formProto, 'action')

  const scriptProto = win['HTMLScriptElement'].prototype
  const linkProto = win['HTMLLinkElement'].prototype

  // 防止混合内容
  if (oriUrlObj.protocol === 'http:') {
    hookAttr('SCRIPT', scriptProto, 'src')
    hookAttr('LINK', linkProto, 'href')
  }

  // const imgProto = win.HTMLImageElement.prototype
  // hookAttr('IMG', imgProto, 'src')

  const embedProto = win['HTMLEmbedElement'].prototype
  hookAttr('EMBED', embedProto, 'src')

  const objectProto = win['HTMLObjectElement'].prototype
  hookAttr('OBJECT', objectProto, 'data')

  const iframeProto = win['HTMLIFrameElement'].prototype
  hookFrameSrc('IFRAME', iframeProto)

  const frameProto = win['HTMLFrameElement'].prototype
  hookFrameSrc('FRAME', frameProto)


  // 更新默认的 baseURI
  // https://developer.mozilla.org/en-US/docs/Web/HTML/Element/base#Usage_notes
  const baseProto = win['HTMLBaseElement'].prototype
  domHook.attr('BASE', baseProto,
  {
    name: 'href',
    onget(val) {
      return this.__href || val
    },
    onset(val) {
      // TODO: 逻辑优化
      const baseElem = this.ownerDocument.__baseElem
      if (!baseElem || baseElem === this) {
        return val
      }
      console.log('[jsproxy] baseURI updated:', val)
      const urlObj = urlx.newUrl(val, baseElem.href)
      baseElem.href = urlObj.href
      this.__href = val
      return ''
    }
  })


  //
  // hook frame
  //
  hook.prop(iframeProto, 'contentWindow',
    getter => function() {
      // TODO: origin check
      const win = getter.call(this)
      init(win)
      return win
    }
  )

  hook.prop(iframeProto, 'contentDocument',
    getter => function() {
      // TODO: origin check
      const doc = getter.call(this)
      if (doc) {
        init(doc.defaultView)
      }
      return doc
    }
  )

  //
  // hook 超链接的 host、pathname 等属性
  // 这类属性只有 property 没有 attribute
  //
  function hookAnchorUrlProp(proto) {
    /**
     * @param {string} key 
     */
    function setupProp(key) {
      hook.prop(proto, key,
        getter => function() {
          // 读取 href 时会经过 hook 处理，得到的已是原始 URL
          const urlObj = new URL(this.href)
          return urlObj[key]
        },
        setter => function(val) {
          // console.log('[jsproxy] set link %s: %s', key, val)
          const urlObj = new URL(this.href)
          urlObj[key] = val
          this.href = urlObj.href
        }
      )
    }
    setupProp('protocol')
    setupProp('hostname')
    setupProp('host')
    setupProp('port')
    setupProp('pathname')
    setupProp('origin')
  }
  hookAnchorUrlProp(anchorProto)
  hookAnchorUrlProp(areaProto)


  // virtual-chromo: report form submit intent, do not navigate
  hook.func(formProto, 'submit', _oldFn => function() {
    let action = ''
    try {
      this.action = this.action
      action = urlx.decUrlStrRel(this.action || location.href, this)
    } catch {
      action = this.action || ''
    }
    vcReport.reportLocation({
      ts: Date.now(),
      method: 'submit',
      url: action,
    })
  })
  

  //
  // 监控 离屏 / 程序化 element.click() — 只上报 VC_CLICK，不调原生 click
  //
  const htmlProto = win['HTMLElement'].prototype

  hook.func(htmlProto, 'click', _oldFn => function vcClick() {
    /** @type {HTMLElement} */
    let el = this
    const interactive = el.closest
      ? el.closest('a,area,button,input,select,textarea,label')
      : el
    const target = interactive || el
    vcReport.reportClick(vcReport.buildClickPayload(target))

    const tag = target.tagName
    if (tag === 'A' || tag === 'AREA') {
      return
    }
    vcReport.dispatchSyntheticClick(el, win)
  })


  //
  // 脚本元素处理
  //
  /** @type {WeakMap<HTMLElement, string>} */
  const integrityMap = new WeakMap()

  /** @type {WeakMap<HTMLElement, string>} */
  const charsetMap = new WeakMap()


  domHook.attr('SCRIPT', scriptProto,
  // 统一使用 UTF-8 编码
  // JS 未提供 UTF-8 转非 UTF-8 的 API，导致编码转换比较麻烦，
  // 因此 SW 将所有 JS 资源都转换成 UTF-8 编码。
  {
    name: 'charset',
    onget(val) {
      return charsetMap.get(this) || val
    },
    onset(val) {
      if (!util.isUtf8(val)) {
        val = 'utf-8'
      }
      charsetMap.set(this, val)
      return val
    }
  },
  // 禁止设置内容校验
  //（调整静态 HTML 时控制台会有告警，但不会阻止运行）
  {
    name: 'integrity',
    onget(val) {
      return integrityMap.get(this) || ''
    },
    onset(val) {
      integrityMap.set(this, val)
      return ''
    }
  },
  // 监控动态创建的脚本
  //（设置 innerHTML 时同样会触发）
  {
    name: 'innerText',
    onget(val) {
      return val
    },
    onset(val, isInit) {
      const ret = updateScriptText(this, val)
      if (ret === null) {
        return isInit ? hook.DROP : val
      }
      return ret
    }
  })

  // text 属性只有 prop 没有 attr
  hook.prop(scriptProto, 'text',
    getter => function() {
      return getter.call(this)
    },
    setter => function(val) {
      const ret = updateScriptText(this, val)
      if (ret === null) {
        setter.call(this, val)
      }
      setter.call(this, ret)
    }
  )

  
  /** @type {WeakSet<HTMLScriptElement>} */
  const parsedSet = new WeakSet()

  /**
   * @param {HTMLScriptElement} elem 
   */
  function updateScriptText(elem, code) {
    // 有些脚本仅用于存储数据（例如模块字符串），无需处理
    const type = elem.type
    if (type && !util.isJsMime(type)) {
      return null
    }
    if (parsedSet.has(elem)) {
      return null
    }
    parsedSet.add(elem)

    return jsfilter.parseStr(code)
  }

  
  /**
   * 处理 <tag onevent=""> 形式的脚本
   * @param {string} eventName 
   */
  function hookEvent(eventName) {
    const scanedSet = new WeakSet()

    function scanElement(el) {
      if (scanedSet.has(el)) {
        return
      }
      scanedSet.add(el)

      // 非元素节点
      if (el.nodeType != 1 /*Node.ELEMENT_NODE*/) {
        return
      }
      // 扫描内联代码
      if (el[eventName]) {
        const code = el.getAttribute(eventName)
        if (code) {
          const ret = jsfilter.parseStr(code)
          if (ret) {
            el[eventName] = ret
            console.log('[jsproxy] jsfilter onevent:', eventName)
          }
        }
      }
      // 扫描上级元素
      scanElement(el.parentNode)
    }

    document.addEventListener(eventName.substr(2), e => {
      scanElement(e.target)
    }, true)
  }

  hookEvent('onerror')
  hookEvent('onload')
  hookEvent('onclick')
  // Object.keys(htmlProto).forEach(v => {
  //   if (v.startsWith('on')) {
  //     hookEvent(v)
  //   }
  // })
}

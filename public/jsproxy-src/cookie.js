import {Database} from './database.js'
import * as session from './session.js'


function Cookie() {
  this.id = ''
  this.sessionId = ''
  this.name = ''
  this.value = ''
  this.domain = ''
  this.hostOnly = false
  this.path = ''
  this.expires = NaN
  this.isExpired = false
  this.secure = false
  this.httpOnly = false
  this.sameSite = ''
}

/**
 * @param {Cookie} src 
 * @param {Cookie} dst 
 */
function copy(dst, src) {
  dst.id = src.id
  dst.sessionId = src.sessionId
  dst.name = src.name
  dst.value = src.value
  dst.domain = src.domain
  dst.hostOnly = src.hostOnly
  dst.path = src.path
  dst.expires = src.expires
  dst.isExpired = src.isExpired
  dst.secure = src.secure
  dst.httpOnly = src.httpOnly
  dst.sameSite = src.sameSite
}


/**
 * @param {string} cookiePath 
 * @param {string} urlPath 
 */
function isSubPath(cookiePath, urlPath) {
  if (urlPath === cookiePath) {
    return true
  }
  if (!cookiePath.endsWith('/')) {
    cookiePath += '/'
  }
  return urlPath.startsWith(cookiePath)
}


/**
 * @param {string} cookieDomain 
 * @param {string} urlDomain 
 */
function isSubDomain(cookieDomain, urlDomain) {
  return urlDomain === cookieDomain ||
    urlDomain.endsWith('.' + cookieDomain)
}


/**
 * @param {Cookie} item 
 * @param {number} now
 */
function isExpire(item, now) {
  const v = item.expires
  return !isNaN(v) && v < now
}


class CookieDomainNode {
  constructor() {
    /** @type {Cookie[]} */
    this.items = null

    /** @type {Object<string, CookieDomainNode>} */
    this.children = {}
  }

  nextChild(name) {
    return this.children[name] || (
      this.children[name] = new CookieDomainNode
    )
  }

  getChild(name) {
    return this.children[name]
  }

  addCookie(cookie) {
    if (this.items) {
      this.items.push(cookie)
    } else {
      this.items = [cookie]
    }
  }
}


class CookieJar {
  /**
   * @param {string} sessionId
   */
  constructor(sessionId) {
    this.sessionId = sessionId
    /** @type {Map<string, Cookie>} */
    this.mIdCookieMap = new Map()
    this.mCookieNodeRoot = new CookieDomainNode()
    /** @type {Set<Cookie>} */
    this.mDirtySet = new Set()
  }

  /**
   * @param {Cookie} item
   */
  set(item) {
    item.sessionId = this.sessionId
    const baseId = (item.secure ? ';' : '') +
      item.name + ';' +
      item.domain +
      item.path
    item.id = `${this.sessionId}$${baseId}`

    const matched = this.mIdCookieMap.get(item.id)

    if (matched) {
      if (item.isExpired) {
        this.mIdCookieMap.delete(item.id)
        matched.isExpired = true
      } else {
        copy(matched, item)
      }
      this.mDirtySet.add(matched)
    } else if (!item.isExpired) {
      const labels = item.domain.split('.')
      let labelPos = labels.length
      let node = this.mCookieNodeRoot
      do {
        node = node.nextChild(labels[--labelPos])
      } while (labelPos !== 0)

      node.addCookie(item)
      this.mIdCookieMap.set(item.id, item)
      this.mDirtySet.add(item)
    }
  }

  /**
   * @param {URL} urlObj 
   */
  query(urlObj) {
    const ret = []
    const now = Date.now()
    const domain = urlObj.hostname
    const path = urlObj.pathname
    const isHttps = (urlObj.protocol === 'https:')

    const labels = domain.split('.')
    let labelPos = labels.length
    let node = this.mCookieNodeRoot

    do {
      node = node.getChild(labels[--labelPos])
      if (!node) {
        break
      }
      const items = node.items
      if (!items) {
        continue
      }
      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        if (!isHttps && item.secure) {
          continue
        }
        if (item.hostOnly && labelPos !== 0) {
          continue
        }
        if (!isSubPath(item.path, path)) {
          continue
        }
        if (item.isExpired) {
          continue
        }
        if (isExpire(item, now)) {
          item.isExpired = true
          continue
        }

        let str = item.value
        if (item.name) {
          str = item.name + '=' + str
        }
        ret.push(str)
      }
    } while (labelPos !== 0)

    return ret.join('; ')
  }

  getNonHttpOnlyItems() {
    const ret = []
    for (const item of this.mIdCookieMap.values()) {
      if (!item.httpOnly) {
        ret.push(item)
      }
    }
    return ret
  }

  /**
   * @param {Database} db
   */
  async save(db) {
    if (this.mDirtySet.size === 0) {
      return
    }

    const tmp = this.mDirtySet
    this.mDirtySet = new Set()

    for (const item of tmp) {
      if (item.isExpired) {
        await db.delete('cookie', item.id)
      } else if (!isNaN(item.expires)) {
        await db.put('cookie', item)
      }
    }
  }

  clearMemory() {
    this.mIdCookieMap.clear()
    this.mCookieNodeRoot = new CookieDomainNode()
    this.mDirtySet.clear()
  }
}


/** @type {Map<string, CookieJar>} */
const mJars = new Map()

/** @type {Database} */
let mDB

/**
 * @param {string} sessionId
 */
function getJar(sessionId) {
  const sid = sessionId || session.getCurrentSessionId()
  let jar = mJars.get(sid)
  if (!jar) {
    jar = new CookieJar(sid)
    mJars.set(sid, jar)
  }
  return jar
}


export function getNonHttpOnlyItems(sessionId) {
  return getJar(sessionId).getNonHttpOnlyItems()
}


/**
 * @param {string} str 
 * @param {URL} urlObj 
 * @param {number} now 
 */
export function parse(str, urlObj, now) {
  const item = new Cookie()
  const arr = str.split(';')

  for (let i = 0; i < arr.length; i++) {
    let key, val
    const s = arr[i].trim()
    const p = s.indexOf('=')

    if (p !== -1) {
      key = s.substr(0, p)
      val = s.substr(p + 1)
    } else {
      key = (i === 0) ? '' : s
      val = (i === 0) ? s : ''
    }

    if (i === 0) {
      item.name = key
      item.value = val
      continue
    }

    switch (key.toLocaleLowerCase()) {
    case 'expires':
      if (isNaN(item.expires)) {
        item.expires = Date.parse(val)
      }
      break
    case 'domain':
      if (val[0] === '.') {
        val = val.substr(1)
      }
      item.domain = val
      break
    case 'path':
      item.path = val
      break
    case 'httponly':
      item.httpOnly = true
      break
    case 'secure':
      item.secure = true
      break
    case 'max-age':
      item.expires = now + (+val) * 1000
      break
    case 'samesite':
      item.sameSite = val
      break
    }
  }

  if (isExpire(item, now)) {
    item.isExpired = true
  }

  if (item.name.startsWith('__Secure-')) {
    if (!(urlObj.protocol === 'https:' && item.secure)) {
      return
    }
  }
  if (item.name.startsWith('__Host-')) {
    if (!(urlObj.protocol === 'https:' && item.secure &&
        item.domain === '' && item.path === '/')) {
      return
    }
  }

  if (item.secure && urlObj.protocol === 'http:') {
    return
  }

  const domain = urlObj.hostname

  if (item.domain) {
    if (!isSubDomain(item.domain, domain)) {
      console.warn('[jsproxy] invalid cookie domain! `%s` ⊄ `%s`',
        item.domain, domain)
      return
    }
  } else {
    item.domain = domain
    item.hostOnly = true
  }

  const path = urlObj.pathname

  if (item.path) {
    if (!isSubPath(item.path, path)) {
      console.warn('[jsproxy] invalid cookie path! `%s` ⊄ `%s`',
        item.path, path)
      return
    }
  } else {
    item.path = path
  }

  return item
}


/**
 * @param {Cookie} item
 * @param {string=} sessionId
 */
export function set(item, sessionId) {
  getJar(sessionId).set(item)
}


/**
 * @param {URL} urlObj
 * @param {string=} sessionId
 */
export function query(urlObj, sessionId) {
  return getJar(sessionId).query(urlObj)
}


export async function setDB(db) {
  mDB = db

  const now = Date.now()
  await mDB.enum('cookie', v => {
    if (isExpire(v, now)) {
      mDB.delete('cookie', v.id)
      return true
    }
    const sid = v.sessionId ||
      (typeof v.id === 'string' && v.id.includes('$')
        ? v.id.split('$')[0]
        : session.DEFAULT_SESSION)
    getJar(sid).set(v)
    return true
  })

  setInterval(saveAll, 1000 * 3)
}


async function saveAll() {
  if (!mDB) {
    return
  }
  for (const jar of mJars.values()) {
    await jar.save(mDB)
  }
}


/**
 * @param {string} sessionId
 */
export async function destroySession(sessionId) {
  const jar = mJars.get(sessionId)
  if (jar) {
    if (mDB) {
      for (const item of jar.mIdCookieMap.values()) {
        await mDB.delete('cookie', item.id)
      }
    }
    jar.clearMemory()
    mJars.delete(sessionId)
  } else if (mDB) {
    await mDB.enum('cookie', v => {
      const sid = v.sessionId ||
        (typeof v.id === 'string' ? v.id.split('$')[0] : '')
      if (sid === sessionId) {
        mDB.delete('cookie', v.id)
      }
      return true
    })
  }
}

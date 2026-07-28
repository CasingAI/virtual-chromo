import {Database} from './database.js'


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
  constructor() {
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
    item.sessionId = ''
    item.id = (item.secure ? ';' : '') +
      item.name + ';' +
      item.domain +
      item.path

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

  getAllItems() {
    const ret = []
    for (const item of this.mIdCookieMap.values()) {
      if (item.isExpired) {
        continue
      }
      ret.push(item)
    }
    return ret
  }

  /**
   * @param {string} id
   * @returns {boolean}
   */
  deleteById(id) {
    const matched = this.mIdCookieMap.get(id)
    if (!matched) {
      return false
    }
    matched.isExpired = true
    this.mIdCookieMap.delete(id)
    this.mDirtySet.add(matched)
    return true
  }

  /**
   * @param {string} domain
   * @returns {number}
   */
  clearByDomain(domain) {
    if (!domain) {
      return 0
    }
    let n = 0
    for (const item of [...this.mIdCookieMap.values()]) {
      if (item.domain === domain || isSubDomain(item.domain, domain) || isSubDomain(domain, item.domain)) {
        item.isExpired = true
        this.mIdCookieMap.delete(item.id)
        this.mDirtySet.add(item)
        n += 1
      }
    }
    return n
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


/** @type {CookieJar} */
const mJar = new CookieJar()

/** @type {Database} */
let mDB


export function getNonHttpOnlyItems() {
  return mJar.getNonHttpOnlyItems()
}

/**
 * @returns {Cookie[]}
 */
export function getAllItems() {
  return mJar.getAllItems()
}

/**
 * Serialize cookie for DevTools (plain object).
 * @param {Cookie} item
 */
export function toPublicCookie(item) {
  return {
    id: item.id,
    name: item.name,
    value: item.value,
    domain: item.domain,
    path: item.path,
    expires: Number.isFinite(item.expires) ? item.expires : null,
    secure: !!item.secure,
    httpOnly: !!item.httpOnly,
    sameSite: item.sameSite || '',
    hostOnly: !!item.hostOnly,
  }
}

/**
 * @param {string} id
 * @returns {boolean}
 */
export function deleteById(id) {
  return mJar.deleteById(id)
}

/**
 * @param {string} domain
 * @returns {Promise<number>}
 */
export async function clearByDomain(domain) {
  const trimmed = typeof domain === 'string' ? domain.trim() : ''
  if (!trimmed) {
    throw Object.assign(new Error('domain required'), { code: 'DOMAIN_REQUIRED' })
  }
  const n = mJar.clearByDomain(trimmed)
  await saveAll()
  return n
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
 */
export function set(item) {
  mJar.set(item)
}


/**
 * @param {URL} urlObj
 */
export function query(urlObj) {
  return mJar.query(urlObj)
}


export async function setDB(db) {
  mDB = db

  const now = Date.now()
  await mDB.enum('cookie', v => {
    if (isExpire(v, now)) {
      mDB.delete('cookie', v.id)
      return true
    }
    // Ignore legacy sessionId on records; re-key into the single jar.
    v.sessionId = ''
    mJar.set(v)
    return true
  })

  setInterval(saveAll, 1000 * 3)
}


async function saveAll() {
  if (!mDB) {
    return
  }
  await mJar.save(mDB)
}


export async function clearAll() {
  if (mDB) {
    await mDB.enum('cookie', v => {
      mDB.delete('cookie', v.id)
      return true
    })
  }
  mJar.clearMemory()
}

/** Persist dirty cookie jar entries to IDB now. */
export async function flush() {
  await saveAll()
}

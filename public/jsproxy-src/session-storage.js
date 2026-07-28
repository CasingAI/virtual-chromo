import {Database} from './database.js'


/** @type {Database} */
let mDB

/** @type {Map<string, Map<string, string>>} */
const mMem = new Map()


/**
 * @param {string} siteOrigin
 */
function memKey(siteOrigin) {
  return siteOrigin
}


/**
 * @param {string} siteOrigin
 */
function getMemMap(siteOrigin) {
  const k = memKey(siteOrigin)
  let map = mMem.get(k)
  if (!map) {
    map = new Map()
    mMem.set(k, map)
  }
  return map
}


/**
 * @param {string} siteOrigin
 * @param {string} key
 */
function storageId(siteOrigin, key) {
  return siteOrigin + '$' + key
}


/**
 * @param {Database} db
 */
export async function setDB(db) {
  mDB = db
}


/**
 * @param {string} siteOrigin
 * @param {string} key
 */
export async function getItem(siteOrigin, key) {
  const map = getMemMap(siteOrigin)
  if (map.has(key)) {
    return map.get(key)
  }
  if (!mDB) {
    return null
  }
  const rec = await mDB.get('web-storage', storageId(siteOrigin, key))
  if (rec && rec.value !== undefined) {
    map.set(key, rec.value)
    return rec.value
  }
  return null
}


/**
 * @param {string} siteOrigin
 * @param {string} key
 * @param {string} value
 */
export async function setItem(siteOrigin, key, value) {
  getMemMap(siteOrigin).set(key, value)
  if (mDB) {
    await mDB.put('web-storage', {
      id: storageId(siteOrigin, key),
      siteOrigin,
      key,
      value,
    })
  }
}


/**
 * @param {string} siteOrigin
 * @param {string} key
 */
export async function removeItem(siteOrigin, key) {
  getMemMap(siteOrigin).delete(key)
  if (mDB) {
    await mDB.delete('web-storage', storageId(siteOrigin, key))
  }
}


/**
 * @param {string} siteOrigin
 */
export async function clear(siteOrigin) {
  mMem.delete(memKey(siteOrigin))
  if (!mDB) {
    return
  }
  await mDB.enum('web-storage', rec => {
    if (rec.siteOrigin === siteOrigin) {
      mDB.delete('web-storage', rec.id)
    }
    return true
  })
}


export async function clearAll() {
  mMem.clear()
  if (!mDB) {
    return
  }
  await mDB.enum('web-storage', rec => {
    mDB.delete('web-storage', rec.id)
    return true
  })
}


/**
 * @param {string} siteOrigin
 * @returns {Promise<{ key: string, value: string }[]>}
 */
export async function listByOrigin(siteOrigin) {
  /** @type {Map<string, string>} */
  const out = new Map()
  const mem = mMem.get(memKey(siteOrigin))
  if (mem) {
    for (const [k, v] of mem) {
      out.set(k, v)
    }
  }
  if (mDB) {
    await mDB.enum('web-storage', rec => {
      if (rec.siteOrigin === siteOrigin && typeof rec.key === 'string') {
        out.set(rec.key, rec.value)
      }
      return true
    })
  }
  return [...out.entries()].map(([key, value]) => ({ key, value }))
}


/**
 * @returns {Promise<string[]>}
 */
export async function listOrigins() {
  /** @type {Set<string>} */
  const set = new Set()
  for (const k of mMem.keys()) {
    set.add(k)
  }
  if (mDB) {
    await mDB.enum('web-storage', rec => {
      if (typeof rec.siteOrigin === 'string' && rec.siteOrigin) {
        set.add(rec.siteOrigin)
      }
      return true
    })
  }
  return [...set].sort()
}
